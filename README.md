# hex-schmex: Terrain Prompter

Browser-based terrain generator for a Shadowdark westmarches hexcrawl: prompt and paint realistic, eroded terrain at region scale, then fly down into any 6-mile hex.

- `BRIEF.md`: full project spec
- `CLAUDE.md`: working rules for the coding agent
- `KICKOFF.md`: the first prompt for a coding session, plus follow-ups
- `reference/`: visual targets (02–04) and the anti-target (01)

- `TERRAIN_AGENT.md`: how a Claude Code session edits a map with the terrain CLI

Status: M1–M5 done, M6 (brushes) next. See `PROGRESS.md`.

## Quick start

```bash
npm ci --ignore-scripts
npm run dev                         # app with live map-file link
npm run terrain -- help             # CLI for looking at / editing maps/*.json
npm test                            # unit tests
npm run shots                       # headless screenshots into shots/
npm run perf                        # frame and bake timings on this machine's GPU
npm run check:bake                  # edits and scripted bakes run erosion to the end
npm run build:single                # one self-contained HTML file in dist-single/
```
