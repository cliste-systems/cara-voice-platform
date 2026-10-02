/** Worker adapter: same server-only credentials, bounded cancellable reads. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';
export const catalogueReadSignal = new AsyncLocalStorage<AbortSignal>();
export function createAdminClient() {
  const url=process.env.SUPABASE_URL?.trim();
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(!url||!key)throw new Error('Direct catalogue recovery is not configured');
  const signal=catalogueReadSignal.getStore();
  if(typeof globalThis.WebSocket==='undefined')globalThis.WebSocket=WebSocket as unknown as typeof globalThis.WebSocket;
  return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false},global:{fetch:(input,init)=>{
    const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
    headers.set('Connection','close');
    const requestUrl=new URL(input instanceof Request?input.url:String(input));
    // A coalesced public refresh may serve several callers. Cancelling its
    // first caller must not cancel the other callers' shared source read.
    const publicRefresh=(requestUrl.pathname.endsWith('/retail_weekly_offers')&&(requestUrl.searchParams.get('organization_id')==='is.null'||requestUrl.searchParams.get('is_national')==='eq.true')) ||
      (requestUrl.pathname.endsWith('/retail_catalog_products')&&requestUrl.searchParams.get('is_national')==='eq.true');
    const deadline=AbortSignal.timeout(8000);
    // Honour the handler's shorter query deadline (notably optional assortment
    // enrichment). Replacing it with the adapter deadline could make a
    // one-second best-effort read hold the entire offer reply for eight seconds.
    const querySignal=init?.signal??(input instanceof Request?input.signal:undefined);
    const signals=[deadline,...(querySignal?[querySignal]:[]),...(signal&&!publicRefresh?[signal]:[])];
    return fetch(input,{...init,headers,signal:AbortSignal.any(signals)});
  }}});
}
