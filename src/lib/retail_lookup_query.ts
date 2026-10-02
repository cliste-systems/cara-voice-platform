/** A named pack lookup must return its evidence before answering eligibility. */
export function namedPackLookupQuery(query:string):string {
 if(/\bsealed\b/i.test(query)&&/\bpackets?\b/i.test(query))query=query.replace(/\b(?:sealed|packets?)\b/gi,' ').replace(/\s+/g,' ').trim();
 if(!/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|cl|l|pieces?)\b/i.test(query))return query;
 const clean=query.replace(/\s+(?:included in (?:any )?)?(?:mix(?:\s+and\s+|\s*&\s*|-)match|mix\s+and\s+match)(?:\s+offers?)?[?.!]?\s*$/i,'').trim();
 return clean.split(/\s+/).length>=4?clean:query;
}
export function counterWeightLookupQuery(query:string):string {
 return query.replace(/\b\d+(?:[.,]\d+)?\s*(?:grams?|g|kilograms?|kg)\b/gi,' ').replace(/\s+/g,' ').trim();
}
export function mergeProductRefinement(pending:string,refinement:string):string {
 const normalize=(s:string)=>s.toLowerCase().replace(/\b(?:offers?|deals?|specials?)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
 return normalize(refinement).includes(normalize(pending))?refinement:`${pending} ${refinement}`;
}
