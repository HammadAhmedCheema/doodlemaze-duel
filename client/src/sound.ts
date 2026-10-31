// All sounds are synthesized with Web Audio: no audio assets.
let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)());

function tone(freq: number, dur: number, at = 0, type: OscillatorType = 'square', vol = 0.06) {
  try {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t = a.currentTime + at;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch {
    /* audio unavailable */
  }
}

export const sfx = {
  beep: (f: number, d: number) => tone(f, d),
  click: () => tone(660, 0.05, 0, 'triangle', 0.04),
  jingle: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, i * 0.11, 'triangle', 0.08)),
  growl: (k: number) => {
    // low detuned rumble, louder when the beast is closer
    tone(55 + Math.random() * 10, 0.5, 0, 'sawtooth', 0.03 + 0.07 * k);
    tone(41, 0.6, 0.05, 'square', 0.02 + 0.05 * k);
  },
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.25, i * 0.14, 'sawtooth', 0.04)),
};
