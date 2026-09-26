import subprocess
import sys

FFMPEG = r"C:\Users\p.parra\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"
W, H, FPS = 1920, 1080, 30

ACCENT = "7dd3fcff"   # light blue
WHITE = "ffffffff"
SUBWHITE = "e8eef7ff"

FONT_BOLD = "'C:/Windows/Fonts/segoeuib.ttf'"
FONT_SEMI = "'C:/Windows/Fonts/seguisb.ttf'"
FONT_REG = "'C:/Windows/Fonts/segoeui.ttf'"


def run(cmd):
    print(">>", " ".join(cmd[:3]), "...")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        print(r.stderr[-4000:])
        raise SystemExit(f"ffmpeg failed: {cmd[-1]}")


def render_kenburns(plate, out, duration, zoom_target=1.12):
    total_frames = max(1, round(duration * FPS))
    step = (zoom_target - 1) / total_frames
    vf = (
        f"scale=3200:-2,"
        f"zoompan=z='min(zoom+{step:.8f},{zoom_target})':d=1:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS},"
        f"format=yuv420p"
    )
    cmd = [
        FFMPEG, "-y", "-loop", "1", "-i", plate, "-t", str(duration),
        "-vf", vf,
        "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
        out,
    ]
    run(cmd)


def xfade_two(clip_a, dur_a, clip_b, dur_b, out, t=0.6):
    offset = max(0.0, dur_a - t)
    fc = f"[0:v][1:v]xfade=transition=fade:duration={t}:offset={offset},format=yuv420p[outv]"
    cmd = [
        FFMPEG, "-y", "-i", clip_a, "-i", clip_b,
        "-filter_complex", fc, "-map", "[outv]",
        "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
        out,
    ]
    run(cmd)


def build_caption_filters(eyebrow, headline, box_alpha=0.60, fade_start=0.35, fade_dur=0.55):
    a = f"if(lt(t,{fade_start}),0,if(lt(t,{fade_start+fade_dur}),(t-{fade_start})/{fade_dur},1))"
    parts = []
    parts.append(
        f"drawbox=x=0:y={H-236}:w={W}:h=236:color=black@{box_alpha}:t=fill"
    )
    parts.append(
        "drawtext=fontfile=" + FONT_SEMI +
        f":text='{eyebrow}':fontcolor={ACCENT}:fontsize=34:"
        f"x=120:y={H-176}:alpha='{a}'"
    )
    parts.append(
        "drawtext=fontfile=" + FONT_BOLD +
        f":text='{headline}':fontcolor={WHITE}:fontsize=52:"
        f"x=120:y={H-124}:alpha='{a}'"
    )
    return parts


def add_text(in_path, out_path, filters):
    vf = ",".join(filters)
    cmd = [
        FFMPEG, "-y", "-i", in_path, "-vf", vf,
        "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
        out_path,
    ]
    run(cmd)


def title_card(in_path, out_path, logo_path, title, subtitle, duration, fade_start=0.25):
    a1 = f"if(lt(t,{fade_start}),0,if(lt(t,{fade_start+0.6}),(t-{fade_start})/0.6,1))"
    a2 = f"if(lt(t,{fade_start+0.25}),0,if(lt(t,{fade_start+0.85}),(t-{fade_start+0.25})/0.6,1))"
    fc = (
        f"[1:v]scale=168:-1,format=rgba,fade=t=in:st={fade_start}:d=0.6:alpha=1[logo];"
        f"[0:v][logo]overlay=(W-w)/2:326:format=auto[v1];"
        f"[v1]drawtext=fontfile={FONT_BOLD}:text='{title}':fontcolor={WHITE}:fontsize=104:"
        f"x=(w-text_w)/2:y=520:alpha='{a1}',"
        f"drawtext=fontfile={FONT_REG}:text='{subtitle}':fontcolor={SUBWHITE}:fontsize=38:"
        f"x=(w-text_w)/2:y=648:alpha='{a2}'[outv]"
    )
    cmd = [
        FFMPEG, "-y", "-i", in_path, "-loop", "1", "-t", str(duration), "-i", logo_path,
        "-filter_complex", fc, "-map", "[outv]", "-t", str(duration),
        "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
        out_path,
    ]
    run(cmd)


def outro_card(in_path, out_path, logo_path, title, subtitle, cta, duration, fade_start=0.3):
    a1 = f"if(lt(t,{fade_start}),0,if(lt(t,{fade_start+0.6}),(t-{fade_start})/0.6,1))"
    a2 = f"if(lt(t,{fade_start+0.25}),0,if(lt(t,{fade_start+0.85}),(t-{fade_start+0.25})/0.6,1))"
    a3 = f"if(lt(t,{fade_start+0.55}),0,if(lt(t,{fade_start+1.15}),(t-{fade_start+0.55})/0.6,1))"
    fc = (
        f"[1:v]scale=150:-1,format=rgba,fade=t=in:st={fade_start}:d=0.6:alpha=1[logo];"
        f"[0:v][logo]overlay=(W-w)/2:296:format=auto[v1];"
        f"[v1]drawtext=fontfile={FONT_BOLD}:text='{title}':fontcolor={WHITE}:fontsize=88:"
        f"x=(w-text_w)/2:y=470:alpha='{a1}',"
        f"drawtext=fontfile={FONT_REG}:text='{subtitle}':fontcolor={SUBWHITE}:fontsize=40:"
        f"x=(w-text_w)/2:y=590:alpha='{a2}',"
        f"drawtext=fontfile={FONT_SEMI}:text='{cta}':fontcolor={ACCENT}:fontsize=32:"
        f"x=(w-text_w)/2:y=690:alpha='{a3}'[outv]"
    )
    cmd = [
        FFMPEG, "-y", "-i", in_path, "-loop", "1", "-t", str(duration), "-i", logo_path,
        "-filter_complex", fc, "-map", "[outv]", "-t", str(duration),
        "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
        out_path,
    ]
    run(cmd)


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "all"

    D1, D2, D3, D4A, D4B, D5, D6 = 3.6, 4.6, 4.6, 2.9, 2.9, 4.2, 4.0

    if step in ("all", "kb"):
        render_kenburns("plate_intro.png", "kb_intro.mp4", D1, zoom_target=1.08)
        render_kenburns("plate_search.png", "kb_search.mp4", D2, zoom_target=1.14)
        render_kenburns("plate_results.png", "kb_results.mp4", D3, zoom_target=1.10)
        render_kenburns("plate_before.png", "kb_before.mp4", D4A, zoom_target=1.12)
        render_kenburns("plate_after.png", "kb_after.mp4", D4B, zoom_target=1.12)
        render_kenburns("plate_settings.png", "kb_settings.mp4", D5, zoom_target=1.14)
        render_kenburns("plate_outro.png", "kb_outro.mp4", D6, zoom_target=1.08)

    if step in ("all", "text"):
        title_card("kb_intro.mp4", "scene1.mp4", "logo_mark.png",
                    "ImageScout", "A little window. Endless inspiration.", D1)

        add_text("kb_search.mp4", "scene2.mp4", build_caption_filters(
            "SEARCH ANYWHERE",
            "Google Images, without ever leaving your desktop."))

        add_text("kb_results.mp4", "scene3.mp4", build_caption_filters(
            "RESULTS IN SECONDS",
            "Endless inspiration, one search away."))

        xfade_two("kb_before.mp4", D4A, "kb_after.mp4", D4B, "kb_bgremoval.mp4", t=0.6)
        add_text("kb_bgremoval.mp4", "scene4.mp4", build_caption_filters(
            "ON-DEVICE AI",
            "Remove backgrounds instantly. No upload. No wait."))

        add_text("kb_settings.mp4", "scene5.mp4", build_caption_filters(
            "YOUR VAULT, YOUR RULES",
            "Save, organize, and export -- fully customizable."))

        outro_card("kb_outro.mp4", "scene6.mp4", "logo_mark.png",
                    "ImageScout", "Find it. Grab it. Make it.",
                    "AVAILABLE NOW FOR WINDOWS", D6)

    print("done:", step)
