// A tiny procedural soundscape: surf, wind, and one far-off harbor bell.
// Everything is synthesized; no audio files are loaded.

export function createAudio() {
  let context = null;
  let master = null;
  let waveGain = null;
  let windGain = null;
  let enabled = false;
  let bellTimer = 9;
  let supported = true;

  function noiseBuffer(seconds = 3) {
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      data[i] = last * 2.2 + white * 0.16;
    }
    // Crossfade the loop seam so the surf does not tick.
    const fade = Math.min(2048, Math.floor(length / 8));
    for (let i = 0; i < fade; i++) {
      const u = i / fade;
      data[i] = data[i] * u + data[length - fade + i] * (1 - u);
    }
    return buffer;
  }

  function build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      supported = false;
      return false;
    }
    context = new Ctx();
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const surfBuffer = noiseBuffer(4);
    const surf = context.createBufferSource();
    surf.buffer = surfBuffer;
    surf.loop = true;
    const surfFilter = context.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 540;
    surfFilter.Q.value = 0.55;
    waveGain = context.createGain();
    waveGain.gain.value = 0.07;
    surf.connect(surfFilter).connect(waveGain).connect(master);
    surf.start();

    const wind = context.createBufferSource();
    wind.buffer = surfBuffer;
    wind.loop = true;
    wind.playbackRate.value = 1.37;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 860;
    windFilter.Q.value = 0.7;
    windGain = context.createGain();
    windGain.gain.value = 0.015;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
    return true;
  }

  function ringBell() {
    if (!context || !enabled) return;
    const now = context.currentTime + 0.02;
    const partials = [
      [392.0, 0.038, 4.4],
      [587.3, 0.02, 3.8],
      [784.5, 0.011, 3.2],
      [1174.0, 0.005, 2.3],
    ];
    for (const [frequency, level, decay] of partials) {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(level, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(gain).connect(master);
      osc.start(now);
      osc.stop(now + decay + 0.1);
    }
  }

  function toggle() {
    if (!supported) return false;
    if (!context && !build()) return false;
    enabled = !enabled;
    if (context.state === 'suspended') context.resume();
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(enabled ? 0.62 : 0, context.currentTime, 0.55);
    return enabled;
  }

  function update({ dt, time, weather }) {
    if (!enabled || !context || !waveGain) return;
    const rain = weather?.rain ?? 0;
    const wind = weather?.wind ?? 0.4;
    const surfLevel = 0.062
      + Math.sin(time * 0.43) * 0.018
      + Math.sin(time * 0.17 + 1.7) * 0.009
      + rain * 0.014;
    waveGain.gain.setTargetAtTime(surfLevel, context.currentTime, 0.4);
    windGain.gain.setTargetAtTime(0.011 + wind * 0.012, context.currentTime, 0.9);
    bellTimer -= dt;
    if (bellTimer <= 0) {
      bellTimer = 21 + Math.sin(time * 0.31 + 0.8) * 7;
      ringBell();
    }
  }

  return {
    toggle,
    update,
    get enabled() { return enabled; },
    get supported() { return supported; },
  };
}
