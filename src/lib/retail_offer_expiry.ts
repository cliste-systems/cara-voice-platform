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
