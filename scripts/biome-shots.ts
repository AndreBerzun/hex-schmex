import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { BrowserPage } from './browser';

interface BiomeSpot { name: string; from: [number, number]; to: [number, number] }

const root = 'shots/biomes';
const spots: BiomeSpot[] = JSON.parse(readFileSync('scripts/biome-spots.json', 'utf8'));
const compareAt = process.argv.indexOf('--compare');
const labels = compareAt >= 0 ? process.argv[compareAt + 1].split(',') : [];
const label = process.argv.slice(2).find((a) => !a.startsWith('--') && !labels.includes(a)) ?? 'latest';

const server = await createServer({ server: { port: 5198, strictPort: false }, logLevel: 'error' });
await server.listen();
const page = await BrowserPage.launch({ width: 1280, height: 720 });
try {
  if (labels.length) await compare(labels);
  else await capture(label);
} finally { await page.close(); await server.close(); }

async function capture(name: string) {
  const out = `${root}/${name}`;
  mkdirSync(out, { recursive: true });
  await page.navigate(`${server.resolvedUrls!.local[0]}?shot=1&world=forgotten-shore`);
  await page.waitFor('window.__tp');
  await page.evaluate('window.__tp.finish()');
  await page.evaluate(`(() => {
    const a = window.__tp.app; a.running = false; a.autoTide = false;
    a.setSettings({ exag: 1, timeOfDay: 12, tide: 0, mapMode: false });
    a.ground.enter();
  })()`);
  await page.evaluate('window.__tp.finish()');
  const spotsSeen: unknown[] = [];
  for (const s of spots) {
    const shot = await page.evaluate<{ img: string; spot: unknown }>(`(async () => {
      const a = window.__tp.app, from = ${JSON.stringify(s.from)}, to = ${JSON.stringify(s.to)};
      const stand = () => {
        a.ground.stop(); a.camera.position.set(from[0], 0, from[1]); a.ground.placeCamera();
        a.camera.lookAt(to[0], a.camera.position.y, to[1]);
        a.camera.near = 0.0002; a.camera.updateProjectionMatrix();
      };
      const settle = async () => {
        for (let i = 0; i < 500; i++) {
          a.render();
          await new Promise(r => requestAnimationFrame(r));
          if (!a.scenery.stats.pending) break;
        }
        for (let i = 0; i < 3; i++) { a.render(); await new Promise(r => requestAnimationFrame(r)); }
      };
      stand(); await settle(); stand(); await settle();
      const spot = a.sceneryCells.source.ground.describe(from[0], from[1]);
      return { spot: { zone: spot.zone, mat: spot.mat }, img: a.renderer.domElement.toDataURL('image/jpeg', 0.9) };
    })()`);
    writeFileSync(`${out}/${s.name}.jpg`, Buffer.from(shot.img.split(',')[1], 'base64'));
    spotsSeen.push({ name: s.name, ...(shot.spot as object) });
    console.log(`${s.name}: ${JSON.stringify(shot.spot)}`);
  }
  writeFileSync(`${out}/spots.json`, JSON.stringify(spotsSeen, null, 2));
  await sheet([name], `${out}/sheet.jpg`);
  console.log(`Saved ${out}`);
}

async function compare(names: string[]) {
  await page.navigate(`${server.resolvedUrls!.local[0]}?shot=1`);
  await sheet(names, `${root}/compare-${names.join('-vs-')}.jpg`);
  console.log(`Saved ${root}/compare-${names.join('-vs-')}.jpg`);
}

async function sheet(names: string[], file: string) {
  const cells = spots.map((s) => names.map((n) => {
    const p = `${root}/${n}/${s.name}.jpg`;
    return existsSync(p) ? `data:image/jpeg;base64,${readFileSync(p).toString('base64')}` : null;
  }));
  const jpg = await page.evaluate<string>(`(async () => {
    const cells = ${JSON.stringify(cells)}, rows = ${JSON.stringify(spots.map((s) => s.name))}, cols = ${JSON.stringify(names)};
    const W = 640, H = 360, head = 28;
    const c = document.createElement('canvas'); c.width = W * cols.length; c.height = head + H * rows.length;
    const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
    g.font = '18px sans-serif'; g.fillStyle = '#eee';
    cols.forEach((n, i) => g.fillText(n, i * W + 8, 20));
    for (let r = 0; r < rows.length; r++) for (let k = 0; k < cols.length; k++) {
      if (!cells[r][k]) continue;
      const img = new Image(); img.src = cells[r][k]; await img.decode();
      g.drawImage(img, k * W, head + r * H, W, H);
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(k * W, head + r * H, 130, 26);
      g.fillStyle = '#fff'; g.fillText(rows[r], k * W + 8, head + r * H + 19);
    }
    return c.toDataURL('image/jpeg', 0.85);
  })()`);
  writeFileSync(file, Buffer.from(jpg.split(',')[1], 'base64'));
}
