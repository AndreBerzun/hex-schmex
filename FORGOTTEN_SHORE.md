# Forgotten Shore: first spatial prototype

This is the user's campaign interpretation of the Dark City region, not a canonical reconstruction. The immediate question is whether distances, elevations and visible destinations feel useful for an expedition. This supersedes the old milestone order: brushes are not the next priority until we have tried this scene.

## Open and inspect

Run `npm run dev` and open `http://localhost:5173/?world=forgotten-shore`, or choose **forgotten-shore** in Examples. For live terrain editing, use `?file=forgotten-shore` instead. The example is bundled for static hosting; `maps/forgotten-shore.json` is the editable working copy. After intentional map changes, copy that file to `worlds/forgotten-shore.json` to update the bundled example.

The scene opens in the exploration interface at true vertical scale with hexes and editing panels hidden. Click the landscape for free flight: mouse to look, WASD to move, Space up, C down, Shift for 10× speed, Esc to release the mouse. Ctrl is reserved for browser shortcuts: Ctrl+W closes a tab and Ctrl+Shift+W closes a window. The Flight selector sets a base speed from 5–250 m/s. Flight stops on release, window blur or tab hiding; terrain/water clearance is 2 m. Structures do not have camera collision. Orbit and Map remain available. The authoring interface is available through `&editor` on a world URL.

 **Visit…** offers city, castle, crater, tree, mountains and patrol views. These are camera bookmarks, not movement nodes. Orbit, zoom and pan remain continuous. **Map** switches to the overhead view.

- **Time:** drag toward 17:15 to see the Spire shadow reach the city. This uses the existing illustrative solar arc, not a calendar/latitude simulation.
- **Sea:** drag from −260 m to +80 m to compare the exposed crater and flooded basin. **Night tide** links this to the clock: rising from 17:00–19:00, falling from 05:00–07:00. Player mode enables this link; dragging Sea switches to manual control. The time control covers 24 hours with twilight, a dark sky and stars. This remains an illustrative solar cycle, without calendar or latitude.
- The Player button now offers a local ground-view prototype. Drag to look and click visible terrain to march there. It uses a 4 km/h campaign pace and a default 600× animation speed; the travel selector changes animation acceleration without changing the marching pace. The camera stays 1.7 m above the rendered terrain. Distance, travel duration and time of day advance together. Stop or Esc pauses movement; +1 h waits an hour. Water deeper than 0.3 m and slopes above roughly 40° stop marching. Routes are direct and do not yet avoid buildings, use roads or support rafts. A VPS server and multiplayer party authority are still future work.

## Chosen dimensions

Coordinates are kilometres east/south from the map origin. Elevations are metres above the scene datum; daytime water is below that datum.

| Landmark | Position | Initial dimensions |
|---|---|---|
| Dark City | 47, 35 | 2.3 km across; outer walls 55 m; towers about 77 m |
| City hill | 47, 35 | Inhabited terrace about +380 m; castle acropolis +490 m |
| Bright Castle | City centre | Central keep and eight towers; highest roof about 284 m above the acropolis |
| Crimson Spire | 40, 36.5 | 1,800 m above its +130 m footing; base diameter 520 m; 7.16 km from city centre |
| Crater | 31, 35 | About 30 km across; uneven floor around −180 to −80 m; flood cap radius 16.7 km |
| Cursed red tree | 15.5, 35 | Roughly 420 m high, crown about 0.9 km across, on a +220 m refuge; 31.5 km from city |
| Hollow Mountains | Northern map | Roughly 25–35 km from city; several kilometres of relief |
| Six stone walkers | Around city | 90 m nominal figures; 96.75 m to helmet and 104.4 m to spear tip, 12.5–14.9 km from city; static walking poses |

The Spire's size is intentionally supernatural. Its height and west-southwest placement permit its shadow to reach the elevated city under the existing late-afternoon sun. The shadow is an analytic approximation of its tapered silhouette; it affects terrain and landmark lighting. Walls, buildings, tree and statues do not yet cast their own shadows.

A direct crossing toward the tree is over 30 km. At an **assumed** effective 2 km/h across broken terrain, it takes over 15 hours before detours, encounters or rests, which is too long for the prototype's 12-hour day. An **assumed** raft pace of 3 km/h gives roughly 10–11 hours. The Player prototype now implements the 4 km/h baseline march; the slower 2 km/h broken-ground and 3 km/h raft examples above remain scenario-planning assumptions. Terrain-dependent pace, rests and rafting are not implemented.

The tree is a small, hazy silhouette from the city in this clear-weather preview. The renderer has no Earth curvature or weather simulation. Inhabitants can see individual nearby silhouettes under favourable conditions, but no visible line reveals the patrol's wide circuit.

## Implementation and limits

The existing operation stack defines the crater, rim, mineral ribs, city platforms and mountains. Ridges now accept half-widths down to 100 m, avoiding the old one-kilometre minimum. Terrain erosion is disabled for this world so spatial changes prepare in about two seconds and preserve the building platforms. At 1024 design samples on the long side, ground samples are about 73 m apart. Fine channels, streets, walkable interiors and cliff overhangs are not represented.

Landmarks are deterministic procedural geometry stored in `features`, with dimensions in km/metres. Repeated parts use four instanced batches and share the terrain's atmosphere and sun. `environment` stores the mineral palette, haze and flood basin. Unknown feature kinds remain metadata. Loading other example worlds clears the custom geometry, flood and palette. JSON save/load preserves the additions; the single-file build includes the scene.

The city is circular and regular, roofs and tree crowns are visibly simple, and the ground is still soft at close range. The distant mountains are currently very serrated. This is a scale experiment, not finished environment art. Patrol animation and correct terrain contact for moving feet are not implemented.

## Verify

- `npm test`: geography, save/load, tide boundary and narrow ridge tests plus the existing suite.
- `npm run check:player`: ground eye height, marching distance/time, click destinations, stopping at water, day/night, 100 near-water flood changes, high-DPI pixel budget and visible graphics-context recovery.
- `npm run check:flight`: actual browser pointer capture, mouse look, WASD, ascent/descent, boost, input release and camera-mode transitions.
- `npm run check:shore`: actual browser camera height, flood sampling, shader compilation, landmark edit/undo and cleanup on world switch; also captures high-water and shadow views.
- `npm run shots -- forgotten-shore`: all saved inspection views.
- `npm run perf -- forgotten-shore`: integrated-GPU timings.
- `npm run check:bake`: existing erosion pipeline regressions.
- `npm run build:single`: portable HTML in `dist-single/index.html`.


## Viewing controls and graphics stability

Hexes, Labels, debug material views and the altitude/GPU readout are available in the exploration toolbar again; terrain-authoring controls remain hidden. Altitude displays metres above the scene datum and metres above the visible terrain/water surface.

A reported Chrome failure while changing flood level and flying near water was not reproduced. Kernel logs showed no matching GPU reset or OOM event. The GM subsequently narrowed the symptom to the window closing while holding Ctrl and movement keys. The old Ctrl boost binding conflicted with Ctrl+W (close tab) and Ctrl+Shift+W (close window); boost now uses Shift, and C descends. The earlier headless check did not establish desktop shortcut safety. The flight regression also omitted modifier flags and only advanced one boosted step. It now sends actual modifier flags and exercises sustained boosted movement while rendering. The browser regression exercises 100 flood changes near the water on the real Intel GPU. Safeguards cap the viewport at about 1.8 million render pixels, skip unnecessary hover picking, pace changing sun-shadow work, and display a Reload scene button if WebGL loses its context. These checks do not guarantee that Chrome cannot crash.
