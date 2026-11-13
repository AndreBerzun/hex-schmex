import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export function sketchStore(dir = 'sketches'): Plugin {
  const root = resolve(dir);
  const lastBrowserWrite = new Map<string, Buffer>();
  const fileOk = (n: string) => /^[a-z0-9][a-z0-9_-]*\.(json|bin)$/i.test(n);
  return {
    name: 'tp-sketch-store',
    apply: 'serve',
    configureServer(server) {
      mkdirSync(root, { recursive: true });
      server.watcher.add(root);
      const onFile = (file: string) => {
        const f = resolve(file);
        if (!f.startsWith(root + '/') || !fileOk(basename(f))) return;
        let buf: Buffer;
        try { buf = readFileSync(f); } catch { return; }
        if (lastBrowserWrite.get(basename(f))?.equals(buf)) return;
        const kind = extname(f).slice(1);
        server.ws.send({ type: 'custom', event: 'tp:sketch-changed', data: { name: basename(f, extname(f)), kind } });
      };
      server.watcher.on('change', onFile);
      server.watcher.on('add', onFile);
      server.middlewares.use('/__sketch', (req, res) => {
        const name = decodeURIComponent((req.url ?? '/').replace(/^\//, '').replace(/\?.*$/, ''));
        const end = (code: number, body: string | Buffer = '') => { res.statusCode = code; res.end(body); };
        if (!fileOk(name)) return end(400);
        const file = join(root, name);
        if (req.method === 'GET') {
          if (!existsSync(file)) return end(404);
          res.setHeader('content-type', name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
          res.setHeader('cache-control', 'no-store');
          return end(200, readFileSync(file));
        }
        if (req.method === 'PUT') {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            const buf = Buffer.concat(chunks);
            lastBrowserWrite.set(name, buf);
            writeFileSync(file, buf);
            end(200, '{"ok":true}');
          });
          return;
        }
        end(405);
      });
    },
  };
}
