/** PCM microphone capture. Only explicitly enabled frames leave this processor. */
class GeminiCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.captureId = null;
    this.samples = new Int16Array(1024);
    this.length = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.enabled === true) {
        if (
          this.enabled ||
          !Number.isSafeInteger(data.captureId) ||
          data.captureId <= 0
        )
          return;
        this.captureId = data.captureId;
        this.enabled = true;
        this.port.postMessage({ type: 'start', captureId: this.captureId });
      } else if (
        data?.enabled === false &&
        this.enabled &&
        data.captureId === this.captureId
      ) {
        this.flush();
        this.port.postMessage({ type: 'end', captureId: this.captureId });
        this.enabled = false;
        this.captureId = null;
        this.length = 0;
      }
    };
  }
  flush() {
    if (!this.length) return;
    const buffer = new ArrayBuffer(this.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < this.length; i++)
      view.setInt16(i * 2, this.samples[i], true);
    this.port.postMessage(
      { type: 'audio', buffer, captureId: this.captureId },
      [buffer],
    );
    this.length = 0;
  }
  process(inputs) {
    if (!this.enabled) return true;
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      const value = Math.max(-1, Math.min(1, sample));
      this.samples[this.length++] = Math.round(
        value * (value < 0 ? 32768 : 32767),
      );
      if (this.length === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor('gev-gemini-capture', GeminiCaptureProcessor);
