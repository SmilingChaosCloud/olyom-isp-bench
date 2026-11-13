# Independent transcription of docs/color/pen-f/GRAIN.md and SHARPENING.md for cross-checking the JS pipeline.
import json, random
random.seed(7)
def clamp(v, a, b): return max(a, min(b, v))
state = 10
grain = []
for _ in range(20000):
    Y, M, gain = random.randrange(65536), random.randrange(65536), random.choice([0, 50, 110, 300, 600, 1023])
    state ^= (state << 13) & 0xffffffff
    state ^= state >> 17
    state ^= (state << 5) & 0xffffffff
    state &= 0xffffffff
    r = (state & 65535) - 32768
    w = (M + ((M >> 15) & 1)) >> 6
    noise = (((gain * w) >> 10) * r) >> 10
    noise = clamp(noise, -6682, 65535)
    grain.append([Y, M, gain, clamp(Y + noise, 0, 65535)])
sharpen = []
for _ in range(20000):
    e, A, K, p, n = random.randrange(-1023, 1024), random.randrange(64), random.randrange(513), random.randrange(1024), random.randrange(1024)
    v = min((max(0, e - A) * K) >> 6, p, 1023) if e >= 0 else -min((max(0, -e - A) * K) >> 6, n, 1023)
    sharpen.append([e, A, K, p, n, v])
print(json.dumps(dict(grain=grain, sharpen=sharpen)))
