// Top toolbar: the controls used all the time. Everything else lives in the parameter sidebar.

import { EXAMPLES } from '../examples.js';

const $ = (id) => document.getElementById(id);

export function buildToolbar(app) {
  const p = app.params;

  // Clicking the active mode again reloads its setup (fresh start).
  $('modeSeg').addEventListener('click', (e) => {
    const m = e.target.dataset.mode;
    if (m) app.setMode(m);
  });

  $('playBtn').onclick = () => { p.running = !p.running; updateToolbar(app); };
  $('stepBtn').onclick = () => { p.running = false; app.actions.stepOnce(); updateToolbar(app); };
  $('resetBtn').onclick = () => app.actions.reset();
  $('foodBtn').onclick = () => app.actions.scatterFood();
  $('clearBtn').onclick = () => app.actions.clearFood();
  $('planeZ').oninput = (e) => { p.foodPlaneZ = Number(e.target.value); app.view.flashPlane(); };

  const sel = $('exampleSel');
  sel.innerHTML = '<option value="">Examples…</option>' +
    Object.keys(EXAMPLES).map((k) => `<option>${k}</option>`).join('');
  sel.onchange = () => { if (sel.value) app.actions.loadExample(sel.value); sel.value = ''; };

  $('paramsBtn').onclick = () => {
    const hidden = app.gui.domElement.classList.toggle('hidden');
    $('paramsBtn').classList.toggle('on', !hidden);
  };
}

// Reflect the current state (after mode/model switches, example or preset loads, etc.).
export function updateToolbar(app) {
  const p = app.params;
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === p.mode);
  $('playBtn').textContent = p.running ? 'Pause' : 'Play';
  $('planeCtl').style.display = p.mode === '3d' ? '' : 'none';
  $('help3d').style.display = p.mode === '3d' ? '' : 'none';
  const z = $('planeZ');
  z.max = Math.max(1, p.gridZ - 1);
  z.value = p.foodPlaneZ;
}
