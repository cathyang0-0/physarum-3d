# Physarum 3D

An agent-based simulation of the slime mold *Physarum polycephalum* in 2D and 3D, running in the
browser. Thousands of simple agents follow and deposit a chemical trail; together they grow a
transport network that links the food you place.

**Live demo:** https://cathyang0-0.github.io/physarum-3d/

Project 1, DESIGN 4197 — AI, Design & Creativity (Cornell AAP), Fall 2026.

## Try it

- **2D / 3D** (top): switch dimension. Each loads the best-working setup for that mode.
- **Shape** (left): the space it grows in — box, sphere, pyramid, cone, torus, gyroid.
- **Shuffle food** (top right): new random food positions and a fresh start.
- **Click** to add food, **Shift-click** to remove it.
- **3D**: drag to rotate, right-drag to pan, wheel to zoom. The grey plane is where clicks place
  food — move it with **Shift + wheel**, the **↑ / ↓** keys, or the **plane z** slider.
- **2D**: drag to pan, wheel to zoom.
- **Pause / Step / Reset**, **+ Random food**, **Clear food** (bottom).
- **Examples…**: other setups — a converging 3D network (Jones's sensor angle 45°, used in the
  teaser), the Jones 2010 "shrinkage" method (a sheet that contracts into a shortest-path tree),
  our own population-adaptation and growth variants, and the 2D sanity check.
- **Parameters**: every model parameter, live. Presets save and load as JSON.

## The model

The core follows Jeff Jones's particle model of Physarum transport networks:

> Jones, J. (2010). Characteristics of pattern formation and evolution in approximations of
> Physarum transport networks. *Artificial Life* 16(2):127–153.

Each tick, in random order, every agent tries to move one cell forward (one agent per cell;
a blocked agent turns to a random direction) and deposits trail if it moved. Then every agent
samples the trail at three sensors ahead of it (front, front-left, front-right) and turns toward
the strongest one. The trail diffuses (3 × 3 mean filter) and decays. Food sources add trail
every tick.

The main setups use Jones's dynamic regime (sensor angle 22.5°, rotation angle 45°), in which the
network keeps branching and closing loops instead of settling. In 3D the three sensors become a
front sensor plus a cone of sensors around the heading; this extension, the partial diffusion,
and the other non-Jones options are design choices, marked as such in the code
(`src/params.js` says for every parameter whether its value is from the source or tuned).
[SPEC.md](SPEC.md) is the original build spec.

**Shapes** (left bar): the slime mold can grow inside a box, sphere, pyramid, cone, torus or a
gyroid labyrinth. As in Jones's model, where the habitable area is given by an image, cells outside
the shape are off-limits: agents cannot enter them and trail there is lost.

## Run locally

No build step. Needs Python 3 and an internet connection (three.js and lil-gui load from a CDN).

```bash
python3 tools/serve.py
```

Then open http://localhost:8000. (`tools/serve.py` is `http.server` with caching turned off, so a
reload always picks up code changes.)

Headless runs (Node 18+), e.g. for parameter studies:

```bash
node tools/headless.mjs --ticks 2000 --every 500 --out out/run.png
```

Teaser animation, recorded from the page itself (so it looks exactly like the site):

```bash
python3 tools/serve.py              # the site, port 8000
python3 tools/record_server.py      # receives frames into out/frames, port 8001
```

Then, in the browser console on http://localhost:8000:

```js
const { recordTeaser } = await import('/tools/record-teaser.js');
await recordTeaser();               // sphere and torus, "converging network" setup
```

and assemble the GIF (Python + Pillow):

```bash
python3 tools/frames_to_gif.py out/frames out/teaser.gif 15 170 sphere,torus
```

(`tools/teaser.mjs` is an older headless renderer that draws the network only.)

## Code

```
src/sim/        simulation (plain JS, typed arrays, no DOM — also runs in Node)
  simulation.js   the tick loop, agents, food sources, population changes
  rules2d.js      Jones's sense / rotate / move / deposit rules in 2D
  rules3d.js      the same rules with a cone of sensors in 3D
  trail.js        trail grid, diffusion + decay
  domain.js       habitable shapes (cell masks)
  adapt.js        population adaptation (ours)
  growth.js       growth model (ours)
src/render/     three.js view
src/ui/         toolbar, parameter panel, presets
src/params.js   all parameters and their defaults
src/examples.js the built-in setups
tools/          dev server, headless runner, teaser renderer
```

This is the CPU reference implementation; a WebGPU port for millions of agents is planned.
