# Forgotten Shore

A campaign layout for the Shadowdark westmarches, not a reconstruction of the novel's
map. Open `?world=forgotten-shore`, or `?file=forgotten-shore` for the editable map.
The design intent is also in the map's `meta.notes`, so `npm run terrain -- context
forgotten-shore` shows it to the next session.

## Size

14 × 12 hexes of 6 miles, about 130 × 130 km including the margin. Terrain samples are
about 78 m apart after erosion (1536²). A full bake takes about 30 s on the Intel UHD.

## Seven biomes

Taken from the Shadowdark hex terrain table (rulebook p. 132), one Shore biome per row.
They follow from the landforms and the existing climate rules; there are no painted
biome patches.

| Shadowdark terrain | Shore biome | Where | What makes it |
|---|---|---|---|
| Desert/arctic | Sea of Ash | west | dry by moisture op; large dunes, buttes in the south, ash ridges on steep dry slopes |
| Swamp | Silt Mires | south-west | flat, wet, a few metres above the day sea; dark silt with pools |
| Grassland | black earth | the downs north of the city, the eastern tablelands, between the others | the default ground |
| Forest/jungle | crimson coral labyrinth | lowlands south of the city | moist ground below the coral line (220 m), broken into stands with clearings |
| River/coast | tidal flats and channels | the drowned south coast and the crater breach | gentle ground below the night tide that is neither coral nor mire |
| Ocean | the Dark Sea | the crater in the south-east | below the day sea level |
| Mountain | Hollow Mountains | across the north, peaks up to ~3.8 km; the Hollow Spur reaches toward the city | mineral rock and scree on steep ground |

Moisture comes from the south (the inlet and the crater sea), so the coral lowlands are
wet and the ash sea sits in the dry west. The surface readout and the terrain CLI use
the Shore names.

## The city and what it sees

The Dark City sits at the map centre on a 330 m hill; the Bright Castle's hill is 420 m.
It is not the highest point: the downs to the north rise above it, the mountains far
above. From the castle towers:

- **visible:** the Crimson Spire to the south-west (on an islet in the coral, its footing
  flooded at night), the mountains and the Hollow Spur, the coral lowlands toward the crater;
- **just visible:** the Soul Tree's crown above the Ash Ridges to the west;
- **hidden:** the crater water behind its rim and all four headless colossi (on the
  northern downs, on the southern road, deep in the ash, under the Hollow Spur).

## Tide

Day sea at 0 m. At night the tide rises to +120 m across the whole region, flooding the
mires, the tidal flats, the lower coral and the Spire's footing; the city and the downs
stay dry.

## Saved views

Castle towers: `castle-to-spire`, `castle-to-mountains`, `castle-to-west`,
`castle-to-crater`. Eye level (1.7 m): `city-approach`, `ash-sea`, `ash-buttes`,
`coral-lowlands`, `coral-to-spire`, `silt-mires`, `tidal-flats`, `black-downs`,
`tablelands`, `crater-overlook`, `mountain-valley`. Overview: `region-oblique`,
`region-topdown`, `range-mid`, `valley-low`, `hex-closeup`.

## Limits

From above and from the castle the biomes read as distinct regions. At eye level the
lowlands are still open surfaces: coral is a red ground material, the ash sea and the
flats have dunes and swells but nothing standing on them. That is the middle layer,
recorded in `NEXT_STEPS.md`. Mountains still lack the erosion detail of the reference
images.
