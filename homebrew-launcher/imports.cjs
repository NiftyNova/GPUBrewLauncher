// Discover application imports from the running module instead of trusting
// build-specific PLT/GOT offsets. SmileBASIC demo and retail builds share the
// SDK but place the application text and import table differently.
'use strict';

const MAX_MODULE = 0x10000000;
const CHUNK = 0x80000;
const check = (value, message) => {if (!value) throw Error(message);};

async function readModule(rpc, base, maxOffset = MAX_MODULE) {
  check(Number.isSafeInteger(base) && base > 0, 'Invalid module base');
  check(Number.isInteger(maxOffset) && maxOffset > 0 && maxOffset <= MAX_MODULE, 'Invalid module bound');
  const header = await rpc.read(base, 8);
  const mod = base + header.readUInt32LE(4);
  check(mod >= base && mod < base + maxOffset, 'Invalid MOD0 location');
  const modHeader = await rpc.read(mod, 8);
  check(modHeader.toString('ascii', 0, 4) === 'MOD0', 'Missing MOD0');
  const dynamic = await rpc.read(mod + modHeader.readInt32LE(4), 0x1000);
  const tags = new Map();
  for (let at = 0; at < dynamic.length; at += 16) {
    const tag = Number(dynamic.readBigUInt64LE(at));
    if (!tag) break;
    const value = Number(dynamic.readBigUInt64LE(at + 8));
    check(Number.isSafeInteger(value), 'Invalid dynamic entry');
    tags.set(tag, value);
  }
  const relative = value => {
    check(Number.isSafeInteger(value) && value > 0 && value < maxOffset, 'Invalid table offset');
    return base + value;
  };
  check(tags.get(11) === 24, 'Unexpected symbol entry size');
  const hash = await rpc.read(relative(tags.get(4)), 8);
  const count = hash.readUInt32LE(4);
  const stringSize = tags.get(10);
  check(count > 0 && count < 200000 && stringSize > 0 && stringSize < 0x800000,
    'Invalid symbol table bounds');
  const table = await rpc.read(relative(tags.get(6)), count * 24);
  const strings = await rpc.read(relative(tags.get(5)), stringSize);
  const symbols = [];
  for (let i = 0; i < count; i++) {
    const at = i * 24, nameOffset = table.readUInt32LE(at);
    if (!nameOffset || nameOffset >= strings.length) {symbols.push(null); continue;}
    const end = strings.indexOf(0, nameOffset);
    if (end < 0) {symbols.push(null); continue;}
    symbols.push({name: strings.toString('utf8', nameOffset, end),
      type: table[at + 4] & 15, binding: table[at + 4] >> 4,
      section: table.readUInt16LE(at + 6),
      offset: Number(table.readBigUInt64LE(at + 8)),
      size: Number(table.readBigUInt64LE(at + 16))});
  }

  const imports = new Map();
  async function addRelocations(offsetTag, sizeTag, entrySize) {
    const offset = tags.get(offsetTag), size = tags.get(sizeTag);
    if (!offset || !size) return;
    check(size > 0 && size < 0x8000000 && size % entrySize === 0,
      'Invalid relocation table');
    const bytes = await rpc.read(relative(offset), size);
    for (let at = 0; at + entrySize <= bytes.length; at += entrySize) {
      const rawOffset = Number(bytes.readBigUInt64LE(at));
      const info = bytes.readBigUInt64LE(at + 8);
      const symbolIndex = Number(info >> 32n);
      if (!symbolIndex) continue;
      const symbol = symbols[symbolIndex];
      if (!symbol || !symbol.name) continue;
      let slot = rawOffset;
      if (rawOffset >= base && rawOffset < base + maxOffset) slot = rawOffset - base;
      check(slot > 0 && slot < maxOffset, 'Invalid import slot');
      const entries = imports.get(symbol.name) || [];
      if (!entries.some(entry => entry.slot === slot)) entries.push({slot, type: Number(info & 0xffffffffn)});
      imports.set(symbol.name, entries);
    }
  }
  // AArch64 modules normally use RELA for both GLOB_DAT and JUMP_SLOT.
  await addRelocations(7, 8, 24);
  await addRelocations(23, 2, 24);
  return {base, textEnd: mod - base, symbols, imports};
}

async function resolveSlots(rpc, base, names, fallback = {}) {
  let module;
  try {module = await readModule(rpc, base);}
  catch (error) {module = null;}
  const slots = {};
  for (const name of names) {
    const entries = module?.imports.get(name);
    if (entries?.length) slots[name] = entries[0].slot;
    else if (fallback?.[name] && Number.isInteger(fallback[name].slot)) slots[name] = fallback[name].slot;
    else throw Error('Missing application import: ' + name);
  }
  return {module, slots};
}

async function executableRanges(rpc, base, end) {
  check(Number.isSafeInteger(base) && base > 0, 'Invalid module base');
  check(Number.isSafeInteger(end) && end > base, 'Invalid module end');
  const ranges = [];
  let address = base;
  for (let guard = 0; address < end && guard < 256; guard++) {
    const region = await rpc.query(address);
    check(Number.isSafeInteger(region.address) && Number.isSafeInteger(region.size) &&
      region.size > 0, 'Invalid memory map');
    const next = region.address + region.size;
    check(next > address, 'Memory map did not advance');
    if ((region.permissions & 5) === 5 && !region.ipcReferences)
      ranges.push({address: region.address, size: region.size});
    address = next;
  }
  return ranges;
}

function inRanges(ranges, address) {
  return ranges.some(range => address >= range.address && address < range.address + range.size);
}

function decodePltSlot(bytes, at, pc) {
  if (at + 16 > bytes.length) return null;
  const adrp = bytes.readUInt32LE(at), load = bytes.readUInt32LE(at + 4);
  const add = bytes.readUInt32LE(at + 8), branch = bytes.readUInt32LE(at + 12);
  if (((adrp & 0x9f000000) >>> 0) !== 0x90000000 || (adrp & 0x1f) !== 16) return null;
  if (((load & 0xffc00000) >>> 0) !== 0xf9400000 || (load & 0x1f) !== 17 ||
      ((load >>> 5) & 0x1f) !== 16) return null;
  if (((add & 0xffc00000) >>> 0) !== 0x91000000 || (add & 0x1f) !== 16 ||
      ((add >>> 5) & 0x1f) !== 16) return null;
  if (branch !== 0xd61f0220) return null;
  const low = ((load >>> 10) & 0xfff) * 8;
  if (((add >>> 10) & 0xfff) !== low) return null;
  let immediate = (((adrp >>> 5) & 0x7ffff) << 2) | ((adrp >>> 29) & 3);
  if (immediate & (1 << 20)) immediate -= 1 << 21;
  const page = Math.floor(pc / 0x1000) * 0x1000;
  return page + immediate * 0x1000 + low;
}

async function findPlt(rpc, ranges, slotAddress) {
  for (const region of ranges) {
    for (let at = 0; at < region.size; at += CHUNK - 16) {
      const size = Math.min(CHUNK, region.size - at);
      const bytes = await rpc.read(region.address + at, size);
      for (let i = 0; i + 16 <= bytes.length; i += 4) {
        if (decodePltSlot(bytes, i, region.address + at + i) === slotAddress)
          return {address: region.address + at + i, bytes: Buffer.from(bytes.subarray(i, i + 16))};
      }
    }
  }
  return null;
}

module.exports = {readModule, resolveSlots, executableRanges, inRanges, decodePltSlot, findPlt};
