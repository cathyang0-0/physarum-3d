// Entry point: wires simulation, view, GUI and mouse input together.

import { Simulation } from './sim/simulation.js';
import { View } from './render/view.js';
import { buildGUI, refreshGUI } from './ui/gui.js';
import { buildToolbar, updateToolbar } from './ui/toolbar.js';
import { defaultsFor, modelSwitch } from './params.js';
import { makePreset, downloadJSON, pickPresetFile } from './ui/presets.js';
import { EXAMPLES, MAIN } from './examples.js';

const params = defaultsFor('2d');
const sim = new Simulation(params);
const view = new View(document.getElementById('view'));
const stats = document.getElementById('stats');

const app = {
  params,
  sim,
  view,
  reset() {
    sim.reset();
    view.rebuild(sim);
    app.refresh();
  },
  // Bring the sidebar and toolbar in line with params (after any switch or load).
  refresh() {
    if (!app.gui) return;
    refreshGUI(app);
    updateToolbar(app);
  },
  // The 2D / 3D toggle loads the best setup for that mode (examples.js MAIN).
  setMode(mode) {
    app.actions.loadExample(MAIN[mode]);
  },
  // Switching model applies its spawn settings. Growth starts from an inoculum on a food source
  // in the centre, plus N scattered food sources. (Only used by the growth example now.)
  setModel(model) {
    Object.assign(params, modelSwitch(model, params.mode), { model });
    if (model === 'growth') app.actions.inoculate();
    else { sim.clearSources(); app.reset(); }
  },
  actions: {
    stepOnce: () => { sim.step(); },
    reset: () => app.reset(),
    randomSeed: () => { params.seed = Math.floor(Math.random() * 100000); app.reset(); },
    scatterFood: () => sim.scatterSources(params.scatterCount),
    clearFood: () => sim.clearSources(),
    resetCamera: () => view.resetCamera(),
    screenshot: () => {
      const a = document.createElement('a');
      a.href = view.renderer.domElement.toDataURL('image/png');
      a.download = `physarum_${params.mode}_seed${params.seed}_t${sim.tick}.png`;
      a.click();
    },
    savePreset: () => downloadJSON(makePreset(params, sim.sources), `preset_${params.mode}_seed${params.seed}.json`),
    loadPreset: async () => {
      try {
        const preset = await pickPresetFile();
        Object.assign(params, defaultsFor(preset.params.mode), preset.params);
        sim.clearSources();
        (preset.food ?? []).forEach((s) => sim.addSource(s, s.strength, s.type));
        app.reset();
      } catch (e) {
        alert(`Could not load preset: ${e.message}`);
      }
    },
    loadDefaults: () => app.setMode(params.mode), // = reload the main setup for this mode
    loadExample: (name) => {
      const ex = EXAMPLES[name];
      Object.assign(params, defaultsFor(ex.mode), ex.over, { running: true });
      if (ex.model === 'growth') { app.setModel('growth'); return; }
      sim.clearSources();
      sim.reset(); // re-seed the food rng
      sim.scatterSources(ex.food);
      app.reset();
    },
    inoculate: () => {
      sim.clearSources();
      sim.reset(); // re-seeds the food rng, so the scattered food is the same for a given seed
      const t = sim.trail;
      sim.addSource({ x: t.nx / 2, y: t.ny / 2, z: t.nz / 2 });
      sim.scatterSources(params.scatterCount);
      app.reset();
    },
  },
};
app.gui = buildGUI(app);
buildToolbar(app);
app.setMode('3d'); // start on the main 3D setup

// ---- Mouse: click = add food, shift-click = remove. A drag (orbit) is not a click. ----------
// 3D: the food plane moves with Shift + wheel or the ↑ / ↓ keys (or the toolbar slider).
let down = null;
const canvas = view.renderer.domElement;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });

let lastMouse = null;
const updatePreview = () => {
  const pos = lastMouse && view.pickOnPlane(lastMouse.x, lastMouse.y, params.foodPlaneZ);
  view.showPreview(pos);
};
canvas.addEventListener('pointermove', (e) => { lastMouse = { x: e.clientX, y: e.clientY }; updatePreview(); });
canvas.addEventListener('pointerleave', () => { lastMouse = null; view.showPreview(null); });

function movePlane(dz) {
  if (params.mode !== '3d') return;
  params.foodPlaneZ = Math.min(Math.max(0, params.foodPlaneZ + dz), params.gridZ - 1);
  view.flashPlane();
  updateToolbar(app);
  updatePreview();
}
// Capture phase on the container, so OrbitControls (listening on the canvas) never sees the
// Shift+wheel event and does not zoom.
document.getElementById('view').addEventListener('wheel', (e) => {
  if (!e.shiftKey || params.mode !== '3d') return;
  e.preventDefault();
  e.stopPropagation();
  const d = e.deltaY !== 0 ? e.deltaY : e.deltaX; // macOS turns Shift+wheel into horizontal scroll
  movePlane(d > 0 ? -1 : 1);
}, { capture: true, passive: false });
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea, .lil-gui')) return;
  if (e.key === 'ArrowUp') { movePlane(1); e.preventDefault(); }
  if (e.key === 'ArrowDown') { movePlane(-1); e.preventDefault(); }
});
canvas.addEventListener('pointerup', (e) => {
  if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  const pos = view.pickOnPlane(e.clientX, e.clientY, params.foodPlaneZ);
  if (!pos) return;
  if (e.shiftKey) sim.removeSourceNear(pos, Math.max(6, params.foodRadius * 3));
  else sim.addSource(pos);
});

// ---- Main loop ----------------------------------------------------------------------------
let msPerTick = 0, fps = 0, last = performance.now();
function frame() {
  const now = performance.now();
  if (params.running) {
    const t0 = performance.now();
    for (let k = 0; k < params.ticksPerFrame; k++) sim.step();
    msPerTick = 0.9 * msPerTick + 0.1 * ((performance.now() - t0) / params.ticksPerFrame);
  }
  view.update(sim, params);
  view.render();
  fps = 0.9 * fps + 0.1 * (1000 / Math.max(1, now - last));
  last = now;
  const { nx, ny, nz } = sim.trail;
  stats.textContent =
    `mode ${params.mode}   model ${params.model}   grid ${nx}×${ny}×${nz}   agents ${sim.agentCount}\n` +
    `tick ${sim.tick}   ${msPerTick.toFixed(1)} ms/tick   ${fps.toFixed(0)} fps\n` +
    `collision ${sim.collision ? 'on (Jones)' : 'off (Jenson)'}   food ${sim.sources.length}   seed ${params.seed}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.app = app; // handy for debugging in the console
