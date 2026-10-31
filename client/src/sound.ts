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

/**
 * Continuous race soundscape: a soft ambient pad while playing, plus a beast layer (low drone + heartbeat)
 * whose volume and tempo rise as the beast gets closer. setDanger(0..1) drives it.
 */
export class Soundscape {
  private a: AudioContext | null = null;
  private master: GainNode | null = null;
  private danger: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  private beatTimer = 0;
  private level = 0;
  private running = false;

  start(withBeast: boolean) {
    if (this.running) return;
    try {
      const a = ac();
      a.resume?.();
      this.a = a;
      this.running = true;
      const master = a.createGain();
      master.gain.value = 0;
      master.gain.linearRampToValueAtTime(1, a.currentTime + 1.5);
      master.connect(a.destination);
      this.master = master;
      // ambient pad: two detuned triangles through a slow-wobbling low-pass
      const lp = a.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600;
      const padGain = a.createGain();
      padGain.gain.value = 0.025;
      lp.connect(padGain).connect(master);
      for (const f of [110, 164.8, 220.5]) {
        const o = a.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.connect(lp);
        o.start();
        this.nodes.push(o);
      }
      const lfo = a.createOscillator();
      const lfoAmt = a.createGain();
      lfo.frequency.value = 0.08;
      lfoAmt.gain.value = 250;
      lfo.connect(lfoAmt).connect(lp.frequency);
      lfo.start();
      this.nodes.push(lfo);
      if (withBeast) {
        // beast drone: sawtooth rumble, filter opens and gain rises with danger
        const g = a.createGain();
        g.gain.value = 0;
        const f = a.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 120;
        f.connect(g).connect(master);
        for (const fr of [46, 46.7, 69]) {
          const o = a.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = fr;
          o.connect(f);
          o.start();
          this.nodes.push(o);
        }
        this.danger = g;
        this.filter = f;
        this.scheduleBeat();
      }
    } catch {
      this.running = false;
    }
  }

  /** 0 = beast far or asleep, 1 = right behind you. */
  setDanger(k: number) {
    this.level = Math.max(0, Math.min(1, k));
    if (!this.a || !this.danger || !this.filter) return;
    const t = this.a.currentTime;
    this.danger.gain.setTargetAtTime(this.level * this.level * 0.22, t, 0.15);
    this.filter.frequency.setTargetAtTime(120 + this.level * 700, t, 0.15);
  }

  private scheduleBeat() {
    if (!this.running) return;
    // heartbeat speeds up from ~50 to ~150 bpm as danger rises; silent when far
    const bpm = 50 + this.level * 100;
    if (this.level > 0.08) {
      tone(58, 0.12, 0, 'sine', 0.05 + this.level * 0.25);
      tone(52, 0.1, 0.16, 'sine', 0.03 + this.level * 0.18);
    }
    this.beatTimer = window.setTimeout(() => this.scheduleBeat(), 60000 / bpm);
  }

  stop() {
    this.running = false;
    clearTimeout(this.beatTimer);
    const a = this.a, m = this.master;
    if (a && m) {
      m.gain.cancelScheduledValues(a.currentTime);
      m.gain.setTargetAtTime(0, a.currentTime, 0.2);
      const nodes = this.nodes;
      setTimeout(() => { for (const n of nodes) try { n.stop(); } catch { /* already stopped */ } m.disconnect(); }, 800);
    }
    this.nodes = [];
    this.danger = this.filter = this.master = null;
  }
}
