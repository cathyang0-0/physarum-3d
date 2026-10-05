// three.js view of the simulation.
//   2D mode: the trail is a texture on a flat plane.
//   3D mode: the trail is a thresholded point cloud (one point per cell above threshold).
//   Agents are points (optional). Food sources are small spheres.
//   3D mode also shows the translucent food placement plane at z = foodPlaneZ.
// Everything lives in `root`, whose local coordinates are grid cells, so positions from the
// simulation are used directly.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DOMAIN_MARGIN, TORUS_R, TORUS_r, GYROID_T, gyroidValue, shapeContains } from '../sim/domain.js';

const WORLD_SIZE = 10; // longest grid side maps to this many world units

// Minimal palette: white background, trail drawn in black (more attractant = darker).
const BG = 0xffffff;
const INK = 0x000000;
const LINE = 0xcccccc;

export class View {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.makeControls();

    this.root = new THREE.Group();
    this.scene.add(this.root);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Recreate all scene objects for a (re)initialised simulation.
  rebuild(sim) {
    this.root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    this.root.clear();
    const { nx, ny, nz } = sim.trail;
    this.dims = { nx, ny, nz };
    this.is2D = sim.is2D;

    const s = WORLD_SIZE / Math.max(nx, ny, nz);
    this.root.scale.setScalar(s);
    this.root.position.set((-nx / 2) * s, (-ny / 2) * s, (-nz / 2) * s);
    this.root.updateMatrixWorld();

    // Bounding box: only when the shape is the box itself (and, very faint, for the gyroid, which is
    // a labyrinth cut to the box). Other shapes show their own outline instead.
    const domain = (this.domain = sim.params.domain ?? 'box');
    if (this.is2D || domain === 'box' || domain === 'gyroid') {
      const color = !this.is2D && domain === 'gyroid' ? 0xe8e8e8 : LINE;
      this.root.add(new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(nx, ny, nz)), color));
    }
    this.mask = sim.mask;
    if (!this.is2D) this.addDomainOutline(sim.params.domain, nx, ny, nz);

    if (this.is2D) {
      this.texData = new Uint8Array(nx * ny * 4);
      this.tex = new THREE.DataTexture(this.texData, nx, ny, THREE.RGBAFormat);
      this.tex.magFilter = THREE.NearestFilter;
      this.tex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(nx, ny), new THREE.MeshBasicMaterial({ map: this.tex }));
      plane.position.set(nx / 2, ny / 2, 0.5);
      this.root.add(plane);
      this.trailObj = plane;
    } else {
      const size = nx * ny * nz;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(size * 3), 3).setUsage(THREE.DynamicDrawUsage));
      // RGBA per point: black, alpha = trail strength.
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(size * 4), 4).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.PointsMaterial({ size: 1, vertexColors: true, transparent: true, depthWrite: false });
      this.trailObj = new THREE.Points(g, m);
      this.trailObj.frustumCulled = false;
      this.root.add(this.trailObj);

      // Food placement plane at z = foodPlaneZ, drawn as the shape's cross-section at that height.
      // Evaluated from the shape formula at 4× the grid resolution, so its edge is smooth.
      this.planeRes = 4 * Math.max(nx, ny);
      this.planeTexData = new Uint8Array(this.planeRes * this.planeRes * 4);
      this.planeTex = new THREE.DataTexture(this.planeTexData, this.planeRes, this.planeRes, THREE.RGBAFormat);
      this.planeTex.magFilter = THREE.LinearFilter;
      this.planeTex.minFilter = THREE.LinearFilter;
      this.placePlane = new THREE.Mesh(
        new THREE.PlaneGeometry(nx, ny),
        new THREE.MeshBasicMaterial({ map: this.planeTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.planeSliceZ = -1;
      this.root.add(this.placePlane);
    }

    // Agents
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sim.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.agentsObj = new THREE.Points(ag, new THREE.PointsMaterial({ size: 0.6, color: INK, transparent: true, opacity: 0.5, depthWrite: false }));
    this.agentsObj.frustumCulled = false;
    this.root.add(this.agentsObj);

    // Food markers
    this.foodGroup = new THREE.Group();
    this.root.add(this.foodGroup);
    this.foodKey = '';

    // Hover preview: where a click would place food
    const pr = Math.max(1.2, Math.max(nx, ny) / 110);
    this.preview = new THREE.Mesh(
      this.is2D ? new THREE.CircleGeometry(pr, 24) : new THREE.SphereGeometry(1.2, 16, 12),
      new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.preview.visible = false;
    this.root.add(this.preview);
    this.planeFlash = 0; // > 0 right after the plane moved: draw it darker for a moment

    this.resetCamera();
  }

  // Faint outline of the habitable shape (3D). Shapes as in sim/domain.js, z = up.
  addDomainOutline(domain, nx, ny, nz) {
    const h = (nx / 2) * DOMAIN_MARGIN;
    let geo = null, wire = false;
    if (domain === 'sphere') { geo = new THREE.SphereGeometry(h, 18, 10).rotateX(Math.PI / 2); wire = true; }
    if (domain === 'pyramid') geo = new THREE.ConeGeometry(h * Math.SQRT2, 2 * h, 4, 1).rotateY(Math.PI / 4).rotateX(Math.PI / 2);
    if (domain === 'cone') geo = new THREE.ConeGeometry(h, 2 * h, 16, 1).rotateX(Math.PI / 2);
    if (domain === 'torus') { geo = new THREE.TorusGeometry(TORUS_R * h, TORUS_r * h, 10, 36); wire = true; }
    if (domain === 'gyroid') { this.addGyroidStipple(nx, ny, nz); return; }
    if (!geo) return; // box: the box frame is its outline
    const lines = new THREE.LineSegments(
      wire ? new THREE.WireframeGeometry(geo) : new THREE.EdgesGeometry(geo, 1),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: wire ? 0.07 : 0.18, depthWrite: false }),
    );
    geo.dispose();
    lines.position.set(nx / 2, ny / 2, nz / 2);
    this.root.add(lines);
  }

  // The gyroid's channel walls, drawn as a faint stipple of points on the surface |g| = T, so the
  // labyrinth can be seen (a wireframe of it would be unreadable).
  addGyroidStipple(nx, ny, nz) {
    const pts = [], r = Math.random; // display only: no need for the seeded rng
    const h = DOMAIN_MARGIN;
    for (let k = 0; k < 400000 && pts.length < 3 * 26000; k++) {
      const x = (2 * r() - 1), y = (2 * r() - 1), z = (2 * r() - 1);
      if (Math.abs(Math.abs(gyroidValue(x, y, z)) - GYROID_T) > 0.02) continue;
      pts.push(((x * h + 1) / 2) * nx, ((y * h + 1) / 2) * ny, ((z * h + 1) / 2) * nz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.PointsMaterial({ color: 0x000000, size: 0.45 * this.root.scale.x, transparent: true, opacity: 0.22, depthWrite: false });
    this.root.add(new THREE.Points(g, m));
  }

  // OrbitControls reads camera.up once, when it is created, to decide which way is "up" for
  // orbiting. So it is (re)created after camera.up is set — otherwise, with our z-up 3D scene,
  // dragging up/down turns the view sideways. Re-creating also drops leftover drag momentum.
  makeControls() {
    this.controls?.dispose();
    const c = (this.controls = new OrbitControls(this.camera, this.renderer.domElement));
    c.enableDamping = true;
    c.dampingFactor = 0.12;   // settles quickly after a drag, no long drift
    c.rotateSpeed = 0.7;      // calmer than the default 1.0
    c.screenSpacePanning = true;
    c.minDistance = 2;
    c.maxDistance = 80;
  }

  // Mouse mapping. 2D: the sheet stays flat — left-drag pans, no rotation. 3D: left-drag orbits
  // around the box centre (up/down = tilt, left/right = turn around the vertical z axis),
  // right-drag pans. Wheel zooms in both.
  resetCamera() {
    if (this.is2D) {
      this.camera.position.set(0, 0, 18);
      this.camera.up.set(0, 1, 0);
    } else {
      // Shapes that fill less of the box (all but the box and the gyroid) are framed closer.
      const s = ['box', 'gyroid'].includes(this.domain ?? 'box') ? 1 : 0.8;
      this.camera.position.set(15 * s, -18 * s, 12 * s);
      this.camera.up.set(0, 0, 1);
    }
    this.makeControls();
    const c = this.controls;
    c.enableRotate = !this.is2D;
    c.mouseButtons = this.is2D
      ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.target.set(0, 0, 0);
    c.update();
  }

  // Copy simulation state into GPU buffers. Called once per frame.
  update(sim, p) {
    this.updateFoodZone(sim, p);
    const scale = p.displayScale > 0 ? p.displayScale : autoScale(sim.trail.data, this.foodZone);
    const data = sim.trail.data;

    this.trailObj.visible = p.showTrail;
    if (p.showTrail && this.is2D) {
      const td = this.texData;
      const mask = this.mask;
      for (let i = 0; i < data.length; i++) {
        // white → black; outside the habitable shape a light grey
        const g = mask && !mask[i] ? 238 : 255 - ((255 * (1 - Math.exp(-data[i] / scale))) | 0);
        td[4 * i] = g; td[4 * i + 1] = g; td[4 * i + 2] = g; td[4 * i + 3] = 255;
      }
      this.tex.needsUpdate = true;
    } else if (p.showTrail) {
      // 3D: draw a cell when its trail is above trailThreshold × the "tube level" (the median trail
      // at the agents' cells, away from food). That shows the tubes themselves rather than the
      // faint diffusion halo around them, which made the 3D view look foggy and blobby.
      const { nx, ny } = this.dims;
      const level = p.displayScale > 0 ? p.displayScale : tubeLevel(sim, this.foodZone);
      const thr = p.trailThreshold;
      const pos = this.trailObj.geometry.attributes.position, col = this.trailObj.geometry.attributes.color;
      const pa = pos.array, ca = col.array;
      let n = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / level;
        if (v < thr) continue;
        const x = i % nx, y = ((i / nx) | 0) % ny, z = (i / (nx * ny)) | 0;
        pa[3 * n] = x + 0.5; pa[3 * n + 1] = y + 0.5; pa[3 * n + 2] = z + 0.5;
        const f = Math.min(1, (v - thr) / Math.max(1e-6, 1 - thr)); // darker towards the tube core
        ca[4 * n] = 0; ca[4 * n + 1] = 0; ca[4 * n + 2] = 0; ca[4 * n + 3] = 0.08 + 0.5 * f;
        n++;
      }
      this.trailObj.geometry.setDrawRange(0, n);
      pos.needsUpdate = true; col.needsUpdate = true;
      this.trailObj.material.size = p.pointSize * this.root.scale.x;
    }

    this.agentsObj.visible = p.showAgents;
    if (p.showAgents) {
      const a = this.agentsObj.geometry.attributes.position.array;
      for (let i = 0; i < sim.agentCount; i++) {
        a[3 * i] = sim.px[i]; a[3 * i + 1] = sim.py[i]; a[3 * i + 2] = this.is2D ? 0.6 : sim.pz[i];
      }
      this.agentsObj.geometry.attributes.position.needsUpdate = true;
      this.agentsObj.geometry.setDrawRange(0, sim.agentCount); // growth: population changes
      this.agentsObj.material.size = (this.is2D ? 1 : 0.5) * this.root.scale.x * 2;
    }

    if (this.placePlane) {
      this.placePlane.position.set(this.dims.nx / 2, this.dims.ny / 2, p.foodPlaneZ);
      this.planeFlash = Math.max(0, this.planeFlash - 0.03);
      this.placePlane.material.opacity = 0.55 + 0.45 * this.planeFlash;
      this.updatePlaneSlice(p.foodPlaneZ);
    }
    this.updateFood(sim, p);
  }

  // Cells near food (within foodRadius + 3). Excluded from the auto display scale, because food
  // adds far more attractant than the network and would otherwise wash the network out.
  updateFoodZone(sim, p) {
    const key = JSON.stringify([sim.sources.map((s) => [s.x, s.y, s.z]), p.foodRadius, sim.trail.size]);
    if (key === this.foodZoneKey) return;
    this.foodZoneKey = key;
    const { nx, ny, nz, size } = sim.trail;
    const zone = (this.foodZone = new Uint8Array(size));
    const R = p.foodRadius + 3, Rc = Math.ceil(R), wrap = p.boundary === 'wrap';
    for (const s of sim.sources) {
      const cx = Math.floor(s.x), cy = Math.floor(s.y), cz = Math.floor(s.z), zr = nz > 1 ? Rc : 0;
      for (let dz = -zr; dz <= zr; dz++)
        for (let dy = -Rc; dy <= Rc; dy++)
          for (let dx = -Rc; dx <= Rc; dx++) {
            if (dx * dx + dy * dy + dz * dz > R * R) continue;
            const i = sim.trail.cellOf(cx + dx + 0.5, cy + dy + 0.5, cz + dz + 0.5, wrap);
            if (i >= 0) zone[i] = 1;
          }
    }
  }

  updateFood(sim, p) {
    const key = JSON.stringify(sim.sources.map((s) => [s.x, s.y, s.z]));
    if (key === this.foodKey) return;
    this.foodKey = key;
    this.foodGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.foodGroup.clear();
    // Food = a small fixed-size black dot (2D) or sphere (3D), the same in every model, so the
    // pictures are comparable. (Its size does not show foodRadius.)
    const r = Math.max(1.2, Math.max(this.dims.nx, this.dims.ny) / 110);
    const geo = this.is2D ? new THREE.CircleGeometry(r, 24) : new THREE.SphereGeometry(1.2, 16, 12);
    const mat = new THREE.MeshBasicMaterial({ color: INK });
    for (const s of sim.sources) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x, s.y, this.is2D ? 1 : s.z);
      this.foodGroup.add(m);
    }
  }

  // Cross-section of the habitable shape at the plane's height: a light, smooth-edged fill.
  updatePlaneSlice(z) {
    const { nx, ny, nz } = this.dims;
    const zc = Math.min(nz - 1, Math.max(0, Math.floor(z))) + 0.5; // the cell layer food goes into
    if (zc === this.planeSliceZ) return;
    this.planeSliceZ = zc;
    const R = this.planeRes, t = this.planeTexData;
    for (let j = 0; j < R; j++)
      for (let i = 0; i < R; i++) {
        const k = 4 * (i + R * j);
        const inside = shapeContains(this.domain, ((i + 0.5) / R) * nx, ((j + 0.5) / R) * ny, zc, nx, ny, nz);
        t[k] = 0; t[k + 1] = 0; t[k + 2] = 0; t[k + 3] = inside ? 26 : 0;
      }
    this.planeTex.needsUpdate = true;
  }

  // Show (pos in grid coords) or hide (null) the food preview.
  showPreview(pos) {
    this.preview.visible = !!pos;
    if (pos) this.preview.position.set(pos.x, pos.y, this.is2D ? 1 : pos.z);
  }

  flashPlane() {
    this.planeFlash = 1;
  }

  // Mouse → grid coordinates on the placement plane (z = foodPlaneZ; z = 0.5 in 2D).
  pickOnPlane(clientX, clientY, planeZ) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(this.is2D ? 0.5 : planeZ)).applyMatrix4(this.root.matrixWorld);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const local = this.root.worldToLocal(hit);
    const { nx, ny } = this.dims;
    if (local.x < 0 || local.y < 0 || local.x >= nx || local.y >= ny) return null;
    return { x: local.x, y: local.y, z: this.is2D ? 0.5 : planeZ };
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// Typical trail value inside a tube: median trail at (up to 3 000 sampled) agents' cells that are
// not next to food. Display only.
function tubeLevel(sim, zone) {
  const d = sim.trail.data, wrap = sim.params.boundary === 'wrap', vals = [];
  const step = Math.max(1, Math.floor(sim.agentCount / 3000));
  for (let i = 0; i < sim.agentCount; i += step) {
    const c = sim.trail.cellOf(sim.px[i], sim.py[i], sim.pz[i], wrap);
    if (c >= 0 && !(zone && zone[c])) vals.push(d[c]);
  }
  if (!vals.length) return 1;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1] || 1;
}

// Display scale when displayScale = 0 ("auto"): 3 × the mean trail value of the cells away from
// food. Display only — it never feeds back into the model.
function autoScale(data, zone) {
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i++) {
    if (zone && zone[i]) continue;
    sum += data[i];
    n++;
  }
  return 3 * (sum / Math.max(1, n)) || 1;
}
