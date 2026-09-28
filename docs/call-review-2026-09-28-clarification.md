# Latest call: clarification and natural answers

Reviewed call f6e8da65-0a59-4f84-8544-a28b0d356290, created 2026-09-27 22:58:19 UTC (23:58 Dublin).

The stored transcript contains the greeting and caller turns but no subsequent assistant replies. Therefore the exact assistant wording is reported by the user, not independently reconstructed from this transcript. Caller topics include bakery offers, deli offers, any offers, meat-counter offers and counter salmon darnes.

Root cause confirmed in code: both the GPT-Live reasoning instructions and tool description explicitly required immediate broad browsing, including bypassing counter/pre-packed clarification. Tool results also contained ready-made caveats and repeated stock warnings.

Changes: shared clarification policy in voice prompt, reasoning prompt and tool-response guidance. Ask one question when an unknown detail materially changes an answer or action, across products, services, orders and dates. Reuse context, honour explicit both/all/example requests, and avoid unnecessary questions. Explain tool evidence naturally, preserving factual conditions without reading internal guidance or repeating caveats. All former immediate-browse instructions removed.

Live data check: deli counter offers returned zero verified matches; pre-packed deli returned seven. No claim is made that the counter has no offers locally.

Verification: 339 voice tests pass; production TypeScript build passes. Working Willow voice, 200ms prebuffer and existing opening recording preserved. A real spoken follow-up call remains necessary to verify the model's conversational behaviour; unit tests verify instruction wiring and tool flow, not a guaranteed spoken outcome.
