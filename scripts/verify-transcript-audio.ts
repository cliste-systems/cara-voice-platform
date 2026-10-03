/** Internal WebRTC test only: no PSTN dial-out. Use synthetic WAV files. */
import 'dotenv/config';
import {readFileSync,writeFileSync} from 'node:fs';
import {Room,RoomEvent,AudioSource,AudioFrame,LocalAudioTrack,TrackPublishOptions,TrackSource,AudioStream} from '@livekit/rtc-node';
import {AccessToken,RoomServiceClient,AgentDispatchClient} from 'livekit-server-sdk';
import {createClient} from '@supabase/supabase-js';
const arg=(name:string)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
const line=arg('line');const first=arg('first-wav');const second=arg('second-wav');const third=arg('third-wav');
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
// A microphone keeps sending quiet audio between utterances. Without those
// frames VAD/STT can remain inside the previous speech segment indefinitely.
async function silence(ms:number){
 const until=Date.now()+ms;
 while(Date.now()<until){await source.captureFrame(new AudioFrame(new Int16Array(480),24000,1,480));await sleep(20);}
 await source.waitForPlayout();
}
function readPcm(path:string):Buffer {
 const wav=readFileSync(path);
 if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw new Error('Synthetic audio must be WAV');
 let offset=12;let pcm:Buffer|undefined;let formatValid=false;
 while(offset+8<=wav.length){
  const size=wav.readUInt32LE(offset+4),kind=wav.toString('ascii',offset,offset+4);
  if(offset+8+size>wav.length)throw new Error('Truncated WAV chunk');
  if(kind==='fmt '&&size>=16)formatValid=wav.readUInt16LE(offset+8)===1&&wav.readUInt16LE(offset+10)===1&&wav.readUInt32LE(offset+12)===24000&&wav.readUInt16LE(offset+22)===16;
  if(kind==='data')pcm=wav.subarray(offset+8,offset+8+size);
  offset+=8+size+(size%2);
 }
 if(!formatValid||!pcm?.length||pcm.length%2)throw new Error('Synthetic WAV must contain nonempty 24kHz mono PCM16 audio');
 return pcm;
}
async function play(path:string){const pcm=readPcm(path);for(let i=0;i<pcm.length;i+=960){const samples=new Int16Array(480);for(let n=0;n<480&&i+n*2+1<pcm.length;n++)samples[n]=pcm.readInt16LE(i+n*2);await source.captureFrame(new AudioFrame(samples,24000,1,480));}await source.waitForPlayout();}
// Validate all utterances before creating a room or consuming inference credits.
readPcm(first);readPcm(second);if(third)readPcm(third);
if(process.argv.includes('--validate-only')){console.log(JSON.stringify({phase:'audio_validated',utterances:third?3:2}));await source.close();process.exit(0);}

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
 await silence(14000);await play(second);console.log(JSON.stringify({phase:'second_question_sent'}));
 await silence(14000);
 if(third){await play(third);console.log(JSON.stringify({phase:'third_question_sent'}));await silence(14000);}
}finally{await room.disconnect();await source.close();await rooms.deleteRoom(roomName).catch(()=>{});}
console.log(JSON.stringify({phase:'disconnected',receivedFrames,roomName}));
writeFileSync('/private/tmp/cara-transcript-qa-room.json',JSON.stringify({roomName,receivedFrames}),{mode:0o600});
// Post-call finalization may include recording upload; wait for the source journal first.
for(let attempt=0;attempt<40;attempt++){
 const {data}=await db.from('call_transcript_captures').select('id,status,expected_events,persisted_events,call_log_id,completeness').eq('room_name',roomName).order('started_at',{ascending:false}).limit(1).maybeSingle();
 if(data&&data.status!=='recording'){console.log(JSON.stringify({phase:'capture_verified',...data}));process.exit(data.status==='captured'&&receivedFrames>0&&data.completeness?.callerLineCount>=(third?3:2)&&data.completeness?.assistantLineCount>=(third?4:3)?0:1);}
 await sleep(1000);
}
throw new Error('Capture did not finalize within test window');
