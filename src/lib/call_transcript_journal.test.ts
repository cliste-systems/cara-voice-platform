import assert from 'node:assert/strict';
import {it} from 'node:test';
import {CallTranscriptJournal,assessStoredTranscriptCapture,type TranscriptSourceEvent} from './call_transcript_journal.js';
const complete={complete:true,reasons:[],callerLineCount:1,assistantLineCount:2};
it('retries the exact source sequence after an ambiguous write failure without losing new events',async()=>{
 const saved=new Map<number,TranscriptSourceEvent>(); let fail=true; let expected=0;
 const journal=new CallTranscriptJournal({async start(){},async heartbeat(){},async write(events){for(const e of events)saved.set(e.seq,e);if(fail){fail=false;throw new Error('response lost after commit');}},async finish(n){expected=n;}});
 journal.record('gpt_live_transcript_delta','assistant','Hello ');
 await assert.rejects(journal.flush());
 journal.record('gpt_live_transcript_delta','assistant','there');
 journal.record('caller_stt_final','caller','Hi');
 assert.equal(await journal.close(complete,null),true);
 assert.deepEqual([...saved.keys()],[1,2,3]); assert.equal(expected,3);
 assert.equal(saved.get(1)?.text,'Hello ');
});
it('retains events arriving during an in-flight write and verifies them before closing',async()=>{
 let release!:()=>void; const barrier=new Promise<void>(r=>release=r);const saved:number[]=[];let calls=0;let expected=0;
 const journal=new CallTranscriptJournal({async start(){},async heartbeat(){},async write(events){if(++calls===1)await barrier;saved.push(...events.map(x=>x.seq));},async finish(n){expected=n;}});
 journal.record('caller_stt_final','caller','one');const flushing=journal.flush();await Promise.resolve();await Promise.resolve();
 journal.record('gpt_live_transcript_delta','assistant','two');release();await flushing;
 assert.equal(await journal.close(complete,'call-id'),true);assert.deepEqual(saved,[1,2]);assert.equal(expected,2);
});

it('verifies positive unique stored sequence continuity and both speakers', () => {
 const valid={expectedEventCount:4,persistedEventCount:4,lastSequence:4,callerEventCount:1,assistantEventCount:2,transcriptComplete:true};
 assert.equal(assessStoredTranscriptCapture(valid).status,'captured');
 assert.equal(assessStoredTranscriptCapture({...valid,persistedEventCount:3}).sequenceContinuous,false);
 assert.equal(assessStoredTranscriptCapture({...valid,lastSequence:5}).sequenceContinuous,false);
 assert.equal(assessStoredTranscriptCapture({...valid,expectedEventCount:0,persistedEventCount:0,lastSequence:null}).status,'partial');
 assert.equal(assessStoredTranscriptCapture({...valid,assistantEventCount:0}).status,'partial');
 assert.equal(assessStoredTranscriptCapture({...valid,callerEventCount:0}).status,'partial');
 assert.equal(assessStoredTranscriptCapture({...valid,transcriptComplete:false}).status,'partial');
});
it('exposes capture evidence only after storage finalization acknowledges it',async()=>{
 const evidence=assessStoredTranscriptCapture({expectedEventCount:2,persistedEventCount:2,lastSequence:2,callerEventCount:1,assistantEventCount:1,transcriptComplete:true});
 const journal=new CallTranscriptJournal({async start(){},async heartbeat(){},async write(){},async finish(){return evidence;}});
 journal.record('caller_stt_final','caller','Hello');
 journal.record('gpt_live_transcript_delta','assistant','How can I help?');
 assert.equal(journal.captureEvidence(),null);
 assert.equal(await journal.close(complete,'call-id'),true);
 assert.deepEqual(journal.captureEvidence(),evidence);
 const returned=journal.captureEvidence()!;returned.status='partial';
 assert.equal(journal.captureEvidence()?.status,'captured');
});
