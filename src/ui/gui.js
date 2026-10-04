// lil-gui panel. Every model parameter is exposed here.
// Structural parameters (grid size, agent count, seed, collision, spawn) reset the simulation;
// everything else is live.

import GUI from 'lil-gui';
import { STRUCTURAL } from '../params.js';

// `app` provides: params, sim, reset(), setMode(mode), actions {...}
export function buildGUI(app) {
  const p = app.params;
  const gui = new GUI({ title: 'Physarum 3D — CPU reference' });
  const live = () => {};
  const onChange = (key) => (STRUCTURAL.includes(key) ? () => app.reset() : live);
  const add = (folder, key, ...args) => folder.add(p, key, ...args).onFinishChange(onChange(key));

  const run = gui.addFolder('Run');
  run.add(p, 'running').name('running').listen();
  run.add(app.actions, 'stepOnce').name('step once');
  run.add(app.actions, 'reset').name('reset (same seed)');
  run.add(p, 'ticksPerFrame', 1, 20, 1).name('ticks / frame');

  const setup = gui.addFolder('Setup (resets)');
  setup.add(p, 'mode', { '2D sanity (z = 1)': '2d', '3D': '3d' }).name('mode').onChange((m) => app.setMode(m));
  add(setup, 'gridX', 16, 512, 1);
  add(setup, 'gridY', 16, 512, 1);
  app.gridZController = add(setup, 'gridZ', 8, 256, 1);
  add(setup, 'agentCount', 100, 500000, 100).name('agents');
  add(setup, 'seed', 0, 99999, 1);
  setup.add(app.actions, 'randomSeed').name('random seed');
  add(setup, 'collision').name('collision (Jones)');
  add(setup, 'spawnAt', ['uniform', 'food']).name('spawn at');
  add(setup, 'spawnRadius', 1, 64, 1).name('spawn radius');

  const model = gui.addFolder('Model');
  add(model, 'sensorAngle', 0, 180, 0.5).name('SA sensor angle °');
  add(model, 'rotationAngle', 0, 180, 0.5).name('RA rotation angle °');
  add(model, 'sensorOffset', 0, 64, 0.5).name('SO sensor offset');
  add(model, 'stepSize', 0.1, 4, 0.1).name('step size');
  add(model, 'deposit', 0, 50, 0.1).name('deposit');
  add(model, 'decay', 0, 1, 0.005).name('decay (1 − damping)');
  add(model, 'bothSidesBetter', ['towardLarger', 'random']).name('F < all sides');
  add(model, 'boundary', ['wrap', 'bounce']).name('boundary');
  add(model, 'randomTurnProb', 0, 1, 0.01).name('random turn prob.');
  app.sensorCountController = add(model, 'sensorCount', 2, 16, 1).name('3D: cone sensors');
  app.steeringController = add(model, 'steering', ['argmax', 'weighted']).name('3D: steering');

  const food = gui.addFolder('Food');
  food.add(p, 'foodStrength', 0, 200, 0.5).name('strength / tick')
    .onChange((v) => app.sim.sources.forEach((s) => (s.strength = v)));
  food.add(p, 'foodRadius', 0, 8, 0.5).name('radius');
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
  app.planeController.max(Math.max(1, app.params.gridZ - 1));
}
