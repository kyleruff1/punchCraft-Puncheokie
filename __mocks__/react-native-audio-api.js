/**
 * Jest mock for `react-native-audio-api`.
 *
 * The real package is C++/Oboe behind a JSI binding, so importing it under
 * jest throws "Failed to install react-native-audio-api: The native module
 * could not be found". That is not a test-only inconvenience — any screen
 * transitively importing the Oboe engine would fail to LOAD, which is how
 * `jamRows.test.tsx` broke the moment the engine was wired into the factory.
 *
 * Jest picks a root `__mocks__/<package>.js` up automatically for node_modules
 * packages, with no `jest.mock()` call at the top of every suite — which is
 * what we want, because the screens that import this do so indirectly and
 * should not each have to know about it.
 *
 * Deliberately a NO-OP graph rather than a spy rig. Nothing in the suite
 * asserts on Oboe behaviour: the engine's real verification is on-device
 * latency and Kyle's ear, and a JS fake of an audio graph would prove neither.
 * Its only job is to let modules import and construct without throwing.
 */

class FakeAudioParam {
  constructor() {
    this.value = 1
  }
  setValueAtTime() {}
  linearRampToValueAtTime() {}
}

class FakeAudioNode {
  connect() {}
  disconnect() {}
}

class FakeGainNode extends FakeAudioNode {
  constructor() {
    super()
    this.gain = new FakeAudioParam()
  }
}

class FakeAnalyserNode extends FakeAudioNode {
  constructor() {
    super()
    this.fftSize = 2048
    this.frequencyBinCount = 1024
  }
  // Silence is 128 for byte time-domain data.
  getByteTimeDomainData(array) {
    array.fill(128)
  }
  getByteFrequencyData(array) {
    array.fill(0)
  }
}

class FakeAudioBufferSourceNode extends FakeAudioNode {
  constructor() {
    super()
    this.buffer = null
    this.loop = false
    this.loopStart = 0
    this.loopEnd = 0
  }
  start() {}
  stop() {}
}

class FakeAudioBuffer {
  constructor(channels = 1, length = 1, sampleRate = 48000) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.duration = length / sampleRate
  }
  getChannelData() {
    return new Float32Array(this.length)
  }
}

class AudioContext {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate ?? 48000
    this.state = 'running'
    this.currentTime = 0
    this.destination = new FakeAudioNode()
  }
  createBufferSource() {
    return new FakeAudioBufferSourceNode()
  }
  createGain() {
    return new FakeGainNode()
  }
  createAnalyser() {
    return new FakeAnalyserNode()
  }
  createBuffer(channels, length, sampleRate) {
    return new FakeAudioBuffer(channels, length, sampleRate)
  }
  async decodeAudioData() {
    return new FakeAudioBuffer(1, 48, this.sampleRate)
  }
  async close() {
    this.state = 'closed'
  }
  async suspend() {
    this.state = 'suspended'
  }
  async resume() {
    this.state = 'running'
  }
}

async function decodeAudioData() {
  return new FakeAudioBuffer(1, 48, 48000)
}

module.exports = {
  AudioContext,
  decodeAudioData,
  AudioBuffer: FakeAudioBuffer,
  AnalyserNode: FakeAnalyserNode,
  AudioBufferSourceNode: FakeAudioBufferSourceNode,
  GainNode: FakeGainNode,
}
