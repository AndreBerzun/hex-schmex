# Working rules for this repo

This is **Terrain Prompter**, a browser terrain generator for a Shadowdark westmarches hexcrawl. The full spec is in `BRIEF.md`. Read it completely before writing code, and look at every image in `reference/`. They define the visual target and the anti-target.

## How to work
- Follow the milestones in `BRIEF.md` §10 in order. Keep the app runnable after every milestone.
- Keep `PROGRESS.md` updated: current milestone, what's done, what looks off visually, open decisions, and anything that deviates from the brief, with the reason.
- Commit in small, meaningful steps with clear messages. Push regularly.
- After every visual change, run `npm run shots` and compare the output to `reference/` (BRIEF §11). Be honest about the gap. Don't call something "realistic" if the screenshot doesn't support it.
- WebGL2 is the baseline (headless screenshots use SwiftShader). Don't make WebGPU required.
- Determinism matters: seeded randomness only.
- Verify third-party APIs (three.js, Anthropic Messages API / tool use) against current docs instead of memory.
- When a design decision isn't covered by the brief, make the reasonable call, note it in `PROGRESS.md`, and move on. Don't stall.

## Commands (create these in M1)
- `npm run dev`: dev server
- `npm run build`: static build; `npm run build:single` builds a single self-contained HTML file
- `npm test`: Vitest
- `npm run shots`: headless screenshots of the camera presets into `shots/`
- `npm run prompt -- <world.json> "<prompt>"`: apply a prompt headlessly (M5)
