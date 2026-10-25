import assert from 'node:assert/strict';
import test from 'node:test';
import { reservePublicDemoSession } from './public_demo_session.js';

const input = { organizationId: '00000000-0000-4000-8000-000000000001', roomName: 'synthetic-demo-room', isDemoLine: true, isSipCall: true };
const accepted = () => ({ data: { allowed: true, expires_at: new Date(Date.now()+480_000).toISOString() }, error: null });

test('customer and browser calls never contact the aggregate demo limiter', async () => {
  for (const call of [{ ...input, isDemoLine: false }, { ...input, isSipCall: false }]) {
    assert.deepEqual(await reservePublicDemoSession(call, () => { throw new Error('must not call'); }), { allowed: true });
  }
});

test('aggregate admission uses a stable tenant-scoped session hash and deduplicates concurrent release', async () => {
  const requests: Array<{ name: string; args: Record<string,string> }> = [];
  const rpc = async (name: string, args: Record<string,string>) => {
    requests.push({name,args}); return name === 'reserve_public_demo_session' ? accepted() : { data: null, error: null };
  };
  const result = await reservePublicDemoSession(input,rpc);
  assert.equal(result.allowed,true);
  if (!result.allowed || !result.lease) throw new Error('Expected lease');
  assert.ok(result.lease.expiresAtMs > Date.now());
  assert.deepEqual(await Promise.all([result.lease.release(),result.lease.release(),result.lease.release()]),[true,true,true]);
  assert.equal(await result.lease.release(),true);
  assert.equal(requests.length,2);
  assert.deepEqual(requests[0]?.args,requests[1]?.args);
  assert.match(requests[0]!.args.p_session_key!,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(requests),/synthetic-demo-room/);
});

test('denial, invalid expiry, expired reservations and transport failures do not start a demo', async () => {
  for (const reason of ['busy','daily_limit','ended'] as const) {
    assert.deepEqual(await reservePublicDemoSession(input,async()=>({data:{allowed:false,reason},error:null})),{allowed:false,reason});
  }
  for (const data of [null,{}, {allowed:'true'}, {allowed:true}, {allowed:true,expires_at:'invalid'},
    {allowed:true,expires_at:new Date(Date.now()-1).toISOString()},
    {allowed:true,expires_at:new Date(Date.now()+3600_000).toISOString()}]) {
    assert.deepEqual(await reservePublicDemoSession(input,async()=>({data,error:null})),{allowed:false,reason:'unavailable'});
  }
  assert.deepEqual(await reservePublicDemoSession(input,async()=>{throw new Error('private error');}),{allowed:false,reason:'unavailable'});
});

test('failed release retries are bounded and can be retried later without retaining a rejected promise', async () => {
  let releases=0;
  const result=await reservePublicDemoSession(input,async(name)=>{
    if(name==='reserve_public_demo_session')return accepted();
    releases++;
    return {data:null,error:releases<=2?new Error('synthetic outage'):null};
  });
  if(!result.allowed||!result.lease)throw new Error('Expected lease');
  assert.equal(await result.lease.release(),false);
  assert.equal(releases,2);
  assert.equal(await result.lease.release(),true);
  assert.equal(releases,3);
});
