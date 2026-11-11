# FPS view improvement: incremental handoff

Written 2026-11-11. This is a plan, not authorization to implement all phases at once.
Implement one numbered step per task; preserve a runnable result after each step.

## Goal and working diagnosis

Make walking through the Forgotten Shore interesting and visually coherent on the
existing Intel UHD machine. Preserve the regional terrain generator and brush tools.
The main gaps are local ground shape, relationships between placed objects, and a
shared visual language between terrain and scenery. More random clutter is not the goal.

The coral is the strongest starting reference because connected walls and stands
create passages, concealment and reveals. Other biomes need their own spatial patterns,
not copies of coral and not uniformly higher object density.

## Starting state: verify before editing

The first middle-layer pass is on master via PR #7 (merge commit `3e80f0f`).
It contains 30 object kinds, deterministic placement, streaming, three scenery
geometry LODs, and collision. The original branch `feat/middle-layer` remains
checked out at `.claude/worktrees/middle-layer` at commit `45462ac`.

Run `git status --short` and `git worktree list` before editing. Use master with
PR #7 as the base for future work. The `archive/codex-shore-wip` branch holds the
older rejected experiment. The local `maps/compact-650m.json` and
`reference/midjourney/` files are outside this handoff's scope.

Read the working checkout's `NEXT_STEPS.md`, `PROGRESS.md`, `FORGOTTEN_SHORE.md`,
`MATERIALS.md` and any applicable agent instructions. This plan supersedes the old
suggestion that style can be postponed entirely to a final screen pass. Keep the
proposed regional geography change as a separate project.

Useful code (paths relative to the middle-layer checkout):
- `src/core/scenery/place.ts`: placement rules, shared noise fields, connected coral walls.
- `src/core/scenery/ground.ts`: environmental classification and terrain sampling.
- `src/core/scenery/kit.ts`: object metadata and streaming tiers.
- `src/core/scenery/store.ts`: cell cache.
- `src/core/scenery/route.ts`: collision/routing.
- `src/render/scenery/index.ts`: instancing, projected-size LOD/culling, shading.
- `src/render/scenery/kit.ts`, `mesh.ts`: procedural geometry.
- `src/render/terrain.ts`, `terrainShader.ts`: regional terrain LOD and materials.

## 1. Establish a repeatable comparison

Task: Save a 300–500 m route in the black downs, preferably approaching a coral edge.
Choose a real location after inspecting the terrain; do not assume one coordinate.
Save 4–6 eye-level cameras, a distant approach view, seed, noon lighting, water level,
resolution and travel speed. Capture the current scene before changing it.

Record baseline GPU time and moving-frame median/p95/worst gaps, scenery update cost,
triangle/instance counts and draw calls where the harness exposes them. Separate
cold cell generation from warm traversal. Use the same machine and settings throughout.
Existing reports are historical measurements, not fresh verification.

Deliverable: a short baseline report, reproducible route/bookmarks and screenshots.
Done when another model can reproduce the comparison without choosing new views.

## 2. Compose one convincing walk using simple geometry

Task: Build a deliberately arranged prototype along that route, using existing kits
where possible. Include open ground, a visible outcrop, a partly hidden passage and a
reveal into a distinct space. Use a small number of large shapes before adding debris.
Keep this authored prototype isolated from world-wide procedural rules.

Deliverable: one runnable route plus matching baseline/comparison views.
Done when walking changes visibility, the passage is traversable, and the outcrop
serves as a recognizable destination from the approach. Empty areas are intentional.
Do not claim visual success from object counts or automated tests alone.

Review checkpoint: show the user the route and fixed comparisons before generalizing
it. If the arrangement fails, revise it rather than increasing clutter everywhere.

## Revision 2026-11-11: what Tectonic and Minecraft do differently

The GM reviewed the authored walk: more interesting, but one hand-placed walk cannot
show what a world of them would look like. The GM had asked several times for a look
at Minecraft's and Tectonic's terrain source; this revision acts on it. Tectonic was
read at `~/development/minecraft/source/tectonic` (3.0.25, data pack JSON under
`src/common/main/resources/resourcepacks/tectonic/data`). Vanilla Minecraft source is
not public; Tectonic replaces the vanilla terrain functions, so its files are the
relevant part.

- **The ground itself carries the detail.** Minecraft evaluates its terrain function
  every 4 m horizontally and interpolates to 1 m blocks (`noise.size_horizontal: 1`),
  only for chunks near the player. Our ground stops at ~85 m samples; below that there
  are only shading and props. That gap, not the number of props, is why the walk reads
  as smooth grey with objects on top.
- **Most "rocks" are ground.** Surface rules turn steep spots to stone and lay gravel,
  coarse dirt or grass patches by noise thresholds (`steep`, `noise_threshold`,
  `stone_depth` dominate Tectonic's surface rule). Placed features come on top, sparsely.
- **Landform families per region.** A low-frequency region selector picks a family,
  each with its own spline: plateaus with steps, single and double valleys, rolling
  hills, dunes, badlands ridges, pillars (`density_function/region/*`).
- **Ruggedness varies by place.** How much small-scale relief applies is a spline over
  large-scale fields (continents, erosion): jaggedness is strong in some places and
  absent in others, never uniform (`terrain_spline/jaggedness`, `factor`).
- **Erosion look without simulation.** Ridge detail noise is domain-shifted by the
  gradient of the base noise times 3000 (`mountain_ridges/shifteddetail`), so small
  ridges run downhill like gullies. `abs()` and folded noise make ridges and dunes.

Consequence: the composition-to-generator path below (old steps 3 and 5) is replaced.
Detail goes into a procedural ground layer first; objects follow the ground. The
authored downs walk stays as a fixed comparison route, not as a template to generalize.

## 3. Detail ground for the downs

Task: add a detail height layer on top of the regional terrain near the player:
seeded noise generated in chunks (2–4 m spacing) in a worker, streamed like scenery
cells. The renderer and the ground height / collision read the same chunk data, so
they agree by construction. Not per-pixel shader noise (that was slow before); detail
fades out with distance so far leaves keep their current triangle size.

Downs landform: rolling `abs()` hills, slope-shifted ridge detail, and rock knolls
that break through the ground (tors as ground, not stacked props). Ruggedness comes
from a spline over fields the app already has (regional slope, biome, erosion amount),
so some stretches stay calm. Add a fill light so shaded faces are not near-black;
it is part of judging the ground, not the later style choice.

Done when the baseline route shows banks, hollows and knolls at eye level, the player
neither hovers nor sinks, tide behaviour is unchanged or the limit is documented, and
`npm run perf` / `check:fps-baseline` stay near the step 1 numbers.

## 4. Ground material and objects from the detail

Surface rules on the detail ground: exposed rock on steep detail slopes, rubble and
gravel at their foot, grass in hollows, patches by noise threshold. Move existing
scenery to follow the same rules (rubble below faces, shrubs in sheltered hollows) and
thin out the uniform random scatter. Compare against step 1 and 2 captures.

## 5. One landform family per biome

One task each, in this order: ash (dunes, wind-scoured hollows), coral (ravines and
walls as ground, passages preserved), mire (raised islands, channels), tidal flats
(scour, channels). Each with ruggedness varying by place, a biome-edge comparison and
a moving performance check. Sea stacks and arches need coast geometry; don't force them.

## 6. Two visual treatments on a whole biome

As the old step 4, but over the downs as a whole rather than one composition:
A painted/simplified, B retro textured (a pixel filter alone is not B). The GM chooses.

## 7. Distant continuity

As the old step 6: inspect transitions along the approach, keep streaming and the
three mesh LODs, preserve silhouettes of knolls and destinations, measure cold/warm.

## Validation and handoff after every implementation step

Run relevant checks from the working checkout's package.json. At minimum typecheck
and build for code changes; add targeted tests for changed behaviour. For placement,
rendering or travel changes run the relevant existing scenery/player/shore checks.
Use `TP_BROWSER_OFFLINE=1` for browser checks where supported. Broaden checks for
integration changes, not repeatedly for documentation-only work.

The branch documents an existing `check:layers` live-file-watcher failure. Recheck
when relevant and report it accurately; neither silently fix unrelated infrastructure
nor assume every new failure is pre-existing.

Every handoff must state: branch/commit, completed step, changed files, reproducible
views/route, tests actually run, visual limitations, measured performance and the next
single task. Update this file's execution log. Never substitute passing tests for a
visual review, invent benchmark results, or commit private reference images.

## Copyable task prompt

"Read FPS_IMPROVEMENT_PLAN.md. Verify the checkout contains feat/middle-layer's
implementation. Implement step N only. Preserve unrelated work. Follow that step's
scope and acceptance criteria, capture the specified comparisons, run relevant checks,
and update the execution log with evidence and limitations. Do not proceed to the
next numbered step in this task."

## Execution log

- 2026-11-11: Plan written. No implementation steps started. Local worktree state
  inspected; no branches merged, removed or cleaned up.

- 2026-11-11: Step 1 completed on master `51ecc67` (PR #7 already merged).
  See [FPS_BASELINE.md](FPS_BASELINE.md), `scripts/fps-route.json`, and retained
  `shots/fps-baseline/` captures/raw timings. Repeat with
  `TP_BROWSER_OFFLINE=1 npm run check:fps-baseline`. Dry downs route: 400 m horizontal,
  approximately 401.1 m walked; five eye-level cameras plus distant approach. Coral
  edge preference deferred. Build/typecheck and both real-browser arrival checks
  passed; GL error 0. Cold/warm timing limitations are explicit in the report.
  No visual implementation changed. Next task is step 2 only.

- 2026-11-11: Step 2 authored prototype implemented on master (uncommitted),
  opt-in `?world=forgotten-shore&prototype=downs-walk`. See FPS_COMPOSITION.md
  for the layout, eight captured views, measured traversal and limitations.
  Existing baseline preserved. Layout awaits user visual review; step 3 not started.

- 2026-11-11: GM review of step 2: more interesting, but one walk cannot be
  extrapolated. Steps 3–7 rewritten after reading Tectonic's terrain source (see the
  revision section): detail ground first, objects follow it. Step 3 not started.
