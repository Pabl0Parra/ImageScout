import subprocess

FFMPEG = r"C:\Users\p.parra\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"

durations = {
    "scene1.mp4": 3.6,
    "scene2.mp4": 4.6,
    "scene3.mp4": 4.6,
    "scene4.mp4": 5.2,
    "scene5.mp4": 4.2,
    "scene6.mp4": 4.0,
}
clips = list(durations.keys())
T = 0.6

# compute cumulative offsets for chained xfade
cum = durations[clips[0]]
offsets = []
for i in range(1, len(clips)):
    offsets.append(cum - T)
    cum = cum + durations[clips[i]] - T

print("offsets:", offsets, "final duration:", cum)

inputs = []
for c in clips:
    inputs += ["-i", c]

filters = []
prev_label = "0:v"
for i in range(1, len(clips)):
    out_label = f"v{i}" if i < len(clips) - 1 else "vout"
    filters.append(
        f"[{prev_label}][{i}:v]xfade=transition=fade:duration={T}:offset={offsets[i-1]:.3f}[{out_label}]"
    )
    prev_label = out_label

filter_complex = ";".join(filters)

cmd = [
    FFMPEG, "-y",
    *inputs,
    "-filter_complex", filter_complex,
    "-map", "[vout]",
    "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
    "video_only.mp4",
]
print(">> concatenating with xfade...")
r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode != 0:
    print(r.stdout[-3000:])
    print(r.stderr[-4000:])
    raise SystemExit("concat failed")
print("wrote video_only.mp4, target duration", cum)

# mux with music, trimmed + faded to match
final_duration = cum
cmd2 = [
    FFMPEG, "-y",
    "-i", "video_only.mp4",
    "-i", "promo_music.wav",
    "-filter_complex",
    f"[1:a]atrim=0:{final_duration},afade=t=out:st={final_duration-1.2}:d=1.2[a]",
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    "ImageScout_promo.mp4",
]
print(">> muxing audio...")
r = subprocess.run(cmd2, capture_output=True, text=True)
if r.returncode != 0:
    print(r.stdout[-3000:])
    print(r.stderr[-4000:])
    raise SystemExit("mux failed")
print("wrote ImageScout_promo.mp4")
