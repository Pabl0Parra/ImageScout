import re
from PIL import Image, ImageDraw

def parse_path(d):
    tokens = re.findall(r'[MmLlHhVvZz]|-?\d*\.?\d+', d)
    i = 0
    cur = (0.0, 0.0)
    start = (0.0, 0.0)
    cmd = None
    subpaths = []
    poly = []

    def nextf():
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    while i < len(tokens):
        tok = tokens[i]
        if tok in 'MmLlHhVvZz':
            cmd = tok
            i += 1
        # else: repeat previous command (implicit)
        if cmd in ('M', 'm'):
            x = nextf(); y = nextf()
            if cmd == 'm':
                x += cur[0]; y += cur[1]
            cur = (x, y)
            if poly:
                subpaths.append(poly)
            poly = [cur]
            start = cur
            if cmd == 'M':
                cmd = 'L'
            else:
                cmd = 'l'
        elif cmd in ('L', 'l'):
            x = nextf(); y = nextf()
            if cmd == 'l':
                x += cur[0]; y += cur[1]
            cur = (x, y)
            poly.append(cur)
        elif cmd in ('H', 'h'):
            x = nextf()
            if cmd == 'h':
                x += cur[0]
            cur = (x, cur[1])
            poly.append(cur)
        elif cmd in ('V', 'v'):
            y = nextf()
            if cmd == 'v':
                y += cur[1]
            cur = (cur[0], y)
            poly.append(cur)
        elif cmd in ('Z', 'z'):
            cur = start
            poly.append(cur)
        else:
            raise ValueError(f"unhandled token {tok}")
    if poly:
        subpaths.append(poly)
    return subpaths

SVG_PATHS = [
    "M5 13 39 8v12l-6 1v-5l-22 3v19l20-3v-3l8 6-8 8v-5L5 45Z",
    "m25 25 34-5v33l-39 6V47l6-1v5l27-4V28l-19 3-4-3v4l-5 1Z",
]

VIEWBOX = 64
SCALE = 32  # -> 2048x2048 render, downsample later
SIZE = VIEWBOX * SCALE

def render(color=(125, 211, 252, 255), size=SIZE):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for d in SVG_PATHS:
        for poly in parse_path(d):
            pts = [(x * SCALE, y * SCALE) for x, y in poly]
            draw.polygon(pts, fill=color)
    return img

if __name__ == '__main__':
    img = render()
    # downsample for antialiasing
    out = img.resize((768, 768), Image.LANCZOS)
    out.save('logo_mark.png')
    print('saved', out.size)
