# Forgotten Shore

A campaign layout for the Shadowdark westmarches, not a reconstruction of the novel's
map. Open `?world=forgotten-shore`, or `?file=forgotten-shore` for the editable map.
The design intent is also in the map's `meta.notes`, so `npm run terrain -- context
forgotten-shore` shows it to the next session.

## Size

14 × 12 hexes of 6 miles, about 130 × 130 km including the margin. Terrain samples are
about 85 m apart after erosion (1536²). A full bake takes 30–36 s on the Intel UHD.

## Seven biomes

Taken from the Shadowdark hex terrain table (rulebook p. 132), one Shore biome per row.
They follow from the landforms and the existing climate rules; there are no painted
biome patches.

| Shadowdark terrain | Shore biome | Where | What makes it |
|---|---|---|---|
| Desert/arctic | Sea of Ash | west | dry by moisture op; dunes up to ~170 m, dark flat-topped buttes in the south, ash ridges on steep dry slopes |
| Swamp | Silt Mires | south-west | flat, wet, a few metres above the day sea; dark silt, steep-sided towers up to 300 m, black sinkhole pools |
| Grassland | black earth | the downs north of the city, the eastern tablelands, between the others | the default ground; the tablelands top out near 950 m and a canyon drains them west |
| Forest/jungle | crimson coral labyrinth | lowlands south of the city | moist ground below the coral line (220 m), broken into stands with clearings; coral massifs up to 260 m and sinkholes |
| River/coast | tidal flats and channels | the drowned south coast and the crater breach | gentle ground below the night tide that is neither coral nor mire; sea stacks up to 220 m |
| Ocean | the Dark Sea | the crater in the south-east | a 44 km crater, rim 1.8–2.2 km, floor −1.2 km |
| Mountain | Hollow Mountains | the north edge and beyond | a wall of 10–14 km summits whose crest runs along the edge; the map holds its south face |

Moisture comes from the south (the inlet and the crater sea). The crater rim casts a rain
shadow to its north; moisture ops keep the coral lowlands and the tablelands wet anyway.
The surface readout and the terrain CLI use the Shore names.

## The Hollow Mountains

The Hollow Mountains are their own region in the lore, larger than this map. Their crest
runs along the north edge and continues past both corners; the Hollow Crown straddles the
edge. Outside the map the renderer mirrors the terrain and fades it into haze, so the
wall reads as going on into the distance. The playable hexes in rows 01–02 are its south
face, cut by four glacial troughs that end in small lakes at the foot of the wall. The
Hollow Spur (~5 km) reaches toward the city; the Hollow River leaves the middle trough
through a gorge in the downs. Summits above 9 km carry snow.

## The Dark Sea crater

One crater, 44 km rim to rim, entirely on the map. The rim stands 1.8–2.2 km high; the
terraced inner wall drops about 3 km to a flat floor at −1.2 km. At the centre the floor
falls away into the Deep (−2.6 km): this is where the Dark Sea rises at night. There is no
island. To the south-west the rim is breached toward the tidal flats, with a sill at 15 m:
above the day sea, below the night tide, so at night the sea pours out through the breach
over the flats. By day the crater holds its water at about the sill level, a little above the day sea.

## The city and what it sees

The Dark City sits at the map centre on a 330 m hill; the Bright Castle's hill is 420 m.
From the castle towers:

- **visible:** the Crimson Spire to the south-west (on an islet in the coral, its footing
  flooded at night), the mountain wall across the whole north with the Hollow Spur in
  front of it, the crater rim as a long wall to the south-east;
- **just visible:** the Soul Tree's crown above the Ash Ridges to the west;
- **hidden:** the crater water behind its rim.

`tests/shore.test.ts` checks these sightlines on the op stack. Of the four headless
colossi, the one on the northern downs and the one in the ash are hidden by terrain; the
ones on the southern road and under the Hollow Spur stand 70–80 m above the line of sight
(of their 200 m) and rely on distance and haze.

## The middle layer

Between the ground and the landforms stands a layer of objects 1–150 m tall, grown from the
ground at load time and the same on every visit. What stands where follows the biome, the
slope, crests, the foot of steep faces, channel banks and water depth; it never reads map
coordinates. Objects stand in groves and fields with clearings between, and thin out over the
last few hundred metres of a biome, so biomes fade into each other on foot.

| Biome | What stands there |
|---|---|
| crimson coral | coral trees with wide red crowns in stands, fan corals, brain-coral mounds, knee-high coral clumps, and a labyrinth of coral walls 5–12 m high with passages and blind alleys |
| tidal flats and channels | wreck hulls, mossy and barnacled boulders, paving slabs along the channels, rows of rotten posts, the odd coral tree |
| silt mire | golden reed islands, tube-sponge chimneys, dead trunks along the banks, ribs in the silt |
| mudflats (tidal flats and mire) | fields of horn-shaped spires up to 100 m, leaning towers |
| shallow water | flat coral plateaus standing in it; sea stacks and arches off steep shores |
| black earth | tors on the crests, golden grass, boulders at the foot of slopes, a lone dead coral tree, scattered bones |
| ash | half-buried giant spiral shells, bleached coral skeletons, giant skulls, buttes |
| Hollow Mountains and rock | boulder fields and fallen blocks at the foot of the faces, rock needles |
| anywhere, rare | half-collapsed towers and ruined walls |

Coral walls, boulders, tors and the larger objects block the march; the party walks round
them. Small objects fade out at a distance, large ones (spires, towers, buttes, sea stacks,
plateaus) stay visible for up to 20 km as simplified shapes.

The landmark tier is placed by the GM through the terrain CLI (`feature`): the Crimson
Spire, the headless colossi and the Bone Ridge leviathan skeleton (`leviathan-skeleton`,
not placed yet).

## Tide

Day sea at 0 m. At night the tide rises to +120 m across the whole region, flooding the
mires, the tidal flats, the lower coral and the Spire's footing; the towers, stacks and
massifs taller than that become islands. The city and the downs stay dry.

## Saved views

Castle towers: `castle-to-spire`, `castle-to-mountains`, `castle-to-west`,
`castle-to-crater`. Eye level (1.7 m): `city-approach`, `ash-sea`, `ash-buttes`,
`coral-lowlands`, `coral-to-spire`, `silt-mires`, `mire-towers`, `tidal-flats`,
`black-downs`, `tablelands`, `mountain-valley`. On the crater rim (40 m, on a crag):
`crater-overlook`. Overview: `region-oblique`, `region-topdown`, `crater-aerial`,
`range-mid`, `valley-low`, `hex-closeup`.

## Limits

- Towers, stacks and buttes come out as steep-sided mesas, not slender pinnacles: at
  85 m samples a 300 m tower is three or four samples wide. Pinnacles need meshes, like
  the landmarks.
- Mountain faces are large smooth surfaces with banded rock colour; they lack the
  erosion detail of the reference images.
- The mirrored surround shows a faint twin of the crater in the haze beyond the east and
  south edges.
- The middle layer has simple, flat-coloured shapes; the look pass is still to come (`NEXT_STEPS.md`).
