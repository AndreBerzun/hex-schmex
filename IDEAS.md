# Ideas

The one list of open improvement ideas and visual gaps. What has been built is in
`PROGRESS.md`, the campaign layout in `FORGOTTEN_SHORE.md`. Add new ideas here; delete an idea
when it ships or is dropped, so nothing done or abandoned stays on the list.

How to work through them: the three next steps below in order, then one biome at a time, end to
end. Every eye-level ingredient (ground shape, painted textures, objects, shadows, sky, finish)
until the biome's fixed spot in `npm run shots:biomes` reads like its Midjourney reference, then
the next biome. Judge a step by how far the shots move toward the reference, not by steps
completed.

## Next, in this order

The GM likes the painted ground of all seven biomes (hex-schmex#11). These three come before any
further look work.

**1. Performance**

The last measurements (1920×1080, GPU median, Intel UHD) were 36–49 ms at eye level, before the
twelve textures of mountains, tidal flats, ash and mire came in. Nothing has been measured since.
- Measure first, once, interleaved: master after hex-schmex#11 against `88792ca` (before the
  four biomes) and `2071e93` (before the ground scene), on the fixed spots of all seven biomes.
  Single runs drift ±5 ms.
- The 1 m ground mesh near the player costs about 8–10 ms (249 tiles instead of 191). In biomes
  without the detail layer the intermediate levels carry nothing; drop them there and shrink the
  1 m radius to what the cover rings need (28 m).
- Ground pixels read up to two projection planes × two tile ladder levels per material, out of
  21 texture layers, plus per-pixel noise for the patches. Options: one plane and one level
  outside a narrow blend band; patch weights baked per tile instead of noise per pixel; the far
  ground (beyond a few hundred metres) baked into a low-resolution painted clipmap, so a far
  pixel does one fetch.
- Sun shadow map about 2 ms, ground cover about 3 ms: check both again after the mesh change.
- A render scale for eye level (the painterly pass already hides softness) as the fallback if
  the above does not reach 60 fps.

**2. Better models, more continuous generation**

Models:
- Coral trees are rounded umbrellas, not the gnarled trees of the reference; more diverse tree
  and coral models in general.
- Coral walls are smooth red sheets with spikes on top. Walls and ravines could become ground
  instead of objects, keeping the passages.
- Mire reed-bed islands are faceted lumps with spike cones; tube sponges read as posts at a
  distance.
- Ash buttes are plain stepped mesas. Mire towers come out as steep-sided mesas, not slender
  pinnacles (a 300 m tower is three or four terrain samples wide); pinnacles need meshes.
- Interesting structures from simple shapes and good textures, as in
  https://www.youtube.com/watch?v=_aJzFbuLi1M

Continuous generation:
- Entering unseen ground stalls one frame by 100 ms and more while objects are generated and the
  march route is planned. Move both off the frame (worker, or time-sliced over frames) so walking
  and flying never hitch.
- Objects pop in and out at their detail distances; fade them instead.
- Far tors turn into simple blobs; objects 150 m and further away float or sink by 1–2 m because
  the far ground drops the finest detail. Place them on the height the far mesh actually draws.

**3. Remove the high-contrast shadows**

The Mignola ink shadows go: near-black shadow shapes with ragged edges, the flattened sun term in
lit areas, backlit objects turning into full silhouettes. Back to normal sun and sky lighting with
the sun shadow map at natural strength and the painterly pass's bluish shadow tint. Check the ink
lines on depth jumps in the same step; keep them only if they still sit well without the black.

## Eye-level scene, biome by biome

All seven biomes have painted ground textures and ground cover near the player (hex-schmex#11).

**Crimson coral**
- No dunes; the swells and hummocks of the relief layer are the only shape in the floor.
- The coral turf sprigs are small; no clumps stand up at your feet.
- The purple fan coral carries a blotchy rock tone.

**Black earth (downs and tablelands)**
- The painted grass reads as fine grain, golden on golden at a grazing angle.
- Grass in shadow patches stays lit.
- Knolls are similar in size and shape and read as hummocks from above; rock on the crests is a
  colour change, not a form.
- Gravel patches on distant knolls show straight edges where the mesh is coarse; grass along
  gullies stripes far slopes.
- Outcrop boulders carry the boulder kit's yellow-green lichen tops.
- The lowest mountain slopes get turf patches; the ash has a small grassy mound at its edge.

**Hollow Mountains**
- Smooth cones: the reference's cliff walls and erosion detail need geometry, not texture.
- The 765 m slope view is still brown earth; distant faces show faint horizontal banding.

**Tidal flats and channels**
- Scour and channels in the ground itself.
- The wet sheen also covers dry-looking mud lumps; wrack shows only where its patches meet the
  camera.
- Shells are small specks beyond a few metres.

**Sea of Ash**
- Dunes and wind-scoured hollows in the ground itself.
- The charred ridge still shows the texture's cobble pattern.

**Silt Mires**
- Raised islands in the ground itself; water covers much of the foreground.

## Atmosphere

- Atmospheric fog. Today the haze only depends on distance and height.

## Middle layer

- Bone Ridge, the leviathan skeleton: not placed yet (the GM chooses where), and it has no
  collision.
- Coral plateaus, sea stacks and arches barely appear: the current map has almost no shallow
  water by a steep shore. They come with the new geography.

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
