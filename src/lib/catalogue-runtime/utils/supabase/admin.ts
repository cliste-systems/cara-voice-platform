/** Worker adapter: same server-only credentials, bounded cancellable reads. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createClient} from '@supabase/supabase-js';
export const catalogueReadSignal = new AsyncLocalStorage<AbortSignal>();
export function createAdminClient() {
  const url=process.env.SUPABASE_URL?.trim();
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(!url||!key)throw new Error('Direct catalogue recovery is not configured');
  const signal=catalogueReadSignal.getStore();
  return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false},global:{fetch:(input,init)=>{
    const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
    headers.set('Connection','close');
    return fetch(input,{...init,headers,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
  }}});
}
