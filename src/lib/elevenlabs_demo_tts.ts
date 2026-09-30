import { AudioByteStream, tokenize, tts, type APIConnectOptions } from '@livekit/agents';
import type { AudioFrame } from '@livekit/rtc-node';
import { WebSocket } from 'ws';

export const ELEVEN_DEMO_VOICE = 'ehKZw5kruBt73Gytae2x';
export const ELEVEN_DEMO_MODEL = 'eleven_v4_turbo';

/** Server-dispatched admin demos only; customer phone calls keep their configured stack. */
export function useElevenLabsDemo(jobMetadata: string | null | undefined): boolean {
  try {
    return JSON.parse(jobMetadata || '{}').source === 'admin_simulator' &&
      process.env.CARA_ADMIN_DEMO_ELEVENLABS === '1';
  } catch { return false; }
}

export class ElevenLabsDemoTts extends tts.TTS {
  label = `elevenlabs/${ELEVEN_DEMO_MODEL}:${ELEVEN_DEMO_VOICE}`;
  constructor(readonly apiKey: string) {
    super(24000, 1, { streaming: false, alignedTranscript: false });
    if (!apiKey?.trim()) throw new Error('ElevenLabs demo key is missing');
  }
  get model(): string { return ELEVEN_DEMO_MODEL; }
  get provider(): string { return 'ElevenLabs'; }
  synthesize(text: string, options?: APIConnectOptions, abortSignal?: AbortSignal): tts.ChunkedStream {
    return new ElevenDialogueChunk(text, this, options, abortSignal);
  }
  stream(options?: {connOptions?: APIConnectOptions}): tts.SynthesizeStream {
    return new tts.StreamAdapter(this, new tokenize.basic.SentenceTokenizer()).stream(options);
  }
}

class ElevenDialogueChunk extends tts.ChunkedStream {
  label = 'elevenlabs.v4-dialogue';
  constructor(text: string, private readonly engine: ElevenLabsDemoTts, options?: APIConnectOptions, signal?: AbortSignal) {
    super(text, engine, options, signal);
  }
  protected async run(): Promise<void> {
    const pcm = new AudioByteStream(24000, 1);
    const requestId = crypto.randomUUID();
    let lastFrame: AudioFrame | undefined;
    const enqueue = (frames: AudioFrame[]) => {
      for (const frame of frames) {
        if (lastFrame) this.queue.put({requestId, segmentId: requestId, frame: lastFrame, final: false});
        lastFrame = frame;
      }
    };
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=${ELEVEN_DEMO_MODEL}&output_format=pcm_24000`, {
        headers: {'xi-api-key': this.engine.apiKey}, handshakeTimeout: 10000,
      });
      let completed = false;
      const finish = (error?: Error) => {
        if (completed) return;
        completed = true;
        clearTimeout(deadline);
        this.abortSignal.removeEventListener('abort', abort);
        socket.terminate();
        error ? reject(error) : resolve();
      };
      const abort = () => finish(new Error('ElevenLabs synthesis cancelled'));
      const deadline = setTimeout(() => finish(new Error('ElevenLabs demo synthesis timed out')), 30000);
      this.abortSignal.addEventListener('abort', abort, {once: true});
      if (this.abortSignal.aborted) { abort(); return; }
      socket.on('open', () => {
        socket.send(JSON.stringify({voices: [ELEVEN_DEMO_VOICE]}));
        socket.send(JSON.stringify({inputs: [{text: this.inputText, voice_id: ELEVEN_DEMO_VOICE, new_turn: true}]}));
        socket.send(JSON.stringify({close_socket: true}));
      });
      socket.on('message', raw => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.error) { finish(new Error('ElevenLabs rejected dialogue synthesis')); return; }
          if (message.audio) enqueue(pcm.write(Buffer.from(message.audio, 'base64')));
          if (message.is_final) {
            enqueue(pcm.flush());
            if (!lastFrame) { finish(new Error('ElevenLabs returned no audio')); return; }
            this.queue.put({requestId, segmentId: requestId, frame: lastFrame, final: true});
            finish();
          }
        } catch { finish(new Error('Invalid ElevenLabs audio response')); }
      });
      socket.on('error', () => finish(new Error('ElevenLabs dialogue connection failed')));
      socket.on('close', () => { if (!completed) finish(new Error('ElevenLabs closed before final audio')); });
    });
  }
}
