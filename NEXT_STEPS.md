# Next steps

> 2026-11-11: The first middle-layer pass is on master (PR #7). See
> [FPS_IMPROVEMENT_PLAN.md](FPS_IMPROVEMENT_PLAN.md) for the incremental
> FPS-quality handoff.

## Where things stand (2026-11-10)

The middle layer has a first pass (Step 1 below, branch `feat/middle-layer`): a seeded
kit of 30 procedural objects across the Shore biomes, placed by reading the ground,
streamed in three size tiers with simplified far shapes, with collision so the march
walks round coral walls and large objects. The landmark tier gained the Bone Ridge
leviathan skeleton as a feature kind; the GM has not placed it yet. `PROGRESS.md` has
the numbers and an honest list of what still looks off.

What the middle layer still needs, in the GM's order of choice:
- **The look pass.** Objects are flat-coloured low-poly shapes on a very dark ashen
  ground; the references are bright, sunlit and painted. Objects were built as clear
  silhouettes for exactly this pass; the ground palette is part of it.
- **Placing Bone Ridge** (`npm run terrain -- feature …`, see `TERRAIN_AGENT.md`).
- **Crater shallows and sea coast.** Plateaus, sea stacks and arches are in the kit and
  placed by water depth and steep shores, but the current map has almost no shallow
  water by a steep coast; the new geography (Step 2) brings both.
- Objects cast no shadows on the ground yet; the leviathan has no collision.

The new geography is agreed but deliberately not built yet (Step 2). The previous
city-centred trial (painted biome districts, reef walls, scenery v2, relief debug view)
is parked on the local branch `archive/codex-shore-wip`. Its streaming idea was reused,
its code and look were not.

## Look and references

- Lighter than the Shadow Slave novel: weathered, sunlit, adventurous; not grim.
- Realistic rendering is not required. Painted is welcome; pixel art is fine if it buys
  more detail in the first-person view. The style is undecided and comes last, as a
  screen pass over the same world. Build objects as clear silhouettes with simple
  colour that survive any of those passes; don't invest in fine texture.
- The GM's Midjourney references are in `reference/midjourney/` (views from above in
  `aerial/`). They are untracked; ask the GM before committing them, the repo is
  public. Each file is named after what the GM liked about it: read the name as the
  instruction. Compare a screenshot only with references of the same biome and the same
  distance (from above, from the castle towers, eye level).

## Step 1: the middle layer (first pass built)

**Why.** The terrain covers landforms from a few hundred metres to tens of km
(samples ~60–85 m apart). Nothing on master stands between the ground texture and
those landforms: no objects 2–200 m tall with a recognisable shape. At eye level
those are what block the view, stand against the sky and carry known sizes, so they
sell distance. Without them every biome reads as an empty surface.

**What.** A small kit of procedural objects per biome, with distinct silhouettes.
Biome names are the Shore names the readout uses today; the right column is the
reference file in `reference/midjourney/`.

| Biome | Middle-layer objects | References |
|---|---|---|
| crimson coral | coral trees with real branching and wide crowns, fan corals, coral blades and walls with blind passages, brain-coral mounds | `coral_trees .png`, `coral_trees_2`, `coral_trees_3_and_views`, `more_rock_formations` |
| tidal flats and channels | wreck hulls, barnacled boulders, stone paving slabs in the channels, rotten posts | `blocky_rock_formations`, `atmospheric_cloud_formations`, `aerial/coral-and-sand-cut-by-channels` |
| silt mire | golden marsh islands between channels, tube-sponge chimneys, ribs and spines in the silt, dead trunks | `sumpf`, `obelisks` |
| mudflats before the crater | horn-shaped spires, leaning towers | `wetland_approaching the crater` |
| crater shallows | flat coral plateaus standing in clear shallow water (not floating) | `floating_island` |
| black earth | tors and outcrops, golden grass, a lone dead coral tree, scattered bones | `overgrown ruins` |
| ash and the dry east | half-buried giant spiral shells, bleached coral skeletons, skulls and bones, small buttes | `endless dunes of sand in the distance towards the east`, `eastern edge of the map, places that never get wet` |
| Hollow Mountains | boulder fields, rock needles, fallen blocks | `make_this_coral_ravines` (its rock shapes) |
| sea coast | sea stacks, arches, broken cliff blocks | `ocean cliffs say on the west`, `cool_castles_on_cliffs` |
| any biome, rare | half-collapsed towers and walls | `interesting_half_collapsed_ruins_`, `overgrown ruins`, `cool_castles` |

Plus a landmark tier visible from kilometres away (Bone Ridge leviathan skeleton,
the headless colossi, the Crimson Spire), placed by the GM.

**Placement matters as much as the objects.** Stands and groves with clearings
instead of an even scatter; objects follow ridgelines, slope breaks and channel
banks; density thins toward biome edges, so biomes fade into each other on foot.
Placement reads the ground (biome, slope, height, wetness, water), never map
coordinates. Seeded and deterministic.

**Technical notes.**
- Master has no scenery streaming. `archive/codex-shore-wip` has one (seeded cells,
  instancing, size-based LOD, `src/core/scenery.ts`, `src/render/scenery.ts`,
  `SCENERY.md`); its mechanics may be worth taking, its look was rejected.
- Big objects need a cheap far version so their silhouette is visible from
  kilometres, not popping in at a fixed radius.
- Coral walls need collision so travel follows the passages.
- Budget on the Intel UHD with `npm run perf`; check the eye-level saved view of
  every biome against its references.

## Step 2: the new geography (after the middle layer)

Sketch with the GM's references pinned: https://claude.ai/artifact/2AJ7hCm7YPfzdTSnswWiLy

- The city sits at the foot of the Hollow Mountains, north centre. Exploration runs in
  a half ring: west to the cliffs, south down into the wet, east into the dry.
- The lower, the wetter: black downs, coral ravines just below the city, coral and sand
  channels, marsh, mudflats with spires, then the crater sea.
- The crater has no raised rim: the land runs down to cliffs that drop into it. Its
  south side is broken open onto an open ocean. Coral plateaus stand in its shallows.
- The night tide comes in from the ocean through that breach and climbs up from the
  crater; only ground connected to the sea floods.
- The whole west coast is broken cliffs with sea stacks and arches.
- The east dries out toward the edge: grey ash (the old Sea of Ash), then dunes, buttes
  and giant shells, then white sand that never gets wet.
- No hard borders: each biome keeps a recognisable core; blends about a third of a band
  wide.

What the app lacks for it: wetness driven by height and an east–west gradient instead
of wind and rain shadow, a second dry tone (white sand beside grey ash), a tide that
floods only what connects to the ocean, and a landform for ravines cut into a slope.
