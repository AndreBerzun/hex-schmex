# hex-schmex: Terrain Prompter

Browser-based terrain generator for a Shadowdark westmarches hexcrawl: prompt and paint realistic, eroded terrain at region scale, then fly down into any 6-mile hex.

- `BRIEF.md`: full project spec
- `CLAUDE.md`: working rules for the coding agent
- `KICKOFF.md`: the first prompt for a coding session, plus follow-ups
- `reference/`: visual targets (02–04) and the anti-target (01)

- `TERRAIN_AGENT.md`: how a Claude Code session edits a map with the terrain CLI

Current focus: the Forgotten Shore spatial prototype, before choosing the next editor milestone. Run the app and open `?world=forgotten-shore` (or choose it in Examples). Click the landscape for free flight: WASD, Space up, Shift down, Ctrl faster, Esc to release the mouse. Use **Visit…** for landmark views, **Sun** for the Spire shadow, and **Sea** for the flood preview. Choose **Player** for ground-level click-to-march travel with an advancing clock and day/night tide. Hexes, labels, debug views and altitude remain available; editing controls are hidden by default. See `FORGOTTEN_SHORE.md` for dimensions and limitations, and `PROGRESS.md` for status.

## Quick start

```bash
npm ci --ignore-scripts
npm run dev                         # app with live map-file link
npm run terrain -- help             # CLI for looking at / editing maps/*.json
npm test                            # unit tests
npm run shots                       # headless screenshots into shots/
npm run perf                        # frame and bake timings on this machine's GPU
npm run check:player                # ground travel, day/night and shoreline stress checks
npm run check:shore                 # landmark, flood and camera browser checks
npm run check:bake                  # edits and scripted bakes run erosion to the end
npm run build:single                # one self-contained HTML file in dist-single/
```
