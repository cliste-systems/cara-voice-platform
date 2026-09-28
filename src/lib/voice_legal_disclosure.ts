export const VOICE_ASSISTANT_DEFAULT_NAME = 'Cara';

function assistantNameLabel(name: string): string {
  const trimmed = name.trim();
  return trimmed || VOICE_ASSISTANT_DEFAULT_NAME;
}

/** Fixed GDPR / AI Act disclosure — matches cara-platform voiceLegalDisclosure(). */
export function voiceLegalDisclosure(
  assistantDisplayName: string = VOICE_ASSISTANT_DEFAULT_NAME,
): string {
  const assistant = assistantNameLabel(assistantDisplayName);
  return `I'm ${assistant}, the AI assistant. This call may be recorded and transcribed.`;
}
