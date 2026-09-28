# Department clarification review — 28 September 2026

## Evidence

Call `e8737802-ed41-4081-bbf2-25ce3bfbdf20`, 00:10 Dublin (23:10 UTC on 27 September), duration 73 seconds. Private review bundle is in the ignored call-transcripts directory. The saved assistant block moves from an alcohol-department offer request directly into beer and wine examples without establishing the caller’s preference. The call predates the raw journal: zero captures, unverified completeness, and collapsed assistant timing. This is evidence of the unwanted selection behaviour, not a claim of a complete timed audio review.

## Change

The shared voice and reasoning policy now requires one useful product-preference question for every broad department. Counter/pre-pack identifies location, not product preference. Known product choices must not be asked again; explicit invitations to choose examples are honoured. The product tool also returns clarification with no product matches and performs no catalogue request for a broad department. Follow-up preferences retain scope; an explicit new department can replace it. Fallback searches cannot silently broaden a department query into random products.

Coverage includes alcohol, deli, butcher, fish, bakery, dairy, produce, frozen, household, baby, pets, health/beauty, personal care, food cupboard and other explicitly named departments. The prompt applies the same clarification principle to services, orders and other ambiguous requests.

## Verification

Production TypeScript build passed. All 348 automated tests passed, including broad-department guards, specific product requests, explicit examples, follow-up refinement, department changes, retaining a counter choice after product refinement, and existing audio/transcript regression coverage.

Final production worker `apHJ9hxe93yR` is running (deployed 23:56:02 UTC). Willow voice, 200 ms prebuffer and verified opening manifest were preserved.

The alcohol/lager synthetic WebRTC test on the initial release `27Z3JWDeWtYR` (same clarification policy and guard; final release additionally preserves counter choice during refinement) is call `7b54e346-6d37-4599-acfb-94cae37f2e0b`. It captured 60/60 source events, both caller turns and four assistant turns; export continuity verification passed and 4,765 audio frames were received. Cara asked what sort of drinks the caller wanted, with beer/wine/spirits examples, before quoting products. After “lager please”, she returned lager offers. She prefaced the clarification with a checking phrase, which is less direct than the ideal wording. This test verifies generated dialogue plus audio reception, not a word-for-word independent transcription of playout. The fixed-duration test disconnected during the final offer response.

The first synthetic attempt was not counted: duplicate capture records during startup caused the harness to wait without sending its questions. The harness now selects the latest capture explicitly. Bakery verification on final release `apHJ9hxe93yR` passed: synthetic call `cdbb845d-3bdc-4fed-afed-2ab28cbd500f`, 65/65 events, two caller turns, four assistant turns, continuity verified, 4,356 audio frames received. Cara asked which bakery type the caller wanted before listing products; after “bread please” she returned bread offers. She included bread/cakes/pastries examples in the clarification. The test disconnected during the final answer, so it does not verify completion of that offer list. Both live tests demonstrate clarification before product selection; neither is a guarantee for every future model response.
