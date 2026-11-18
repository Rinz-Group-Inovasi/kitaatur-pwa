// Audio Chime Generator using HTML5 Web Audio API (No external sound files required)

class KioskAudioManager {
  private ctx: AudioContext | null = null

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }

  // Nada Sukses: Ding-dong gembira (880Hz -> 1760Hz)
  playSuccess() {
    try {
      this.initCtx()
      if (!this.ctx) return

      const now = this.ctx.currentTime
      const osc1 = this.ctx.createOscillator()
      const osc2 = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      osc1.type = 'sine'
      osc2.type = 'sine'

      // Note 1: A5 (880Hz)
      osc1.frequency.setValueAtTime(880, now)
      // Note 2: A6 (1760Hz)
      osc2.frequency.setValueAtTime(1760, now + 0.1)

      gain.gain.setValueAtTime(0.3, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)

      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(this.ctx.destination)

      osc1.start(now)
      osc1.stop(now + 0.1)
      osc2.start(now + 0.1)
      osc2.stop(now + 0.45)
    } catch (e) {
      console.warn('Audio playback not allowed or failed:', e)
    }
  }

  // Nada Terlambat: Nada lembut pengingat (600Hz -> 750Hz)
  playLate() {
    try {
      this.initCtx()
      if (!this.ctx) return

      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      osc.type = 'triangle'
      osc.frequency.setValueAtTime(600, now)
      osc.frequency.linearRampToValueAtTime(750, now + 0.15)

      gain.gain.setValueAtTime(0.35, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)

      osc.connect(gain)
      gain.connect(this.ctx.destination)

      osc.start(now)
      osc.stop(now + 0.5)
    } catch (e) {
      console.warn('Audio error:', e)
    }
  }

  // Nada Error / Kartu Belum Terdaftar: Buzzer Rendah (220Hz)
  playError() {
    try {
      this.initCtx()
      if (!this.ctx) return

      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(220, now)
      osc.frequency.setValueAtTime(180, now + 0.15)

      gain.gain.setValueAtTime(0.3, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)

      osc.connect(gain)
      gain.connect(this.ctx.destination)

      osc.start(now)
      osc.stop(now + 0.4)
    } catch (e) {
      console.warn('Audio error:', e)
    }
  }

  // Nada Sudah Pernah Tap / Duplikat (Blip pendek)
  playDuplicate() {
    try {
      this.initCtx()
      if (!this.ctx) return

      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(520, now)

      gain.gain.setValueAtTime(0.2, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)

      osc.connect(gain)
      gain.connect(this.ctx.destination)

      osc.start(now)
      osc.stop(now + 0.2)
    } catch (e) {
      console.warn('Audio error:', e)
    }
  }
}

export const kioskAudio = new KioskAudioManager()

