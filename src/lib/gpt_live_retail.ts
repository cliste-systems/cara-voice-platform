import { CARA_CLARIFICATION_POLICY } from "./clarification_policy.js";
import { AudioFrame } from '@livekit/rtc-node';
import { DuplexRealtimeAdapter, llm } from '@livekit/agents';
import type { DuplexAudioFrame, DuplexSessionCallbacks, VAD } from '@livekit/agents';
import {
  ReadableStream,
  type ReadableStreamDefaultController,
  type ReadableStreamDefaultReader,
} from 'node:stream/web';
import * as openai from '@livekit/agents-plugin-openai';
import type { JobContext } from '@livekit/agents';
import type { RemoteParticipant } from '@livekit/rtc-node';
import { RoomServiceClient } from 'livekit-server-sdk';

import {
  ANONYMOUS_CALLER_E164,
  isAnonymousCallerE164,
  stableCallSidFallback,
} from './caller_blocklist.js';
import { maskPhone } from './gdpr.js';
import { assistantTextSoundsLikeTerminalHangup } from './end_call.js';
import { postCallComplete } from './voice_api.js';
import { createGptLiveAudioDiagnostics } from './gpt_live_audio_diagnostics.js';
import { createGptLiveAudioCapture } from './gpt_live_audio_capture.js';
import { GPT_LIVE_RETAIL_VOICE_STYLE } from './cara_prompt.js';
import type { GptLiveVerifiedOpening } from './gpt_live_verified_opening.js';
import { createGptLiveResponseTiming } from './gpt_live_response_timing.js';

/** OpenAI GPT-Live Irish English feminine voice (9508 retail default). */
export const GPT_LIVE_RETAIL_VOICE_DEFAULT = 'willow';

/** Backend Responses model for tool/reasoning delegation. */
const GPT_LIVE_RETAIL_BACKEND_DEFAULT = 'gpt-5.6-luna';

/** Backend Responses model: writes what Cara says and runs the product lookup. */
export const GPT_LIVE_RETAIL_BACKEND_INSTRUCTIONS =
  'You write replies for Cara on the phone at a SuperValu in Donegal. ' +
  'Write plain conversational English without adding slang to imitate an accent; the voice model handles pronunciation. ' +
  'Short, one question at a time, times in words. Use plain spoken sentences; no Markdown, bold, asterisks or headings. ' +
  'For cakes, ask for the inscription and collector names separately; never infer both from one answer. ' +
  'Treat orders as requests awaiting the team\'s confirmation; do not guarantee availability or collection dates, or claim a request was saved or sent without a successful tool result. ' +
  'For products, prices, stock or offers, call searchSuperValuProducts with the caller\'s own product words ' +
  '(for SuperValu own brand, search "SuperValu <product>"). If they name a counter or area (butcher, deli, fish, bakery, off-licence) pass it as service_area; ' +
  'Broad weekly offers, meat offers, every department, Super 7, multibuys and 3 for 10 are valid searches: use intent offer and preserve the department and promotion wording. Leave service_area unset when the caller names only a product, for multiple departments, or for departments outside the supported list. Never guess grocery as a default for packaged products; it excludes meat and other departments. Preserve the exact product and pack size. If asked whether a named product has a multibuy or a reduced price, search that product with intent offer; do not append both alternatives as product words or apply a multibuy-only filter. ' +
  'If the caller asks what is cheapest after naming a product, compare it with searchSuperValuProducts using query \"cheapest <product>\" and intent price. Preserve preparation context such as "for barbecue" in that query so cooked ready meals are not compared with raw meat. Preserve a current offer-only request only if they explicitly restrict the comparison to offers. Never claim to have checked without a tool result, and do not ask counter versus pre-packed instead of comparing the returned labelled prices. ' +
  CARA_CLARIFICATION_POLICY + ' Never treat a product or brand you suggested as a choice made by the caller. Retain only the preferences they actually gave. If the size determines suitable products, ask for it before listing offers; for example, nappies need a size, but do not ask it again when supplied. When several products match a chosen type, give at most three relevant offers in total across the whole answer, including multi-department examples, unless the caller explicitly requests the full list. ' +
  'if they say counter vs pre-pack, pass fulfilment. Only quote what the tool returns. If nothing matches, briefly say you can\'t confirm it — never say the shop doesn\'t stock it. ' +
  'Never add an offer condition that the lookup does not explicitly state. A multibuy does not automatically require Real Rewards. Retailer codes such as SV & CT are not evidence of a Rewards-card requirement. Mention Rewards membership only when the returned discount label or quote explicitly says Rewards or members. Otherwise quote the bundle quantity and total without adding membership terms. If asked whether a card is needed but the source is silent, say the listing does not state a card requirement; do not turn missing information into a guarantee. A bundle labelled range is not proof that different products can be mixed. Even if the quantity and total are known, say mix-and-match eligibility is not confirmed unless explicitly verified. ' +
  'Do not read internal retailer codes such as SV & CT or promotion boilerplate aloud. Explain the product, pack, price and relevant offer conditions in everyday language. ' +
  'A requested number of examples with a price or campaign filter is already a scoped search: for example, three Rewards offers at two euro from different departments. Search and choose verified examples; do not ask which departments. When a returned match has the exact requested full product name and pack, answer it without asking the caller to confirm that same name again. If nappies are requested as pants, do not substitute taped nappies. ' +
  'Search the product name only for standard or regular price questions; set intent price and do not append standard price, rather than bundle price, or other explanation as product words. Charleville is a cheese brand, not a request to change stores; this store remains Donegal unless the caller explicitly changes location. An explicit size such as nappy pants size nine is already sufficient: look it up, do not ask whether nine means a pack count. An exact named deli product deserves a lookup before another brand/type question. ' +
  'When asked for examples from named departments, search those departments and give verified examples now. Keep exclusions in the query. A product single price remains the price for one unless the source explicitly makes it conditional. A minimum bundle quantity with no bundle total does not establish a conditional unit price. Do not answer yes to mix and match unless verified for those items: explain when a bundle is listed but mixing eligibility is unknown. Do not repeat a local stock disclaimer or offer a callback after every price; give it once when relevant. Never pronounce SV and CT, including when that text appears in a raw label. ' +
  'On the first alcohol answer, mention they must be 18 or over.';

export function gptLiveRetailBackendInstructions(reference = new Date()): string {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Dublin',year:'numeric',month:'2-digit',day:'2-digit'}).format(reference);
  return `${GPT_LIVE_RETAIL_BACKEND_INSTRUCTIONS} Today is ${day} in Europe/Dublin. Interpret this week, last Thursday and this Sunday relative to that date. Current offers do not establish historical or future offers. If asked about expiry, use the returned offer_week_end for the exact product; do not assume all offers share a date.`;
}

function describeOpening(greetingText: string): string {
  return `${GPT_LIVE_RETAIL_VOICE_STYLE} Say this now, word for word, with nothing before or after it: "${greetingText.trim()}"`;
}

/** Pass every PCM frame through — avoids gate-induced burst cuts that click on the SIP bridge. */
class PassthroughAudioGate implements llm.AudioGate {
  update(): boolean {
    return true;
  }

  deactivate(): void {}
}

function frameDurationMs(frame: AudioFrame): number {
  if (!frame.sampleRate || !frame.samplesPerChannel) return 0;
  return (frame.samplesPerChannel / frame.sampleRate) * 1000;
}

/**
 * Tested startup cushion and silence-only replenishment for irregular frame delivery.
 * 500ms covers the observed 315ms speech-frame arrival stall with replay headroom.
 * An explicit zero disables the cushion for controlled comparisons.
 */
export function resolveGptLivePrebufferMs(): number {
  const configured = process.env.CARA_GPT_LIVE_PREBUFFER_MS?.trim();
  if (!configured || !/^\d+$/.test(configured)) return 500;
  const raw = Number(configured);
  if (!Number.isFinite(raw)) return 500;
  return Math.min(raw, 1000);
}

/** Speech-completion heuristic only; too permissive to decide where audio may be padded. */
const SILENT_FRAME_PEAK = 600;

export function isSilentFrame(frame: AudioFrame): boolean {
  const data = frame.data;
  for (let i = 0; i < data.length; i++) {
    const s = data[i]!;
    if (s > SILENT_FRAME_PEAK || s < -SILENT_FRAME_PEAK) return false;
  }
  return true;
}

/** Digital silence (including two counts of quantization noise), not quiet speech. */
function isDigitalSilence(frame: AudioFrame): boolean {
  return frame.data.every((sample) => Math.abs(sample) <= 2);
}

function silenceForDuration(frame: AudioFrame, durationMs: number): AudioFrame {
  const samplesPerChannel = Math.floor((frame.sampleRate * durationMs) / 1000);
  return new AudioFrame(
    new Int16Array(samplesPerChannel * frame.channels),
    frame.sampleRate,
    frame.channels,
    samplesPerChannel,
  );
}


export type AssistantSpeechWaitOutcome = 'finished' | 'no_reply' | 'timeout' | 'closed';

/**
 * Optionally gathers a startup cushion, then forwards every provider frame immediately.
 * At least 200ms of digital silence allows small padding increments up to the target lead.
 * Queue timing is estimated here; the native audio source does not report its actual playhead.
 * Also tracks when real speech finishes playing — agentState stays "speaking" for an entire
 * duplex call, so it cannot tell us when Cara has finished a sentence.
 */
export class PrebufferedPlayout {
  readonly stream: ReadableStream<DuplexAudioFrame>;
  private controller!: ReadableStreamDefaultController<DuplexAudioFrame>;
  private held: DuplexAudioFrame[] = [];
  private heldMs = 0;
  private runDryAt = 0;
  private flushTimer: NodeJS.Timeout | undefined;
  private finished = false;
  private lastSpeechQueuedAt = 0;
  private speechPlaysUntil = 0;
  private started: boolean;
  private digitalSilenceMs = 0;
  private readonly audioDiagnostics: ReturnType<typeof createGptLiveAudioDiagnostics>;
  private readonly audioCapture = createGptLiveAudioCapture();
  private pumpTask!: Promise<void>;
  onOutputFrame?: (frame: AudioFrame, atMs: number, flags: { syntheticSilence: boolean; localClip: boolean }) => void;
  private observerFailureLogged = false;

  constructor(
    source: ReadableStream<DuplexAudioFrame>,
    private readonly prebufferMs: number,
  ) {
    this.started = prebufferMs <= 0;
    this.audioDiagnostics = createGptLiveAudioDiagnostics(prebufferMs);
    const reader = source.getReader();
    this.stream = new ReadableStream<DuplexAudioFrame>({
      start: (controller) => {
        this.controller = controller;
        this.pumpTask = this.pump(reader);
      },
      cancel: (reason) => reader.cancel(reason),
    });
  }

  captureTranscript(delta: { text?: string; startMs?: number; endMs?: number }): void {
    this.audioCapture?.transcript(delta.text ?? '', delta);
  }

  /** Allow opted-in local capture writes to finish before the job process exits. */
  async waitForCapture(): Promise<void> {
    if (this.audioCapture) await this.pumpTask;
  }

  /** Queue frames straight after whatever is already buffered; resolves once they have played. */
  async playClip(frames: AudioFrame[]): Promise<number> {
    if (this.finished || !frames.length) return 0;
    this.flush();
    const now = Date.now();
    for (const frame of frames) this.emit({ frame }, now, false, true);
    const remainingMs = Math.max(0, this.runDryAt - Date.now());
    await new Promise((resolve) => setTimeout(resolve, remainingMs));
    return remainingMs;
  }

  /**
   * Resolves once Cara has spoken after `after` and her last spoken audio finished playing
   * `quietMs` ago. Gives up after `noReplyMs` without any speech, or `maxMs` overall.
   */
  async waitForSpeechToFinish(opts: {
    after: number;
    quietMs: number;
    noReplyMs: number;
    maxMs: number;
  }): Promise<AssistantSpeechWaitOutcome> {
    const startedAt = Date.now();
    while (true) {
      const now = Date.now();
      if (this.finished) return 'closed';
      const spoke = this.lastSpeechQueuedAt > opts.after;
      if (spoke && now - this.speechPlaysUntil >= opts.quietMs) return 'finished';
      if (!spoke && now - opts.after >= opts.noReplyMs) return 'no_reply';
      if (now - startedAt >= opts.maxMs) return 'timeout';
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private emit(frame: DuplexAudioFrame, now: number, syntheticSilence = false, localClip = false): void {
    this.audioCapture?.output(frame.frame, syntheticSilence, localClip);
    this.controller.enqueue(frame);
    try {
      this.onOutputFrame?.(frame.frame, now, { syntheticSilence, localClip });
    } catch {
      if (!this.observerFailureLogged) {
        this.observerFailureLogged = true;
        console.warn('[gpt-live-response-timing] output_observer_failed');
      }
    }
    this.audioDiagnostics?.output(
      frame.frame,
      Math.max(0, 1 - (this.controller.desiredSize ?? 1)),
      syntheticSilence,
    );
    this.runDryAt = Math.max(this.runDryAt, now) + frameDurationMs(frame.frame);
    if (!isSilentFrame(frame.frame)) {
      this.lastSpeechQueuedAt = now;
      this.speechPlaysUntil = this.runDryAt;
    }
  }

  private flush(): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (!this.held.length || this.finished) return;
    this.started = true;
    const now = Date.now();
    for (const frame of this.held) this.emit(frame, now);
    this.held = [];
    this.heldMs = 0;
  }

  private async pump(reader: ReadableStreamDefaultReader<DuplexAudioFrame>): Promise<void> {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.audioCapture?.source(value.frame);
        this.audioDiagnostics?.source(value.frame);
        const ms = frameDurationMs(value.frame);
        const now = Date.now();
        this.digitalSilenceMs = this.prebufferMs > 0 && isDigitalSilence(value.frame)
          ? this.digitalSilenceMs + ms
          : 0;
        if (!this.started) {
          this.held.push(value);
          this.heldMs += ms;
          if (this.heldMs >= this.prebufferMs) {
            this.flush();
          } else if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flush(), this.prebufferMs);
          }
          continue;
        }
        this.emit(value, now);
        // Never rebuffer active speech after a gap, and never pad merely quiet phonemes.
        if (this.prebufferMs > 0 && ms > 0 && this.digitalSilenceMs >= 200) {
          const missingLeadMs = Math.max(0, this.prebufferMs - (this.runDryAt - now));
          const padding = silenceForDuration(value.frame, Math.min(20, missingLeadMs));
          if (padding.samplesPerChannel > 0) this.emit({ frame: padding }, now, true);
        }
      }
      this.flush();
      this.finished = true;
      this.controller.close();
      this.audioDiagnostics?.close('closed');
    } catch (error) {
      clearTimeout(this.flushTimer);
      this.finished = true;
      this.controller.error(error);
      this.audioDiagnostics?.close('error');
    } finally {
      await this.audioCapture?.close();
    }
  }
}

const DUPLEX_SESSION_EVENTS: Array<keyof DuplexSessionCallbacks> = [
  'transcript_delta',
  'function_call',
  'input_speech_started',
  'input_speech_stopped',
  'input_audio_transcription_completed',
  'session_reconnected',
  'metrics_collected',
  'error',
];

/** Delegates to GPT-Live but serves a prebuffered audio stream so playout keeps a cushion. */
export class PrebufferedDuplexSession extends llm.DuplexSession {
  private readonly inner: llm.DuplexSession;
  private readonly playout: PrebufferedPlayout;
  private responseTiming: ReturnType<typeof createGptLiveResponseTiming> | undefined;
  private inputMuted = false;
  private utterance = '';
  private utteranceStartedAt = 0;
  private readonly transcriptListeners: Array<(event: {source:string;text:string;at:number;metadata:Record<string, unknown>}) => void> = [];
  private readonly segmentListeners: Array<(event: {text:string;at:number;interrupted:boolean}) => void> = [];
  private readonly pendingTranscriptEvents: Array<{source:string;text:string;at:number;metadata:Record<string, unknown>}> = [];
  private readonly pendingSegments: Array<{text:string;at:number;interrupted:boolean}> = [];
  private utteranceIdleTimer: NodeJS.Timeout | undefined;
  private readonly utteranceListeners: Array<(utterance: string) => void> = [];
  private awaitingOpening: boolean;
  private openingTask: Promise<void> | undefined;
  private pendingConfiguration: {
    instructions: string | undefined;
    chatCtx: llm.ChatContext | undefined;
    tools: llm.ToolContext | undefined;
  } | undefined;

  constructor(
    model: llm.DuplexModel,
    inner: llm.DuplexSession,
    prebufferMs: number,
    private readonly verifiedOpening?: GptLiveVerifiedOpening,
  ) {
    super(model);
    this.inner = inner;
    this.awaitingOpening = Boolean(verifiedOpening);
    this.playout = new PrebufferedPlayout(inner.audioStream, prebufferMs);
    const source = inner as unknown as { on(event: string, cb: (payload: unknown) => void): void };
    const target = this as unknown as { emit(event: string, payload: unknown): boolean };
    for (const event of DUPLEX_SESSION_EVENTS) {
      source.on(event, (payload) => target.emit(event, payload));
    }
    source.on('transcript_delta', (payload) => {
      this.playout.captureTranscript(payload as { text?: string; startMs?: number; endMs?: number });
      const delta = payload as {text?:string;startMs?:number;endMs?:number};
      const at = Date.now();
      const event = {source:'gpt_live_transcript_delta',text:delta.text ?? '',at,metadata:{startMs:delta.startMs,endMs:delta.endMs}};
      if (this.transcriptListeners.length) for (const listener of this.transcriptListeners) listener(event);
      else this.pendingTranscriptEvents.push(event);
      if (!this.utterance) this.utteranceStartedAt = at;
      this.utterance += delta.text ?? '';
      clearTimeout(this.utteranceIdleTimer);
      this.utteranceIdleTimer = setTimeout(() => this.flushAssistantTranscript(), 1500);
      for (const listener of this.utteranceListeners) listener(this.utterance);
    });
    source.on('input_speech_started', () => this.flushAssistantTranscript(true));
    source.on('session_reconnected', () => {
      this.responseTiming?.reset();
      this.flushAssistantTranscript(true);
      const event = {source:'gpt_live_reconnected',text:'',at:Date.now(),metadata:{}};
      if (this.transcriptListeners.length) for (const listener of this.transcriptListeners) listener(event);
      else this.pendingTranscriptEvents.push(event);
    });
  }

  /** Independent observation only: never gates, buffers, or interrupts call audio. */
  enableResponseTiming(vad: VAD): void {
    if (this.responseTiming) return;
    try {
      this.responseTiming = createGptLiveResponseTiming(vad);
      this.playout.onOutputFrame = (frame, at, flags) => this.responseTiming?.pushOutput(frame, at, flags);
    } catch {
      console.warn('[gpt-live-response-timing] observer_unavailable');
    }
  }

  responseTimingSnapshot(): ReturnType<ReturnType<typeof createGptLiveResponseTiming>['snapshot']> | undefined {
    return this.responseTiming?.snapshot();
  }

  async finishResponseTiming(): Promise<void> {
    await this.responseTiming?.close();
  }

  onTranscriptEvent(cb: (event: {source:string;text:string;at:number;metadata:Record<string,unknown>}) => void): void {
    this.transcriptListeners.push(cb);
    for (const event of this.pendingTranscriptEvents.splice(0)) cb(event);
  }
  onAssistantSegment(cb: (event: {text:string;at:number;interrupted:boolean}) => void): void {
    this.segmentListeners.push(cb);
    for (const event of this.pendingSegments.splice(0)) cb(event);
  }
  flushAssistantTranscript(interrupted = false): void {
    clearTimeout(this.utteranceIdleTimer);
    if (!this.utterance.trim()) return;
    const event = {text:this.utterance,at:this.utteranceStartedAt,interrupted};
    this.utterance = '';
    if (this.segmentListeners.length) for (const listener of this.segmentListeners) listener(event);
    else this.pendingSegments.push(event);
  }

  override get audioStream(): ReadableStream<DuplexAudioFrame> {
    return this.playout.stream;
  }

  /** Plays a clip (e.g. the hang-up sound) through Cara's audio path; resolves after playout. */
  playClip(frames: AudioFrame[]): Promise<number> {
    return this.playout.playClip(frames);
  }

  /** Play checked PCM before configuring the provider, so generated audio cannot replace it. */
  async playVerifiedOpening(): Promise<void> {
    if (!this.verifiedOpening) throw new Error('No verified GPT-Live opening is configured');
    if (this.openingTask) return this.openingTask;
    if (!this.pendingConfiguration) throw new Error('GPT-Live session has not been configured');
    this.openingTask = (async () => {
      await this.playout.playClip(this.verifiedOpening!.frames);
      if (this._closing) return;
      const config = this.pendingConfiguration!;
      const chatCtx = config.chatCtx?.copy() ?? llm.ChatContext.empty();
      chatCtx.addMessage({ role: 'assistant', content: this.verifiedOpening!.text });
      await this.inner._updateSession(config.instructions, chatCtx, config.tools);
      this.awaitingOpening = false;
      this.pendingConfiguration = undefined;
    })().catch(async (error: unknown) => {
      // Configuration now happens after the adapter's startup guard; retain fail-closed cleanup.
      await this.close();
      throw error;
    });
    return this.openingTask;
  }

  /** Called on every transcript delta with Cara's current utterance so far. */
  onAssistantUtterance(cb: (utterance: string) => void): void {
    this.utteranceListeners.push(cb);
  }

  waitForAssistantSpeechToFinish(
    opts: Parameters<PrebufferedPlayout['waitForSpeechToFinish']>[0],
  ): Promise<AssistantSpeechWaitOutcome> {
    return this.playout.waitForSpeechToFinish(opts);
  }

  override get tools(): llm.ToolContext {
    return this.inner.tools;
  }

  override pushAudio(frame: AudioFrame): void {
    if (this.awaitingOpening) return;
    this.inner.pushAudio(frame);
    if (!this.inputMuted) this.responseTiming?.pushInput(frame);
  }

  override pushVideo(frame: Parameters<llm.DuplexSession['pushVideo']>[0]): void {
    this.inner.pushVideo(frame);
  }

  protected override async closeConnection(): Promise<void> {
    await this.inner.close();
    await this.finishResponseTiming();
    this.flushAssistantTranscript();
    await this.playout.waitForCapture();
  }

  /** Must delegate to inner so GPT-Live receives _configured.set() and opens its WebSocket. */
  override async _updateSession(
    instructions?: string,
    chatCtx?: llm.ChatContext,
    tools?: llm.ToolContext,
  ): Promise<void> {
    if (this.awaitingOpening) {
      this.pendingConfiguration = { instructions, chatCtx: chatCtx?.copy(), tools };
      return;
    }
    await this.inner._updateSession(instructions, chatCtx, tools);
  }

  override async _updateInstructions(instructions: string): Promise<void> {
    await this.inner._updateInstructions(instructions);
  }

  override async _appendItems(items: llm.ChatItem[]): Promise<void> {
    await this.inner._appendItems(items);
  }

  override async _updateTools(tools: llm.ToolContext): Promise<void> {
    await this.inner._updateTools(tools);
  }

  override _updateOptions(options: { toolChoice?: llm.ToolChoice | null }): void {
    this.inner._updateOptions(options);
  }

  override _generateReply(instructions?: string): void {
    if (this.awaitingOpening) return;
    this.inner._generateReply(instructions);
  }

  muteInput(): void {
    if (!this.inputMuted) this.responseTiming?.reset();
    this.inputMuted = true;
    (this.inner as { muteInput?: () => void }).muteInput?.();
  }

  unmuteInput(): void {
    if (this.awaitingOpening) return;
    this.inputMuted = false;
    (this.inner as { unmuteInput?: () => void }).unmuteInput?.();
  }
}

class PrebufferedDuplexModel extends llm.DuplexModel {
  verifiedOpening: GptLiveVerifiedOpening | undefined;
  constructor(
    private readonly inner: llm.DuplexModel,
    private readonly prebufferMs: number,
  ) {
    super(inner.capabilities);
  }

  override get model(): string {
    return this.inner.model;
  }

  override get provider(): string {
    return this.inner.provider;
  }

  override label(): string {
    return this.inner.label();
  }

  override audioGate(): llm.AudioGate | undefined {
    return this.inner.audioGate();
  }

  override session(): llm.DuplexSession {
    return new PrebufferedDuplexSession(this, this.inner.session(), this.prebufferMs, this.verifiedOpening);
  }

  override async close(): Promise<void> {
    await this.inner.close();
  }
}

/** Always passthrough — fixed/adaptive gates split GPT-Live PCM and click on the line. */
class TelephonyGPTLiveModel extends openai.realtime.GPTLiveModel {
  override audioGate(): llm.AudioGate {
    return new PassthroughAudioGate();
  }
}

export function resolveGptLiveRetailVoice(): string {
  return process.env.CARA_GPT_LIVE_VOICE?.trim() || GPT_LIVE_RETAIL_VOICE_DEFAULT;
}

function resolveGptLiveRetailBackendModel(): string {
  return process.env.CARA_GPT_LIVE_BACKEND_MODEL?.trim() || GPT_LIVE_RETAIL_BACKEND_DEFAULT;
}

/** Kavanaghs 9508 — full-duplex GPT-Live-1 with Irish voice only (no inference fallback). */
export function shouldUseGptLiveRetailStack(input: { conversationalRetailLine: boolean }): boolean {
  if (!input.conversationalRetailLine) return false;
  const raw = process.env.CARA_GPT_LIVE_RETAIL?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return true;
}

export type ResolvedGptLiveRetailModel = {
  instance: DuplexRealtimeAdapter;
  label: string;
  voice: string;
  backendModel: string;
  audioConfig: GptLiveAudioConfig;
  setVerifiedOpening(opening: GptLiveVerifiedOpening): void;
};

export type GptLiveAudioConfig = Readonly<{
  prebufferMs: number;
  roomAudioQueueMs: number;
  burstTimeoutMs: number;
  audioGate: 'passthrough';
  dtx: false;
  red: true;
}>;

/** Resolve once per model so published audio and saved call evidence use the same values. */
export function resolveGptLiveAudioConfig(): GptLiveAudioConfig {
  return Object.freeze({
    prebufferMs: resolveGptLivePrebufferMs(),
    roomAudioQueueMs: resolveGptLiveAudioQueueMs(),
    burstTimeoutMs: resolveGptLiveBurstTimeoutMs(),
    audioGate: 'passthrough',
    dtx: false,
    red: true,
  });
}

/**
 * Duplex keeps one speech handle open for the whole call, so LiveKit only hands the tool result
 * back when that handle ends. Push the result in now or Cara stays on "bear with me".
 */
export function deliverGptLiveToolResult(
  ctx: { session: { currentAgent: { duplexSession?: unknown } } },
  output: unknown,
): void {
  const call = (ctx as { functionCall?: { callId?: string; name?: string } }).functionCall;
  const callId = call?.callId;
  if (!callId) return;
  let rawDuplex: unknown;
  try {
    rawDuplex = ctx.session.currentAgent?.duplexSession;
  } catch (error) {
    // LiveKit's getter throws for normal STT/LLM/TTS sessions. Their tool
    // results are delivered by the framework; only duplex needs this hook.
    if (error instanceof Error && /no duplex session/i.test(error.message)) return;
    throw error;
  }
  const duplex = rawDuplex as {
    _appendItems?: (items: llm.ChatItem[]) => Promise<void>;
  } | undefined;
  if (!callId || typeof duplex?._appendItems !== 'function') return;
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  const item = {
    type: 'function_call_output' as const,
    name: call?.name ?? '',
    callId,
    output: text.slice(0, 12000),
    isError: false,
    createdAt: Date.now(),
  };
  void duplex._appendItems([item as unknown as llm.ChatItem]);
}

export function createGptLiveRetailModel(): ResolvedGptLiveRetailModel | null {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error('[gpt_live] OPENAI_API_KEY missing — 9508 requires GPT-Live');
    return null;
  }

  const voice = resolveGptLiveRetailVoice();
  const backendModel = resolveGptLiveRetailBackendModel();
  const telephonyModel = new TelephonyGPTLiveModel({
    voice,
    responsesOptions: {
      model: backendModel,
      instructions: gptLiveRetailBackendInstructions(),
    },
  });
  const audioConfig = resolveGptLiveAudioConfig();
  console.info('[gpt_live] audio_configuration', audioConfig);
  // Always wrap so hang-up audio and speech-end detection stay available. 0ms is unmodified PCM.
  const duplexModel = new PrebufferedDuplexModel(telephonyModel, audioConfig.prebufferMs);

  return {
    voice,
    backendModel,
    audioConfig,
    setVerifiedOpening(opening) { duplexModel.verifiedOpening = opening; },
    label: `openai/gpt-live-1:${voice}+${backendModel}`,
    // Pre-wrap so LiveKit does not use the default 800ms burst timeout (splits PCM → clicks).
    instance: new DuplexRealtimeAdapter(duplexModel, {
      gate: () => new PassthroughAudioGate(),
      audioTimeout: audioConfig.burstTimeoutMs,
    }),
  };
}

export function buildGptLiveRetailOpeningInstructions(greetingText: string): string {
  return describeOpening(greetingText);
}

/** True when Cara's utterance so far closes with a goodbye (checks only its final sentences). */
export function gptLiveUtteranceEndsWithFarewell(utterance: string): boolean {
  const sentences = utterance
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim());
  if (!sentences.length) return false;
  const last = sentences[sentences.length - 1]!;
  const lastTwo = sentences.slice(-2).join(' ');
  return assistantTextSoundsLikeTerminalHangup(last) || assistantTextSoundsLikeTerminalHangup(lastTwo);
}

/** Native RoomIO queue capacity. A larger capacity does not itself establish a startup cushion. */
export function resolveGptLiveAudioQueueMs(): number {
  const raw = Number.parseInt(process.env.CARA_GPT_LIVE_AUDIO_QUEUE_MS ?? '8000', 10);
  if (!Number.isFinite(raw)) return 8000;
  return Math.min(Math.max(raw, 400), 8000);
}

/**
 * DuplexRealtimeAdapter closes GPT-Live PCM bursts after this idle gap (LiveKit default 800ms).
 * This controls generation boundaries; it does not fill delivery gaps or set playout buffering.
 */
export function resolveGptLiveBurstTimeoutMs(): number {
  const raw = Number.parseInt(process.env.CARA_GPT_LIVE_BURST_TIMEOUT_MS ?? '8000', 10);
  if (!Number.isFinite(raw)) return 8000;
  return Math.min(Math.max(raw, 800), 30000);
}

/** Drop the SIP leg when GPT-Live cannot start — no AssemblyAI/Gemma/Cartesia fallback. */
export async function rejectGptLiveUnavailableCall(input: {
  ctx: JobContext;
  participant: RemoteParticipant;
  org: { id: string; name: string; phone_number?: string | null };
  callerNumberRaw: string;
  callerE164: string;
  calledNumber: string;
  reason: string;
}): Promise<void> {
  const roomName =
    (typeof input.ctx.room.name === 'string' && input.ctx.room.name.trim()) || '';
  const callerIdentity = (input.participant.identity ?? '').trim();
  const callSid = stableCallSidFallback(input.participant, roomName);

  console.error('[gpt_live] rejecting call — GPT-Live unavailable', {
    orgId: input.org.id,
    reason: input.reason,
    callerE164: maskPhone(input.callerE164),
  });

  const host = (() => {
    const u = process.env.LIVEKIT_URL?.trim();
    if (!u) return null;
    return u.replace(/^wss?:\/\//, 'https://');
  })();
  const key = process.env.LIVEKIT_API_KEY?.trim();
  const secret = process.env.LIVEKIT_API_SECRET?.trim();
  if (host && key && secret && roomName && callerIdentity) {
    try {
      const client = new RoomServiceClient(host, key, secret);
      await client.removeParticipant(roomName, callerIdentity);
    } catch (err) {
      console.error('[gpt_live] removeParticipant failed', err);
    }
  }

  const callerForWebhook = isAnonymousCallerE164(input.callerE164)
    ? ANONYMOUS_CALLER_E164
    : input.callerNumberRaw.trim() || input.callerE164;

  try {
    await postCallComplete({
      called_number: input.calledNumber.trim() || input.org.phone_number?.trim() || '',
      call_sid: callSid,
      room_name: roomName || null,
      caller_number: callerForWebhook,
      duration_seconds: 0,
      outcome: 'gpt_live_unavailable',
      ai_summary: 'GPT-Live voice stack unavailable for this call.',
    });
  } catch (err) {
    console.error('[gpt_live] call-complete error', err);
  }
}
