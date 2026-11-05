# Terrain Prompter: Project Brief

A browser-based, GPU-accelerated terrain generator for a **Shadowdark westmarches campaign**. The GM shapes a *region* (not a continent) by **typing prompts** ("a jagged ridge running NE through 0405–1109, with a glacial valley cutting through it") and by **painting with brushes**. The result is realistic, eroded terrain you can view from high above the region and fly down into a single 6-mile hex.

This brief covers **v1: the terrain prompter**. Placing settlements, ruins and other structures comes later (see "Later phases"). v1 only has to keep the data model open for that.

---

## 1. Why this exists (read this first)

Look at the images in `reference/`:

| File | Role | What to take from it |
|---|---|---|
| `01-anti-reference-mapgen4-continental.png` | **Anti-reference** | Made in mapgen4 in 5 minutes. Fine-looking, but **wrong scale** (a continent on a tile) and **abstract colours** (elevation tints, not surfaces). You can't zoom into a 6-mile hex and get anything usable. Avoid this look. |
| `02-target-world-machine-eye-level.jpg` | **Primary target** | Eroded ridgelines, snow following altitude *and* slope, rock on steep faces, scree/gravel fans and a braided riverbed in the valley floor, grass on gentle slopes, strong atmospheric depth. This is the **mood when flown down to near ground level**. (Flowers and birds are out of scope.) |
| `03-target-minecraft-distant-horizons-overview.jpg` | **Target: overview** | A world seen from very high up, still **readable as real surfaces**: forest, plains, desert, badlands, snow, shallow vs. deep water, with haze toward the horizon. This is the **region-overview mood**: natural colour, not elevation tints. |
| `04-target-minecraft-tectonic-closeup.jpg` | **Target: mid-altitude** | Realistic large-scale landforms (Tectonic mod), dense forest, a lake in a basin, a snowy range behind, volumetric haze and sun. Shows **forest as a texture/volume** and **aerial perspective**. A blocky/voxel look is only an optional stretch style. |

**Two problems to solve:**
1. **Scale.** The map covers roughly 20×16 hexes of 6 miles (~190 × 150 km). Terrain must hold up from full-region view down to one-hex view (~10 km across).
2. **Height.** The GM's main complaint about existing hexmap tools is that they don't convey elevation. Relief, shadows, haze and surface materials must make height obvious at every zoom level.

---

## 2. Scope of v1

### Must have
1. **World setup:** hex grid size (default 20 cols × 16 rows), hex size 6 miles flat-to-flat (configurable), flat-top or pointy-top, sea level, max elevation (default ~4,500 m), vertical exaggeration slider (display only).
2. **Non-destructive op stack** (§4): every prompt and brush stroke becomes an *op*. The heightmap is always recomputed from the stack. Ops can be listed, toggled, reordered, edited and deleted. Undo/redo works.
3. **Prompt panel** (§5): natural language → Claude → structured ops. Hex labels (`0507` = col 05, row 07) and compass directions work as coordinates.
4. **Brushes** (§6): raise, lower, smooth, flatten (sample height on click), ridge stroke, valley/river carve stroke, roughen, local erode.
5. **Erosion** on the GPU (§7): hydraulic (with sediment deposition) + thermal. Progressive, so you watch it converge. The flow accumulation it produces feeds rivers and materials.
6. **Renderer** (§8): realistic materials, lighting, shadows, haze and water. Smooth zoom from region to single hex with LOD. Orbit camera plus a fly camera.
7. **Hex overlay:** toggleable grid with labels, hover readout (hex id, elevation range, mean slope, dominant material).
8. **Save/load:** a world is a JSON file (settings + op stack + seed). The baked heightmap can be cached in IndexedDB but is always reproducible from the JSON.
9. **Export:** 16-bit grayscale PNG heightmap, the world JSON, and a screenshot at the current camera.

### Nice to have (only if v1 is solid)
- **Hex terrain classification:** derive a Shadowdark-ish terrain type per hex (plains, forest, hills, mountains, swamp, desert, water) from slope, elevation, moisture and flow, and show it in the hover readout and as an optional overlay.
- **Top-down "map mode":** orthographic camera with hillshade + materials, as the base for a later 2D player map.
- **Stylized/voxel toggle** (Distant Horizons look): terrace/quantize heights and render blocky. A render style only; the same data underneath.

### Out of scope for v1
Structures and points of interest, roads, a player-facing explorer, multiplayer, individual tree meshes (forest is a material/canopy layer in v1), caves and overhangs.

---

## 3. Tech stack and constraints

- **Vite + TypeScript + three.js.** Strict TS.
- **WebGL2 is the baseline.** Every feature must work on WebGL2. The cloud dev environment can only screenshot via headless Chromium with SwiftShader, which supports WebGL2 but usually not WebGPU. WebGPU may be added later behind a feature flag. GPGPU work (op evaluation if you choose, erosion, normals, flow) uses ping-pong float render targets (`EXT_color_buffer_float`).
- **No backend required.** The app is a static site. Keep it buildable as a **single self-contained HTML file** too (e.g. `vite-plugin-singlefile`) so it can be hosted as a claude.ai artifact later.
- **Determinism:** same world JSON + seed → same heightmap (within float tolerance). Use a seeded PRNG and seeded noise only.
- **Performance targets** (mid-range laptop GPU, e.g. integrated Apple M1 / Intel Iris Xe):
  - 60 fps orbiting the full region; ≥ 45 fps in fly mode at low altitude.
  - Brush strokes give **instant preview** (< 16 ms per dab) on the un-eroded layer. Erosion re-runs progressively afterwards; it never blocks the UI.
  - Recomputing the op stack (~30 ops) at design resolution: < 300 ms.
  - Full erosion bake at default resolution: converges visibly within ~5–10 s.
- **Resolution plan** (make it configurable; these are defaults):
  - *Design layer* (op stack output): 1024² or 2048².
  - *Eroded layer*: 2048² over ~190 km ≈ **~95 m/px** (a hex is ~100 px across). An optional "high quality bake" at 4096² (~47 m/px) may run tiled if memory allows. Watch GPU memory: the erosion pipe model needs several RGBA32F targets, which is ~64 MB each at 4096².
  - *Close-up detail*: below ~3 km camera altitude, add **procedural detail in the shader** (detail normals + small displacement from ridged noise, modulated by slope and flow so it reads like erosion, not random bumps). This is how a single hex looks rich without an enormous heightmap.

---

## 4. Data model: the op stack

A world:

```ts
interface World {
  version: 1;
  seed: number;
  grid: { cols: number; rows: number; hexMiles: number; orientation: 'flat' | 'pointy' };
  terrain: { seaLevelM: number; maxElevationM: number; designRes: number; erodedRes: number };
  base: BaseTerrain;     // starting noise: type, amplitude, frequency, octaves, warp…
  ops: Op[];             // applied in order to produce the design heightmap
  erosion: ErosionSettings;
  climate: ClimateSettings; // wind direction, base moisture, snowline, treeline (drives materials)
  meta: { name: string; notes?: string; createdAt: string; updatedAt: string };
}
```

Coordinates inside ops are **world km** (origin top-left). The UI and the LLM can *express* positions as hex ids, compass directions or normalised coordinates; a resolver converts them to km before the op is stored. Store the original expression too (e.g. `"from": "0405"`) for readability.

**Op types (initial set).** Each has `id`, `type`, `enabled`, `label` (human-readable, e.g. "Northern Spine ridge"), `source: 'prompt' | 'brush' | 'manual'`, a `blend` mode (`add | max | min | replace | multiply`) and optional `mask` falloff.

| Op | Key params | Notes |
|---|---|---|
| `ridge` | polyline, height, width, sharpness, roughness, asymmetry | Mountain range or spine. Ridged noise along the line, not a smooth tube. |
| `peak` | center, height, radius, shape (`cone`/`dome`/`massif`/`volcano`) | `volcano` adds a crater. |
| `plateau` | polygon or center+radius, height, edgeSteepness, terraces | Mesas and escarpments. |
| `basin` | polygon or center+radius, depth, falloff | Lake basins, depressions. |
| `valley` | polyline, depth, width, profile (`V`/`U`) | `U` = glacial. |
| `river` | polyline, width, depth | Carves a channel **that is forced to flow downhill** (monotonic along the line) and is marked in the river mask. |
| `canyon` | polyline, depth, width, wallSteepness | Steep-walled cut. |
| `coast` | polygon or side (`N`/`S`/…), target elevation, falloff | Pushes an area below sea level: sea, bay, fjord. |
| `hills` | polygon/region, amplitude, frequency, style (`rolling`/`rugged`/`dunes`) | Noise field over an area. |
| `lowlands` | polygon/region, target elevation, flatness | Flatten toward a height: plains, marsh. |
| `escarpment` | polyline, heightDelta, side | A cliff line with high ground on one side. |
| `smooth` / `roughen` | region, strength | Also used by brushes. |
| `stroke` | brush type, points[], radius, strength | All brush input is stored as `stroke` ops. Consecutive strokes from one drag are one op. |
| `moisture` | region, delta | Biases materials: forest/swamp/desert. Paints a moisture layer, not height. |

Keep op evaluation in one module with a clean interface (`evaluate(world) → Float32Array` or GPU texture) so ops are easy to add. Write unit tests for determinism and for each op's basic shape (e.g. a `river` op never has an uphill step along its path).

---

## 5. The prompter (LLM integration)

**Flow:** the GM types a prompt → the app sends a compact *world context* + the prompt to Claude with **tool definitions for op editing** → Claude answers with tool calls → the app applies them as **one undoable transaction**, highlights changed ops and re-bakes. Show Claude's short explanation beside the result.

**Tools to expose to the model:**
- `add_op(op)`, `update_op(id, patch)`, `remove_op(id)`, `reorder_op(id, index)`
- `set_world_param(path, value)` for sea level, climate, erosion strength, base noise, …
- `query_region(hexIds | bbox)` → elevation stats per hex (lets the model look before it edits; one round-trip max per prompt)

**World context sent each prompt (keep it small, a few k tokens):**
- grid size, hex orientation, km per hex, sea level, max elevation
- the current op list (id, type, label, key params in hex terms)
- an **elevation summary**: per-hex mean/max elevation as a compact table, or a coarse 32×32 grid in metres
- optionally (toggle, on by default) a **small top-down hillshade+material image** with the hex grid and labels drawn on, so the model can *see* the map. Claude handles images well and this sharply improves placement.

**System prompt for the model** (write it in `src/llm/systemPrompt.ts`): it is a terrain designer for a TTRPG hexcrawl. It thinks in real landforms (rain shadows, rivers flowing to the sea or to basins, glacial valleys in high ranges, alluvial fans at range fronts, foothills between plains and mountains). It prefers a few well-parameterised ops over many tiny ones, labels each op descriptively, and edits existing ops when the user refines something ("make the northern ridge higher" → `update_op`, not a new ridge).

**Provider adapter.** Implement `interface LLMProvider { complete(req): Promise<ToolCallResult> }` with:
1. `AnthropicBrowserProvider`: the user pastes an Anthropic API key (stored in localStorage, with a clear warning) and the app calls the Messages API directly from the browser with the `anthropic-dangerous-direct-browser-access: true` header. Make the model configurable; default `claude-sonnet-5-5`, offer `claude-opus-5-5`.
2. `MockProvider`: deterministic canned responses for tests and for working without a key.
3. Leave a stub `ArtifactSampleProvider` (empty implementation + TODO) for later hosting as a claude.ai artifact, where the page can call Claude without a key.

Verify current Messages API / tool-use request shapes against https://docs.claude.com before writing the client. Don't rely on memory.

**Scriptable without the UI:** add `npm run prompt -- worlds/foo.json "add a volcanic peak in 1208"`, which applies a prompt to a world file headlessly (Node, using the same op code and an `ANTHROPIC_API_KEY` env var). This lets the GM, or Claude in a coding session, author terrain from a terminal. It's also the seam for an MCP server later.

---

## 6. Brushes

- Raise / Lower, Smooth, Flatten (sample on click), Ridge (drag a line → ridge), Carve (drag → valley/river, with a toggle for "make it a river"), Roughen, Local erode, Moisture paint.
- Radius, strength and falloff sliders; keyboard shortcuts (`[`/`]` radius, `Shift` invert, `Alt` sample).
- Show a brush cursor projected onto the terrain (decal ring).
- Paint on the 3D view (raycast against the heightfield) **and** on the top-down map mode.
- Strokes record into `stroke` ops (§4) so they survive re-baking and stay editable and deletable.
- While dragging, preview on the design layer only. Re-erode after release (progressive), ideally just around the dirty area.

---

## 7. Erosion and derived maps

- **Hydraulic erosion:** a GPU virtual-pipe model (Mei, Decaudin & Hu 2007, "Fast Hydraulic Erosion Simulation and Visualization on GPU") or an equivalent grid method with sediment capacity, erosion and deposition. It must produce dendritic gullies, sharp ridges and deposition fans, which is the World Machine look. A particle (droplet) method is acceptable if it hits the performance targets.
- **Thermal erosion:** talus angle → scree slopes at the base of cliffs.
- Run it in the browser, progressively over N iterations with a progress bar; pause/resume; a strength preset (`light / medium / heavy`).
- **Derived maps** (computed after erosion, kept as textures):
  - normals; slope; curvature (convex ridges vs. concave gullies)
  - **flow accumulation** → river mask (threshold) and gully darkening
  - **deposition mask** → gravel/scree/alluvium
  - **moisture**: from wind direction (rain shadow behind ranges), distance to water, flow, plus `moisture` ops
  - lakes: fill closed depressions, or only render water where the sim leaves standing water. Pick one approach and document why.

---

## 8. Renderer

Goal: the mood of `02` up close and of `03`/`04` from above. Natural surface colours, not elevation tints.

- **Terrain mesh:** heightmap sampled in the vertex shader on a grid with **LOD** (geometry clipmaps or CDLOD quadtree) so the full region and a single hex are both cheap. No cracks or popping (geomorphing).
- **Materials** (splat by rules, all procedural, no external texture downloads required; small generated textures are fine):
  - rock on steep slopes (strata/banding hint), scree/gravel from the deposition mask
  - snow by altitude + slope + aspect (more on shaded/north faces), with a soft snowline
  - grass/meadow on gentle, moist slopes; dry grass/steppe where it's dry
  - **forest** as a distinct canopy material: darker, bumpy, slightly raised look via normal perturbation, below the treeline where moisture allows. It must read as forest from high altitude like in `03`.
  - wetland/marsh on flat, very wet lowland; sand/beach near sea level; desert/badlands where it's dry
  - riverbeds and riverbanks from the river mask
- **Lighting:** directional sun (time-of-day slider), sky ambient, **terrain shadows** (heightfield ray-march shadow map, or shadow-mapped with cascades), and ambient occlusion from the heightfield.
- **Atmosphere:** height-based fog + aerial perspective (distant terrain goes blue and hazy). This is the biggest single factor in making height and distance readable. A simple analytic sky.
- **Water:** sea and lakes with depth-based colour (shallow turquoise → deep blue as in `03`), shoreline foam/fade, cheap reflections or Fresnel. Rivers rendered from the river mask (ribbons or shader-painted channels) and visible from altitude.
- **Cameras:** orbit (region overview, default) and fly (WASD + mouse, altitude-scaled speed, can't go under the terrain). "Go to hex" button: smooth flight to an oblique view over a hex.
- **Hex overlay:** drawn in the terrain shader (anti-aliased lines that follow the surface), with labels as screen-space sprites. Fades with altitude.

---

## 9. UI layout (keep it simple, dark theme)

- Left: **Ops panel** (list with toggles, drag-to-reorder, click → edit params in a form, delete).
- Bottom or right: **Prompt panel** (textarea, send, history of prompts with the explanation and a "revert this" button).
- Top toolbar: brushes, camera mode, overlays (hex grid, flow, moisture, slope debug views), erosion controls, time of day, exaggeration, save/load/export.
- Hover readout box (hex id + stats).
- Debug views are important for development: grayscale height, slope, flow, moisture, material IDs.

---

## 10. Milestones

Work in this order. Each milestone ends with screenshots in `shots/` and an update to `PROGRESS.md`.

1. **M1 Skeleton:** Vite/TS/three app, world JSON model, seeded base noise, heightmap → LOD terrain mesh, orbit camera, hex overlay, simple slope/altitude shading, fog. Headless screenshot script working (§11).
2. **M2 Op stack:** all op types from §4, ops panel, undo/redo, save/load, unit tests.
3. **M3 Erosion:** GPU hydraulic + thermal, progressive; derived maps; debug views.
4. **M4 Look:** materials, shadows, AO, aerial perspective, water, rivers. Iterate against `reference/02–04` (§11). Expect several passes; this milestone matters most to the GM.
5. **M5 Prompter:** LLM tool schema, context builder (incl. map image), provider adapter + mock, prompt panel, CLI `npm run prompt`.
6. **M6 Brushes:** all brushes, cursor, recording as `stroke` ops, local re-erosion.
7. **M7 Close-up and polish:** shader detail at low altitude, fly camera, go-to-hex, exports, single-file build, performance pass against the targets in §3.

Ship something runnable at the end of every milestone. Don't spend M1–M3 on visual polish.

---

## 11. Verifying your own work

- `npm run shots`: Playwright + headless Chromium (`--use-angle=swiftshader` / `--enable-unsafe-swiftshader`) loads a world from `worlds/` and saves PNGs from a fixed set of camera presets:
  1. `region-oblique`: whole map, ~45° (compare to `03`)
  2. `region-topdown`: orthographic map mode
  3. `range-mid`: mid-altitude over the main mountain range (compare to `04`)
  4. `valley-low`: low altitude looking up a valley toward peaks (compare to `02`)
  5. `hex-closeup`: a single hex filling the view
- After each visual change, **look at the screenshots next to the reference images** and write 2–3 honest sentences in `PROGRESS.md` about what still looks off (scale cues, colours, haze, erosion detail). SwiftShader is slow; use reduced resolution or erosion iterations for shots if needed, but say so.
- Ship 2–3 example worlds in `worlds/` that exercise the features, e.g. `alpine-valley.json` (a range with a glacial valley and a braided river onto a plain), `coastal-marches.json` (coast, fjord, forested hills, marsh), `badlands.json` (mesas, canyons, dry riverbeds).
- Unit tests (Vitest) for op determinism, hex coordinate maths (id ↔ km ↔ pixel), and river monotonicity.
- If GPU erosion can't run in headless SwiftShader at all, add a CPU (worker) fallback at a lower resolution so screenshots still show erosion. Document it.

---

## 12. Later phases (don't build, but don't block)

- **Structure hints:** sparse markers per hex (settlement, ruin, tower, cave, shrine, lair) rendered as subtle, readable 3D hints or icons. Not detailed buildings. Keep a `features: Feature[]` array in the world JSON ready for this, and keep hex ids as stable keys.
- **Player explorer:** players see an imprecise, hand-drawn-style 2D map; when they enter a hex, they see the real 3D terrain for that hex and its neighbours. Visibility is **line of sight from the party's position** (a GPU viewshed on the heightfield from eye height), not a flat RTS radius. Standing on a peak reveals a panorama; a valley floor or forest reveals little. Three states: *visible now* (full render), *seen before* (desaturated or sketched "memory" shroud), *never seen* (blank or parchment). Range is reduced by weather/haze, forest canopy and night (at night, light radius matters, tying into Shadowdark's torch rules). The player camera is tethered near the party, not a free eagle view. **v1 implication:** keep the heightfield and canopy/material masks readable at runtime (a GPU texture plus an optional CPU copy) so a viewshed pass can be added without restructuring.
- **MCP server** wrapping the same op API (`add_op`, `query_region`, …), so terrain can be prompted from any Claude client.
- **Trees as instanced impostors** in close-up views.
