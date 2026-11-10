// Dev-server bridge between map files on disk (maps/*.json) and the open app.
//   GET  /__maps            -> ["name", ...]
//   GET  /__maps/<name>     -> file contents
//   PUT  /__maps/<name>     -> write (edits made in the browser)
// File changes on disk (e.g. from the terrain CLI driven by Claude Code) are pushed to the page as the
// custom HMR event "tp:map-changed" {name, text}.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export function mapLink(dir = 'maps'): Plugin {
  const root = resolve(dir);
  /** last text the browser wrote per map, so its own writes are not echoed back */
  const lastBrowserWrite = new Map<string, string>();
  const nameOk = (n: string) => /^[a-z0-9][a-z0-9._-]*$/i.test(n);
  return {
    name: 'tp-map-link',
    apply: 'serve',
    configureServer(server) {
      mkdirSync(root, { recursive: true });
      server.watcher.add(root);
      const onFile = (file: string) => {
        const f = resolve(file);
        if (!f.startsWith(root + '/') || !f.endsWith('.json') || f.includes('/.history/')) return;
        const name = basename(f, '.json');
        let text: string;
        try { text = readFileSync(f, 'utf8'); } catch { return; }
        if (lastBrowserWrite.get(name) === text) return;
        try { JSON.parse(text); } catch { return; } // half-written file; the next change event brings the rest
        server.ws.send({ type: 'custom', event: 'tp:map-changed', data: { name, text } });
      };
      server.watcher.on('change', onFile);
      server.watcher.on('add', onFile);
      const bakeDir = join(root, '.bake');
      server.middlewares.use('/__bake', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
        const end = (code: number, body: string | Buffer = '') => { res.statusCode = code; res.end(body); };
        if (!nameOk(name)) return end(400);
        const file = join(bakeDir, `${name}.bin`);
        if (req.method === 'GET') {
          if (!existsSync(file)) return end(404);
          const buf = readFileSync(file);
          const want = url.searchParams.get('key');
          if (want) {
            const len = buf.readUInt32LE(0);
            const head = JSON.parse(buf.subarray(4, 4 + len).toString('utf8')) as { key: string };
            if (head.key !== want) return end(404);
          }
          res.setHeader('content-type', 'application/octet-stream');
          return end(200, buf);
        }
        if (req.method === 'PUT') {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            mkdirSync(bakeDir, { recursive: true });
            writeFileSync(file, Buffer.concat(chunks));
            end(200, '{"ok":true}');
          });
          return;
        }
        end(405);
      });
      server.middlewares.use('/__maps', (req, res) => {
        const name = decodeURIComponent((req.url ?? '/').replace(/^\//, '').replace(/\?.*$/, '')).replace(/\.json$/, '');
        const send = (code: number, body: string, type = 'application/json') => { res.statusCode = code; res.setHeader('content-type', type); res.end(body); };
        if (!name) {
          const list = existsSync(root) ? readdirSync(root).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort() : [];
          return send(200, JSON.stringify(list));
        }
        if (!nameOk(name)) return send(400, '{"error":"bad map name"}');
        const file = join(root, `${name}.json`);
        if (req.method === 'GET') {
          if (!existsSync(file)) return send(404, '{"error":"no such map"}');
          return send(200, readFileSync(file, 'utf8'));
        }
        if (req.method === 'PUT') {
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => {
            try { JSON.parse(body); } catch { return send(400, '{"error":"invalid JSON"}'); }
            lastBrowserWrite.set(name, body);
            writeFileSync(file, body);
            send(200, '{"ok":true}');
          });
          return;
        }
        send(405, '{"error":"method not allowed"}');
      });
    },
  };
}
