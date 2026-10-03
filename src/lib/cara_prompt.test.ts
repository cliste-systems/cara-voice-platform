import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCaraCallPrompt, buildGptLiveRetailCallPrompt } from './cara_prompt.js';
import { pickCallPersona } from './persona.js';

const baseInput = {
  businessName: 'Murphy\'s SuperValu Killarney',
  customPrompt: 'We are a grocery store.',
  callerLine: {
    kind: 'irish_mobile' as const,
    e164: '+353871234567',
    spoken: 'oh-eight-seven, one-two-three, four-five-six-seven',
    display: '087 123 4567',
    canReceiveSms: true,
    hint: 'Caller ID on file.',
  },
  routingLinks: [],
  orgTimeZone: 'Europe/Dublin',
  nowUtcIso: '2026-06-20T12:00:00.000Z',
  todayLocal: '2026-06-20',
};

describe('buildCaraCallPrompt', () => {
  it('includes fallback guidance for unknown topics', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      niche: 'retail',
    });

    assert.match(prompt, /do \*\*not\*\* guess/i);
    assert.match(prompt, /takeCallbackMessage/i);
  });

  it('instructs natural grounded Q&A without verbatim reading', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      niche: 'salon',
    });

    assert.match(prompt, /Approved facts, natural wording/i);
    assert.match(prompt, /Never read saved answers verbatim/i);
    assert.match(prompt, /Preserve negatives, conditions, exceptions/i);
  });

  it('uses retail flow for grocery stores', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      niche: 'retail',
      businessType: 'Retail & Grocery',
      openingGreetingDelivered: true,
    });

    assert.match(prompt, /retail store/i);
    assert.match(prompt, /greeting already played/i);
    assert.match(prompt, /can you hear me/i);
    assert.doesNotMatch(prompt, /root touch-up/i);
  });

  it('uses conversational demo prompt on the test line', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      businessName: 'Hello Cara Demo',
      demoMode: true,
      openingGreetingDelivered: true,
    });

    assert.match(prompt, /Hello Cara demo line/i);
    assert.match(prompt, /Not a real shop/i);
    assert.match(prompt, /just so you're aware/i);
    assert.match(prompt, /how are you keeping/i);
    assert.match(prompt, /never guess/i);
    assert.doesNotMatch(prompt, /Murphy/i);
  });

  it('uses compact persona guidance instead of the old rulebook sections', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      businessName: 'Hello Cara Demo',
      demoMode: true,
      openingGreetingDelivered: true,
    });

    assert.match(prompt, /Who you are/i);
    assert.match(prompt, /Sound human \(this is the whole job\)/i);
    assert.match(prompt, /Social chitchat/i);
    assert.match(prompt, /You choose the exact words every call/i);
    assert.match(prompt, /Hello Cara product facts/i);
    assert.doesNotMatch(prompt, /Host personality/i);
    assert.doesNotMatch(prompt, /Intent routing/i);
  });

  it('embeds all scenario playbooks including general non-trade path', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      businessName: 'Hello Cara Demo',
      demoMode: true,
      openingGreetingDelivered: true,
    });

    assert.match(prompt, /### Electrician/i);
    assert.match(prompt, /### Mechanic/i);
    assert.match(prompt, /### Shop \/ retail/i);
    assert.match(prompt, /### General Hello Cara/i);
    assert.match(prompt, /what brought them/i);
    assert.match(prompt, /paraphrase/i);
  });

  it('includes demo endPhoneCall guidance', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      businessName: 'Hello Cara Demo',
      demoMode: true,
      openingGreetingDelivered: true,
    });

    assert.match(prompt, /endPhoneCall/i);
    assert.match(prompt, /how are you keeping/i);
  });

  it('accepts injected demoPlaybookBlock override', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      businessName: 'Hello Cara Demo',
      demoMode: true,
      openingGreetingDelivered: true,
      demoPlaybookBlock: '### Custom playbook\nTriggers: test\n  1. **Beat** — guidance',
    });

    assert.match(prompt, /Custom playbook/);
    assert.doesNotMatch(prompt, /### Electrician/);
  });

  it('uses LLM-first conversational retail prompt with call flow and manner blocks', () => {
    const persona = pickCallPersona({
      businessName: 'Kavanaghs SuperValu Donegal Town',
      seed: 'org-1:+353871234567:room-retail',
      localHour: 14,
    });
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      businessName: 'Kavanaghs SuperValu Donegal Town',
      niche: 'retail',
      businessType: 'Retail & Grocery',
      conversationalRetailMode: true,
      openingGreetingDelivered: true,
      persona,
    });

    assert.match(prompt, /programmatic/i);
    assert.match(prompt, /how can I help you today/i);
    assert.match(prompt, /Social chitchat/i);
    assert.match(prompt, /Anti-loop/i);
    assert.match(prompt, /You choose the exact words every call/i);
    assert.match(prompt, /CALL FLOW/i);
    assert.match(prompt, /## Sound human/i);
    assert.match(prompt, /didn't quite catch/i);
    assert.match(prompt, /endPhoneCall/i);
    assert.match(prompt, /Kavanaghs SuperValu Donegal Town/);
    assert.match(prompt, /after hang-up/i);
    assert.match(prompt, /Every turn must include spoken words/i);
    assert.match(prompt, /Thoughtful intake/i);
    assert.match(prompt, /what would a staff member actually need/i);
    assert.match(prompt, /What's the first name/i);
    assert.match(prompt, /name on the cake/i);
    assert.match(prompt, /first name for collection/i);
    assert.match(prompt, /two names/i);
    assert.match(prompt, /how many people|What size were you thinking/i);
    assert.match(prompt, /searchSuperValuProducts.*endPhoneCall/s);
    assert.match(prompt, /Ignore takeCallbackMessage, transferToTeam/i);
    assert.match(prompt, /## Your manner on this call/i);
    assert.match(prompt, /Wellbeing reply shapes/i);
    assert.ok(prompt.includes(persona.manner));
    assert.doesNotMatch(prompt, /Hello Cara demo line/i);
  });

  it('changes only speaking style when natural demo conversation is enabled', () => {
    const input = { ...baseInput, conversationalRetailMode: true, openingGreetingDelivered: true };
    const original = buildCaraCallPrompt(input);
    const natural = buildCaraCallPrompt({ ...input, naturalConversationStyle: true });
    const withoutStyle = (prompt: string) => prompt.replace(
      /### (?:How real people talk|Natural conversation)[\s\S]*?(?=### When you didn't catch it)/,
      '',
    );
    // Everything outside tone must stay identical, including price evidence,
    // uncertain speech, disclosure, intake, confirmation and call-ending rules.
    assert.equal(withoutStyle(natural), withoutStyle(original));
    assert.match(natural, /do not introduce stories, invented experiences or unrelated topics/);
    assert.doesNotMatch(natural, /Often 8–15 words/);
  });

  it('includes universal ending-calls state machine on conversational retail 9508', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      businessName: 'Kavanaghs SuperValu Donegal Town',
      niche: 'retail',
      conversationalRetailMode: true,
      openingGreetingDelivered: true,
    });

    assert.match(prompt, /## Ending calls/i);
    assert.match(prompt, /Beat 1/i);
    assert.match(prompt, /Beat 2/i);
    assert.match(prompt, /meaning in context/i);
    assert.match(prompt, /endPhoneCall.*same turn/i);
    assert.match(prompt, /Never.*dangling goodbye/i);
    assert.match(prompt, /Ignore takeCallbackMessage, transferToTeam/i);
    assert.match(prompt, /Finish.*Ending calls/i);
    assert.match(prompt, /summarising what you captured for their errand/i);
    assert.match(prompt, /## Confirm once/i);
    assert.match(prompt, /Never.*ask the same confirmation twice/i);
    assert.match(prompt, /Beat 1.*exactly once per call/i);
    assert.match(prompt, /Order close:/i);
    assert.match(prompt, /banned slop phrase.*failure/i);
    assert.match(prompt, /never.*ask them to confirm.*phone number/i);
    assert.doesNotMatch(prompt, /best number to contact you on/i);
    assert.doesNotMatch(prompt, /Wind-down.*Ending calls beat 1/i);
  });

  it('excludes retail-hours callback route from conversational retail prompt', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      businessName: 'Kavanaghs SuperValu Donegal Town',
      niche: 'retail',
      conversationalRetailMode: true,
      openingGreetingDelivered: true,
      routingLinks: [
        {
          id: 'retail-hours',
          presetId: 'hours-enquiry',
          label: 'Opening hours',
          intent: 'opening hours',
          targetType: 'callback',
          url: 'Name, phone',
          active: true,
        },
        {
          id: 'retail-bakery-cake',
          presetId: 'quote',
          label: 'Birthday cake',
          intent: 'birthday cake',
          targetType: 'callback',
          url: 'Name, phone, cake',
          active: true,
        },
      ],
    });

    assert.doesNotMatch(prompt, /retail-hours/);
    assert.match(prompt, /retail-bakery-cake.*takeCallbackMessage/);
    assert.match(prompt, /Opening hours \(speech only/i);
  });

  it('includes social chitchat guidance on production calls', () => {
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      niche: 'retail',
      openingGreetingDelivered: true,
    });

    assert.match(prompt, /### Social chitchat/i);
    assert.match(prompt, /You choose the exact words every call/i);
    assert.match(prompt, /Anti-loop/i);
    assert.match(prompt, /Help already asked/i);
    assert.match(prompt, /Do not.*open with.*how are you keeping/i);
  });

  it('includes conversational sections and persona block last on production calls', () => {
    const persona = pickCallPersona({
      businessName: baseInput.businessName,
      seed: 'org-1:+353871234567:room-a',
      localHour: 14,
    });
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      niche: 'retail',
      persona,
    });

    assert.match(prompt, /## Who you are/i);
    assert.match(prompt, /## How you talk/i);
    assert.match(prompt, /## Never sound like a machine/i);
    assert.match(prompt, /## Your manner on this call/i);
    assert.match(prompt, /Wellbeing reply shapes/i);
    assert.match(prompt, /endPhoneCall in the same turn/i);
    assert.ok(prompt.includes(persona.greeting));
    assert.doesNotMatch(prompt, /\{business\}|\{timeOfDay\}/);
    assert.ok(
      prompt.lastIndexOf('## Your manner on this call') >
        prompt.indexOf('## Active routes'),
    );
  });

  it('includes persona manner block on demo line when provided', () => {
    const persona = pickCallPersona({
      businessName: 'Hello Cara',
      seed: 'demo-seed',
      localHour: 10,
    });
    const prompt = buildCaraCallPrompt({
      ...baseInput,
      businessName: 'Hello Cara Demo',
      demoMode: true,
      openingGreetingDelivered: true,
      persona,
    });

    assert.match(prompt, /## Your manner on this call/i);
    assert.match(prompt, /endPhoneCall/i);
    assert.ok(prompt.includes(persona.manner));
  });
});

describe('buildGptLiveRetailCallPrompt', () => {
  it('waits for the caller after a checked greeting and keeps cake requests unconfirmed', () => {
    const prompt = buildGptLiveRetailCallPrompt({
      ...baseInput,
      openingLine: 'Hello, this is Cara.',
      verifiedOpeningPlayed: true,
    });
    assert.match(prompt, /already played this checked greeting/);
    assert.match(prompt, /Wait silently for the caller/);
    assert.doesNotMatch(prompt, /Your very first words on the call are exactly/);
    assert.match(prompt, /inscription name and collector's name separately/);
    assert.match(prompt, /never use one answer for both/);
    assert.match(prompt, /Do not say an order is accepted, booked or ready/);
    assert.match(prompt, /unless a tool confirms it/);
    assert.match(prompt, /Do not invent personal experiences/);
  });

  it('requests Donegal pronunciation from the opening without substituting slang for accent', () => {
    const prompt = buildGptLiveRetailCallPrompt({
      ...baseInput,
      openingLine:
        "Hello, you're through to Kavanaghs SuperValu Donegal Town. I'm Cara, the AI assistant.",
    });

    assert.match(prompt, /native Donegal Irish English accent throughout, from the first word/);
    assert.match(prompt, /Irish vowel sounds, speech rhythm and intonation pronounced and natural/);
    assert.match(prompt, /accent through pronunciation while using plain English/);
    assert.match(prompt, /do not add "grand", "sound", or other slang/);
    assert.doesNotMatch(prompt, /normal voice|sound by default|put-on accent/);
    assert.doesNotMatch(prompt, /How you sound/);
    assert.match(prompt, /word for word/);
    assert.doesNotMatch(prompt, /Banned slop|Never say \(AI slop\)|CALL FLOW/);
    assert.ok(prompt.length < 7500);
    assert.match(prompt, /missing detail would materially change/);
    assert.match(prompt, /Tool outputs are evidence and internal guidance, not a script/);
  });
});


describe('offer browsing instructions', () => {
  it('clarifies ambiguous scope while retaining department and campaign searches', () => {
    const prompt = buildCaraCallPrompt({ ...baseInput, conversationalRetailMode: true, niche: 'retail' });
    assert.match(prompt, /weekly offers/);
    assert.match(prompt, /meat offers/);
    assert.match(prompt, /Super 7/);
    assert.match(prompt, /multibuys/);
    assert.match(prompt, /3 for 10/);
    assert.match(prompt, /Which department were you thinking of/);
    assert.match(prompt, /For an initial broad department request/);
    assert.doesNotMatch(prompt, /search both counter and pre-pack immediately/);
    assert.match(prompt, /national catalogue match does not by itself confirm local stock/i);
    assert.doesNotMatch(prompt, /never generic "weekly offers"/);
  });
});
