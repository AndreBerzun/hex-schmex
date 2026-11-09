# Plan: a more dramatic Forgotten Shore

Handover note (2026-11-09). Three asks: the Dark Sea crater must read as a massive crater,
the Hollow Mountains must dwarf Earth's 8 km peaks, and the flat country (even the Silt
Mires) needs relief. Delete this file when the work is merged.

## State of this branch (`feat/dramatic-shore`)

Generator code is written and typechecks. Nothing else: **no tests added, never rendered,
map untouched.** Treat the numbers in the new code as a first guess to tune against shots.

- `crater` op (`opCrater` in `src/core/ops.ts`, schema in `opSchema.ts`, type in `types.ts`):
  absolute rim and floor elevations, noise-scalloped outline, crest height varying along the
  rim, terraced inner wall with gullies, outer flank that blends into the existing ground,
  optional central peak, optional breach (compass bearing, width, floor elevation). It marks
  the interior as an intended lake so erosion does not fill it with sediment.
- `hills` styles `towers` and `sinkholes` (`opStacks`, `Cells2` in `noise.ts`): steep-sided
  stacks or pits in clusters with open ground between. `amplitude` = tallest tower,
  `wavelengthKm` = spacing.
- Limits raised: ridge and peak height to 16 km, plateau top to 12 km, valley and canyon
  depth to 8 km. `terrain.maxElevationM` is only a clamp (ceiling is 1.6 x the value), so
  raising it on the map is free.

Still to do in code: tests in `tests/core.test.ts` (crater rim above floor, breach lower than
rim, towers leave flat ground between them, determinism), a line for `crater` and the new
styles in `TERRAIN_AGENT.md`, `PROGRESS.md`.

## Why the current map looks tame

- The range tops out near 3.8 km and stands 45 km from the castle: about 4 degrees above the
  horizon. At 11 km it is 13 degrees.
- The crater is a 650 m ridge loop around a shallow bowl, 34 km of water, and it runs off the
  east map edge. No inner wall, so from the rim (`crater-overlook`) there is no crater.
- Mires are levelled with flatness 1, the drowned coast 0.9, the coral lowlands 0.5 plus 90 m
  hummocks. Nothing between 100 and 600 m tall with steep sides, which is what reads at eye
  level.

## 1. Hollow Mountains

All `update` on the existing ops, plus `set terrain.maxElevationM 15000`.

| Op | Now | Proposed |
|---|---|---|
| Hollow Mountains (`ridge-wt8v1`) | height 3000, width 14 | height 9000, width 24, sharpness 0.75 |
| Hollow Crown (`peak-wt8w2`) | 1500, radius 9 | 4500, radius 15 |
| Hollow front range (`ridge-wt8w3`) | 1300, width 6 | 3200, width 9 (the foothill belt) |
| Hollow Spur (`ridge-wt8w4`) | 1900, width 7 | 4200, width 9 |

Ridge noise multiplies the height by roughly 0.4 to 1.4, so 9000 gives saddles near 4-5 km
and summits near 12 km; the Crown should reach about 13 km. Then:

- Three glacial troughs into the wall (`valley`, profile U, depth ~2200, width 5), e.g.
  0302 to 0304, 0602 to 0604, 0902 to 0904, inserted right after the ridges so the wall is
  not one uniform tube.
- Deepen the Hollow River valley (`valley-wt8xl`) from 140 to about 380 so it cuts a gorge
  through the downs.
- Reroute the Spur valley (`valley-wt8ym`): it now ends where the new crater rim stands.
  Bend it west into the coral lowlands (… 1006, 0907, 0808).
- Snowline is 9000 today, so the new summits get snow caps. Decide from the shot: it is a
  strong scale cue, but set it to 16000 if it clashes with the ashen look.

Watch: erosion talus on 35-45 degree faces 9 km high (may collapse the crest; check bake
time and `npm run perf`), haze at 45 km, and the northern flank being cut by the map edge
at several km of height.

## 2. The crater

Remove the four ops that fake it today: Crater rim (`ridge-wt8xi`), Crater floor
(`basin-wt8xj`), The Dark Sea (`coast-wt8xk`), Rim breach (`valley-wt8yo`). Add one `crater`
op and **move it after the Drowned coast lowlands** (`lowlands-wt8yn`), otherwise that
levelling op flattens the south-west rim.

```
{"type":"crater","label":"Dark Sea crater","center":[102,99],"radius":25,
 "rimElevation":2400,"floorElevation":-1200,"wallKm":8,"apronKm":13,"terraces":4,
 "centralPeakElevation":900,"breachBearingDeg":240,"breachWidthKm":9,"breachElevation":15}
```

- 50 km rim to rim, whole ring on the map (today's is cut by the east edge). Crest 1.5 to
  2.5 km, so from the rim it is a 2 km drop to 40 km of black water; from the castle (25 km
  away) the rim is a 4-5 degree wall that still hides the water.
- Breach toward the tidal flats at 240 degrees, 9 km wide, sill at 15 m: above the day sea,
  below the night tide, so the sea comes out through it at night. The bearing is chosen so
  the flats reference point (74.83, 114.83) used by `tests/shore.test.ts` and
  `scripts/shore-check.ts` stays in the outflow fan and below 120 m. Verify with `query`.
- Central peak is my addition (an island massif in the Dark Sea, the classic crater
  silhouette from above). Drop `centralPeakElevation` if Andre does not want it.
- Water: the closed crater is no longer connected to a map edge, so hydrology treats it as
  a lake filled to its spill level (the breach sill, ~15 m) instead of sea at 0 m. It is
  drawn from the same water-level texture. Check that it does not turn into a salt pan
  (dry-climate playa rule in `hydrology.ts`) and that the surface readout still says dark
  water.
- The crater takes the east of the coral lowlands and of the drowned coast, and abuts the
  tablelands. Expected; coral stays below the 220 m coral line on the lower flank.

## 3. Relief in the flat country

Keep the flats flat and stand steep things on them. With the night tide at +120 m,
everything taller becomes an island at night, which is also play material.

| Biome | Change |
|---|---|
| Silt Mires | `towers` amplitude 300, spacing 2.4 km (tower karst, 120-300 m); `sinkholes` amplitude 120, spacing 3 km (black pools below the day sea) |
| Tidal flats | `towers` amplitude 220, spacing 3.5 km (sea stacks); make sure none lands on (74.83, 114.83) |
| Coral lowlands | `towers` amplitude 260, spacing 4 km (coral massifs, tops above the tide); `sinkholes` amplitude 150, spacing 5 km; hummocks 90 to 140 |
| Sea of Ash | dunes 90 m / 2.8 km to 170 m / 3.6 km; buttes from `rugged` 200 m to `towers` 380 m / 4.5 km so they are real buttes |
| Black Downs | rolling amplitude 450 to 600; the gorge from section 1 |
| Tablelands | top 720 to about 950; one `canyon` (depth ~700, width 3) draining west into the lowlands |

Place the tower and sinkhole ops after each biome's `lowlands` op and before the city and
Spire platform ops. Density is set by a threshold inside `opStacks`; if stands come out too
dense or too sparse, tune it there (or expose it as a parameter) rather than by spacing.
Leave the base noise alone: changing it shifts the whole map, the city included.

## Constraints to keep

- `tests/shore.test.ts`: wall circuit above tide + 150 m, castle 60 m above its
  surroundings, city within 5 km of the centre, flats point between 0 and 120 m.
- The castle sightlines in `FORGOTTEN_SHORE.md`: Spire visible, Soul Tree crown just above
  the Ash Ridges (keep those ridges under ~750 m), crater water hidden, four colossi hidden.
  Worth a small line-of-sight check with `fieldProbe` instead of eyeballing.
- `worlds/forgotten-shore.json` is a byte copy of `maps/forgotten-shore.json`; copy it over
  after editing the map with the CLI.

## Views

The CLI cannot set views, so patch `meta.views` in the JSON: `crater-overlook` onto the new
rim crest looking in, `castle-to-crater` at the new centre, `black-downs` and
`mountain-valley` with a higher look target (~5 km), and add an oblique aerial of the crater
and one eye-level view among the mire towers.

## Order of work

1. Tests for the new code, `npm test`.
2. Mountains, then `npm run shots -- maps/forgotten-shore.json --views castle-to-mountains,black-downs,region-oblique`.
3. Crater, shots of `crater-overlook`, `castle-to-crater`, `region-topdown`.
4. Flat country one biome at a time, eye-level shot each.
5. `npm test`, `npm run check:shore`, `npm run check:bake`, `npm run perf`; update
   `FORGOTTEN_SHORE.md`, `meta.notes`, `PROGRESS.md`, `NEXT_STEPS.md`.
