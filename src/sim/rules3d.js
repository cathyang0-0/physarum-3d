// Agent rules for 3D mode. NOT in Jones — these are the design choices from SPEC.md §3:
//   - heading is a 3D unit vector
//   - one front sensor F plus N sensors on a cone at angle SA around the heading
//   - the 2D decision rule, generalised: "left/right" become "the N cone sensors"
//   - rotating by RA towards a cone sensor = rotating the heading by RA in the plane spanned by
//     the heading and that sensor's direction
// With N = 2 cone sensors lying in one plane, this reduces exactly to the 2D rule.

import { wrapCoord } from './rules2d.js';

const DEG = Math.PI / 180;
const MAX_SENSORS = 16;

// Scratch arrays reused for every agent (avoid allocating in the inner loop).
const C = new Float32Array(MAX_SENSORS);        // cone sensor values
const E = new Float32Array(MAX_SENSORS * 3);    // lateral unit vectors of each cone sensor

export function stepAgents3D(sim) {
  const p = sim.params;
  const ctx = {
    sim,
    trail: sim.trail,
    rand: sim.rand,
    wrap: p.boundary === 'wrap',
    cosSA: Math.cos(p.sensorAngle * DEG),
    sinSA: Math.sin(p.sensorAngle * DEG),
    cosRA: Math.cos(p.rotationAngle * DEG),
    sinRA: Math.sin(p.rotationAngle * DEG),
    SO: p.sensorOffset,
    step: p.stepSize,
    sample: sim.makeSampler(),
    foodWeightOf: sim.makeFoodWeight(),
    depositOf: sim.makeDepositor(),
    N: Math.min(MAX_SENSORS, Math.max(2, p.sensorCount | 0)),
    randomBranch: p.bothSidesBetter === 'random',
    weighted: p.steering === 'weighted',
    randomTurnProb: p.randomTurnProb,
  };
  const n = sim.agentCount;

  if (sim.collision) {
    const order = sim.shuffledOrder();
    for (let k = 0; k < n; k++) {
      const i = order[k];
      senseRotate(ctx, i);
      move(ctx, i);
    }
  } else {
    for (let i = 0; i < n; i++) senseRotate(ctx, i);
    for (let i = 0; i < n; i++) move(ctx, i);
  }
}

function senseRotate(ctx, i) {
  const { sim, sample, rand, cosSA, sinSA, SO, N } = ctx;
  const x = sim.px[i], y = sim.py[i], z = sim.pz[i];
  const hx = sim.hx[i], hy = sim.hy[i], hz = sim.hz[i];

  // Orthonormal frame (u, v) perpendicular to the heading h. The helper axis is any world axis
  // not nearly parallel to h. Each agent has a fixed random "roll" phase so the cone sensors of
  // different agents are not all aligned with the world axes (keeps the population isotropic).
  let ax = 1, ay = 0, az = 0;
  if (Math.abs(hx) > 0.9) { ax = 0; ay = 1; }
  // u = normalize(h × a)
  let ux = hy * az - hz * ay, uy = hz * ax - hx * az, uz = hx * ay - hy * ax;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  // v = h × u
  const vx = hy * uz - hz * uy, vy = hz * ux - hx * uz, vz = hx * uy - hy * ux;

  const fw = ctx.foodWeightOf(i); // growth model only; ignored by the Jones sampler
  const F = sample(x + SO * hx, y + SO * hy, z + SO * hz, fw);

  let maxC = -Infinity, minC = Infinity, argmax = -1, nMax = 0;
  const phase = sim.phase[i];
  for (let k = 0; k < N; k++) {
    const phi = phase + (2 * Math.PI * k) / N;
    const c = Math.cos(phi), s = Math.sin(phi);
    const ex = c * ux + s * vx, ey = c * uy + s * vy, ez = c * uz + s * vz; // lateral unit
    E[3 * k] = ex; E[3 * k + 1] = ey; E[3 * k + 2] = ez;
    // sensor direction d = cos(SA) h + sin(SA) e
    const val = sample(
      x + SO * (cosSA * hx + sinSA * ex),
      y + SO * (cosSA * hy + sinSA * ey),
      z + SO * (cosSA * hz + sinSA * ez),
      fw,
    );
    C[k] = val;
    if (val > maxC) { maxC = val; argmax = k; nMax = 1; }
    else if (val === maxC) { nMax++; if (rand() * nMax < 1) argmax = k; } // random tie-break
    if (val < minC) minC = val;
  }

  let k = -1;        // index of the cone sensor to turn towards, or
  let lateral = null; // an explicit lateral direction (weighted steering)

  if (ctx.randomTurnProb > 0 && rand() < ctx.randomTurnProb) {
    k = Math.floor(rand() * N); // optional noise term, not in Jones (default 0)
  } else if (F > maxC) {
    return; // front is best: keep heading
  } else if (F < minC) {
    // Every cone sensor beats the front (2D: "F < FL and F < FR").
    if (ctx.randomBranch) k = Math.floor(rand() * N);
    else if (ctx.weighted) lateral = weightedLateral(N);
    else k = argmax; // "towards the larger" — ties already broken randomly
  } else if (nMax === 1 || ctx.weighted) {
    // Front is neither best nor worst (2D: "FL < FR → right", "FR < FL → left").
    if (ctx.weighted) lateral = weightedLateral(N);
    else k = argmax;
  } else {
    return; // tie for the maximum with front not worst (2D: F == FL == FR): keep heading
  }

  let ex, ey, ez;
  if (lateral) {
    if (!lateral.ok) return;
    ({ ex, ey, ez } = lateral);
  } else {
    ex = E[3 * k]; ey = E[3 * k + 1]; ez = E[3 * k + 2];
  }

  // Rotate h by RA towards e (e ⟂ h): h' = cos(RA) h + sin(RA) e, then renormalise.
  let nx = ctx.cosRA * hx + ctx.sinRA * ex;
  let ny = ctx.cosRA * hy + ctx.sinRA * ey;
  let nz = ctx.cosRA * hz + ctx.sinRA * ez;
  const l = Math.hypot(nx, ny, nz);
  sim.hx[i] = nx / l; sim.hy[i] = ny / l; sim.hz[i] = nz / l;
}

// Weighted steering (SPEC §3 "smoother option", not in Jones): steer towards the
// concentration-weighted sum of the cone sensors' lateral directions instead of the argmax.
// The result is perpendicular to h because every e_k is.
const _lat = { ok: false, ex: 0, ey: 0, ez: 0 };
function weightedLateral(N) {
  let sx = 0, sy = 0, sz = 0;
  for (let k = 0; k < N; k++) {
    sx += C[k] * E[3 * k]; sy += C[k] * E[3 * k + 1]; sz += C[k] * E[3 * k + 2];
  }
  const l = Math.hypot(sx, sy, sz);
  _lat.ok = l > 1e-9;
  if (_lat.ok) { _lat.ex = sx / l; _lat.ey = sy / l; _lat.ez = sz / l; }
  return _lat;
}

function move(ctx, i) {
  const { sim, trail, wrap, step } = ctx;
  let x = sim.px[i] + step * sim.hx[i];
  let y = sim.py[i] + step * sim.hy[i];
  let z = sim.pz[i] + step * sim.hz[i];
  if (wrap) {
    x = wrapCoord(x, trail.nx);
    y = wrapCoord(y, trail.ny);
    z = wrapCoord(z, trail.nz);
  }
  const target = trail.cellOf(x, y, z, wrap);
  const current = trail.cellOf(sim.px[i], sim.py[i], sim.pz[i], wrap);

  const blocked = target < 0 || (sim.occupancy && target !== current && sim.occupancy[target]);
  if (blocked) {
    sim.randomizeHeading3D(i);
    return;
  }
  if (sim.occupancy && target !== current) {
    sim.occupancy[current] = 0;
    sim.occupancy[target] = 1;
  }
  sim.px[i] = x; sim.py[i] = y; sim.pz[i] = z;
  trail.data[target] += ctx.depositOf(i);
}
