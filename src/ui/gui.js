// lil-gui panel. Every model parameter is exposed here.
// Structural parameters (grid size, agent count, seed, collision, spawn) reset the simulation;
// everything else is live.

import GUI from 'lil-gui';
import { STRUCTURAL } from '../params.js';
import { EXAMPLES } from '../examples.js';

// `app` provides: params, sim, reset(), setMode(mode), actions {...}
export function buildGUI(app) {
  const p = app.params;
  const gui = new GUI({ title: 'Physarum 3D — CPU reference' });
  const live = () => {};
  const onChange = (key) => (STRUCTURAL.includes(key) ? () => app.reset() : live);
  const add = (folder, key, ...args) => folder.add(p, key, ...args).onFinishChange(onChange(key));

  // Mode sits at the top so it is easy to find. Switching loads that mode's defaults.
  gui.add(p, 'mode', { '2D sanity (z = 1)': '2d', '3D': '3d' }).name('MODE').onChange((m) => app.setMode(m));
  gui.add(p, 'model', { 'Jones (source)': 'jones', 'growth (ours)': 'growth' }).name('MODEL')
    .onChange((m) => app.setModel(m));

  const run = gui.addFolder('Run');
  run.add(p, 'running').name('running').listen();
  run.add(app.actions, 'stepOnce').name('step once');
  run.add(app.actions, 'reset').name('reset (same seed)');
  run.add(p, 'ticksPerFrame', 1, 20, 1).name('ticks / frame');

  const setup = gui.addFolder('Setup (resets)');
  add(setup, 'gridX', 16, 512, 1);
  add(setup, 'gridY', 16, 512, 1);
  app.gridZController = add(setup, 'gridZ', 8, 256, 1);
  app.agentCountController = add(setup, 'agentCount', 100, 500000, 100).name('agents (Jones)');
  add(setup, 'seed', 0, 99999, 1);
  setup.add(app.actions, 'randomSeed').name('random seed');
  app.collisionController = add(setup, 'collision').name('collision (Jones)');
  add(setup, 'spawnAt', ['uniform', 'center', 'food']).name('spawn at');
  add(setup, 'spawnRadius', 1, 64, 1).name('spawn radius');

  const model = gui.addFolder('Model');
  add(model, 'sensorAngle', 0, 180, 0.5).name('SA sensor angle °');
  add(model, 'rotationAngle', 0, 180, 0.5).name('RA rotation angle °');
  add(model, 'sensorOffset', 0, 64, 0.5).name('SO sensor offset');
  add(model, 'stepSize', 0.1, 4, 0.1).name('step size');
  add(model, 'deposit', 0, 50, 0.1).name('deposit');
  add(model, 'decay', 0, 1, 0.005).name('decay (1 − damping)');
  add(model, 'diffuse', 0, 1, 0.01).name('diffuse (1 = Jones)');
  add(model, 'bothSidesBetter', ['towardLarger', 'random']).name('F < all sides');
  add(model, 'boundary', ['wrap', 'bounce', 'absorb']).name('boundary');
  add(model, 'randomTurnProb', 0, 1, 0.01).name('random turn prob.');
  app.sensorCountController = add(model, 'sensorCount', 2, 16, 1).name('3D: cone sensors');
  app.steeringController = add(model, 'steering', ['argmax', 'weighted']).name('3D: steering');

  // Growth model (ours, not from Jones). Setting a value to 0 switches that rule off.
  const growth = (app.growthFolder = gui.addFolder('Growth (model = growth)'));
  add(growth, 'initialAgents', 1, 5000, 1).name('initial agents');
  add(growth, 'maxAgents', 100, 200000, 100).name('max agents');
  add(growth, 'hungerSensing').name('only hungry smell food');
  add(growth, 'energyCost', 0, 0.02, 0.0005).name('energy cost / tick');
  add(growth, 'divideProb', 0, 0.2, 0.005).name('divide prob. / tick');
  add(growth, 'divideMinEnergy', 0, 1, 0.05).name('divide min. energy');
  add(growth, 'fedDepositBoost', 0, 10, 0.1).name('fed deposit boost');
  growth.add(app.actions, 'inoculate').name('reset: inoculum + food');

  const food = gui.addFolder('Food');
  food.add(p, 'foodStrength', 0, 200, 0.5).name('strength / tick')
    .onChange((v) => app.sim.sources.forEach((s) => (s.strength = v)));
  food.add(p, 'foodRadius', 0, 8, 0.5).name('radius');
  // Long-range food smell (not in Jones; 0 = off): sensors read trail + weight · Σ e^(−d/reach)
  food.add(p, 'foodWeight', 0, 10, 0.05).name('smell weight (0 = off)');
  food.add(p, 'foodReach', 1, 200, 1).name('smell reach');
  app.planeController = food.add(p, 'foodPlaneZ', 0, 256, 1).name('3D: plane depth z');
  food.add(p, 'scatterCount', 1, 50, 1).name('scatter N');
  food.add(app.actions, 'scatterFood').name('scatter N random food');
  food.add(app.actions, 'clearFood').name('clear food');

  const render = gui.addFolder('Render');
  render.add(p, 'showTrail').name('show trail');
  render.add(p, 'showAgents').name('show agents');
  render.add(p, 'displayScale', 0, 500, 0.5).name('display scale (0 = auto)');
  render.add(p, 'trailThreshold', 0, 0.99, 0.01).name('3D: point threshold');
  render.add(p, 'pointSize', 0.2, 4, 0.1).name('3D: point size');
  render.add(app.actions, 'resetCamera').name('reset camera');
  render.add(app.actions, 'screenshot').name('save screenshot');

  const presets = gui.addFolder('Presets');
  presets.add(app.actions, 'example', Object.keys(EXAMPLES)).name('examples')
    .onChange((name) => app.actions.loadExample(name));
  presets.add(app.actions, 'savePreset').name('save preset (.json)');
  presets.add(app.actions, 'loadPreset').name('load preset…');
  presets.add(app.actions, 'loadDefaults').name('defaults for this mode');

  return gui;
}

// Refresh all controllers after params were replaced (preset load, mode switch).
export function refreshGUI(app) {
  app.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  const is3D = app.params.mode === '3d';
  [app.gridZController, app.sensorCountController, app.steeringController, app.planeController]
    .forEach((c) => c.enable(is3D));
  const growth = app.params.model === 'growth';
  app.growthFolder.controllersRecursive().forEach((c) => c.enable(growth));
  app.agentCountController.enable(!growth);
  app.collisionController.enable(!growth); // growth always uses collision
  app.planeController.max(Math.max(1, app.params.gridZ - 1));
}
