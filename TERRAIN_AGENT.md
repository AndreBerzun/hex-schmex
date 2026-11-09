# Editing terrain from Claude Code

This is the procedure for a Claude Code session (or a person at a terminal) to shape a map. It needs no API key and no SDK. The session reads and writes a map file with the terrain CLI. A browser running the app picks up every write live.

## Setup (the GM does this once per session)

1. `npm run dev`, then open the printed URL.
2. In the right panel (**Map file**), pick a file from `maps/`, or use **Save as map file…** to turn the current world into one. You can also start a new file from the terminal: `npm run terrain -- new my-marches` (optionally with `--from alpine-valley`).
3. Start Claude Code in this repository and describe what you want: "on maps/my-marches: a volcanic island off the west coast, and make the northern range higher".

Every CLI write shows up in the browser as one undoable step, listed in the panel with a **Revert** button. Edits made in the UI are written back to the same file, so the next CLI call sees them.

## The loop (for Claude)

1. **Look.**
   - `npm run terrain -- context <map>` prints the grid, the settings, the op list in hex terms, per-hex mean/max elevation and dominant-surface tables, and the recent edit log.
   - `npm run terrain -- map <map> --ops` writes a top-down PNG with hex ids and every op's geometry drawn in magenta, labelled with its stack index. Read the PNG; it is the fastest way to check placement.
2. **Plan.** Pick the layer (see *Three layers*): ops for landforms that should come out eroded, sculpt and paint for anything that has to land exactly where it is put. Think in landforms, not in single hexes (see *Design guidance*).
3. **Edit.** Run one command per logical change, each with a `--label` saying what and why; the label is what the GM sees in the panel and the undo list. Use `apply` to group several calls into one undoable step.
4. **Check.** Run `map <map> --highlight <ids>` (or `context`) again. Fix anything that landed wrong with `update`, not with a second op on top.
5. **Report** to the GM in a sentence or two: what changed and where (hex ids). Ask the GM to look at the 3D view for the final verdict. If no browser is open, `npm run shots -- maps/<map>.json` renders 3D views into `shots/` (slow without a GPU).

## Three layers

| Layer | What it is | Cost of a change |
|---|---|---|
| **Foundation** | the op stack, then erosion | a full bake, ~30 s |
| **Sculpt** | raise, lower, flatten and smooth, applied to the eroded foundation in order | under a second; water follows |
| **Paint** | biomes per area; paint wins over the climate rules | instant |

The browser freezes the eroded foundation once it is baked and writes it to `maps/.bake/<map>.bin` (ignored by git). Sculpt and paint never re-run erosion, and reopening the map loads the saved bake instead of baking again. Changing an op, the base noise, the seed or the erosion settings makes the bake stale; the next browser open bakes again. **Re-bake** in the toolbar forces a fresh erosion.

The CLI reads that bake. `context`, `map` and `query` show the eroded ground with water, sculpt and paint on top, as the browser does, whenever the bake is current (`context` prints the bake's state on its first line). Without a current bake they fall back to the op stack before erosion, with a note.

Use ops for the big shapes erosion should weather. Use sculpt and paint to *place*: a plateau exactly at 600 m, a steeper face, a gorge exactly here, coral in these hexes, ash up to that ridge. A sculpt edit moves the eroded ground as it is, so it keeps the gullies and texture; it does not add new erosion detail. Stacking a large raise on a valley floor makes a dam, and water then pools behind it.

The GM has the same tools as brushes in the editor (`?editor`, left panel): Raise, Lower, Flatten (levels to the height where the stroke starts), Smooth and Paint, with size, height or strength, and edge. Each stroke is one undo step and lands in the same `sculpt` / `paint` lists, so `layers` shows them.

## Commands

```
npm run terrain -- help
npm run terrain -- list
npm run terrain -- context <map>
npm run terrain -- map <map> [out.png] [--ops | --highlight id,id] [--width 800]
npm run terrain -- query <map> 0507 0508 | --bbox 0305 0710      # min/mean/max, slope, surface per hex
npm run terrain -- ops                                            # every op type and its parameters
npm run terrain -- show <map> <op-id>

npm run terrain -- new <map> [--from <example>] [--cols 10 --rows 10 --hex-miles 6 --orientation flat] [--title "…"]
npm run terrain -- add <map> '{"type":"peak","label":"Ashcrown","center":"0807","height":2400,"radius":12,"shape":"volcano"}' --label "volcano in 0807"
npm run terrain -- update <map> <op-id> '{"height":2900}' --label "raise the northern spine"
npm run terrain -- remove <map> <op-id> --label "…"
npm run terrain -- move <map> <op-id> <index> --label "…"
npm run terrain -- set <map> climate.snowlineM 2300 --label "…"
npm run terrain -- apply <map> - --label "…" <<'JSON'
[{"tool":"add_op","op":{"type":"coast","label":"Western sea","side":"W","extentKm":30}},
 {"tool":"update_op","id":"spine","patch":{"height":3100}}]
JSON
npm run terrain -- undo <map>                                     # restores the file before the last CLI edit

npm run terrain -- sculpt <map> '{"tool":"flatten","hexes":["0808","0809"],"targetM":600,"falloffKm":2}' --label "mesa in 0808"
npm run terrain -- sculpt <map> '{"tool":"raise","points":["0405","0607"],"radiusKm":2,"amountM":300}' --label "…"
npm run terrain -- paint <map> '{"biome":"crimson coral","region":{"hex":"0607","radius":1},"falloffKm":3}' --label "…"
npm run terrain -- layers <map>                                   # sculpt and paint edits with ids
npm run terrain -- update <map> <edit-id> '{"amountM":500}'       # update/remove/show take edit ids too
```

**Sculpt** (`tool`): `raise` / `lower` (by `amountM`), `flatten` (to the absolute `targetM`), `smooth` (blur over `scaleKm`, default 1). **Paint** (`biome`): `open`, `forest`, `marsh`, `desert`, `badlands`, `rock`, `snow`, `tidal`, or `erase` to give the ground back to the climate rules; Shore names work too (`crimson coral`, `silt mire`, `ash`, `ash ridges`, `black earth`, `mineral rock`, `tidal flats`). Painted open ground still shows steppe or grass by moisture.

Both take the area as `hexes`, a `region` (same forms as ops), or a brush path: `points` plus `radiusKm`. `falloffKm` softens the edge (default 1.5 km for areas, half the radius for paths); `strength` (0–1) blends. Edits apply in list order, so a later one wins where they overlap. Hex-shaped paint with a short falloff reads as a pasted hexagon; give paint 2–3 km of falloff, or a path, unless a hard edge is the point.

`<map>` is a name in `maps/` (`my-marches` means `maps/my-marches.json`) or a path. A command whose calls fail writes nothing and prints why; add `--partial` to keep the calls that worked. Every write keeps a snapshot in `maps/.history/` (last 50).

Settable world paths: `terrain.seaLevelM`, `terrain.maxElevationM`, `base.(type|elevation|amplitude|wavelengthKm|octaves|warpKm)`, `erosion.(enabled|preset|strength)`, `climate.(windFromDeg|baseMoisture|snowlineM|treelineM|temperature)`, `meta.name`, `meta.notes`, `seed`. Changing the grid size or resolution is the GM's call; do it in the World setup panel.

## Coordinates

Hex ids are `CCRR`: `0101` is the top-left (NW) hex. North is up. In the flat-top layout, even columns sit half a hex lower. A hex is `hexMiles` across (6 mi ≈ 9.7 km by default).

- **point:** `"0507"` (hex centre), `"0507:NE"` (toward that hex's NE edge; N NE E SE S SW W NW), `{"hex":"0507","dx":0.3,"dy":-0.2}` (offset in hex widths, +x east, +y south), `"N"`, `"NE"` … `"center"` (spots near the map edges), or `[x, y]` in km from the top-left corner.
- **points (polyline):** a list of points. Rivers, valleys and canyons go from source/head to mouth; the app forces them downhill either way.
- **region:**
  - `{"hexes":["0405","0406"]}`
  - `{"hex":"0507","radius":2}` (radius in hex steps)
  - `{"center":"0507","radiusKm":14}`
  - `{"polygon":[…points]}`
  - `{"rect":["0203","0608"]}`
  - `{"side":"N","fraction":0.3}` (a band along that map edge)
  - `"all"`

Hex ids more than one hex outside the grid are rejected.

## Ops

`npm run terrain -- ops` prints the full parameter list, generated from the code, so it is always current. In short:

- **Shapes:** `ridge` (a range along a crest line), `peak` (cone, dome, massif or volcano), `plateau`, `hills` (rolling, rugged or dunes), `roughen`.
- **Cuts:** `valley` (V, or U for glacial), `river`, `canyon`, `basin` (lakes), `coast` (sea along a side or in a region), `escarpment`.
- **Levelling:** `lowlands` (plains, marsh), `smooth`.
- **Climate only:** `moisture` (+ forest and swamp, − steppe and desert; it doesn't change height).

Ops run top to bottom. Broad shapes (coast, lowlands, plateau) go before the features carved into them (valley, river, canyon).

**Blend modes.** Shape ops default to `add`, with a relative height (metres added). With `max`, `min` or `replace`, the value is an absolute elevation. Carving ops already default to the right mode. Any op can take `"mask": {"region": …, "falloffKm": 5, "invert": false}`.

## Design guidance

- **Think in real landforms.** Mountains come in ranges, with foothills between them and the plains. High ranges carry U-shaped glacial valleys, and range fronts shed fans onto the plain. Water runs to the sea or into a closed basin.
- **Mind the wind.** The side of a range facing the wind (`climate.windFromDeg`, the bearing the wind comes *from*) is wet; the lee side is in a rain shadow. Use `moisture` ops to push forests, swamps and steppe where the story wants them.
- **Scale.**
  - The default map is 10 × 10 hexes, about 96 × 111 km.
  - A range is 10–25 km wide (`width` is the half-width) and 20–80 km long.
  - Hills have a few hundred metres of local relief; mountains have 1000–3000 m.
  - Stay under `terrain.maxElevationM`.
- **Prefer a few broad ops.** A few well-parameterised ops beat many small ones: one ridge with 4–6 crest points instead of six peaks in a row.
- **Label ops so a GM recognises them** ("Greyspine range", "Saltmere basin").
- **Refine, don't stack.** When the GM refines something that exists ("higher", "move it east"), `update` that op instead of stacking a new one. Remove ops the GM wants gone.
- **Keep design intent in `meta.notes`.** Put region names and anything later sessions should respect there (`set <map> meta.notes "…"`). `context` prints the notes and the last edits.
- **Mind the context source.** With a current bake, the CLI shows the eroded ground with water, sculpt and paint. Without one, it shows the op stack *before* erosion: peaks erode down a little in the browser, valleys fill with sediment, and rivers and lakes appear where the water actually goes.
