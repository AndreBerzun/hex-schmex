# PROGRESS

## Status
Current milestone: **M6 Brushes** (next). M1–M5 done; M4 look still has known gaps (below).

| # | State | Notes |
|---|---|---|
| M1 Skeleton | done | CDLOD terrain, orbit camera, hex overlay + labels, `npm run shots` |
| M2 Op stack | done | all §4 op types, ops panel, undo/redo, save/load, examples, Vitest |
| M3 Erosion | done (pause/resume control still missing) | CPU stream power + GPU pipe/thermal, hydrology, debug views |
| M4 Look | first pass done, gaps open | see "What looks off" |
| M5 Prompter | done (reworked) | Claude Code + terrain CLI + live file link, no API key |
| M6 Brushes | next | |
| M7 Polish | not started | |

## Plan (BRIEF §10)
| # | Milestone | Approach |
|---|---|---|
| M1 | Skeleton | Vite + TS + three r170. World JSON model, seeded simplex noise, CPU base terrain, CDLOD quadtree terrain (instanced patches, VS height sampling, geomorphing), orbit camera, hex overlay in the terrain shader + label sprites, slope/altitude shading, fog. `npm run shots` via Playwright + SwiftShader. |
| M2 | Op stack | All §4 op types evaluated on the CPU in `src/core/ops.ts` (pure TS, no DOM, so the CLI and tests share it). Ops panel, undo/redo by world snapshots, save/load JSON, Vitest. |
| M3 | Erosion | GPU virtual-pipe hydraulic erosion (Mei et al. 2007) + thermal erosion on ping-pong float targets, progressive with a frame budget. Derived maps: CPU priority-flood lakes + flow accumulation (after GPU read-back), moisture, deposition; GPU normals, sun shadows (heightfield ray march) and AO. Debug views. |
| M4 | Look | Rule-based material splat (rock, scree, snow, grass, dry grass, forest canopy, marsh, sand, badlands, riverbed), sun + sky ambient, shadows, AO, analytic aerial perspective with height falloff, sky, depth-tinted water. Iterate against `reference/02–04`. |
| M5 | Prompter | Tool schema, context builder (op list + elevation table + map image), Anthropic browser provider, mock provider, prompt panel, `npm run prompt`. |
| M6 | Brushes | Stroke ops, cursor decal, local re-erosion. |
| M7 | Close-up/polish | Shader detail, fly camera, go-to-hex, exports, single file, perf. |

## Decisions (calls made without asking)
- **Hex ids are 1-based, `CCRR`**, `0101` is the top-left hex (Traveller convention). Flat-top: even columns are shifted down half a hex. Pointy-top: even rows are shifted right.
- **World extent** = hex grid bounds + a margin of half a hex on every side, so terrain exists past the outer hexes. The heightmap is non-square with square pixels; `designRes`/`erodedRes` refer to the longer side.
- **Coordinates:** world km, origin top-left, +x east, +y south. In three.js: X = east km, Z = south km, Y = up km (× exaggeration).
- **Op blend semantics.** Every op produces a value `s` and a weight `w`. Shape ops (ridge, peak, hills, roughen, raise strokes) default to `add`, where `s` is *relative* height. With `max`/`min`/`replace`, `s` is read as an *absolute* elevation (so `max` = "at least this tall"). Carving ops (valley, river, canyon, basin, coast, lowlands, escarpment, plateau, smooth, flatten) produce an absolute target and default to `min`/`replace`/`max` as appropriate. `multiply` scales the existing height by `1 + w·s/maxElevation`.
- **`hills` uses `wavelengthKm` instead of `frequency`**: easier for both the GM and the LLM to reason about.
- **Rivers/valleys/canyons are monotonic**: the floor is sampled along the line, lowered by `depth`, then forced non-increasing from source to mouth (the line is auto-reversed if it was drawn uphill).

## M5 prompter notes (reworked at the GM's request)
- **Decision (GM, overrides BRIEF §5):** no API key, no Anthropic SDK, no prompt box in the app. The prompter is a Claude Code session on the GM's own account, driving a terrain CLI. An earlier SDK-based version (browser provider, mock, prompt panel) was built and then removed.
- `npm run terrain -- …` (`scripts/terrain.ts`):
  - look: `context`, `map` (PNG with hex ids, `--ops` overlays), `query`, `ops`, `show`
  - edit: `add`, `update`, `remove`, `move`, `set`, `apply` (a batch as one edit), `new`, `undo` (snapshots in `maps/.history/`)
  - Every write records `meta.edits` (label + changed ops), so the next session and the browser know what happened.
- Live link: `vite-plugins/mapLink.ts` serves `maps/*.json` to the dev server and pushes file changes to the page as an HMR custom event. `src/app/mapLink.ts` applies each external write as one undoable commit, lists it in the right panel with Revert, and writes UI edits back to the file. Verified end to end in Chromium (CLI add → browser commit; UI edit → file; Revert keeps later edits).
- Procedure: `TERRAIN_AGENT.md` and the project skill `.claude/skills/terrain/SKILL.md`; CLAUDE.md points to them. The op catalogue is printed from the schema (`terrain ops`), so the docs can't drift.
- The CLI sees the op stack before erosion, evaluated on the CPU at 384 px. The browser shows the eroded result.
- No MCP server (it would need an SDK dependency; the CLI covers the same tools for Claude Code). It can be added later on top of `src/agent/tools.ts`.
- Hex ids more than one hex outside the grid are rejected by the resolver (they used to resolve silently to off-map points).

## Performance on the GM's laptop (2026-11-05)
Hardware: i5-10210U with Intel UHD (CML GT2), 1920×1080, Chromium. `npm run perf` prints the numbers below for any world; the HUD shows GPU ms per frame.

GPU ms per frame at 1280×720, alpine-valley, before → after:

| View | Before | After |
|---|---|---|
| region-oblique | 85.7 | 17.2 |
| region-topdown | 166.7 | 15.1 |
| range-mid | 90.5 | 12.9 |
| valley-low | 110.5 | 15.2 |
| hex-closeup | 109.3 | 15.6 |

In the real UI (canvas 1224×922, Chromium's default OpenGL backend): 16–21 ms in every view. Filling the whole 1920×1080 costs 23–32 ms, so §3's 60 fps holds only roughly on this GPU, and it is below the Iris Xe the brief names.

Why it was slow, in order of cost: about 45 octaves of procedural noise per pixel, triangles of 3–7 px that make the GPU shade each pixel several times, five unfiltered 32-bit float fetches per pixel for slope and curvature, the sky drawn under the terrain.

What changed:
- **Baked noise.** One 1024² tileable lookup texture with mipmaps replaces the per-pixel noise. It filters itself, and scales too small to see skip their fetch.
- **Mesh follows the viewport.** Patch grid 64 → 32 and the LOD range set from viewport height, for a target of 8 px per quad at the split distance. `MIN_RANGE_K` is 3 because below ~2.83 neighbouring patches can differ by two levels and crack.
- **Baked slope and settled height.** Slope, curvature and mean slope live in one mipmapped RGBA16F texture, the finished height in a mipmapped R32F. The mean slope keeps rock and snow on far mountains, where the slope of averaged heights would flatten them.
- **Draw on demand.** No camera or terrain change means no frame. Idle draws 0 frames, which is what lets the laptop cool down.
- **Paced GPU work.** At most one batch is in flight, checked with a fence. Worst frame gap during a bake went from ~5 s to ~0.9 s, a single hitch while the erosion shaders compile; p95 is 17–19 ms. Erosion runs smaller batches while the camera moves.
- **Sliced lighting.** Lighting shows a 512 px draft at once, then computes full resolution in 64 bands and swaps it in. Read-back is asynchronous. The simulation's ~440 MB of targets are freed after each bake.
- MSAA stays: it costs about 2 ms and the ridgelines need it.

Bake time is unchanged at about 26 s for alpine-valley: ops 1.9 s, drainage 3.5 s, GPU erosion 18–24 s, hydrology 0.7 s. The erosion iterations themselves are the bottleneck (55 ms each at 2048²).

The noise in the textures is not the old noise, so forest and meadow patches moved a little, with the same character. Rivers, shadows and shapes match.

Tooling: `npm run shots` and `npm run perf` drive headless Chromium over CDP, without Playwright. They use ANGLE on Vulkan, the only backend that gets the real GPU headless here; `--software` on shots selects SwiftShader. Shots now render at the world's full resolution.

## Bake bugs fixed (2026-11-06)
- **Half-baked map after an edit.** The drainage stage shared its status with erosion, so the frame loop stepped the previous, finished erosion run during drainage and declared it done. The real run then stopped at about 6 steps and the map said "ready" with no water. Every other edit was affected. Drainage now has its own stage.
- **Flat blue map from the scripted route.** Scripted bakes queued the whole erosion at once, about 18 s of GPU work. Three flat runs lined up with 34 `Fence expiration time out` lines in the kernel log, from those three Chromium processes and in those three minutes; clean runs logged none. The cause is inferred from that match, since the failure can't be forced on demand. Scripts now wait on the same paced route as the app. An empty readback is now a visible error and `npm run shots` stops instead of writing a flat map.
- **Map file overwritten after loading another world.** New, Open and Examples now unlink the map file first.
- `npm run check:bake` covers the first two in a real browser; it fails with the half-bake put back. No CI exists, so run it by hand after touching the bake.

## What looks off (honest, as of the last shots)
- Region oblique: forest/meadow patches read as high-contrast camouflage from above; greens are too saturated.
- Valley-low: valley floors look like a uniform lawn; the river is a soft blurry line rather than a channel.
- Badlands: flat-looking and washed out; the banding doesn't read.
- Close-ups stay soft near the ground: 95 m/px carries the shapes, and the shader detail only adds a little.
- Coastal-marches hex-closeup: tributaries read as beaded blobs instead of a continuous channel (pre-existing, same on master).
- Perf: op evaluate is ~1.3–1.9 s for the examples vs the 300 ms target.

## Deviations from the brief
- Erosion is two-stage: a CPU stream-power pass (priority-flood routing) for the large drainage network, then the GPU pipe model for gullies/fans. The pipe model alone did not form drainage at ~95 m/px.
- Basin ops mark a lake-intent mask; accidental pits are filled, so lakes appear where the GM asked for them rather than everywhere. Closed lakes in dry areas become playas.
- Past the map edge the terrain is mirrored and fades into haze instead of ending in a skirt.
- `hills` takes `wavelengthKm` instead of `frequency`.
- BRIEF §11's Playwright + SwiftShader shots were replaced by a dependency-free CDP driver on the real GPU.

## Open questions / risks
- The pipe model alone tends to look smooth at ~80–160 m/px; if gullies don't read, add a stream-power/droplet pass.
