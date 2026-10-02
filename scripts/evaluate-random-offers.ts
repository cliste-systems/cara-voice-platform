/** Production answer model + real lookup endpoint. This is NOT an audio/call test. */
import 'dotenv/config';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import OpenAI from 'openai';
import {llm} from '@livekit/agents';
import {CaraTools} from '../src/lib/cara_tools.js';
import {trackCallerCatalogSearchIntent} from '../src/lib/catalog_search_intent.js';
import {GPT_LIVE_RETAIL_BACKEND_INSTRUCTIONS} from '../src/lib/gpt_live_retail.js';
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
const results:any[]=[];
for(const scenario of scenarios){
 const failures:string[]=[];const toolResults:any[]=[];let assistant='';
 const flags:Parameters<typeof trackCallerCatalogSearchIntent>[1]={};trackCallerCatalogSearchIntent(scenario.turns[0],flags);
 const context={ctx:{userData:{organizationId:'e79ac0f3-28ac-4b9d-a9b3-80095819ae30',calledNumber:'+353749759508',sessionFlags:flags},session:{currentAgent:{}}}} as unknown as Parameters<typeof productionTool.execute>[1];
 try{
  let response=await client.responses.create({model,instructions:GPT_LIVE_RETAIL_BACKEND_INSTRUCTIONS,input:scenario.turns[0],tools,max_output_tokens:750});
  for(let round=0;round<4;round++){
   const calls=response.output.filter(x=>x.type==='function_call');if(!calls.length)break;
   const outputs=[];
   for(const call of calls){const args=JSON.parse(call.arguments);const started=Date.now();const body=await productionTool.execute(args,context) as any;toolResults.push({name:call.name,args,elapsed_ms:Date.now()-started,body});if(body.ok===false)failures.push('lookup failed: '+body.message);outputs.push({type:'function_call_output' as const,call_id:call.call_id,output:JSON.stringify(body)});}
   response=await client.responses.create({model,instructions:GPT_LIVE_RETAIL_BACKEND_INSTRUCTIONS,previous_response_id:response.id,input:outputs,tools,max_output_tokens:750});
  }
  assistant=response.output_text;
  if(!assistant.trim())failures.push('missing assistant reply');
  failures.push(...evaluateTextRehearsalExpectations({assistantLines:[assistant],toolCalls:toolResults.map(x=>({name:x.name,args:x.args})),expect:scenario.expect}));
  if(scenario.expected_offer){
   if(!toolResults.length)failures.push('product answer without lookup');
   const matches=toolResults.flatMap(x=>x.body.matches||[]);
   const expected=scenario.expected_offer;
   if(!matches.some(m=>String(m.sku)===String(expected.sku)||String(m.product_name||m.productName||'').toLowerCase()===expected.product_name.toLowerCase()))failures.push('sampled current offer not returned');
   if(toolResults.some(x=>x.body.clarification_required)) { /* Honest disambiguation assessed in review. */ }
  }
  if(/\brewards\b|\bloyalty\b|\bmembers?[- ]only\b/i.test(assistant) && toolResults.length && !toolResults.some(x=>(x.body.matches||[]).some((m:any)=>/\brewards\b|\bloyalty\b|\bmembers?\b/i.test(`${m.discount_label||''} ${m.quote_text||''}`))))failures.push('invented membership condition');
  if(/\*\*|^#+\s/m.test(assistant))failures.push('Markdown in spoken reply');
  if(/that (?:does not|doesn.t) mean there (?:are|aren.t|aren’t)/i.test(assistant))failures.push('repetitive uncertainty disclaimer');
 }catch(e){failures.push(e instanceof Error?e.message:String(e));}
 results.push({...scenario,assistant,toolResults,failures,status:failures.length?'FAIL':'REVIEW'});
 await writeFile(output,JSON.stringify({model,endpoint:base,layer:'production-backend-and-live-lookup',not_a_spoken_call:true,results},null,2));
 console.log(JSON.stringify({name:scenario.name,status:failures.length?'FAIL':'REVIEW',failures}));
}
console.log(JSON.stringify({total:results.length,automatic_failures:results.filter(x=>x.failures.length).length,output,review_required:true}));
