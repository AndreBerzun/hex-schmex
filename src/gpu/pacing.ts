const MAX_UNITS = 64;

export function isBlankReadback(before: Float32Array, after: Float32Array): boolean {
  return before.some((v) => v !== 0) && after.every((v) => v === 0);
}

/**
 * Keeps at most one batch of GPU work in flight. Without this, the time a batch takes to *issue* says
 * nothing about the time it takes to *run*, and the driver queue grows until the page freezes.
 */
export class GpuPacer {
  private fence: WebGLSync | null = null;
  private markedAt = 0;
  private units = 0;
  private msPerUnit = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  idle(): boolean {
    if (!this.fence) return true;
    const status = this.gl.clientWaitSync(this.fence, 0, 0);
    if (status === this.gl.TIMEOUT_EXPIRED) return false;
    this.gl.deleteSync(this.fence);
    this.fence = null;
    if (this.units > 0) {
      const ms = (performance.now() - this.markedAt) / this.units;
      this.msPerUnit = this.msPerUnit === 0 ? ms : this.msPerUnit * 0.7 + ms * 0.3;
    }
    this.units = 0;
    return true;
  }

  unitsFor(budgetMs: number): number {
    if (this.msPerUnit === 0) return 1;
    return Math.max(1, Math.min(MAX_UNITS, Math.round(budgetMs / this.msPerUnit)));
  }

  issued(units: number) {
    this.units += units;
  }

  mark() {
    if (this.fence) return;
    this.fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this.gl.flush();
    this.markedAt = performance.now();
  }
}

export class GpuTimer {
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private inFlight: WebGLQuery | null = null;
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  begin() {
    if (!this.ext || this.inFlight) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end() {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.inFlight = this.active;
    this.active = null;
  }

  poll(): number | null {
    if (!this.ext || !this.inFlight) return null;
    if (!this.gl.getQueryParameter(this.inFlight, this.gl.QUERY_RESULT_AVAILABLE)) return null;
    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    const ns = this.gl.getQueryParameter(this.inFlight, this.gl.QUERY_RESULT) as number;
    this.gl.deleteQuery(this.inFlight);
    this.inFlight = null;
    return disjoint ? null : ns / 1e6;
  }
}
