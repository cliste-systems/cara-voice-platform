# Deli regression verification

The search tool distinguishes an initial broad department question from an explicit broader follow-up after a completed lookup. Broadening replaces the old product filter and includes counter and pre-pack unless the caller repeats a location restriction. This policy applies across departments. Deli flavour/preparation qualifiers cannot inherit another item's promotion. Future campaign questions cannot be answered with today's promotions, and allergen answers require verified evidence.

## Repeatable checks

Synthetic scenarios and reports belong in ignored `call-transcripts/`; do not put customer exports in fixtures or commits. Revalidate sampled SKUs against current source records before treating a missing former offer as a retrieval failure. An intentionally withdrawn offer should receive an honest unconfirmed answer, never a neighbouring product's promotion.

Run the answer-model harness with the current demo model and live tools:

```sh
node --import tsx scripts/evaluate-deli-gateway.ts <synthetic-scenarios.json> <ignored-report-directory>
```

It records each answer, lookup, timing, source result and failed check. Requests are paced to avoid the shared inference token quota. `DELI_TEST_RESUME=1` resumes successful cases and preserves earlier failures separately. Credit exhaustion stops new cases; it never becomes a pass. The model and response budget can be set with `DELI_TEST_MODEL` and `DELI_TEST_MAX_TOKENS`. These text tests do not establish audible delivery.

The direct-tool replay is a separate layer:

```sh
node --import tsx scripts/verify-deli-lookups.ts <synthetic-scenarios.json> <previous-model-results.json> <ignored-report.json>
```

Do not describe its success as answer-model or voice success. For a synthetic voice check, `scripts/verify-transcript-audio.ts` accepts an optional `--third-wav` to test broad question → specific product → wider department. Export that call using the call-review runbook and verify both speakers, capture counts and sequence continuity before calling it complete.

## 2026-10-03 verification

100 deli scenarios completed at the live-tool layer: 140 tool executions, zero failed cases. Production build, 442 automated checks and 13 demo checks passed. An earlier full answer-model run exposed wrong-variant substitution, broad lunch/multibuy selection, current-offer substitution for a future date, and an unsupported food-safety procedure claim. Those failures were corrected and preserved privately.

The final corrected model run passed 18 complete conversations before LiveKit rejected subsequent requests with `MaxGatewayCredits`. The final 100-answer run and synthetic voice verification remain incomplete until inference credits are restored. The synthetic voice capture was partial, with no caller turns. Its caller WAVs were subsequently found to contain zero samples; the harness now validates nonempty PCM16 audio before creating a room and feeds silence between questions for VAD. That invalid attempt is not evidence of a successful call. Public data contains national counter products but does not currently publish a verified national deli-counter promotion. Do not turn that source limitation into a claim that the shop has no counter deals.
