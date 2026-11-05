# PROGRESS

## Status
Current milestone: **M6 Brushes** (next). M1–M5 done; M4 look still has known gaps (below).

| # | State | Notes |
|---|---|---|
| M1 Skeleton | done | CDLOD terrain, orbit camera, hex overlay + labels, `npm run shots` |
| M2 Op stack | done | all §4 op types, ops panel, undo/redo, save/load, examples, Vitest |
| M3 Erosion | done (pause/resume control still missing) | CPU stream power + GPU pipe/thermal, hydrology, debug views |
| M4 Look | first pass done, gaps open | see "What looks off" |
| M5 Prompter | done, live API untested | tool loop, context, map image, providers, panel, CLI |
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

## M5 prompter notes
- `src/llm/`: `tools.ts` (schemas + executor on a draft world), `context.ts` (ops in hex terms, per-hex mean/max elevation and dominant-surface tables, ~2.5k tokens for 20×16), `mapImage.ts` (800 px top-down hillshade + surface colours + hex ids with a 3×5 bitmap font, pure TS so the CLI sends it too), `systemPrompt.ts` (static, op catalogue generated from `OP_DESCS`), `prompter.ts` (the tool loop), providers.
- The provider uses the official `@anthropic-ai/sdk` (browser mode = the `anthropic-dangerous-direct-browser-access` header), `client.beta.messages.create` with prompt caching on the static system prompt, `output_config.effort` (default medium, selectable) and server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Shapes were checked against the bundled Claude API docs and the SDK 1.5.0 type definitions (tsc passes).
- **Not tested against the live API**: no key was available in this session. The mock provider exercises the whole loop (tests + a browser run). First thing to try with a key: `npm run prompt -- worlds/alpine-valley.json "add a volcanic peak in 1208" --dry-run`.
- Each prompt is one fresh conversation (context + optional image + request); earlier prompts go in as a short text history, not as replayed turns. Edits apply to a draft and commit as one transaction; if the world changed while waiting, nothing is applied.
- `query_region` is limited to one call per request (BRIEF: one round-trip max). The loop stops after 6 model turns.
- In the browser the context and image use the eroded terrain; the CLI uses the CPU op stack at 384 px (no GPU in Node), and says so in the context.
- Hex ids more than one hex outside the grid are rejected by the resolver (they used to resolve silently to off-map points).

## What looks off (honest, as of the last shots)
- Region oblique: forest/meadow patches read as high-contrast camouflage from above; greens are too saturated.
- Valley-low: valley floors look like a uniform lawn; the river is a soft blurry line rather than a channel.
- Badlands: flat-looking and washed out; the banding doesn't read.
- Close-ups are blobby at shot resolution (SwiftShader shots run at eres 512–640, ~300 m/px).
- Perf: op evaluate is ~1.3–1.9 s for the examples vs the 300 ms target.

## Deviations from the brief
- Erosion is two-stage: a CPU stream-power pass (priority-flood routing) for the large drainage network, then the GPU pipe model for gullies/fans. The pipe model alone did not form drainage at ~95 m/px.
- Basin ops mark a lake-intent mask; accidental pits are filled, so lakes appear where the GM asked for them rather than everywhere. Closed lakes in dry areas become playas.
- Past the map edge the terrain is mirrored and fades into haze instead of ending in a skirt.
- `hills` takes `wavelengthKm` instead of `frequency`.

## Open questions / risks
- SwiftShader is slow: shots use reduced erosion resolution/iterations (stated on each shot run).
- The pipe model alone tends to look smooth at ~80–160 m/px; if gullies don't read, add a stream-power/droplet pass.
