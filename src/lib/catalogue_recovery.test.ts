import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hedgedCatalogueRead} from './catalogue_recovery.js';

test('a stalled primary read recovers without waiting for its timeout and cancels the loser',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let reads=0;let cancelled=false;
  const result=hedgedCatalogueRead(async(attempt,signal)=>{
    reads++;
    if(attempt===1)return 'verified fresh result';
    return new Promise<string>((_resolve,reject)=>signal.addEventListener('abort',()=>{
      cancelled=true;reject(new DOMException('Cancelled','AbortError'));
    },{once:true}));
  },()=>true);
  t.mock.timers.tick(2000);
  assert.equal(await result,'verified fresh result');
  assert.equal(reads,2);assert.equal(cancelled,true);
});

test('two unavailable reads fail once instead of retrying indefinitely',async()=>{
  let reads=0;
  await assert.rejects(hedgedCatalogueRead(async()=>{reads++;throw new DOMException('Timed out','AbortError');},()=>true),{name:'AbortError'});
  assert.equal(reads,2);
});

test('non-recoverable errors never launch a second request',async()=>{
  let reads=0;
  await assert.rejects(hedgedCatalogueRead(async()=>{reads++;throw Error('Invalid request');},()=>false),/Invalid request/);
  assert.equal(reads,1);
});
