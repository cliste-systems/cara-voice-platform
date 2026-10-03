import { CARTESIA_SIOBHAN_VOICE_ID } from './tts_config.js';

/** Explicit browser-demo override. SIP calls always retain their own configured stack. */
export function resolveLegacyAdminDemoStack(input: {
  jobMetadata: string | null | undefined;
  isSipCall: boolean;
}) {
  if (input.isSipCall || process.env.CARA_ADMIN_DEMO_STACK?.trim().toLowerCase() !== 'legacy') return null;
  try {
    if (JSON.parse(input.jobMetadata || '{}').source !== 'admin_simulator') return null;
  } catch { return null; }
  return {
    sttModel: 'assemblyai/universal-3-6-pro',
    llmModel: 'google/gemma-4-31b-it',
    llmProvider: 'gateway' as const,
    tts: {
      model: 'cartesia/sonic-3.6',
      voiceId: CARTESIA_SIOBHAN_VOICE_ID,
      language: 'en',
      label: `cartesia/sonic-3.6:${CARTESIA_SIOBHAN_VOICE_ID}`,
    },
  };
}
