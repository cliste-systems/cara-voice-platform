import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { ReadableStream, type ReadableStreamDefaultController } from 'node:stream/web';
import { llm, type DuplexAudioFrame } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';
import { PrebufferedDuplexSession } from './gpt_live_retail.js';
import type { GptLiveVerifiedOpening } from './gpt_live_verified_opening.js';

const pcm = (value: number) => new AudioFrame(new Int16Array(2400).fill(value), 24000, 1, 2400);
const greeting = 'Hello, this is Cara. How can I help you today?';

class MockDuplexModel extends llm.DuplexModel {
  constructor() {
    super({ userTranscription: true, autoToolReplyGeneration: true });
  }

  override session(): llm.DuplexSession { return new MockDuplexSession(this); }
  override async close(): Promise<void> {}
}

class MockDuplexSession extends llm.DuplexSession {
  private controller!: ReadableStreamDefaultController<DuplexAudioFrame>;
  private sourceClosed = false;
  override readonly audioStream = new ReadableStream<DuplexAudioFrame>({
    start: (controller) => { this.controller = controller; },
  });
  override readonly tools = llm.ToolContext.empty();
  readonly configurations: Array<{
    args: Parameters<llm.DuplexSession['_updateSession']>;
    at: number;
  }> = [];
  readonly inputFrames: AudioFrame[] = [];
  readonly replies: Array<string | undefined> = [];
  closeCount = 0;

  override pushAudio(frame: AudioFrame): void { this.inputFrames.push(frame); }
  override _generateReply(instructions?: string): void { this.replies.push(instructions); }
  override async _updateSession(...args: Parameters<llm.DuplexSession['_updateSession']>): Promise<void> {
    this.configurations.push({ args, at: Date.now() });
  }
  override async _updateInstructions(_instructions: string): Promise<void> {}
  override async _appendItems(_items: llm.ChatItem[]): Promise<void> {}
  override async _updateTools(_tools: llm.ToolContext): Promise<void> {}
  override _updateOptions(_options: { toolChoice?: llm.ToolChoice | null }): void {}

  emitAudio(frame: AudioFrame): void { this.controller.enqueue({ frame }); }

  protected override async closeConnection(): Promise<void> {
    this.closeCount++;
    if (!this.sourceClosed) {
      this.sourceClosed = true;
      this.controller.close();
    }
  }
}

async function settleStreams(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function harness(t: TestContext, opening?: GptLiveVerifiedOpening) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  // The wrapper's existing diagnostic hook must never make a network request in this suite.
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  const captureDirectory = process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR;
  delete process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR;
  t.after(() => {
    if (captureDirectory === undefined) delete process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR;
    else process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR = captureDirectory;
  });
  const model = new MockDuplexModel();
  const inner = new MockDuplexSession(model);
  const session = new PrebufferedDuplexSession(model, inner, 0, opening);
  const received: AudioFrame[] = [];
  const complete = (async () => {
    for await (const output of session.audioStream) received.push(output.frame);
  })();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await session.close();
    await complete;
  };
  t.after(close);
  return { inner, session, received, close };
}

function verifiedOpening(): GptLiveVerifiedOpening {
  // Three 100ms frames keep the production clip's startup timing contract fast to test.
  return { text: greeting, frames: [pcm(1000), pcm(2000), pcm(3000)], durationMs: 300 };
}

describe('GPT-Live verified opening session', () => {
  it('plays only the fixed clip before configuring the provider with the greeting and initial context', async (t) => {
    const opening = verifiedOpening();
    const io = harness(t, opening);
    const context = llm.ChatContext.empty();
    context.addMessage({ role: 'user', content: 'Initial caller context' });
    const originalItems = [...context.items];
    const tools = llm.ToolContext.empty();
    await io.session._updateSession('The greeting has already played.', context, tools);
    assert.equal(io.inner.configurations.length, 0);

    const callerFrame = pcm(4000);
    io.session.pushAudio(callerFrame);
    io.session._generateReply('Do not generate the opening');
    const playing = io.session.playVerifiedOpening();
    await settleStreams();
    assert.deepEqual(io.received, opening.frames);
    assert.equal(io.inner.configurations.length, 0);
    assert.deepEqual(io.inner.inputFrames, []);
    assert.deepEqual(io.inner.replies, []);

    t.mock.timers.tick(299);
    io.session.pushAudio(callerFrame);
    io.session._generateReply('Still inside the greeting');
    await settleStreams();
    assert.equal(io.inner.configurations.length, 0);
    assert.deepEqual(io.inner.inputFrames, []);
    assert.deepEqual(io.inner.replies, []);

    t.mock.timers.tick(1);
    await playing;
    assert.equal(io.inner.configurations.length, 1);
    const configuration = io.inner.configurations[0]!;
    assert.equal(configuration.at, 1300);
    const [instructions, seededContext, configuredTools] = configuration.args;
    assert.equal(instructions, 'The greeting has already played.');
    assert.equal(configuredTools, tools);
    assert.ok(seededContext);
    assert.notEqual(seededContext, context);
    assert.deepEqual(seededContext.items.slice(0, originalItems.length), originalItems);
    const lastMessage = seededContext.items.at(-1);
    assert.equal(lastMessage?.type, 'message');
    if (lastMessage?.type !== 'message') assert.fail('Expected an assistant greeting message');
    assert.equal(lastMessage.role, 'assistant');
    assert.equal(lastMessage.textContent, greeting);
    assert.deepEqual(context.items, originalItems, 'The caller-owned context must remain unchanged');

    io.session.pushAudio(callerFrame);
    io.session._generateReply('Answer the caller');
    assert.deepEqual(io.inner.inputFrames, [callerFrame]);
    assert.deepEqual(io.inner.replies, ['Answer the caller']);
    const replyFrame = pcm(5000);
    io.inner.emitAudio(replyFrame);
    await settleStreams();
    assert.deepEqual(io.received, [...opening.frames, replyFrame]);
  });

  it('does not replay the greeting or configure twice when playback is requested repeatedly', async (t) => {
    const opening = verifiedOpening();
    const io = harness(t, opening);
    await io.session._updateSession('Wait for the caller after the greeting.');
    const first = io.session.playVerifiedOpening();
    const concurrent = io.session.playVerifiedOpening();
    await settleStreams();
    assert.deepEqual(io.received, opening.frames);
    t.mock.timers.tick(opening.durationMs);
    await Promise.all([first, concurrent]);
    await io.session.playVerifiedOpening();
    assert.deepEqual(io.received, opening.frames);
    assert.equal(io.inner.configurations.length, 1);
    const seededContext = io.inner.configurations[0]!.args[1];
    assert.equal(seededContext?.items.length, 1, 'An empty initial context gets only one greeting');
  });

  it('never starts the provider after the call closes during the fixed clip', async (t) => {
    const opening = verifiedOpening();
    const io = harness(t, opening);
    await io.session._updateSession('Wait for the caller.');
    const playing = io.session.playVerifiedOpening();
    await settleStreams();
    t.mock.timers.tick(100);
    await io.close();
    assert.equal(io.inner.closeCount, 1);
    t.mock.timers.tick(opening.durationMs);
    await playing;
    assert.equal(io.inner.configurations.length, 0);
    io.session.pushAudio(pcm(4000));
    io.session._generateReply('The call is closed');
    assert.deepEqual(io.inner.inputFrames, []);
    assert.deepEqual(io.inner.replies, []);
  });

  it('closes the provider and keeps caller input blocked when deferred configuration fails', async (t) => {
    const opening = verifiedOpening();
    const io = harness(t, opening);
    const failure = new Error('Provider configuration failed');
    const configure = t.mock.method(io.inner, '_updateSession', async () => { throw failure; });
    await io.session._updateSession('Wait for the caller.');
    const playing = io.session.playVerifiedOpening();
    const rejected = assert.rejects(playing, (error: unknown) => error === failure);
    await settleStreams();
    assert.deepEqual(io.received, opening.frames);
    assert.equal(configure.mock.callCount(), 0);

    t.mock.timers.tick(opening.durationMs);
    await rejected;
    assert.equal(configure.mock.callCount(), 1);
    assert.equal(io.inner.closeCount, 1, 'The failed provider must be closed before failure is surfaced');
    io.session.pushAudio(pcm(4000));
    io.session._generateReply('Do not use a failed session');
    assert.deepEqual(io.inner.inputFrames, []);
    assert.deepEqual(io.inner.replies, []);
    await assert.rejects(io.session.playVerifiedOpening(), (error: unknown) => error === failure);
    assert.equal(configure.mock.callCount(), 1, 'Repeated playback must not retry failed startup');
    assert.deepEqual(io.received, opening.frames);
  });

  it('preserves immediate configuration and forwarding when no verified opening is supplied', async (t) => {
    const io = harness(t);
    const context = llm.ChatContext.empty();
    const tools = llm.ToolContext.empty();
    await io.session._updateSession('Original instructions', context, tools);
    assert.equal(io.inner.configurations.length, 1);
    assert.deepEqual(io.inner.configurations[0]?.args, ['Original instructions', context, tools]);
    assert.equal(io.inner.configurations[0]?.at, 1000);
    const input = pcm(4000);
    const output = pcm(5000);
    io.session.pushAudio(input);
    io.session._generateReply('Say the opening');
    io.inner.emitAudio(output);
    await settleStreams();
    assert.deepEqual(io.inner.inputFrames, [input]);
    assert.deepEqual(io.inner.replies, ['Say the opening']);
    assert.deepEqual(io.received, [output]);
  });
});

it('captures provider deltas without speech handles and flushes interrupted and closing tails exactly once', async (t) => {
  const io = harness(t);
  const raw: string[] = [];
  const segments: Array<{text:string;interrupted:boolean}> = [];
  io.inner.emit('transcript_delta',{text:'First ',startMs:0,endMs:100});
  io.session.onTranscriptEvent(event=>raw.push(event.text));
  io.session.onAssistantSegment(event=>segments.push(event));
  io.inner.emit('transcript_delta',{text:'answer.',startMs:100,endMs:200});
  t.mock.timers.tick(1500);
  io.inner.emit('transcript_delta',{text:'Interrupted reply'});
  io.session.flushAssistantTranscript(true);
  io.inner.emit('transcript_delta',{text:'Final words'});
  await io.close();
  assert.deepEqual(raw,['First ','answer.','Interrupted reply','Final words']);
  assert.deepEqual(segments.map(x=>[x.text,x.interrupted]),[['First answer.',false],['Interrupted reply',true],['Final words',false]]);
});
