/** Actual production backend prompt/model; text-only, not GPT-Live audio proof. */
import 'dotenv/config';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import OpenAI from 'openai';
import {GPT_LIVE_RETAIL_BACKEND_INSTRUCTIONS} from '../src/lib/gpt_live_retail.js';
import {departmentClarification} from '../src/lib/department_clarification.js';
import {evaluateTextRehearsalExpectations} from '../src/lib/text_rehearsal.js';
const departments=['Fruit & Vegetables','Bakery','Meat & Poultry','Fish & Seafood','Deli Counter','Cheese','Milk, Yogurt, Butter & Eggs','Health & Wellness','Chilled Food','Food Cupboard','Frozen Foods','Drinks','Beauty & Personal Care','Baby','Household & Cleaning','Pets','Wine, Beer & Spirits','Newsagent & Tobacconist'];
const model=process.env.CARA_GPT_LIVE_BACKEND_MODEL?.trim()||'gpt-5.6-luna';
const client=new OpenAI({timeout:30000,maxRetries:1});
const output=`call-transcripts/retail-backend-evaluation-${randomUUID()}`;
await mkdir(output,{recursive:true});
const results=[];
for(const {department,query} of departments.flatMap(department=>[
 {department,query:`Any offers in ${department}?`},
 {department,query:`Have ye got any deals in the ${department} section?`},
 {department,query:`What products are available in ${department}?`},
])){
 const failures:string[]=[];
 let assistant='';
 const tools=[];
 try{
  let response=await client.responses.create({model,instructions:GPT_LIVE_RETAIL_BACKEND_INSTRUCTIONS,max_output_tokens:500,input:query,tools:[{type:'function',name:'searchSuperValuProducts',description:'Look up supermarket products, offers and prices. Broad requests may require clarification.',strict:false,parameters:{type:'object',properties:{query:{type:'string'},intent:{type:'string'},service_area:{type:'string'},fulfilment:{type:'string'}},required:['query']}}]});
  const calls=response.output.filter(item=>item.type==='function_call');
  for(const call of calls){
   const args=JSON.parse(call.arguments);
   tools.push({name:call.name,args});
   const question=departmentClarification(String(args.query??''));
   if(!question)failures.push('backend selected a product before clarifying the broad department');
  }
  if(calls.length){
   response=await client.responses.create({model,instructions:GPT_LIVE_RETAIL_BACKEND_INSTRUCTIONS,previous_response_id:response.id,max_output_tokens:500,input:calls.map(call=>({type:'function_call_output' as const,call_id:call.call_id,output:JSON.stringify({ok:true,clarification_required:true,matches:[],message:departmentClarification(JSON.parse(call.arguments).query)||'Ask what kind of product the caller wants before selecting examples.'})}))});
  }
  assistant=response.output_text;
  if(!assistant.trim())failures.push('missing assistant reply');
  failures.push(...evaluateTextRehearsalExpectations({assistantLines:[assistant],toolCalls:tools,expect:{clarification:true,must_not_quote_prices:true}}));
  if((assistant.match(/\?/g)??[]).length>1)failures.push('more than one question in the reply');
 }catch(error){failures.push(error instanceof Error?error.message:'request failed');}
 results.push({department,caller:query,assistant,tools,failures,status:failures.length?'FAIL':'PASS'});
 console.log(JSON.stringify({department,status:failures.length?'FAIL':'PASS',failures}));
 await writeFile(`${output}/results.json`,JSON.stringify({model,layer:'backend-text-rehearsal',not_a_spoken_call:true,results},null,2));
}
console.log(JSON.stringify({model,layer:'backend-text-rehearsal',tested:results.length,failed:results.filter(r=>r.failures.length).length,output,not_a_spoken_call:true}));
process.exitCode=results.some(r=>r.failures.length)?1:0;
