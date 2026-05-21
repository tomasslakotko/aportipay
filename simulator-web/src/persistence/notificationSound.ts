export type NotificationSoundPreset = 'soft' | 'classic' | 'loud'

let sharedAudioContext: AudioContext | null = null
let unlockBound = false

const getAudioContext = () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new window.AudioContext()
  }
  return sharedAudioContext
}

const tryResumeAudio = () => {
  const context = getAudioContext()
  if (context.state !== 'running') {
    void context.resume().catch(() => {})
  }
}

const bindAudioUnlock = () => {
  if (unlockBound) return
  unlockBound = true
  const unlock = () => {
    tryResumeAudio()
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('touchstart', unlock, { passive: true })
  window.addEventListener('keydown', unlock)
}

const playTone = (
  audioContext: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  gainValue: number,
  wave: OscillatorType,
) => {
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  oscillator.type = wave
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.linearRampToValueAtTime(gainValue, startAt + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + duration)
}

export const playNotificationSound = (preset: NotificationSoundPreset) => {
  bindAudioUnlock()
  const audioContext = getAudioContext()
  if (audioContext.state !== 'running') {
    // iOS/Safari may block until a user gesture; try resume and exit quietly.
    void audioContext.resume().catch(() => {})
    return
  }
  const now = audioContext.currentTime

  if (preset === 'classic') {
    playTone(audioContext, 880, now, 0.09, 0.018, 'sine')
    return
  }

  if (preset === 'loud') {
    playTone(audioContext, 760, now, 0.11, 0.04, 'square')
    playTone(audioContext, 1020, now + 0.1, 0.16, 0.035, 'square')
    return
  }

  playTone(audioContext, 740, now, 0.11, 0.02, 'triangle')
  playTone(audioContext, 988, now + 0.1, 0.14, 0.018, 'triangle')
}
