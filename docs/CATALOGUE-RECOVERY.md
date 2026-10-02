# Catalogue recovery

Cara normally reads the catalogue through the production app. After a two-second stall, or a transient failure, it starts one independent read through its existing server-side Supabase connection. The first successful read wins and the other is cancelled. Reads have bounded deadlines; actions, orders and messages are never retried this way.

The independent path executes the app's reviewed lookup handler and matching modules, pinned in `src/lib/catalogue-runtime/manifest.json`. It checks the called-number assignment, active retail organisation, SuperValu banner, current offer dates, source freshness and shop assortment exactly as the app does. It does not infer local stock from a national listing. Credentials stay in the worker environment. Bounded public cache refreshes may finish for other callers after their first caller cancels; private access reads remain cancellable.

The worker and build jobs prefer IPv4 DNS results on dual-stack hosts to avoid the observed unreachable IPv6 paths. This preference retains support for IPv6-only hosts. Recovery opens fresh connections, and treats wrapped database cancellation errors as transport failures.

After changing the app catalogue logic, run `python3 scripts/sync-catalogue-runtime.py ../cara-platform`, review the generated diff, run both repositories' tests and builds, and deploy both. Do not edit generated matching code independently. The worker adapter in `catalogue-runtime/utils/supabase/admin.ts` uses worker credentials and cancellable fetches; it is intentionally separate from the app's adapter.

If both the app and database are unavailable, the lookup must fail explicitly. It must never turn a service failure into “no offers” or quote expired data. No distributed service can guarantee permanent availability.

Production answer tests use `scripts/evaluate-random-offers.ts`. `OFFER_TEST_RESUME=1` resumes saved results; `OFFER_TEST_CONCURRENCY` allows up to six independent conversations. Keep results in ignored `call-transcripts/`. These are backend/model tests, not evidence of audio delivered to a caller.
