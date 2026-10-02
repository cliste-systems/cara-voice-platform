/** Production answer model + real lookup endpoint. This is NOT an audio/call test. */
import 'dotenv/config';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import OpenAI from 'openai';
import {llm} from '@livekit/agents';
import {CaraTools} from '../src/lib/cara_tools.js';
import {trackCallerCatalogSearchIntent} from '../src/lib/catalog_search_intent.js';
import {gptLiveRetailBackendInstructions} from '../src/lib/gpt_live_retail.js';
import {evaluateTextRehearsalExpectations} from '../src/lib/text_rehearsal.js';
const path=process.argv[2]||'call-transcripts/random-offers-50/scenarios.json';
const scenarios=JSON.parse(readFileSync(path,'utf8'));
const output=process.argv[3]||path.replace('scenarios.json','results.json');
const model=process.env.CARA_GPT_LIVE_BACKEND_MODEL?.trim()||'gpt-5.6-luna';
const base=process.env.OFFER_TEST_APP_URL||'https://app.hellocara.ie';
const secret=process.env.CLISTE_VOICE_WEBHOOK_SECRET;
if(!secret)throw Error('Missing webhook credential');
const client=new OpenAI({timeout:45000,maxRetries:1});
const productionTool=new CaraTools().searchSuperValuProducts;
const tools:OpenAI.Responses.Tool[]=[{type:'function',name:'searchSuperValuProducts',description:productionTool.description,strict:false,parameters:llm.toJsonSchema(productionTool.parameters) as Record<string,unknown>}];
process.env.CLISTE_APP_URL=base;
const results:any[]=process.env.OFFER_TEST_RESUME==='1' && existsSync(output) ? JSON.parse(readFileSync(output,'utf8')).results : [];
const completed=new Set(results.map(x=>x.name));
async function evaluateScenario(scenario:any){
 const failures:string[]=[];const toolResults:any[]=[];let assistant='';
 const flags:Parameters<typeof trackCallerCatalogSearchIntent>[1]={};
 const conversation:any[]=[];let previousResponseId:string|undefined;
 const context={ctx:{userData:{organizationId:'e79ac0f3-28ac-4b9d-a9b3-80095819ae30',calledNumber:'+353749759508',sessionFlags:flags},session:{currentAgent:{}}}} as unknown as Parameters<typeof productionTool.execute>[1];
 try{
  for(let turn=0;turn<scenario.turns.length;turn++){
  trackCallerCatalogSearchIntent(scenario.turns[turn],flags);
  const turnToolStart=toolResults.length;
  let response=await client.responses.create({model,instructions:gptLiveRetailBackendInstructions(),...(previousResponseId?{previous_response_id:previousResponseId}:{}),input:scenario.turns[turn],tools,max_output_tokens:750});
  for(let round=0;round<4;round++){
   const calls=response.output.filter(x=>x.type==='function_call');if(!calls.length)break;
   const outputs=[];
   for(const call of calls){const args=(productionTool.parameters as any).parse(JSON.parse(call.arguments));const started=Date.now();const body=await productionTool.execute(args,context) as any;toolResults.push({name:call.name,args,elapsed_ms:Date.now()-started,body});if(body.ok===false)failures.push('lookup failed: '+body.message);outputs.push({type:'function_call_output' as const,call_id:call.call_id,output:JSON.stringify(body)});}
   response=await client.responses.create({model,instructions:gptLiveRetailBackendInstructions(),previous_response_id:response.id,input:outputs,tools,max_output_tokens:750});
  }
  assistant=response.output_text;
  if(!assistant.trim())failures.push(`turn ${turn+1}: missing assistant reply`);
  const turnTools=toolResults.slice(turnToolStart);
  conversation.push({caller:scenario.turns[turn],assistant,toolResults:turnTools});
  previousResponseId=response.id;
  failures.push(...evaluateTextRehearsalExpectations({assistantLines:[assistant],toolCalls:turnTools.map(x=>({name:x.name,args:x.args})),expect:scenario.turn_expectations?.[turn]??(turn===scenario.turns.length-1?scenario.expect:{})}).map(x=>`turn ${turn+1}: ${x}`));
  const expected=scenario.turn_expected_products?.[turn]??(turn===scenario.turns.length-1?(scenario.expected_offer??scenario.expected_product):undefined);
  if(turn===scenario.turns.length-1 && scenario.expect?.minimum_matches && turnTools.flatMap(x=>x.body.matches||[]).length<scenario.expect.minimum_matches)failures.push('too few verified examples returned');
  if(expected){
   if(!turnTools.length)failures.push(`turn ${turn+1}: product answer without lookup`);
   const matches=turnTools.flatMap(x=>x.body.matches||[]);
   const identity=(name:string)=>name.toLowerCase().replace(/^supervalu\s+/,'');
   if(!matches.some(m=>String(m.sku)===String(expected.sku)||String(m.product_name||m.productName||'').toLowerCase()===expected.product_name.toLowerCase()||(
    // The live source may replace an own-brand alias during a sync. Accept
    // only the identical named product/pack with identical price and terms.
    identity(String(m.product_name||m.productName||''))===identity(expected.product_name)&&
    Number(m.current_price_eur)===Number(expected.current_price_eur)&&
    m.discount_label===expected.discount_label&&m.fulfilment===expected.fulfilment
   )))failures.push('sampled current offer not returned');
   if(toolResults.some(x=>x.body.clarification_required)) { /* Honest disambiguation assessed in review. */ }
  }
  const membershipClaim=assistant.split(/[.!?](?:\s|$)/).some((sentence:string)=>/\brewards\b|\bloyalty\b|\bmembers?[- ]only\b/i.test(sentence)&& !/\b(?:(?:does|do)(?:n[’']t| not)\s+(?:say|state|show|list|mention|require)|is(?:n[’']t| not)\s+(?:listed|marked)|(?:cannot|can[’']t|couldn[’']t|could not)\s+(?:confirm|see)|no\s+rewards?(?:[- ]card)?\s+(?:is\s+mentioned|(?:condition|requirement)(?:\s+or\s+card\s+requirement)?\s+(?:is\s+)?(?:shown|listed|stated|mentioned)))/i.test(sentence));
  if(membershipClaim && turnTools.length && !turnTools.some(x=>(x.body.matches||[]).some((m:any)=>/\brewards\b|\bloyalty\b|\bmembers?\b/i.test(`${m.discount_label||''} ${m.quote_text||''}`))))failures.push('invented membership condition');
  if(/\*\*|^#+\s/m.test(assistant))failures.push('Markdown in spoken reply');
  if(/\bSV\s*(?:&|and)\s*CT\b/i.test(assistant))failures.push('internal retailer codes read aloud');
  if(/that (?:does not|doesn.t) mean there (?:are|aren.t|aren’t)/i.test(assistant))failures.push('repetitive uncertainty disclaimer');
 }
 }catch(e){failures.push(e instanceof Error?e.message:String(e));}
 results.push({...scenario,assistant,conversation,toolResults,failures,status:failures.length?'FAIL':'REVIEW'});
 writeFileSync(output,JSON.stringify({model,endpoint:base,layer:'production-backend-and-live-lookup',not_a_spoken_call:true,results},null,2));
 console.log(JSON.stringify({name:scenario.name,status:failures.length?'FAIL':'REVIEW',failures}));
}
const pending=scenarios.filter((x:any)=>!completed.has(x.name));
const concurrency=Math.min(6,Math.max(1,Number(process.env.OFFER_TEST_CONCURRENCY)||1));
let next=0;
await Promise.all(Array.from({length:concurrency},async()=>{for(;;){const scenario=pending[next++];if(!scenario)return;await evaluateScenario(scenario);}}));
console.log(JSON.stringify({total:results.length,automatic_failures:results.filter(x=>x.failures.length).length,output,review_required:true}));
if(results.some(x=>x.failures.length))process.exitCode=1;
