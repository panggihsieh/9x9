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
 vm.runInContext(source.slice(source.indexOf('function updateTeacherAccessUi()'),source.indexOf('async function saveTeacher(')),context);
 vm.runInContext(source.slice(source.indexOf('async function ensureTeacherCanOpenClassroom()'),source.indexOf('async function ensureStudentCanJoinClassroom(')),context);
 return {state,auth,writes,open:()=>context.ensureTeacherCanOpenClassroom()};
}
test('personal classroom creates guest session without credential fields',async()=>{
 const app=setup();await app.open();
 assert.equal(app.writes[0].data.role,'guest');assert.equal(app.writes[0].data.passcode,'');
 assert.equal(app.state.accessReady,true);assert.equal(app.state.teacherHasPriority,false);
});
test('existing guest session is reused; changing identity renews it',async()=>{
 const app=setup();await app.open();await app.open();assert.equal(app.writes.length,1);
 app.auth.currentUser={uid:'another'};await app.open();assert.equal(app.writes.length,2);
 assert.equal(app.writes[1].data.email,'another@guest.invalid');
});
test('failed session creation does not grant access',async()=>{
 const app=setup(true);await assert.rejects(app.open(),/quota/);assert.equal(app.state.accessReady,false);
});
