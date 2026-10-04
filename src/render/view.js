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

    this.resetCamera();
  }

  resetCamera() {
    if (this.is2D) this.camera.position.set(0, 0, 18);
    else this.camera.position.set(15, -18, 12);
    this.camera.up.set(0, 0, 1);
    if (this.is2D) this.camera.up.set(0, 1, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  // Copy simulation state into GPU buffers. Called once per frame.
  update(sim, p) {
    const scale = p.displayScale > 0 ? p.displayScale : autoScale(sim.trail.data);
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

    if (this.placePlane) this.placePlane.position.set(this.dims.nx / 2, this.dims.ny / 2, p.foodPlaneZ);
    this.updateFood(sim, p);
  }

  updateFood(sim, p) {
    const key = JSON.stringify(sim.sources.map((s) => [s.x, s.y, s.z])) + p.foodRadius;
    if (key === this.foodKey) return;
    this.foodKey = key;
    this.foodGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.foodGroup.clear();
    // Food = a thin black ring showing the eating radius (2D), or a small fixed-size black
    // sphere (3D; a sphere of the full radius would hide the network).
    const r = Math.max(1.5, p.foodRadius);
    const geo = this.is2D ? new THREE.RingGeometry(r, r + 0.8, 32) : new THREE.SphereGeometry(1.2, 16, 12);
    const mat = new THREE.MeshBasicMaterial({ color: INK });
    for (const s of sim.sources) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x, s.y, this.is2D ? 1 : s.z);
      this.foodGroup.add(m);
    }
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

// Display scale when displayScale = 0 ("auto"): 3 × the mean trail value.
// Display only — it never feeds back into the model.
function autoScale(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return 3 * (sum / data.length) || 1;
}
