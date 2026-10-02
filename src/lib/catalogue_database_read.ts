import {catalogueFetch} from './catalogue_http_transport.js';

/** One early retry for a stalled authorization read, without retrying writes or extending caller deadlines. */
export async function catalogueDatabaseRead(input:Parameters<typeof fetch>[0],init?:RequestInit,attemptTimeoutMs=3000):Promise<Response> {
  const url=new URL(input instanceof Request?input.url:String(input));
  const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
  const readOnly=method==='GET'&&url.protocol==='https:'&&url.hostname==='rtoebbwzwxcnscsxghww.supabase.co'&&['/rest/v1/phone_numbers','/rest/v1/organizations'].includes(url.pathname);
  if(!readOnly)return catalogueFetch(input,init);
  const callerSignal=init?.signal??(input instanceof Request?input.signal:undefined);
  for(let attempt=0;attempt<2;attempt++){
    const deadline=AbortSignal.timeout(attemptTimeoutMs);
    const signal=callerSignal?AbortSignal.any([callerSignal,deadline]):deadline;
    try{
      const response=await catalogueFetch(input,{...init,signal});
      if(attempt===0&&[500,502,503,504].includes(response.status)&&!callerSignal?.aborted){
        await response.body?.cancel();
        continue;
      }
      return response;
    }catch(error){
      const transient=error instanceof Error&&['TypeError','AbortError','TimeoutError'].includes(error.name);
      if(attempt===1||callerSignal?.aborted||!transient)throw error;
    }
  }
  throw new Error('Catalogue database read exhausted');
}
