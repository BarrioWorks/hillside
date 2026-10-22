import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {inventoryErrors}=await import(`${process.cwd()}/tools/pedestrian-inventory.mjs`);
const {sceneNames,uphillFiveHouseScene}=await import(`${process.cwd()}/tools/pedestrian-scenes.mjs`);
const root='docs/screenshots/pedestrian/final';
const fixturePath='docs/verification/pedestrian/scenes.json';
const scenes=JSON.parse(await readFile(fixturePath,'utf8'));
const names=[...sceneNames,'B-uphill-expansion'];
const files=[...(await readdir(root)).map(p=>`${root}/${p}`),'docs/verification/pedestrian/validation.json',fixturePath];
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const before=Object.fromEntries(await Promise.all(files.map(async p=>[p,await hash(p)])));
const source=(await readFile('tools/pedestrian-verify.mjs','utf8')).replace(/^import .*;\n/gm,'');
const run=new (Object.getPrototypeOf(async()=>{}).constructor)('assert','readFile','writeFile','inventoryErrors','sceneNames','console',source);
const extra={name:'B-uphill-expansion',snapshot:uphillFiveHouseScene(scenes.find(s=>s.name==='B-five-houses').snapshot)};
const results=[];
async function probe(name,mutate,expected=true,fixtureChange){
 let result,exception;
 const localScenes=structuredClone([...scenes,extra]);
 fixtureChange?.(localScenes);
 const read=async (p,encoding)=>{
  if(p===fixturePath)return JSON.stringify(localScenes);
  const value=await readFile(p,encoding);
  if(!p.endsWith('-report.json'))return value;
  const rows=JSON.parse(value); mutate?.(rows,p); return JSON.stringify(rows);
 };
 try{await run(assert,read,async(_p,value)=>{result=JSON.parse(value)},inventoryErrors,names,{log(){}})}catch(e){exception=e.message}
 assert.equal(result?.passed,expected,name);
 if(!expected)assert.match(exception,/Pedestrian rendering acceptance failed/);
 results.push({name,passed:result.passed,errors:result.scenes.filter(s=>s.errors.length).map(s=>({scene:s.name,errors:s.errors})),...(name==='control'?{scenes:result.scenes.map(s=>({name:s.name,passed:s.passed,tiles:s.tiles}))}:{})});
}
const eraser=r=>{r.pedestrian={nodes:[],edges:[],walkable:[],blocked:[],boundaries:[],failures:[],adjacency:{}};for(const k of Object.keys(r.geometry))r.geometry[k]=Array.isArray(r.geometry[k])?[]:0};
const edit=(q,r,fn)=>(rows,p)=>{if(p.endsWith('E-settlement-report.json'))fn(rows.find(x=>x.q===q&&x.r===r))};
await probe('control',null);
for(const [q,r] of [[2,0],[0,-2]]){
 await probe(`erase graph and geometry ${q},${r}`,edit(q,r,eraser),false);
 await probe(`erase only geometry ${q},${r}`,edit(q,r,row=>{for(const k of Object.keys(row.geometry))row.geometry[k]=Array.isArray(row.geometry[k])?[]:0}),false);
}
await probe('remove matched boundary contract',edit(0,-2,r=>r.pedestrian.boundaries=r.pedestrian.boundaries.filter(b=>b.side!==0)),false);
await probe('remove required crossing',edit(2,0,r=>r.pedestrian.nodes=r.pedestrian.nodes.filter(n=>!(n.kind==='crossing'&&n.location==='interior'&&n.side===1))),false);
await probe('change required crossing group',edit(2,0,r=>r.pedestrian.nodes.find(n=>n.kind==='crossing'&&n.location==='boundary'&&n.side===1).group=7),false);
await probe('change boundary group',edit(2,0,r=>r.pedestrian.boundaries.find(b=>b.side===1).group=7),false);
await probe('remove multiport intrinsic route',edit(2,0,r=>r.pedestrian.edges=r.pedestrian.edges.filter(e=>!e.interior)),false);
await probe('remove required matched adapter',edit(0,-2,r=>r.pedestrian.edges=r.pedestrian.edges.filter(e=>!(e.purpose.kind==='boundary'&&e.purpose.side===0))),false);
await probe('remove served open adapter', (rows,p)=>{if(p.endsWith('A-two-houses-report.json'))rows[0].pedestrian.edges=rows[0].pedestrian.edges.filter(e=>e.purpose.kind!=='boundary')},false);
await probe('remove walkable hex',edit(2,0,r=>r.pedestrian.walkable=[]),false);
for(const [q,r] of [[-1,2],[1,1]]){
 const fixture=scenes.find(s=>s.name==='E-settlement').snapshot.tiles.find(t=>t.q===q&&t.r===r);
 const report=JSON.parse(await readFile(`${root}/E-settlement-report.json`,'utf8')).find(t=>t.q===q&&t.r===r);
 assert.equal(report.pedestrian.edges.length,0); assert.equal(report.geometry.area,0);
 await probe(`isolated actual unused single open port ${q},${r}`,(rows,p)=>{if(p.endsWith('A-two-houses-report.json'))rows.splice(0,rows.length,report)},true,ss=>{ss.find(s=>s.name==='A-two-houses').snapshot.tiles=[fixture]});
}
await probe('missing matched neighbor bypasses no seam checks', (rows,p)=>{if(p.endsWith('E-settlement-report.json'))rows.splice(rows.findIndex(r=>r.q===1&&r.r===-2),1)},false,ss=>{const snapshot=ss.find(s=>s.name==='E-settlement').snapshot;snapshot.tiles=snapshot.tiles.filter(t=>!(t.q===1&&t.r===-2))});
const after=Object.fromEntries(await Promise.all(files.map(async p=>[p,await hash(p)])));
assert.deepEqual(after,before,'Captured reports and evidence must remain unchanged');
const output={results,capturedArtifactsUnchanged:true,artifactCount:files.length};
await writeFile('/tmp/barrio-pedestrian-verifier-review-probe.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
