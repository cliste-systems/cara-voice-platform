# Required evidence for every call review

Use `npm run export:call-review -- --call-id=<call UUID>` with the production environment loaded. If the call-log write failed, use `--capture-id=<capture UUID>` to retrieve the independent journal. For the latest call for one business, use `--organization-id=<organization UUID>`. Do not print credentials or paste raw customer details into logs. Outputs are private files under `call-transcripts/<call UUID>/` (ignored by Git).

Every review bundle contains:
- `review.md`: call identity, time, duration, redacted readable conversation, capture verdict and limitations.
- `raw-transcript.txt`: original collected dialogue turns, with no AI rewrite or inferred speech. Interruption markers describe capture events, not inferred words.
- `raw-events.json`: original source text fragments, speaker, sequence IDs, receipt timestamps, provider timing when available, source labels, health, expected/persisted counts and continuity checks. Source streams may overlap; do not concatenate every source as though they were distinct spoken turns.

Before reviewing:
1. Confirm the intended business and call ID/time, rather than silently selecting another call.
2. Check capture status AND sequence continuity AND persisted event count. No journal, a stopped heartbeat, recognizer errors, reconnects or a greeting-only assistant transcript means PARTIAL / UNVERIFIED.
3. Read caller and assistant turns in order. Use raw provider events when the formatted transcript is disputed. Never fill gaps with summaries, reasoning-model text, tool responses or what the assistant was supposed to say.
4. Provider transcripts describe generated speech. They do not prove that every word played to the caller. Check the existing call recording when judging audio, interruptions, dropped words or a missing provider transcript. If the recording is missing too, report the evidence gap; do not claim a full review.
5. Record the exact faulty exchange, source, cause, corrective change, tests and deployment version. A local test or healthy worker is not proof of a real spoken-call outcome.

## Capture design

Every call starts a private journal before its session begins. Events are saved throughout the call (one-second batches), with stable sequence IDs and idempotent retries. GPT-Live source deltas bypass speech-handle/history limitations; segmentation flushes on idle, caller interruption and shutdown. The original fragments remain independently available even if formatting fails. All other voice modes also save final caller transcripts and conversation items.

Finalization verifies stored event counts and transcript completeness. A minute-by-minute database check marks abandoned captures partial after five minutes without a heartbeat. Temporary write failures retain unacknowledged events in memory for retry. A simultaneous worker crash/database outage can still lose unacknowledged events; this system does not promise lossless speech recognition or impossible zero-failure recording.

Raw journal access is restricted to service-role operations, not anonymous users or normal authenticated clients. Raw text is not sent to ordinary application logs. Journals expire after 30 days and cascade with linked call deletion or organization deletion. The usual staff transcript retains existing sensitive-data redaction; the restricted raw journal is for authorized call review.

## Verification on deployment

2026-09-28: 342 automated tests passed, including direct GPT-Live delta capture without a completed speech handle, early-event replay, interruption and shutdown tails, idempotent recovery after an ambiguous database commit, and events arriving during an in-flight batch. Production build passed. The repository-wide typecheck still reports pre-existing errors in unrelated test/script files; the changed production modules build successfully.

A clearly marked two-event production journal smoke test verified write, count validation and cascade deletion, and its rows were removed. Anonymous and ordinary authenticated roles cannot read the raw events; RLS is enabled. The actual problematic call f6e8da65-0a59-4f84-8544-a28b0d356290 exports as unverified, with zero historical journal captures. This fix cannot retroactively invent its missing assistant text.

The affected call was an engineer/admin simulator call. These previously skipped audio recording explicitly; that exception has been removed for audio calls. Existing disclosure remains required; text-only rehearsals still do not start audio recording. Billing classification is unchanged. The old call has no attached recording, so its missing replies cannot be recovered from the stored evidence.

Final live verification: worker version `5CPHDtUYJ4zd`. Internal synthetic WebRTC call `a484e76c-46cc-4b8d-a8d7-52b885d4d27f` captured two caller turns and four assistant turns, in question-before-answer order. Expected 53 source events; persisted 53; capture status `captured`; audio recording attached. Review bundle export verified sequence continuity. Test used synthesized questions and no PSTN dial-out. An earlier repeat test sent speech during cold startup; the harness now waits for greeting completion and requires both questions and replies to pass.
