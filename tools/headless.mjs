// Run the CPU simulation without a browser and save the trail as a PNG.
// 2D: the trail itself. 3D: a maximum-intensity projection along z.
//
// Usage:
//   node tools/headless.mjs --ticks 2000 --out out/run.png [--preset file.json] [--set '{"sensorAngle":45}'] [--every 500]
//
// Also the building block for the SA × RA parameter study (SPEC §7.6).

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Simulation } from '../src/sim/simulation.js';
import { defaultsFor } from '../src/params.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);

let params = defaultsFor(args.mode ?? '2d');
let food = [];
if (args.preset) {
  const preset = JSON.parse(readFileSync(args.preset, 'utf8'));
  params = { ...params, ...preset.params };
  food = preset.food ?? [];
}
if (args.set) Object.assign(params, JSON.parse(args.set));

const ticks = Number(args.ticks ?? 2000);
const every = Number(args.every ?? ticks);
const out = args.out ?? 'out/run.png';

const sim = new Simulation(params);
food.forEach((s) => sim.addSource(s, s.strength, s.type));
if (food.length && params.spawnAt === 'food') sim.reset();

const t0 = performance.now();
for (let k = 1; k <= ticks; k++) {
  sim.step();
  if (k % every === 0) {
    const path = every === ticks ? out : out.replace(/\.png$/, `_t${String(k).padStart(5, '0')}.png`);
    savePNG(path, sim);
    console.log(`tick ${k}  →  ${path}`);
  }
}
const ms = (performance.now() - t0) / ticks;
console.log(`${sim.agentCount} agents, grid ${sim.trail.nx}×${sim.trail.ny}×${sim.trail.nz}, ${ms.toFixed(2)} ms/tick`);

// ---- image output -------------------------------------------------------------------------------

function savePNG(path, sim) {
  const { nx, ny, nz, data } = sim.trail;
  const img = new Float32Array(nx * ny);
  for (let z = 0; z < nz; z++)
    for (let i = 0; i < nx * ny; i++) img[i] = Math.max(img[i], data[i + z * nx * ny]);
  // Same tone map as the browser view: v = 1 - exp(-t / scale), scale = 3 × mean.
  let mean = 0;
  for (const v of img) mean += v;
  const scale = 3 * (mean / img.length) || 1;
  const gray = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) // flip so +y is up, like the browser view
      gray[(ny - 1 - y) * nx + x] = Math.round(255 * (1 - Math.exp(-img[y * nx + x] / scale)));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(gray, nx, ny));
}

function encodePNG(gray, w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: none
    Buffer.from(gray.buffer, y * w, w).copy(raw, y * (w + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
