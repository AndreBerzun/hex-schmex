# PROGRESS

## Status
Current focus (2026-11-11): **the eye-level ground scene**, one biome at a time against its Midjourney reference. The coral is first (painted textures, sun shadows, painterly finish), then ink shadows after Mignola, the painted downs ground, relief and ground cover near the player (see the last three sections). Earlier: the middle layer, see below and [NEXT_STEPS.md](NEXT_STEPS.md). M1–M6 are done; M4 visual gaps remain.

| # | State | Notes |
|---|---|---|
| M1 Skeleton | done | CDLOD terrain, orbit camera, hex overlay + labels, `npm run shots` |
| M2 Op stack | done | all §4 op types, ops panel, undo/redo, save/load, examples, Vitest |
| M3 Erosion | done (pause/resume control still missing) | CPU stream power + GPU pipe/thermal, hydrology, debug views |
| M4 Look | first pass done, gaps open | see "What looks off" |
| M5 Prompter | done (reworked) | Claude Code + terrain CLI + live file link, no API key |
| M6 Brushes | done (reworked, see below) | sculpt and paint layers after erosion; no local-erode, ridge or carve brushes |
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
- Region oblique: forest/meadow transitions were softened and greens muted in the material experiment below. Broad vegetation patches remain visible.
- Alpine Valley after the 10 × 10 redraw: Mirror Lake is broken into several pools around 0307, with stray pools further north, and a few salt flats remain around 0804–0904.
- Badlands: the Red Gorge floor reads as a white salt-flat band and the mesas as thin rings. Coastal Marches: the saltmarsh has a hard edge. All three were already in the 20 × 16 shots.
- Valley-low: new small-scale colour and normal detail breaks up the uniform lawn near the camera; distant flats still lack physical vegetation. The river is a soft blurry line rather than a channel.
- Badlands: flat-looking and washed out; the banding doesn't read.
- Close-ups stay soft near the ground: 95 m/px carries the shapes, and the shader detail only adds a little.
- Coastal-marches hex-closeup: tributaries read as beaded blobs instead of a continuous channel (pre-existing, same on master).
- Perf: op evaluate is ~1.3–1.9 s for the examples vs the 300 ms target.

## Deviations from the brief
- **Default map is 10 × 10 hexes instead of 20 × 16 (GM's call, 2026-11-06).** About 96 × 111 km at 6-mile hexes. Whether 6 miles is the right hex size is still open. The default resolution dropped to 640 design and 1280 eroded, so detail per kilometre stays at about 87 m/px and the erosion area drops to 36%. The drainage stage now scales with the design resolution for the same reason. The three examples were redrawn for the smaller map; map files keep the grid they were saved with.
- Erosion is two-stage: a CPU stream-power pass (priority-flood routing) for the large drainage network, then the GPU pipe model for gullies/fans. The pipe model alone did not form drainage at ~95 m/px.
- Basin ops mark a lake-intent mask; accidental pits are filled, so lakes appear where the GM asked for them rather than everywhere. Closed lakes in dry areas become playas.
- Past the map edge the terrain is mirrored and fades into haze instead of ending in a skirt.
- `hills` takes `wavelengthKm` instead of `frequency`.
- BRIEF §11's Playwright + SwiftShader shots were replaced by a dependency-free CDP driver on the real GPU.

## Open questions / risks
- The pipe model alone tends to look smooth at ~80–160 m/px; if gullies don't read, add a stream-power/droplet pass.


## Forgotten Shore spatial experiment (2026-11-07)

The GM clarified the intended product: independently controlled player views, continuous destinations selected by clicking the landscape, and a GM who moves the shared party. Hexes are an internal abstraction. Future travel should advance time, sky and sun. We are testing geography first; this change does not implement multiplayer, party movement or travel rules.

Added `worlds/forgotten-shore.json` and an editable `maps/forgotten-shore.json`. The city is 2.3 km wide on a +380 m hill with 55 m outer walls, inner districts and a central Bright Castle on a +490 m acropolis. The 1.8 km Crimson Spire stands 7.16 km WSW; a 30 km crater separates the city from a giant red tree. The northern Hollow Mountains provide the distant skyline. Six stone walkers are scattered 12.5–14.9 km from the city. These are adjustable campaign dimensions, not claims about novel canon. See `FORGOTTEN_SHORE.md`.

- Added deterministic, instanced landmark models (four draw batches; 2,559 parts), using the same sun and atmosphere as the terrain. Unknown feature kinds remain metadata. Placement and dimensions survive JSON export/import and the single-file build.
- Added an analytic tapered Spire shadow, which visibly reaches the city near 17:15 with vertical exaggeration 1. Other structures do not yet cast shadows.
- Added a manual flood preview from −260 m to +80 m, confined to the crater and shared by the visible surface and CPU picking. This is independent of the existing illustrative sun slider, not a day/night simulation.
- Added saved-view navigation, true-scale scene defaults and hidden hexes. Fixed the low-view orbit limit for landmark scenes so looking upward does not silently raise the camera. Saved views are bookmarks; navigation is not restricted to them.
- Narrow ridge half-widths now accept 0.1 km instead of a 1 km floor. Terrain authored through the CLI. Erosion is deliberately disabled for this world to preserve the city terraces and allow fast scale iteration.
- Fixed explicit `?world=` links being overridden by a previously linked map. Landmark edits/undo refresh geometry and the shadow caster; switching worlds clears the scene additions.

Validation: 37 unit tests pass; TypeScript and both production builds pass. Browser `check:shore` verifies actual low-camera height, dry city under flood, flood/picking consistency, landmark edit/undo, scene cleanup and shader compilation. The existing bake regression check is also run after this integration. Screenshots include all saved views plus flood and Spire-shadow comparisons.

Visual assessment: the city, Spire, crater and distant tree now establish readable relative scales. The high-water comparison makes the city’s safe headland clear, and the tree is a faint silhouette from the wall. The geometry is still a blockout: the circular city is overly regular, the castle lacks architectural detail, the tree canopy is faceted, and the ground remains soft at close range. The Hollow Mountains are excessively serrated compared with the reference images. This prototype prioritizes scale and sightlines; it is not the photorealistic M4 target.

Final performance check at 1280×720 on Intel UHD: 7.6–16.2 ms GPU across the saved views, about 2.3 s to prepare the un-eroded scene, and zero idle redraws. The automated orbit measured 33 drawn frames/s; GPU timing alone should not be described as a guaranteed 60 fps. Both browser check suites passed.


## Exploration interface, free flight and architecture (2026-11-07)

At the GM’s request, the default interface now shows the world across the full window with Fly, Orbit, Map, Visit, flight speed, sun and sea controls. Op stacks, erosion, authoring controls, hex readouts and GPU diagnostics are hidden. The CLI and live map link remain available to the agent; `?editor` restores the internal editor interface.

Added mouse-look free flight: click the scene for pointer capture; WASD moves relative to the view; Space ascends, Shift descends, Ctrl boosts speed 10×, and Esc releases the mouse. Base speed is selectable from 5–250 m/s. Opposing inputs cancel, combined movement is normalized, long frame deltas are capped, and input clears on pointer unlock, window blur and tab hiding. Flight maintains 2 m above the terrain/water. Buildings are visual geometry without camera collisions. Map mode releases capture and disables flight; Fly returns to flight mode.

Added facade windows, recessed doors, projecting cornices, roof seams and chimneys to city buildings; buttresses, portals, larger window bays, slit windows and cornices to the castle; and tiered galleries, lancets and satellite pinnacles to the Spire. Facade detail uses a filtered local-space shader pattern and repeated geometry remains instanced. Dimensions are preserved: ordinary city blocks are roughly 20–46 m tall; the castle’s highest roof is 284 m above its +490 m acropolis; the stone walkers are 96.75 m to the helmet and 104.4 m to the spear tip, despite their nominal 90 m parameter.

Browser flight checks pass using a trusted click and real pointer lock, real keyboard and mouse input, all movement axes, 10× boost, release behavior and map transitions. Existing 37 unit tests and shore browser checks pass. Screenshots now cover the clean exploration interface and detailed landmarks. Visual limits: the window patterns are still regular, most detail is exterior surface treatment, and the castle remains monumental fantasy architecture.

After the architecture pass, Intel UHD view timings at 1280×720 were 8.6–15.4 ms GPU, with four instanced batches and 4,893 parts. The scene still draws zero frames while idle. Both production builds pass.


## Ground-view player prototype and restored viewer tools (2026-11-07)

Restored Hexes, Labels, debug view selection and altitude/GPU statistics to the exploration interface. The GM wants viewing tools, while the agent continues to author terrain. Player mode adds drag-to-look and click-to-march over continuous terrain at 1.7 m eye height. Default campaign pace is 4 km/h with selectable 60×–1800× visual acceleration (default 600×); actual distance determines elapsed simulation time. Stop/Esc pauses, and +1 h waits. The sky and sun now cover all 24 hours with twilight and stars; optional Night tide floods at dusk and recedes at dawn. Manual sea control disables the clock link.

Movement checks slope and water in 5 m substeps and stops at deep water or a ~40° slope. It does not yet pathfind around buildings or provide collision with structures, rafts, shared party state, or a multiplayer server. Ground eye height is sampled from the near-camera terrain triangles to prevent bilinear height sampling from putting the viewpoint inside the mesh. The terrain is still coarse at street level and does not provide walkable architectural interiors.

Investigated the reported Chrome crash near water. No matching GPU reset or OOM appeared in the inspected kernel log, and Ctrl+W did not close the pointer-locked test tab. The original cause remains unconfirmed. Added a ~1.8M render-pixel budget, throttled sun-shadow recomputation during time changes, skipped unnecessary hover picking, and added a visible context-loss state and Reload scene control. A real-GPU browser stress check survived 100 flood changes at low altitude; a forced WebGL context loss showed the expected recovery control.

Validation: 40 unit tests pass, including clock rollover, day/night tide timing and triangle-surface sampling. Browser checks verify 50 m takes 45 s of world time at 4 km/h, eye height is 1.7 m, actual clicks select routes, water stops travel, day/night renders differ, and high-DPI rendering respects the pixel budget. Existing flight, shore and erosion browser checks pass. Saved screenshots cover player day and night. The daytime ground view still exposes coarse terrain; night is deliberately dark, without player torches yet.

## Lowlands and forest materials experiment (2026-11-07)

The GM selected surface rendering as the next focus, with campaign and GM features
deferred. Reviewed all four reference images and captured a fresh baseline before
editing the terrain shader. [MATERIALS.md](MATERIALS.md) contains the selected
before/after screenshots, raw timing links and remaining limitations.

- Added filtered colour and normal variation at 6 m, 0.9 m and 0.12 m wavelengths
  using the existing noise lookup. This survives the Forgotten Shore's mineral
  palette override, which previously erased ground colour detail.
- Added a locally baked, periodic 512² canopy texture: varied oval crowns, rounded
  joins, fine foliage normals and shadowed gaps. Cellular work happens once during
  startup, not in every rendered pixel. Additional texture storage is about
  1.33 MiB including mipmaps; there are no external assets or image-service calls.
- Muted vegetation colours and broadened forest transitions. Fine detail fades
  between 1–3 km AGL and before it becomes subpixel; a separate overview shader
  compiles the extra detail instructions out. Terrain heights, saved geography,
  movement and picking are unchanged.
- Added `npm run check:materials -- <label>`: 15 fixed views across three worlds,
  including actual eye-level foregrounds, with shader/WebGL checks, repeated-render
  determinism and warmed GPU timings. Selected comparison artifacts live in
  `shots/materials/`; repeat runs go to ignored `shots/_tmp/` directories.
- Browser scripts support `TP_BROWSER_OFFLINE=1` to disable background networking
  and external DNS and route non-loopback requests through an unused local proxy.
  All browser checks in this experiment used that setting and local Vite pages.

Visual assessment against references 02–04: the plains and Forgotten Shore now
show surface detail in formerly uniform foregrounds, and the overview's forest
edges are softer. The canopy has more light/shade structure but can still read as
repeating cushions; it has no tree silhouettes, trunks or physical undergrowth.
Flat ground remains geometrically smooth, marsh boundaries remain broad, and
river channels still look soft. This improves materials but remains far from the
reference images' vegetation volume and close-up richness.

Performance is a tradeoff. The fixed 1280×720, exaggeration-1 comparison measured
Alpine ground at 6.2 → 7.5 ms GPU, Alpine forest 6.8 → 8.7 ms, Coastal forest
10.0 → 12.4 ms and Forgotten Shore ground 7.6 → 11.2 ms. The separate standard
`perf` run at normal world settings measured Alpine Valley at 11.0–16.1 ms,
Coastal Marches at 9.5–16.6 ms and Forgotten Shore at 5.4–20.0 ms across their saved
views. Idle remains zero redraws. Automated orbit drew roughly 41, 39 and 30
frames/s respectively, so these GPU figures are not a guaranteed 60 fps.

Validation: all 40 unit tests pass, standard and single-file production builds
pass, the fixed material checks pass, and all standard world screenshots were
regenerated on the Intel GPU. The existing player browser suite also passes,
including real clicks, distance/time, water stops, day/night, 100 shoreline flood
changes, high-DPI pixel limits and visible graphics-context recovery. No campaign
notes or map JSON files were edited.

## Flight shortcut correction (2026-11-07)

The GM clarified that the browser window closes while pressing Ctrl with movement
keys on localhost. Ctrl was the old 10× boost modifier and Shift descended,
overlapping Ctrl+W (close tab) and Ctrl+Shift+W (close window). This is a concrete
shortcut conflict consistent with the reported symptom; recent local logs showed
no new GPU reset/OOM report or new pending Chromium crash dump.

Changed boost to **Shift** and descent to **C**, retaining WASD and Space ascent.
Updated the in-app help, README and scene guide. Ctrl/Command/Alt combinations
clear held flight input and remain reserved for browser/desktop actions; the app
does not claim it can suppress reserved close-window shortcuts.

The old flight test omitted actual modifier flags and advanced just one boosted
step without sustained rendering. It now sends real Shift flags, verifies forward
and vertical boost with both Shift keys, checks reserved modifiers clear movement,
and renders sustained Shift+W+Space at the maximum selectable speed over changing
water. Component distances are measured atomically, separate from the sustained
live rendering check. Repeats exposed an intermittent missed first key after
pointer capture; key state now clears on capture loss, so a delayed acquisition
notification cannot erase a new keydown. Repeated live checks covered about 5 km
in 103–118 rendered frames with finite camera coordinates, no WebGL error and no
context loss. The existing 40
unit tests and both production builds also pass.

Confirmed the running localhost:5173 server serves the updated material and
flight code. On the Forgotten Shore, the material change is fine ground detail
visible near the surface in daylight; forest work is visible in Alpine Valley
and Coastal Marches. The visual improvement remains modest, as documented in
MATERIALS.md.

Handoff: [NEXT_STEPS.md](NEXT_STEPS.md) records the next rendering candidates,
deferred GM features, current verification and the user's local-only network
constraint for the next conversation.

## Forgotten Shore geography (2026-11-09)

Replaced the Shore map with a new layout: seven biomes after the Shadowdark hex terrain
table, the Dark City at the map centre, erosion on. See `FORGOTTEN_SHORE.md`. The previous
city-centred trial is parked on the local branch `archive/codex-shore-wip`.

- **Biomes follow the landforms.** The ashen palette no longer overrides every material
  with one dust/coral mix: each existing rule gets a Shore colour (forest → coral, desert →
  ash, marsh → silt mire, grassland → black earth, rock and scree → mineral grey), plus a
  tidal-flats rule for gentle ground below the night tide. The hover readout and the
  terrain CLI name surfaces in Shore terms.
- **Tide.** A tide without a centre covers the whole region; the circular basin still works.
- **Small plateaus and flats no longer vanish.** Plateau and lowlands edges carried at
  least 1.5–1.8 km of random wobble whatever the region size, so sub-kilometre footings
  (castle hill, Spire islet) could shift or disappear depending on where they sat. The
  wobble is now capped at a fifth of the region's half-size. Badlands `valley-low` moved
  slightly (part of a lake became a salt flat); the other examples are unchanged to the eye.
- **Size.** 14 × 12 hexes of 6 miles, 1536² eroded (~78 m). A full bake takes ~30 s on
  the Intel UHD; there is no bake cache, so every load pays it.

What looks off: from above and from the castle the regions read clearly; at eye level the
lowlands are open surfaces with nothing standing on them, coral is a red ground with canopy
bumps, the ash is pale and soft. Mountains lack erosion detail. Middle-layer objects are
the next step (`NEXT_STEPS.md`).

Validation: 44 unit tests, both builds, `check:shore`, `check:player`, `check:flight`,
`check:bake`, `check:materials` pass. GPU 4–18 ms across 20 Shore views at 1280×720,
regional orbit 30 drawn frames/s, zero idle frames.

## A more dramatic Shore (2026-11-09)

Built from the handover plan in the same session that wrote it, with two changes from the
GM: no island in the crater (its floor is where the Dark Sea rises at night), and the
Hollow Mountains continue beyond the map instead of fitting on it.

- **Hollow Mountains.** One wall whose crest line runs along the north edge and 30 km past
  both corners, so it does not taper on the map; the Hollow Crown straddles the edge.
  Op-stack summits 10–14 km (baked peak 13.75 km, `terrain.maxElevationM` 15000), the
  south face spans rows 01–02, four U-shaped glacial troughs end in small lakes at its
  foot. The Hollow Spur is ~5 km, the Hollow River valley a 380 m gorge. The plan's
  9000 m / sharpness 0.75 gave only 4–7 km crests (the ridge's crest roughness and peaky
  profile eat most of the height); the wall now uses height 13000, sharpness 0.45,
  roughness 0.5, half-width 30 km. Outside the map the mirrored surround carries the
  range on into the haze; that is the teaser for the region beyond.
- **Crater op** (`crater`): absolute rim and floor, terraced inner wall, outer flank,
  optional central peak and breach. The breach now carves a spillway that keeps falling
  through the outer flank instead of rising back to the surrounding ground. The Dark Sea
  crater is 44 km (rim radius 22 km, not the plan's 25 km) and sits ~9 km inside the
  east and south edges: at 3.5 km the mirrored surround drew a full second crater beside
  it. A faint twin remains in the haze. Rim 1.8–2.2 km, floor −1.2 km, a basin op makes
  the Deep (−2.6 km) at the centre. Breach at 235° toward the tidal flats, sill 15 m.
- **Rain shadow.** The 2 km rim dried the coral lowlands and turned the tableland pools
  into salt pans (moisture drops behind anything higher upwind, and the wind is from the
  south). Moisture ops on the coral (+0.5), the tablelands and the crater's lee restore
  the lore. The high valley between the Spur and the wall is ash-dusted for the same
  reason; kept.
- **Towers and sinkholes** (`hills` styles): flat-topped stacks or flat-floored pits with
  walls ~1.5 design samples wide and a low debris skirt, evaluated over the 3×3 nearest
  cell points so no stack is cut at a cell boundary. Placed in the mires (towers 300 m,
  pools 120 m), on the tidal flats (stacks 220 m), in the coral (massifs 260 m, sinkholes
  150 m) and as ash buttes (380 m). They read as steep mesas and buttes, not pinnacles:
  at 85 m samples a 300 m tower is 3–4 samples wide.
- **Steeper erosion talus** on the Shore map (34° → 40°), so stacks, crests and the crater
  wall keep more of their edge.
- **Rock banding.** The rock colour bands and the erosion hardness benches followed
  absolute height, so on 10 km faces they drew evenly spaced contour lines. Both now
  dip ~2° and are warped by regional noise; the colour bands mix three periods at lower
  contrast. The example worlds look unchanged to the eye.
- **Views.** `crater-overlook` stands on the north-west rim (40 m up, so it sees over the
  lip after erosion), `castle-to-crater` aims at the rim, the mountain views look higher;
  new `crater-aerial` and `mire-towers`.

Sightlines from the castle are now a test: Spire visible, Soul Tree crown just above the
Ash Ridges, crater water hidden. Two colossi are hidden by terrain (north and ash); the
southern-road and Spur colossi show 70–80 m of their 200 m (before: three of four showed
100–170 m).

What looks off: the castle-to-mountains view reads like a high range 60 km away, which it
is; it does not loom. Mountain faces are smooth. Towers are mesas. The crater rim from
the castle is a low pale wall in the haze.

Performance: bake 30–36 s across runs (was ~24 s): op evaluation 3.4 → 5.5–7 s (five more area ops and
the crater; each polygon op tests every pixel against its polygon), drainage 2.6 → 4.5 s
(more relief and closed basins for the priority flood; 4.5–6 s). GPU 7–27 ms across 22 Shore views
at 1280×720 (worst `hex-closeup`, crater views 19–22 ms), orbit 30 drawn frames/s, zero
idle frames.

Validation: 53 unit tests, both builds, `check:shore`, `check:bake`, `check:materials`,
`check:player`, `check:flight` pass.

Before/after pairs from identical cameras (master vs this branch): `shots/before-after/`.

## Direct edit layers (2026-11-10)

At the GM's request: after the generator, edits should be direct. Shaping by op parameters and a full ~30 s re-erosion per change made dramatic scenes slow and indirect, and biomes could only be steered through moisture and height.

The map now has three layers:
- **Foundation:** the op stack plus erosion, as before. Once baked it is frozen under a fingerprint of everything that feeds it (seed, grid, terrain, base, ops, erosion). The browser writes it to `maps/.bake/<map>.bin` (ignored by git); reopening a linked map loads it instead of baking (about 2 s instead of 30).
- **Sculpt** (`world.sculpt`): raise, lower, flatten and smooth on the eroded heights, in order, on the CPU. Then water routing re-runs (under a second); erosion does not.
- **Paint** (`world.paint`): a raster with one channel per biome plus coverage; the terrain shader overrides each material weight by it, and the hex readouts and CLI use the same override. Paint edges are frayed with noise so they don't read as geometry.

The editor's left panel has Raise, Lower, Flatten, Smooth and Paint brushes with a cursor ring and live preview; each stroke is one undo step stored in the same lists. While a brush is held, left-drag paints and right-drag orbits.

The CLI has `sculpt`, `paint` and `layers`; `update`, `remove` and `show` take edit ids. `context`, `map` and `query` read the browser's bake when it is current, so the terminal finally sees the eroded ground with rivers and lakes. The surface rules now live in one classifier shared by the app and the CLI.

Checks: `npm run check:layers` (a first open erodes and saves the bake; sculpt, a CLI paint write and a real mouse stroke skip erosion; the stroke doesn't orbit; undo; reopening loads the bake and keeps the layers), 11 unit tests in `tests/layers.test.ts`, `check:bake` and `check:shore` still pass. Painting the whole map costs no measurable GPU time on the UHD (within the ±3 ms run-to-run noise).

Deviations from the brief:
- Brush strokes are not `stroke` ops in the op stack; they apply after erosion, so they are instant and stay where they are put. The trade-off: a sculpted area keeps the eroded texture it had but gets no new erosion detail.
- No local-erode, ridge, carve or roughen brushes yet. Use ops for landforms that should look weathered.

What looks off:
- Paint shaped like hexes with a short falloff still reads as a pasted hexagon in strong colour contrast (desert on green). Brush paths or 2–3 km of falloff look natural.
- A large raise across a valley dams it, and the water pools behind it. That is physically right but easy to do by accident.
- Once in four runs of `check:layers`, a terminal write right after the browser's own save to the same map file did not reach the page. That is the live file link's watcher, not the layers; not fixed here.


## Middle layer, first pass (2026-11-10)

From the handover in `NEXT_STEPS.md`. The Shore had nothing between the ground texture and
the landforms; at eye level every biome was an empty surface.

**What stands where.** 30 procedural object kinds, all generated locally, each in three
detail levels built from the same skeleton so the silhouette holds when it switches:

- crimson coral: coral trees with wide crowns in stands, fan corals, brain mounds, knee-high
  coral clumps, a labyrinth of coral walls 5–12 m high
- tidal flats: wreck hulls, mossy and barnacled boulders, paving slabs along channels, rows
  of rotten posts
- silt mire: golden reed islands, tube-sponge chimneys, dead trunks, ribs in the silt
- tidal flats and mire (the mudflats kit): horn spires up to 100 m, leaning towers
- shallow water: coral plateaus; off steep shores, sea stacks and arches
- black earth: tors on crests, golden grass, boulders at slope feet, a lone dead coral tree, bones
- ash: half-buried spiral shells, bleached coral skeletons, giant skulls, buttes
- rock: boulder fields and fallen blocks at the foot of faces, rock needles
- anywhere, rare: half-collapsed towers and ruined walls

**Placement reads the ground, never coordinates.** Each cell reads a small lattice of spots
for biome (the same classifier as the shader and the CLI), slope, crests, the foot of steep
faces, channel banks, water depth and steep shores. Seeded noise fields make stands and
clearings. A biome's share of the surrounding ~0.9 km thins objects over the last few
hundred metres of a biome. Coral walls follow contour lines of one global field, so the
maze continues across cells and has passages and blind alleys; gaps in a second field open
it up. Objects keep clear of the city, the Spire's footing, the Soul Tree and the colossi.
Cells are seeded by world seed and cell; generation order, camera and quality do not change
them. Nothing is stored in the map file; ground edits (sculpt, paint) re-place them.

**Streaming.** Three tiers: near (80 m cells, up to 420 m), mid (320 m cells, up to 3.2 km),
far (1.28 km cells, up to 20 km). Each object's reach also depends on its projected size, so
small things stop at 6 px instead of speckling the distance, and big ones (spires, towers,
buttes, sea stacks, plateaus) stay as simplified shapes to 20 km. Objects fade in with a
screen-door dither instead of popping. One instanced draw per kind, variant and detail
level; frustum culling per cell and per object; a cell cache with fixed limits. Generation
gets 4 ms per frame; scripted shots generate everything at once. Objects use the terrain's
sun, sky light, heightfield shadows, Spire shadow and haze; the tide floods them through the
water surface. Off above ~250 m / 3 km / 15 km above ground per tier.

**Collision.** Coral walls, boulders, tors, mounds, wrecks, sponges and the large objects
block the march. Blockers are rasterised into a 2 m mask per cell, and the march plans an A*
route round them in legs of up to 0.9 km, re-planning when it runs into something.

**Landmark tier.** New feature kind `leviathan-skeleton` (Bone Ridge): vertebral spine raised
over arched ribs, skull and tail, sized by half-length and rib height. Not placed; the GM
chooses where. The terrain CLI gained `features` and `feature` (add, change, remove by id,
`at` takes hex ids like ops).

**Tools.** `npm run check:scenery` (real browser: identical redraw after a cache rebuild,
the scenery draws in coral, a march routes round a coral wall and arrives, shader and GL
health, zero idle redraws). `npm run gallery` renders every kind at a forced detail level.
`npm run probe:scenery` prints the ground reading and object counts per saved view.
`tests/scenery.test.ts`: determinism, kits stay in their biome, edge thinning, water rules,
landmark clearance, wall-crossing route.

**Performance** (Intel UHD, 1280×720, GPU ms per frame, scenery off → on):

| View | Off | On | Triangles on |
|---|---:|---:|---:|
| coral-to-spire | 9.5 | 14.6 | 351k |
| coral-lowlands | 11.7 | 11.6 | 309k |
| mire-towers | 12.2 | 14.1 | 297k |
| city-approach | 12.2 | 13.4 | 279k |
| ash-sea | 11.1 | 17.6 | 224k |
| silt-mires | 12.1 | 10.3 | 245k |
| tidal-flats | 12.7 | 12.5 | 215k |
| black-downs | 11.6 | 14.6 | 237k |
| castle-to-spire | 15.7 | 11.7 | 210k |
| hex-closeup | 19.0 | 19.9 | 221k |

Every Shore view stays at or under ~20 ms; orbit 30 drawn frames/s either way; zero idle
frames. Run-to-run noise is about ±3 ms (several views are faster "on"). The densest coral
view adds ~135k triangles and ~5 ms. Scenery updates take about 1 ms when the camera moves.

**Perf harness fix.** `npm run perf` timed each view right after `setView` without a frame,
so the near clip plane stayed where the previous view left it (kilometres at the region
view) and close objects were clipped from the measurement. It now settles each view with
two frames first. This also changes the terrain-only numbers slightly; older tables were
measured the old way.

**What looks off (honest).**
- The look: flat-coloured low-poly shapes, saturated, on a near-black ashen ground. Next to
  the references (bright sand, painted light) the scenes read as toy pieces on asphalt. The
  silhouettes are right for most kinds; colour, ground palette and style are the look pass.
- Coral: trees and stands read; crowns are faceted lumps, not finger clusters. The walls
  read as walls and the maze works, but they are smooth red sheets with spikes on top.
- Silt mire: reed islands are flat golden patches; tube sponges read as posts at a distance.
- Ash and downs: sparse by design, but at mid distance only the larger pieces register;
  buttes are plain stepped mesas.
- Coral plateaus, sea stacks and arches barely appear: the current map has almost no shallow
  water by a steep shore. They wait for the new geography's crater shallows and west cliffs.
- Objects cast no shadows on the ground; contact with the ground is only a darker base.
- The leviathan has no collision yet.

**Checks.** 72 unit tests, both builds, `check:scenery`, `check:shore`, `check:player`,
`check:flight`, `check:bake` pass. `check:layers` fails at "a paint edit from the terminal
shows up live" (the browser never sees the terminal's write). Unchanged master fails at the
same step in fresh worktrees, inside and outside `.claude/`, so this change did not cause
it; the live file link's watcher misses the write in a fresh worktree (symlinked
`node_modules`, or the timing noted under "Direct edit layers"). Not investigated further.

## 2026-11-11 — FPS comparison baseline (plan step 1)

Added `npm run check:fps-baseline`, a fixed 400 m downs route with five eye-level
views and an approach view, raw cold/warm traversal records and retained screenshots.
See `FPS_BASELINE.md` for reproduction, measured costs and scope limits. This uses
the merged middle-layer implementation on master; no product rendering changed.

Both traversals arrived, WebGL error was zero and `npm run build` passed. Cold
path planning took 61.8 ms and the worst cold RAF gap was 116.6 ms; warm replay
worst gap was 16.8 ms. The controlled loop freezes the campaign clock and bypasses
the normal app scheduler, so these are not full-app FPS claims. The route stays
in dry black earth rather than crossing the optional coral edge. Visually it
remains sparse, with broad smooth ground, isolated props and apparent hovering
objects in the midpoint capture. Step 2 will compose a walk; no fixes were made here.

## 2026-11-11 — FPS step 2: authored downs walk

Opt-in downs-walk prototype composes the baseline route with sixteen existing-kit
objects: an approach tor, staggered shoulders, central occluder/western passage and
a ruined-tower reveal. Scenery is replaced only within the local stage; normal
world files and procedural rules are unchanged. Authored supports sample rendered
terrain triangles, fixing a mismatch noticed during visual review.

See FPS_COMPOSITION.md for launch/reproduction instructions and matching screenshots.
Cold and warm browser traversals arrived. Build, existing 72 tests, two new routing/
isolation tests, and the standard perf harness passed. Final route measurements
and GL health are retained in shots/fps-composition/results.json.

Visual assessment: concealment and reveal now read, but stacked faceted tors and a
dark tower still look like blockout props on smooth ground. The painted reference's
integrated banks, material transitions and vegetation remain absent; far LOD loses
rock silhouette detail. This is a spatial prototype ready for review, not a finished
biome or final style. Step 3 is deliberately not started.

## 2026-11-11 — FPS step 3: detail ground for the downs

The downs get their own ground detail, after reading Tectonic's terrain source (see
the revision section in `FPS_IMPROVEMENT_PLAN.md`): rolling hills (230 m / 95 m), warped
`abs()` gullies (38 m), knolls up to 11 m with lumpy crests, and 14 m bumps. One function
in `src/core/detail.ts`, written once for the GPU and once for walking, placement and
picking; a test checks that its slope matches its height. Strength comes from a 250 m map
(downs 1, rock 0.8, ash 0.6) times a 2.4 km ruggedness noise, and is zero with a margin
around water, tidal flats, mire, coral and placed features, so shores and tides are as
before.

The terrain mesh gains finer levels down to ~5.3 m quads, built only over the 2.7 km
tiles that have detail. Fine tiles take their base shape from the coarse triangles and
add the detail, so they meet coarse tiles without cracks, and the walker stands on the
same triangles (`standHeightAt`). Ground cover follows the detail: rock on knoll crests
and steep knoll sides, rubble aprons, darker pockets in hollows. Scenery reads the
detailed ground, so tors land on knoll crests by themselves. Scenery objects got a fill
light so their shaded sides are no longer near-black.

Tried and dropped: terraced knolls (slab faces narrower than the mesh snapped to the grid
and looked like panels) and shorter fine-mesh ranges (neighbours more than one level
apart crack; the minimum range of 3 exists for that reason).

Measured once at the end, interleaved with a clean checkout of `00a670a`, same session,
route from step 1: GPU median 8.6 → 11.4 ms, p95 ~11–15 → 16–17 ms; frame gap p95 stays
16.8 ms; warm worst gaps 33–50 ms (were 16.8); cold route planning ~50 → ~115 ms (scenery
cells sample the detailed ground). Captures in `shots/fps-detail/`. Checks: 78 unit
tests, build, `check:player`, `check:shore` (its dry-downs assertion now compares against
the detailed ground), `check:scenery`, `npm run shots`.

Looks off: knolls are similar in size and shape and read as "hummocks" from above; rock
on crests is a colour change, not a form; at noon the relief is faint; objects 150 m+
away can float or sink up to ~1–2 m because the far mesh drops the finest detail bands;
knolls are walkable, not blockers; rebuilding the detail map takes ~220 ms after each
paint edit.

## 2026-11-11 — FPS step 4: ground cover and objects from the detail

One reading of the ground, written once for the GPU and once for placement
(`src/core/detail.ts`): rock where a knoll crest rises, gravel on the lower knoll flanks,
hollows, and golden grass patches by noise threshold. The GPU evaluates it per vertex (about
every 5 m near the player, no per-pixel noise), the fragment shader only breaks up the edges.
Placement evaluates it at each object's own spot (the cell probes are up to 64 m apart).

In the Shore palette the downs are now dark soil with golden grass in patches, olive in
hollows, light gravel on knoll flanks and slate rock on crests. Soil and grass belong to the
grassland everywhere; rock, gravel and hollows come only from the detail relief. Rounded
outcrop boulders, squashed, stretched along the contour and sunk, sit on rock cover;
boulders, fallen blocks and stones moved to the gravel; tussocks to the grass; tors, bones
and coral clumps are rare in the downs. Knolls vary by a 600 m noise: 7–16 m tall, broad
clusters in some stretches, calm ground in others. The regional cliff-rock and scree rules
now use the regional slope only, so knoll flanks no longer paint as cliffs.

Comparison: `npm run shots:biomes` captures one fixed eye-level spot per biome; iterations in
`shots/biomes/` (`00-before` to `07-final`, `compare-00-before-vs-07-final.jpg`). Route views
from step 1 in `shots/fps-ground-cover/`.

Found on the way and fixed first (hex-schmex#9): the GPU stretched the eroded height grid to the
map width while the CPU read it at true cell positions, so the drawn ground sat up to 4.6 m
above the walker on eastern slopes (the tablelands view was underground). Now within 2 cm.

Measured once at the end, interleaved with a clean copy of `101e77e`, route from step 1:
GPU median 10.9 → 12.0 ms, p95 ~16 → 17–18.6 ms, views +0.8 to +1.2 ms; frame gap p95 stays
16.8 ms (one cold run 33 ms); warm worst gap 16.8 → 33.4 ms; cold route planning ~110 →
~148 ms (cover per placement candidate). Triangles unchanged, visible objects +15–30%.
Checks: 81 unit tests (cover and placement tests added), build, `check:player`,
`check:shore`, `check:scenery`, `npm run shots`.

Looks off: gravel patches on distant knolls still show straight edges where the mesh is coarse;
grass along gullies can stripe far slopes; outcrop boulders carry the boulder kit's yellow-green
lichen tops; the ash gained a small grassy mound at its edge; the lowest mountain slopes get turf
patches; up close the ground is soft, not textured like the references.


## 2026-11-11 — Coral ground scene: painted textures, sun shadows, painterly finish

Change of approach after the GM's review of steps 1–4: seven iterations had moved one biome
of seven. Instead of one ingredient per step, the coral now gets every eye-level ingredient at
once and is judged against `reference/midjourney/coral_trees_3_and_views.png`.

- Painted ground textures from Midjourney (`src/render/textures/`, 1024², sand, coral turf,
  coral rock). Coral ground is pale sand with turf patches by noise and turf brightness, rock
  patches here and there. Texture coordinates are anchored to a 1 km grid around the camera
  (exact near the player), three scales with the larger ones taking over with distance, only
  the textures a pixel shows are read. The overview material uses their mean colours.
- Objects take the same textures (triplanar, turf on red parts, rock elsewhere) as a tone on
  their own colour; coral tree crowns are smooth-shaded.
- Sun shadow map for objects within 160 m of the player (2048², 4 taps), on the ground and on
  other objects, below 400 m above ground.
- Deeper blue sky with lit cumulus; the haze picks up the bluer tone.
- Painterly pass below 1.5 km above ground: Kuwahara filter at half resolution, 30% of the full
  image blended back, bluish shadows and warm highlights, ink lines on depth jumps up to 3 km.
  The scene is drawn without multisampling for it.

Comparison: `shots/biomes/compare-07-final-vs-08-coral-scene.jpg` (all seven spots) and
`compare-coral-00-before-vs-coral-08-scene.jpg` (three coral views from
`scripts/coral-spots.json`, `npm run shots:biomes -- --spots scripts/coral-spots.json <label>`).

Measured once at the end, 1920×1080 headless on the real GPU, coral spots, interleaved per
spot: master `2071e93` 25.3 ms GPU median; this branch 30.8 ms with everything on (paint pass
about free, shadows about +2 ms). Before the fetch guards it was 45 ms without the paint pass:
the coral texture lookups ran for every terrain pixel on the map.
Checks: 81 unit tests, build, `build:single` (2.2 MB with textures), `check:scenery`,
`check:player`, `check:shore`.

Looks off: the ground is flat (no dunes, no foreground stones or shells); the coral turf is a
flat carpet at your feet, with no clumps that stand up; trees are rounded umbrellas, not the
gnarled trees of the reference; the purple fan coral carries a blotchy rock tone; the other six
biomes only got the sky and the painterly finish.


## 2026-11-11 — Ink shadows after Mignola, painted downs ground

Where the gain came from (ablation on the three coral views, flat mean colours instead of the
textures, paint pass and shadows off one at a time): about half from the new ground layout and
sky, half from the painted textures; the painterly pass and the object shadows changed little.
So the textures stay the main lever per biome.

- Ink shadows, after the GM's Mike Mignola / Darkest Dungeon reference: in the eye-level view
  the sun term is flattened (lit areas nearly flat colour) and terrain and objects write an ink
  amount into the alpha channel: shadowed or turned away from the sun, with ragged edges from
  world-anchored noise so they stay put when walking. The composite turns it into near-black
  with a hint of the local colour, a short diagonal hatch where light turns to shadow and a
  cross-hatch next to the black. Fades out between 1.2 and 5 km. Hatching is in screen space,
  so it swims slightly while moving. A trial that turned the darkest pixels black was dropped:
  it blacked out the mire water.
- Ground textures moved into one texture array (one sampler for all layers; separate textures
  would exceed WebGL2's guaranteed 16 per shader once a second biome came in).
- Downs and tablelands: golden grass, packed earth and pale limestone from Midjourney 8.2 replace
  the flat grass, earth, pebble and slab colours, scaled to the old brightness so the balance
  holds; the earth is half desaturated to stay near the ashen palette.
- `npm run shots:biomes` takes `TP_TIME=16.5` for an afternoon set; the ink look needs a lower
  sun to show big shadow shapes.

Comparison: `shots/biomes/compare-08-coral-scene-vs-10-downs-paint-vs-10-downs-paint-16.5.jpg`
and `compare-coral-08-scene-vs-coral-10-ink-vs-coral-10-ink-16.5.jpg`.

Measured once, 1920×1080, GPU median, against `230904a`: downs 23.0 → 26.6 ms, tablelands
24.2 → 28.0 ms (the grass textures, about +3 ms), coral 36.5 → 37.1 ms; the ink style alone
about +0.5 ms. Checks: 81 unit tests, build, `build:single` (3.5 MB), `check:scenery`,
`check:player`, `check:shore`.

Looks off: at noon there is little black on the ground, the look depends on the time of day;
the painted grass reads as fine grain only, golden on golden at a grazing angle, without tufts
standing up; backlit objects become full silhouettes with no rim of colour; hatching swims.


## 2026-11-11 — Near-ground scene: relief and ground cover; hatching dropped

The GM found the cross-hatching read as glitches; shadows are now solid ink shapes only.

- Relief near the player in every biome: the terrain refines to 1 m quads near the camera
  everywhere (before: 6 m in the downs only, about 60 m elsewhere, which is why the coral floor
  was flat). A relief layer of 12 m swells (0.85 m) and 4 m hummocks (0.3 m) displaces the mesh,
  off under water, with a CPU twin in the ground height so the player and objects stand on it. It
  changes lighting only: land classification (marsh, tidal flats) ignores it; a first version
  fed it into the slope and erased the mire water and the tidal flats.
- Terrain vertices are computed from an exact integer grid, so tiles of different levels share
  bit-identical corners; without it the new level boundaries showed pinholes that the ink outline
  turned into dotted rings.
- Ground cover: the terrain material renders a 64 m top-down cover map around the player (ground
  height, coral turf, grass, stone, wet ground) from the same rules that paint the ground, so
  cover matches the drawn patches exactly. Two instance rings follow the player (0.32 m cells to
  11 m, 0.75 m cells to 28 m), placed by an integer hash of the world cell: coral sprigs on turf,
  golden grass tufts on the downs grass, pebbles on stony ground. Their colour is the blurred
  ground painting under them; blades are lit like the ground, so only cast shadows ink them. The
  terrain morph now follows the player camera in every pass (`uMorphEye`).

Comparison: `shots/biomes/compare-10-downs-paint-vs-12-cover-vs-12-cover-16.5.jpg`,
`compare-coral-10-ink-vs-coral-12-cover-vs-coral-12-cover-16.5.jpg`.

Measured once, 1920×1080 GPU median, noisy (±5 ms between runs): downs 37.3 ms, tablelands
39.5, coral 48.5, mire 35.8; the cover is about 3 ms of that, the finer ground mesh about 8–10 ms
over `e547db1` (249 terrain tiles instead of 191). A first cut cost 5–11 ms for the cover; the
pebble mesh, its grid and the cover map drawing every tile were the cause. Checks: 81 unit tests,
build, `build:single`, `check:scenery`, `check:player`, `check:shore`.

Looks off: the finer mesh is the next performance target (the intermediate levels in biomes
without the detail layer add tiles that carry nothing); grass in shadow patches stays lit;
pebbles read as pale specks; sand carries no shells yet; the remaining biomes (mountains, tidal,
ash, mire) have no textures of their own.

### Next session (handoff, 2026-11-11)

State: hex-schmex#11 open on `feat/coral-ground-scene` (worktree
`.claude/worktrees/coral-ground-scene`), not merged; the GM has not said "merge" yet.
`npm run check:layers` has not run on the last commit (the GM stopped it mid-run).

1. Textures for the four remaining biomes are in `~/Downloads` (23 files, Midjourney 8.2, file
   names start `Lianto_hand-painted_tileable_texture_of_`): mountains (`grey_granite_rock_fac`,
   `loose_grey_scree_and_`, `old_wind-packed_snow_`), tidal (`wet_grey-brown_tidal_`,
   `dark_tidal_mud_with_s`, `strands_of_dark_seawe`), ash (`pale_grey_volcanic_as`,
   `cracked_grey_cinder_c`, `charred_black_rock_wi`), mire (`dark_wet_peat_with_mo`,
   `a_dense_reed_bed_seen`, `murky_shallow_bog_wat`). Pick one per prompt after a 2×2 tiling
   check (`convert f -resize 256x256 \( +clone \) +append \( +clone \) -append`), save as
   1024² JPEG q88 to `src/render/textures/<biome>-<what>.jpg`, add a layer in
   `groundTextures.ts`, and replace that biome's flat colours in `terrainShader.ts` the way the
   downs did: texture × (old colour luminance ÷ texture mean luminance), means from
   `convert f -colorspace RGB -resize 1x1! -format '%[fx:r] %[fx:g] %[fx:b]' info:`.
   One biome end to end, judged against the fixed spots, noon and `TP_TIME=16.5`.
2. Ground cover per biome after its textures: shells on sand and tidal flats, reeds in the mire,
   scree stones in the mountains (new kinds in `groundCover.ts`, weights from the cover map).
3. Performance: the 1 m ground mesh near the player costs about 8–10 ms (249 tiles vs 191); in
   biomes without the detail layer the intermediate levels carry nothing. Measure once per step
   with an interleaved on/off GPU timer run (`app.timer.poll()`, 1920×1080, real GPU); single
   runs drift ±5 ms.

Tools: `npm run shots:biomes -- [--spots scripts/coral-spots.json] <label>`, `-- --compare a,b`;
`TP_TIME=<hour>` sets the time of day, `TP_SETUP='<js on a>'` runs setup code (e.g. switch
`a.inkOn`, `a.coverOn`, `a.paintOn`, `a.sunShadowOn` off for an ablation).
