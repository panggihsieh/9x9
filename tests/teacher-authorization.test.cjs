const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('v3/app.js','utf8');
function setup(rejectGrant=false){
 const nodes={}; const node=id=>nodes[id] ||= {value:'',disabled:false,textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}};
 const state={teacherAuthorizedUid:'',teacherAuthorizedUntil:0},writes=[];
 const auth={currentUser:{uid:'teacher'},authStateReady:async()=>{}};
 const context=vm.createContext({document:{querySelector:node},state,auth,db:{},Date,setInterval(){},
 updateTeacherAccessUi(){node('#openClassBtn').disabled=!state.teacherAuthorizedUid;},
 doc:(_,collection,id)=>({collection,id}),serverTimestamp:()=>123,
 setDoc:async(ref,data)=>{writes.push({ref,data});if(rejectGrant&&data.authorizedAt)throw {code:'permission-denied'};},
 databaseError:()=> 'network error'});
 vm.runInContext(source.slice(source.indexOf('// Authorization codes'),source.indexOf('async function loadTeacherPasswords()')),context);
 return {node,state,writes,submit:()=>node('#teacherAuthorizationForm').listeners.submit({preventDefault(){}})};
}
test('leading-zero authorization succeeds and enables opening only after server accepts',async()=>{
 const app=setup();app.node('#teacherAuthorizationPin').value='0123';await app.submit();
 assert.equal(app.state.teacherAuthorizedUid,'teacher');assert.equal(app.node('#openClassBtn').disabled,false);
 assert.equal(app.writes[1].data.code,'0123');assert.equal(app.node('#teacherAuthorizationPin').value,'');
 assert.equal(app.writes[0].data.revoked,true);
});
test('invalid code keeps opening disabled and restores login controls',async()=>{
 const app=setup(true);app.node('#teacherAuthorizationPin').value='0123';await app.submit();
 assert.equal(app.state.teacherAuthorizedUid,'');assert.equal(app.node('#openClassBtn').disabled,true);
 assert.equal(app.node('#teacherAuthorizeBtn').disabled,false);assert.equal(app.node('#teacherAuthorizationPin').disabled,false);
});
test('non-four-digit input never reaches database',async()=>{
 const app=setup();app.node('#teacherAuthorizationPin').value='123';await app.submit();assert.equal(app.writes.length,0);
});
test('editing or logging out disables further classroom opening',async()=>{
 const app=setup();app.node('#teacherAuthorizationPin').value='0123';await app.submit();
 app.node('#teacherAuthorizationPin').listeners.input();assert.equal(app.node('#openClassBtn').disabled,true);
 await app.node('#teacherAuthorizationLogout').listeners.click();assert.equal(app.writes.at(-1).data.revoked,true);
});
