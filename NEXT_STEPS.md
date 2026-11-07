# Handoff: terrain materials and flight controls

## Current direction

Focus on the terrain viewer's visual and technical quality. The GM wants to write
the campaign keys personally. Party/session state, map-linked campaign notes,
discovery tracking and multiplayer are deferred. Whether Forgotten Shore is the
right starting region is still an open campaign decision.

The first material pass is intentionally modest. The GM did not readily notice
it in the live Forgotten Shore scene. Review the actual result together before
investing in more material work. [MATERIALS.md](MATERIALS.md) contains fixed
before/after images, raw timings and the remaining limitations.

## Next improvements to discuss

1. **Make visual changes easy to inspect.** Provide a useful ground-material
   bookmark and a forest bookmark, or a simple comparison toggle, so the GM can
   evaluate a change in the running app. Ground detail is visible near the surface
   in daylight; forest detail is in Alpine Valley and Coastal Marches. The default
   Forgotten Shore overview does not demonstrate the close-up change well.
2. **Make forests look less like repeating cushions.** Improve crown irregularity,
   stand variation, lighting and depth cues. The current canopy is still a flat
   terrain material with perturbed normals. It has no silhouettes, trunks or
   undergrowth. The original brief excludes individual tree meshes; discuss any
   geometry-based approach before expanding that scope. Compare both low and
   regional views against references 03 and 04.
3. **Improve flat-ground structure.** Explore more convincing mineral dust, soil,
   gravel and vegetation breakup, with material-specific detail and transitions.
   Fine shader normals cannot fix coarse geometry. Distinguish surface-detail
   improvements from any proposal to increase local mesh/heightfield resolution.
   Soft riverbanks and broad marsh boundaries are additional candidates.
4. **Reduce the detail cost before adding more.** The first pass adds roughly
   1–4 ms GPU in fixed close-up comparisons. Keep mip filtering, subpixel fades,
   the cheap overview path and zero idle redraws. Compare GPU time and actual
   rendered FPS on this notebook, including near-water boosted flight.

Forgotten Shore refinements can be discussed separately: the Hollow Mountains
remain excessively serrated, the city is regular and schematic, and the giant
tree canopy is faceted. Map content, scale decisions and new hex keys remain the
GM's creative work.

## Completed and verified

- Added locally generated ground detail and a 512² canopy lookup, muted greens
  and softened forest transitions. Campaign map JSON and notes are unchanged.
- Replaced the dangerous **Ctrl boost / Shift descent** bindings with
  **Shift boost / C descent**. WASD moves, Space ascends, Esc releases the mouse.
  Ctrl+W and Ctrl+Shift+W are browser close shortcuts; do not restore Ctrl boost.
- Reserved Ctrl/Command/Alt combinations clear held movement. Pointer-lock loss
  clears keys; acquisition does not erase an immediately pressed movement key.
- Flight checks now use actual modifier flags and sustained Shift+W+Space at
  maximum speed while rendering changing flood levels. Repeated runs passed
  after the pointer-lock correction. This supports the control fix; it is not a
  guarantee against all browser/GPU crashes.
- All 40 unit tests, TypeScript, normal and single-file builds pass. Material
  checks, standard screenshots, player shoreline/context-loss checks and the
  normal GPU performance run passed during this session.
- Latest standard saved-view GPU times at 1280×720: Alpine 11.0–16.1 ms, Coastal
  9.5–16.6 ms, Forgotten Shore 5.4–20.0 ms. Automated orbit drew about 41/39/30
  frames/s respectively. GPU time alone does not establish 60 fps.

## Local workflow and constraints

- The user explicitly requires **no external searches or outbound tool requests
  without explicit authorization**, especially while personal files are
  accessible. Do not infer network permission from Full access or automatic
  approval settings. No push was requested for this session.
- Browser checks use local Vite pages. Prefix them with `TP_BROWSER_OFFLINE=1`;
  the helper disables browser background traffic, blocks external DNS and routes
  non-loopback browser requests to an unused local proxy. This is a test-browser
  configuration, not an OS-wide firewall. Do not download texture assets or call
  an image service without authorization.
- Sandbox startup fails here with
  `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. Local commands
  have run through approved escalation. Do not change host sandbox settings as
  part of terrain work.
- At handoff the user's dev server was running from this checkout at port 5173.
  Use `?world=forgotten-shore&tod=12` for daylight, or
  `?world=coastal-marches` / `?world=alpine-valley` for forest inspection.
- `maps/compact-650m.json` was already untracked before this session; it was not
  edited or included in the commit.
- Campaign material is at
  `/home/andre/Desktop/Ewa/TTRPG/Campaigns/Dreammarches 2026/`.
  It contains a reference compendium and campaign notes; no further access is
  necessary to continue the rendering work.

Useful checks (all dependencies are already installed):

```bash
npm test
npm run build
npm run build:single
TP_BROWSER_OFFLINE=1 npm run check:materials -- review
TP_BROWSER_OFFLINE=1 npm run check:flight
TP_BROWSER_OFFLINE=1 npm run check:player
TP_BROWSER_OFFLINE=1 npm run shots
TP_BROWSER_OFFLINE=1 npm run perf -- alpine-valley coastal-marches forgotten-shore
```
