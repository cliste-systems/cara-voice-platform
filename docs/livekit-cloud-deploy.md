# LiveKit Cloud Agents deployment

Production voice worker on **LiveKit Cloud Agents** (`eu-central`, Frankfurt) in project **hellocara**.

## Production identifiers (Sept 2026)

| Resource | ID |
| -------- | -- |
| Project | `hellocara` (`p_4isoiid8ii2`) |
| URL | `wss://hellocara-dfp4tf8y.livekit.cloud` |
| Agent | `CA_B35YRGc9r4Fh` |
| SIP host | `4isoiid8ii2.eu.sip.livekit.cloud` |
| SIP trunk | `ST_qQvnypas9eNp` |
| Dispatch rule | `SDR_AvkCP3skYeGj` → `cliste-retail-node` |

EU data residency: project data region **European Union (Frankfurt)**. Inference region restriction enabled in dashboard.

## Preconditions

1. LiveKit Cloud project **`hellocara`** with EU (Frankfurt) data region
2. Agent compute **`eu-central`** (set on first `lk agent create`)
3. Ship plan ($50/mo) — production agents stay warm 24/7
4. `lk cloud auth` and `lk project set-default hellocara`

## Secrets

```bash
cp secrets.production.env.example secrets.production.env
# Fill from production env / Vercel. Never commit secrets.production.env.
```

Omit `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` — LiveKit Cloud injects these at runtime.

## Deploy

```bash
lk agent deploy --secrets-file secrets.production.env
lk agent status
lk agent logs
lk agent rollback   # if needed
```

CI: [`.github/workflows/deploy-livekit-agent.yml`](../.github/workflows/deploy-livekit-agent.yml)

## Local dev

Keep `LIVEKIT_AGENT_NAME=cliste-voice-local` in `.env` so local workers do not steal production dispatches (`cliste-retail-node`).

## GPT-Live audio settings deployed 27 September 2026

`CARA_GPT_LIVE_PREBUFFER_MS=200` enables the tested startup cushion and silence-only replenishment. `CARA_GPT_LIVE_OPENING_MANIFEST=assets/gpt-live/kavanaghs-willow.json` plays the independently checked Willow greeting before starting the live conversation. The runtime image includes the asset. This manifest is specific to the exact Kavanaghs greeting and Willow voice; a mismatch stops startup and requires a newly checked asset. Text rehearsal bypasses this audio-only opening.

These settings and `CARA_GPT_LIVE_VOICE=willow` were deployed to version `c95ezBW323HT` at 19:43:24 UTC. The version is available and running; runtime logs confirm worker registration as `cliste-retail-node`. The existing SIP dispatch still routes the trunk containing `+353749759508` to that agent. Deployment updated only these three settings; existing credentials and agent-name settings were retained. Keep `CARA_GPT_LIVE_AUDIO_CAPTURE_DIR` unset in production; it is an explicit local debugging option. See [the long-call review](long-call-review-2026-09-27.md) for evidence and remaining limitations.

Previous image version: `vCB8RKVgUzWF`. If rolling back to code without the verified-opening feature, review the associated setting overrides as well. With CLI v2.16.0, pass each override as a separate `--secrets KEY=VALUE` flag; do not comma-separate them. Do not deploy the local `.env`, which selects `cliste-voice-local` and a localhost webhook.

Post-deployment check: an isolated engineer WebRTC call through `cliste-retail-node` played the correct checked greeting and answered a synthetic caller. Independent transcription of received audio confirmed both. The test room was deleted. Actual PSTN listening remains to be tested.

## Twilio SIP

Production uses Twilio Elastic SIP Trunk origination → `sip:4isoiid8ii2.eu.sip.livekit.cloud`.

To update Twilio after a project change: [`scripts/update-twilio-livekit-sip.sh`](../scripts/update-twilio-livekit-sip.sh)

## Decommissioned (do not use)

- **Railway** voice worker — removed Sept 2026
- **LiveKit `cliste-salon-test`** (`p_4crcl51h1rh`) — US data region; delete in LiveKit dashboard after cutover
