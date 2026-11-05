import { createServer } from 'vite';
import { createRequire } from 'node:module';
// Screenshot of the full interactive UI. Usage: tsx scripts/ui-shot.ts "<query>" "<js to run>" out.png
const req = createRequire(import.meta.url);
let pw: any;
try { pw = await import('playwright'); } catch { pw = req('/opt/node22/lib/node_modules/playwright'); }
const server = await createServer({ server: { port: 5198 }, logLevel: 'error' });
await server.listen();
const b = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1500, height: 860 } });
p.on('pageerror', (e: Error) => console.log('pageerror', e.message));
p.on('console', (m: any) => { if (m.type() === 'error') console.log('console', m.text()); });
const q = process.argv[2] ?? 'world=alpine-valley&eres=512&iters=80';
await p.goto(`http://localhost:5198/?${q}`);
await p.waitForFunction(() => !!(window as any).__tp);
await p.evaluate(() => (window as any).__tp.finish());
const actions = process.argv[3];
if (actions) await p.evaluate(actions);
await p.waitForTimeout(1500);
await p.mouse.move(700, 500);
await p.waitForTimeout(800);
await p.screenshot({ path: process.argv[4] ?? 'shots/_tmp/ui.png', timeout: 180000 });
await b.close(); await server.close();
