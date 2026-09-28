import 'dotenv/config';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {getSupabaseClient} from '../src/lib/supabase.js';
import {assessTranscriptCompleteness} from '../src/lib/transcript_completeness.js';
const arg=(name:string)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
const db=getSupabaseClient();
const callId=arg('call-id'); const orgId=arg('organization-id'); const captureId=arg('capture-id');
if(!callId&&!orgId&&!captureId) throw new Error('Pass --call-id, --capture-id, or --organization-id for the latest call.');
let call: Record<string, any>;
let captures: Record<string, any>[];
if(captureId){
  const {data: capture,error}=await db.from('call_transcript_captures').select('*').eq('id',captureId).single();if(error)throw error;
  captures=[capture];
  const linked=capture.call_log_id ? await db.from('call_logs').select('id,organization_id,room_name,created_at,transcript,transcript_review,duration_seconds,outcome,audio_storage_path').eq('id',capture.call_log_id).maybeSingle() : null;
  if(linked?.error)throw linked.error;
  call=linked?.data??{id:capture.id,organization_id:capture.organization_id,room_name:capture.room_name,created_at:capture.started_at,transcript:null,call_log_missing:true};
}else{
  let query=db.from('call_logs').select('id,organization_id,room_name,created_at,transcript,transcript_review,duration_seconds,outcome,audio_storage_path').order('created_at',{ascending:false}).limit(1);
  query=callId?query.eq('id',callId):query.eq('organization_id',orgId!);
  const {data,error}=await query.single();if(error)throw error;call=data;
  const {data:rows,error:ce}=await db.from('call_transcript_captures').select('*').eq('organization_id',call.organization_id).or(`call_log_id.eq.${call.id},room_name.eq.${call.room_name}`).order('started_at',{ascending:false});if(ce)throw ce;captures=rows??[];
}
const journals=[];
for(const capture of captures??[]){
 const events=[];
 for(let from=0;;from+=1000){const {data,error}=await db.from('call_transcript_events').select('*').eq('capture_id',capture.id).order('seq').range(from,from+999);if(error)throw error;events.push(...data);if(data.length<1000)break;}
 const contiguous=events.every((event,i)=>event.seq===i+1);
 journals.push({capture,events,contiguous,eventCountVerified:events.length===capture.expected_events});
}
const assessment=assessTranscriptCompleteness(call.transcript);
const rawTurns=journals.flatMap(j=>j.events.filter(e=>e.source==='formatted_turn').map(e=>({at:Number(e.metadata?.at??Date.parse(e.received_at)),seq:e.seq,text:e.text}))).sort((a,b)=>a.at-b.at||a.seq-b.seq);
const verified=assessment.complete&&journals.length>0&&journals.every(j=>j.capture.status==='captured'&&j.contiguous&&j.eventCountVerified);
const dir=resolve(arg('output')??join('call-transcripts',call.id));mkdirSync(dir,{recursive:true,mode:0o700});
writeFileSync(join(dir,'raw-events.json'),JSON.stringify({schemaVersion:1,call,journals,assessment,verified},null,2),{mode:0o600});
writeFileSync(join(dir,'raw-transcript.txt'),rawTurns.map(e=>e.text).join('\n\n'),{mode:0o600});
writeFileSync(join(dir,'review.md'),`# Call review ${call.id}\n\nTime: ${call.created_at}\n\nCapture: **${verified?'captured and event count verified':'PARTIAL / UNVERIFIED — do not invent missing speech'}**\n\n${assessment.reasons.join('\n')}\n\n## Readable transcript (redacted)\n\n${call.transcript??'(empty)'}\n\n## Source evidence\n\nSee raw-events.json for original provider text fragments, caller final transcripts, timestamps, interruptions, sequence IDs and capture health. Provider text describes generated speech; it is not proof every word reached the caller. Never substitute model reasoning, tool results or an AI summary for spoken dialogue. If partial, check the call recording and report the gap.\n`,{mode:0o600});
console.log(JSON.stringify({callId:call.id,verified,directory:dir,captures:journals.length}));
