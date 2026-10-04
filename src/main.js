// Entry point: wires simulation, view, GUI and mouse input together.

import { Simulation } from './sim/simulation.js';
import { View } from './render/view.js';
import { buildGUI, refreshGUI } from './ui/gui.js';
import { defaultsFor, MODEL_SWITCH } from './params.js';
import { makePreset, downloadJSON, pickPresetFile } from './ui/presets.js';

const params = defaultsFor('2d');
const sim = new Simulation(params);
const view = new View(document.getElementById('view'));
const stats = document.getElementById('stats');

const app = {
  params,
  sim,
  reset() {
    sim.reset();
    view.rebuild(sim);
    if (app.gui) refreshGUI(app);
  },
  // Switching mode loads that mode's default preset (each mode's defaults are a coherent set),
  // keeping the current model.
  setMode(mode) {
    const model = params.model;
    Object.assign(params, defaultsFor(mode), { running: params.running });
    app.setModel(model);
  },
  // Switching model applies its spawn settings. Growth starts from an inoculum on a food source
  // in the centre, plus N scattered food sources.
  setModel(model) {
    Object.assign(params, MODEL_SWITCH[model], { model });
    if (model === 'growth') app.actions.inoculate();
    else { sim.clearSources(); app.reset(); }
  },
  actions: {
    stepOnce: () => { sim.step(); },
    reset: () => app.reset(),
    randomSeed: () => { params.seed = Math.floor(Math.random() * 100000); refreshGUI(app); app.reset(); },
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
        refreshGUI(app);
      } catch (e) {
        alert(`Could not load preset: ${e.message}`);
      }
    },
    loadDefaults: () => app.setMode(params.mode),
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
view.rebuild(sim);
refreshGUI(app);

// ---- Mouse: click = add food, shift-click = remove. A drag (orbit) is not a click. ----------
let down = null;
const canvas = view.renderer.domElement;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
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
    `collision ${params.collision ? 'on (Jones)' : 'off (Jenson)'}   food ${sim.sources.length}   seed ${params.seed}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.app = app; // handy for debugging in the console
