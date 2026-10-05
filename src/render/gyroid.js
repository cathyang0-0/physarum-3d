// Drawing of the gyroid domain, in the style of a cut solid: a light shaded surface, flat cut
// faces where the solid meets the box, and thin black lines — the outline of the cut faces and
// section curves at quarter divisions in x, y and z (which run across the flat faces and continue
// over the curved surface). Display only; the simulation uses the mask from sim/domain.js.
//
// Coordinates: normalised (u, v, w) ∈ [−1, 1]³ (domain.js), mapped to grid cells by `toGrid`.

import * as THREE from 'three';
import { gyroidValue, gyroidGradient } from '../sim/domain.js';

const SURF_RES = 40;          // marching-tetrahedra cells per side for the curved surface
const LINE_RES = 160;         // samples per side for the section lines
const SECTIONS = [-1, -0.5, 0, 0.5, 1];

export function buildGyroidView(toGrid) {
  const group = new THREE.Group();
  const g = (u, v, w) => gyroidValue(u, v, w); // solid where g > 0

  // ---- curved surface g = 0 (marching tetrahedra), normals from the analytic gradient ----
  const pos = [], nrm = [];
  const P = (i) => -1 + (2 * i) / SURF_RES;
  // cube corners (dx, dy, dz) and the 6 tetrahedra around the 0–6 diagonal
  const C = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const T = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
  // Vertices are collected per triangle; each triangle's winding is flipped if needed so that its
  // front face points out of the solid (towards g < 0, along −∇g). Then only front faces are drawn,
  // which avoids the blotchy look of overlapping back faces.
  let tri = [];
  const vert = (a, b) => {
    const t = a.v / (a.v - b.v);
    const p = [a.p[0] + t * (b.p[0] - a.p[0]), a.p[1] + t * (b.p[1] - a.p[1]), a.p[2] + t * (b.p[2] - a.p[2])];
    const n = gyroidGradient(...p);
    const l = Math.hypot(...n) || 1;
    tri.push({ x: toGrid(...p), n: [-n[0] / l, -n[1] / l, -n[2] / l] });
    if (tri.length < 3) return;
    const [A, B, Cc] = tri;
    const e1 = [B.x[0] - A.x[0], B.x[1] - A.x[1], B.x[2] - A.x[2]];
    const e2 = [Cc.x[0] - A.x[0], Cc.x[1] - A.x[1], Cc.x[2] - A.x[2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const avg = [A.n[0] + B.n[0] + Cc.n[0], A.n[1] + B.n[1] + Cc.n[1], A.n[2] + B.n[2] + Cc.n[2]];
    const order = fn[0] * avg[0] + fn[1] * avg[1] + fn[2] * avg[2] >= 0 ? [A, B, Cc] : [A, Cc, B];
    for (const q of order) { pos.push(...q.x); nrm.push(...q.n); }
    tri = [];
  };
  for (let i = 0; i < SURF_RES; i++)
    for (let j = 0; j < SURF_RES; j++)
      for (let k = 0; k < SURF_RES; k++) {
        const c = C.map(([a, b, d]) => {
          const p = [P(i + a), P(j + b), P(k + d)];
          return { p, v: g(...p) };
        });
        for (const tet of T) {
          const q = tet.map((m) => c[m]);
          const ins = q.filter((x) => x.v > 0), out = q.filter((x) => x.v <= 0);
          if (ins.length === 1 || ins.length === 3) {
            const [lone, rest] = ins.length === 1 ? [ins[0], out] : [out[0], ins];
            for (const r of rest) vert(lone, r);
          } else if (ins.length === 2) {
            const [a, b] = ins, [c1, d] = out;
            vert(a, c1); vert(a, d); vert(b, d);
            vert(a, c1); vert(b, d); vert(b, c1);
          }
        }
      }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  group.add(new THREE.Mesh(sg, new THREE.MeshLambertMaterial({
    color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.FrontSide, depthWrite: false,
  })));

  // ---- flat cut faces on the 6 box faces (where the solid touches the box) ----
  const R = 256;
  for (const axis of [0, 1, 2])
    for (const side of [-1, 1]) {
      const data = new Uint8Array(R * R * 4);
      for (let b = 0; b < R; b++)
        for (let a = 0; a < R; a++) {
          const s = -1 + (2 * (a + 0.5)) / R, t = -1 + (2 * (b + 0.5)) / R;
          const p = axis === 0 ? [side, s, t] : axis === 1 ? [s, side, t] : [s, t, side];
          const k = 4 * (a + R * b);
          data[k] = data[k + 1] = data[k + 2] = 245;
          data[k + 3] = g(...p) > 0 ? 70 : 0;
        }
      const tex = new THREE.DataTexture(data, R, R, THREE.RGBAFormat);
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      // a quad spanning the face, with (s, t) along the two other axes
      const corner = (s, t) => toGrid(...(axis === 0 ? [side, s, t] : axis === 1 ? [s, side, t] : [s, t, side]));
      const qg = new THREE.BufferGeometry();
      qg.setAttribute('position', new THREE.Float32BufferAttribute([...corner(-1, -1), ...corner(1, -1), ...corner(1, 1), ...corner(-1, 1)], 3));
      qg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      qg.setIndex([0, 1, 2, 0, 2, 3]);
      group.add(new THREE.Mesh(qg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })));
    }

  // ---- lines: g = 0 contours on the section planes, and the straight parts of the section
  // lines / box edges that lie on the cut faces ----
  const seg = [];
  const line = (p, q) => seg.push(...toGrid(...p), ...toGrid(...q));
  for (const axis of [0, 1, 2])
    for (const c of SECTIONS) contourOnPlane(g, axis, c, line);
  for (const axis of [0, 1, 2])          // the plane x = c ...
    for (const c of SECTIONS)
      for (const face of [0, 1, 2]) {    // ... meets the box face (face axis = ±1) in a straight line
        if (face === axis) continue;
        for (const side of [-1, 1]) straightInside(g, axis, c, face, side, line);
      }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 })));

  return group;
}

// Marching squares: the curve g = 0 on the plane (axis = c), clipped to the box.
function contourOnPlane(g, axis, c, line) {
  const N = LINE_RES, P = (i) => -1 + (2 * i) / N;
  const at = (s, t) => (axis === 0 ? [c, s, t] : axis === 1 ? [s, c, t] : [s, t, c]);
  const val = [];
  for (let j = 0; j <= N; j++) { val.push([]); for (let i = 0; i <= N; i++) val[j].push(g(...at(P(i), P(j)))); }
  const cross = (i0, j0, i1, j1) => {
    const a = val[j0][i0], b = val[j1][i1], t = a / (a - b);
    return at(P(i0) + t * (P(i1) - P(i0)), P(j0) + t * (P(j1) - P(j0)));
  };
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const e = [];
      if ((val[j][i] > 0) !== (val[j][i + 1] > 0)) e.push(cross(i, j, i + 1, j));
      if ((val[j][i + 1] > 0) !== (val[j + 1][i + 1] > 0)) e.push(cross(i + 1, j, i + 1, j + 1));
      if ((val[j + 1][i] > 0) !== (val[j + 1][i + 1] > 0)) e.push(cross(i, j + 1, i + 1, j + 1));
      if ((val[j][i] > 0) !== (val[j + 1][i] > 0)) e.push(cross(i, j, i, j + 1));
      if (e.length === 2) line(e[0], e[1]);
      else if (e.length === 4) { line(e[0], e[1]); line(e[2], e[3]); }
    }
}

// The straight line where plane (axis = c) meets box face (face = side): drawn where g > 0.
function straightInside(g, axis, c, face, side, line) {
  const free = 3 - axis - face, N = LINE_RES;
  const at = (s) => { const p = [0, 0, 0]; p[axis] = c; p[face] = side; p[free] = s; return p; };
  let start = null;
  for (let i = 0; i <= N; i++) {
    const s = -1 + (2 * i) / N, p = at(s), inside = g(...p) > 0;
    if (inside && !start) start = p;
    if ((!inside || i === N) && start) { line(start, at(inside ? s : s - 2 / N)); start = null; }
  }
}
