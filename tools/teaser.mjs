// Render a teaser animation of the main 3D setup without a browser: in each shape, the network
// forms from a random start while the camera circles the box. Writes grayscale PGM frames to
// out/teaser/; tools/frames_to_gif.py turns them into a GIF.
//
// Each shape: a sped-up "grow" phase (slow at first, then faster) until the network is mature,
// then a "hold" phase at normal speed while the camera turns half a circle.
//
// Usage: node tools/teaser.mjs [--domains box,sphere,torus,gyroid] [--size 800] [--food 10]
//          [--seed 1] [--grow 30] [--hold 50] [--mature 3500] [--holdTicks 4]
//   --grow / --hold: frames per phase; --mature: ticks reached at the end of the grow phase;
//   --holdTicks: ticks per frame in the hold phase
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
const W = Number(args.size ?? 800), H = W;
const GROW = Number(args.grow ?? 30), HOLD = Number(args.hold ?? 50), PER = GROW + HOLD;
const MATURE = Number(args.mature ?? 3500), HOLD_TICKS = Number(args.holdTicks ?? 4);
const DOMAINS = (args.domains ?? 'box,sphere,torus,gyroid').split(',');
const FRAMES = PER * DOMAINS.length;
const OUT = 'out/teaser';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Simulation time at grow frame f: quadratic ease-in, so the first moments of formation are slow.
const tickAtGrowFrame = (f) => Math.round(MATURE * ((f + 1) / GROW) ** 2);
// Camera azimuth advance per frame: slow while growing, a half turn during the hold.
const turnFor = (f) => (f < GROW ? (Math.PI / 3) / GROW : Math.PI / HOLD);

const img = new Float32Array(W * H); // 1 = white, 0 = black
let sim, nx, ny, nz, domain, frame = 0, azimuth = -0.9;
for (domain of DOMAINS) {
  const p = { ...defaultsFor('3d'), ...EXAMPLES[MAIN['3d']].over, seed: Number(args.seed ?? 1), domain };
  if (domain !== 'box') { // same finer grid the app uses for shapes (main.js applyShapeResolution)
    p.gridX = p.gridY = p.gridZ = Math.round(p.gridX * 1.5);
    p.agentCount = Math.round(p.agentCount * 1.5 ** 3);
    p.foodRadius *= 1.5;
    p.wallRepel = true;
  }
  sim = new Simulation(p);
  sim.scatterSources(Number(args.food ?? 10));
  ({ nx, ny, nz } = sim.trail);
  for (let f = 0; f < PER; f++, frame++) {
    const target = f < GROW ? tickAtGrowFrame(f) : MATURE + (f - GROW + 1) * HOLD_TICKS;
    while (sim.tick < target) sim.step();
    azimuth += turnFor(f);
    render();
    const bytes = Buffer.alloc(W * H);
    for (let i = 0; i < W * H; i++) bytes[i] = Math.round(255 * Math.max(0, Math.min(1, img[i])));
    writeFileSync(`${OUT}/frame_${String(frame).padStart(4, '0')}.pgm`,
      Buffer.concat([Buffer.from(`P5\n${W} ${H}\n255\n`), bytes]));
  }
  console.log(`${domain}: ${PER} frames, ${sim.agentCount} agents, tick ${sim.tick}`);
}
console.log(`wrote ${FRAMES} frames to ${OUT}/`);

// ---- tiny point renderer --------------------------------------------------------------------

function render() {
  img.fill(1);
  const az = azimuth, el = 0.42; // camera azimuth / elevation (radians)
  // camera distance and focal length (pixels); the box needs more room than the other shapes
  const dist = (domain === 'box' ? 3.8 : 3.1) * nx, focal = 1.75 * W;
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
