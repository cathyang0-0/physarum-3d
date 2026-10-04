// three.js view of the simulation.
//   2D mode: the trail is a texture on a flat plane.
//   3D mode: the trail is a thresholded point cloud (one point per cell above threshold).
//   Agents are points (optional). Food sources are small spheres.
//   3D mode also shows the translucent food placement plane at z = foodPlaneZ.
// Everything lives in `root`, whose local coordinates are grid cells, so positions from the
// simulation are used directly.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;   // settles quickly after a drag, no long drift
    this.controls.rotateSpeed = 0.7;      // calmer than the default 1.0
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 80;

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

    // Bounding box
    const box = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(nx, ny, nz)), LINE);
    this.root.add(box);

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

      // Food placement plane (translucent slice at z = foodPlaneZ)
      this.placePlane = new THREE.Mesh(
        new THREE.PlaneGeometry(nx, ny),
        new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.03, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.placePlane.add(new THREE.LineSegments(new THREE.EdgesGeometry(this.placePlane.geometry), new THREE.LineBasicMaterial({ color: LINE })));
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

  // Mouse mapping. 2D: the sheet stays flat — left-drag pans, no rotation. 3D: left-drag orbits
  // around the box centre, right-drag pans. Wheel zooms in both.
  resetCamera() {
    const c = this.controls;
    // Drop any leftover rotation/pan momentum (damping) from before the reset.
    c.enableDamping = false;
    c.update();
    c.enableDamping = true;
    if (this.is2D) {
      this.camera.position.set(0, 0, 18);
      this.camera.up.set(0, 1, 0);
      c.enableRotate = false;
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    } else {
      this.camera.position.set(15, -18, 12);
      this.camera.up.set(0, 0, 1);
      c.enableRotate = true;
      c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    }
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
      for (let i = 0; i < data.length; i++) {
        const g = 255 - ((255 * (1 - Math.exp(-data[i] / scale))) | 0); // white → black
        td[4 * i] = g; td[4 * i + 1] = g; td[4 * i + 2] = g; td[4 * i + 3] = 255;
      }
      this.tex.needsUpdate = true;
    } else if (p.showTrail) {
      const { nx, ny } = this.dims;
      const pos = this.trailObj.geometry.attributes.position, col = this.trailObj.geometry.attributes.color;
      const pa = pos.array, ca = col.array;
      let n = 0;
      for (let i = 0; i < data.length; i++) {
        const v = 1 - Math.exp(-data[i] / scale);
        if (v < p.trailThreshold) continue;
        const x = i % nx, y = ((i / nx) | 0) % ny, z = (i / (nx * ny)) | 0;
        pa[3 * n] = x + 0.5; pa[3 * n + 1] = y + 0.5; pa[3 * n + 2] = z + 0.5;
        const f = (v - p.trailThreshold) / (1 - p.trailThreshold + 1e-6); // fade in above threshold
        ca[4 * n] = 0; ca[4 * n + 1] = 0; ca[4 * n + 2] = 0; ca[4 * n + 3] = 0.05 + 0.5 * f;
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
      this.placePlane.material.opacity = 0.03 + 0.12 * this.planeFlash;
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
