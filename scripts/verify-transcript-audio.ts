/** Internal WebRTC test only: no PSTN dial-out. Use synthetic WAV files. */
import 'dotenv/config';
import {readFileSync,writeFileSync} from 'node:fs';
import {Room,RoomEvent,AudioSource,AudioFrame,LocalAudioTrack,TrackPublishOptions,TrackSource,AudioStream} from '@livekit/rtc-node';
import {AccessToken,RoomServiceClient,AgentDispatchClient} from 'livekit-server-sdk';
import {createClient} from '@supabase/supabase-js';
const arg=(name:string)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
const line=arg('line');const first=arg('first-wav');const second=arg('second-wav');
if(!line||!first||!second)throw new Error('Require --line, --first-wav and --second-wav. Synthetic audio only.');
const url=process.env.LIVEKIT_URL!;const key=process.env.LIVEKIT_API_KEY!;const secret=process.env.LIVEKIT_API_SECRET!;
const host=url.replace(/^wss:/,'https:');
const rooms=new RoomServiceClient(host,key,secret);const dispatch=new AgentDispatchClient(host,key,secret);
const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const roomName=`admin-demo-transcript-qa-${Date.now()}`;
const metadata=JSON.stringify({phone_number:line,caller_number:'+353870000001',source:'admin_simulator'});
const token=new AccessToken(key,secret,{identity:'transcript-qa',name:'[smoke test] Transcript capture',ttl:'10m'});
token.addGrant({roomJoin:true,room:roomName,canPublish:true,canSubscribe:true});
const room=new Room();const source=new AudioSource(24000,1);let receivedFrames=0;
room.on(RoomEvent.TrackSubscribed,(track)=>{if(track.kind===1){void(async()=>{for await(const _frame of new AudioStream(track))receivedFrames++;})().catch(()=>{});}});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function play(path:string){const wav=readFileSync(path);let offset=12;let pcm:Buffer|undefined;while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}if(!pcm)throw new Error('WAV data missing');for(let i=0;i<pcm.length;i+=960){const samples=new Int16Array(480);for(let n=0;n<480&&i+n*2+1<pcm.length;n++)samples[n]=pcm.readInt16LE(i+n*2);await source.captureFrame(new AudioFrame(samples,24000,1,480));}await source.waitForPlayout();}
try{
 await rooms.createRoom({name:roomName,metadata,emptyTimeout:60,departureTimeout:20});
 await room.connect(url,await token.toJwt());
 await room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack('synthetic-caller',source),new TrackPublishOptions({source:TrackSource.SOURCE_MICROPHONE}));
 await dispatch.createDispatch(roomName,process.env.LIVEKIT_AGENT_NAME||'cliste-voice-node',{metadata});
 console.log(JSON.stringify({phase:'connected',roomName}));
 let ready = false;
 for (let attempt=0;attempt<60;attempt++) {
   const {data:capture}=await db.from('call_transcript_captures').select('id').eq('room_name',roomName).order('started_at',{ascending:false}).limit(1).maybeSingle();
   if(capture){const {count}=await db.from('call_transcript_events').select('seq',{count:'exact',head:true}).eq('capture_id',capture.id).eq('source','formatted_turn').eq('speaker','assistant');if((count??0)>0){ready=true;break;}}
   await sleep(1000);
 }
 if(!ready)throw new Error('Greeting did not finish before synthetic caller timeout');
 await sleep(1500);await play(first);console.log(JSON.stringify({phase:'first_question_sent'}));
 await sleep(14000);await play(second);console.log(JSON.stringify({phase:'second_question_sent'}));
 await sleep(14000);
}finally{await room.disconnect();await source.close();await rooms.deleteRoom(roomName).catch(()=>{});}
console.log(JSON.stringify({phase:'disconnected',receivedFrames,roomName}));
writeFileSync('/private/tmp/cara-transcript-qa-room.json',JSON.stringify({roomName,receivedFrames}),{mode:0o600});
// Post-call finalization may include recording upload; wait for the source journal first.
for(let attempt=0;attempt<40;attempt++){
 const {data}=await db.from('call_transcript_captures').select('id,status,expected_events,persisted_events,call_log_id,completeness').eq('room_name',roomName).order('started_at',{ascending:false}).limit(1).maybeSingle();
 if(data&&data.status!=='recording'){console.log(JSON.stringify({phase:'capture_verified',...data}));process.exit(data.status==='captured'&&receivedFrames>0&&data.completeness?.callerLineCount>=2&&data.completeness?.assistantLineCount>=3?0:1);}
 await sleep(1000);
}
throw new Error('Capture did not finalize within test window');
