import {parseRetailMultibuyLabel} from './catalogue-runtime/lib/retail-price-presentation.js';
import {formatSpokenEurAmount} from './catalogue-runtime/lib/spoken-eur-price.js';
import type {SearchSupervaluProductsMatch} from './voice_api.js';
export function verifiedSavingsQuote(match:SearchSupervaluProductsMatch):string {
 const price=match.current_price_eur,was=match.was_price_eur;
 if(!price||!(price>0))return 'No verified monetary saving can be calculated from the supplied prices.';
 const cents=Math.round(price*100),parts:string[]=[];
 if(was&&was>price)parts.push(`Verified difference from the supplied was/reference price: ${formatSpokenEurAmount((Math.round(was*100)-cents)/100)} ${match.price_basis==='per_kilo'?'per kilo':'per item'}. This reference does not establish today’s non-member shelf price.`);
 const bundle=parseRetailMultibuyLabel(match.discount_label);
 if(match.fulfilment!=='counter'&&bundle?.quantity&&bundle.totalEur){const saving=cents*bundle.quantity-Math.round(bundle.totalEur*100);if(saving>0)parts.push(`Verified bundle saving compared with buying ${bundle.quantity} packs of this exact product at the listed single price: ${formatSpokenEurAmount(saving/100)}. Preserve membership and exact-product eligibility conditions.`);}
 return parts.join(' ')||'No verified monetary saving is supplied. Do not invent a saving amount.';
}
export function requestedCounterWeightQuote(query:string,match:SearchSupervaluProductsMatch):string {
 if(match.fulfilment!=='counter'||match.price_basis!=='per_kilo'||!match.current_price_eur)return '';
 const amounts:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9};
 const normalized=query.replace(/\b(one|two|three|four|five|six|seven|eight|nine) hundred\b/gi,(_all,w)=>String(amounts[w.toLowerCase()]!*100));
 const weight=normalized.match(/\b(\d+(?:[.,]\d+)?)\s*(grams?|g|kilograms?|kg)\b/i);
 const grams=weight?Number(weight[1]!.replace(',','.'))*(/^k/i.test(weight[2]!)?1000:1):/\bhalf (?:a )?kilo\b/i.test(query)?500:/\bquarter (?:of )?(?:a )?kilo\b/i.test(query)?250:0;
 if(!(grams>0&&grams<=100000))return '';
 const total=Math.round(Math.round(match.current_price_eur*100)*grams/1000)/100;
 return `Verified weight calculation at the returned per-kilo price: approximately ${formatSpokenEurAmount(total)} for ${grams} grams. Actual charge depends on the weighed portion. Preserve offer conditions and unconfirmed local stock.`;
}
/** Supply arithmetic from verified pack terms rather than asking the model to calculate. */
export function requestedPackTotalQuote(query:string,match:SearchSupervaluProductsMatch):string {
 const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
 const count=query.match(/\b(?:get|buy|take|for|pick up)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)?.[1]?.toLowerCase();
 const n=count?(words[count]??Number(count)):0;
 const price=match.current_price_eur;
 const packEvidence=match.quote_text.replace(/Eligibility to mix different products is not verified[^.]*\.?/gi,'');
 const packConflict=/(?:pack|exact product).*?(?:eligib|qualif|appl).*?(?:unverified|not (?:confirmed|verified))|eligib.*?exact pack.*?(?:unverified|not (?:confirmed|verified))|can(?:not|[’']t) confirm.*(?:appl|qualif)/i.test(packEvidence);
 if(!n||n>100||match.fulfilment==='counter'||packConflict)return '';
 const bundle=parseRetailMultibuyLabel(match.discount_label);
 if(bundle?.quantity&&bundle.totalEur&&n%bundle.quantity===0)return `Verified calculation for ${n} packs of this exact item: ${formatSpokenEurAmount(Math.round(bundle.totalEur*100)*(n/bundle.quantity)/100)} altogether. This uses complete advertised bundles and does not infer a single-item price. Preserve any Rewards condition; local stock remains unverified.`;
 if(!price)return '';
 if(bundle&&(!bundle.quantity||!bundle.totalEur))return `At the verified listed single price, ${n} packs total ${formatSpokenEurAmount(Math.round(price*100)*n/100)} before any unverified multibuy discount. The multibuy discount or total is not supplied. Do not call this the offer total or say at least; a discount could reduce it. Preserve any membership condition.`;
 const cents=Math.round(price*100);const qty=bundle?.quantity;const bundleCents=bundle?.totalEur?Math.round(bundle.totalEur*100):0;
 const total=qty?Math.floor(n/qty)*bundleCents+(n%qty)*cents:n*cents;
 return `Verified calculation for ${n} packs of this exact item: ${formatSpokenEurAmount(total/100)} altogether.${qty&&n<qty?' This quantity does not reach the advertised bundle minimum.':''} Preserve any Rewards condition; local stock remains unverified.`;
}
