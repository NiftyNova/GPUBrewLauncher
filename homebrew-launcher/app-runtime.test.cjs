const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {create}=require('./app-runtime.cjs');
test('Rescan, load, return, cache, removal and version reload use package data',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hb-runtime-test-')),root=path.join(directory,'apps');await fs.mkdir(root);
 await fs.cp(path.resolve(__dirname,'../apps/hello-world'),path.join(root,'hello-world'),{recursive:true});
 const capacity=8*1024*1024,memory=Buffer.alloc(capacity+4096),mapped=0x100000;memory.writeUInt32LE(1,112);memory.writeUInt32LE(1,1020);
 const rpc={a:{session:'test-session'},async read(p,n){assert.ok(p>=mapped&&p+n<=mapped+memory.length);return Buffer.from(memory.subarray(p-mapped,p-mapped+n));},async write(p,b){assert.ok(p>=mapped&&p+b.length<=mapped+memory.length);b.copy(memory,p-mapped);}};
 const prepared=[],menu={catalog:{root},controls:{mapped,bytes:capacity},commands:[['11','12','13']]};
 const runtime=await create({rpc,menu,directory,prepareApp:async(r,m,app)=>{prepared.push({id:app.id,bytes:app.files.compute.bytes.length});return {ready:true,scratchRestored:true,commands:[['21','22','23']],...(app.files.memory?{privateStorage:{mapped:mapped+capacity,bytes:4096}}:{})};}});
 assert.equal(memory.readUInt32LE(112),1);assert.equal(runtime.report.catalog.apps[0].name,'Hello World');
 memory.writeUInt32LE(1,1012);assert.deepEqual(await runtime.afterBatch(),['21','22','23']);assert.equal(runtime.active.app.id,'hello-world');assert.equal(prepared.length,1);assert.equal(memory.readFloatLE(960),1);
 let audio=JSON.parse(await fs.readFile(path.join(directory,'game-audio-source.json')));assert.equal(audio.package.id,'hello-world');
 memory.writeUInt32LE(1,1016);assert.deepEqual(await runtime.afterBatch(),menu.commands[0]);assert.equal(runtime.active,null);assert.equal(memory.readFloatLE(964),0);
 memory.writeUInt32LE(1,1012);await runtime.afterBatch();assert.equal(prepared.length,1);memory.writeUInt32LE(1,1016);await runtime.afterBatch();
 const manifest=path.join(root,'hello-world/app.json'),m=JSON.parse(await fs.readFile(manifest));m.version='1.0.1';m.name='Changed App';m.transition='none';await fs.writeFile(manifest,JSON.stringify(m));
 m.memory={bytes:4096,initial:'assets/private.bin',encoding:'deflate'};await fs.writeFile(path.join(root,'hello-world/assets/private.bin'),require('node:zlib').deflateSync(Buffer.alloc(4096,7)));await fs.writeFile(manifest,JSON.stringify(m));
 memory.writeFloatLE(memory.readFloatLE(104)+1,104);await runtime.afterBatch();assert.equal(runtime.report.catalog.apps[0].name,'Changed App');
 memory.writeUInt32LE(1,1012);await runtime.afterBatch();assert.equal(prepared.length,2);assert.equal(memory.readFloatLE(960),0);memory.writeUInt32LE(1,1016);await runtime.afterBatch();assert.equal(memory.readFloatLE(960),1);assert.equal(memory.readFloatLE(964),0);
 assert.ok(memory.subarray(capacity).every(v=>v===7));memory.fill(9,capacity);memory.writeUInt32LE(1,1012);await runtime.afterBatch();assert.ok(memory.subarray(capacity).every(v=>v===7));assert.equal(prepared.length,2);memory.writeUInt32LE(1,1016);await runtime.afterBatch();
 await fs.rename(path.join(root,'hello-world'),path.join(root,'.removed'));memory.writeFloatLE(memory.readFloatLE(104)+1,104);await runtime.afterBatch();assert.equal(memory.readUInt32LE(112),0);assert.equal(memory.readFloatLE(96),0);
 assert.equal(runtime.report.transitions.filter(e=>e.event==='launch').length,4);
});
test('Changed/broken packages return to a usable menu instead of dispatching',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hb-runtime-fail-')),root=path.join(directory,'apps');await fs.mkdir(root);await fs.cp(path.resolve(__dirname,'../apps/hello-world'),path.join(root,'hello-world'),{recursive:true});
 const memory=Buffer.alloc(8*1024*1024),rpc={a:{session:'test'},read:async(p,n)=>Buffer.from(memory.subarray(p,p+n)),write:async(p,b)=>{b.copy(memory,p);}};
 const menu={catalog:{root},controls:{mapped:0,bytes:memory.length},commands:[['1']]};let dispatched=false;
 const runtime=await create({rpc,menu,directory,prepareApp:async()=>{dispatched=true;throw Error('Must not run');}});
 await fs.writeFile(path.join(root,'hello-world/app.comp.spv'),Buffer.alloc(20));memory.writeUInt32LE(1,1012);assert.deepEqual(await runtime.afterBatch(),['1']);assert.equal(dispatched,false);assert.equal(memory.readUInt32LE(112),0);assert.equal(memory.readUInt32LE(92),1);assert.equal(runtime.active,null);
});
