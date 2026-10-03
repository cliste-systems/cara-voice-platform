const ordinals=['','first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth','twentieth','twenty-first','twenty-second','twenty-third','twenty-fourth','twenty-fifth','twenty-sixth','twenty-seventh','twenty-eighth','twenty-ninth','thirtieth','thirty-first'];
export function spokenVerifiedExpiry(value:string):string|null {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))>=2040)return null;
 const date=new Date(`${value}T12:00:00Z`);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)return null;
 const month=new Intl.DateTimeFormat('en-IE',{month:'long',timeZone:'Europe/Dublin'}).format(date);
 return `the ${ordinals[Number(value.slice(-2))]} of ${month}`;
}
export function callerRequestsOfferDates(query:string):boolean {
 return /\b(?:expir(?:e|es|y|ing|ation)|end(?:s|ing)?|until|valid(?:ity)?|last(?:s|ing)?|when|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i.test(query);
}
export function historicalOfferGuidance(query:string,reference=new Date()):string|null {
 const year=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Dublin',year:'numeric'}).format(reference));
 const historicalYear=[...query.matchAll(/\b(20\d{2})\b/g)].some(m=>Number(m[1])<year);
 if(!historicalYear||! /\b(?:Christmas|Easter|last year|last week|January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(query))return null;
 return 'Only current catalogue evidence is available. The historical promotion terms and expiry are not verified. Say you cannot confirm that those old offers can be used today; do not assert they expired, remain valid, or were checked in an archive. Do not substitute a current product offer for historical promotion evidence.';
}

export function ambiguousHistoricalOfferGuidance(query:string):string|null {
 if (!/\blast\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(query) || /\b\d{4}-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/i.test(query))return null;
 return 'The caller gave an ambiguous historical weekday. Ask which exact calendar date they mean before searching. Do not calculate or choose the date for them, and do not answer from this week’s offers. The current catalogue does not establish historical promotion evidence.';
}

/** The live lookup filters current promotions and cannot verify an unpublished next campaign. */
export function futureOfferGuidance(query:string):string|null {
 if(!/\b(?:offers?|deals?|specials?|promotions?)\b/i.test(query)||! /\b(?:next (?:week|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|upcoming|future)\b/i.test(query)||/\b(?:expir\w*|end\w*|until|valid\w*|last\w*)\b/i.test(query))return null;
 return 'This request is for future promotions. Only the currently published offer list is available here. Say that next week’s or the requested future day’s new offers cannot be confirmed yet. Do not substitute today’s offers as the answer or promise that a current offer will continue. Offer a team check if useful.';
}
