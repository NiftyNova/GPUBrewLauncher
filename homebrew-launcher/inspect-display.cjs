// Read-only capture of the display imports used by the running application.
// Import slots are discovered from the application's own MOD0/dynamic tables,
// so demo and retail SmileBASIC builds with different text layouts both work.
// In particular, do not invoke SDK GetService: it has a hidden x8 return ABI.
const fs = require('node:fs/promises');
const path = require('node:path');
const imports = require('./display-imports.json');
const {resolveSlots, executableRanges, inRanges} = require('./imports.cjs');

async function main(directory) {
  directory = path.resolve(directory);
  const rpc = require(path.join(directory, 'shared/rpc.cjs'));
  const report = {session: rpc.a.session, started: new Date().toISOString(), imports: {}};
  const save = () => fs.writeFile(path.join(directory, 'display-inspection.json'),
    JSON.stringify(report, null, 2), {mode: 0o600});
  try {
    const names = Object.keys(imports);
    const {slots, module} = await resolveSlots(rpc, rpc.a.main, names, imports);
    const end = module?.textEnd > 0 ? rpc.a.main + module.textEnd :
      (rpc.a.sdk > rpc.a.main ? rpc.a.sdk : rpc.a.main + 0x10000000);
    const codeRanges = await executableRanges(rpc, rpc.a.main, end);
    for (const name of names) {
      const slot = slots[name];
      const target = Number((await rpc.read(rpc.a.main + slot, 8)).readBigUInt64LE());
      if (!Number.isSafeInteger(target) || !target) throw Error('Invalid import address: ' + name);
      const region = await rpc.query(target);
      if ((region.permissions & 5) !== 5) throw Error('Import is not executable: ' + name);
      // An unresolved import still points at the application's binder stub.
      const unresolved = inRanges(codeRanges, target);
      if (unresolved && name === 'nvnBootstrapLoader')
        throw Error('nvnBootstrapLoader is unresolved');
      report.imports[name] = {slot, target, unresolved, region};
      if (!unresolved) {
        const size = Math.min(0x1000, region.address + region.size - target);
        await fs.writeFile(path.join(directory, name + '.bin'), await rpc.read(target, size), {mode: 0o600});
      }
      await save();
    }
    // Only interpret this global after matching the implementation that loads it.
    const reference = require('../smilebasic/reference/sdk-checks.cjs');
    const offset = 0x3d8200;
    const implementation = await rpc.read(rpc.a.sdk + offset, 32);
    if (!implementation.equals(reference.bytes(offset,32)))
      throw Error('SDK GetService implementation changed');
    report.sdkService = Number((await rpc.read(rpc.a.sdk + 0xd9ef88, 8)).readBigUInt64LE());
    report.sdkServiceIsNull = report.sdkService === 0;
    report.completed = new Date().toISOString();
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally { await save(); }
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main(process.argv[2]).catch(error => {
  console.error(error.stack); process.exitCode = 1;
});
module.exports = {main};
