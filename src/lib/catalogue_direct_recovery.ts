/** Executes the app's pinned read-only lookup handler without its HTTP gateway. */
import {catalogueReadSignal} from './catalogue-runtime/utils/supabase/admin.js';
import type {SearchSupervaluProductsPayload} from './voice_api.js';
export function directCatalogueRecoveryConfigured():boolean {
  return Boolean(process.env.SUPABASE_URL?.trim()&&process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}
export async function readCatalogueDirect<T>(payload:SearchSupervaluProductsPayload,signal:AbortSignal):Promise<{res:Response;body:T}> {
  const {POST}=await import('./catalogue-runtime/app/api/voice/search-supervalu-products/route.js');
  const request=new Request('https://cara-worker.invalid/catalogue-read',{method:'POST',headers:{Authorization:`Bearer ${process.env.CLISTE_VOICE_WEBHOOK_SECRET?.trim()??''}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal});
  let cancel:()=>void=()=>{};
  const cancelled=new Promise<never>((_resolve,reject)=>{
    cancel=()=>reject(new DOMException('Read cancelled','AbortError'));
    if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
  });
  let res:Response;
  try{res=await Promise.race([catalogueReadSignal.run(signal,()=>POST(request)),cancelled]);}
  finally{signal.removeEventListener('abort',cancel);}
  if(signal.aborted)throw new DOMException('Read cancelled','AbortError');
  return {res,body:await res.json() as T};
}
