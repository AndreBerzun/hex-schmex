# Working rules for this repo

This is **Terrain Prompter**, a browser terrain generator for a Shadowdark westmarches hexcrawl. The full spec is in `BRIEF.md`. Read it completely before writing code, and look at every image in `reference/`. They define the visual target and the anti-target.

## How to work
- Follow the milestones in `BRIEF.md` §10 in order. Keep the app runnable after every milestone.
- Keep `PROGRESS.md` updated: current milestone, what's done, what looks off visually, open decisions, and anything that deviates from the brief, with the reason.
- Commit in small, meaningful steps with clear messages. Push regularly.
- After every visual change, run `npm run shots` and compare the output to `reference/` (BRIEF §11). Be honest about the gap. Don't call something "realistic" if the screenshot doesn't support it.
- WebGL2 is the baseline. Don't make WebGPU required.
- The target machine has integrated Intel graphics. Check render changes with `npm run perf`; per-pixel procedural noise and sub-8-pixel triangles are what made this slow before.
- Determinism matters: seeded randomness only.
- Verify third-party APIs (three.js, Anthropic Messages API / tool use) against current docs instead of memory.
- When a design decision isn't covered by the brief, make the reasonable call, note it in `PROGRESS.md`, and move on. Don't stall.

## Commands (create these in M1)
- `npm run dev`: dev server
- `npm run build`: static build; `npm run build:single` builds a single self-contained HTML file
- `npm test`: Vitest
- `npm run shots`: headless screenshots of the camera presets into `shots/` (real GPU; `--software` for SwiftShader)
- `npm run perf`: bake timeline, frame gaps and GPU ms per camera preset
- `npm run check:bake`: real-browser check that edits and scripted bakes run erosion to the end
- `npm run check:layers`: real-browser check that sculpt, paint and brush strokes skip erosion and that a reopened map uses its saved bake
- `npm run check:scenery`: real-browser check that the middle layer redraws the same after a cache rebuild, that a march routes round a coral wall, and that idle draws nothing
- `npm run gallery -- near:0,mid:1,far:2`: every middle-layer object in a row at a forced detail level, into `shots/_tmp/gallery/`
- `npm run terrain -- <command>`: look at and edit map files from the terminal (replaces the planned `npm run prompt`; see `TERRAIN_AGENT.md`)

## Editing terrain
When the user asks for terrain changes on a map, follow `TERRAIN_AGENT.md` (also the `terrain` skill). The app has no built-in LLM client by design: Claude Code is the prompter.
