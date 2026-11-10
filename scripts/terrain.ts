// Terrain CLI: lets a Claude Code session (or a person) look at and edit a map file. See TERRAIN_AGENT.md.
//
//   npm run terrain -- <command> [args]
//
// Map files live in maps/<name>.json (a bare name means that path). A browser running `npm run dev`
// that is linked to the same file picks every write up live, as one undoable step.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { opCatalog } from '../src/agent/catalog';
import { buildContext, describeEdit, describeOp } from '../src/agent/context';
import { renderMapImage, type Overlay } from '../src/agent/mapImage';
import { layeredProbe } from '../src/agent/layered';
import { decodeFoundation, foundationKey, type Foundation } from '../src/core/layers';
import { ToolExecutor, diffOps, type ToolLogEntry } from '../src/agent/tools';
import { encodeRGB8 } from '../src/core/png';
import type { World } from '../src/core/types';
import { cloneWorld, defaultWorld, loadWorld, serializeWorld } from '../src/core/world';
import { Resolver, type PointExpr } from '../src/core/resolve';

const MAPS = 'maps';
const HISTORY_KEEP = 50;

const argv = process.argv.slice(2);
const flags: Record<string, string | true> = {};
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v !== undefined && !v.startsWith('--')) { flags[k] = v; i++; } else flags[k] = true;
  } else pos.push(a);
}
const flag = (k: string) => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);

function mapPath(arg: string | undefined): string {
  if (!arg) fail('missing map name (e.g. "my-marches" for maps/my-marches.json)');
  currentPath = arg.includes('/') || arg.endsWith('.json') ? arg : join(MAPS, `${arg}.json`);
  return currentPath;
}
function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}
function readMap(path: string): World {
  if (!existsSync(path)) fail(`${path} does not exist (create it with: npm run terrain -- new ${basename(path, '.json')})`);
  return loadWorld(JSON.parse(readFileSync(path, 'utf8')));
}
function historyDir(path: string) { return join(dirname(path), '.history', basename(path, '.json')); }

function writeMap(path: string, before: World | null, after: World, label: string) {
  if (before) {
    const dir = historyDir(path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`), serializeWorld(before));
    const old = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - HISTORY_KEEP))) unlinkSync(join(dir, f));
  }
  const ops = before ? diffOps(before, after) : [];
  after.meta.edits = [...(after.meta.edits ?? []), { at: new Date().toISOString(), label, ops }].slice(-20);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeWorld(after) + '\n');
}

function bakePath(path: string) { return join(dirname(path), '.bake', `${basename(path, '.json')}.bin`); }

function readBake(path: string): Foundation | null {
  const f = bakePath(path);
  if (!existsSync(f)) return null;
  try { return decodeFoundation(new Uint8Array(readFileSync(f))); } catch { return null; }
}

let currentPath = '';
function probeFor(w: World) {
  const bake = currentPath ? readBake(currentPath) : null;
  const lp = layeredProbe(w, { res: Number(flag('res') ?? 384), bake });
  if (lp.source === 'design') {
    const why = bake ? 'the bake is out of date (ops or erosion settings changed since)' : 'no bake yet';
    console.error(`note: ${why}; showing the op stack before erosion. Open the map in the browser to bake it.`);
  }
  return lp.probe;
}

function bakeStatus(path: string, w: World): string {
  const b = readBake(path);
  if (!b) return 'foundation: no bake yet (open the map in the browser once to bake it)';
  return b.key === foundationKey(w) ? `foundation: baked by the browser, ${b.nx}x${b.ny} px, current` : 'foundation: bake out of date (ops or erosion changed); the browser re-bakes on open';
}

function printLog(log: ToolLogEntry[]) {
  for (const l of log) console.log(`${l.ok ? 'ok ' : 'ERR'} ${l.name}: ${l.result}`);
}

/** Run tool calls on a copy; write only if all succeeded (or --partial). */
function applyCalls(path: string, calls: { name: string; input: Record<string, unknown> }[], label: string) {
  const world = readMap(path);
  const draft = cloneWorld(world);
  const needsProbe = calls.some((c) => c.name === 'query_region');
  const ex = new ToolExecutor(draft, needsProbe ? probeFor(world) : null, world);
  const log = calls.map((c) => ex.run(c.name, c.input));
  printLog(log);
  const failed = log.filter((l) => !l.ok).length;
  if (failed && !flags.partial) {
    console.log(`\n${failed} call(s) failed; nothing was written. Fix them, or pass --partial to keep the ones that worked.`);
    process.exit(1);
  }
  if (JSON.stringify(draft) === JSON.stringify(world)) { console.log('no changes'); return; }
  writeMap(path, world, draft, label);
  console.log(`\nwrote ${path}: "${label}"`);
}

function parseJson(text: string, what: string): unknown {
  const src = text === '-' ? readFileSync(0, 'utf8') : text;
  try { return JSON.parse(src); } catch (e) { fail(`${what} is not valid JSON: ${(e as Error).message}`); }
}

function parseValue(v: string): unknown {
  if (v === 'true' || v === 'false') return v === 'true';
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : v;
}

const HELP = `terrain CLI — look at and edit map files (maps/<name>.json). See TERRAIN_AGENT.md.

Look
  list                                   map files
  context <map>                          world summary, op list (hex terms), per-hex elevation/surface tables
  map <map> [out.png] [--width 800] [--ops] [--highlight id,id]
                                         top-down PNG with hex ids (default shots/_tmp/<map>-map.png);
                                         --ops draws op lines/centres, --highlight only those ops
  query <map> <hex> [hex …] | --bbox <hexA> <hexB>
                                         per-hex min/mean/max elevation, slope, surface
  ops                                    op types and their parameters
  show <map> <op-id>                     one op in full

Edit (each command = one undo step in a linked browser; always pass --label "what and why")
  new <map> [--from <example>] [--cols 10 --rows 10 --hex-miles 6 --orientation flat|pointy] [--title "…"]
  add <map> '<op json>' [--index n]
  update <map> <op-id> '<patch json>'
  remove <map> <op-id>
  move <map> <op-id> <index>
  set <map> <path> <value>               e.g. climate.snowlineM 2400, erosion.preset heavy
  sculpt <map> '<json>'                  direct height edit on the eroded ground, no re-erosion:
                                         {"tool":"raise|lower|flatten|smooth", "region":{…} | "hexes":[…] | "points":[…],"radiusKm":3,
                                          "amountM":300 (raise/lower), "targetM":420 (flatten), "scaleKm":1 (smooth), "falloffKm":1.5, "strength":1}
  paint <map> '<json>'                   biome paint, wins over the climate rules:
                                         {"biome":"open|forest|marsh|desert|badlands|rock|snow|tidal|erase", "region"|"hexes"|"points"+"radiusKm", "falloffKm", "strength"}
                                         Shore names work too ("crimson coral", "silt mire", "ash", "black earth", …)
  layers <map>                           list sculpt and paint edits
  features <map>                         landmarks (city, spire, colossi, leviathan skeleton, …)
  feature <map> '<json>' [--remove]      add or change a landmark by id:
                                         {"id":"bone-ridge","kind":"leviathan-skeleton","at":"0907","name":"Bone Ridge",
                                          "radiusKm":0.45 (half length),"heightM":120 (rib height),"rotationDeg":30 (spine heading)}
  update/remove also take sculpt and paint edit ids
  apply <map> '<json array>' | -         several calls as ONE edit: [{"tool":"add_op","op":{…}}, {"tool":"update_op","id":"…","patch":{…}}]
  undo <map>                             restore the version before the last CLI edit

Render
  npm run shots -- maps/<map>.json [--views region-oblique,range-mid]   3D views (slow without a GPU)
`;

const [cmd, ...rest] = pos;
const label = flag('label') ?? '';
const needLabel = (fallback: string) => label || fallback;

switch (cmd) {
  case undefined:
  case 'help':
    console.log(HELP);
    break;

  case 'list': {
    if (!existsSync(MAPS)) { console.log('(no maps yet)'); break; }
    for (const f of readdirSync(MAPS).filter((f) => f.endsWith('.json')).sort()) {
      const w = loadWorld(JSON.parse(readFileSync(join(MAPS, f), 'utf8')));
      console.log(`${f.replace(/\.json$/, '').padEnd(24)} ${w.meta.name} — ${w.grid.cols}x${w.grid.rows}, ${w.ops.length} ops`);
    }
    break;
  }

  case 'ops':
    console.log(opCatalog());
    break;

  case 'context': {
    const path = mapPath(rest[0]);
    const w = readMap(path);
    console.log(bakeStatus(path, w));
    console.log(buildContext(w, probeFor(w)));
    break;
  }

  case 'layers': {
    const path = mapPath(rest[0]);
    const w = readMap(path);
    console.log(bakeStatus(path, w));
    console.log(`sculpt (${w.sculpt.length}):`);
    w.sculpt.forEach((e, i) => console.log(`  ${i}: ${JSON.stringify(describeEdit(w, e))}`));
    console.log(`paint (${w.paint.length}):`);
    w.paint.forEach((e, i) => console.log(`  ${i}: ${JSON.stringify(describeEdit(w, e))}`));
    break;
  }

  case 'features': {
    const w = readMap(mapPath(rest[0]));
    for (const f of w.features) console.log(`${f.id.padEnd(18)} ${f.kind.padEnd(20)} ${f.name ?? ''}  pos ${f.pos?.map((v) => v.toFixed(2)).join(', ') ?? '-'}${f.hex ? ` (${f.hex})` : ''}${f.radiusKm !== undefined ? `  radius ${f.radiusKm} km` : ''}${f.heightM !== undefined ? `  height ${f.heightM} m` : ''}${f.rotationDeg !== undefined ? `  heading ${f.rotationDeg}°` : ''}`);
    break;
  }
  case 'feature': {
    const path = mapPath(rest[0]);
    const before = readMap(path);
    const after = cloneWorld(before);
    const input = parseJson(rest[1] ?? fail('missing feature json'), 'feature') as Record<string, unknown>;
    const id = String(input.id ?? fail('feature needs an id'));
    const i = after.features.findIndex((f) => f.id === id);
    if (flags.remove !== undefined) {
      if (i < 0) fail(`no feature ${id}`);
      after.features.splice(i, 1);
      writeMap(path, before, after, needLabel(`remove ${id}`));
      break;
    }
    const { at, ...rest2 } = input;
    const next = { ...(i >= 0 ? after.features[i] : {}), ...rest2, id } as World['features'][number];
    if (at !== undefined) {
      next.pos = new Resolver(after).point(at as PointExpr);
      if (typeof at === 'string' && /^\d{4}$/.test(at)) next.hex = at; else delete next.hex;
    }
    if (!next.kind) fail('feature needs a kind');
    if (!next.pos) fail('feature needs a position ("at")');
    if (i >= 0) after.features[i] = next; else after.features.push(next);
    writeMap(path, before, after, needLabel(`${i >= 0 ? 'update' : 'add'} ${next.kind} ${id}`));
    console.log(JSON.stringify(next));
    break;
  }

  case 'sculpt': {
    const edit = parseJson(rest[1] ?? fail('missing sculpt json'), 'sculpt edit') as Record<string, unknown>;
    const lbl = needLabel(String(edit.label ?? `${edit.tool} ${JSON.stringify(edit.hexes ?? edit.region ?? edit.points ?? '')}`));
    applyCalls(mapPath(rest[0]), [{ name: 'add_sculpt', input: { edit: { ...edit, label: edit.label ?? lbl } } }], lbl);
    break;
  }
  case 'paint': {
    const edit = parseJson(rest[1] ?? fail('missing paint json'), 'paint edit') as Record<string, unknown>;
    const lbl = needLabel(String(edit.label ?? `paint ${edit.biome} ${JSON.stringify(edit.hexes ?? edit.region ?? edit.points ?? '')}`));
    applyCalls(mapPath(rest[0]), [{ name: 'add_paint', input: { edit: { ...edit, label: edit.label ?? lbl } } }], lbl);
    break;
  }

  case 'show': {
    const w = readMap(mapPath(rest[0]));
    const op = w.ops.find((o) => o.id === rest[1]);
    const edit = [...w.sculpt, ...w.paint].find((e) => e.id === rest[1]);
    if (edit) { console.log(JSON.stringify({ ...describeEdit(w, edit), stored: edit }, null, 2)); break; }
    if (!op) fail(`no op "${rest[1]}". ids: ${w.ops.map((o) => o.id).join(', ')}`);
    console.log(JSON.stringify({ ...describeOp(w, op), stored: op }, null, 2));
    break;
  }

  case 'map': {
    const path = mapPath(rest[0]);
    const w = readMap(path);
    const out = rest[1] ?? join('shots', '_tmp', `${basename(path, '.json')}-map.png`);
    const hl = flag('highlight')?.split(',');
    const overlays: Overlay[] = flags.ops || hl ? w.ops.filter((o) => !hl || hl.includes(o.id)).map((o) => ({ op: o })) : [];
    const r = renderMapImage(w, probeFor(w), Number(flag('width') ?? 800), overlays);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, await encodeRGB8(r.width, r.height, r.rgba, async (d) => deflateSync(d)));
    console.log(`wrote ${out} (${r.width}x${r.height}; ${bakeStatus(path, w)}; sculpt and paint included; north up)`);
    break;
  }

  case 'query': {
    const path = mapPath(rest[0]);
    const input = flags.bbox ? { bbox: [flag('bbox'), rest[1]] } : { hexes: rest.slice(1) };
    const w = readMap(path);
    printLog([new ToolExecutor(cloneWorld(w), probeFor(w), w).run('query_region', input)]);
    break;
  }

  case 'new': {
    const path = mapPath(rest[0]);
    if (existsSync(path) && !flags.force) fail(`${path} exists (use --force to overwrite)`);
    let w: World;
    const from = flag('from');
    if (from) {
      const src = from.includes('/') || from.endsWith('.json') ? from : join('worlds', `${from}.json`);
      w = loadWorld(JSON.parse(readFileSync(src, 'utf8')));
    } else {
      w = defaultWorld(flag('title') ?? basename(path, '.json'));
      if (flag('cols')) w.grid.cols = Number(flag('cols'));
      if (flag('rows')) w.grid.rows = Number(flag('rows'));
      if (flag('hex-miles')) w.grid.hexMiles = Number(flag('hex-miles'));
      if (flag('orientation')) w.grid.orientation = flag('orientation') as World['grid']['orientation'];
    }
    if (flag('title')) w.meta.name = flag('title')!;
    w.meta.edits = [];
    writeMap(path, null, w, needLabel(from ? `new map from ${from}` : 'new map'));
    console.log(`wrote ${path}. Link it in the browser (npm run dev, right panel) to watch edits live.`);
    break;
  }

  case 'add': {
    const op = parseJson(rest[1] ?? fail('missing op json'), 'op') as Record<string, unknown>;
    const input: Record<string, unknown> = { op };
    if (flag('index')) input.index = Number(flag('index'));
    applyCalls(mapPath(rest[0]), [{ name: 'add_op', input }], needLabel(`add ${op.type} "${op.label ?? ''}"`));
    break;
  }
  case 'update': {
    const patch = parseJson(rest[2] ?? fail('missing patch json'), 'patch');
    applyCalls(mapPath(rest[0]), [{ name: 'update_op', input: { id: rest[1], patch } }], needLabel(`update ${rest[1]}`));
    break;
  }
  case 'remove':
    applyCalls(mapPath(rest[0]), [{ name: 'remove_op', input: { id: rest[1] } }], needLabel(`remove ${rest[1]}`));
    break;
  case 'move':
    applyCalls(mapPath(rest[0]), [{ name: 'reorder_op', input: { id: rest[1], index: Number(rest[2]) } }], needLabel(`move ${rest[1]} to ${rest[2]}`));
    break;
  case 'set':
    applyCalls(mapPath(rest[0]), [{ name: 'set_world_param', input: { path: rest[1], value: parseValue(rest[2] ?? fail('missing value')) } }], needLabel(`set ${rest[1]} = ${rest[2]}`));
    break;
  case 'apply': {
    const list = parseJson(rest[1] ?? fail('missing json array (or - for stdin)'), 'calls');
    if (!Array.isArray(list)) fail('apply expects a JSON array');
    const calls = list.map((c: Record<string, unknown>) => {
      const name = String(c.tool ?? c.name ?? '');
      const input = (c.input as Record<string, unknown>) ?? Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'tool' && k !== 'name'));
      return { name, input };
    });
    applyCalls(mapPath(rest[0]), calls, needLabel(`${calls.length} edits`));
    break;
  }

  case 'undo': {
    const path = mapPath(rest[0]);
    const dir = historyDir(path);
    const snaps = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
    if (!snaps.length) fail('no CLI history for this map');
    const last = join(dir, snaps[snaps.length - 1]);
    const cur = readMap(path);
    const prev = loadWorld(JSON.parse(readFileSync(last, 'utf8')));
    const undone = cur.meta.edits?.[cur.meta.edits.length - 1]?.label ?? 'last edit';
    unlinkSync(last);
    writeFileSync(path, serializeWorld(prev) + '\n');
    console.log(`restored ${path} to before "${undone}"`);
    break;
  }

  default:
    fail(`unknown command "${cmd}"\n\n${HELP}`);
}
