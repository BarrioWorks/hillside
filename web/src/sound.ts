export class Sound {
  muted = false;
  private context: AudioContext | null = null;
  play(valid = true): void {
    if (this.muted) return;
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(valid ? 660 : 180, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(valid ? 990 : 130, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
    } catch {
      this.muted = true;
    }
  }
}
