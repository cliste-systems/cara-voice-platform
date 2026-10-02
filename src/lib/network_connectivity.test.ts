import {test} from 'node:test';import assert from 'node:assert/strict';
import {getDefaultResultOrder,setDefaultResultOrder} from 'node:dns';
import {getDefaultAutoSelectFamily,setDefaultAutoSelectFamily} from 'node:net';
import {preferReliableDnsOrder} from './network_connectivity.js';
test('IPv4 preference does not probe alternate addresses while explicit IPv6 preference is preserved',()=>{
 const order=getDefaultResultOrder(),automatic=getDefaultAutoSelectFamily();
 try{setDefaultResultOrder('verbatim');setDefaultAutoSelectFamily(true);preferReliableDnsOrder();assert.equal(getDefaultResultOrder(),'ipv4first');assert.equal(getDefaultAutoSelectFamily(),false);setDefaultResultOrder('ipv6first');setDefaultAutoSelectFamily(true);preferReliableDnsOrder();assert.equal(getDefaultResultOrder(),'ipv6first');assert.equal(getDefaultAutoSelectFamily(),true);}
 finally{setDefaultResultOrder(order);setDefaultAutoSelectFamily(automatic);}
});
