import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { trackCallerCatalogSearchIntent } from './catalog_search_intent.js';
import { CaraTools, type CaraAgentUserData } from './cara_tools.js';

describe('CaraTools.toolContext', () => {
  it('exposes retail lookup tools on conversational retail 9508', () => {
    const tools = new CaraTools().toolContext({ conversationalRetailLine: true });
    assert.deepEqual(Object.keys(tools).sort(), [
      'endPhoneCall',
      'searchSuperValuProducts',
    ]);
  });

  it('leaves hang-up to the spoken farewell on GPT-Live retail', () => {
    const tools = new CaraTools().toolContext({ conversationalRetailLine: true, gptLive: true });
    assert.deepEqual(Object.keys(tools), ['searchSuperValuProducts']);
  });

  it('exposes only endPhoneCall on demo line', () => {
    const tools = new CaraTools().toolContext({ demoLine: true });
    assert.deepEqual(Object.keys(tools).sort(), ['endPhoneCall']);
  });

  it('keeps full production tool surface on default lines', () => {
    const tools = new CaraTools().toolContext();
    assert.ok('takeCallbackMessage' in tools);
    assert.ok('sendDirectionsLink' in tools);
    assert.ok('endPhoneCall' in tools);
  });
});

// Exercise the real tool wrapper through its HTTP boundary, with no live service calls.
describe('CaraTools current-offer lookup', () => {
  async function lookup(
    query: string,
    response: Record<string, unknown>,
    replies: Record<string, unknown>[] = [],
    followUp?: string,
    scope: {service_area?: "grocery"|"bakery"|"dairy"; fulfilment?: "prepack"; callerQuery?: string; followUpCallerQuery?: string} = {},
  ) {
    const requests: Array<Record<string, unknown>> = [];
    const previousFetch = globalThis.fetch;
    const previousUrl = process.env.CLISTE_APP_URL;
    const previousSecret = process.env.CLISTE_VOICE_WEBHOOK_SECRET;
    process.env.CLISTE_APP_URL = 'https://catalogue.invalid';
    process.env.CLISTE_VOICE_WEBHOOK_SECRET = 'test-secret';
    globalThis.fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(replies[requests.length - 1] ?? response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    try {
      const tool = new CaraTools().searchSuperValuProducts;
      const context = {
        ctx: {
          userData: {
            organizationId: 'test-org',
            calledNumber: 'test-line',
            sessionFlags: {callerCatalogQuery: scope.callerQuery},
          },
          session: { currentAgent: {} },
        },
      } as unknown as Parameters<typeof tool.execute>[1];
      let result = await tool.execute({ query, ...(scope.service_area ? {service_area:scope.service_area} : {}), ...(scope.fulfilment ? {fulfilment:scope.fulfilment} : {}) }, context) as {
        ok: boolean;
        message: string;
        matches?: Array<{ product_name: string }>;
      };
      if (followUp) {
        const ud=context.ctx.userData as CaraAgentUserData;
        trackCallerCatalogSearchIntent(scope.followUpCallerQuery ?? followUp,ud.sessionFlags);
        result = await tool.execute({query:followUp}, context) as typeof result;
      }
      return { requests, result };
    } finally {
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) delete process.env.CLISTE_APP_URL;
      else process.env.CLISTE_APP_URL = previousUrl;
      if (previousSecret === undefined) delete process.env.CLISTE_VOICE_WEBHOOK_SECRET;
      else process.env.CLISTE_VOICE_WEBHOOK_SECRET = previousSecret;
    }
  }

  it('does not infer card eligibility when the caller asks what qualifies', async () => {
    const {result}=await lookup('Tampax Compak Regular Applicator Tampons 18 Piece offer', {ok:true,matches:[{product_name:'Tampax Compak Regular Applicator Tampons (18 Piece)',department:'Beauty & Personal Care',sku:'tampons',score:1,current_price_eur:4.99,discount_label:'2 for €8 Always/Tampax 14pce-68pce',quote_text:'Two for eight euro.'}]},[],undefined,{callerQuery:'If I get two Tampax Compak Regular Applicator Tampons 18 Piece, anything I need to qualify?'});
    assert.match(result.message,/Card eligibility is unknown/);
    assert.match(result.message,/Do not say cash is fine, no card is needed/);
  });

  it('retains a verified alcohol-version choice when the follow-up only supplies pack size', async () => {
    const matches=[{product_name:'Guinness Draught 0.0% Can 8 Pack (500 ml)',department:'Beer',quote_text:'Listed nationally.',score:1,is_alcohol:false},{product_name:'Guinness Draught Stout Can 8 Pack (500 ml)',department:'Beer',quote_text:'Listed nationally.',score:1,is_alcohol:true}];
    const {requests,result}=await lookup('Guinness Draught',{ok:true,matches},[],'regular Guinness Draught 8 pack 500ml cans not Nitrosurge',{followUpCallerQuery:'The eight pack of 500 ml cans, not Nitrosurge'});
    assert.equal(requests.length,1);
    assert.match(result.message,/regular and alcohol-free versions are still unresolved/);
    assert.match(result.message,/Do not report a missing offer/);
    assert.deepEqual(result.matches,[]);
  });

  it('accepts the observed long savings question without truncating the named product', () => {
    const query='What is the saving on Prepared By Our Butcher Chicken Fillets with Garlic, Herb & Lemon Crumb 1 Piece compared with two packs at the listed single price?';
    assert.ok(query.length>120);
    const params=new CaraTools().searchSuperValuProducts.parameters as unknown as {parse(value:unknown):{query:string}};
    assert.equal(params.parse({query,intent:'offer'}).query,query);
  });

  it('range-only questions do not expose unrelated price fields for the model to round', async () => {
    const {result}=await lookup('Is Loose Boned Kippers 1 kg on the national range?',{ok:true,matches:[{product_name:'Loose Boned Kippers (1 kg)',department:'Fish',sku:'kippers',score:1,quote_text:'Listed nationally; local stock is not confirmed.',current_price_eur:13.99,was_price_eur:null,discount_label:null}]});
    assert.match(result.message,/Do not volunteer a price or deal/);
    assert.equal('current_price_eur' in result.matches![0]!,false);
  });

  it('asks for nappy size before listing and does not inherit an assistant-suggested brand', async () => {
    const {requests,result}=await lookup('Pampers nappies',{ok:true,matches:[{product_name:'Huggies Size 2',quote_text:'Eight euro.',score:1}]},[],'Pampers Baby Dry nappies Size 2',{callerQuery:'Nappies please',followUpCallerQuery:'Size two'});
    assert.equal(requests.length,1);
    assert.match(String(requests[0]?.query),/nappies.*size 2/i);
    assert.doesNotMatch(String(requests[0]?.query),/Pampers|Baby Dry/i);
    assert.equal(result.ok,true);
  });

  it('does not ask for a nappy size for nappy rash cream or a supplied size', async () => {
    for(const query of ['nappy rash cream','Pampers nappies size 2']) {
      const {requests}=await lookup(query,{ok:true,matches:[{product_name:query,quote_text:'Eight euro.',score:1}]});
      assert.equal(requests.length,1,query);
    }
  });

  it('does not hard-scope a named free-from product to a guessed dairy or bakery area', async () => {
    for(const [query,area] of [['Alpro Soya High Protein Chocolate Drink (1 L)','dairy'],['gluten free bread','bakery']] as const) {
      const {requests}=await lookup(query,{ok:true,matches:[{product_name:query,quote_text:'Current offer.',score:1}]},[],undefined,{service_area:area,callerQuery:`Any offer on ${query}?`});
      assert.equal(requests[0]?.service_area,undefined);
    }
  });

  it('does not hide named meat, dairy or bakery offers behind a guessed grocery filter', async () => {
    for (const query of ['SuperValu Fresh Irish Chicken Fillets Large Pack (1 kg)', 'Galtee Cheese (200 g)', 'SuperValu Chocolate Muffins']) {
      const {requests}=await lookup(query,{ok:true,matches:[{product_name:query,quote_text:'Current offer two euro.',score:1}]},[],undefined,{service_area:'grocery',callerQuery:`Any offer on ${query}?`});
      assert.equal(requests[0]?.service_area,undefined,query);
    }
  });

  it('preserves the original caller scope even when the model drops it from the product query', async () => {
    const explicit=await lookup('coffee',{ok:true,matches:[{product_name:'coffee',quote_text:'two euro',score:1}]},[],undefined,{service_area:'grocery',callerQuery:'coffee from the grocery section'});
    assert.equal(explicit.requests[0]?.service_area,'grocery');
    const counter=await lookup('salmon',{ok:true,matches:[{product_name:'salmon',quote_text:'twelve euro per kilo',score:1}]},[],undefined,{service_area:'grocery',fulfilment:'prepack',callerQuery:'Any salmon at the fish counter?'});
    assert.equal(counter.requests[0]?.service_area,'fish');
    assert.equal(counter.requests[0]?.fulfilment,'counter');
  });

  it('uses the caller preference after a broad question instead of looping', async () => {
    const {requests,result}=await lookup('alcohol offers',{ok:true,matches:[{product_name:'Lager',score:1,quote_text:'Lager four pack for eight euro.'}]},[],'lager');
    assert.equal(requests.length,1);
    assert.equal(requests[0]?.query,'alcohol offers lager');
    assert.match(result.message,/Lager four pack/);
  });
  it('retains a known counter choice while narrowing the product', async () => {
    const {requests}=await lookup('meat counter offers',{ok:true,matches:[{product_name:'Chicken',score:1,quote_text:'Chicken.'}]},[],'chicken');
    assert.equal(requests[0]?.query,'meat counter offers chicken');
    assert.equal(requests[0]?.fulfilment,'counter');
    assert.equal(requests[0]?.service_area,'butcher');
  });

  it('allows a clear switch of department during clarification', async () => {
    const {requests}=await lookup('alcohol offers',{ok:true,matches:[{product_name:'Milk',score:1,quote_text:'Milk.'}]},[],'dairy section milk');
    assert.equal(requests[0]?.query,'dairy section milk');
    assert.equal(requests[0]?.service_area,'dairy');
  });

  it('returns clarification without fetching products for every broad department', async () => {
    for (const query of ['alcohol offers','bakery offers','dairy offers','deli offers','meat counter offers','fish offers','produce offers','frozen offers','household offers','baby offers','pet offers','health and beauty offers','any offers']) {
      const {requests,result}=await lookup(query,{ok:true,matches:[{product_name:'Should never be suggested'}]});
      assert.equal(requests.length,0,query);
      assert.deepEqual(result.matches,[],query);
      assert.match(result.message,/what kind of product/);
    }
  });

  it('honours an explicit request for a few examples without another clarification', async () => {
    const { requests, result } = await lookup('a few examples of meat offers', {
      ok: true,
      matches: [{ product_name: 'Chicken fillets', department: 'Meat', sku: 'test', score: 1, quote_text: 'Chicken fillets, any three packs for ten euro.', is_on_offer: true }],
    });
    assert.deepEqual(requests, [{ called_number: 'test-line', query: 'a few examples of meat offers', intent: 'offer', service_area: 'butcher' }]);
    assert.match(result.message, /any three packs for ten euro/);
    assert.match(result.message, /quantity and total bundle price/);
  });

  it('preserves the explicit counter request from the failed call', async () => {
    const query = 'chicken offers in the meat counter this week';
    const { requests } = await lookup(query, { ok: true, matches: [], no_match_quote: 'No confirmed counter offer found.' });
    assert.deepEqual(requests, [{ called_number: 'test-line', query, intent: 'offer', service_area: 'butcher', fulfilment: 'counter' }]);
  });

  it('never removes campaign or department filters through token fallback', async () => {
    for (const query of ['3 for 10 chicken', 'Super 7', 'multibuys', 'household laundry offers', 'weekly chocolate offers']) {
      const { requests, result } = await lookup(query, { ok: true, matches: [], no_match_quote: 'No matching current offer in that selection.' });
      assert.equal(requests.length, 1, query);
      assert.equal(requests[0]?.query, query);
      assert.equal(requests[0]?.intent, 'offer');
      assert.ok(result.message.endsWith('No matching current offer in that selection.'));
      assert.match(result.message, /not a script/);
      assert.match(result.message, /one brief/);
    }
  });

  it('keeps a partial freshness warning scoped to the source reported by the backend', async () => {
    const { result } = await lookup('dairy cheese offers', {
      ok: true,
      matches: [],
      offers_freshness: 'The dairy offer feed has not refreshed today.',
      no_match_quote: 'No current dairy offers could be confirmed.',
    });
    assert.match(result.message, /dairy offer feed has not refreshed today/);
    assert.match(result.message, /No current dairy offers could be confirmed/);
    assert.doesNotMatch(result.message, /weekly offer sheet has finished|cannot confirm the meat counter/);
  });

  it('still recovers a specific misheard product without losing offer intent', async () => {
    const match = { product_name: 'Irish Fillet Steak', department: 'Meat', sku: 'fillet', score: 1, quote_text: 'Fillet steak is on offer for ten euro.', is_on_offer: true };
    const { requests, result } = await lookup('filled steak on offer', { ok: true, matches: [match] }, [{ ok: true, matches: [] }]);
    assert.ok(requests.length > 1);
    assert.ok(requests.every((request) => request.intent === 'offer'));
    assert.equal(result.matches?.[0]?.product_name, 'Irish Fillet Steak');
  });
});


describe('caller delivery security boundaries', () => {
  async function withDeliveryFixture(run: (fixture: {
    tools: CaraTools;
    userData: CaraAgentUserData;
    context: Parameters<CaraTools['sendDirectionsLink']['execute']>[1];
    requests: Array<Record<string, unknown>>;
    failNextDelivery: () => void;
  }) => Promise<void>) {
    const previousFetch = globalThis.fetch;
    const envKeys = ['CLISTE_APP_URL', 'CLISTE_VOICE_WEBHOOK_SECRET', 'CARA_SMS_DRY_RUN'] as const;
    const originals = envKeys.map((key) => [key, process.env[key]] as const);
    process.env.CLISTE_APP_URL = 'https://delivery-test.invalid';
    process.env.CLISTE_VOICE_WEBHOOK_SECRET = 'synthetic-delivery-test';
    process.env.CARA_SMS_DRY_RUN = 'true';
    const requests: Array<Record<string, unknown>> = [];
    let failNext = false;
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const failed = failNext;
      failNext = false;
      return new Response(JSON.stringify(failed ? { ok: false, error: 'delivery unavailable' } : { ok: true }), {
        status: failed ? 503 : 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const tools = new CaraTools();
    const userData: CaraAgentUserData = {
      organizationId: '00000000-0000-4000-8000-000000000001',
      businessName: 'Test business',
      calledNumber: '+35315550100',
      callerPhone: '+353871234567',
      routingLinks: [
        { id: 'location', presetId: 'location', label: 'Directions', intent: 'directions', targetType: 'link', url: 'https://example.com/location', active: true, linkDelivery: 'both' },
        { id: 'website', label: 'Website', intent: 'website', targetType: 'link', url: 'https://example.com', active: true },
      ],
      businessFiles: [],
      fallbackNumber: null,
      callRoutingMode: null,
      disclosureConfirmed: true,
      endCallTarget: { roomName: 'sip-test-server-room', callerIdentity: 'sip-test-caller' },
      sessionFlags: {
        linkSent: false, actionTicketCreated: false, callbackRequested: false,
        smsSent: 0, endPhoneCallUsed: false, askedAnythingElse: false,
        awaitingAnythingElseReply: false, anythingElseAskCount: 0,
        callerRespondedAfterAnythingElse: false, closingCall: false, likelySttGarble: false,
      },
    };
    const context = { ctx: { userData } } as Parameters<typeof tools.sendDirectionsLink.execute>[1];
    try {
      await run({ tools, userData, context, requests, failNextDelivery: () => { failNext = true; } });
    } finally {
      globalThis.fetch = previousFetch;
      for (const [key, value] of originals) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  const emailArgs = (emailAddress = 'recipient@example.com') => ({
    routeId: 'location', channel: 'email' as const, emailAddress, callerConsented: true,
  });

  it('blocks repeated and simultaneous duplicate emails using normalized recipients', async () => {
    await withDeliveryFixture(async ({ tools, context, requests }) => {
      const outcomes = await Promise.all([
        tools.sendDirectionsLink.execute(emailArgs('RECIPIENT@example.com'), context),
        tools.sendDirectionsLink.execute(emailArgs(), context),
      ]);
      const repeat = await tools.sendDirectionsLink.execute(emailArgs(), context);
      assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
      assert.equal(repeat.ok, false);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.call_session_id, 'sip-test-server-room');
      assert.equal(requests[0]?.to, 'recipient@example.com');
    });
  });

  it('limits concurrent distinct recipients to three messages per call', async () => {
    await withDeliveryFixture(async ({ tools, context, requests }) => {
      const outcomes = await Promise.all(Array.from({ length: 10 }, (_, index) =>
        tools.sendDirectionsLink.execute(emailArgs(`recipient-${index}@example.com`), context)));
      assert.equal(outcomes.filter((outcome) => outcome.ok).length, 3);
      assert.equal(requests.length, 3);
    });
  });

  it('shares the message allowance between email and SMS', async () => {
    await withDeliveryFixture(async ({ tools, context, requests }) => {
      assert.equal((await tools.sendDirectionsLink.execute(emailArgs(), context)).ok, true);
      assert.equal((await tools.sendDirectionsLink.execute(emailArgs('second@example.com'), context)).ok, true);
      assert.equal((await tools.sendRoutingLink.execute({ routeId: 'website' }, context)).ok, true);
      assert.equal((await tools.sendDirectionsLink.execute(emailArgs('third@example.com'), context)).ok, false);
      assert.equal(requests.length, 2);
    });
  });

  it('requires caller consent and a server-bound call session before any email request', async () => {
    await withDeliveryFixture(async ({ tools, context, userData, requests }) => {
      assert.equal((await tools.sendDirectionsLink.execute({ ...emailArgs(), callerConsented: false }, context)).ok, false);
      delete userData.endCallTarget;
      assert.equal((await tools.sendDirectionsLink.execute(emailArgs(), context)).ok, false);
      assert.equal(requests.length, 0);
    });
  });

  it('allows a failed request to retry with the same durable call identity', async () => {
    await withDeliveryFixture(async ({ tools, context, requests, failNextDelivery }) => {
      failNextDelivery();
      assert.equal((await tools.sendDirectionsLink.execute(emailArgs(), context)).ok, false);
      assert.equal((await tools.sendDirectionsLink.execute(emailArgs(), context)).ok, true);
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
    });
  });
});


it('compares cheapest burgers despite stale model offer arguments, and records the real lookup', async () => {
  const priorFetch = globalThis.fetch;
  const priorUrl = process.env.CLISTE_APP_URL;
  const priorSecret = process.env.CLISTE_VOICE_WEBHOOK_SECRET;
  const requests: Array<Record<string, unknown>> = [];
  const events: unknown[] = [];
  process.env.CLISTE_APP_URL = 'https://catalogue.invalid';
  process.env.CLISTE_VOICE_WEBHOOK_SECRET = 'test-secret';
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ok: true, matches: [{product_name: 'Beef burgers 4 pack', current_price_eur: 3, score: 1, quote_text: 'Beef burgers four pack for three euro.'}]});
  };
  try {
    const flags: CaraAgentUserData['sessionFlags'] = {
      linkSent: false, actionTicketCreated: false, callbackRequested: false,
      smsSent: 0, endPhoneCallUsed: false, askedAnythingElse: false,
      awaitingAnythingElseReply: false, anythingElseAskCount: 0,
      callerRespondedAfterAnythingElse: false, closingCall: false, likelySttGarble: false,
    };
    trackCallerCatalogSearchIntent('barbecue meat on offer', flags);
    trackCallerCatalogSearchIntent('burgers', flags);
    trackCallerCatalogSearchIntent('what would be the cheapest', flags);
    flags.pendingProductFulfilmentClarification = true;
    flags.pendingProductSearchState = {query: 'burgers', intent: 'offer', serviceArea: 'grocery', fulfilment: 'prepack'};
    const tool = new CaraTools().searchSuperValuProducts;
    const context = {ctx: {userData: {organizationId: 'test-org', calledNumber: 'test-line', sessionFlags: flags, onProductLookupEvent: (event: unknown) => events.push(event)}, session: {currentAgent: {}}}} as unknown as Parameters<typeof tool.execute>[1];
    const result = await tool.execute({query: 'burger offers', intent: 'offer', service_area: 'grocery', fulfilment: 'prepack'}, context) as {message: string};
    assert.equal(requests[0]?.query, 'cheapest meat burger for barbecue');
    assert.equal(requests[0]?.intent, 'price');
    assert.equal(requests[0]?.service_area, undefined);
    assert.equal(requests[0]?.fulfilment, undefined);
    assert.match(result.message, /lowest listed relevant price/);
    assert.match(result.message, /four pack for three euro/);
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], {phase:'start', query:'cheapest meat burger for barbecue', intent:'price'});
    assert.equal(flags.callerWantsLowestPrice, false);
    await tool.execute({query: 'cheapest burgers from the butcher counter', intent: 'price', service_area: 'grocery', fulfilment: 'prepack'}, context);
    assert.equal(requests[1]?.service_area, 'butcher');
    assert.equal(requests[1]?.fulfilment, 'counter');
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.CLISTE_APP_URL; else process.env.CLISTE_APP_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.CLISTE_VOICE_WEBHOOK_SECRET; else process.env.CLISTE_VOICE_WEBHOOK_SECRET = priorSecret;
  }
});
