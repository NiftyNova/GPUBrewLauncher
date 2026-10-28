// Build the C64 GPU app package.
//
// Everything the emulator needs at runtime is packed into two assets:
//   assets/memory.bin  - initial private storage (one uint per C64 byte)
//   assets/program.bin - 32-byte loader header + PRG (or cartridge) payload
//
// The program comes from the single image in ROM/ (PRG, D64, T64 or raw
// cartridge), with the legacy programs/ locations as a fallback. The system
// ROMs come from assets/roms. The console has no filesystem access, so
// "loading a ROM" means packing it into these assets on the PC and relaunching
// the package (or refreshing the launcher after a rebuild).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const romTools = require('./rom-tools.cjs');

const root = __dirname;
const WORD_COUNT = 1 << 18; // 1 MiB of private storage = 262144 uint words

// These must match shaders/c64-core.glsl.
const RAM_BASE = 0x00000;
const BASIC_BASE = 0x10000;
const KERNAL_BASE = 0x12000;
const CHARGEN_BASE = 0x14000;
const CART_BASE = 0x15000;
const CPU_BASE = 0x19500;
const META_BASE = 0x19540;

const CPU_A = 0, CPU_X = 1, CPU_Y = 2, CPU_SP = 3, CPU_P = 4;
const CPU_PC = 5, CPU_TOTAL = 6, CPU_HALT = 7, CPU_FRAMES = 8;
const CPU_LINE = 9, CPU_LINECYCLE = 10, CPU_REMAINDER = 11;

const META_INIT = 0, META_STAGE = 1, META_TYPE = 2, META_LOAD = 3;
const META_SIZE = 4, META_FLAGS = 5, META_IDLE = 6, META_ERROR = 7;

function fail(message) {
    throw new Error(message);
}

function readRequired(file) {
    try {
        return fs.readFileSync(file);
    } catch {
        fail(`missing ${path.relative(root, file)}`);
    }
}

function putWord(memory, index, value) {
    if (index < 0 || index >= WORD_COUNT) fail(`word index ${index} outside private memory`);
    memory.writeUInt32LE(value >>> 0, index * 4);
}

function putBytes(memory, wordBase, bytes) {
    if (wordBase + bytes.length > WORD_COUNT) fail(`asset does not fit private memory at word ${wordBase}`);
    for (let i = 0; i < bytes.length; i++) putWord(memory, wordBase + i, bytes[i]);
}

// A tiny tokenizer for the built-in demo BASIC program. Only the keywords
// used by the demo are handled; it is not a general BASIC compiler.
const KEYWORDS = [
    ['PRINT', 0x99], ['CHR$', 0xc7], ['POKE', 0x97], ['PEEK', 0xc2],
    ['AND', 0xaf], ['GOTO', 0x89], ['GOSUB', 0x8d], ['RETURN', 0x8e]
];
const OPERATORS = { '+': 0xaa, '-': 0xab, '*': 0xac, '/': 0xad, '^': 0xae, '>': 0xb1, '=': 0xb2, '<': 0xb3 };

function tokenize(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
        if (text[i] === '"') {
            out.push(0x22);
            i++;
            while (i < text.length && text[i] !== '"') out.push(text.charCodeAt(i++) & 0xff);
            if (i < text.length) { out.push(0x22); i++; }
            continue;
        }
        let matched = false;
        for (const [word, token] of KEYWORDS) {
            if (text.startsWith(word, i)) {
                out.push(token);
                i += word.length;
                matched = true;
                break;
            }
        }
        if (matched) continue;
        const ch = text[i];
        if (ch in OPERATORS) {
            out.push(OPERATORS[ch]);
        } else if (ch === ' ') {
            out.push(0x20);
        } else {
            out.push(text.charCodeAt(i) & 0xff);
        }
        i++;
    }
    return out;
}

function makeDemoPrg() {
    // Keep the built-in demo to tokens that Open ROMs BASIC implements. In
    // particular it does not implement CHR$, so clear the screen with a POKE
    // to the border/background registers instead.
    const lines = [
        [10, 'POKE 53280,0:POKE 53281,0'],
        [20, 'PRINT "C64 ON GPU"'],
        [30, 'POKE 53280,6:POKE 53281,14'],
        [40, 'GOTO 40']
    ];
    const body = [];
    let address = 0x0801;
    for (const [number, text] of lines) {
        const tokens = tokenize(text);
        const length = 2 + 2 + tokens.length + 1;
        body.push(
            (address + length) & 0xff, ((address + length) >> 8) & 0xff,
            number & 0xff, (number >> 8) & 0xff,
            ...tokens, 0
        );
        address += length;
    }
    body.push(0, 0);
    return Buffer.from([0x01, 0x08, ...body]);
}

function findProgram() {
    // The easy path: exactly one file in ROM/ is packed and autostarted.
    const rom = romTools.loadFromRomDirectory(path.join(root, 'ROM'), root);
    if (rom) return rom;

    // Legacy locations remain supported for existing packages.
    const cartFile = path.join(root, 'programs/cart.rom');
    if (fs.existsSync(cartFile)) {
        const cart = fs.readFileSync(cartFile);
        return {
            ...romTools.parseCartridge(cart, 'programs/cart.rom'),
            source: cartFile
        };
    }
    const candidates = [path.join(root, 'programs/boot.prg'), path.join(root, 'programs/demo.prg')];
    const source = candidates.find((f) => fs.existsSync(f));
    if (!source && process.env.C64_BOOT_BASIC === '1') {
        // No autostart program: leave the machine at the BASIC prompt.
        return { type: 0, load: 0, size: 0, payload: Buffer.alloc(0), source: 'no program (BASIC prompt)' };
    }
    const prg = source ? fs.readFileSync(source) : makeDemoPrg();
    return {
        ...romTools.validatePrg(prg, source ? path.relative(root, source) : 'generated demo'),
        source: source || 'generated demo'
    };
}

const SHADER_OUTPUTS = ['app.vert.spv', 'app.frag.spv', 'app.comp.spv'];

function shaderOutputsExist() {
    return SHADER_OUTPUTS.every((name) => fs.existsSync(path.join(root, name)));
}

function writeStamp(program) {
    fs.writeFileSync(path.join(root, 'assets/rom-stamp.json'), JSON.stringify({
        signature: romTools.inputSignature(root),
        source: path.isAbsolute(program.source) ? path.relative(root, program.source) : program.source,
        entry: program.entryName || null,
        type: program.type,
        load: program.load,
        size: program.size
    }, null, 2) + '\n');
}

function main() {
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });

    const basic = readRequired(path.join(root, 'assets/roms/basic.rom'));
    const kernal = readRequired(path.join(root, 'assets/roms/kernal.rom'));
    const chargen = readRequired(path.join(root, 'assets/roms/chargen.rom'));
    if (basic.length !== 8192) fail('basic.rom must be 8192 bytes');
    if (kernal.length !== 8192) fail('kernal.rom must be 8192 bytes');
    if (chargen.length !== 4096) fail('chargen.rom must be 4096 bytes');

    const program = findProgram();

    const memory = Buffer.alloc(WORD_COUNT * 4);
    putBytes(memory, BASIC_BASE, basic);
    putBytes(memory, KERNAL_BASE, kernal);
    putBytes(memory, CHARGEN_BASE, chargen);
    if (program.type >= 2) putBytes(memory, CART_BASE, program.payload);

    // Processor reset state. resetMachine() reads the real reset vector from
    // the KERNAL, so PC here is only a placeholder.
    putWord(memory, CPU_BASE + CPU_A, 0);
    putWord(memory, CPU_BASE + CPU_X, 0);
    putWord(memory, CPU_BASE + CPU_Y, 0);
    putWord(memory, CPU_BASE + CPU_SP, 0xfd);
    putWord(memory, CPU_BASE + CPU_P, 0x24);
    putWord(memory, CPU_BASE + CPU_PC, 0);
    putWord(memory, CPU_BASE + CPU_TOTAL, 0);
    putWord(memory, CPU_BASE + CPU_HALT, 0);
    putWord(memory, CPU_BASE + CPU_FRAMES, 0);
    putWord(memory, CPU_BASE + CPU_LINE, 0);
    putWord(memory, CPU_BASE + CPU_LINECYCLE, 0);
    putWord(memory, CPU_BASE + CPU_REMAINDER, 0);

    putWord(memory, META_BASE + META_INIT, 0);
    putWord(memory, META_BASE + META_STAGE, 0);
    putWord(memory, META_BASE + META_TYPE, program.type);
    putWord(memory, META_BASE + META_LOAD, program.load);
    putWord(memory, META_BASE + META_SIZE, program.size);
    putWord(memory, META_BASE + META_FLAGS, 7); // KERNAL + BASIC + CHARGEN present
    putWord(memory, META_BASE + META_IDLE, 0);
    putWord(memory, META_BASE + META_ERROR, 0);

    fs.writeFileSync(path.join(root, 'assets/memory.bin'), memory);

    // Loader header (32 bytes), then the payload exactly as supplied.
    const header = Buffer.alloc(32);
    header.write('C64P', 0, 'ascii');
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(program.size, 8);
    header.writeUInt32LE(program.load, 12);
    header.writeUInt32LE(program.type, 16);
    header.writeUInt32LE(7, 20);
    header.writeUInt32LE(program.payload.length, 24);
    fs.writeFileSync(path.join(root, 'assets/program.bin'), Buffer.concat([header, program.payload]));

    const state = Buffer.alloc(1024);
    state.writeFloatLE(1.0, 960);
    fs.writeFileSync(path.join(root, 'assets/state.bin'), state);

    execFileSync('python3', [path.join(root, 'assets.py')], { stdio: 'inherit' });
    const skipShaders = process.env.C64_SKIP_SHADERS === '1' && shaderOutputsExist();
    const compiled = skipShaders
        ? Promise.resolve(console.log('shaders up to date'))
        : require('../../sdk/build.cjs').buildApp(root);
    compiled.then(() => {
        writeStamp(program);
        const sourceLabel = path.isAbsolute(program.source) ? path.relative(root, program.source) : program.source;
        const entry = program.entryName ? ` "${program.entryName}"` : '';
        const note = program.patchedSys ? ` [normalized ${program.patchedSys} SYS(...) stub(s) for Open ROMs BASIC]` : '';
        console.log(`packed ${sourceLabel}${entry} at $${program.load.toString(16)} ` +
            `(${program.payload.length} bytes, type ${program.type})${note}`);
    }).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
}
