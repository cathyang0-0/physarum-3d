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
  //   trail = mean(3x3[x3] neighbourhood) * (1 - decay)
  // The box mean is separable, so it is done as one 3-tap pass per axis (cheaper than 27 taps).
  // At a non-wrapping edge the mean is taken over in-bounds neighbours only, so no
  // chemoattractant leaks out of the domain through the filter.
  diffuseDecay(decay, wrap) {
    const scale = 1 - decay;
    const axes = [0, 1, 2].filter((a) => [this.nx, this.ny, this.nz][a] > 1);
    let src = this.data, dst = this.tmp;
    axes.forEach((axis, k) => {
      const s = k === axes.length - 1 ? scale : 1; // apply decay once, on the last pass
      boxPass(src, dst, this.nx, this.ny, this.nz, axis, wrap, s);
      [src, dst] = [dst, src];
    });
    // After the passes, `src` holds the result; keep `data` pointing at it.
    this.tmp = this.data === src ? this.tmp : this.data;
    this.data = src;
  }

  clear() {
    this.data.fill(0);
  }
}

// One 3-tap mean along `axis` (0 = x, 1 = y, 2 = z), result multiplied by `scale`.
function boxPass(src, dst, nx, ny, nz, axis, wrap, scale) {
  const n = axis === 0 ? nx : axis === 1 ? ny : nz;
  const stride = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
  const wrapJump = (n - 1) * stride;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const row = nx * (y + ny * z);
      for (let x = 0; x < nx; x++) {
        const i = row + x;
        const c = axis === 0 ? x : axis === 1 ? y : z;
        let sum = src[i];
        let cnt = 1;
        if (c > 0) { sum += src[i - stride]; cnt++; }
        else if (wrap) { sum += src[i + wrapJump]; cnt++; }
        if (c < n - 1) { sum += src[i + stride]; cnt++; }
        else if (wrap) { sum += src[i - wrapJump]; cnt++; }
        dst[i] = (sum / cnt) * scale;
      }
    }
  }
}
