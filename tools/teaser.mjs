// Render a teaser animation of the main 3D setup without a browser: the network forms from a
// random start while the camera circles the box. Writes grayscale PGM frames to out/teaser/;
// tools/frames_to_gif.py turns them into a GIF.
//
// Usage: node tools/teaser.mjs [--frames 150] [--size 640] [--food 10] [--seed 1]
//
// Drawing matches the browser view: cells whose trail is above 0.3 × the in-tube trail level are
// drawn as small dark points; food as black dots; the box as thin grey edges.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { Simulation } from '../src/sim/simulation.js';
import { defaultsFor } from '../src/params.js';
import { EXAMPLES, MAIN } from '../src/examples.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const FRAMES = Number(args.frames ?? 150), W = Number(args.size ?? 540), H = W;
const OUT = 'out/teaser';

const ex = EXAMPLES[MAIN['3d']];
const p = { ...defaultsFor('3d'), ...ex.over, seed: Number(args.seed ?? 1) };
const sim = new Simulation(p);
sim.scatterSources(Number(args.food ?? 10));
const { nx, ny, nz } = sim.trail;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Ticks per frame: slow at the start so the network can be seen forming, faster later.
const ticksFor = (f) => (f < 50 ? 6 : f < 100 ? 15 : 30);

const img = new Float32Array(W * H); // 1 = white, 0 = black
for (let f = 0; f < FRAMES; f++) {
  for (let k = 0; k < ticksFor(f); k++) sim.step();
  render(f / FRAMES);
  const bytes = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) bytes[i] = Math.round(255 * Math.max(0, Math.min(1, img[i])));
  writeFileSync(`${OUT}/frame_${String(f).padStart(4, '0')}.pgm`,
    Buffer.concat([Buffer.from(`P5\n${W} ${H}\n255\n`), bytes]));
  if (f % 25 === 0) console.log(`frame ${f}/${FRAMES}  tick ${sim.tick}`);
}
console.log(`wrote ${FRAMES} frames to ${OUT}/ (final tick ${sim.tick})`);

// ---- tiny point renderer --------------------------------------------------------------------

function render(phase) {
  img.fill(1);
  const az = -0.9 + phase * 2 * Math.PI, el = 0.42; // camera azimuth / elevation (radians)
  const dist = 3.2 * nx, focal = 1.75 * W;           // camera distance and focal length (pixels)
  const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
  // world (centred on the box) → camera: rotate about z by az, then tilt by el
  const project = (x, y, z) => {
    x -= nx / 2; y -= ny / 2; z -= nz / 2;
    const xr = ca * x + sa * y, yr = -sa * x + ca * y;
    const depth = dist + ce * yr + se * z; // distance along the view axis
    const up = -se * yr + ce * z;
    return [W / 2 + (focal * xr) / depth, H / 2 - (focal * up) / depth, depth];
  };

  // box edges
  const c = [0, nx].flatMap((x) => [0, ny].flatMap((y) => [0, nz].map((z) => [x, y, z])));
  for (let i = 0; i < 8; i++)
    for (let j = i + 1; j < 8; j++) {
      const d = c[i].reduce((s, v, k) => s + (v !== c[j][k]), 0);
      if (d === 1) line(project(...c[i]), project(...c[j]), 0.12);
    }

  // trail, relative to the in-tube level (median trail at the agents' cells)
  const data = sim.trail.data, vals = [];
  for (let i = 0; i < sim.agentCount; i += 2) vals.push(data[sim.trail.cellOf(sim.px[i], sim.py[i], sim.pz[i], true)]);
  vals.sort((a, b) => a - b);
  const level = vals[vals.length >> 1] || 1, thr = 0.3;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / level;
    if (v < thr) continue;
    const x = i % nx, y = ((i / nx) | 0) % ny, z = (i / (nx * ny)) | 0;
    const [sx, sy, depth] = project(x + 0.5, y + 0.5, z + 0.5);
    const a = 0.05 + 0.3 * Math.min(1, (v - thr) / (1 - thr));
    dot(sx, sy, (0.4 * focal) / depth, a);
  }

  for (const s of sim.sources) {
    const [sx, sy, depth] = project(s.x, s.y, s.z);
    dot(sx, sy, (1.3 * focal) / depth, 1);
  }
}

// Darken a disc: multiplying by (1 − a) is order-independent, so no depth sorting is needed.
function dot(cx, cy, r, a) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.max(0, Math.min(1, r + 0.5 - d)); // anti-aliased edge
      if (cov > 0) img[x + W * y] *= 1 - a * cov;
    }
}

function line([x0, y0], [x1, y1], a) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
    if (x >= 0 && y >= 0 && x < W && y < H) img[x + W * y] *= 1 - a;
  }
}
