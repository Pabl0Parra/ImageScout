import math
import random
import struct
import wave

SR = 44100
DURATION = 25.5
random.seed(7)

N = int(SR * DURATION)


def note_hz(semitones_from_a4):
    return 440.0 * (2.0 ** (semitones_from_a4 / 12.0))


# chord progression (semitones from A4), slow pad, ~6.375s per chord x4 = 25.5s
# Cmaj9(add) - Am7 - Fmaj7 - Gsus4  (bright, hopeful, tech/product feel)
CHORDS = [
    [-9, -5, -2, 2, 5],     # C E G B D  (Cmaj9)
    [-12, -9, -5, -2],      # A C E G   (Am7)
    [-16, -12, -9, -4],     # F A C E   (Fmaj7)
    [-14, -9, -7, -2],      # G C D F   (Gsus-ish, adds motion)
]
SEG = DURATION / len(CHORDS)


def env_adsr(t, dur, a=0.8, r=0.8, sustain=1.0):
    if t < a:
        return (t / a)
    if t > dur - r:
        return max(0.0, (dur - t) / r)
    return sustain


left = [0.0] * N
right = [0.0] * N

# --- pad chords ---
for ci, chord in enumerate(CHORDS):
    seg_start = ci * SEG
    seg_end = seg_start + SEG
    i0 = int(seg_start * SR)
    i1 = int(seg_end * SR)
    for note_i, semi in enumerate(chord):
        freq = note_hz(semi)
        detune = 1.0 + (0.0016 * (1 if note_i % 2 == 0 else -1))
        pan = 0.5 + 0.35 * math.sin(note_i * 1.7)
        amp = 0.05 / (1 + 0.18 * note_i)
        for n in range(i0, i1):
            t = (n - i0) / SR
            local_t = t
            e = env_adsr(local_t, SEG, a=1.0, r=1.4, sustain=0.85)
            phase = 2 * math.pi * freq * detune * t
            # soft sine + faint octave for warmth
            s = math.sin(phase) + 0.18 * math.sin(2 * phase)
            v = s * amp * e
            left[n] += v * (1.0 - pan * 0.5)
            right[n] += v * (0.5 + pan * 0.5)

# --- gentle pulsing bass root ---
for ci, chord in enumerate(CHORDS):
    seg_start = ci * SEG
    seg_end = seg_start + SEG
    i0 = int(seg_start * SR)
    i1 = int(seg_end * SR)
    root_semi = chord[0] - 12
    freq = note_hz(root_semi)
    pulse_hz = 1.6
    for n in range(i0, i1):
        t = (n - i0) / SR
        e = env_adsr(t, SEG, a=0.6, r=1.0, sustain=1.0)
        pulse = 0.5 + 0.5 * (0.5 + 0.5 * math.sin(2 * math.pi * pulse_hz * t))
        pulse = pulse ** 2
        s = math.sin(2 * math.pi * freq * t)
        v = s * 0.09 * e * pulse
        left[n] += v
        right[n] += v

# --- sparse shimmer arpeggio for a premium/tech sparkle ---
arp_semitones = [14, 17, 19, 22, 24]
beat = 0.42
n_beats = int(DURATION / beat)
for b in range(n_beats):
    t0 = b * beat
    if t0 < 2.0 or t0 > DURATION - 3.0:
        continue
    if random.random() > 0.55:
        continue
    semi = random.choice(arp_semitones)
    freq = note_hz(semi)
    dur = beat * 1.8
    i0 = int(t0 * SR)
    i1 = min(N, int((t0 + dur) * SR))
    pan = random.uniform(-0.6, 0.6)
    amp = 0.035
    for n in range(i0, i1):
        t = (n - i0) / SR
        e = math.exp(-t * 4.2) * min(1.0, t / 0.01)
        s = math.sin(2 * math.pi * freq * t)
        v = s * amp * e
        left[n] += v * (1.0 - max(0, pan))
        right[n] += v * (1.0 + min(0, pan))

# --- soft riser into the final segment (outro impact) ---
riser_start = DURATION - 5.0
riser_end = DURATION - 1.6
for n in range(int(riser_start * SR), min(N, int(riser_end * SR))):
    t = (n - int(riser_start * SR)) / SR
    dur = riser_end - riser_start
    frac = t / dur
    freq = 300 + 900 * frac
    e = 0.02 * frac * frac
    s = math.sin(2 * math.pi * freq * (n / SR))
    left[n] += s * e
    right[n] += s * e

# --- master fade in/out & soft limiter ---
fade_in = 1.3
fade_out = 2.2
for n in range(N):
    t = n / SR
    g = 1.0
    if t < fade_in:
        g *= t / fade_in
    if t > DURATION - fade_out:
        g *= max(0.0, (DURATION - t) / fade_out)
    left[n] *= g
    right[n] *= g

def soft_clip(x):
    return math.tanh(x * 1.4) / math.tanh(1.4)

frames = bytearray()
for n in range(N):
    l = max(-1.0, min(1.0, soft_clip(left[n])))
    r = max(-1.0, min(1.0, soft_clip(right[n])))
    frames += struct.pack('<hh', int(l * 32000), int(r * 32000))

with wave.open('promo_music.wav', 'wb') as wf:
    wf.setnchannels(2)
    wf.setsampwidth(2)
    wf.setframerate(SR)
    wf.writeframes(bytes(frames))

print('wrote promo_music.wav', DURATION, 's')
