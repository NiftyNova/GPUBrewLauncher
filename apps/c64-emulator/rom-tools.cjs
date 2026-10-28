// Build-time conversion of C64 ROM images into an autostart PRG.
//
// The console and the GPU app cannot read files, so ROM/ is scanned on the PC
// during the build. PRGs are passed through, cartridges are mapped at $8000,
// and single-file D64/T64 images are converted by extracting their first
// runnable PRG. Multi-file disk/tape titles need a 1541/datasette, which this
// emulator does not implement.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_EXTENSIONS = new Set(['.prg', '.d64', '.t64', '.rom']);
const D64_LAYOUTS = new Map([
    [174848, 35],
    [175531, 35],
    [196608, 40],
    [197376, 40],
    [205312, 42],
    [206114, 42]
]);
const CBM80 = Buffer.from([0xC3, 0xC2, 0xCD, 0x38, 0x30]);

function fail(message) {
    const error = new Error(message);
    error.code = 'C64ROM';
    throw error;
}

function readFile(file) {
    try {
        return fs.readFileSync(file);
    } catch (error) {
        fail(`cannot read ${file}: ${error.message}`);
    }
}

function relative(root, file) {
    return path.relative(root, file) || file;
}

// Open ROMs BASIC (the BASIC/KERNAL pair shipped with this app) rejects the
// parenthesised form of SYS, while BASIC 2.0 accepts it. Many commercial BASIC
// stubs use `SYS(2064)`, so RUN stops with "?SYNTAX ERROR IN <line>" even
// though the machine code was loaded correctly. The two parentheses can be
// replaced with spaces without changing the line length, link pointers or the
// machine-code addresses that follow the BASIC stub.
function normalizeBasicSys(payload, load) {
    if (load !== 0x0801) return 0;
    const body = payload.subarray(2);
    const limit = load + body.length;
    let patched = 0;
    let offset = 0;
    for (;;) {
        if (offset + 4 > body.length) break;
        const next = body.readUInt16LE(offset);
        if (next === 0) break;
        const current = load + offset;
        if (next <= current || next > limit) break;
        let end = offset + 4;
        while (end < body.length && body[end] !== 0) end++;
        if (end >= body.length) break;
        let quoted = false;
        for (let i = offset + 4; i < end; i++) {
            const byte = body[i];
            if (byte === 0x22) {
                quoted = !quoted;
                continue;
            }
            if (quoted || byte !== 0x9E || body[i + 1] !== 0x28) continue;
            let depth = 1;
            let close = -1;
            for (let j = i + 2; j < end; j++) {
                if (body[j] === 0x28) depth++;
                else if (body[j] === 0x29 && --depth === 0) {
                    close = j;
                    break;
                }
            }
            if (close < 0) continue;
            body[i + 1] = 0x20;
            body[close] = 0x20;
            patched++;
            i = close;
        }
        offset = next - load;
    }
    return patched;
}

function validatePrg(payload, label) {
    if (payload.length < 3) fail(`${label}: PRG is too short`);
    const load = payload.readUInt16LE(0);
    if (load === 0) fail(`${label}: PRG has no usable load address`);
    if (load + payload.length - 2 > 0x10000)
        fail(`${label}: PRG at $${load.toString(16)} runs past $FFFF`);
    const patchedSys = normalizeBasicSys(payload, load);
    return { type: 1, load, size: payload.length, payload, patchedSys };
}

function cbmName(bytes) {
    let name = '';
    for (const byte of bytes) {
        if (byte === 0xA0 || byte === 0x20) name += ' ';
        else if (byte >= 0x20 && byte <= 0x7E) name += String.fromCharCode(byte);
        else if (byte >= 0xC1 && byte <= 0xDA) name += String.fromCharCode(byte - 0x80);
        else name += '.';
    }
    return name.trim();
}

function sectorsOnTrack(track) {
    if (track <= 17) return 21;
    if (track <= 24) return 19;
    if (track <= 30) return 18;
    return 17;
}

function d64SectorOffset(track, sector, tracks) {
    if (!Number.isInteger(track) || track < 1 || track > tracks)
        fail(`D64 references invalid track ${track}`);
    if (!Number.isInteger(sector) || sector < 0 || sector >= sectorsOnTrack(track))
        fail(`D64 references invalid sector ${track}/${sector}`);
    let offset = 0;
    for (let t = 1; t < track; t++) offset += sectorsOnTrack(t) * 256;
    return offset + sector * 256;
}

function d64Sector(image, track, sector, tracks) {
    const offset = d64SectorOffset(track, sector, tracks);
    return image.subarray(offset, offset + 256);
}

function d64Directory(image, tracks) {
    let track = 18;
    let sector = 1;
    const seen = new Set();
    const entries = [];
    while (track !== 0) {
        const key = `${track}/${sector}`;
        if (seen.has(key)) fail('D64 directory contains a loop');
        seen.add(key);
        const data = d64Sector(image, track, sector, tracks);
        for (let i = 0; i < 8; i++) {
            const offset = i * 32;
            const type = data[offset + 2] & 0x0F;
            if (type !== 2) continue;
            const fileTrack = data[offset + 3];
            const fileSector = data[offset + 4];
            if (fileTrack === 0) continue;
            entries.push({
                name: cbmName(data.subarray(offset + 5, offset + 21)),
                track: fileTrack,
                sector: fileSector,
                sectors: data.readUInt16LE(offset + 30)
            });
        }
        track = data[0];
        sector = data[1];
    }
    return entries;
}

function d64File(image, entry, tracks) {
    let track = entry.track;
    let sector = entry.sector;
    const seen = new Set();
    const chunks = [];
    while (track !== 0) {
        const key = `${track}/${sector}`;
        if (seen.has(key)) fail(`D64 file "${entry.name}" contains a loop`);
        seen.add(key);
        const data = d64Sector(image, track, sector, tracks);
        const nextTrack = data[0];
        const nextSector = data[1];
        if (nextTrack === 0) {
            const count = nextSector - 1;
            if (count > 0) chunks.push(data.subarray(2, 2 + count));
            break;
        }
        chunks.push(data.subarray(2, 256));
        track = nextTrack;
        sector = nextSector;
    }
    if (chunks.length === 0) fail(`D64 file "${entry.name}" is empty`);
    return Buffer.concat(chunks);
}

function parseD64(buffer, label) {
    const tracks = D64_LAYOUTS.get(buffer.length);
    if (!tracks) fail(`${label}: unsupported D64 size ${buffer.length} (expected 35/40/42-track image)`);
    const entries = d64Directory(buffer, tracks);
    if (entries.length === 0) fail(`${label}: D64 directory contains no PRG files`);
    const errors = [];
    for (const entry of entries) {
        try {
            const payload = d64File(buffer, entry, tracks);
            return {
                ...validatePrg(payload, `${label} (${entry.name || 'unnamed'})`),
                entryName: entry.name || 'unnamed'
            };
        } catch (error) {
            errors.push(error.message);
        }
    }
    fail(`${label}: no runnable PRG on the disk (${errors[0] || 'invalid file chain'})`);
}

function parseT64(buffer, label) {
    if (buffer.length < 64 || buffer.toString('ascii', 0, 3) !== 'C64')
        fail(`${label}: not a T64 tape image`);
    const maximum = buffer.readUInt16LE(34);
    const used = buffer.readUInt16LE(36);
    const count = Math.min(Math.max(maximum, used), Math.floor((buffer.length - 64) / 32));
    if (count === 0) fail(`${label}: T64 directory is empty`);
    const errors = [];
    for (let i = 0; i < count; i++) {
        const offset = 64 + i * 32;
        const type = buffer[offset];
        if (type !== 1) continue;
        const start = buffer.readUInt16LE(offset + 2);
        const end = buffer.readUInt16LE(offset + 4);
        const dataOffset = buffer.readUInt32LE(offset + 8);
        const name = cbmName(buffer.subarray(offset + 16, offset + 32));
        let size = end - start;
        // Some old converters wrote $C3C6 as the end address. Use the next
        // file's offset, or the end of the image, to recover the real size.
        if (end === 0xC3C6 || size <= 0 || dataOffset + size > buffer.length) {
            let next = buffer.length;
            for (let j = i + 1; j < count; j++) {
                const other = 64 + j * 32;
                if (buffer[other] !== 1) continue;
                const candidate = buffer.readUInt32LE(other + 8);
                if (candidate > dataOffset && candidate < next) next = candidate;
            }
            size = next - dataOffset;
        }
        if (dataOffset < 64 || size < 2 || dataOffset + size > buffer.length) {
            errors.push(`${name || 'unnamed'} has an invalid data range`);
            continue;
        }
        try {
            const payload = Buffer.alloc(size + 2);
            payload.writeUInt16LE(start, 0);
            buffer.copy(payload, 2, dataOffset, dataOffset + size);
            return {
                ...validatePrg(payload, `${label} (${name || 'unnamed'})`),
                entryName: name || 'unnamed'
            };
        } catch (error) {
            errors.push(error.message);
        }
    }
    fail(`${label}: no runnable file in the T64 image (${errors[0] || 'empty directory'})`);
}

function parseCartridge(buffer, label) {
    if (buffer.length !== 8192 && buffer.length !== 16384)
        fail(`${label}: cartridge must be exactly 8192 or 16384 bytes`);
    if (!buffer.subarray(4, 9).equals(CBM80))
        fail(`${label}: missing PETSCII CBM80 signature at $8004`);
    return {
        type: buffer.length === 8192 ? 2 : 3,
        load: 0x8000,
        size: buffer.length,
        payload: buffer
    };
}

function listRomFiles(directory) {
    let entries;
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    return entries
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .filter((entry) => SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => path.join(directory, entry.name))
        .sort((a, b) => a.localeCompare(b));
}

function loadFromRomDirectory(directory, root = path.dirname(directory)) {
    const files = listRomFiles(directory);
    if (files.length === 0) {
        let entries = [];
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        const knownUnsupported = entries
            .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
            .filter((entry) => ['.crt', '.g64', '.tap', '.zip', '.7z'].includes(path.extname(entry.name).toLowerCase()));
        if (knownUnsupported.length > 0)
            fail(`unsupported image in ROM/: ${knownUnsupported.map((entry) => entry.name).join(', ')}; use .prg, .d64, .t64 or raw 8K/16K .rom`);
        return null;
    }
    if (files.length > 1)
        fail(`ROM folder must contain exactly one image; found: ${files.map((file) => path.basename(file)).join(', ')}`);
    const file = files[0];
    const label = relative(root, file);
    const extension = path.extname(file).toLowerCase();
    if (extension === '.prg') {
        return { ...validatePrg(readFile(file), label), source: file };
    }
    if (extension === '.d64') {
        return { ...parseD64(readFile(file), label), source: file };
    }
    if (extension === '.t64') {
        return { ...parseT64(readFile(file), label), source: file };
    }
    if (extension === '.rom') {
        return { ...parseCartridge(readFile(file), label), source: file };
    }
    fail(`${label}: unsupported ROM format`);
}

// A stable fingerprint of every input that can change the generated C64
// package. prepare.cjs uses it to avoid rebuilding on every launcher start.
function inputSignature(root) {
    const files = [];
    const add = (file) => {
        try {
            if (fs.statSync(file).isFile()) files.push(file);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    };
    const addDirectory = (directory) => {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries) {
            if (entry.isFile() && !entry.name.startsWith('.')) add(path.join(directory, entry.name));
        }
    };
    addDirectory(path.join(root, 'ROM'));
    addDirectory(path.join(root, 'assets/roms'));
    add(path.join(root, 'programs/cart.rom'));
    add(path.join(root, 'programs/boot.prg'));
    add(path.join(root, 'programs/demo.prg'));
    add(path.join(root, 'build.cjs'));
    add(path.join(root, 'rom-tools.cjs'));
    const hash = crypto.createHash('sha256');
    for (const file of [...new Set(files)].sort()) {
        hash.update(relative(root, file)).update('\0');
        hash.update(readFile(file));
    }
    hash.update(`C64_BOOT_BASIC=${process.env.C64_BOOT_BASIC === '1' ? '1' : '0'}`);
    return hash.digest('hex');
}

module.exports = {
    SUPPORTED_EXTENSIONS,
    cbmName,
    inputSignature,
    listRomFiles,
    loadFromRomDirectory,
    parseCartridge,
    parseD64,
    parseT64,
    validatePrg
};
