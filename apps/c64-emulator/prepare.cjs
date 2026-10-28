// Repack apps/c64-emulator when ROM/, the system ROMs, or the program files
// changed. start.sh runs this before starting the host, so dropping one image
// into ROM/ and launching GPUBrewLauncher is enough.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inputSignature } = require('./rom-tools.cjs');

const root = __dirname;
const stampFile = path.join(root, 'assets/rom-stamp.json');
const required = [
    'assets/memory.bin',
    'assets/program.bin',
    'assets/state.bin',
    'assets/icon.png',
    'app.vert.spv',
    'app.frag.spv',
    'app.comp.spv'
];

function upToDate(signature) {
    for (const file of required) {
        try {
            if (!fs.statSync(path.join(root, file)).isFile()) return false;
        } catch {
            return false;
        }
    }
    try {
        return JSON.parse(fs.readFileSync(stampFile, 'utf8')).signature === signature;
    } catch {
        return false;
    }
}

const signature = inputSignature(root);
if (upToDate(signature)) process.exit(0);

console.log('C64 GPU: ROM/ changed, repacking the app...');
try {
    execFileSync(process.execPath, [path.join(root, 'build.cjs')], {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, C64_SKIP_SHADERS: '1' }
    });
} catch {
    console.error('C64 GPU: repack failed. Fix the image in ROM/ or run the build manually.');
    process.exitCode = 1;
}
