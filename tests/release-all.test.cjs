const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../v3/app.js'),'utf8');
function setup({admin=true,confirm=true,changed=false,fail=false}={}){
 const rows=[{id:'A',status:'active',sessionId:'a'},{id:'B',status:'waiting',sessionId:'b'},{id:'C',status:'released',sessionId:'c'}];
 const updates=[];let reads=0;const els={releaseAllClassroomsBtn:{disabled:false},adminStatus:{}};
 const context=vm.createContext({state:{adminAccess:admin},els,db:{},collection:()=>0,serverTimestamp:()=>1,
 confirm:()=>confirm,getDocs:async()=>{reads++;return {docs:rows.map(row=>({id:row.id,ref:row.id,data:()=>row}))};},
 runTransaction:async(_,fn)=>fn({get:async ref=>({exists:()=>true,data:()=>({...rows.find(row=>row.id===ref),...(changed&&ref==='A'?{sessionId:'new'}:{})})}),update:(ref,data)=>{if(fail&&ref==='B')throw Error('offline');updates.push({ref,data});}}),loadAdminClassrooms:async()=>{}});
 vm.runInContext(source.slice(source.indexOf('async function releaseAllClassrooms()'),source.indexOf('async function loadAdminClassrooms()')),context);
 return {run:()=>context.releaseAllClassrooms(),updates,els,reads:()=>reads};
}
test('admin releases unreleased rooms only and retains all other data',async()=>{const a=setup();await a.run();assert.deepEqual(a.updates.map(x=>x.ref),['A','B']);for(const x of a.updates)assert.deepEqual(Object.keys(x.data).sort(),['releasedAt','status','updatedAt']);assert.equal(a.els.releaseAllClassroomsBtn.disabled,false);});
test('non-admin and cancelled confirmation perform no updates',async()=>{const a=setup({admin:false});await a.run();assert.equal(a.reads(),0);const b=setup({confirm:false});await b.run();assert.equal(b.updates.length,0);});
test('new classroom session is not released by old confirmation',async()=>{const a=setup({changed:true});await a.run();assert.deepEqual(a.updates.map(x=>x.ref),['B']);assert.match(a.els.adminStatus.textContent,/略過/);});
test('partial failure identifies the failed code and restores button',async()=>{const a=setup({fail:true});await a.run();assert.match(a.els.adminStatus.textContent,/釋放失敗：B/);assert.equal(a.els.releaseAllClassroomsBtn.disabled,false);});
