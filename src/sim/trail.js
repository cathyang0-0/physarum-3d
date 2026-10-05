// Trail map: a lattice of chemoattractant concentration (Jones's "trail map").
// Stored as a flat Float32Array, index = x + nx * (y + ny * z).
// 2D sanity mode is simply nz = 1.

export class TrailGrid {
  constructor(nx, ny, nz) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.size = nx * ny * nz;
    this.data = new Float32Array(this.size);
    this.tmp = new Float32Array(this.size); // scratch buffer for diffusion
  }

  index(ix, iy, iz) {
    return ix + this.nx * (iy + this.ny * iz);
  }

  // Cell index containing a continuous position, or -1 if outside (non-wrapping boundary).
  cellOf(x, y, z, wrap) {
    let ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const { nx, ny, nz } = this;
    if (wrap) {
      ix = ((ix % nx) + nx) % nx;
      iy = ((iy % ny) + ny) % ny;
      iz = ((iz % nz) + nz) % nz;
    } else if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) {
      return -1;
    }
    return ix + nx * (iy + ny * iz);
  }

  // Sensor read: value of the cell under the sensor (nearest cell, no interpolation, as in
  // Jones's lattice model). Outside a non-wrapping boundary the value is 0.
  sample(x, y, z, wrap) {
    const i = this.cellOf(x, y, z, wrap);
    return i < 0 ? 0 : this.data[i];
  }

  // Diffusion + decay, one tick:
  //   trail = lerp(trail, mean(3x3[x3] neighbourhood), diffuse) * (1 - decay)
  // diffuse = 1 is Jones's full mean filter; diffuse < 1 is a partial blur (tuned, not from
  // source) that keeps structures thinner on a coarse grid.
  // The box mean is separable, so it is done as one 3-tap pass per axis (cheaper than 27 taps).
  // At a non-wrapping edge: 'bounce' takes the mean over in-bounds neighbours only (nothing
  // leaks out); 'absorb' counts outside cells as 0, so attractant drains out through the walls
  // (keeps networks from sticking to the walls).
  // mask (optional): habitable cells. Cells outside it are skipped and kept at 0 in every pass —
  // there is no medium there — which also saves the work for them.
  diffuseDecay(decay, boundary, diffuse = 1, mask = null) {
    if (mask) return this.diffuseDecayMasked(decay, boundary, diffuse, mask);
    const wrap = boundary === 'wrap', leak = boundary === 'absorb';
    if (diffuse < 1) {
      this.orig ??= new Float32Array(this.size);
      this.orig.set(this.data);
    }
    const scale = 1 - decay;
    const axes = [0, 1, 2].filter((a) => [this.nx, this.ny, this.nz][a] > 1);
    let src = this.data, dst = this.tmp;
    axes.forEach((axis, k) => {
      const s = k === axes.length - 1 ? scale : 1; // apply decay once, on the last pass
      boxPass(src, dst, this.nx, this.ny, this.nz, axis, wrap, leak, s, mask);
      [src, dst] = [dst, src];
    });
    // After the passes, `src` holds the result; keep `data` pointing at it.
    this.tmp = this.data === src ? this.tmp : this.data;
    this.data = src;
    if (diffuse < 1) {
      // data currently = mean * scale; blend back towards the un-blurred trail
      const d = this.data, o = this.orig, keep = (1 - diffuse) * scale;
      for (let i = 0; i < d.length; i++) if (!mask || mask[i]) d[i] = diffuse * d[i] + keep * o[i];
    }
  }

  // Same operation, but only over the habitable cells (listed once per mask), so the cost scales
  // with the shape's volume instead of the whole grid. Cells outside the mask are never written
  // and stay 0 in both buffers (deposits and food only ever land inside the mask).
  // At the shape's surface the mean is taken over the neighbours inside the shape only (no flux
  // out of the shape — the same rule as the 'bounce' grid boundary). Letting attractant leak out
  // kept the trail low near the surface and pulled the network away from it.
  diffuseDecayMasked(decay, boundary, diffuse, mask) {
    if (this.listMask !== mask) this.buildMaskList(mask);
    const list = this.maskList, flags = this.maskFlags, n = list.length;
    const wrap = boundary === 'wrap', leak = boundary === 'absorb', scale = 1 - decay;
    const { nx, ny, nz } = this;
    if (diffuse < 1) {
      this.orig ??= new Float32Array(this.size);
      for (let k = 0; k < n; k++) this.orig[list[k]] = this.data[list[k]];
    }
    const axes = [0, 1, 2].filter((a) => [nx, ny, nz][a] > 1);
    let src = this.data, dst = this.tmp;
    axes.forEach((axis, k) => {
      const s = k === axes.length - 1 ? scale : 1;
      const len = [nx, ny, nz][axis], stride = [1, nx, nx * ny][axis];
      const lo = 1 << (2 * axis), hi = 2 << (2 * axis);
      const mlo = 64 << (2 * axis), mhi = 128 << (2 * axis); // neighbour outside the shape
      for (let j = 0; j < n; j++) {
        const i = list[j], f = flags[j];
        if (!(f & (lo | hi | mlo | mhi))) { dst[i] = ((src[i] + src[i - stride] + src[i + stride]) / 3) * s; continue; }
        let sum = src[i], cnt = 1;
        if (f & lo) { if (wrap && mask[i + (len - 1) * stride]) { sum += src[i + (len - 1) * stride]; cnt++; } else if (leak) cnt++; }
        else if (!(f & mlo)) { sum += src[i - stride]; cnt++; }
        if (f & hi) { if (wrap && mask[i - (len - 1) * stride]) { sum += src[i - (len - 1) * stride]; cnt++; } else if (leak) cnt++; }
        else if (!(f & mhi)) { sum += src[i + stride]; cnt++; }
        dst[i] = (sum / cnt) * s;
      }
      [src, dst] = [dst, src];
    });
    this.tmp = this.data === src ? this.tmp : this.data;
    this.data = src;
    if (diffuse < 1) {
      const d = this.data, o = this.orig, keep = (1 - diffuse) * scale;
      for (let k = 0; k < n; k++) { const i = list[k]; d[i] = diffuse * d[i] + keep * o[i]; }
    }
  }

  // Habitable cell indices plus, per cell, 2 bits per axis: on the low / high grid edge.
  buildMaskList(mask) {
    const { nx, ny, nz } = this;
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    this.maskList = new Int32Array(n);
    this.maskFlags = new Uint16Array(n);
    const out = (x, y, z) => !mask[x + nx * (y + ny * z)]; // only called for in-grid neighbours
    let k = 0;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const i = x + nx * (y + ny * z);
          if (!mask[i]) continue;
          this.maskList[k] = i;
          // bits 0–5: on the low / high grid edge of x, y, z; bits 6–11: that neighbour is outside the shape
          this.maskFlags[k] = (x === 0 ? 1 : 0) | (x === nx - 1 ? 2 : 0) | (y === 0 ? 4 : 0) |
            (y === ny - 1 ? 8 : 0) | (z === 0 ? 16 : 0) | (z === nz - 1 ? 32 : 0) |
            (x > 0 && out(x - 1, y, z) ? 64 : 0) | (x < nx - 1 && out(x + 1, y, z) ? 128 : 0) |
            (y > 0 && out(x, y - 1, z) ? 256 : 0) | (y < ny - 1 && out(x, y + 1, z) ? 512 : 0) |
            (z > 0 && out(x, y, z - 1) ? 1024 : 0) | (z < nz - 1 && out(x, y, z + 1) ? 2048 : 0);
          k++;
        }
    this.listMask = mask;
  }

  clear() {
    this.data.fill(0);
  }
}

// One 3-tap mean along `axis` (0 = x, 1 = y, 2 = z), result multiplied by `scale`.
// Loops always run z → y → x with x innermost (contiguous memory) whatever the axis; interior cells
// take a branch-free path, edge cells the general one. The additions are done in the same order
// as the general path, so results are bit-identical either way.
function boxPass(src, dst, nx, ny, nz, axis, wrap, leak, scale, mask) {
  const plane = nx * ny;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const row = nx * (y + ny * z);
      if (axis === 0) {
        for (let x = 0; x < nx; x++) {
          const i = row + x;
          if (mask && !mask[i]) { dst[i] = 0; continue; }
          if (x > 0 && x < nx - 1) dst[i] = ((src[i] + src[i - 1] + src[i + 1]) / 3) * scale;
          else dst[i] = edgeMean(src, i, x, nx, 1, wrap, leak) * scale;
        }
      } else {
        const c = axis === 1 ? y : z, n = axis === 1 ? ny : nz, st = axis === 1 ? nx : plane;
        const interior = c > 0 && c < n - 1;
        for (let x = 0; x < nx; x++) {
          const i = row + x;
          if (mask && !mask[i]) { dst[i] = 0; continue; }
          if (interior) dst[i] = ((src[i] + src[i - st] + src[i + st]) / 3) * scale;
          else dst[i] = edgeMean(src, i, c, n, st, wrap, leak) * scale;
        }
      }
    }
  }
}

// Mean of a cell and its two neighbours along one axis when it sits on an edge of that axis.
function edgeMean(src, i, c, n, stride, wrap, leak) {
  const wrapJump = (n - 1) * stride;
  let sum = src[i];
  let cnt = 1;
  if (c > 0) { sum += src[i - stride]; cnt++; }
  else if (wrap) { sum += src[i + wrapJump]; cnt++; }
  else if (leak) cnt++; // outside counts as 0
  if (c < n - 1) { sum += src[i + stride]; cnt++; }
  else if (wrap) { sum += src[i - wrapJump]; cnt++; }
  else if (leak) cnt++;
  return sum / cnt;
}
