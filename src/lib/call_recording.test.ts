import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { EgressClient } from 'livekit-server-sdk';

import {
  callRecordingStagingPath,
  callRecordingStoragePath,
  isSupabaseS3Endpoint,
  resolveCallRecordingDisabledReason,
  resolveEgressS3Config,
  resolveSupabaseStorageS3Endpoint,
  startCallRecording,
  stopActiveCallRecording,
} from './call_recording.js';

function recordingTestEnvironment(t: TestContext): void {
  const original = process.env;
  process.env = { ...original };
  for (const key of Object.keys(process.env)) {
    if (/^(CALL_RECORDING_|SUPABASE_S3_|CARA_OFFLINE_PLAYGROUND)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    LIVEKIT_URL: 'wss://recording-test.livekit.cloud',
    LIVEKIT_API_KEY: 'test-livekit-key',
    LIVEKIT_API_SECRET: 'test-livekit-secret',
    SUPABASE_SERVICE_ROLE_KEY: 'test-supabase-secret',
    CLISTE_APP_URL: 'https://example.test',
    CLISTE_VOICE_WEBHOOK_SECRET: 'test-webhook-secret',
  });
  t.after(() => { process.env = original; });
}

describe('disabled call recording diagnostics', () => {
  it('reports missing staging credentials without requesting egress or exposing secrets', async (t) => {
    recordingTestEnvironment(t);
    const warnings = t.mock.method(console, 'warn', () => {});
    const requests = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
    const egress = t.mock.method(EgressClient.prototype, 'startRoomCompositeEgress', async () => {
      assert.fail('A disabled recorder must not request egress');
    });
    assert.equal(await startCallRecording({ roomName: 'test-room', organizationId: 'test-org' }), null);
    assert.equal(egress.mock.callCount(), 0);
    assert.deepEqual(warnings.mock.calls[0]?.arguments, [
      '[call_recording] disabled', { reason: 'missing_compatible_egress_storage' },
    ]);
    assert.equal(requests.mock.callCount(), 1);
    const request = requests.mock.calls[0]!.arguments;
    assert.equal(request[0], 'https://example.test/api/voice/platform-event');
    const event = JSON.parse(String(request[1]?.body));
    assert.equal(event.event_type, 'recording_disabled');
    assert.equal(event.category, 'recording');
    assert.equal(event.severity, 'warning');
    assert.deepEqual(event.metadata, { room_name: 'test-room', reason: 'missing_compatible_egress_storage' });
    assert.equal(event.organization_id, 'test-org');
    assert.doesNotMatch(JSON.stringify([warnings.mock.calls[0]?.arguments, event]), /test-.*-secret/);
  });

  it('recognizes complete staging configuration and an intentional recording opt-out', (t) => {
    recordingTestEnvironment(t);
    Object.assign(process.env, {
      CALL_RECORDING_EGRESS_S3_ACCESS_KEY: 'test-storage-key',
      CALL_RECORDING_EGRESS_S3_SECRET_KEY: 'test-storage-secret',
      CALL_RECORDING_EGRESS_S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
    });
    assert.equal(resolveCallRecordingDisabledReason(), null);
    process.env.CALL_RECORDING_ENABLED = 'off';
    assert.equal(resolveCallRecordingDisabledReason(), 'disabled_by_config');
  });
});

describe('resolveSupabaseStorageS3Endpoint', () => {
  it('uses the storage hostname for hosted Supabase projects', () => {
    assert.equal(
      resolveSupabaseStorageS3Endpoint('https://rtoebbwzwxcnscsxghww.supabase.co'),
      'https://rtoebbwzwxcnscsxghww.storage.supabase.co/storage/v1/s3',
    );
  });
});

describe('isSupabaseS3Endpoint', () => {
  it('detects Supabase storage endpoints', () => {
    assert.equal(
      isSupabaseS3Endpoint('https://abc.storage.supabase.co/storage/v1/s3'),
      true,
    );
    assert.equal(isSupabaseS3Endpoint('https://abc.r2.cloudflarestorage.com'), false);
  });
});

describe('resolveEgressS3Config', () => {
  it('rejects Supabase endpoints for LiveKit egress', () => {
    const original = { ...process.env };
    try {
      process.env.CALL_RECORDING_S3_ACCESS_KEY = 'test-access-key';
      process.env.CALL_RECORDING_S3_SECRET_KEY = 'test-secret-key';
      process.env.CALL_RECORDING_S3_ENDPOINT =
        'https://abc.storage.supabase.co/storage/v1/s3';
      assert.equal(resolveEgressS3Config(), null);
    } finally {
      process.env = original;
    }
  });
});

describe('call_recording paths', () => {
  it('builds final storage paths', () => {
    assert.equal(
      callRecordingStoragePath(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ),
      '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.mp3',
    );
  });

  it('builds sanitized staging paths per room', () => {
    assert.equal(
      callRecordingStagingPath(
        '11111111-1111-4111-8111-111111111111',
        'RM_abc-123',
      ),
      '11111111-1111-4111-8111-111111111111/.staging/RM_abc-123.mp3',
    );
  });
});

describe('stopActiveCallRecording', () => {
  it('is idempotent when already stopped', async () => {
    const state = {
      callRecordingEgressId: 'eg_test',
      callRecordingStoppedAtMs: 1_700_000_000_000,
    };
    assert.equal(await stopActiveCallRecording(state, 'test'), 1_700_000_000_000);
    assert.equal(state.callRecordingEgressId, 'eg_test');
  });

  it('returns null when no egress id', async () => {
    const state = { callRecordingEgressId: null, callRecordingStoppedAtMs: null };
    assert.equal(await stopActiveCallRecording(state, 'test'), null);
  });

  it('keeps egress id after stop so finalize can upload the MP3', async () => {
    const state = {
      callRecordingEgressId: 'eg_finalize_me',
      callRecordingStoppedAtMs: null,
    };
    const originalStop = process.env.LIVEKIT_URL;
    process.env.LIVEKIT_URL = '';
    try {
      const stoppedAtMs = await stopActiveCallRecording(state, 'caller_left');
      assert.ok(stoppedAtMs);
      assert.equal(state.callRecordingEgressId, 'eg_finalize_me');
      assert.equal(state.callRecordingStoppedAtMs, stoppedAtMs);
    } finally {
      if (originalStop === undefined) delete process.env.LIVEKIT_URL;
      else process.env.LIVEKIT_URL = originalStop;
    }
  });
});
