/** A named pack lookup must return its evidence before answering eligibility. */
export function namedPackLookupQuery(query:string):string {
 if(!/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|cl|l|pieces?)\b/i.test(query))return query;
 const clean=query.replace(/\s+(?:included in (?:any )?)?(?:mix(?:\s+and\s+|\s*&\s*|-)match|mix\s+and\s+match)(?:\s+offers?)?[?.!]?\s*$/i,'').trim();
 return clean.split(/\s+/).length>=4?clean:query;
}
