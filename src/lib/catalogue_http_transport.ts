import {Agent} from 'undici';
// Scope connection policy to catalogue reads; do not alter audio, OpenAI or
// action webhooks. DNS ordering alone does not control an existing dispatcher.
const catalogueDispatcher=new Agent({connect:{family:4,autoSelectFamily:false},connections:12,pipelining:1});
export function catalogueFetch(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]):ReturnType<typeof fetch> {
 const url=new URL(input instanceof Request?input.url:String(input));
 const knownPublicHost=url.hostname==='app.hellocara.ie'||url.hostname==='rtoebbwzwxcnscsxghww.supabase.co';
 if(url.protocol!=='https:'||!knownPublicHost)return fetch(input,init);
 const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
 // Reuse healthy connections on the explicit route instead of doing a new
 // TLS handshake for every authentication, page and assortment read.
 headers.delete('Connection');
 return fetch(input,{...init,headers,dispatcher:catalogueDispatcher} as unknown as RequestInit);
}
