'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    loadFromRomDirectory,
    parseCartridge,
    parseD64,
    parseT64,
    validatePrg
} = require('./rom-tools.cjs');

function prgAt(load, body) {
    const bytes = Buffer.alloc(body.length + 2);
    bytes.writeUInt16LE(load, 0);
    body.copy(bytes, 2);
    return bytes;
}

function d64Offset(track, sector) {
    const sectors = (t) => t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17;
    let offset = 0;
    for (let t = 1; t < track; t++) offset += sectors(t) * 256;
    return offset + sector * 256;
}

function makeD64(payload, name = 'TEST') {
    const image = Buffer.alloc(174848);
    const sector = d64Offset(17, 0);
    image[sector] = 0;
    image[sector + 1] = payload.length + 1;
    payload.copy(image, sector + 2);

    const directory = d64Offset(18, 1);
    image[directory] = 0;
    image[directory + 1] = 0xFF;
    image[directory + 2] = 0x82;
    image[directory + 3] = 17;
    image[directory + 4] = 0;
    image.fill(0xA0, directory + 5, directory + 21);
    image.write(name, directory + 5, 'ascii');
    image.writeUInt16LE(1, directory + 30);
    return image;
}

function makeT64(payload, name = 'TEST') {
    const data = payload.subarray(2);
    const image = Buffer.alloc(96 + data.length);
    image.write('C64S tape image file', 0, 'ascii');
    image.writeUInt16LE(0x0100, 32);
    image.writeUInt16LE(1, 34);
    image.writeUInt16LE(1, 36);
    image[64] = 1;
    image[65] = 0x82;
    image.writeUInt16LE(payload.readUInt16LE(0), 66);
    image.writeUInt16LE(payload.readUInt16LE(0) + data.length, 68);
    image.writeUInt32LE(96, 72);
    image.fill(0xA0, 80, 96);
    image.write(name, 80, 'ascii');
    data.copy(image, 96);
    return image;
}

test('Validates PRG load addresses', () => {
    const result = validatePrg(prgAt(0x0801, Buffer.from([1, 2, 3])), 'test');
    assert.equal(result.type, 1);
    assert.equal(result.load, 0x0801);
    assert.equal(result.size, 5);
    assert.throws(() => validatePrg(Buffer.alloc(2), 'test'), /too short/);
    assert.throws(() => validatePrg(prgAt(0, Buffer.alloc(4)), 'test'), /no usable load/);
    assert.throws(() => validatePrg(prgAt(0xFFFF, Buffer.alloc(4)), 'test'), /runs past/);
});

test('Extracts the first PRG from a D64 image', () => {
    const payload = prgAt(0x0801, Buffer.from('HELLO', 'ascii'));
    const result = parseD64(makeD64(payload, 'GAME'), 'game.d64');
    assert.equal(result.type, 1);
    assert.equal(result.load, 0x0801);
    assert.equal(result.entryName, 'GAME');
    assert.deepEqual(result.payload, payload);
});

test('Extracts a normal tape file from a T64 image', () => {
    const payload = prgAt(0x0801, Buffer.from('TAPE', 'ascii'));
    const result = parseT64(makeT64(payload, 'TAPE GAME'), 'game.t64');
    assert.equal(result.type, 1);
    assert.equal(result.load, 0x0801);
    assert.equal(result.entryName, 'TAPE GAME');
    assert.deepEqual(result.payload, payload);
});

test('Accepts only standard cartridge sizes and signatures', () => {
    const cart = Buffer.alloc(8192, 0xAA);
    cart.writeUInt16LE(0x8000, 0);
    Buffer.from([0xC3, 0xC2, 0xCD, 0x38, 0x30]).copy(cart, 4);
    assert.equal(parseCartridge(cart, 'cart.rom').type, 2);
    assert.throws(() => parseCartridge(Buffer.alloc(4096), 'cart.rom'), /8192 or 16384/);
    assert.throws(() => parseCartridge(Buffer.alloc(8192), 'cart.rom'), /CBM80/);
});

test('Normalizes parenthesised SYS stubs for Open ROMs BASIC', () => {
    const tokens = Buffer.from([0x9E, 0x28, 0x32, 0x30, 0x36, 0x34, 0x29]); // SYS(2064)
    const lineLength = 4 + tokens.length + 1;
    const line = Buffer.alloc(lineLength);
    line.writeUInt16LE(0x0801 + lineLength, 0);
    line.writeUInt16LE(1998, 2);
    tokens.copy(line, 4);
    const payload = Buffer.concat([Buffer.from([0x01, 0x08]), line, Buffer.from([0, 0]), Buffer.from([0xA9, 0x00])]);
    const length = payload.length;
    const result = validatePrg(payload, 'stub.prg');
    assert.equal(result.patchedSys, 1);
    assert.equal(payload.length, length);
    assert.equal(payload.readUInt16LE(0), 0x0801);
    assert.equal(payload[2 + 5], 0x20);
    assert.equal(payload[2 + 10], 0x20);
    assert.equal(payload[2 + 4 + 2], 0x32); // "2064" untouched
});

test('Leaves strings, bare SYS and non-BASIC PRGs alone', () => {
    const body = (tokens) => {
        const lineLength = 4 + tokens.length + 1;
        const line = Buffer.alloc(lineLength);
        line.writeUInt16LE(0x0801 + lineLength, 0);
        line.writeUInt16LE(10, 2);
        Buffer.from(tokens).copy(line, 4);
        return Buffer.concat([Buffer.from([0x01, 0x08]), line, Buffer.from([0, 0])]);
    };
    const bare = body([0x9E, 0x20, 0x32, 0x30, 0x36, 0x34]);
    assert.equal(validatePrg(bare, 'bare').patchedSys, 0);
    const quoted = body([0x99, 0x22, 0x9E, 0x28, 0x32, 0x29, 0x22]); // PRINT "SYS(2)"
    assert.equal(validatePrg(quoted, 'quoted').patchedSys, 0);
    const machine = prgAt(0x1000, Buffer.from([0x9E, 0x28, 0x32, 0x29]));
    assert.equal(validatePrg(machine, 'machine').patchedSys, 0);
});

test('Selects exactly one supported file from ROM/', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'c64-rom-'));
    try {
        const payload = prgAt(0x0801, Buffer.from([1, 2, 3]));
        fs.writeFileSync(path.join(directory, 'GAME.D64'), makeD64(payload));
        const result = loadFromRomDirectory(directory);
        assert.equal(result.source, path.join(directory, 'GAME.D64'));
        assert.equal(result.entryName, 'TEST');

        fs.writeFileSync(path.join(directory, 'OTHER.PRG'), payload);
        assert.throws(() => loadFromRomDirectory(directory), /exactly one/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('Rejects unsupported containers with a useful message', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'c64-rom-'));
    try {
        fs.writeFileSync(path.join(directory, 'game.crt'), Buffer.alloc(64));
        assert.throws(() => loadFromRomDirectory(directory), /\.crt/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
