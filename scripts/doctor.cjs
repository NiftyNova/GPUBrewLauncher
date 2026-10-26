// Local dependency checks only. The Pico keyboard bridge is not used by this fork.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {tool}=require('./toolchain.cjs');const root=path.resolve(__dirname,'..');let failed=false;
function check(name,ok,fix){console.log((ok?'OK   ':'NEED ')+name+(ok?'':' — '+fix));if(!ok)failed=true;}
function runs(command,args){const r=spawnSync(command,args,{stdio:'ignore'});return !r.error&&r.status===0;}
check('Node.js 22+',Number(process.versions.node.split('.')[0])>=22,'Install Node.js 22 or newer');
check('Python 3 + Pillow',runs('python3',['-c','from PIL import Image,ImageDraw,ImageFont']),'Install python3 and python3-pil');
check('DejaVu Sans font',fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),'Install fonts-dejavu-core');
check('SPIR-V validator',runs(tool('SPIRV_VAL','spirv-val'),['--version']),'Install spirv-tools or set SPIRV_VAL');
for(const file of ['homebrew-launcher/shaders/launcher.comp.spv','homebrew-launcher/shaders/launcher.frag.spv','apps/hello-world/app.json'])check(file,fs.existsSync(path.join(root,file)),'Use the complete release archive');
if(process.argv.includes('--build'))check('GLSL compiler',runs(tool('GLSLANG','glslangValidator'),['--version']),'Install glslang-tools or set GLSLANG');
if(failed)process.exitCode=1;else console.log('Host checks passed. Console firmware, SmileBASIC version, the saved NS2 bootstrap and network reachability must be checked on the devices.');
