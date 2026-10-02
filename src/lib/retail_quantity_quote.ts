import {parseRetailMultibuyLabel} from './catalogue-runtime/lib/retail-price-presentation.js';
import {formatSpokenEurAmount} from './catalogue-runtime/lib/spoken-eur-price.js';
import type {SearchSupervaluProductsMatch} from './voice_api.js';
/** Supply arithmetic from verified pack terms rather than asking the model to calculate. */
export function requestedPackTotalQuote(query:string,match:SearchSupervaluProductsMatch):string {
 const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
 const count=query.match(/\b(?:get|buy|take|for)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)?.[1]?.toLowerCase();
 const n=count?(words[count]??Number(count)):0;
 const price=match.current_price_eur;
 const packEvidence=match.quote_text.replace(/Eligibility to mix different products is not verified[^.]*\.?/gi,'');
 const packConflict=/(?:pack|exact product).*?(?:eligib|qualif|appl).*?(?:unverified|not (?:confirmed|verified))|eligib.*?exact pack.*?(?:unverified|not (?:confirmed|verified))|can(?:not|[’']t) confirm.*(?:appl|qualif)/i.test(packEvidence);
 if(!n||n>100||!price||match.fulfilment==='counter'||packConflict)return '';
 const bundle=parseRetailMultibuyLabel(match.discount_label);
 if(bundle&&(!bundle.quantity||!bundle.totalEur))return '';
 const cents=Math.round(price*100);const qty=bundle?.quantity;const bundleCents=bundle?.totalEur?Math.round(bundle.totalEur*100):0;
 const total=qty?Math.floor(n/qty)*bundleCents+(n%qty)*cents:n*cents;
 return `Verified calculation for ${n} packs of this exact item: ${formatSpokenEurAmount(total/100)} altogether.${qty&&n<qty?' This quantity does not reach the advertised bundle minimum.':''} Preserve any Rewards condition; local stock remains unverified.`;
}
