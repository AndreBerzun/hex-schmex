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

## 3. Make the ground and objects belong together

Task: Add one integrated outcrop composition: exposed rock, downhill rubble that
becomes smaller away from the source, sheltered grass pockets and an open approach.
Use the same composition footprint/orientation to drive object placement and local
material patches. Avoid independent noise fields for every supporting element.

Add one small ground-form feature, such as a bank, shelf or depression, using a local
patch or integrated mesh. Choose the smallest implementation compatible with current
terrain sampling. Regional samples are about 85 m apart; extra shading cannot supply
this geometry. Do not increase the entire world's terrain resolution.

Rendering, ground height sampling and collision must agree. Preserve tide behaviour;
if the prototype stays dry, explicitly document that limitation rather than claiming
wet-ground support. Check seams from both eye level and above.

Deliverable: the integrated composition and close/medium comparisons.
Done when supports do not visibly float, the player does not clip through or hover
above the new ground, and rubble/grass visibly relate to the main outcrop.

## 4. Compare two coherent visual treatments

Task: Render the SAME composition in two modest styles:
A. Painted/simplified 3D: controlled palette, broad material patches, restrained
surface noise, coordinated terrain/object lighting.
B. Retro textured 3D: deliberately limited texture resolution and palette, matching
terrain/object detail scale. A pixelation filter alone does not constitute this style.

Start with A, save comparisons, then add B without losing A. Keep geometry, cameras,
lighting direction and object placement fixed. Improve object-ground contact using a
budgeted contact-shadow or local-shadow approach; compare its cost and artifacts.
No new full-world voxel engine, comprehensive asset library or expensive post stack.

Deliverable: side-by-side eye-level and approach views plus timings for both styles.
Done when ground and objects read as the same world and each treatment is inspectable
in motion. Ask the user to choose or revise the direction before propagating it.
Painted 3D is the proposed default, not an already approved final art direction.

## 5. Convert the successful composition into a deterministic generator

Task: Generate a small family of outcrop sites with a shared anchor, orientation,
footprint, exposed edge, rubble zone, vegetation pockets and route clearance.
Choose sites from terrain suitability; generate dependent elements relative to the
site. Vary proportions and damage, not merely uniform scale and random rotation.
Keep the successful authored route as a reference fixture.

Maintain stable site IDs and deterministic generation across cell unload/reload.
Assign cross-cell sites to one owner and query their overlap in adjacent cells so
boundaries do not duplicate or cut off compositions. Preserve quality-level stability.

Deliverable: outcrop compositions at three seeds/locations, including a biome edge.
Done when all three retain recognizable structure without looking identical.
Tests should cover determinism, boundary ownership and route clearance, not exact
counts that merely mirror implementation constants.

## 6. Improve distant continuity only where the route exposes a problem

Task: Inspect existing LOD transitions along the approach. Retain current streaming,
instancing and three mesh LODs. Add a cheap combined far representation for a site or
stand only if individual-object fading destroys its identity. Preserve its main
silhouette and openings; use hysteresis or a suitable transition to avoid flicker.

Important destinations persist farther than minor vegetation; tiny clutter may vanish
early. Do not increase every object's draw distance. Do not change collision with
visual LOD. Check both walking and camera rotation for popping and generation hitches.

Deliverable: approach/departure comparison and cold/warm traversal measurements.
Done when the destination remains recognizable as detail resolves and no visible
transition introduces a major frame hitch. Compare against step 1; investigate
repeatable regressions rather than explaining them away as measurement noise.

## 7. Expand one biome at a time

Only after the downs prototype works, add these as separate tasks:
1. Ash: shell, wind-scoured hollow, drift and related fragments.
2. Mire: raised island, wet boundary, reeds/sponges and a traversable crossing.
3. Tidal flats: wreck, scour, aligned debris and sediment/pools.
4. Coral refinement: better wall bases/crowns and chamber variation, preserving the
   connected passages that already work.

Each task needs one authored reference composition, procedural variants, a biome-edge
comparison and a moving performance check. Reuse the composition machinery only where
it helps. Sea stacks/arches need appropriate coast geometry; don't force them onto
unsuitable terrain to make an object-count test pass.

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
