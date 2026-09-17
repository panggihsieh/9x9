import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveTeacherAccess,SUPER_ADMIN_EMAIL} from '../v3/teacher-access.js';
test('admin requires verified Google account and exact configured email',()=>{
 const user={email:SUPER_ADMIN_EMAIL,emailVerified:true,providerData:[{providerId:'google.com'}]};
 assert.equal(resolveTeacherAccess(user).role,'admin');
 assert.notEqual(resolveTeacherAccess({...user,emailVerified:false}).role,'admin');
 assert.notEqual(resolveTeacherAccess({...user,providerData:[]}).role,'admin');
 assert.notEqual(resolveTeacherAccess({...user,email:'someone@gmail.com'}).role,'admin');
 assert.notEqual(resolveTeacherAccess(null).role,'admin');
});
