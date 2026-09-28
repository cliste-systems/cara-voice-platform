# Long browser call review - 27 September 2026

Call `17258503-dd57-4365-8969-5e6d45a0bfbb`, job `AJ_VQ4AERBjg7wL`, source diagnostics `a5e67915`. The browser session lasted 149.9 seconds. The logged 176 seconds includes worker shutdown and is not the listening duration. The caller reported no static, but an unrelated opening story.

## Confirmed opening fault

Independent transcription of the captured provider audio confirms an unrelated story involving a dog, a rabbit/deer and a bear. This matches the caller's recollection. GPT-Live's native transcript instead claims the configured shop greeting over the same opening interval. Therefore the native transcript and the stored "verbatim" transcript cannot establish what was actually spoken.

The first 45 seconds of provider audio and emitted audio, after removing two milliseconds of flagged silence padding, are byte-identical. Their PCM SHA-256 is `535906bbb756e2d97780721600a555aee8f60df2ee5e80d77563c813bf8605a2`. The capture receives only SDK `session.output_audio.delta` frames; microphone input follows a separate path. The SDK decodes those deltas directly into fresh PCM arrays. No application story text or reference recording is injected.

The mismatch was present before buffering and LiveKit publication. Its underlying provider cause remains unknown; this evidence does not establish cross-session leakage. A separate direct WebSocket test with GPT-Live 1, Willow and the same pronunciation/greeting instructions produced the correct greeting. The issue is not consistently reproducible.

### Opening safeguard

- A clean nine-second GPT-Live/Willow greeting was generated independently. Transcription of both the original and trimmed audio confirms the requested words. Only edge silence was removed; at least 250ms of near-zero audio remains at each edge.
- The asset and manifest are in `assets/gpt-live/`. Startup checks the exact configured greeting, voice, model, independent transcript, WAV format and SHA-256. Invalid assets stop startup instead of falling back to unverified speech.
- With `CARA_GPT_LIVE_OPENING_MANIFEST` enabled, the application plays this checked clip before configuring the live provider session. Microphone input and generation requests are held off during the clip. Afterwards the model receives the greeting as history and instructions to wait for the caller, not greet again.
- Repeated playback requests cannot replay the greeting. Disconnects and failed deferred configuration close cleanly. Text rehearsal bypasses this audio-only opening path.
- This prevents freshly generated speech from replacing this configured opening. It does not guarantee the content of every subsequent live-model response.

## Audio quality

The recorded WAV files are capped at 120 seconds, so detailed waveform checks cover the opening two minutes. Numeric worker and browser diagnostics cover the longer call.

| Check | Result |
| --- | --- |
| Provider format | PCM16 little-endian, 24 kHz, mono; 100ms source frames |
| Full-call source audio | 142.4 seconds |
| Clipped samples | Zero |
| Peak magnitude | 30,208 / 32,768, about -0.71 dBFS |
| Browser intervals | 47 |
| Browser packet loss | Zero |
| Browser concealment | 7 events, 6,429 samples, approximately 134ms at 48kHz |
| Reported jitter | At most 4ms |
| Browser average jitter-buffer delay | Approximately 33-107ms |
| Captured emitted audio | 118.586s provider PCM + 1.414s inserted silence |
| Source sample changes after removing padding | Zero changed, lost or reordered samples |
| Padding | 114 insertions of 1-20ms, each after at least 200ms of digital silence |
| Largest introduced padding-boundary change | One PCM count |

Over the comparable captured interval, estimated immediate-playback gaps fell from approximately 1,615ms without the cushion to 141ms with it, a reduction of about 91%. Remaining estimated gaps preceded near-silence; none preceded captured frames above the existing speech threshold. Startup buffering held the first source audio for approximately 100ms to accumulate 200ms of media.

These are measurements and estimates before native playback, not acknowledgments from the listener's speakers. Together with the caller's clean listening report, they support keeping the 200ms cushion. They do not prove static can never recur. DTX remains off and RED remains on.

## Rest of the conversation

Independent transcription of provider audio from 45-120 seconds closely matches the native conversation text and contains no further story. It confirms:

1. Cara reused one "Brendan" answer for both the cake inscription and collection name.
2. She said she would check Monday availability, then asked about servings without giving a check result. No relevant lookup execution appears in the call logs.
3. She described the cake as down for collection before the bakery had confirmed it.

The voice and backend prompts now require separate inscription/collector questions, confirmation after readback, and explicit distinction between a request and an accepted order. They prohibit claiming availability, completed checks, saved requests or handoffs without the corresponding confirmation.

The inspected post-call path collects generated actions but does not visibly execute or forward them in the reviewed enrichment payload. This is a separate fulfillment concern; database state was not queried, so this review does not assert that a particular ticket is absent. The prompt now avoids claiming a completed handoff that the voice session cannot confirm. No customer-facing message or order was sent as part of this investigation.

The existing call log also places the continuous assistant transcript at the end and duplicates the manually logged greeting. It remains unsuitable for reconstructing exact turn order or auditing actual speech. The bounded local PCM capture and independent transcription provided the evidence for this review.

## Validation and scope

- Worker build and all 54 focused buffer, capture, asset validation, startup lifecycle and prompt tests pass.
- A real GPT-Live integration check played the fixed opening byte-for-byte, then started the provider and answered "Hello, can you hear me?". Independent transcription of the reply segment confirms "Yeah, I hear you just fine. Go ahead there, what can I do for you?" No API errors occurred. The whole-file recognizer omitted that later reply, so it was verified separately rather than relying on one recognition result.
- The local worker re-registered at 19:11:49 UTC with the 200ms cushion, verified opening manifest, and bounded assistant-output capture. Buffer and opening settings are saved in the local `.env`; audio capture remains an explicit process-only option.

## Successful follow-up and production deployment

The caller described follow-up call `6e373b3a-5785-42fa-a31b-01edc9a2fd48`, job `AJ_ttu5o2HCkPbr`, as fantastic. Its captured opening is sample-for-sample identical to the checked nine-second Willow asset. Removing local clips and flagged padding gives exactly the first 108.28 seconds of provider PCM: zero changed, dropped or reordered samples. The provider peak is 23,296/32,768 (about -2.96 dBFS), with no clipping.

The source still delivered 100ms chunks at intervals up to 207.083ms. Over the same 106.4 seconds of comparable live provider audio, immediate-playback modelling estimates 2,058.415ms of total empty time, versus 29.690ms from emitted-frame arrival after buffering (98.56% less). All four remaining estimated gaps occur around silence or very quiet tails; speech-bearing frames retain at least 21.406ms of modelled reserve. Startup waited 101.384ms to accumulate 200ms of audio. Padding totals 1.976 seconds across 143 additions of 1-20ms, all after at least 200ms of digital silence, with a maximum introduced boundary step of one PCM count.

These are queue estimates before native playback, not measured speaker dropouts. Together with the caller's successful listening test and the earlier unsuccessful DTX-only test, they strongly support the 200ms cushion and silence-only replenishment as the main static improvement. They do not isolate model delivery, networking or worker scheduling as the origin of the delays.

At the user's request, the tested worker was deployed to LiveKit Cloud agent `CA_B35YRGc9r4Fh`, version `c95ezBW323HT`, at 19:43:24 UTC on 27 September. Runtime logs confirm registration as `cliste-retail-node` in Frankfurt, and cloud status is Running. SIP rule `SDR_AvkCP3skYeGj` still maps the trunk containing `+353749759508` to this agent. Overrides are Willow voice, the 200ms cushion, and the checked Kavanaghs opening manifest. Existing credentials were preserved and production output capture remains disabled. The previous image version is `vCB8RKVgUzWF`.

Pre-deployment verification passed: TypeScript build, all 324 unit tests across 71 suites, 13 demo golden tests, and diff whitespace checks. A real phone listening test is still required to assess the complete PSTN path.

The deployed worker also passed an isolated cloud WebRTC smoke call at 19:47 UTC, job `AJ_Tbz8on9pqXyD`. It loaded the nine-second verified opening and answered a locally synthesized caller question. Independent transcription of the received audio confirms the exact shop greeting and the requested reply, "Hello." The engineer-test room was deleted after capture; no outbound telephone call was placed. Runtime emitted one 297.8ms event-loop warning during initial startup; the subsequent opening/live transition completed. This short test verifies deployed routing, asset loading, voice selection, audio delivery and live-provider startup, but does not establish long-call phone quality. Results and received-audio files are in `outputs/audio-investigation-2026-09-27/cloud-smoke-4e05379b-a27d-4469-9685-a8c68311bd94/`.

## Evidence locations

- `outputs/audio-investigation-2026-09-27/calls/`: captured WAVs, arrival/sample timeline, and independent opening/rest transcripts.
- `outputs/audio-investigation-2026-09-27/opening-probe-2026-09-27T19-raw/`: raw WebSocket probe and checked greeting validation.
- `outputs/audio-investigation-2026-09-27/verified-opening-integration*`: actual-model transition check.
- `/tmp/cliste-audio-worker.log`: numeric diagnostics and local worker lifecycle.

Provider protocol references: [OpenAI GPT-Live sessions](https://developers.openai.com/api/docs/guides/live-conversations) and [LiveKit GPT-Live integration](https://docs.livekit.io/agents/models/realtime/plugins/gpt-live/). The content mismatch conclusion above comes from this call's captured audio and independent transcription, not from those documents.
