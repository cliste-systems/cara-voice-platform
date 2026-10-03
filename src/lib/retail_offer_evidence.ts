import type {SearchSupervaluProductsMatch} from './voice_api.js';
import {formatSpokenEurAmount} from './catalogue-runtime/lib/spoken-eur-price.js';

// Only reject explicitly contradictory variant families. Generic range names
// and omitted flavours do not establish a contradiction or eligibility.
const families=[['thin','deep pan'],['raspberry','strawberry','rhubarb','vanilla','mango','peach','blueberry','cherry','blackberry'],['full fat','skimmed','semi skimmed']];
export function matchesRequestedWineColor(query:string,match:SearchSupervaluProductsMatch):boolean {
 const white=/\bwhite wine\b/i.test(query)&&! /\b(?:no|not|without)\s+white wine\b/i.test(query);
 const red=/\bred wine\b/i.test(query)&&! /\b(?:no|not|without)\s+red wine\b/i.test(query);
 const rose=/\bros[eé]/i.test(query)&&! /\b(?:no|not|without)\s+ros[eé]/i.test(query);
 if(Number(white)+Number(red)+Number(rose)!==1)return true;
 const category=match.department;
 if(white&&/\bred\b|\brose\b|rosé|pink/i.test(category))return false;
 if(red&&/\bwhite\b|\brose\b|rosé|pink/i.test(category))return false;
 if(rose&&/\bwhite\b|\bred\b/i.test(category))return false;
 return true;
}
export function alcoholVariantQuestion(query:string,matches:SearchSupervaluProductsMatch[]):string|null {
 if(/\b(?:regular|normal|alcoholic|zero|non[- ]?alcoholic|alcohol[- ]free|no alcohol)\b|0[.,]0|\b(?:examples|full list|all (?:the )?offers)\b/i.test(query))return null;
 const zero=matches.filter(m=>/0[.,]0|alcohol[- ]free|non[- ]?alcoholic/i.test(m.product_name));
 const regular=matches.filter(m=>m.is_alcohol&&!zero.includes(m));
 const brand=(s:string)=>s.toLowerCase().match(/^[a-z]+/)?.[0];
 if(zero.some(z=>regular.some(r=>brand(z.product_name)===brand(r.product_name)&&new RegExp(`\\b${brand(r.product_name)}\\b`,'i').test(query))))return 'Did you want the regular version or the alcohol-free one?';
 return null;
}
export function matchesRequestedDietLabel(query:string,match:SearchSupervaluProductsMatch):boolean {
 const evidence=`${match.product_name} ${match.department}`;
 if(/\bvegan\b/i.test(query)&&! /\b(?:not|no|without)\s+vegan\b/i.test(query)&&! /\bvegan\b|plant[- ]based|meat[- ]free/i.test(evidence))return false;
 if(/gluten[- ]free/i.test(query)&&! /gluten[- ]free/i.test(evidence))return false;
 if(/dairy[- ]free/i.test(query)&&! /dairy[- ]free/i.test(evidence))return false;
 return true;
}
export function spokenOfferMatches<T>(matches:T[],query:string):T[] {
 return /\b(?:full list|all (?:the )?(?:offers|products|items)|every (?:offer|product|item))\b/i.test(query)?matches:matches.slice(0,3);
}
/** Keep current-price questions free of unrequested historical reference prices. */
export function requestedPriceEvidence(match:SearchSupervaluProductsMatch,query:string):SearchSupervaluProductsMatch {
 if(/\b(?:saving|savings|save|was|usual|usually|normally|previous|original|reference|compare|compared|comparison|difference)\b|\breduced from\b/i.test(query))return match;
 return {...match,was_price_eur:null,quote_text:match.quote_text.replace(/\bUsually [^.]+(?:\.|$)/gi,'').replace(/\s{2,}/g,' ').trim()};
}
export function conflictingOfferVariant(name:string,label:string):boolean {
 const normalize=(s:string)=>s.toLowerCase().replace(/[-/]/g,' ').replace(/0%\s*/g,'').replace(/\s+/g,' ');
 const product=normalize(name),terms=normalize(label);
 const has=(s:string,v:string)=>new RegExp(`\\b${v}\\b`).test(s);
 return families.some(f=>{const requested=f.filter(v=>has(product,v));const advertised=f.filter(v=>has(terms,v));return requested.length>0&&advertised.length>0&&!requested.some(v=>advertised.includes(v));});
}
export function guardOfferEvidence(match:SearchSupervaluProductsMatch):SearchSupervaluProductsMatch {
 const spoken=(text:string)=>text.replace(/\bSV\s*(?:&|and)\s*CT\b/gi,'SuperValu');
 match={...match,...(match.discount_label!==undefined?{discount_label:match.discount_label===null?null:spoken(match.discount_label)}:{}),quote_text:spoken(match.quote_text)};
 const sourcePackConflict=/Eligibility for this exact pack is not verified/i.test(match.quote_text);
 if(!match.discount_label||(!sourcePackConflict&&!conflictingOfferVariant(match.product_name,match.discount_label)))return match;
 const price=match.current_price_eur;
 return {...match,is_on_offer:false,discount_label:null,quote_text:`${match.product_name}. ${price!=null?`Verified current listed single price ${formatSpokenEurAmount(price)}.`:'No verified single price is supplied.'} The source promotion names a different product or pack. Eligibility for this exact product is not verified. Do not quote the conflicting bundle as an offer for this item or speculate about its history. This is a national listing; local assortment and stock are not confirmed.`};
}

/** Deli preparation/flavour qualifiers identify different products, not optional filler. */
export function matchesRequestedDeliVariant(query:string,match:SearchSupervaluProductsMatch):boolean {
 const normalize=(text:string)=>text.toLowerCase().replace(/[-’']/g,' ').replace(/\bhoney roasted\b/g,'honey roast').replace(/\bwoodsmoked\b/g,'wood smoked').replace(/\s+/g,' ');
 const requested=normalize(query),product=normalize(match.product_name);
 if(!/\b(?:ham|chicken|turkey|salami|chorizo|fuet|pancetta|prosciutto|beef|pastrami)\b/.test(requested)||
    !(match.service_area==='deli'||/sliced cooked meats|\bham\b|continental meats/i.test(match.department)))return true;
 for(const qualifier of ['traditional','wood smoked','honey roast','wafer thin','crumbed','carved','shredded','tikka']) {
  const requestedQualifier=new RegExp(`\\b${qualifier}\\b`).test(requested);
  const excluded=new RegExp(`\\b(?:not|no|without)\\s+${qualifier}\\b`).test(requested);
  const productQualifier=new RegExp(`\\b${qualifier}\\b`).test(product);
  if(requestedQualifier&&(excluded?productQualifier:!productQualifier))return false;
 }
 return true;
}
