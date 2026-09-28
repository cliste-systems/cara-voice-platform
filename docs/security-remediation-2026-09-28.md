# Security remediation status — 28 September 2026

The worker and migration changes in this checkout respond to the security review. The customer authorization migration is applied to the connected Supabase project (recorded version `20260928112228`). Owner-write policies, complete usage aggregation, durable email budgets, and atomic authentication limits were applied and verified on 28 September. Application/worker deployment status must be checked separately; a Git push does not by itself prove rollout.

## Ready for review

- `supabase/migrations/20260928002215_harden_customer_authorization.sql` makes the current organization helper check account membership, rejects customer updates to authorization, billing, operational and file-storage fields, and revokes public execution of four backend-only functions.
- File signing reloads the tenant's send-enabled record and requires the object's path to begin with that tenant's UUID. Existing files using another path scheme will no longer be sent until a trusted migration updates them. Storage path data was not inspected because automatic approval review rejected that sensitive read.
- The voice worker waits for disclosure playout before recording, refuses interrupted or uncertain playback, binds SIP calls to the trunk's dialed number, and removes caller ID and room-name billing exemptions.
- Per-call SMS duplicate suppression and a three-message limit now cover both direct Twilio and webhook sends. Quota lookup errors refuse metered calls, and calls have a 30-minute default maximum. Caller email now carries a trusted room ID and shares the three-message per-call SMS/email budget. The backend enforces durable email budgets (three per call/recipient-hour, 60 per organization-hour, 300 per organization-day), lease-based duplicate suppression, and provider idempotency. Quota totals use the complete database aggregate. Atomic call-admission reservation remains separate follow-up work.
- The erasure script now requires an organization UUID and covers linked raw transcript events, names, usage, test reports, Supabase recordings and staging objects. The manual retention script also purges old raw events. Provider-held copies and the separate dashboard retention cron still require end-to-end verification.
- CI no longer rewrites the lockfile and now blocks on type errors. Three fixable transitive dependencies are pinned to patched versions. Both dependency audits now report zero vulnerabilities. LiveKit remains on the working 1.9.0 family; patched sharp/adm-zip overrides pass native smoke checks and voice tests.

## Before production rollout

1. The database changes are applied. Rollback-only SQL regressions verify owner/member/tenant/storage isolation, full usage aggregation beyond 1,000 records, email leases/idempotency and all email limits; no fixtures remain.
2. Verify a valid tenant file can still be signed and a file row pointing at another tenant's object cannot. Migrate legacy paths through a trusted server process if required.
3. Deploy the worker only after the database migration, then make an interrupted-disclosure call, an ordinary call, a file-send call, and an erasure dry run in a test tenant.
4. Review dashboard webhooks, atomic quota/concurrency controls, branch protection, recording retention jobs, provider copies, and LiveKit token grants in their owning systems. These are not resolved by this checkout.

Current verification: TypeScript and production build pass; 369 unit tests and 13 demo golden tests pass. Supporting database functions and policies are applied and tested using transactions that roll back. Deploy the updated worker after the database migration and before the updated web email endpoint. The old endpoint safely ignores the added `call_session_id`; the new endpoint requires it. Wait for old active worker sessions to drain before promoting the web endpoint.
