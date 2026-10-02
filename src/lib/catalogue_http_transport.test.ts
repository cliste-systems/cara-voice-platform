import {test} from 'node:test';import assert from 'node:assert/strict';
import {catalogueFetch} from './catalogue_http_transport.js';
test('only known public catalogue hosts receive the scoped dispatcher; caller cancellation is preserved',async()=>{
 const original=globalThis.fetch;const calls:RequestInit[]=[];
 globalThis.fetch=async(_input,init)=>{calls.push(init??{});return new Response('{}');};
 try{const controller=new AbortController();await catalogueFetch('https://app.hellocara.ie/api/voice/search-supervalu-products',{signal:controller.signal});await catalogueFetch('https://rtoebbwzwxcnscsxghww.supabase.co/rest/v1/phone_numbers',{signal:controller.signal});await catalogueFetch('http://localhost:3001/test');await catalogueFetch('https://[::1]/test');assert.equal(calls[0]!.signal,controller.signal);assert.ok('dispatcher' in calls[0]!);assert.ok('dispatcher' in calls[1]!);assert.equal('dispatcher' in calls[2]!,false);assert.equal('dispatcher' in calls[3]!,false);}
 finally{globalThis.fetch=original;}
});
