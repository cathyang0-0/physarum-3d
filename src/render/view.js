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

// Colour ramp for trail values v in [0, 1].
const STOPS = [[0, [10, 10, 16]], [0.35, [120, 40, 20]], [0.7, [235, 140, 40]], [1, [255, 245, 200]]];
const LUT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  let k = 0;
  while (k < STOPS.length - 2 && v > STOPS[k + 1][0]) k++;
  const [v0, c0] = STOPS[k], [v1, c1] = STOPS[k + 1];
  const f = (v - v0) / (v1 - v0);
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = Math.round(c0[c] + f * (c1[c] - c0[c]));
}

export class View {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a10);
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
    const box = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(nx, ny, nz)), 0x444455);
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
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(size * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.PointsMaterial({
        size: 1, vertexColors: true, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.trailObj = new THREE.Points(g, m);
      this.trailObj.frustumCulled = false;
      this.root.add(this.trailObj);

      // Food placement plane (translucent slice at z = foodPlaneZ)
      this.placePlane = new THREE.Mesh(
        new THREE.PlaneGeometry(nx, ny),
        new THREE.MeshBasicMaterial({ color: 0x3399ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.placePlane.add(new THREE.LineSegments(new THREE.EdgesGeometry(this.placePlane.geometry), new THREE.LineBasicMaterial({ color: 0x3399ff })));
      this.root.add(this.placePlane);
    }

    // Agents
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sim.agentCount * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.agentsObj = new THREE.Points(ag, new THREE.PointsMaterial({ size: 0.6, color: 0x88ccff, transparent: true, opacity: 0.6, depthWrite: false }));
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
    else this.camera.position.set(11, -13, 9);
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
        const v = 1 - Math.exp(-data[i] / scale);
        const l = Math.min(255, (v * 255) | 0) * 3;
        td[4 * i] = LUT[l]; td[4 * i + 1] = LUT[l + 1]; td[4 * i + 2] = LUT[l + 2]; td[4 * i + 3] = 255;
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
        const l = Math.min(255, (v * 255) | 0) * 3;
        const f = (v - p.trailThreshold) / (1 - p.trailThreshold + 1e-6); // fade in above threshold
        ca[3 * n] = (LUT[l] / 255) * f; ca[3 * n + 1] = (LUT[l + 1] / 255) * f; ca[3 * n + 2] = (LUT[l + 2] / 255) * f;
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
    const geo = new THREE.SphereGeometry(Math.max(1, p.foodRadius), 16, 12);
    for (const s of sim.sources) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x33e0ff, wireframe: true }));
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
