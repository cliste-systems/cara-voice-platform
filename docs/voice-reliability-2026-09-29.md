# Voice reliability fixes — 29 September 2026

## Audio delivery

GPT-Live delivers audio in batches. A recorded 315 ms arrival stall exhausted the previous 200 ms playback cushion during speech. Independent alignment against received audio confirmed an additional 110 ms at the affected boundary; unchanged concatenated PCM alone did not reveal this delivery gap.

The default and malformed-setting fallback are now **500 ms**. Explicit zero remains an opt-in diagnostic comparison. Both local configuration and the production override must agree with the tested value. The queue capacity remains 8000 ms; capacity is not guaranteed buffered playback time. The checked greeting, passthrough gate, DTX disabled, RED enabled and speech PCM are preserved.

Replaying the exact recorded arrivals through the real playout implementation:

| Cushion | Largest modeled gap | Minimum speech headroom |
| --- | ---: | ---: |
| 200 ms | 114 ms | -114 ms |
| 300 ms | 24 ms | -24 ms |
| 400 ms | 0 ms | 64 ms |
| 500 ms | 0 ms | 164 ms |

500 ms adds about 300 ms of initial hold compared with the earlier setting in this capture. Padding remains limited to confirmed digital silence; the fix does not insert gaps into active speech or rewrite samples. A mocked-clock regression reproduces the delivery stall and verifies continuous output with unchanged speech.

The final local spoken test used 500 ms: every source sample and the checked greeting were preserved, no clipping or modeled output starvation occurred, and independent received-waveform alignment showed no extra timing step at the measured speech stalls. A small downstream timing change during near-silence remains consistent with receiver buffering. One test and a replay do not guarantee all future networks or provider stalls will remain inside this buffer.

## Product comparisons

Cheapest requests now search regular prices and offers, strip comparison wording from product identity, rank before truncating results, and retain weekly-only products. The voice worker preserves explicit meat and barbecue context across follow-up turns and ignores guessed pack/aisle restrictions during a comparison. Explicit counter or pack requests still apply.

The platform excludes unrelated product forms and prepared meals for cooking requests. An explicit meat request excludes vegetarian substitutes; generic burger requests are not silently restricted to meat. Pack totals and per-kilo rates are compared separately; unknown counter units remain unranked. Quotes preserve quantities, promotion mechanics, membership conditions and unconfirmed local availability.

Optional promotion consensus is bounded at two seconds and falls back only to independently matched weekly offers. Optional assortment enrichment is bounded at one second per query; SKU-resolved products avoid a duplicate product-name scan. Missing enrichment remains unconfirmed rather than inventing local stock. The reproduced nine-second name lookup no longer holds the price answer open.

## Demo microphone

The demo prefers the physical MacBook/built-in input and publishes the same permission-approved track. Republish keeps the selected physical device, rather than reopening the system default. The selected device is visible and can be changed explicitly. Browser privacy may hide labels before first permission; the app reselects the built-in input once labels are exposed. It cannot disable macOS Continuity globally.

## Evidence and operations

- Resolve audio settings once per session and persist them in `pipeline.gptLiveAudio` and the configuration snapshot.
- Record product lookup start/completion directly in private call diagnostics; delayed SDK tool-history events are not evidence of execution time.
- Missing recording configuration now emits a safe reason code instead of silently disabling recording. Local demo recording credentials were restored and subsequent tests saved recordings.
- Continue using the call-review runbook and exporter. Generated transcripts do not prove audio playback; preserve original journals and inspect recordings.
- The current LiveKit Build plan permits cold starts. The reproduced incoming caller hung up before the production agent joined. No billing upgrade was made; production pickup reliability still requires addressing that cold-start dependency.

## Validation and release

379 voice tests and the production voice build passed. The isolated platform release passed 164 tests and its production build; its public price endpoints returned correct results in 0.85–2.73 seconds. Initial deployment probes had transient timeouts; those observations are retained in the private evidence rather than described as a clean first-pass release.

The platform release is `dpl_C5Jk2r67ZPemTwiBGHF7jo3c22uA`. It changes only the reviewed microphone/catalogue files; the existing production dependency lockfile, region, cron schedules and unrelated sources are unchanged.

The 30 September source cleanup also fixes the regression fixture type, removes an unused export and patches the brace-expansion advisory to 5.0.12. Voice tests (379), golden conversation checks (13), full type checking and build pass; the dependency audit reports no vulnerabilities. Publishing uses the existing HelloCara LiveKit project and agent; preserve the 500 ms production override. Production version verification is recorded in the release handover; no new PSTN listening test is claimed here. Private call exports, waveform captures and full incident evidence remain in ignored `call-transcripts/` and must never be committed.
