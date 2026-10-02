import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogueDatabaseRead} from './catalogue_database_read.js';
const url='https://rtoebbwzwxcnscsxghww.supabase.co/rest/v1/organizations';
test('a stalled read is cancelled early and succeeds on one fresh attempt',async()=>{
 const original=globalThis.fetch;let reads=0;
 globalThis.fetch=async(_input,init)=>{if(++reads===2)return Response.json({verified:true});return new Promise((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});});};
 try{const keepAlive=setTimeout(()=>{},100);try{assert.deepEqual(await(await catalogueDatabaseRead(url,{},20)).json(),{verified:true});assert.equal(reads,2);}finally{clearTimeout(keepAlive);}}
 finally{globalThis.fetch=original;}
});
test('short caller/query cancellation is honoured without a second attempt',async()=>{
 const original=globalThis.fetch;let reads=0;const controller=new AbortController();
 globalThis.fetch=async()=>{reads++;controller.abort();throw new DOMException('Cancelled','AbortError');};
 try{await assert.rejects(catalogueDatabaseRead(url,{signal:controller.signal},20));assert.equal(reads,1);}
 finally{globalThis.fetch=original;}
});
test('writes and forbidden reads are never retried',async()=>{
 const original=globalThis.fetch;let reads=0;
 globalThis.fetch=async()=>{reads++;return new Response('',{status:403});};
 try{assert.equal((await catalogueDatabaseRead(url)).status,403);assert.equal((await catalogueDatabaseRead(url,{method:'POST'})).status,403);assert.equal(reads,2);}
 finally{globalThis.fetch=original;}
});
