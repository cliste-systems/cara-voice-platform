import {test} from 'node:test';import assert from 'node:assert/strict';
import {catalogueReadSignal,createAdminClient} from './catalogue-runtime/utils/supabase/admin.js';
test('cancelling one caller does not abort a shared public catalogue refresh; private reads still cancel',async()=>{
 const oldFetch=globalThis.fetch;const oldUrl=process.env.SUPABASE_URL;const oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://refresh-test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
 const signals:AbortSignal[]=[];
 globalThis.fetch=async(_input,init)=>{assert.equal(new Headers(init?.headers).get('Connection'),'close');signals.push(init!.signal!);return new Response('[]',{headers:{'Content-Type':'application/json'}});};
 try{
  const caller=new AbortController();
  const client=catalogueReadSignal.run(caller.signal,()=>createAdminClient());
  await client.from('retail_weekly_offers').select('*').is('organization_id',null);
  await client.from('retail_catalog_products').select('*').eq('is_national',true);
  await client.from('organizations').select('is_active').eq('id','test-org');
  caller.abort();
  assert.equal(signals[0]!.aborted,false,'shared national offer data remains usable by other callers');
  assert.equal(signals[1]!.aborted,false,'shared national product data remains usable by other callers');
  assert.equal(signals[2]!.aborted,true,'tenant access reads remain cancellable');
 }finally{globalThis.fetch=oldFetch;for(const[k,v]of[['SUPABASE_URL',oldUrl],['SUPABASE_SERVICE_ROLE_KEY',oldKey]]as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
