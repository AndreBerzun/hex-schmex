---
name: terrain
description: Shape the hexcrawl terrain in a map file (maps/*.json) with the terrain CLI — add mountain ranges, rivers, coasts, lakes, forests or deserts, refine existing ones, or describe what a map looks like. Use when the user asks for terrain or landscape changes, mentions hexes like "0507", or asks what is where on a map.
---

Follow the procedure in `TERRAIN_AGENT.md` at the repository root (read it first if you haven't this session).

Short version:
1. `npm run terrain -- list` to find the map; ask which one only if several fit.
2. Look: `npm run terrain -- context <map>` and `npm run terrain -- map <map> --ops`, then Read the PNG it writes.
3. Edit with `add` / `update` / `remove` / `set` / `apply`, always with `--label "what and why"`. Refine existing ops instead of stacking new ones.
4. Check with `map <map> --highlight <ids>` and fix misplacements.
5. Tell the GM in one or two sentences what changed and where (hex ids). The open browser shows each edit live as an undoable step.

Never edit map JSON by hand when a CLI command can do it: the CLI validates ops, resolves hex ids, keeps undo snapshots and the edit log the browser shows.
