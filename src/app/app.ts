// The app core: renderer, cameras, and the bake pipeline (evaluate -> erode -> hydrology -> lighting maps).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { hexCenter, makeGrid, mapDims, parseHexId, pointToHex, inGrid, hexId, type HexGrid } from '../core/hex';
import { downsample, resample, type HydroOutput } from '../core/hydrology';
import { fluvialOptionsFor } from '../core/fluvial';
import type { Heightfield } from '../core/ops';
import { Resolver } from '../core/resolve';
import type { Vec2, World } from '../core/types';
import { GPUCompute } from '../gpu/compute';
import { DerivedMaps } from '../gpu/derived';
import { Erosion } from '../gpu/erosion';
import { GpuPacer, GpuTimer, isBlankReadback } from '../gpu/pacing';
import { HexLabels } from '../render/labels';
import { Sky, Skirt } from '../render/sky';
import { bakeNoiseLut } from '../render/noiseLut';
import { Terrain, mirror, type HeightSource } from '../render/terrain';
import { Landmarks } from '../render/landmarks';
import { tideAt, tideLevel } from '../core/environment';
import { GroundTravel } from './groundTravel';
import { advanceClock, clockTide } from '../core/travel';
import { FreeFlight } from './freeFlight';
import { WorkerClient } from './workerClient';

export type Stage = 'idle' | 'evaluating' | 'draining' | 'eroding' | 'hydrology' | 'ready' | 'error';

export type { ViewSpec } from '../core/types';
import type { ViewSpec } from '../core/types';

export interface AppSettings {
  exag: number;
  tide: number;
  timeOfDay: number;
  hexGrid: boolean;
  labels: boolean;
  debug: number;
  mapMode: boolean;
  erosion: boolean;
  /** override eroded resolution (shots / slow GPUs) */
  erodedRes?: number;
  /** override iteration count */
  iterations?: number;
  /** ms of GPU work per frame for progressive erosion */
  erosionBudgetMs: number;
}

export interface HexStats {
  id: string;
  col: number;
  row: number;
  minM: number;
  maxM: number;
  meanM: number;
  meanSlopeDeg: number;
  dominant: string;
  water: number;
  moisture: number;
}

const ERODE_UNWATCHED_FACTOR = 20;
const DEBUG_NAMES = ['shaded', 'height', 'slope', 'flow', 'moisture', 'materials', 'light', 'erosion'];
export { DEBUG_NAMES };

export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  readonly freeFlight: FreeFlight;
  readonly ground: GroundTravel;
  autoTide = false;
  contextLost = false;
  private lastShadowRefresh = 0;
  private fullLightingDue = 0;
  readonly gc: GPUCompute;
  readonly derived: DerivedMaps;
  readonly terrain: Terrain;
  readonly sky: Sky;
  readonly skirt: Skirt;
  readonly labels: HexLabels;
  readonly landmarks: Landmarks;
  private pendingView?: string;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly workers = new WorkerClient();

  world!: World;
  grid!: HexGrid;
  worldW = 1;
  worldH = 1;
  design: Heightfield | null = null;
  heightSrc: HeightSource | null = null;
  hydro: (HydroOutput & { nx: number; ny: number; kmPerPx: number }) | null = null;
  erosion: Erosion | null = null;
  stage: Stage = 'idle';
  stageInfo = '';
  timings: Record<string, number> = {};
  settings: AppSettings = { tide: 0, exag: 1.8, timeOfDay: 15.5, hexGrid: true, labels: true, debug: 0, mapMode: false, erosion: true, erosionBudgetMs: 12 };
  hover: { col: number; row: number } | null = null;
  onStage: (s: Stage, info: string) => void = () => {};
  onHover: (h: HexStats | null) => void = () => {};
  onFrame: (dt: number) => void = () => {};

  private designTex: THREE.DataTexture | null = null;
  private dataTex: THREE.DataTexture | null = null;
  private waterTex: THREE.DataTexture;
  private bakeGen = 0;
  private clock = new THREE.Clock();
  private sunDir = new THREE.Vector3();
  private needShadow = false;
  private lightingStale = false;
  private erosionCpu: { height: Float32Array; deposit: Float32Array } | null = null;
  private running = false;
  private fpsAcc = { t: 0, n: 0, fps: 0 };
  private redraws = 2;
  private erosionPacer: GpuPacer;
  private timer: GpuTimer;
  /** GPU time of the last rendered frame, ms (0 until the driver reports one) */
  frameGpuMs = 0;
  renderedFrames = 0;

  constructor(canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opts.preserveDrawingBuffer, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // shaders output display-ready colour
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is required (float render targets)');
    gl.getExtension('OES_texture_float_linear');

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 3000);
    this.ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 5000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.screenSpacePanning = false;
    this.controls.zoomSpeed = 1.2;

    this.freeFlight = new FreeFlight(this.camera, canvas, () => this.invalidate());
    this.ground = new GroundTravel(this, canvas);
    canvas.addEventListener('webglcontextlost', ev => {
      ev.preventDefault(); this.contextLost=true;
      this.ground.stop('Graphics context lost.');this.freeFlight.release();
      this.setStage('error','Graphics context lost. Reload the scene to recover.');
      const button=document.createElement('button');button.textContent='Reload scene';button.className='btn recovery';
      button.onclick=()=>location.reload();canvas.parentElement?.append(button);
    });

    this.gc = new GPUCompute(this.renderer);
    this.derived = new DerivedMaps(this.gc);
    this.erosionPacer = new GpuPacer(gl);
    this.timer = new GpuTimer(gl);
    this.controls.addEventListener('change', () => this.invalidate());
    const placeholder = (v: number) => {
      const t = new THREE.DataTexture(new Float32Array([v, v, v, v]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
      t.needsUpdate = true;
      return t;
    };
    this.waterTex = placeholder(-1e5);
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;

    this.uniforms = {
      uDaylight: { value: 1 },
      uSpire: { value: new THREE.Vector4() },
      uSpireRadius: { value: 0 },
      uTide: { value: new THREE.Vector4(0, 0, 0, -100000) },
      uAshen: { value: 0 },
      uHeight: { value: placeholder(0) },
      uHeightScale: { value: 1 },
      uWaterTex: { value: this.waterTex },
      uData: { value: placeholder(0.5) },
      uSurf: { value: placeholder(0) },
      uShadowTex: { value: white },
      uAOTex: { value: white },
      uWorldKm: { value: new THREE.Vector2(1, 1) },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uCellKm: { value: 0.1 },
      uExag: { value: this.settings.exag },
      uSea: { value: 0 },
      uMaxElev: { value: 4500 },
      uSnowline: { value: 2700 },
      uTreeline: { value: 2100 },
      uTemp: { value: 0 },
      uHasHydro: { value: 0 },
      uDebug: { value: 0 },
      uRiverMinLog: { value: 2.1 },
      uDetailOn: { value: 1 },
      uNoise: { value: bakeNoiseLut(this.gc) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSkyZenith: { value: new THREE.Color() },
      uSkyHorizon: { value: new THREE.Color() },
      uHazeDensity: { value: 0.018 },
      uHazeScaleH: { value: 2.6 },
      uHexOn: { value: 1 },
      uSurroundKm: { value: 100 },
      uHexOpacity: { value: 0.55 },
      uHexSize: { value: 1 },
      uHexFlat: { value: 1 },
      uHexOrigin: { value: new THREE.Vector2() },
      uHexGrid: { value: new THREE.Vector2() },
      uHexHover: { value: new THREE.Vector2() },
      uHexSel: { value: new THREE.Vector2() },
    };
    this.terrain = new Terrain(this.uniforms);
    this.sky = new Sky(this.uniforms);
    this.skirt = new Skirt(this.uniforms);
    this.labels = new HexLabels();
    this.landmarks = new Landmarks(this.uniforms);
    this.scene.add(this.landmarks.group);
    this.scene.add(this.sky.mesh, this.terrain.mesh, this.labels.mesh);
    this.applySettings();
    this.installPointer(canvas);
  }

  // ------------------------------------------------------------------ settings / lighting

  applySettings() {
    const s = this.settings;
    const u = this.uniforms;
    u.uExag.value = s.exag;
    this.terrain.exag = s.exag;
    this.labels.setExag(s.exag);
    this.landmarks.setExag(s.exag);
    const tide = this.world?.environment?.tide;
    (u.uTide.value as THREE.Vector4).set(tide?.center[0] ?? 0, tide?.center[1] ?? 0, tide?.radiusKm ?? 0, tideLevel(this.world?.environment, s.tide));
    u.uHexOn.value = s.hexGrid ? 1 : 0;
    this.labels.mesh.visible = s.labels && s.hexGrid;
    u.uDebug.value = s.debug;
    // sun from time of day: rises E, highest in the S at noon, sets W
    const t = s.timeOfDay;
    const az = ((90 + ((t - 6) / 12) * 180) * Math.PI) / 180;
    const elev = Math.sin(((t - 6) / 12) * Math.PI) * (55 * Math.PI / 180);
    const sunBefore = this.sunDir.clone();
    this.sunDir.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), -Math.cos(elev) * Math.cos(az)).normalize();
    if (!sunBefore.equals(this.sunDir)) { this.needShadow = true; this.fullLightingDue=performance.now()+700; }
    (u.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    const daylight = THREE.MathUtils.smoothstep(elev, -0.10, 0.08);
    u.uDaylight.value=daylight;
    const low = 1 - Math.max(0, Math.min(1, elev / 0.6));
    (u.uSunColor.value as THREE.Color).setRGB(1.0, 0.93 - 0.25 * low, 0.82 - 0.45 * low).multiplyScalar(daylight);
    (u.uSkyZenith.value as THREE.Color).setRGB(0.16, 0.32, 0.62).multiplyScalar(0.9 + 0.2 * (1 - low));
    (u.uSkyHorizon.value as THREE.Color).setRGB(0.62 + 0.15 * low, 0.72 + 0.03 * low, 0.86 - 0.12 * low);
    (u.uSkyZenith.value as THREE.Color).lerp(new THREE.Color(0.001,0.002,0.009),1-daylight);
    (u.uSkyHorizon.value as THREE.Color).lerp(new THREE.Color(0.006,0.009,0.022),1-daylight);
    this.invalidate();
  }

  /** Request a redraw. Nothing is drawn while the view and the terrain stand still. */
  invalidate(frames = 2) {
    this.redraws = Math.max(this.redraws, frames);
  }

  setSettings(p: Partial<AppSettings>) {
    const prevExag = this.settings.exag;
    Object.assign(this.settings, p);
    this.applySettings();
    if (p.exag !== undefined && p.exag !== prevExag) this.needShadow = true;
    if (p.mapMode) this.ground.leave();
    if (p.mapMode !== undefined) {
      this.freeFlight.release();
      if (p.mapMode) this.freeFlight.setEnabled(false);
      this.updateOrtho();
    }
  }

  // ------------------------------------------------------------------ world + bake

  private syncWorldUniforms() {
    const w = this.world;
    this.grid = makeGrid(w.grid);
    const dims = mapDims(this.grid, w.terrain.designRes);
    this.worldW = dims.nx * dims.kmPerPx;
    this.worldH = dims.ny * dims.kmPerPx;
    const u = this.uniforms;
    (u.uWorldKm.value as THREE.Vector2).set(this.worldW, this.worldH);
    u.uSea.value = w.terrain.seaLevelM;
    u.uMaxElev.value = w.terrain.maxElevationM;
    u.uSnowline.value = w.climate.snowlineM;
    u.uTreeline.value = w.climate.treelineM;
    u.uTemp.value = w.climate.temperature;
    this.controls.maxPolarAngle = w.features.length ? Math.PI * 0.98 : Math.PI * 0.495;
    u.uAshen.value = w.environment?.palette === 'ashen' ? 1 : 0;
    u.uHazeDensity.value = w.environment?.hazeDensity ?? 0.018;
    this.applySettings();
    u.uHexSize.value = this.grid.size;
    u.uSurroundKm.value = Math.max(this.worldW, this.worldH) * this.terrain.surround;
    u.uHexFlat.value = this.grid.orientation === 'flat' ? 1 : 0;
    (u.uHexOrigin.value as THREE.Vector2).set(this.grid.origin[0], this.grid.origin[1]);
    (u.uHexGrid.value as THREE.Vector2).set(this.grid.cols, this.grid.rows);
    this.invalidate();
  }

  /** Load a world and bake it. `keepCamera` keeps the current view (edits). */
  async setWorld(world: World, opts: { keepCamera?: boolean } = {}) {
    const first = !this.world;
    const gridChanged = !first && JSON.stringify(this.world.grid) !== JSON.stringify(world.grid);
    if (!opts.keepCamera) this.ground.reset();
    this.world = world;
    if (!opts.keepCamera) {
      this.pendingView = world.meta.preview?.initialView;
      this.settings.tide = 0;
    }
    this.syncWorldUniforms();
    if (first || gridChanged || !opts.keepCamera) this.resetCamera();
    await this.bake();
  }

  /** Climate-only change: no re-erosion, just hydrology/moisture + uniforms. */
  async updateClimate(world: World) {
    this.world = world;
    this.syncWorldUniforms();
    if (this.stage === 'ready') await this.runHydrology(this.bakeGen);
  }

  private setStage(s: Stage, info = '') {
    this.stage = s;
    this.stageInfo = info;
    this.onStage(s, info);
  }

  async bake() {
    const gen = ++this.bakeGen;
    this.timings = {};
    this.erosionCpu = null;
    this.landmarks.group.visible = false;
    (this.uniforms.uSpire.value as THREE.Vector4).set(0, 0, 0, 0);
    this.setStage('evaluating', 'evaluating op stack…');
    let hf: Heightfield & { ms: number };
    try {
      hf = await this.workers.evaluate(this.world);
    } catch (e) {
      console.error(e);
      this.setStage('error', String(e));
      return;
    }
    if (gen !== this.bakeGen) return;
    this.timings.evaluate = hf.ms;
    this.design = hf;
    this.designTex?.dispose();
    this.designTex = new THREE.DataTexture(hf.height, hf.nx, hf.ny, THREE.RedFormat, THREE.FloatType);
    this.designTex.minFilter = THREE.LinearFilter;
    this.designTex.magFilter = THREE.LinearFilter;
    this.designTex.needsUpdate = true;
    // show the design layer immediately
    this.setHeightSource({ texture: this.designTex, scale: 1, nx: hf.nx, ny: hf.ny, cpu: hf.height, kmPerPx: hf.kmPerPx });
    this.uniforms.uHasHydro.value = 0;
    this.labels.build(this.grid, (x, z) => this.heightAt(x, z));

    if (this.settings.erosion && this.world.erosion.enabled) {
      // stage 1: large-scale drainage network (CPU stream power, in the worker)
      this.setStage('draining', 'carving drainage network…');
      let fl: { height: Float32Array; ms: number };
      try {
        fl = await this.workers.fluvial(hf.height.slice(), hf.nx, hf.ny, hf.kmPerPx, this.world.terrain.seaLevelM, fluvialOptionsFor(this.world.erosion), Math.round(this.world.terrain.designRes / 2), hf.lake);
      } catch (e) {
        console.error(e);
        this.setStage('error', String(e));
        return;
      }
      if (gen !== this.bakeGen) return;
      this.timings.fluvial = fl.ms;
      (this.designTex.image as unknown as { data: Float32Array }).data = fl.height;
      this.designTex.needsUpdate = true;
      this.setHeightSource({ texture: this.designTex, scale: 1, nx: hf.nx, ny: hf.ny, cpu: fl.height, kmPerPx: hf.kmPerPx });
      // stage 2: GPU hydraulic + thermal detail
      const eres = this.settings.erodedRes ?? this.world.terrain.erodedRes;
      const ed = mapDims(this.grid, eres);
      const cellM = ed.kmPerPx * 1000;
      const params = {
        iterations: this.settings.iterations ?? this.world.erosion.iterations,
        strength: this.world.erosion.strength,
        rain: this.world.erosion.rain,
        talusDeg: this.world.erosion.talusDeg,
        thermal: this.world.erosion.thermal,
        seed: this.world.seed,
      };
      if (!this.erosion || this.erosion.nx !== ed.nx || this.erosion.ny !== ed.ny || this.erosion.seaM !== this.world.terrain.seaLevelM) {
        this.erosion?.dispose();
        this.erosion = new Erosion(this.gc, ed.nx, ed.ny, cellM, this.world.terrain.seaLevelM, params);
      } else this.erosion.setParams(params);
      this.erosion.start(this.designTex);
      this.timings.erosionStart = performance.now();
      // render the live simulation
      this.uniforms.uHeight.value = this.erosion.texture;
      this.uniforms.uHeightScale.value = cellM;
      (this.uniforms.uTexel.value as THREE.Vector2).set(1 / ed.nx, 1 / ed.ny);
      this.uniforms.uCellKm.value = ed.kmPerPx;
      this.setStage('eroding', `eroding 0/${params.iterations}`);
    } else {
      await this.runHydrology(gen);
    }
  }

  private setHeightSource(src: HeightSource) {
    this.heightSrc = src;
    this.uniforms.uHeight.value = src.texture;
    this.uniforms.uHeightScale.value = src.scale;
    (this.uniforms.uTexel.value as THREE.Vector2).set(1 / src.nx, 1 / src.ny);
    this.uniforms.uCellKm.value = src.kmPerPx;
    this.terrain.setSource(src, this.worldW, this.worldH);
    this.refreshLighting('draft');
    this.lightingStale = true;
    this.invalidate();
  }

  /** `draft` is cheap and immediate; `full` is scheduled in slices and swapped in when complete. */
  private refreshLighting(quality: 'draft' | 'full') {
    const t = this.uniforms.uHeight.value as THREE.Texture;
    const tex = this.uniforms.uTexel.value as THREE.Vector2;
    if (!t || tex.x >= 1) return;
    const src = {
      texture: t,
      w: Math.round(1 / tex.x),
      h: Math.round(1 / tex.y),
      scale: this.uniforms.uHeightScale.value as number,
      exag: this.settings.exag,
      cellM: (this.uniforms.uCellKm.value as number) * 1000,
      sun: this.sunDir,
    };
    this.derived.cancelFull();
    this.uniforms.uSurf.value = this.derived.surface(src);
    this.derived.draft(src);
    this.showLighting(this.derived.current);
    if (quality === 'full' && this.stage === 'ready') this.derived.startFull(src);
    else if (quality === 'full') this.lightingStale = true;
    this.needShadow = false;
  }

  private showLighting(maps: { shadow: THREE.Texture; ao: THREE.Texture }) {
    this.uniforms.uShadowTex.value = maps.shadow;
    this.uniforms.uAOTex.value = maps.ao;
    this.invalidate();
  }

  private stepLighting() {
    if (!this.derived.fullPending) return;
    if (this.derived.stepFull()) this.showLighting(this.derived.current);
  }

  private async finishErosion(gen: number) {
    const er = this.erosion!;
    const t0 = performance.now();
    const rb = await er.readback();
    if (gen !== this.bakeGen) return;
    if (this.heightSrc && isBlankReadback(this.heightSrc.cpu, rb.height)) {
      er.releaseTargets();
      this.setStage('error', 'the GPU returned an empty map, press Re-bake');
      return;
    }
    this.timings.readback = performance.now() - t0;
    this.timings.erosion = performance.now() - (this.timings.erosionStart ?? 0);
    this.erosionCpu = { height: rb.height, deposit: rb.deposit };
    const ed = mapDims(this.grid, this.settings.erodedRes ?? this.world.terrain.erodedRes);
    const settled = this.derived.settledHeight({ texture: er.texture, w: er.nx, h: er.ny, scale: er.cellM, exag: 1, cellM: er.cellM, sun: this.sunDir });
    er.releaseTargets();
    this.setHeightSource({ texture: settled, scale: 1, nx: er.nx, ny: er.ny, cpu: rb.height, kmPerPx: ed.kmPerPx });
    this.labels.updateHeights((x, z) => this.heightAt(x, z));
    await this.runHydrology(gen);
  }

  private async runHydrology(gen: number) {
    if (!this.heightSrc || !this.design) return;
    this.setStage('hydrology', 'rivers, lakes and moisture…');
    const src = this.heightSrc;
    const f = Math.max(1, Math.round(Math.max(src.nx, src.ny) / 1024));
    const ds = downsample(src.cpu, src.nx, src.ny, f);
    const kmPerPx = src.kmPerPx * f;
    const bias = resample(this.design.moisture, this.design.nx, this.design.ny, ds.nx, ds.ny);
    const lakeIntent = resample(this.design.lake, this.design.nx, this.design.ny, ds.nx, ds.ny);
    let out: HydroOutput & { ms: number };
    try {
      out = await this.workers.hydrology({
        nx: ds.nx, ny: ds.ny, kmPerPx, height: ds.data, seaLevelM: this.world.terrain.seaLevelM, climate: this.world.climate, moistureBias: bias, lakeIntent,
      });
    } catch (e) {
      console.error(e);
      this.setStage('error', String(e));
      return;
    }
    if (gen !== this.bakeGen) return;
    this.timings.hydrology = out.ms;
    this.hydro = { ...out, nx: ds.nx, ny: ds.ny, kmPerPx };
    const n = ds.nx * ds.ny;
    const data = new Float32Array(n * 4);
    const riverOp = resample(this.design.river, this.design.nx, this.design.ny, ds.nx, ds.ny);
    const dep = this.erosionCpu ? downsample(this.erosionCpu.deposit, src.nx, src.ny, f).data : null;
    for (let i = 0; i < n; i++) {
      data[i * 4] = out.moisture[i];
      data[i * 4 + 1] = out.logArea[i];
      data[i * 4 + 2] = dep ? dep[i] : 0;
      // a: river-op mask 0..1, or -1 for dry playa
      data[i * 4 + 3] = out.waterKind[i] === 3 ? -1 : Math.min(1, riverOp[i] * 1.5);
    }
    this.dataTex?.dispose();
    this.dataTex = new THREE.DataTexture(data, ds.nx, ds.ny, THREE.RGBAFormat, THREE.FloatType);
    this.dataTex.minFilter = this.dataTex.magFilter = THREE.LinearFilter;
    this.dataTex.needsUpdate = true;
    const wl = new Float32Array(n);
    for (let i = 0; i < n; i++) wl[i] = out.waterKind[i] === 1 || out.waterKind[i] === 2 ? out.waterLevel[i] : ds.data[i] - 20;
    const wt = new THREE.DataTexture(wl, ds.nx, ds.ny, THREE.RedFormat, THREE.FloatType);
    wt.minFilter = wt.magFilter = THREE.LinearFilter;
    wt.needsUpdate = true;
    if (this.waterTex.image.width > 1) this.waterTex.dispose();
    this.waterTex = wt;
    this.uniforms.uData.value = this.dataTex;
    this.uniforms.uWaterTex.value = wt;
    this.uniforms.uHasHydro.value = 1;
    // river threshold: streams draining > ~120 km² at default; scale is in log10 km²
    this.uniforms.uRiverMinLog.value = 2.1;
    this.refreshLandmarks();
    this.setStage('ready', '');
    if (this.pendingView) {
      const v = this.world.meta.views?.[this.pendingView];
      this.pendingView = undefined;
      if (v) this.setView(v);
    }
    if (this.lightingStale) this.refreshLighting('full');
    this.lightingStale = false;
    this.invalidate();
  }

  /** Refresh positions and the shadow caster after a metadata-only landmark edit. */
  updatePresentation(world: World) {
    this.world = world;
    this.syncWorldUniforms();
    if (this.stage === 'ready') this.refreshLandmarks();
    this.invalidate();
  }

  private refreshLandmarks() {
    (this.uniforms.uSpire.value as THREE.Vector4).set(0, 0, 0, 0);
    this.landmarks.rebuild(this.world, (x, z) => this.heightAt(x, z));
    this.landmarks.group.visible = true;
    const spire = this.world.features.find((f) => f.kind === 'crimson-spire' && f.pos);
    if (spire?.pos) {
      (this.uniforms.uSpire.value as THREE.Vector4).set(spire.pos[0], spire.pos[1], this.heightAt(...spire.pos) / 1000, (spire.heightM ?? 1800) / 1000);
      this.uniforms.uSpireRadius.value = spire.radiusKm ?? 0.22;
    }
  }

  // ------------------------------------------------------------------ sampling / picking

  /** Terrain (or water) surface height in metres at world km. */
  heightAt(x: number, z: number): number {
    const s = this.heightSrc;
    if (!s) return 0;
    x = mirror(x, this.worldW);
    z = mirror(z, this.worldH);
    const fx = Math.min(s.nx - 1.001, Math.max(0, x / s.kmPerPx - 0.5)), fz = Math.min(s.ny - 1.001, Math.max(0, z / s.kmPerPx - 0.5));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = s.cpu;
    const k = j * s.nx + i;
    return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) + (a[k + s.nx] * (1 - tx) + a[k + s.nx + 1] * tx) * tz;
  }

  surfaceAt(x: number, z: number): number {
    const h = Math.max(this.heightAt(x, z), tideAt(this.world?.environment, this.settings.tide, x, z));
    const hy = this.hydro;
    if (!hy) return h;
    x = mirror(x, this.worldW);
    z = mirror(z, this.worldH);
    const i = Math.min(hy.nx - 1, Math.max(0, Math.floor(x / hy.kmPerPx))), j = Math.min(hy.ny - 1, Math.max(0, Math.floor(z / hy.kmPerPx)));
    const k = j * hy.nx + i;
    return hy.waterKind[k] === 1 || hy.waterKind[k] === 2 ? Math.max(h, hy.waterLevel[k]) : h;
  }

  /** Ray-march the heightfield. Returns the hit point in world km (y in scene units) or null. */
  pick(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const cam = this.settings.mapMode ? this.ortho : this.camera;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    const o = ray.ray.origin, d = ray.ray.direction;
    const s = 0.001 * this.settings.exag;
    let t = 0;
    const maxT = 3000;
    let prevAbove = true;
    let step = 0.05;
    for (let i = 0; i < 4000 && t < maxT; i++) {
      const p = o.clone().addScaledVector(d, t);
      const ext = Math.max(this.worldW, this.worldH) * this.terrain.surround;
      if (p.x >= -ext && p.z >= -ext && p.x <= this.worldW + ext && p.z <= this.worldH + ext) {
        const hy = this.surfaceAt(p.x, p.z) * s;
        const above = p.y > hy;
        if (!above && prevAbove && i > 0) {
          // bisect
          let a = t - step, b = t;
          for (let k = 0; k < 20; k++) {
            const m = (a + b) / 2;
            const q = o.clone().addScaledVector(d, m);
            if (q.y > this.surfaceAt(q.x, q.z) * s) a = m; else b = m;
          }
          return o.clone().addScaledVector(d, (a + b) / 2);
        }
        prevAbove = above;
        step = Math.max(0.02, Math.min(5, (p.y - hy) * 0.5));
      } else {
        step = 2;
      }
      t += step;
    }
    return null;
  }

  hexStats(col: number, row: number): HexStats | null {
    if (!this.heightSrc || !inGrid(this.grid, col, row)) return null;
    const s = this.heightSrc;
    const [cx, cz] = hexCenter(this.grid, col, row);
    const r = this.grid.flat / 2;
    let mn = Infinity, mx = -Infinity, sum = 0, n = 0, slope = 0, water = 0, moist = 0;
    const counts: Record<string, number> = {};
    const step = Math.max(s.kmPerPx, r / 24);
    const cell = s.kmPerPx * 1000;
    for (let z = cz - r; z <= cz + r; z += step) for (let x = cx - r; x <= cx + r; x += step) {
      const h = pointToHex(this.grid, [x, z]);
      if (h.col !== col || h.row !== row) continue;
      const v = this.heightAt(x, z);
      mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; n++;
      const gx = (this.heightAt(x + s.kmPerPx, z) - this.heightAt(x - s.kmPerPx, z)) / (2 * cell);
      const gz = (this.heightAt(x, z + s.kmPerPx) - this.heightAt(x, z - s.kmPerPx)) / (2 * cell);
      const sl = Math.hypot(gx, gz);
      slope += (Math.atan(sl) * 180) / Math.PI;
      const m = this.classify(x, z, v, sl);
      counts[m.mat] = (counts[m.mat] ?? 0) + 1;
      if (m.water) water++;
      moist += m.moisture;
    }
    if (!n) return null;
    let dom = 'grassland', best = -1;
    for (const k in counts) if (counts[k] > best) { best = counts[k]; dom = k; }
    return { id: hexId(col, row), col, row, minM: mn, maxM: mx, meanM: sum / n, meanSlopeDeg: slope / n, dominant: dom, water: water / n, moisture: moist / n };
  }

  /** CPU mirror of the shader's dominant-material rules (approximate; for readouts). */
  classify(x: number, z: number, h: number, slope: number): { mat: string; water: boolean; moisture: number } {
    const w = this.world;
    const hy = this.hydro;
    let moisture = w.climate.baseMoisture, logA = 0, water = false;
    if (hy) {
      const i = Math.min(hy.nx - 1, Math.max(0, Math.floor(x / hy.kmPerPx))), j = Math.min(hy.ny - 1, Math.max(0, Math.floor(z / hy.kmPerPx)));
      const k = j * hy.nx + i;
      moisture = hy.moisture[k];
      logA = hy.logArea[k];
      water = hy.waterKind[k] === 1 || hy.waterKind[k] === 2;
      if (hy.waterKind[k] === 3) return { mat: 'playa', water: false, moisture };
    }
    const elev = h - w.terrain.seaLevelM;
    const dry = 1 - moisture * 1.6 + w.climate.temperature * 0.3;
    let mat = 'grassland';
    if (water) mat = 'water';
    else if (elev > w.climate.snowlineM && slope < 1.1) mat = 'snow';
    else if (slope > 0.75) mat = 'rock';
    else if (logA > 2.6 && slope < 0.1) mat = 'river';
    else if (moisture > 0.78 && slope < 0.035 && elev < 400) mat = 'marsh';
    else if (moisture > 0.48 && elev < w.climate.treelineM && slope < 0.7) mat = 'forest';
    else if (dry > 0.85) mat = slope > 0.3 ? 'badlands' : 'desert';
    else if (dry > 0.55) mat = 'steppe';
    return { mat, water, moisture };
  }

  private installPointer(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointermove', (ev) => {
      if(!this.settings.hexGrid || this.freeFlight.locked || this.ground.enabled)return;
      const r = canvas.getBoundingClientRect();
      const nx = ((ev.clientX - r.left) / r.width) * 2 - 1, ny = -((ev.clientY - r.top) / r.height) * 2 + 1;
      this.pendingPick = [nx, ny];
    });
    canvas.addEventListener('pointerleave', () => {
      this.pendingPick = null;
      this.setHover(null);
    });
  }
  private pendingPick: [number, number] | null = null;
  lastPick: THREE.Vector3 | null = null;

  private setHover(h: { col: number; row: number } | null) {
    const same = (!h && !this.hover) || (h && this.hover && h.col === this.hover.col && h.row === this.hover.row);
    if (same) return;
    this.hover = h;
    (this.uniforms.uHexHover.value as THREE.Vector2).set(this.settings.hexGrid ? h?.col ?? 0 : 0, this.settings.hexGrid ? h?.row ?? 0 : 0);
    this.onHover(h ? this.hexStats(h.col, h.row) : null);
    this.invalidate();
  }

  // ------------------------------------------------------------------ cameras

  resetCamera() {
    this.freeFlight.release();
    const W = this.worldW, H = this.worldH;
    const t = new THREE.Vector3(W / 2, 0.4, H / 2 - H * 0.04);
    this.controls.target.copy(t);
    // ~38 degrees down from the south, far enough that the north edge goes hazy (reference 03)
    const d = Math.max(W, H) * 1.3;
    this.camera.position.set(W / 2, d * 0.62, H / 2 + d * 0.8);
    this.camera.lookAt(t);
    this.controls.update();
    this.updateOrtho();
  }

  private updateOrtho() {
    const W = this.worldW, H = this.worldH;
    const el = this.renderer.domElement;
    const aspect = el.clientWidth / Math.max(1, el.clientHeight);
    const half = Math.max(W / 2 / aspect, H / 2) * 1.04;
    this.ortho.left = -half * aspect; this.ortho.right = half * aspect;
    this.ortho.top = half; this.ortho.bottom = -half;
    this.ortho.position.set(W / 2, 200, H / 2);
    this.ortho.up.set(0, 0, -1);
    this.ortho.lookAt(W / 2, 0, H / 2);
    this.ortho.updateProjectionMatrix();
    this.invalidate();
  }

  /** Point a camera according to a view spec (hex ids, compass words, km). */
  setView(v: ViewSpec) {
    this.freeFlight.release();
    this.ground.leave();
    const res = new Resolver(this.world);
    const from = res.point(v.from as never), to = res.point(v.to as never);
    const s = 0.001 * this.settings.exag;
    const fy = v.fromAbsM !== undefined ? v.fromAbsM : this.surfaceAt(from[0], from[1]) + (v.fromAglM ?? 3000);
    const ty = this.surfaceAt(to[0], to[1]) + (v.toAglM ?? 0);
    this.settings.mapMode = false;
    this.camera.position.set(from[0], fy * s, from[1]);
    this.controls.target.set(to[0], ty * s, to[1]);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.invalidate();
  }

  goToHex(id: string) {
    const h = parseHexId(id);
    if (!h) return;
    const [x, z] = hexCenter(this.grid, h.col, h.row);
    const s = 0.001 * this.settings.exag;
    const ty = this.surfaceAt(x, z) * s;
    const target = new THREE.Vector3(x, ty, z);
    const dist = this.grid.flat * 1.6;
    const pos = new THREE.Vector3(x, ty + dist * 0.55, z + dist * 0.85);
    const ground = this.surfaceAt(pos.x, pos.z) * s;
    pos.y = Math.max(pos.y, ground + 0.5);
    this.flyTo(pos, target);
    (this.uniforms.uHexSel.value as THREE.Vector2).set(h.col, h.row);
  }

  private flight: { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; start: number; dur: number } | null = null;
  flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 1.6) {
    this.settings.mapMode = false;
    this.flight = { p0: this.camera.position.clone(), p1: pos, t0: this.controls.target.clone(), t1: target, start: performance.now(), dur: dur * 1000 };
    this.invalidate();
  }

  // ------------------------------------------------------------------ frame loop

  resize() {
    const el = this.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1800000 / Math.max(1,w*h))));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.labels.setViewport(w, h);
    this.terrain.setViewportHeight(h * this.renderer.getPixelRatio(), this.camera.fov);
    this.updateOrtho();
    this.invalidate();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get fps() { return this.fpsAcc.fps; }

  /** One frame: paced erosion and lighting work, then a redraw if something changed. */
  frame() {
    const dt = Math.min(this.clock.getDelta(),0.05);
    if(this.contextLost)return;
    this.fpsAcc.t += dt; this.fpsAcc.n++;
    if (this.fpsAcc.t > 0.5) { this.fpsAcc.fps = this.fpsAcc.n / this.fpsAcc.t; this.fpsAcc.t = 0; this.fpsAcc.n = 0; }
    this.frameGpuMs = this.timer.poll() ?? this.frameGpuMs;
    const gpuBusy = !this.erosionPacer.idle();
    const lightingWork = !gpuBusy && this.derived.fullPending;
    if (!gpuBusy) {
      if (this.stage === 'eroding' && this.erosion) this.stepErosion(this.settings.erosionBudgetMs);
      this.stepLighting();
      const now=performance.now();
      if (this.needShadow && now-this.lastShadowRefresh>350) { this.refreshLighting('draft'); this.lastShadowRefresh=now; }
      if (this.fullLightingDue && now>this.fullLightingDue && !this.needShadow && this.stage==='ready') {this.fullLightingDue=0;this.refreshLighting('full');}
    }
    if (this.flight) {
      const f = this.flight;
      const k = Math.min(1, (performance.now() - f.start) / f.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(f.p0, f.p1, e);
      this.camera.position.y += Math.sin(e * Math.PI) * f.p0.distanceTo(f.p1) * 0.12;
      this.controls.target.lerpVectors(f.t0, f.t1, e);
      this.invalidate();
      if (k >= 1) this.flight = null;
    }
    if (this.ground.enabled && !this.settings.mapMode) {
      const seconds=this.ground.update(dt);
      if(seconds>0){
        this.settings.timeOfDay=advanceClock(this.settings.timeOfDay,seconds);
        if(this.autoTide)this.settings.tide=clockTide(this.settings.timeOfDay);
        this.applySettings();this.ground.placeCamera();
      }
    }
    this.controls.enabled = !this.settings.mapMode && !this.freeFlight.enabled && !this.ground.enabled;
    if (!this.settings.mapMode) {
      if (this.freeFlight.enabled || this.ground.enabled) {
        if(this.freeFlight.enabled)this.freeFlight.update(dt);
        this.camera.getWorldDirection(this.flyDirection);
        this.controls.target.copy(this.camera.position).addScaledVector(this.flyDirection, 1);
      } else this.controls.update();
    }
    this.keepAboveGround();
    if (this.pendingPick) {
      const p = this.pick(this.pendingPick[0], this.pendingPick[1]);
      this.pendingPick = null;
      this.lastPick = p;
      if (p) {
        const h = pointToHex(this.grid, [p.x, p.z]);
        this.setHover(inGrid(this.grid, h.col, h.row) ? h : null);
      } else this.setHover(null);
    }
    this.onFrame(dt);
    const redraw = this.redraws > 0 && !gpuBusy;
    if (redraw) {
      this.redraws--;
      this.render();
    }
    if (redraw || lightingWork || this.stage === 'eroding') this.erosionPacer.mark();
  }

  private stepErosion(budgetMs: number) {
    const er = this.erosion!;
    const units = this.erosionPacer.unitsFor(this.redraws > 0 ? budgetMs : budgetMs * ERODE_UNWATCHED_FACTOR);
    er.step(units);
    this.erosionPacer.issued(units);
    if (er.iteration % 40 < 2 || er.done) this.refreshLighting('draft');
    this.uniforms.uHeight.value = er.texture;
    this.stageInfo = `eroding ${er.iteration}/${er.params.iterations}`;
    this.onStage('eroding', this.stageInfo);
    if (er.iteration % 8 < units || er.done) this.invalidate();
    if (er.done) {
      this.setStage('hydrology', 'reading back…');
      void this.finishErosion(this.bakeGen);
    }
  }

  /** Wait for the running bake on the same paced route the app uses, then finish the lighting (headless shots). */
  async finishNow() {
    while (this.stage !== 'ready' && this.stage !== 'error') await new Promise((r) => setTimeout(r, 20));
    if (this.stage === 'error') throw new Error(`bake failed: ${this.stageInfo}`);
    this.refreshLighting('full');
    this.derived.finishFull();
    this.showLighting(this.derived.current);
  }

  private flyDirection = new THREE.Vector3();

  private keepAboveGround() {
    if (this.settings.mapMode) return;
    if(this.ground.enabled) {this.ground.placeCamera();this.camera.near=0.0002;this.camera.updateProjectionMatrix();return;}
    const c = this.camera.position;
    const g = this.surfaceAt(c.x, c.z) * 0.001 * this.settings.exag;
    const minY = g + (this.freeFlight.enabled ? 0.002 * this.settings.exag : 0.04);
    if (c.y < minY) c.y = minY;
    // dynamic near plane: precision where it matters
    const agl = Math.max(0.01, c.y - g);
    const near = Math.min(2, Math.max(0.005, agl * 0.25));
    if (Math.abs(near - this.camera.near) / this.camera.near > 0.2) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  render() {
    if(this.contextLost)return;
    const cam = this.settings.mapMode ? this.ortho : this.camera;
    cam.updateMatrixWorld();
    if (this.settings.mapMode) this.terrain.material.uniforms.uLeafRange.value = 1e9;
    else this.terrain.material.uniforms.uLeafRange.value = this.terrain.leafKm * this.terrain.rangeK;
    this.terrain.update(cam, !this.settings.mapMode, this.renderer.domElement.width);
    this.sky.update(cam);
    this.skirt.mesh.visible = !this.settings.mapMode;
    this.renderer.setRenderTarget(null);
    this.timer.begin();
    this.renderer.render(this.scene, cam);
    this.timer.end();
    this.renderedFrames++;
  }

  /** Tidy elevation table for the LLM context and exports. */
  hexElevationTable(): { id: string; mean: number; max: number }[] {
    const out = [];
    for (let r = 1; r <= this.grid.rows; r++) for (let c = 1; c <= this.grid.cols; c++) {
      const s = this.hexStats(c, r);
      if (s) out.push({ id: s.id, mean: Math.round(s.meanM), max: Math.round(s.maxM) });
    }
    return out;
  }

  worldPointKm(p: THREE.Vector3): Vec2 { return [p.x, p.z]; }
}
