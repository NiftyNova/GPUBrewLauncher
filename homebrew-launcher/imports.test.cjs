'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readModule, resolveSlots, executableRanges, inRanges, decodePltSlot, findPlt} =
  require('./imports.cjs');

const BASE = 0x1000000000;

function fakeRpc(buffer, base = BASE) {
  return {
    a: {main: base, sdk: base + 0x4000000},
    async read(address, length) {
      const offset = address - base;
      if (offset < 0 || offset + length > buffer.length) throw Error('read out of range');
      return Buffer.from(buffer.subarray(offset, offset + length));
    },
    async query(address) {
      const offset = address - base;
      if (offset < 0 || offset >= buffer.length) throw Error('query out of range');
      return {address, size: buffer.length - offset, permissions: 5, ipcReferences: 0};
    }
  };
}

function makeModule(slot) {
  const buffer = Buffer.alloc(0x2000);
  buffer.writeUInt32LE(0x100, 4);
  buffer.write('MOD0', 0x100, 'ascii');
  buffer.writeInt32LE(0x110, 0x104);
  const dynamicAt = 0x210;
  const tags = [
    [4, 0x300], [5, 0x800], [6, 0x400], [7, 0xa00], [8, 24], [9, 24],
    [10, 0x100], [11, 24], [23, 0xa18], [2, 24], [0, 0]
  ];
  for (let i = 0; i < tags.length; i++) {
    buffer.writeBigUInt64LE(BigInt(tags[i][0]), dynamicAt + i * 16);
    buffer.writeBigUInt64LE(BigInt(tags[i][1]), dynamicAt + i * 16 + 8);
  }
  buffer.writeUInt32LE(1, 0x300);
  buffer.writeUInt32LE(3, 0x304);
  const names = ['', '_ZN2nn2vi10InitializeEv', '_ZN2nn2nn3hid15GetNpadStyleSetERKj'];
  let nameAt = 0;
  names.forEach((name, i) => {
    buffer.writeUInt32LE(nameAt, 0x400 + i * 24);
    buffer.writeUInt8(0, 0x404 + i * 24);
    buffer.writeUInt16LE(0, 0x406 + i * 24);
    buffer.write(name, 0x800 + nameAt, 'ascii');
    nameAt += name.length + 1;
  });
  // RELA entry: r_offset, (symbol << 32) | R_AARCH64_JUMP_SLOT, addend.
  buffer.writeBigUInt64LE(BigInt(slot), 0xa00);
  buffer.writeBigUInt64LE((1n << 32n) | 1026n, 0xa08);
  buffer.writeBigUInt64LE(0n, 0xa10);
  // A second entry in DT_JMPREL for the HID import.
  buffer.writeBigUInt64LE(BigInt(slot + 0x250), 0xa18);
  buffer.writeBigUInt64LE((2n << 32n) | 1026n, 0xa20);
  buffer.writeBigUInt64LE(0n, 0xa28);
  return buffer;
}

test('discovers import slots from MOD0 relocations', async () => {
  const slot = 0x9c9770;
  const buffer = makeModule(slot);
  const rpc = fakeRpc(buffer);
  const module = await readModule(rpc, BASE);
  assert.equal(module.imports.get('_ZN2nn2vi10InitializeEv')[0].slot, slot);
  assert.equal(module.imports.get('_ZN2nn2nn3hid15GetNpadStyleSetERKj')[0].slot, slot + 0x250);
  const {slots} = await resolveSlots(rpc, BASE,
    ['_ZN2nn2vi10InitializeEv', '_ZN2nn2nn3hid15GetNpadStyleSetERKj']);
  assert.deepEqual(slots, {'_ZN2nn2vi10InitializeEv': slot,
    '_ZN2nn2nn3hid15GetNpadStyleSetERKj': slot + 0x250});
});

test('falls back to the static table when MOD0 cannot be read', async () => {
  const rpc = {a: {}, async read() {throw Error('no module');}};
  const fallback = {name: {slot: 0x1234}};
  const {module, slots} = await resolveSlots(rpc, BASE, ['name'], fallback);
  assert.equal(module, null);
  assert.deepEqual(slots, {name: 0x1234});
});

test('locates a PLT thunk for a discovered slot', async () => {
  const pltOffset = 0x29c1f0, slotOffset = 0x9c9770;
  const buffer = Buffer.alloc(0x300000);
  Buffer.from('703900b011ba43f910c21d9120021fd6', 'hex').copy(buffer, pltOffset);
  const rpc = fakeRpc(buffer);
  const ranges = await executableRanges(rpc, BASE, BASE + buffer.length);
  assert.equal(ranges.length, 1);
  assert.equal(inRanges(ranges, BASE + pltOffset), true);
  const thunk = await findPlt(rpc, ranges, BASE + slotOffset);
  assert.equal(thunk.address, BASE + pltOffset);
  assert.equal(thunk.bytes.toString('hex'), '703900b011ba43f910c21d9120021fd6');
  assert.equal(decodePltSlot(thunk.bytes, 0, BASE + pltOffset), BASE + slotOffset);
});
