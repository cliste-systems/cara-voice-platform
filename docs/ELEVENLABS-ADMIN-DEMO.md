# ElevenLabs v4 admin demo test

Set `CARA_ADMIN_DEMO_ELEVENLABS=1` on the local worker and supply a valid server-side `ELEVEN_API_KEY` or `ELEVENLABS_API_KEY`. Do not commit credentials. Restart the worker after changing its environment.

Only server dispatch metadata with `source: admin_simulator` activates this test. Normal customer telephone calls retain their existing stack. Disabling the switch restores the original admin demo path.

Voice: `0VXT7iQ2kXG7EERbbG9T`. Model: `eleven_v4_turbo`. The worker uses ElevenLabs' Text to Dialogue WebSocket with PCM at 24 kHz, then LiveKit's sentence stream adapter. The older Text to Speech WebSocket is not the v4 protocol. Connections have bounded deadlines, close on cancellation, and reject incomplete/no-audio responses.

The local dashboard and worker must both use `LIVEKIT_AGENT_NAME=cliste-voice-local`; the worker uses `CLISTE_APP_URL=http://localhost:3001`. The existing admin demo buttons, room connection, transcript capture and recording remain in use.

Verification on 30 September 2026: actual v4 Turbo synthesis produced 9.44 seconds of audio with the requested voice. The first internal WebRTC test exposed a GPT-Live duplex-only tool hook throwing in ordinary pipelines; it is now guarded, with a regression test. Build and 383 automated tests pass. Synthetic test evidence remains in ignored `call-transcripts/`; no PSTN call is required for this check.

Official protocol: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd
