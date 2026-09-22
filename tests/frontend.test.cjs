const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../v3/app.js'),'utf8');
function setup(fail=false){
 const state={identityRevision:0}, writes=[];
 const auth={currentUser:null,authStateReady:async()=>{}};
 const els={openClassBtn:{dataset:{}}};
 const context=vm.createContext({state,auth,els,db:{},Date,
 signInAnonymously:async()=>{auth.currentUser={uid:'anonymous-test'};},
 doc:(_,collection,id)=>({collection,id}),serverTimestamp:()=>123,
 setDoc:async(ref,data)=>{if(fail)throw new Error('quota');writes.push({ref,data});}});
 vm.runInContext(source.slice(source.indexOf('async function ensureTeacherCanOpenClassroom()'),source.indexOf('async function ensureStudentCanJoinClassroom(')),context);
 return {state,auth,writes,open:()=>context.ensureTeacherCanOpenClassroom()};
}
test('unauthorized teacher cannot open a classroom',async()=>{
 const app=setup(); await assert.rejects(app.open(), /授權密碼/); assert.equal(app.writes.length,0);
});

test('authorized teacher uses existing identity',async()=>{
 const app=setup(); app.auth.currentUser={uid:"anonymous-test"}; app.state.teacherAuthorizedUid="anonymous-test"; app.state.teacherAuthorizedUntil=Date.now()+60000; await app.open();
 assert.equal(app.state.teacherRole,'guest');assert.equal(app.state.teacherEmail,'anonymous-test@guest.invalid');
 assert.equal(app.writes.length,0);
});
test('changing identity invalidates authorization',async()=>{
 const app=setup();app.state.teacherAuthorizedUid='old';app.state.teacherAuthorizedUntil=Date.now()+60000;app.auth.currentUser={uid:'another'};await assert.rejects(app.open(), /授權密碼/);
 assert.equal(app.writes.length,0);
});

test('expired authorization cannot open',async()=>{const app=setup();app.auth.currentUser={uid:'old'};app.state.teacherAuthorizedUid='old';app.state.teacherAuthorizedUntil=Date.now()-1;await assert.rejects(app.open(), /授權密碼/);});
