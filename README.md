# hex-schmex: Terrain Prompter

Browser-based terrain generator for a Shadowdark westmarches hexcrawl: prompt and paint realistic, eroded terrain at region scale, then fly down into any 6-mile hex.

- `BRIEF.md`: full project spec
- `CLAUDE.md`: working rules for the coding agent
- `KICKOFF.md`: the first prompt for a coding session, plus follow-ups
- `reference/`: visual targets (02–04) and the anti-target (01)

- `TERRAIN_AGENT.md`: how a Claude Code session edits a map with the terrain CLI
- `NEXT_STEPS.md`: current handoff, candidate rendering improvements and local-only workflow
- `MATERIALS.md`: material experiment with before/after images and measured costs

Current focus: the Forgotten Shore. Run the app and open `?world=forgotten-shore` (or choose it in Examples). Click the landscape for free flight: WASD, Space up, C down, Shift faster, Esc to release the mouse. Use **Visit…** for the saved views, **Sun** for the Spire shadow, and **Sea** for the night tide. Choose **Player** for ground-level click-to-march travel with an advancing clock and day/night tide. See `FORGOTTEN_SHORE.md` for the layout and `PROGRESS.md` for status.

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
npm run check:materials -- review   # fixed material views + GPU timings in shots/_tmp/materials-review/
npm run check:bake                  # edits and scripted bakes run erosion to the end
npm run check:layers                # sculpt, paint and brushes skip erosion; reopening uses the saved bake
npm run build:single                # one self-contained HTML file in dist-single/
```

For local browser checks without external requests, prefix the command with
`TP_BROWSER_OFFLINE=1`. This disables browser background networking and external
DNS resolution and sends non-loopback browser requests to an unused local proxy.
Vite and browser debugging still use loopback connections. Material checks include
eye-level ground, forest and lowland views, shader errors, and repeatable renders.
