# Physarum 3D — v0 spec

Goal of v0: a **correct, inspectable 3D implementation of Jones's Physarum model** in the browser, with
food placed by mouse, live parameter controls, and mesh export to Rhino.

---

## 1. The model (2D, as Jones describes it)

Sources (all read; quotes are from Jones's own restatements of his 2010 model):
- Jones, J. (2010). *Characteristics of pattern formation and evolution in approximations of Physarum
  transport networks.* Artificial Life 16(2):127–153. doi:10.1162/artl.2010.16.2.16202 — the original.
  (The UWE repository PDF sits behind a bot check, so the rules below come from the two arXiv papers
  that follow.)
- Jones & Adamatzky (2012). *Emergence of Self-Organized Amoeboid Movement in a Multi-Agent
  Approximation of Physarum polycephalum.* arXiv:1212.0023 — the Methods section and Figure 1 give the
  sensory pseudocode.
- Jones et al. (2015). *Automated Guidance of Collective Movement in a Multi-Agent Model of Physarum
  polycephalum.* arXiv:1511.07654 — Section 3, "Modelling Approach", gives parameter values.

**Two layers:**
- **Agents** (particles): each has a position and a heading.
- **Trail map**: a lattice of chemoattractant concentration. Agents deposit into it and sense from it.

**Sensory stage.** Each agent samples the trail at three forward-biased sensors: F (front), FL
(front-left) and FR (front-right). Each sensor sits at distance **SO** (sensor offset) from the agent,
at angle **SA** (sensor angle) from the heading. The agent then rotates by **RA** (rotation angle):

```
if F > FL and F > FR:        keep heading
elif F < FL and F < FR:      rotate by RA towards the larger of FL and FR
elif FL < FR:                rotate right by RA
elif FR < FL:                rotate left by RA
else:                        keep heading
```

This is the arXiv:1212.0023 Figure 1b pseudocode as extracted from the PDF text ("Else if (F < FL) &&
(F < FR) Rotate by RA towards larger of FL and FR"). Many common implementations rotate in a
*random* direction in that branch instead. Make that a toggle (`bothSidesBetter: towardLarger | random`),
with the paper's version as the default.

**Motor stage.** The agent tries to move forward one cell along its heading.
- Jones: "Each lattice site may only store a single particle", and particles deposit "only in the event
  of a successful forwards movement". If the target cell is occupied, the agent stays put and picks a
  new random heading.
- Jones: "iteration of the particle population is performed randomly to avoid introducing any
  artifacts from sequential ordering."

**Trail update.** Diffusion is a 3×3 mean filter with a damping parameter. The 2012 paper gives 0.07;
the 2015 paper's text says "the mean multiplied by a damping parameter (set to 0.1)". Implement
decay so that its meaning is explicit (`trail = mean * (1 - decay)`, or whichever form the paper's
wording supports), and write down the interpretation you chose.

**Parameter values found in the sources** (all 2D, in pixels; use them as a starting point, not as truth):

| Param | 2015 paper (arXiv:1511.07654) | Notes |
|---|---|---|
| SA | 90° | other Jones papers use smaller values; tune |
| RA | 45° | |
| SO | 15 px | 2012: "a minimum distance of 3 pixels is required for strong local coupling" |
| step | 1 px | |
| deposit | 5 units | only deposited on a successful move |
| damping | 0.1 (2012 paper: 0.07) | |

From the arXiv search snippet on sensor angle and rotation angle (not yet confirmed against a full
paper, so verify before relying on it): when RA equals SA the network contracts; RA < SA contracts
further; RA > SA causes spontaneous branching. This makes a good first parameter study.

## 2. Sage Jenson's simplifications

Source: Sage Jenson, "physarum" (Feb 2019), https://cargocollective.com/sagejenson/physarum
- Jenson describes the model as an agent layer ("data map") plus a continuum layer ("trail map").
- Six sub-steps per tick: sense, rotate, move, deposit, diffuse, decay.
- **The collision step is dropped** ("I usually ignored this step, preferring the patterns that arose
  without it"). Jenson notes that collision approximates conservation of matter and is what removes
  sequential dependence. Dropping it makes the update fully parallel.
- Diffusion is a 3×3 mean filter followed by a multiplicative decay factor.
- Runs entirely on the GPU (openFrameworks + GLSL), with 5–10 million particles on a GTX 1070.

→ Implement **both** modes: `collision: on` (Jones-faithful) and `collision: off` (Jenson-style,
parallel-friendly). Default to off for speed.

## 3. Going to 3D (not in Jones; these are design choices)

- Trail map becomes a 3D grid (start at 128³; make it configurable). Diffusion uses a 3×3×3 mean.
- Heading becomes a 3D unit vector, or two angles.
- Sensors: Jones has 3 sensors in a plane. In 3D, use the front sensor plus N sensors on a cone at
  angle SA around the heading.
  - **Reference implementation:** Barbelot/Physarum3D (Unity, MIT license),
    `Shaders/PhysarumVolume.compute`. It uses 5 sensors (front, left, right, top, down) on two angle
    axes. The agent picks the maximum and rotates the matching axis by RA. It also has a
    `_RandomRotationProbability` and a `_TrailRepulsion` threshold (it ignores sensors whose value is
    above `1 - repulsion`). Its 4 diagonal sensors are commented out.
  - Make the sensor count selectable (4/6/8 on the cone). For a smoother option, use a weighted
    vector sum of the sensor directions instead of the argmax. Dave Reeves did this in 2D ("Mouldy
    Networks", Spatial Slur blog, 2012), and Elek et al.'s Monte Carlo Physarum Machine uses
    probabilistic sampling for 3D (Artificial Life 28(1); open-source Polyphorm).
- Boundaries: wrap, or reflect/respawn. Make it a toggle.
- Also read: Garnier, Schmidt & Rohmer (2024), *PhysOM: Physarum polycephalum Oriented
  Microstructures*, Computer Graphics Forum 43(6), doi:10.1111/cgf.15075. It covers 3D Physarum for
  fabricable microstructures: infill of bounded shapes, local anisotropy, and parameter analysis.
  Not needed for v0, but it is the main reference for later stages.

## 4. Food (mouse input, v0 only)

- A food source is a cell (or small sphere) that **adds a constant amount of attractant to the trail
  every tick** (strength parameter). Agents then find it by the normal sensing rule.
- Placement: the mouse is 2D, so use a **placement plane** inside the volume. Its depth is set by
  slider or scroll and shown as a translucent slice. Click places food on the plane; shift-click
  removes it; there is also a "scatter N random food" button and a "clear food" button.
- Food can also act as a *spawn* point for agents (toggle) to reproduce Physarum growing out from an
  inoculation site.
- Planned later, not in v0: body input from a webcam replaces the mouse. Keep food sources behind an
  interface (`addSource(pos, strength, type)`) so a sensor can drive them later. `type` reserves
  `attract | repel | orient`.

## 5. Tech stack (suggested)

- Plain HTML + ES modules, with **three.js** for rendering and **lil-gui** for parameters, both loaded
  from cdn.jsdelivr.net. No build step, served with `python3 -m http.server`.
- **Step A — CPU reference** in JS typed arrays (64³ to 128³ grid, ~50k–200k agents). It is slow but
  easy to read and verify.
- **Step B — GPU**: port the same rules to WebGPU compute (3D storage texture or buffer) for millions
  of agents. Keep the CPU version as the correctness reference, and compare the two on the same seed.
- Rendering: agents as points, plus the trail as a thresholded point cloud or a ray-marched volume.
  Include orbit controls.

## 6. Export (to Rhino)

- Extract the trail grid's isosurface with marching cubes at a user-chosen threshold, and export it as
  **OBJ** (mesh) and **PLY**. Also export the raw grid (`.raw` with a JSON header) so a Grasshopper
  workflow can resample it.
- Export the current parameter preset alongside every export.

## 7. Done criteria for v0

1. The 2D sanity mode (z-depth = 1) visibly reproduces Jones-style networks: they form, contract,
   and close lacunae.
2. 3D mode forms 3D networks that connect the mouse-placed food sources, and these networks re-route
   when food is added or removed.
3. Every parameter is live-editable, presets save and load, and a fixed random seed is available.
4. The OBJ export opens in Rhino at a sensible scale.
5. `NOTES.md` lists every deviation from Jones and every parameter value marked "from source" or
   "tuned".
6. A short parameter study: render a grid of screenshots across SA × RA (and SO) on a fixed seed.

## 8. Not in v0
Webcam or body input, concept or narrative UI, fabrication-specific post-processing.
