import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  createGeminiAudio,
  decodeGeminiPcm,
  pcmBytesToBase64,
} from './geminiAudio.js';

test('PCM decoding preserves little-endian signed samples and rejects malformed audio', () => {
  const data = new Uint8Array([0, 128, 0, 0, 255, 127]);
  const decoded = decodeGeminiPcm(pcmBytesToBase64(data.buffer));
  assert.equal(decoded.sampleRate, 24000);
  assert.deepEqual([...decoded.samples], [-1, 0, 32767 / 32768]);
  assert.throws(() => decodeGeminiPcm('AA=='), /incomplete/);
  assert.throws(() => decodeGeminiPcm('AAAA', 'audio/mp3'), /unsupported/);
  assert.throws(
    () => decodeGeminiPcm('AAAA', 'audio/pcm;rate=1'),
    /sample rate/,
  );
});

test('PCM decoding accepts both rate endpoints and the exact decoded chunk limit', () => {
  for (const rate of [8000, 96000]) {
    const decoded = decodeGeminiPcm('AAA=', `audio/pcm;rate=${rate}`);
    assert.equal(decoded.sampleRate, rate);
    assert.deepEqual([...decoded.samples], [0]);
  }
  const limit = 2 * 1024 * 1024;
  const maximum = decodeGeminiPcm(
    pcmBytesToBase64(new ArrayBuffer(limit)),
    'audio/pcm;rate=96000',
  );
  assert.equal(maximum.samples.length, limit / 2);
  for (const size of [limit + 1, limit + 2])
    assert.throws(
      () => decodeGeminiPcm(pcmBytesToBase64(new ArrayBuffer(size))),
      /oversized audio chunk/,
    );
});

function createCaptureHarness() {
  let Processor;
  const messages = [];
  vm.runInNewContext(
    fs.readFileSync(
      new URL('./geminiCaptureWorklet.js', import.meta.url),
      'utf8',
    ),
    {
      AudioWorkletProcessor: class {
        constructor() {
          this.port = { postMessage: (message) => messages.push(message) };
        }
      },
      registerProcessor: (_name, Class) => {
        Processor = Class;
      },
    },
  );
  return { capture: new Processor(), messages };
}

test('worklet orders start, bounded PCM and the final partial chunk before end', () => {
  const { capture, messages } = createCaptureHarness();
  capture.process([[new Float32Array([-1, 0, 1])]]);
  assert.equal(messages.length, 0);
  capture.port.onmessage({ data: { enabled: true, captureId: 1 } });
  capture.process([[new Float32Array([-1, 0, 1])]]);
  capture.port.onmessage({ data: { enabled: false, captureId: 1 } });
  assert.deepEqual(
    messages.map((message) => message.type),
    ['start', 'audio', 'end'],
  );
  const view = new DataView(messages[1].buffer);
  assert.deepEqual(
    [view.getInt16(0, true), view.getInt16(2, true), view.getInt16(4, true)],
    [-32768, 0, 32767],
  );
  capture.process([[new Float32Array(2048)]]);
  assert.equal(messages.length, 3);
});

test('worklet serializes rapid re-holds and ignores repeated enable or release', () => {
  const { capture, messages } = createCaptureHarness();
  let captureId = 0;
  let gate = false;
  const enable = (enabled) => {
    if (enabled && !gate) captureId++;
    gate = enabled;
    capture.port.onmessage({ data: { enabled, captureId } });
  };
  enable(false);
  enable(true);
  enable(true);
  capture.process([[new Float32Array(1025).fill(0.5)]]);
  enable(false);
  enable(false);
  capture.process([[new Float32Array(2048).fill(1)]]);
  enable(true);
  capture.process([[new Float32Array([0.25])]]);
  enable(false);
  assert.deepEqual(
    messages.map((message) => message.type),
    ['start', 'audio', 'audio', 'end', 'start', 'audio', 'end'],
  );
  assert.deepEqual(
    messages
      .filter((message) => message.type === 'audio')
      .map((message) => message.buffer.byteLength),
    [2048, 2, 2],
  );
  assert.equal(new DataView(messages[5].buffer).getInt16(0, true), 8192);
  assert.deepEqual(
    messages.map((message) => message.captureId),
    [1, 1, 1, 1, 2, 2, 2],
  );
  enable(true);
  enable(false);
  assert.deepEqual(
    messages.slice(-2).map((message) => message.type),
    ['start', 'end'],
  );
  assert.equal(capture.length, 0);
  assert.equal(capture.enabled, false);
});

function createPlaybackHarness() {
  const sources = [];
  const buffers = [];
  let drains = 0;
  let context;
  const node = () => ({
    connect() {},
    disconnect() {
      this.disconnected = true;
    },
    gain: { value: 1 },
  });
  class Context {
    constructor() {
      context = this;
      this.currentTime = 0;
      this.sampleRate = 16000;
      this.state = 'running';
      this.destination = {};
      this.audioWorklet = { addModule: async () => {} };
    }
    async resume() {}
    async close() {
      this.state = 'closed';
    }
    createGain() {
      return node();
    }
    createMediaStreamDestination() {
      return { ...node(), stream: {} };
    }
    createBuffer(_channels, length, rate) {
      const buffer = { duration: length / rate, copyToChannel() {} };
      buffers.push(buffer);
      return buffer;
    }
    createBufferSource() {
      const source = {
        ...node(),
        start(at) {
          this.at = at;
        },
        stop() {
          this.stopped = true;
        },
      };
      sources.push(source);
      return source;
    }
  }
  const audio = createGeminiAudio({
    AudioContextClass: Context,
    AudioWorkletNodeClass: class {},
    onDrain: () => {
      drains++;
    },
  });
  return {
    audio,
    sources,
    buffers,
    get drains() {
      return drains;
    },
    get context() {
      return context;
    },
  };
}

function outputDiagnostics(audio) {
  const { outputSamples, completedOutputSamples, discardedOutputSamples } =
    audio.diagnostics();
  return { outputSamples, completedOutputSamples, discardedOutputSamples };
}

test('pending sources are capped before decoding or allocating and natural completion frees a slot', async (t) => {
  const playback = createPlaybackHarness();
  const { audio, sources, buffers } = playback;
  t.after(() => audio.close());
  const decode = t.mock.method(globalThis, 'atob', globalThis.atob);
  await audio.initialize();
  for (let index = 0; index < 256; index++)
    audio.play('AAA=', 'audio/pcm;rate=96000');
  assert.equal(audio.pending, true);
  assert.ok(audio.diagnostics().queuedSeconds < 0.023);
  assert.equal(decode.mock.calls.length, 256);
  assert.equal(buffers.length, 256);
  assert.equal(sources.length, 256);
  const before = audio.diagnostics();
  assert.throws(
    () => audio.play('AAA=', 'audio/pcm;rate=96000'),
    /Gemini audio playback fell behind\. Reconnect to continue\./,
  );
  assert.equal(decode.mock.calls.length, 256);
  assert.equal(buffers.length, 256);
  assert.equal(sources.length, 256);
  assert.deepEqual(audio.diagnostics(), before);

  const ended = sources[0].onended;
  ended();
  assert.equal(sources[0].disconnected, true);
  assert.equal(playback.drains, 0);
  audio.play('AAA=', 'audio/pcm;rate=96000');
  assert.equal(decode.mock.calls.length, 257);
  assert.equal(buffers.length, 257);
  assert.equal(sources.length, 257);
  ended();
  assert.equal(audio.diagnostics().completedOutputSamples, 1);
  assert.throws(() => audio.play('AAA='), /playback fell behind/);
  assert.equal(decode.mock.calls.length, 257);
});

test('clearing and closing a full queue release every source and ignore late completion', async (t) => {
  const playback = createPlaybackHarness();
  const { audio, sources, buffers } = playback;
  t.after(() => audio.close());
  const decode = t.mock.method(globalThis, 'atob', globalThis.atob);
  await audio.initialize();
  for (let index = 0; index < 256; index++) audio.play('AAA=');
  const staleEnded = sources.map((source) => source.onended);
  audio.clearPlayback();
  assert.equal(audio.pending, false);
  assert.equal(audio.diagnostics().queuedSeconds, 0);
  for (const source of sources) {
    assert.equal(source.stopped, true);
    assert.equal(source.disconnected, true);
    assert.equal(source.onended, null);
  }
  for (let index = 0; index < 256; index++) audio.play('AAA=');
  for (const ended of staleEnded) ended();
  assert.equal(audio.pending, true);
  assert.throws(() => audio.play('AAA='), /playback fell behind/);
  assert.equal(decode.mock.calls.length, 512);
  assert.equal(buffers.length, 512);
  assert.equal(sources.length, 512);
  const lateEnded = sources.slice(256).map((source) => source.onended);
  await audio.close();
  for (const source of sources) {
    assert.equal(source.stopped, true);
    assert.equal(source.disconnected, true);
    assert.equal(source.onended, null);
  }
  for (const ended of [...staleEnded, ...lateEnded]) ended();
  audio.play('not base64');
  assert.equal(decode.mock.calls.length, 512);
  assert.equal(buffers.length, 512);
  assert.equal(sources.length, 512);
  assert.equal(audio.pending, false);
  assert.equal(playback.drains, 0);
  assert.equal(playback.context.state, 'closed');
  assert.deepEqual(outputDiagnostics(audio), {
    outputSamples: 512,
    completedOutputSamples: 0,
    discardedOutputSamples: 512,
  });
});

test('the duration limit still rejects long chunks below the source cap', async (t) => {
  const playback = createPlaybackHarness();
  const { audio, sources, buffers } = playback;
  t.after(() => audio.close());
  await audio.initialize();
  const second = pcmBytesToBase64(new ArrayBuffer(16000));
  for (let index = 0; index < 59; index++)
    audio.play(second, 'audio/pcm;rate=8000');
  assert.ok(Math.abs(audio.diagnostics().queuedSeconds - 59.02) < 1e-9);
  assert.throws(
    () => audio.play(second, 'audio/pcm;rate=8000'),
    /playback fell behind/,
  );
  assert.equal(buffers.length, 59);
  assert.equal(sources.length, 59);
});

test('audio playback records completed samples only as sources naturally end', async () => {
  const playback = createPlaybackHarness();
  const { audio, sources } = playback;
  await audio.initialize();
  audio.play('AAA=');
  audio.play('AAA=');
  assert.ok(sources[1].at > sources[0].at);
  assert.deepEqual(outputDiagnostics(audio), {
    outputSamples: 2,
    completedOutputSamples: 0,
    discardedOutputSamples: 0,
  });
  sources[0].onended();
  assert.equal(playback.drains, 0);
  assert.equal(audio.diagnostics().completedOutputSamples, 1);
  sources[1].onended();
  assert.equal(playback.drains, 1);
  assert.equal(audio.pending, false);
  assert.deepEqual(outputDiagnostics(audio), {
    outputSamples: 2,
    completedOutputSamples: 2,
    discardedOutputSamples: 0,
  });
  await audio.close();
  assert.equal(playback.context.state, 'closed');
  assert.deepEqual(outputDiagnostics(audio), {
    outputSamples: 2,
    completedOutputSamples: 2,
    discardedOutputSamples: 0,
  });
});

test('interruption records queued samples as discarded and rejects stale ended callbacks', async () => {
  const playback = createPlaybackHarness();
  const { audio, sources } = playback;
  await audio.initialize();
  audio.play('AAA=');
  audio.play(pcmBytesToBase64(new ArrayBuffer(4)));
  sources[0].onended();
  const staleEnded = sources[1].onended;
  audio.clearPlayback();
  assert.equal(sources[1].stopped, true);
  assert.equal(sources[1].onended, null);
  assert.equal(audio.pending, false);
  assert.equal(audio.diagnostics().queuedSeconds, 0);
  staleEnded();
  audio.clearPlayback();
  assert.equal(playback.drains, 0);
  assert.deepEqual(outputDiagnostics(audio), {
    outputSamples: 3,
    completedOutputSamples: 1,
    discardedOutputSamples: 2,
  });
  await audio.close();
  assert.deepEqual(outputDiagnostics(audio), {
    outputSamples: 3,
    completedOutputSamples: 1,
    discardedOutputSamples: 2,
  });
});

test('closing queued playback cannot count stopped sources as completed audio', async () => {
  const playback = createPlaybackHarness();
  const { audio, sources } = playback;
  await audio.initialize();
  audio.play('AAA=');
  audio.play(pcmBytesToBase64(new ArrayBuffer(4)));
  const staleEnded = sources.map((source) => source.onended);
  await audio.close();
  for (const source of sources) {
    assert.equal(source.stopped, true);
    assert.equal(source.onended, null);
  }
  for (const ended of staleEnded) ended();
  audio.play('AAA=');
  await audio.close();
  assert.equal(audio.pending, false);
  assert.equal(playback.drains, 0);
  assert.equal(audio.diagnostics().contextState, 'closed');
  assert.equal(audio.diagnostics().queuedSeconds, 0);
  assert.deepEqual(outputDiagnostics(audio), {
    outputSamples: 3,
    completedOutputSamples: 0,
    discardedOutputSamples: 3,
  });
});

test('capture diagnostics distinguish speech energy from silence without retaining audio', async () => {
  let capture;
  const emitted = [];
  const order = [];
  const identities = [];
  const gates = [];
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 } });
  class Context {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 16000;
      this.state = 'running';
      this.destination = {};
      this.audioWorklet = { addModule: async () => {} };
    }
    async resume() {}
    async close() {
      this.state = 'closed';
    }
    createGain() {
      return node();
    }
    createMediaStreamDestination() {
      return { ...node(), stream: { getTracks: () => [] } };
    }
    createMediaStreamSource() {
      return node();
    }
  }
  class Worklet {
    constructor() {
      capture = this;
      Object.assign(this, node());
      this.port = {
        postMessage(message) {
          gates.push(message);
        },
        close() {},
      };
    }
  }
  const audio = createGeminiAudio({
    AudioContextClass: Context,
    AudioWorkletNodeClass: Worklet,
    onAudioStart: (metadata) => {
      identities.push(metadata.captureId);
      order.push('start');
    },
    onAudio: (chunk, metadata) => {
      identities.push(metadata.captureId);
      emitted.push(chunk);
      order.push('audio');
    },
    onAudioEnd: (metadata) => {
      identities.push(metadata.captureId);
      order.push('end');
    },
  });
  await audio.initialize();
  audio.connectMicrophone({}, true, { captureId: 11 });
  const deliver = capture.port.onmessage;
  deliver({ data: { type: 'start', captureId: 11 } });
  capture.port.onmessage({
    data: { type: 'audio', captureId: 11, buffer: new ArrayBuffer(4) },
  });
  const spoken = new ArrayBuffer(4);
  new DataView(spoken).setInt16(0, 16384, true);
  capture.port.onmessage({
    data: { type: 'audio', captureId: 11, buffer: spoken },
  });
  deliver({ data: { type: 'end', captureId: 11 } });
  assert.deepEqual(order, ['start', 'audio', 'audio', 'end']);
  assert.deepEqual(identities, [11, 11, 11, 11]);
  assert.deepEqual(gates, [{ enabled: true, captureId: 11 }]);
  // Gate D does not relabel delayed B port messages.
  audio.setMicrophoneEnabled(false, { captureId: 11 });
  audio.setMicrophoneEnabled(true, { captureId: 12 });
  deliver({ data: { type: 'start', captureId: 11 } });
  deliver({ data: { type: 'audio', captureId: 11, buffer: spoken } });
  deliver({ data: { type: 'end', captureId: 11 } });
  assert.deepEqual(identities.slice(-3), [11, 11, 11]);
  const count = order.length;
  for (const captureId of [undefined, null, 0, -1, 1.5, '12', Infinity]) {
    deliver({ data: { type: 'start', captureId } });
    deliver({ data: { type: 'audio', captureId, buffer: spoken } });
    deliver({ data: { type: 'end', captureId } });
  }
  assert.equal(order.length, count);
  assert.equal(audio.diagnostics().inputChunks, 3);
  assert.equal(audio.diagnostics().nonSilentInputChunks, 2);
  assert.equal(audio.diagnostics().inputPeak, 0.5);
  assert.equal(emitted.length, 3);
  assert.equal(emitted[1].mimeType, 'audio/pcm;rate=16000');
  assert.deepEqual(Object.keys(emitted[1]).sort(), ['data', 'mimeType']);
  assert.equal(await audio.close(), true);
  assert.equal(audio.diagnostics().contextState, 'closed');
  deliver({ data: { type: 'start', captureId: 11 } });
  deliver({ data: { type: 'audio', captureId: 11, buffer: spoken } });
  deliver({ data: { type: 'end', captureId: 11 } });
  assert.deepEqual(order, [
    'start',
    'audio',
    'audio',
    'end',
    'start',
    'audio',
    'end',
  ]);
});

test('worklet rejects missing identity and stale release without changing the active capture', () => {
  const { capture, messages } = createCaptureHarness();
  for (const captureId of [undefined, null, 0, -1, 1.5, '1', Infinity])
    capture.port.onmessage({ data: { enabled: true, captureId } });
  capture.process([[new Float32Array([0.5])]]);
  assert.equal(messages.length, 0);
  capture.port.onmessage({ data: { enabled: true, captureId: 20 } });
  capture.process([[new Float32Array([0.5])]]);
  capture.port.onmessage({ data: { enabled: true, captureId: 21 } });
  capture.port.onmessage({ data: { enabled: false, captureId: 19 } });
  assert.equal(messages.length, 1);
  capture.port.onmessage({ data: { enabled: false, captureId: 20 } });
  assert.deepEqual(
    messages.map((message) => [message.type, message.captureId]),
    [
      ['start', 20],
      ['audio', 20],
      ['end', 20],
    ],
  );
  capture.port.onmessage({ data: { enabled: true, captureId: 21 } });
  capture.port.onmessage({ data: { enabled: false, captureId: 20 } });
  capture.process([[new Float32Array([0.25])]]);
  capture.port.onmessage({ data: { enabled: false, captureId: 21 } });
  assert.deepEqual(
    messages.slice(3).map((message) => [message.type, message.captureId]),
    [
      ['start', 21],
      ['audio', 21],
      ['end', 21],
    ],
  );
});
