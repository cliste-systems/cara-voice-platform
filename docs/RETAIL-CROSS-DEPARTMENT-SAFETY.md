# Cross-department product and offer safety

## Shared rules, rather than individual department patches

The app lookup and voice worker use the same generated catalogue runtime. Product qualifiers and exclusions are enforced on both catalogue and offer candidates. Full source category breadcrumbs travel through the API to the worker; a leaf category such as a country cannot discard the evidence identifying wine colour or another product family. Worker validation checks the caller’s original request as well as the model’s lookup. Structural department/location wording is removed from product identity while the original request continues to determine service area and fulfilment. Counter location must never be replaced with a packaged product without explaining and asking where necessary.

Every department follows the existing common safeguards: clarify a broad first request; retain the caller's refinements; restrict current promotions by date and freshness; distinguish single price, pack size, per-kilo price and multibuy total; preserve Rewards conditions and eligibility; avoid claiming local stock or universal national coverage. A range-only historical reference price is never a current price. A failed or empty lookup is not proof that no offer exists.

## Review matrix

| Department | Specific identity checks / review focus |
| --- | --- |
| Fruit & vegetables | Structural location vs product name; named product, unit and Super Fresh campaign membership |
| Bakery | White, brown, wholemeal, sourdough; counter vs packed; dietary label evidence |
| Meat & poultry | Species, cut, preparation, counter vs packed, weight and current price |
| Fish & seafood | Smoked, battered, breaded; species, counter vs packed and weight |
| Deli | Preparation and flavour, several requested qualifiers together, exclusions, counter vs packed |
| Cheese | Grated, sliced, spread and explicitly labelled block; weight and multibuy membership |
| Milk, yogurt, butter & eggs | Fat variant, named flavour, dietary label evidence and pack units |
| Health & wellness | Exact product and source-supported facts; no invented certification, health or allergy guarantees |
| Chilled food | Exact product, preparation, expiry and current promotion eligibility |
| Food cupboard | Microwave vs cooking product, dietary labels, exact product and pack |
| Frozen foods | Pizza style, dessert flavour, dietary labels and exact promotion variant |
| Drinks | Juice flavour, alcohol-free distinction where relevant, volume and multipack |
| Beauty & personal care | Shampoo vs conditioner, format, exact product and pack |
| Baby | Nappy size in either word order, pack and promotion terms; no unsupported suitability claims |
| Household & cleaning | Laundry liquid vs powder vs pods/capsules, exclusions, pack and terms |
| Pets | Cat vs dog, wet vs dry, puppy/kitten/adult where requested, exclusions |
| Wine, beer & spirits | Wine colour and explicit alternatives; regular vs zero, pack and membership conditions |
| Newsagent & tobacconist | Broad request clarification, exact source evidence, price/availability boundaries |

Additional confectionery/snack language has a distinct follow-up scope. Product words such as wine gums, baby spinach, fish fingers and beer-battered cod remain product words rather than locations.

## Release verification and continuing work

1. Run the catalogue suite and worker suite after any matching change. New regression cases pair realistic requests with right and plausibly wrong substitutions; check explicit alternatives and exclusions as well as positive matches.
2. Sync the reviewed app runtime into the worker, pinning its app revision and file hashes. Deploy the same policy to Vercel and LiveKit.
3. Verify current national publication separately from retrieval. The prepared positive-publication database migration remains subject to the outstanding approval; code deployment alone does not publish missing offers. Public sources do not establish a complete national assortment.
4. When model credits are available, run spoken multi-turn rehearsals for all 18 departments: broad opening, clarification, named product, variant, offer/refinement, price/unit, out-of-scope follow-up, unavailable evidence and interrupted lookup. Lookup/unit tests cannot substitute for this gate.
5. For each observed call failure, export the runbook review bundle and add a regression at the shared layer that failed. Independently verify the recording when required; generated transcript text alone does not establish what was heard.

No finite test suite can establish every possible conversation or guarantee that a provider never fails. Production readiness requires the publication and spoken-call gates as well as passing code tests.
