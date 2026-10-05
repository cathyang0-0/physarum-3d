# Assemble the frames written by tools/teaser.mjs into an animated GIF (needs Pillow).
# Usage: python3 tools/frames_to_gif.py [out/teaser] [out/teaser.gif] [fps]
import glob
import sys

from PIL import Image, ImageDraw

src = sys.argv[1] if len(sys.argv) > 1 else 'out/teaser'
dst = sys.argv[2] if len(sys.argv) > 2 else 'out/teaser.gif'
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 15

files = sorted(glob.glob(f'{src}/frame_*.pgm'))
frames = []
for f in files:
    im = Image.open(f).convert('L')
    d = ImageDraw.Draw(im)
    d.text((16, im.height - 26), 'Physarum 3D  ·  Jones-model agents in 3D', fill=110)
    # 32 grey levels, no dithering: keeps the file small enough for a slide deck
    frames.append(im.quantize(colors=32, dither=Image.Dither.NONE))
# Hold the last frame a little longer before looping.
durations = [int(1000 / fps)] * (len(frames) - 1) + [1500]
frames[0].save(dst, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(f'{len(frames)} frames -> {dst}')
