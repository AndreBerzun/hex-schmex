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
2. **Plan** a few well-parameterised ops. Think in landforms, not in single hexes (see *Design guidance*).
3. **Edit.** Run one command per logical change, each with a `--label` saying what and why; the label is what the GM sees in the panel and the undo list. Use `apply` to group several calls into one undoable step.
4. **Check.** Run `map <map> --highlight <ids>` (or `context`) again. Fix anything that landed wrong with `update`, not with a second op on top.
5. **Report** to the GM in a sentence or two: what changed and where (hex ids). Rivers, lakes and snow come out of erosion and hydrology in the browser, so ask the GM to look at the 3D view for the final verdict. If no browser is open, `npm run shots -- maps/<map>.json` renders 3D views into `shots/` (slow without a GPU).

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
```

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

- **Shapes:** `ridge` (a range along a crest line), `peak` (cone, dome, massif or volcano), `crater` (raised rim, terraced inner wall, flat floor, optional central peak and breach; absolute elevations), `plateau`, `hills` (rolling, rugged, dunes, or `towers` / `sinkholes`: steep-sided stacks or pits with open ground between them, `wavelengthKm` = spacing), `roughen`.
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
- **Map edges are mirrored.** Outside the map the renderer mirrors the terrain and fades it into haze. A range whose crest runs along an edge (and whose crest line runs on 30 km past the corners, so it does not taper on the map) reads as continuing beyond it. A closed landform within ~20 km of an edge shows a faint twin in the haze.
- **Mind the context source.** The CLI's `context`, `map` and `query` show the op stack *before* erosion, evaluated on the CPU. Peaks erode down a little in the browser, valleys fill with sediment, and rivers and lakes appear where the water actually goes.
