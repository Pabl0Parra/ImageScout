import math
from PIL import Image, ImageDraw, ImageFilter, ImageOps

W, H = 1920, 1080
PREV = r"C:\Users\p.parra\Code\ImageScout\docs\previews"

BG_TOP = (10, 14, 22)
BG_BOT = (6, 9, 15)
ACCENT = (125, 211, 252)


def gradient_bg(w=W, h=H, top=BG_TOP, bot=BG_BOT, glow=True, glow_pos=(0.5, 0.42), glow_strength=70):
    # low-res vertical gradient upsampled with smooth interpolation to avoid banding
    small_h = 64
    grad = Image.new("RGB", (1, small_h))
    for y in range(small_h):
        t = y / (small_h - 1)
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        grad.putpixel((0, y), (r, g, b))
    img = grad.resize((w, h), Image.BICUBIC)

    def radial_mask(gw, gh, cx_frac, cy_frac, radius_frac, gamma):
        mask = Image.new("L", (gw, gh), 0)
        cx, cy = gw * cx_frac, gh * cy_frac
        maxr = radius_frac * math.hypot(gw, gh)
        for y in range(gh):
            for x in range(gw):
                d = math.hypot(x - cx, y - cy) / maxr
                v = max(0.0, 1.0 - d)
                mask.putpixel((x, y), int(255 * (v ** gamma)))
        return mask

    if glow:
        gw, gh = 192, 108
        glow_mask = radial_mask(gw, gh, glow_pos[0], glow_pos[1], 0.85, 1.6)
        glow_mask = glow_mask.resize((w, h), Image.BICUBIC)
        accent_layer = Image.new("RGB", (w, h), ACCENT)
        strength_mask = glow_mask.point(lambda v: int(v * glow_strength / 255))
        img = Image.composite(accent_layer, img, strength_mask)

    # soft vignette: bright center, darker edges, no hard rings
    vw, vh = 192, 108
    vign_small = radial_mask(vw, vh, 0.5, 0.48, 0.95, 1.0)
    vign = vign_small.resize((w, h), Image.BICUBIC)
    dark = Image.new("RGB", (w, h), (2, 3, 6))
    img = Image.composite(img, dark, vign.point(lambda v: int(80 + v * 175 / 255)))
    return img


def soft_shadow_paste(base, fg, pos, blur=40, opacity=170, offset=(0, 22)):
    if fg.mode != "RGBA":
        fg = fg.convert("RGBA")
    alpha = fg.split()[-1]
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    shadow_shape = Image.new("L", fg.size, 0)
    shadow_shape.paste(alpha, (0, 0))
    sh_layer = Image.new("RGBA", fg.size, (0, 0, 0, opacity))
    sh_layer.putalpha(shadow_shape)
    shadow.paste(sh_layer, (pos[0] + offset[0], pos[1] + offset[1]), sh_layer)
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    base_rgba = base.convert("RGBA")
    base_rgba = Image.alpha_composite(base_rgba, shadow)
    base_rgba.paste(fg, pos, fg)
    return base_rgba.convert("RGB")


def fit(img, max_w, max_h):
    w, h = img.size
    scale = min(max_w / w, max_h / h)
    nw, nh = int(w * scale), int(h * scale)
    return img.resize((nw, nh), Image.LANCZOS)


def scene_full_bleed(name, out, oversize=1.16):
    src = Image.open(f"{PREV}/{name}").convert("RGB")
    ow, oh = int(W * oversize), int(H * oversize)
    src = ImageOps.fit(src, (ow, oh), Image.LANCZOS, centering=(0.5, 0.42))
    src.save(out)
    print("saved", out, src.size)


def scene_floating(name, out, target_h_frac=0.80, oversize=1.10):
    bg = gradient_bg()
    fg = Image.open(f"{PREV}/{name}").convert("RGBA")
    fg = fit(fg, int(W * 0.86), int(H * target_h_frac))
    pos = ((W - fg.width) // 2, (H - fg.height) // 2 - 10)
    comp = soft_shadow_paste(bg, fg, pos)
    ow, oh = int(W * oversize), int(H * oversize)
    comp = comp.resize((ow, oh), Image.LANCZOS)
    comp.save(out)
    print("saved", out, comp.size)


def scene_card(out, oversize=1.06):
    bg = gradient_bg(glow_strength=95)
    ow, oh = int(W * oversize), int(H * oversize)
    bg = bg.resize((ow, oh), Image.LANCZOS)
    bg.save(out)
    print("saved", out, bg.size)


if __name__ == "__main__":
    scene_card("plate_intro.png")
    scene_full_bleed("dark-home.png", "plate_search.png")
    scene_floating("ImageScout_searched_items.png", "plate_results.png")
    scene_floating("ImageScout_before_bg_removal.png", "plate_before.png")
    scene_floating("ImageScout_bg_removed.png", "plate_after.png")
    scene_full_bleed("dark-settings.png", "plate_settings.png")
    scene_card("plate_outro.png")
