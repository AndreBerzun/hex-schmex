# Ideas

The one list of open improvement ideas and visual gaps. What has been built is in
`PROGRESS.md`, the campaign layout in `FORGOTTEN_SHORE.md`. Add new ideas here; delete an idea
when it ships or is dropped, so nothing done or abandoned stays on the list.

How to work through them: one biome at a time, end to end. Every eye-level ingredient (ground
shape, painted textures, objects, shadows, sky, finish) until the biome's fixed spot in
`npm run shots:biomes` reads like its Midjourney reference, then the next biome. Judge a step by
how far the shots move toward the reference, not by steps completed.

## Eye-level scene, biome by biome

Coral and the downs are in progress (hex-schmex#11). The other five biomes have only the new sky
and the painterly finish.

**Crimson coral**
- The ground is flat: no dunes, no foreground stones or shells.
- The coral turf is a flat carpet at your feet, with no clumps that stand up.
- Trees are rounded umbrellas, not the gnarled trees of the reference.
- Coral walls are smooth red sheets with spikes on top. Walls and ravines could become ground
  instead of objects, keeping the passages.
- The purple fan coral carries a blotchy rock tone.

**Black earth (downs and tablelands)**
- The painted grass reads as fine grain, golden on golden at a grazing angle, without tufts
  standing up.
- Knolls are similar in size and shape and read as hummocks from above; rock on the crests is a
  colour change, not a form.
- Gravel patches on distant knolls show straight edges where the mesh is coarse; grass along
  gullies stripes far slopes.
- Outcrop boulders carry the boulder kit's yellow-green lichen tops.
- The lowest mountain slopes get turf patches; the ash has a small grassy mound at its edge.

**Sea of Ash**
- Dunes and wind-scoured hollows in the ground itself.
- Pale and soft at eye level; the buttes are plain stepped mesas.

**Silt Mires**
- Raised islands and channels in the ground itself.
- Reed islands are flat golden patches; tube sponges read as posts at a distance.
- The towers come out as steep-sided mesas, not slender pinnacles (a 300 m tower is three or
  four terrain samples wide); pinnacles need meshes.

**Tidal flats and channels**
- Scour and channels in the ground itself.

**Hollow Mountains**
- The faces are large smooth surfaces with banded rock colour, without the erosion detail of the
  references.

## Ink shadows

From the Mignola work in hex-schmex#11.
- At noon there is little black on the ground; the look depends on the time of day.
- Backlit objects become full silhouettes with no rim of colour.
- The hatching is drawn in screen space and swims slightly while walking.

## Atmosphere

- Atmospheric fog. Today the haze only depends on distance and height.

## Middle layer

- More diverse tree and coral models.
- Interesting structures from simple shapes and good textures, as in
  https://www.youtube.com/watch?v=_aJzFbuLi1M
- Bone Ridge, the leviathan skeleton: not placed yet (the GM chooses where), and it has no
  collision.
- Coral plateaus, sea stacks and arches barely appear: the current map has almost no shallow
  water by a steep shore. They come with the new geography.

## LOD and frame cost

- LOD. What shows today: far tors turn into simple blobs; objects 150 m and further away float or
  sink by 1–2 m because the far ground drops the finest detail.
- Eye level at 1920×1080 costs about 37 ms GPU in the coral on the Intel UHD (hex-schmex#11).
- Entering unseen ground stalls one frame by 100 ms and more while objects are generated and the
  march route is planned.

## The new Shore geography

Agreed with the GM and parked until the eye-level scene is further along. Sketch with the GM's
references pinned: https://claude.ai/artifact/2AJ7hCm7YPfzdTSnswWiLy

- The city sits at the foot of the Hollow Mountains, north centre. Exploration runs in a half
  ring: west to the cliffs, south down into the wet, east into the dry.
- The lower, the wetter: black downs, coral ravines just below the city, coral and sand
  channels, marsh, mudflats with spires, then the crater sea.
- The crater has no raised rim: the land runs down to cliffs that drop into it. Its south side is
  broken open onto an open ocean. Coral plateaus stand in its shallows.
- The night tide comes in from the ocean through that breach and climbs up from the crater; only
  ground connected to the sea floods.
- The whole west coast is broken cliffs with sea stacks and arches.
- The east dries out toward the edge: grey ash (the old Sea of Ash), then dunes, buttes and giant
  shells, then white sand that never gets wet.
- No hard borders: each biome keeps a recognisable core; blends about a third of a band wide.

What the app lacks for it: wetness driven by height and an east–west gradient instead of wind
and rain shadow, a second dry tone (white sand beside grey ash), a tide that floods only what
connects to the ocean, and a landform for ravines cut into a slope. The mirrored surround also
shows a faint twin of the crater in the haze beyond the east and south edges.

## Campaign features

Not started; `BRIEF.md` §12 has the detail.
- Players with their own views, and a shared party the GM moves.
- Line-of-sight reveal: seen now, seen before, never seen.
- Torchlight at night.

## Known bugs

- The live file link sometimes misses a terminal write that comes right after the browser saved
  the same map (once in four `check:layers` runs). In a fresh worktree `check:layers` fails at
  that step every time.
