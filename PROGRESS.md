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
