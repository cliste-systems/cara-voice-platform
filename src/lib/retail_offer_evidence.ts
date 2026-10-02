import type {SearchSupervaluProductsMatch} from './voice_api.js';
import {formatSpokenEurAmount} from './catalogue-runtime/lib/spoken-eur-price.js';

// Only reject explicitly contradictory variant families. Generic range names
// and omitted flavours do not establish a contradiction or eligibility.
const families=[['thin','deep pan'],['raspberry','strawberry','rhubarb','vanilla'],['full fat','skimmed','semi skimmed']];
export function conflictingOfferVariant(name:string,label:string):boolean {
 const normalize=(s:string)=>s.toLowerCase().replace(/[-/]/g,' ').replace(/0%\s*/g,'').replace(/\s+/g,' ');
 const product=normalize(name),terms=normalize(label);
 const has=(s:string,v:string)=>new RegExp(`\\b${v}\\b`).test(s);
 return families.some(f=>{const requested=f.filter(v=>has(product,v));const advertised=f.filter(v=>has(terms,v));return requested.length>0&&advertised.length>0&&!requested.some(v=>advertised.includes(v));});
}
export function guardOfferEvidence(match:SearchSupervaluProductsMatch):SearchSupervaluProductsMatch {
 if(!match.discount_label||!conflictingOfferVariant(match.product_name,match.discount_label))return match;
 const price=match.current_price_eur;
 return {...match,is_on_offer:false,discount_label:null,quote_text:`${match.product_name}. ${price!=null?`Verified current listed single price ${formatSpokenEurAmount(price)}.`:'No verified single price is supplied.'} The source promotion names a different variant. Eligibility for this exact product is not verified. Do not quote the conflicting bundle as an offer for this item. This is a national listing; local assortment and stock are not confirmed.`};
}
