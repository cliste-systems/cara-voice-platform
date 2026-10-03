/** Synthetic customer conversations against the demo's gateway model and real retail tool.
 * Reports stay in ignored call-transcripts. This does not test audible delivery. */
import 'dotenv/config';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {llm, initializeLogger} from '@livekit/agents';
import {createCaraLlm} from '../src/lib/llm_provider.js';
import {buildCaraCallPrompt} from '../src/lib/cara_prompt.js';
import {classifyCallerLine} from '../src/lib/phone_classify.js';
import {CaraTools} from '../src/lib/cara_tools.js';
import {trackCallerCatalogSearchIntent} from '../src/lib/catalog_search_intent.js';
initializeLogger({pretty:false,level:'error'});
const path=process.argv[2];if(!path)throw Error('Supply synthetic scenarios JSON path');
const scenarios=JSON.parse(readFileSync(path,'utf8'));
const directory=process.argv[3]??'call-transcripts/deli-gateway';mkdirSync(directory,{recursive:true});
const model=process.env.DELI_TEST_MODEL??'google/gemma-4-31b-it';
const prompt=buildCaraCallPrompt({businessName:'Kavanaghs SuperValu Donegal Town',customPrompt:'Answer retail enquiries using verified tools. Never invent stock, allergens or counter promotions.',callerLine:classifyCallerLine('+353870000001'),routingLinks:[],orgTimeZone:'Europe/Dublin',nowUtcIso:new Date().toISOString(),todayLocal:new Date().toISOString().slice(0,10),niche:'retail',businessType:'Retail & Grocery',openingGreetingDelivered:true,conversationalRetailMode:true,naturalConversationStyle:true});
const tool=new CaraTools().searchSuperValuProducts;
const previous:any[]=process.env.DELI_TEST_RESUME==='1'&&existsSync(`${directory}/results.json`)?JSON.parse(readFileSync(`${directory}/results.json`,'utf8')).results:[];
// Keep failed attempts separately; resume only the unfinished/failed cases.
if(previous.length)writeFileSync(`${directory}/prior-attempts-${Date.now()}.json`,JSON.stringify(previous,null,2));
const results:any[]=previous.filter(x=>!x.failures.length);
const completed=new Set(results.map(x=>x.id));
let creditBlocked=false;
let nextRequestAt=Date.now()+Number(process.env.DELI_TEST_START_DELAY_MS??0);
async function pace(){const now=Date.now();const wait=Math.max(0,nextRequestAt-now);nextRequestAt=Math.max(now,nextRequestAt)+Number(process.env.DELI_TEST_REQUEST_INTERVAL_MS??1250);if(wait)await new Promise(resolve=>setTimeout(resolve,wait));}
async function run(s:any){
 const provider=createCaraLlm({inferenceLlmModel:model,profileLlmProvider:'gateway',temperature:0.4,maxCompletionTokens:Number(process.env.DELI_TEST_MAX_TOKENS??280)}).instance;
 let gatewayError:Error|undefined;
 provider.on('error',(event:any)=>{if(!event.recoverable)gatewayError=event.error;});
 const chat=llm.ChatContext.empty();chat.addMessage({role:'system',content:prompt});
 const flags:any={};const context:any={ctx:{userData:{organizationId:'e79ac0f3-28ac-4b9d-a9b3-80095819ae30',calledNumber:'+353749759508',sessionFlags:flags},session:{currentAgent:{}}}};
 const conversation:any[]=[];const failures:string[]=[];
 try { for(let turn=0;turn<s.turns.length;turn++){
  const caller=s.turns[turn];trackCallerCatalogSearchIntent(caller,flags);chat.addMessage({role:'user',content:caller});
  const lookups:any[]=[];const responses:any[]=[];let answer='';
  for(let round=0;round<5;round++){
   await pace();gatewayError=undefined;
   const response=await provider.chat({chatCtx:chat,toolCtx:{searchSuperValuProducts:tool},connOptions:{maxRetry:1,retryIntervalMs:500,timeoutMs:20000}}).collect();
   if(gatewayError)throw gatewayError;
   responses.push({text:response.text,toolCallCount:response.toolCalls.length,usage:response.usage,extra:response.extra});
   if(response.text){answer+=response.text;chat.addMessage({role:'assistant',content:response.text});}
   if(!response.toolCalls.length)break;
   for(const call of response.toolCalls){
    chat.insert(call);if(call.name!=='searchSuperValuProducts')throw Error('Unexpected tool '+call.name);
    const args=tool.parameters.parse(JSON.parse(call.args));const start=Date.now();const body=await tool.execute(args,context) as any;
    lookups.push({args,elapsed_ms:Date.now()-start,body});chat.insert(new llm.FunctionCallOutput({callId:call.callId,name:call.name,output:JSON.stringify(body),isError:false}));
    if(body.ok===false)failures.push(`turn ${turn+1}: failed lookup`);
   }
   if(round===4)failures.push(`turn ${turn+1}: tool loop`);
  }
  conversation.push({caller,answer,lookups,responses});
  if(!answer.trim())failures.push(`turn ${turn+1}: empty reply`);
  const check=s.checks?.[turn]??{};
  if(check.lookup&&!lookups.some(x=>!x.body.clarification_required))failures.push(`turn ${turn+1}: no completed lookup`);
  if(check.order_request&&!/first name|check|confirm|availability/i.test(answer))failures.push(`turn ${turn+1}: neither checks availability nor captures an order request`);
  if(check.no_current_offer&&lookups.some(x=>x.body.matches?.some((m:any)=>m.is_on_offer)))failures.push(`turn ${turn+1}: withdrew offer or different variant presented as current`);
  if(check.minimum_matches&&lookups.flatMap(x=>x.body.matches??[]).length<check.minimum_matches)failures.push(`turn ${turn+1}: missing verified department examples`);
  if(s.expected&&turn===s.turns.length-1&&!lookups.some(x=>x.body.matches?.some((m:any)=>String(m.sku)===String(s.expected.sku))))failures.push(`turn ${turn+1}: exact sampled product not retrieved`);
  if(check.clarify&&(lookups.some(x=>x.body.matches?.length)||/\beuro\b|€|\b(?:two|three|four|five) for\b/i.test(answer)))failures.push(`turn ${turn+1}: products or prices before clarification`);
  if(check.future&&!/cannot|can't|not (?:yet )?(?:available|published)|only.*current/i.test(answer))failures.push(`turn ${turn+1}: future offer not identified as unverified`);
  if(check.future&&lookups.some(x=>x.body.matches?.length))failures.push(`turn ${turn+1}: current offers substituted for future ones`);
  if(check.safety&&/team follows|strict food|we follow|safe to eat|guarantee.{0,20}safe/i.test(answer))failures.push(`turn ${turn+1}: unsupported safety guarantee or procedure`);
  if(check.clarify&&!answer.includes('?'))failures.push(`turn ${turn+1}: missing clarification`);
  if(check.no_preference_question&&/what (?:sort|kind|type)|anything (?:else|in particular).*looking|would you like me to (?:see|check|look)|(?:were|are) you (?:looking|after)/i.test(answer))failures.push(`turn ${turn+1}: repeated preference/permission question`);
  if(check.scope&&lookups.some(x=>x.args.service_area&&x.args.service_area!==check.scope))failures.push(`turn ${turn+1}: wrong model scope`);
  if(check.counter&&lookups.some(x=>x.args.fulfilment==='prepack'))failures.push(`turn ${turn+1}: wrong fulfilment`);
  if(/that (?:does not|doesn.t) mean there (?:are|aren.t|aren’t)/i.test(answer))failures.push(`turn ${turn+1}: robotic disclaimer`);
 }}catch(error){const message=error instanceof Error?error.message:String(error);failures.push(message);if(/MaxGatewayCredits|token credit quota exceeded/i.test(message))creditBlocked=true;}
 finally{await provider.aclose();}
 results.push({...s,conversation,failures});writeFileSync(`${directory}/results.json`,JSON.stringify({model,layer:'gateway-answer-model-and-live-tools',not_spoken_audio:true,results},null,2));
 console.log(JSON.stringify({id:s.id,failures}));
}
let next=0;await Promise.all(Array.from({length:Number(process.env.DELI_TEST_CONCURRENCY??3)},async()=>{for(;;){const scenario=scenarios[next++];if(!scenario||creditBlocked)return;if(completed.has(scenario.id))continue;await run(scenario);}}));
console.log(JSON.stringify({total:results.length,failed:results.filter(x=>x.failures.length).length,creditBlocked,pending:scenarios.length-results.length}));if(results.some(x=>x.failures.length))process.exitCode=1;
