# Assemble the frames written by tools/teaser.mjs into an animated GIF (needs Pillow).
# Usage: python3 tools/frames_to_gif.py [out/teaser] [out/teaser.gif] [fps]
import glob
import sys

from PIL import Image, ImageDraw

src = sys.argv[1] if len(sys.argv) > 1 else 'out/teaser'
dst = sys.argv[2] if len(sys.argv) > 2 else 'out/teaser.gif'
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 15

per = int(sys.argv[4]) if len(sys.argv) > 4 else 80            # frames per shape (grow + hold in teaser.mjs)
names = (sys.argv[5] if len(sys.argv) > 5 else 'box,sphere,torus,gyroid').split(',')

files = sorted(glob.glob(f'{src}/frame_*.pgm'))
frames = []
for k, f in enumerate(files):
    im = Image.open(f).convert('L')
    d = ImageDraw.Draw(im)
    shape = names[min(k // per, len(names) - 1)]
    d.text((20, im.height - 32), f'Physarum 3D  ·  Jones-model agents  ·  {shape}', fill=110)
    # 16 grey levels, no dithering: keeps the file small enough for a slide deck
    frames.append(im.quantize(colors=16, dither=Image.Dither.NONE))
# Hold the last frame a little longer before looping.
durations = [int(1000 / fps)] * (len(frames) - 1) + [1500]
frames[0].save(dst, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(f'{len(frames)} frames -> {dst}')
