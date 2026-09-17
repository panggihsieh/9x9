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
test('personal classroom signs in anonymously without credential database writes',async()=>{
 const app=setup();await app.open();
 assert.equal(app.state.teacherRole,'guest');assert.equal(app.state.teacherEmail,'anonymous-test@guest.invalid');
 assert.equal(app.writes.length,0);
});
test('existing identity is reused without session database writes',async()=>{
 const app=setup();await app.open();app.auth.currentUser={uid:'another'};await app.open();
 assert.equal(app.state.teacherEmail,'another@guest.invalid');assert.equal(app.writes.length,0);
});
