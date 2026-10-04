// Agent rules for 2D sanity mode (nz = 1). This is the closest-to-source part of the code:
// three sensors F / FL / FR, rotate by RA, move one step, deposit on success.
// Headings are angles in radians; "left" = counter-clockwise (+angle) with y pointing up.
//
// Sources: Jones & Adamatzky 2012 (arXiv:1212.0023) Fig. 1b pseudocode; see SPEC.md §1.


const DEG = Math.PI / 180;

export function stepAgents2D(sim) {
  const p = sim.params;
  const ctx = {
    sim,
    trail: sim.trail,
    rand: sim.rand,
    wrap: p.boundary === 'wrap',
    SA: p.sensorAngle * DEG,
    RA: p.rotationAngle * DEG,
    SO: p.sensorOffset,
    step: p.stepSize,
    sample: sim.makeSampler(),
    foodWeightOf: sim.makeFoodWeight(),
    depositOf: sim.makeDepositor(),
    randomBranch: p.bothSidesBetter === 'random',
    randomTurnProb: p.randomTurnProb,
  };
  const n = sim.agentCount;

  if (p.collision) {
    // Jones-faithful: agents are processed one at a time in a fresh random order each tick
    // ("iteration of the particle population is performed randomly"), so each agent sees the
    // occupancy and trail left by the agents processed before it.
    const order = sim.shuffledOrder();
    for (let k = 0; k < n; k++) {
      const i = order[k];
      senseRotate(ctx, i);
      move(ctx, i);
    }
  } else {
    // Jenson-style, parallel-friendly: every agent senses the same trail snapshot, then all move
    // and deposit. Order no longer matters, which is what a GPU version will do.
    for (let i = 0; i < n; i++) senseRotate(ctx, i);
    for (let i = 0; i < n; i++) move(ctx, i);
  }
}

// Sensory stage: sample F, FL, FR at distance SO and angles 0, +SA, -SA; rotate by RA.
function senseRotate(ctx, i) {
  const { sim, sample, rand, SA, RA, SO } = ctx;
  const x = sim.px[i], y = sim.py[i], z = sim.pz[i];
  const a = sim.heading[i];
  const fw = ctx.foodWeightOf(i); // growth model only; ignored by the Jones sampler

  const F = sample(x + SO * Math.cos(a), y + SO * Math.sin(a), z, fw);
  const FL = sample(x + SO * Math.cos(a + SA), y + SO * Math.sin(a + SA), z, fw);
  const FR = sample(x + SO * Math.cos(a - SA), y + SO * Math.sin(a - SA), z, fw);

  const randomSide = () => (rand() < 0.5 ? RA : -RA);
  let turn = 0;

  if (ctx.randomTurnProb > 0 && rand() < ctx.randomTurnProb) {
    turn = randomSide(); // optional noise term, not in Jones (default 0)
  } else if (F > FL && F > FR) {
    turn = 0; // front is best: keep heading
  } else if (F < FL && F < FR) {
    // Both sides better than front.
    if (ctx.randomBranch) turn = randomSide(); // common implementations
    else if (FL > FR) turn = RA; // paper: "rotate by RA towards larger of FL and FR"
    else if (FR > FL) turn = -RA;
    else turn = randomSide(); // FL == FR: "towards larger" is undefined; break the tie randomly
  } else if (FL < FR) {
    turn = -RA; // rotate right
  } else if (FR < FL) {
    turn = RA; // rotate left
  }
  // else: keep heading

  sim.heading[i] = a + turn;
}

// Motor stage: try to move one step forward. Deposit only on a successful move.
function move(ctx, i) {
  const { sim, trail, rand, wrap, step } = ctx;
  const a = sim.heading[i];
  let x = sim.px[i] + step * Math.cos(a);
  let y = sim.py[i] + step * Math.sin(a);
  const z = sim.pz[i];

  if (wrap) {
    x = wrapCoord(x, trail.nx);
    y = wrapCoord(y, trail.ny);
  }
  const target = trail.cellOf(x, y, z, wrap);
  const current = trail.cellOf(sim.px[i], sim.py[i], z, wrap);

  // Failed move: outside a non-wrapping boundary, or (collision on) target cell occupied
  // by another agent. Jones: the agent stays put and picks a new random heading.
  const blocked = target < 0 || (sim.occupancy && target !== current && sim.occupancy[target]);
  if (blocked) {
    sim.heading[i] = rand() * 2 * Math.PI;
    return;
  }

  if (sim.occupancy && target !== current) {
    sim.occupancy[current] = 0;
    sim.occupancy[target] = 1;
  }
  sim.px[i] = x;
  sim.py[i] = y;
  trail.data[target] += ctx.depositOf(i);
}

export function wrapCoord(v, n) {
  v = ((v % n) + n) % n;
  return v >= n ? 0 : v; // guard against float rounding giving exactly n
}
