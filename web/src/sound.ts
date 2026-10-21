export type Cue = 'place' | 'perfect' | 'remove' | 'refuse';

/** Quiet, synthesized foley: a short filtered noise "tok" over a low body tone, pitch-jittered so repeats never sound identical. */
export class Sound {
  muted = false;
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  play(cue: Cue = 'place'): void {
    if (this.muted) return;
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      void context.resume();
      const now = context.currentTime;
      const jitter = 0.92 + Math.random() * 0.16;
      const tone = { place: 210, perfect: 210, remove: 150, refuse: 110 }[cue] * jitter;
      const output = context.createGain();
      output.gain.value = cue === 'refuse' ? 0.05 : 0.09;
      output.connect(context.destination);

      const body = context.createOscillator();
      const bodyGain = context.createGain();
      body.type = 'triangle';
      body.frequency.setValueAtTime(tone * 1.6, now);
      body.frequency.exponentialRampToValueAtTime(tone, now + 0.08);
      bodyGain.gain.setValueAtTime(0.0001, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.7, now + 0.006);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + (cue === 'remove' ? 0.12 : 0.2));
      body.connect(bodyGain).connect(output);
      body.start(now);
      body.stop(now + 0.25);

      if (cue !== 'refuse') {
        this.noise ??= this.whiteNoise(context);
        const click = context.createBufferSource();
        click.buffer = this.noise;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = (cue === 'remove' ? 1200 : 1900) * jitter;
        filter.Q.value = 1.4;
        const clickGain = context.createGain();
        clickGain.gain.setValueAtTime(0.5, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
        click.connect(filter).connect(clickGain).connect(output);
        click.start(now);
        click.stop(now + 0.06);
      }
      if (cue === 'perfect') {
        // A soft rising fifth after the tile lands marks a perfect fit.
        [784, 1175].forEach((frequency, index) => {
          const start = now + 0.09 + index * 0.08;
          const chime = context.createOscillator();
          const gain = context.createGain();
          chime.type = 'sine';
          chime.frequency.value = frequency * jitter;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.35, start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
          chime.connect(gain).connect(output);
          chime.start(start);
          chime.stop(start + 0.4);
        });
      }
    } catch {
      this.muted = true;
    }
  }

  private whiteNoise(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.06), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
