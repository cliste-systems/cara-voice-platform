# Call reviews

For any request to review, diagnose or verify a call, read `docs/CALL-REVIEW-RUNBOOK.md` and use `scripts/export-call-review.ts` to obtain the intended call's review bundle. Verify call identity, raw-event sequence continuity, expected versus persisted counts, capture status and both speakers before claiming a complete review.

Never describe a greeting-only assistant transcript as complete. Never reconstruct missing speech from prompts, model reasoning, tool outputs or an AI summary. If evidence is partial, say exactly what is missing and check the existing call recording. Preserve the raw events and distinguish generated speech from audio actually heard by the caller.

Transcript exports contain private customer data. Keep them in the ignored `call-transcripts/` directory; never commit them or print secrets. Preserve working audio settings when changing transcript capture.
