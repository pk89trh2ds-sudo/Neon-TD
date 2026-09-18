type SfxName =
  | "ui"
  | "place"
  | "shoot-pulse"
  | "shoot-beam"
  | "shoot-nova"
  | "shoot-tesla"
  | "hit"
  | "kill"
  | "leak"
  | "wave"
  | "clear"
  | "upgrade"
  | "gameover"
  | "claim"
  | "deny"
  | "socket"
  | "cipher"
  | "coin";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private nextNote = 0;
  private step = 0;
  private voices = 0;
  unlocked = false;
  musicOn = true;
  sfxOn = true;
  musicVol = 0.5;
  sfxVol = 0.75;

  unlock() {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!this.ctx) {
      this.ctx = new AC({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise();
      this.applyGains();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.unlocked = true;
    this.startMusic();
    document.addEventListener("visibilitychange", this.onVis);
  }

  dispose() {
    document.removeEventListener("visibilitychange", this.onVis);
    this.stopMusic();
    void this.ctx?.close();
  }

  configure(opts: { musicOn: boolean; sfxOn: boolean; musicVol: number; sfxVol: number }) {
    this.musicOn = opts.musicOn;
    this.sfxOn = opts.sfxOn;
    this.musicVol = opts.musicVol;
    this.sfxVol = opts.sfxVol;
    this.applyGains();
    if (this.musicOn) this.startMusic();
    else this.stopMusic();
  }

  play(name: SfxName) {
    if (!this.unlocked || !this.sfxOn || !this.ctx || !this.sfxBus) return;
    if (this.voices > 18) return;
    const t = this.ctx.currentTime;
    const rate = 1 + (Math.random() * 2 - 1) * 0.08;
    switch (name) {
      case "ui":
        this.tone(880 * rate, t, 0.05, "sine", 0.08, 0.001, 0.04);
        break;
      case "place":
        this.tone(140, t, 0.12, "sine", 0.22, 0.001, 0.1);
        this.tone(620 * rate, t, 0.06, "triangle", 0.1, 0.001, 0.05);
        break;
      case "shoot-pulse":
        this.tone(420 * rate, t, 0.07, "sine", 0.12, 0.001, 0.05);
        this.tone(840 * rate, t, 0.04, "triangle", 0.06, 0, 0.03);
        break;
      case "shoot-beam":
        this.tone(1280 * rate, t, 0.05, "sawtooth", 0.05, 0, 0.04);
        break;
      case "shoot-nova":
        this.noiseBurst(t, 0.12, 0.12, 600);
        this.tone(180, t, 0.16, "sine", 0.18, 0.002, 0.12);
        break;
      case "shoot-tesla":
        this.noiseBurst(t, 0.06, 0.1, 1800);
        this.tone(1960 * rate, t, 0.04, "square", 0.05, 0, 0.03);
        break;
      case "hit":
        this.tone(240 * rate, t, 0.04, "triangle", 0.07, 0, 0.03);
        break;
      case "kill":
        this.tone(320, t, 0.1, "sine", 0.14, 0.001, 0.08);
        this.noiseBurst(t, 0.08, 0.08, 900);
        break;
      case "leak":
        this.tone(220, t, 0.28, "sawtooth", 0.12, 0.01, 0.22);
        this.tone(110, t + 0.04, 0.22, "sine", 0.16, 0.01, 0.18);
        break;
      case "wave":
        this.swell(t);
        break;
      case "clear":
        this.arpeggio(t, [523, 659, 784, 1046], 0.09);
        break;
      case "upgrade":
        this.arpeggio(t, [392, 523, 659], 0.08);
        break;
      case "gameover":
        this.arpeggio(t, [392, 311, 247, 196], 0.16);
        break;
      case "claim":
        this.arpeggio(t, [784, 988, 1174], 0.06);
        break;
      case "deny":
        this.tone(140, t, 0.12, "square", 0.08, 0, 0.1);
        break;
      case "socket":
        this.tone(520 * rate, t, 0.08, "triangle", 0.12, 0.001, 0.06);
        this.tone(780 * rate, t + 0.04, 0.07, "sine", 0.08, 0, 0.05);
        break;
      case "cipher":
        this.arpeggio(t, [523, 659, 784, 1046, 1318], 0.07);
        this.noiseBurst(t, 0.1, 0.08, 1200);
        break;
      case "coin":
        this.tone(988 * rate, t, 0.07, "sine", 0.1, 0.001, 0.05);
        this.tone(1318 * rate, t + 0.05, 0.08, "triangle", 0.08, 0, 0.06);
        break;
    }
  }

  private onVis = () => {
    if (!this.ctx) return;
    if (document.hidden) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
  };

  private applyGains() {
    const now = this.ctx?.currentTime ?? 0;
    const curve = (v: number) => v * v;
    this.master?.gain.setTargetAtTime(1, now, 0.02);
    this.musicBus?.gain.setTargetAtTime(this.musicOn ? curve(this.musicVol) * 0.22 : 0, now, 0.05);
    this.sfxBus?.gain.setTargetAtTime(this.sfxOn ? curve(this.sfxVol) : 0, now, 0.02);
  }

  private startMusic() {
    if (!this.ctx || !this.musicOn || this.musicTimer != null) return;
    this.nextNote = this.ctx.currentTime + 0.05;
    this.step = 0;
    const tick = () => {
      if (!this.ctx || !this.musicOn) return;
      const t = this.ctx.currentTime;
      while (this.nextNote < t + 0.18) this.scheduleBeat(this.nextNote);
      this.musicTimer = window.setTimeout(tick, 80);
    };
    tick();
  }

  private stopMusic() {
    if (this.musicTimer != null) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private scheduleBeat(when: number) {
    if (!this.ctx || !this.musicBus) return;
    const bpm = 92;
    const spb = 60 / bpm / 2;
    const step = this.step % 16;
    const root = 55;
    const pad = [0, 7, 10, 12];
    if (step === 0) {
      for (const s of pad) this.padNote(root * 2 ** (s / 12), when, spb * 8);
    }
    const arp = [0, 7, 12, 15, 12, 7, 10, 7];
    const n = arp[step % arp.length]!;
    this.toneAt(this.musicBus, root * 4 * 2 ** (n / 12), when, 0.12, "triangle", 0.035, 0.01, 0.1);
    if (step % 8 === 0) this.toneAt(this.musicBus, root, when, 0.18, "sine", 0.05, 0.002, 0.14);
    this.nextNote = when + spb;
    this.step += 1;
  }

  private padNote(freq: number, when: number, dur: number) {
    if (!this.musicBus) return;
    this.toneAt(this.musicBus, freq, when, dur, "sine", 0.03, 0.4, dur * 0.8);
    this.toneAt(this.musicBus, freq * 1.005, when, dur, "sine", 0.02, 0.4, dur * 0.8);
  }

  private tone(
    freq: number,
    when: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    attack: number,
    release: number,
  ) {
    if (!this.sfxBus) return;
    this.toneAt(this.sfxBus, freq, when, dur, type, gain, attack, release);
  }

  private toneAt(
    bus: GainNode,
    freq: number,
    when: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    attack: number,
    release: number,
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + Math.max(0.004, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + release);
    osc.connect(g);
    g.connect(bus);
    osc.start(when);
    osc.stop(when + dur + release + 0.02);
    this.voices += 1;
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
      this.voices = Math.max(0, this.voices - 1);
    };
  }

  private noiseBurst(when: number, dur: number, gain: number, hp: number) {
    if (!this.ctx || !this.sfxBus || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxBus);
    src.start(when);
    src.stop(when + dur);
    this.voices += 1;
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
      this.voices = Math.max(0, this.voices - 1);
    };
  }

  private swell(when: number) {
    this.tone(196, when, 0.4, "sine", 0.12, 0.05, 0.3);
    this.tone(392, when + 0.08, 0.32, "triangle", 0.08, 0.04, 0.24);
  }

  private arpeggio(when: number, notes: number[], gap: number) {
    notes.forEach((n, i) => this.tone(n, when + i * gap, 0.1, "sine", 0.1, 0.005, 0.08));
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}

export const audio = new AudioEngine();
