// Population adaptation — OUR DESIGN, NOT FROM JONES (possibly similar in spirit to later Jones
// papers; not verified).
//
// Problem it solves: with a fixed population, a network that contracts onto short paths must get
// thicker (the agents have to go somewhere). Here the population follows the network instead:
//
//   every `adaptInterval` ticks, for each agent, density = agents in a (2r+1)^d window / window size
//     density > adaptHigh  → removed with probability adaptRemoveProb   (crowded: thins blobs)
//     adaptDivideMin < density < adaptLow
//                          → divides with probability adaptDivideProb   (sparse: repairs thin,
//                                                                         stretched tubes; the
//                                                                         lower bound stops lone
//                                                                         wanderers multiplying)
//   population stays within [adaptMinAgents, capacity]
//
// Densities are computed from a snapshot before any agent is added or removed, so the result does
// not depend on processing order.

export function adaptPopulation(sim) {
  const p = sim.params;
  if (!p.adapt || sim.tick % Math.max(1, p.adaptInterval | 0) !== 0) return;

  const t = sim.trail, wrap = p.boundary === 'wrap';
  const r = Math.max(1, p.adaptRadius | 0);
  const count = (sim.countGrid ??= new Float32Array(t.size));
  const tmp = (sim.countTmp ??= new Float32Array(t.size));

  // 1. agents per cell
  count.fill(0);
  const n0 = sim.agentCount;
  const cells = (sim.agentCells ??= new Int32Array(sim.capacity));
  for (let i = 0; i < n0; i++) {
    const c = t.cellOf(sim.px[i], sim.py[i], sim.pz[i], wrap);
    cells[i] = c;
    if (c >= 0) count[c]++;
  }

  // 2. window sums (separable box sum, one sliding pass per axis)
  let src = count, dst = tmp;
  for (const axis of [0, 1, 2]) {
    if ([t.nx, t.ny, t.nz][axis] === 1) continue;
    boxSum(src, dst, t.nx, t.ny, t.nz, axis, r, wrap);
    [src, dst] = [dst, src];
  }
  const windowSum = src;
  // Window volume = in-bounds cells only. (Dividing by the full (2r+1)^d made agents near walls —
  // up to 8× in a 3D corner — look sparse, so they kept dividing and grew tubes into the corners.)
  const span = (c, n) => (wrap ? 2 * r + 1 : Math.min(c + r, n - 1) - Math.max(c - r, 0) + 1);
  const volumeAt = (cell) => {
    const x = cell % t.nx, y = ((cell / t.nx) | 0) % t.ny, z = (cell / (t.nx * t.ny)) | 0;
    return span(x, t.nx) * span(y, t.ny) * (t.nz > 1 ? span(z, t.nz) : 1);
  };

  // 3. decide from the snapshot: who is removed, who divides
  const rand = sim.rand;
  const remove = [], divide = [];
  for (let i = 0; i < n0; i++) {
    const d = cells[i] < 0 ? 0 : windowSum[cells[i]] / volumeAt(cells[i]);
    if (d > p.adaptHigh) { if (rand() < p.adaptRemoveProb) remove.push(i); }
    else if (d < p.adaptLow && d > p.adaptDivideMin) { if (rand() < p.adaptDivideProb) divide.push(i); }
  }

  // 4. apply. Division first (parents are still at their indices), then removal from the back so
  //    swap-removal never moves an agent that is still waiting to be removed.
  for (const i of divide) {
    if (sim.agentCount >= sim.capacity) break;
    if (sim.placeChild(i, sim.agentCount)) sim.agentCount++;
  }
  const minAgents = Math.max(1, p.adaptMinAgents | 0);
  for (let k = remove.length - 1; k >= 0 && sim.agentCount > minAgents; k--) sim.removeAgent(remove[k]);
}

// dst[i] = sum of src over cells within distance r along `axis` (clipped at edges unless wrap).
function boxSum(src, dst, nx, ny, nz, axis, r, wrap) {
  const n = axis === 0 ? nx : axis === 1 ? ny : nz;
  const stride = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
  // iterate over every line along `axis`
  const [na, nb, sa, sb] =
    axis === 0 ? [ny, nz, nx, nx * ny] : axis === 1 ? [nx, nz, 1, nx * ny] : [nx, ny, 1, nx];
  const at = (base, c) => {
    if (wrap) c = ((c % n) + n) % n;
    else if (c < 0 || c >= n) return 0;
    return src[base + c * stride];
  };
  for (let b = 0; b < nb; b++) {
    for (let a = 0; a < na; a++) {
      const base = a * sa + b * sb;
      let s = 0;
      for (let c = -r; c <= r; c++) s += at(base, c);
      for (let c = 0; c < n; c++) {
        dst[base + c * stride] = s;
        s += at(base, c + r + 1) - at(base, c - r);
      }
    }
  }
}
