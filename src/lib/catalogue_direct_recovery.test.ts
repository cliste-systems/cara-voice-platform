import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCatalogueDirect} from './catalogue_direct_recovery.js';
import {postSearchSupervaluProducts} from './voice_api.js';
test('database recovery checks organisation access and keeps verified offer facts when the app gateway fails',async()=>{
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CLISTE_APP_URL','CLISTE_VOICE_WEBHOOK_SECRET'] as const;
 const previous=keys.map(k=>process.env[k]);const fetchBefore=globalThis.fetch;
 Object.assign(process.env,{SUPABASE_URL:'https://catalogue-test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-key',CLISTE_APP_URL:'https://failed-gateway.invalid',CLISTE_VOICE_WEBHOOK_SECRET:'test-secret'});
 const now=new Date();const day=now.toISOString().slice(0,10);let active=true;let catalogueReads=0;
 const offer={id:'offer-1',organization_id:null,retail_banner:'supervalu',product_name:'Cobra Beer Bottle (660 ml)',department:'Lager',current_price_eur:3,was_price_eur:3.8,discount_label:'Rewards Price Only €3',price_per_unit:null,sku:'verified-sku',offer_week_start:day,offer_week_end:day,search_text:'cobra beer bottle lager',synced_at:now.toISOString(),service_area:'off_licence',fulfilment:'prepack',offer_channel:'prepack',is_national:true,is_alcohol:true,national_store_count:4};
 globalThis.fetch=async(input)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url.startsWith('https://failed-gateway.invalid'))throw new TypeError('Gateway unavailable');
  const table=new URL(url).pathname.split('/').at(-1);
  const data=table==='phone_numbers'?[{organization_id:'org-1'}]:table==='organizations'?[{is_active:active,niche:'retail',retail_banner:'supervalu',offers_synced_at:now.toISOString(),catalog_synced_at:now.toISOString(),retail_source_store_id:null}]:table==='retail_weekly_offers'?[offer]:[];
  if(table==='retail_weekly_offers')catalogueReads++;
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 };
 try{
  const payload={called_number:'+353749759508',query:'Cobra Beer Bottle 660 ml',intent:'offer' as const};
  const result=await postSearchSupervaluProducts(payload);
  assert.equal(result.ok,true);assert.equal(result.recoveryUsed,true);assert.equal(result.matches[0]?.sku,'verified-sku');assert.equal(result.matches[0]?.current_price_eur,3);
  const before=catalogueReads;active=false;
  const denied=await readCatalogueDirect<{ok:boolean;code:string}>(payload,new AbortController().signal);
  assert.equal(denied.res.status,403);assert.equal(denied.body.code,'org_suspended');assert.equal(catalogueReads,before,'suspended organisation cannot reach catalogue reads');
 }finally{globalThis.fetch=fetchBefore;keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});}
});
