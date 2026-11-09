# Next steps

## Where things stand (2026-11-09)

The Forgotten Shore gets a new geography: seven biomes after the Shadowdark hex
terrain table (rulebook p. 132), the Dark City at the centre, erosion on, biomes
following from the landforms instead of painted patches. Work happens on branch
`feat/shore-geography`; `FORGOTTEN_SHORE.md` describes the result once merged.

The previous city-centred trial (painted biome districts, reef walls, scenery v2,
relief debug view) is parked on the local branch `archive/codex-shore-wip`. It was
rejected visually; take pieces from it only deliberately.

## Step 2: the middle layer (next session)

**Why.** The terrain covers landforms from a few hundred metres to tens of km
(samples ~60 m apart), and the debris layer covers pebbles and knee-high coral.
Nothing in between: no objects 5–200 m tall with a recognisable shape. At eye
level those are what block the view, stand against the sky and carry known
sizes, so they sell distance. Without them every biome reads as an empty surface.

**What.** A small kit of procedural objects per biome, with distinct silhouettes:

| Biome | Middle-layer objects |
|---|---|
| Crimson labyrinth | coral trees with real branching, fan corals, layered coral blades and walls with blind passages, brain-coral mounds |
| Sea of ash | grey dead-coral skeletons, half-buried giant spiral shells, ash drifts banked against rock |
| Black downs | tors and outcrops, lone dead coral trees, scattered bones |
| Silt mires | tube-sponge chimneys, ribs and spines sticking out of the silt |
| Tidal channels | sea stacks, arches, wreck hulls, barnacled boulders |
| Hollow Mountains | boulder fields, rock needles, fallen blocks |
| Dark Sea shore | stacks and islets |

Plus a landmark tier visible from kilometres away (Bone Ridge leviathan skeleton,
the headless colossi), placed by the GM.

**Placement matters as much as the objects.** Stands and groves with clearings
instead of an even scatter; objects follow ridgelines, slope breaks and channel
banks; density thins toward biome edges. Seeded and deterministic as today.

**Technical notes.**
- Reuse the existing scenery streaming (seeded cells, instancing, size-based LOD).
- Big objects need a cheap far version so their silhouette is visible from
  kilometres, not popping in at a fixed radius.
- Labyrinth walls need collision so travel follows the passages.
- Budget on the Intel UHD with `npm run perf`; check eye-level shots per biome.
