/** Replays synthetic deli lookup cases; does not verify model replies or audio. */
import 'dotenv/config';
import {readFileSync,writeFileSync} from 'node:fs';
import {CaraTools} from '../src/lib/cara_tools.js';
import {trackCallerCatalogSearchIntent} from '../src/lib/catalog_search_intent.js';
const scenarios=JSON.parse(readFileSync(process.argv[2]!,'utf8'));
const reference=JSON.parse(readFileSync(process.argv[3]!,'utf8')).results;
const output=process.argv[4]!;const results:any[]=[];
const tool=new CaraTools().searchSuperValuProducts;
let next=0;
await Promise.all(Array.from({length:2},async()=>{for(;;){
 const s=scenarios[next++];if(!s)return;
 const previous=reference.find((x:any)=>x.id===s.id);const flags:any={};const checks:any[]=[];const failures:string[]=[];
 const context:any={ctx:{userData:{organizationId:'e79ac0f3-28ac-4b9d-a9b3-80095819ae30',calledNumber:'+353749759508',sessionFlags:flags},session:{currentAgent:{}}}};
 for(let turn=0;turn<s.turns.length;turn++){
  const caller=s.turns[turn];trackCallerCatalogSearchIntent(caller,flags);
  const saved=previous?.conversation?.[turn]?.lookups??[];
  const requests=saved.length?saved.map((x:any)=>x.args):[{query:caller.slice(0,240)}];
  for(const args of requests){
   const start=Date.now();const body:any=await tool.execute(args,context);checks.push({turn:turn+1,caller,args,elapsed_ms:Date.now()-start,body});
   if(!body.ok)failures.push(`turn ${turn+1}: lookup failed`);
  }
  const bodies=checks.filter(x=>x.turn===turn+1).map(x=>x.body);const expected=s.checks?.[turn]??{};
  if(expected.clarify&&!bodies.some(x=>x.clarification_required))failures.push(`turn ${turn+1}: missing clarification`);
  if(expected.minimum_matches&&!bodies.some(x=>(x.matches?.length??0)>=expected.minimum_matches))failures.push(`turn ${turn+1}: missing department examples`);
  if(expected.future&&bodies.some(x=>x.matches?.length))failures.push(`turn ${turn+1}: current offers substituted for future ones`);
  if(expected.no_current_offer&&bodies.some(x=>x.matches?.some((m:any)=>m.is_on_offer)))failures.push(`turn ${turn+1}: withdrawn/different offer`);
  if(s.expected&&turn===s.turns.length-1&&!bodies.some(x=>x.matches?.some((m:any)=>String(m.sku)===String(s.expected.sku))))failures.push(`turn ${turn+1}: exact product absent`);
 }
 results.push({id:s.id,kind:s.kind,checks,failures});writeFileSync(output,JSON.stringify({layer:'live-tool-replay-only',not_answer_model_verification:true,not_spoken_audio:true,results},null,2));console.log(JSON.stringify({id:s.id,failures}));
}}));
console.log(JSON.stringify({tested:results.length,failed:results.filter(x=>x.failures.length).length,lookups:results.flatMap(x=>x.checks).length}));if(results.some(x=>x.failures.length))process.exitCode=1;
