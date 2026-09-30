# Retail acceptance testing

The full programme and measured catalogue baseline are maintained in the dashboard repository at `docs/ops/CARA-RETAIL-ACCEPTANCE-PLAN.md`.

- `scripts/evaluate-retail-clarification.ts`: actual OpenAI backend prompt/model text rehearsals for 54 broad customer requests across all 18 public departments. Synthetic response/tool records stay under ignored `call-transcripts/`. This does not prove GPT-Live audio or customer-call success.
- `scenarios/retail-all-departments.yml`: 72 real-worker conversations with broad questions and narrow follow-ups; use the existing text-rehearsal harness on an isolated rehearsal-enabled worker. Production text rehearsal is currently disabled, so these scenarios have not been claimed passed on the live worker.
- A tool call is no evidence that the assistant asked a clarification question. The harness requires an actual relevant reply, checks missing answers, and supports `turn_expect` so a final correct answer cannot hide a bad earlier turn.
- For every spoken-call verification, follow `docs/CALL-REVIEW-RUNBOOK.md`, export the intended call bundle, check both speakers and capture continuity/counts, and inspect the recording. Never substitute a model text rehearsal for received speech.

Measured 30 September 2026: the actual production backend instructions/model passed all 54 broad phrasing cases after fixing a grader false negative for the natural question “Which were you after—milk, yogurt, butter or eggs?”. The original failed grading and a separate corrected grading are both retained. The catalogue-only 97,149-case sweep is a separate retrieval/safeguard result.

Production changes add all 18 department-name aliases and stop product pack counts from entering price-only Rewards browsing. Audio transport, voices, prebuffer and capture settings are unchanged. The existing Axios dependency was patched to clear the required security audit.
