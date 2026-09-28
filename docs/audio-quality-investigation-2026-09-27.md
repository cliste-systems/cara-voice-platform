# GPT-Live voice audio investigation — 27 September 2026

The reported symptom is recurring static or clipped word beginnings on both phone calls and browser tests. GPT-Live 1 and the Willow voice remain selected. The initial inspection added diagnostics only; the follow-up changes are described below. After two successful local listening tests, the tested worker and audio settings were deployed to production version `c95ezBW323HT` on 27 September at 19:43:24 UTC, at the user's request.

Latest result: the caller described the following test, call `6e373b3a-5785-42fa-a31b-01edc9a2fd48`, as fantastic. Its checked nine-second opening matched the approved asset exactly. Over a comparable 106.4-second interval, estimated playback starvation fell from 2,058ms to 30ms with the cushion, with no changed spoken samples. See [the long-call review](long-call-review-2026-09-27.md) for evidence and limitations. Earlier sections below are a chronological record of prior comparison stages, including their then-current deployment state.

## Follow-up after the first browser test

The user reported substantially improved speech with a residual roughly half-second static sound sometimes before speech, plus an insufficiently Irish accent.

During the active portion of the measured call, 76.9 seconds of source audio arrived over 78.65 seconds. The maximum source arrival interval was 181.71 ms and the largest estimated immediate-playback gap was 79.71 ms. No digital clipping was observed. Most recorded gaps preceded digitally near-silent frames. The final close snapshot includes a shutdown wait and must not be treated as an additional 32 seconds of missing audio. Browser UI recorded no audio-delivery warnings; numeric details from the first call were rendered as `Object` by the browser log reader, so that is not a complete packet-level verification. Logging now serializes numeric details for subsequent tests.

The next local comparison explicitly publishes GPT-Live output with **DTX disabled and RED enabled**. DTX is Opus discontinuous transmission during silence. The native defaults enable it, and [LiveKit issue #1954](https://github.com/livekit/agents-js/issues/1954) reports audible silence-boundary artifacts. Installed Agents 1.9.0 includes the [fix that honors these publish options](https://github.com/livekit/agents-js/pull/2076). Disabling DTX is a targeted experiment, not a confirmed explanation of this call's noise. RED remains enabled for packet-loss recovery.

The spoken persona and greeting now explicitly request native Donegal Irish English pronunciation, vowels, rhythm and intonation from the first word. Conflicting "default voice" instructions were removed. The backend is told to use plain conversational English without adding slang to imitate an accent. The audible strength of the accent still requires listening.

The optional prebuffer has been hardened for a later isolated comparison, but remains **0 ms** for this DTX test. Its opt-in path now gathers the initial cushion once, never re-holds active speech, and replenishes with at most 20 ms of silence only after 200 ms of digitally near-silent source audio (absolute sample values at most 2). Six deterministic tests cover startup, timer bounds, speech preservation, silence-only padding, the lead cap and unchanged zero-buffer delivery. Only a future explicitly enabled buffer test would alter the playback cushion. These follow-up changes apply to the local worker; production has not been deployed.

Follow-up verification: build and 35 focused tests pass; frontend diagnostics lint passes. Explicit DTX-off/RED-on values survive native option serialization. The local worker re-registered with the updated code. Audible static and accent quality remain for the next listening test.

## DTX-off listening test: static near "details for the team"

The user still heard static around that phrase in the 18:35 UTC test. Disabling DTX therefore did not eliminate the reported problem.

- Local call: `5a0e5cd9-e91d-4f7f-b36b-6ba482c055e9`; source diagnostic ID `9f19bf2f`.
- All twelve browser measurement intervals reported zero packet loss, zero concealed samples and zero concealment events. Reported jitter was 1 ms; average jitter-buffer delay was approximately 31-34 ms. This is evidence of healthy delivery to the browser, not proof that the upstream waveform was clean.
- The source delivered 373 frames / 37.3 seconds of PCM with no digital clipping. Maximum arrival interval was 178 ms; the largest estimated immediate-playout gap was 77 ms. No source frames were held by the wrapper and no silence was inserted in this test.
- The saved transcript contains the greeting and four caller turns, but omits subsequent assistant replies. The quoted phrase therefore cannot be aligned precisely. If it followed the first cake-order question, no estimated source gaps of at least 10 ms occurred in the likely reply window. The audio was not recorded for this engineer test, despite the generic `recording_start_at_greeting` log.

The next controlled local test sets `CARA_GPT_LIVE_PREBUFFER_MS=200` while preserving GPT-Live 1, Willow, DTX-off, RED-on and the pronunciation instructions. This is a bounded experiment to absorb delivery irregularity, not a confirmed fix. The code default remains zero.

Local assistant-output capture is enabled for the next test via `CARA_GPT_LIVE_AUDIO_CAPTURE_DIR=outputs/audio-investigation-2026-09-27/calls`. It saves provider PCM, wrapper output PCM and transcript-delta timing, including provider timestamps when available. It excludes microphone input and caps each audio file at two minutes. Comparing those files can distinguish noise already in generated PCM from changes introduced before publication; neither file is a recording of the browser's received audio. WAVs concatenate frames; arrival gaps and inserted-silence offsets are documented in the accompanying JSON. File writes happen asynchronously on close and capture failures do not interrupt speech.

The worker restarted and registered as `cliste-voice-local` at 18:43:52 UTC with the 200 ms local override and capture enabled. Both settings are process overrides; the checked-in defaults remain unchanged. The next user listening test is pending.

## Source timing finding: uneven delivery

A 32-second synthetic test connected directly to GPT-Live through the installed OpenAI plugin, before the application's audio wrapper or LiveKit room transport. It used Willow, client delegation with no tools, a fixed spoken test sentence, and silent input frames paced at 100 ms. This is a local-machine control, not a reproduction of the production phone call or its backend delegation.

| Measurement | Result |
| --- | --- |
| PCM format | Signed 16-bit little-endian, 24 kHz, mono |
| Output chunk size | 2,400 samples / 100 ms |
| Frames received | 277 |
| Audio duration | 27.7 seconds |
| First-to-last arrival interval | 29.473 seconds |
| Median arrival interval | 100.2 ms |
| 95th percentile arrival interval | 196.1 ms |
| Longest arrival interval | 448.1 ms |
| Largest estimated gap with immediate playback | 324.8 ms |
| Estimated cumulative immediate-playback gaps over 2 ms | 1,868.7 ms across 39 gaps |
| Peak sample magnitude | 15,232 / 32,768 |
| Samples at the digital clipping threshold | 0 |

This establishes uneven arrival timing on this test path. It does **not** prove that a particular heard glitch was an underrun, that gaps overlapped speech, or whether the delay originated in OpenAI, network delivery, or local scheduling. Buffering can absorb some gaps. No digital clipping was measured; that does not rule out noise synthesized into the waveform.

The local application's prebuffer defaults to **0 ms**. Its **8,000 ms** RoomIO queue is a capacity limit, not a guaranteed reserve of audio before playback. Increasing capacity alone does not establish a playback cushion.

The ignored `outputs/audio-investigation-2026-09-27/` directory contains `provider-timing.json` and `provider-audio.wav`. The WAV concatenates PCM chunks, removing arrival-time gaps, and can be compared by listening against live playback. It contains only the synthetic test, not a customer call.

## Other findings

- The installed LiveKit GPT-Live gate discards low-level frames before opening and has no preroll. A synthetic test confirmed rejection below approximately −55 dBFS. This can remove quiet onsets, but the current local application already bypasses that gate. It is not an explanation for current local glitches by itself.
- The original optional prebuffer inserted whole silent frames after low-amplitude source frames. Quiet phonemes could meet its threshold. The replacement described above restricts replenishment to digital silence and small increments.
- Cara Platform uses standard `RoomAudioRenderer` playback. No custom output decoding, gain, resampling, or repeated attachment was found. Its existing microphone republish on agent arrival could affect startup/input but does not explain recurring output static across both phone and browser.
- Dedicated GPT-Live plugin output and RoomIO use matching 24 kHz mono audio. No evident format mismatch was found.
- Known upstream odd-byte stream and Python partial-frame fixes concern different paths. No confirmed applicable upstream fix was identified.
- Prior local comments blaming queue overflow, transcript synchronization, or interruptions are hypotheses, not established incident evidence.

## Deployment and local comparison

- Cloud project: `hellocara`; agent `CA_B35YRGc9r4Fh`, Frankfurt.
- Current deployment: `vCB8RKVgUzWF`, deployed 25 September 2026 at 12:26:25 UTC.
- Cloud status during inspection: sleeping. Build logs were available; runtime tail returned that the agent had shut down due to inactivity and would wake on a session.
- The deployment cannot be mapped confidently to the current dirty working tree from those logs. Numerous pre-existing local audio changes were preserved.
- Installed worker dependencies: LiveKit Agents and OpenAI plugin 1.9.0; RTC Node 0.13.35. Frontend: LiveKit client 2.22.3, React components 2.9.24.
- Previous configured stack: AssemblyAI transcription, Gemma reasoning, Cartesia speech. Its source and playback characteristics differ from continuous GPT-Live output; the hosting move alone is not established as the cause.

## Diagnostic changes for the next test

1. Worker: opt-in `CARA_GPT_LIVE_AUDIO_DIAGNOSTICS=1` logs numeric source timing, format, clipping, inserted silence and wrapper backlog every five seconds and on close. Estimated playback gaps are explicitly labelled estimates. No PCM or transcripts are logged by this instrumentation.
2. Browser admin demo: numeric incoming audio statistics every three seconds, including packet-loss and concealment deltas, jitter and average jitter-buffer delay. The engineering log shows rate-limited warnings; detailed counters stay in the browser console as `[demo-call-audio]`.

The local dashboard is at `http://localhost:3001/admin/demo-calls`. Dashboard and worker both select `cliste-voice-local`; the worker's webhook URL is `http://localhost:3001`. This routes browser test calls to the instrumented local worker. Phone calls still use the existing production deployment.

Runtime logs for this session:

- Dashboard: `/tmp/cliste-audio-dashboard.log`
- Worker: `/tmp/cliste-audio-worker.log`

## Test procedure

Use the GPT-Live Kavanaghs demo line and talk for one to two minutes. Include a few pauses before Cara speaks again. Note the affected word and approximate point in the call. Compare that time against worker source gaps and browser loss/concealment. A gap in source delivery without browser loss favors an upstream/source timing issue; browser loss or concealment requires examining the transport too. Neither counter alone establishes the audible cause. Listen to the gapless provider sample if we need to distinguish waveform artifacts from streaming artifacts.

Then make one bounded playback change and repeat the same phrases. Keep the model and voice fixed to isolate the cause.

## Validation

- Worker build and 41 focused prompt, GPT-Live, diagnostics, buffer and capture tests pass. Capture verification checks unchanged PCM, valid WAV output, bounded storage, failure handling and graceful completion through the playout wrapper.
- Frontend diagnostic file passes targeted lint and has no errors in the TypeScript check. The full repository checks report unrelated pre-existing errors elsewhere.
- Authenticated browser tests completed successfully. The DTX-off test still had user-reported static despite clean browser delivery statistics. The 200 ms cushion and local output capture await the next listening test.
- Local worker registered successfully with LiveKit in Frankfurt.

## Primary references

- [OpenAI GPT-Live WebSocket audio](https://developers.openai.com/api/docs/guides/voice-websockets)
- [LiveKit GPT-Live integration](https://docs.livekit.io/agents/models/realtime/plugins/gpt-live/)
- [LiveKit Node duplex gate and adapter](https://github.com/livekit/agents-js/blob/main/agents/src/llm/duplex_adapter.ts)
- [LiveKit GPT-Live plugin](https://github.com/livekit/agents-js/blob/main/plugins/openai/src/realtime/gpt_live_model.ts)
