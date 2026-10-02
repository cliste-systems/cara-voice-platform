import {getDefaultResultOrder,setDefaultResultOrder} from 'node:dns';
import {setDefaultAutoSelectFamily} from 'node:net';
/** Prefer working IPv4 paths on dual-stack hosts; retain IPv6-only support. */
export function preferReliableDnsOrder():void {
  if(getDefaultResultOrder()==='verbatim')setDefaultResultOrder('ipv4first');
  if(getDefaultResultOrder()==='ipv4first')setDefaultAutoSelectFamily(false);
}
