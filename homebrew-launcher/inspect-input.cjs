// Resolve input imports afresh for the connected console session. SmileBASIC
// binds HID imports lazily, so an import that Direct mode has not used yet still
// points at the module's resolver stub. Call its PLT entry once to bind it.
// Import slots and PLT entries are discovered from the live module, so demo and
// retail builds with different application layouts are both supported.
const fs = require('node:fs/promises');
const path = require('node:path');
const {resolveSlots, executableRanges, inRanges, findPlt} = require('./imports.cjs');

const WARM_OFFSET = 0x4ff00;
const WARM_BYTES = 0x30100;
const WARM_BUFFER_OFFSET = 0x50000;
const WARM_ID_OFFSET = 0x4ff00;
const PAD = '_ZN2nn3hid12GetNpadStateEPNS0_17NpadHandheldStateERKj';
const TOUCH = '_ZN2nn3hid19GetTouchScreenStateILm16EEEvPNS0_16TouchScreenStateIXT_EEE';

async function resolveImport(rpc, codeRanges, slot, args, name) {
  const address = rpc.a.main + slot;
  let target = Number((await rpc.read(address, 8)).readBigUInt64LE());
  if (!inRanges(codeRanges, target)) return {target};
  const plt = await findPlt(rpc, codeRanges, address);
  if (!plt) throw Error('Could not locate the PLT entry for ' + name);
  // call-address only accepts functions whose exact instructions were checked.
  await rpc.request({command: 'verify-function', address: plt.address,
    hex: plt.bytes.toString('hex')});
  await rpc.callAddress(plt.address, args);
  target = Number((await rpc.read(address, 8)).readBigUInt64LE());
  if (!Number.isSafeInteger(target) || !target || inRanges(codeRanges, target))
    throw Error('Import did not resolve: ' + name);
  return {target, plt: plt.address};
}

async function main(directory) {
  directory = path.resolve(directory);
  const rpc = require(path.join(directory, 'shared/rpc.cjs'));
  const imports = require('./input-imports.json');
  const report = {session: rpc.a.session, started: new Date().toISOString(), imports: {}};
  const saveBase = rpc.a.scratch + WARM_OFFSET;
  const buffer = rpc.a.scratch + WARM_BUFFER_OFFSET;
  const id = rpc.a.scratch + WARM_ID_OFFSET;
  const saved = await rpc.read(saveBase, WARM_BYTES);
  try {
    const names = Object.keys(imports);
    const {slots, module} = await resolveSlots(rpc, rpc.a.main, names, imports);
    const end = module?.textEnd > 0 ? rpc.a.main + module.textEnd :
      (rpc.a.sdk > rpc.a.main ? rpc.a.sdk : rpc.a.main + 0x10000000);
    const codeRanges = await executableRanges(rpc, rpc.a.main, end);
    const idBytes = Buffer.alloc(4);
    idBytes.writeUInt32LE(32);
    await rpc.write(id, idBytes);
    for (const name of names) {
      const slot = slots[name];
      const address = rpc.a.main + slot;
      let target = Number((await rpc.read(address, 8)).readBigUInt64LE());
      if (!Number.isSafeInteger(target) || !target)
        throw Error('Invalid input import: ' + name);
      let plt;
      if (inRanges(codeRanges, target)) {
        if (name === PAD || name === TOUCH) {
          const resolved = await resolveImport(rpc, codeRanges, slot,
            name === PAD ? [buffer, id] : [buffer], name);
          target = resolved.target;
          plt = resolved.plt;
        } else {
          report.imports[name] = {slot, target, unresolved: true};
          continue;
        }
      }
      const region = await rpc.query(target);
      if ((region.permissions & 5) !== 5 || region.ipcReferences)
        throw Error('Input import is not in executable memory: ' + name);
      const bytes = await rpc.read(target, Math.min(256, region.address + region.size - target));
      report.imports[name] = {slot, target, region, bytes: bytes.toString('hex'), ...(plt ? {plt} : {})};
    }
    for (const name of [PAD, TOUCH])
      if (!report.imports[name].bytes) throw Error('Required input import unresolved: ' + name);
    report.completed = new Date().toISOString();
    await fs.writeFile(path.join(directory, 'input-inspection.json'), JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600});
    console.log('Resolved input imports for ' + rpc.a.session);
  } finally {
    await rpc.write(saveBase, saved).catch(() => {});
  }
}
if (require.main === module) main(process.argv[2]).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
