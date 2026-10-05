// Record the teaser from the live page, so it looks exactly like the site (shape outlines included).
// 1. python3 tools/serve.py          (the site, port 8000)
// 2. python3 tools/record_server.py   (receives frames into out/frames, port 8001)
// 3. in the page's console:
//      const { recordTeaser } = await import('/tools/record-teaser.js');
//      await recordTeaser();
// 4. python3 tools/frames_to_gif.py out/frames out/teaser.gif 15 <frames per shape> sphere,torus
//
// Per shape: the network forms and slowly converges (simulation time eased in, so early formation
// is slow and later contraction faster), then a short hold at normal speed. The camera circles
// once per shape.

const EXAMPLE = '3D · converging network (Jones SA 45°)';

export async function recordTeaser({
  shapes = ['box', 'sphere'],
  size = 800,
  grow = 130,       // frames while the network forms and converges
  hold = 40,        // frames at normal speed at the end
  mature = 4500,    // simulation tick reached at the end of the grow phase
  holdTicks = 3,    // ticks per frame during the hold
  elevation = 0.42, // camera elevation (radians)
  zoom = { box: 1.1 }, // camera distance relative to the site's default framing, per shape (default 0.85)
  url = 'http://localhost:8001/frame/',
} = {}) {
  const { app, params } = window.app ? { app: window.app, params: window.app.params } : {};
  if (!app) throw new Error('window.app not found — run this in the Physarum page');
  const view = app.view, cv = view.renderer.domElement;

  // Hide the interface and render a square canvas at 1× pixel ratio.
  const style = document.createElement('style');
  style.textContent = 'body > *:not(#view) { display: none !important; }';
  document.head.appendChild(style);
  view.renderer.setPixelRatio(1);
  view.renderer.setSize(size, size);
  view.camera.aspect = 1;
  view.camera.updateProjectionMatrix();

  const per = grow + hold;
  let n = 0;
  for (const shape of shapes) {
    app.actions.loadExample(EXAMPLE);
    app.actions.setDomain(shape);
    params.running = false;
    view.placePlane && (view.placePlane.visible = false);
    view.preview.visible = false;

    const dist = (zoom[shape] ?? 0.85) * view.camera.position.length();
    let azimuth = Math.atan2(view.camera.position.y, view.camera.position.x);
    const tickAt = (f) => (f < grow ? Math.round(mature * ((f + 1) / grow) ** 1.7) : mature + (f - grow + 1) * holdTicks);

    for (let f = 0; f < per; f++, n++) {
      while (app.sim.tick < tickAt(f)) app.sim.step();
      azimuth += (2 * Math.PI) / per;
      view.camera.position.set(
        dist * Math.cos(elevation) * Math.cos(azimuth),
        dist * Math.cos(elevation) * Math.sin(azimuth),
        dist * Math.sin(elevation),
      );
      view.camera.lookAt(0, 0, 0);
      view.update(app.sim, params);
      view.placePlane && (view.placePlane.visible = false);
      view.renderer.render(view.scene, view.camera);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      await fetch(url + n, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/png' } });
    }
  }
  style.remove();
  view.resize();
  return { frames: n, perShape: per };
}
