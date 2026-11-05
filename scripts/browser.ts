import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export interface BrowserOptions {
  width: number;
  height: number;
  /** SwiftShader instead of the machine's GPU */
  software?: boolean;
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const SOFTWARE_FLAGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

function findBrowser(): string {
  const candidates = [process.env.CHROME_BIN, '/snap/bin/chromium', 'chromium', 'chromium-browser', 'google-chrome'];
  for (const c of candidates) {
    if (!c) continue;
    if (existsSync(c) || spawnSync('which', [c]).status === 0) return c;
  }
  throw new Error('No Chromium found; set CHROME_BIN');
}

function profileDirFor(browser: string): string {
  if (browser.startsWith('/snap/')) return join(homedir(), 'snap/chromium/common/hex-schmex-profile');
  return mkdtempSync(join(tmpdir(), 'hex-schmex-'));
}

function waitForEndpoint(proc: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chromium did not open a debugging port')), 30000);
    let log = '';
    proc.stderr!.on('data', (chunk: Buffer) => {
      log += chunk.toString();
      const m = log.match(/DevTools listening on ws:\/\/([^/]+)\//);
      if (!m) return;
      clearTimeout(timer);
      resolve(m[1]);
    });
  });
}

export class BrowserPage {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  private constructor(private readonly proc: ChildProcess, private readonly socket: WebSocket) {
    socket.onmessage = ({ data }) => {
      const msg = JSON.parse(String(data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string; params?: Record<string, unknown> };
      if (msg.method === 'Runtime.exceptionThrown') console.log('page exception:', JSON.stringify(msg.params).slice(0, 400));
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result ?? {});
    };
  }

  static async launch(o: BrowserOptions): Promise<BrowserPage> {
    const browser = findBrowser();
    const proc = spawn(browser, [
      '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profileDirFor(browser)}`, `--window-size=${o.width},${o.height}`,
      ...(o.software ? SOFTWARE_FLAGS : GPU_FLAGS), 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const host = await waitForEndpoint(proc);
    const targets = await (await fetch(`http://${host}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    const target = targets.find((t) => t.type === 'page');
    if (!target) throw new Error('No page target');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => { socket.onopen = resolve; });
    const page = new BrowserPage(proc, socket);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: o.width, height: o.height, deviceScaleFactor: 1, mobile: false });
    return page;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }) as {
      result?: { value?: T };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value as T;
  }

  async navigate(url: string) {
    await this.send('Page.navigate', { url });
  }

  async addInitScript(source: string) {
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  async waitFor(expression: string, timeoutMs = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await this.evaluate<boolean>(`!!(${expression})`).catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async close() {
    await this.send('Browser.close').catch(() => undefined);
    this.socket.close();
    this.proc.kill();
  }
}
