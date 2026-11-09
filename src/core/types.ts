// World JSON model (BRIEF §4). Positions inside ops are world km, origin top-left, +x east, +y south.

export type Vec2 = [number, number];
export type BlendMode = 'add' | 'max' | 'min' | 'replace' | 'multiply';
export type OpSource = 'prompt' | 'brush' | 'manual';
export type Orientation = 'flat' | 'pointy';

/** An area. Circle, polygon, axis-aligned rect, or a union of those. */
export type Region =
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'polygon'; points: Vec2[] }
  | { kind: 'rect'; min: Vec2; max: Vec2 }
  | { kind: 'union'; parts: Region[] }
  | { kind: 'all' };

export interface OpMask {
  region: Region;
  falloffKm: number;
  invert?: boolean;
}

interface OpCommon {
  id: string;
  enabled: boolean;
  label: string;
  source: OpSource;
  blend?: BlendMode;
  /** Optional extra mask multiplied into the op's own weight. */
  mask?: OpMask;
  /** The original human/LLM expression (hex ids, compass words) for readability. */
  expr?: Record<string, unknown>;
}

export interface RidgeOp extends OpCommon {
  type: 'ridge';
  points: Vec2[];
  /** metres added at the crest */
  height: number;
  /** half-width of the range base, km */
  width: number;
  /** 0 = rounded, 1 = knife-edge */
  sharpness: number;
  /** 0 = smooth crest, 1 = very broken crest with spurs */
  roughness: number;
  /** -1..1: >0 makes the right-hand side (relative to line direction) steeper */
  asymmetry: number;
}

export type PeakShape = 'cone' | 'dome' | 'massif' | 'volcano';
export interface PeakOp extends OpCommon {
  type: 'peak';
  center: Vec2;
  height: number;
  radius: number;
  shape: PeakShape;
}

export interface PlateauOp extends OpCommon {
  type: 'plateau';
  region: Region;
  /** absolute elevation of the top, m */
  height: number;
  /** 0 = gentle ramp, 1 = cliff */
  edgeSteepness: number;
  /** number of terraces (0 = none) */
  terraces: number;
  /** km of edge transition at steepness 0 */
  edgeKm?: number;
}

export interface BasinOp extends OpCommon {
  type: 'basin';
  region: Region;
  depth: number;
  falloffKm: number;
}

export interface ValleyOp extends OpCommon {
  type: 'valley';
  points: Vec2[];
  depth: number;
  width: number;
  profile: 'V' | 'U';
}

export interface RiverOp extends OpCommon {
  type: 'river';
  points: Vec2[];
  /** channel width, km */
  width: number;
  /** channel depth below the banks, m */
  depth: number;
  /** width of the gentle floodplain on each side, km */
  floodplainKm?: number;
}

export interface CanyonOp extends OpCommon {
  type: 'canyon';
  points: Vec2[];
  depth: number;
  width: number;
  /** 0..1 */
  wallSteepness: number;
}

export type Side = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
export interface CoastOp extends OpCommon {
  type: 'coast';
  /** Either a region that becomes sea, or a map side plus how far it reaches inland. */
  region?: Region;
  side?: Side;
  /** km from the map edge the sea reaches (with side) */
  extentKm?: number;
  /** sea floor elevation, m (negative) */
  targetElevation: number;
  /** transition width, km */
  falloffKm: number;
  /** 0..1 irregularity of the coastline */
  roughness?: number;
}

export interface HillsOp extends OpCommon {
  type: 'hills';
  region: Region;
  amplitude: number;
  wavelengthKm: number;
  style: 'rolling' | 'rugged' | 'dunes';
  falloffKm?: number;
}

export interface LowlandsOp extends OpCommon {
  type: 'lowlands';
  region: Region;
  targetElevation: number;
  /** 0..1 how much existing relief is flattened */
  flatness: number;
  falloffKm?: number;
}

export interface EscarpmentOp extends OpCommon {
  type: 'escarpment';
  points: Vec2[];
  heightDelta: number;
  /** which side of the line (relative to its direction) is the high side */
  side: 'left' | 'right';
  /** km over which the cliff rises */
  width: number;
  /** km the raised ground extends from the line before fading */
  reachKm?: number;
}

export interface SmoothOp extends OpCommon {
  type: 'smooth';
  region: Region;
  strength: number;
  falloffKm?: number;
}

export interface RoughenOp extends OpCommon {
  type: 'roughen';
  region: Region;
  strength: number;
  falloffKm?: number;
}

export type BrushType =
  | 'raise' | 'lower' | 'smooth' | 'flatten' | 'ridge' | 'carve' | 'roughen' | 'erode' | 'moisture';

export interface StrokeOp extends OpCommon {
  type: 'stroke';
  brush: BrushType;
  points: Vec2[];
  /** km */
  radius: number;
  /** 0..1 */
  strength: number;
  /** 0 = hard edge, 1 = soft */
  falloff: number;
  /** flatten target, m */
  targetHeight?: number;
  /** carve: also mark as river */
  river?: boolean;
  invert?: boolean;
}

export interface MoistureOp extends OpCommon {
  type: 'moisture';
  region: Region;
  /** -1..1 added to moisture */
  delta: number;
  falloffKm?: number;
}

export type Op =
  | RidgeOp | PeakOp | PlateauOp | BasinOp | ValleyOp | RiverOp | CanyonOp | CoastOp
  | HillsOp | LowlandsOp | EscarpmentOp | SmoothOp | RoughenOp | StrokeOp | MoistureOp;
export type OpType = Op['type'];

export interface BaseTerrain {
  type: 'fbm' | 'ridged' | 'mixed';
  /** mean elevation of the base noise, m */
  elevation: number;
  /** +/- amplitude, m */
  amplitude: number;
  /** feature wavelength, km */
  wavelengthKm: number;
  octaves: number;
  /** domain warp strength, km */
  warpKm: number;
}

export interface ErosionSettings {
  enabled: boolean;
  preset: 'light' | 'medium' | 'heavy';
  iterations: number;
  /** multiplier on erosion rate */
  strength: number;
  rain: number;
  /** thermal talus angle, degrees */
  talusDeg: number;
  thermal: number;
}

export interface ClimateSettings {
  /** direction the wind blows FROM, degrees clockwise from north */
  windFromDeg: number;
  /** 0..1 */
  baseMoisture: number;
  snowlineM: number;
  treelineM: number;
  /** -1 cold .. 1 hot, shifts desert/forest */
  temperature: number;
}

export interface Feature {
  id: string;
  kind: string;
  hex?: string;
  pos?: Vec2;
  name?: string;
  notes?: string;
  /** Landmark dimensions; horizontal units km, vertical units metres. */
  radiusKm?: number;
  heightM?: number;
  rotationDeg?: number;
}

export interface WorldEnvironment {
  palette?: 'ashen';
  hazeDensity?: number;
  /** Supernatural tide; without a centre it covers the whole region. Does not rebake erosion. */
  tide?: { center?: Vec2; radiusKm?: number; lowM: number; highM: number };
}

/** A saved camera view. Points accept hex ids / compass words / km like op params. */
export interface ViewSpec {
  from: string | Vec2 | Record<string, unknown>;
  /** metres above ground at `from` (default 3000) */
  fromAglM?: number;
  /** absolute camera altitude, m (overrides fromAglM) */
  fromAbsM?: number;
  to: string | Vec2 | Record<string, unknown>;
  toAglM?: number;
}

export type SculptTool = 'raise' | 'lower' | 'flatten' | 'smooth';
export type Biome = 'open' | 'forest' | 'marsh' | 'desert' | 'badlands' | 'rock' | 'snow' | 'tidal' | 'erase';

export type EditArea =
  | { kind: 'stroke'; points: Vec2[]; radiusKm: number }
  | { kind: 'region'; region: Region };

interface LayerEditCommon {
  id: string;
  label: string;
  source: OpSource;
  area: EditArea;
  falloffKm: number;
  strength: number;
  expr?: Record<string, unknown>;
}

export interface SculptEdit extends LayerEditCommon {
  tool: SculptTool;
  amountM?: number;
  targetM?: number;
  scaleKm?: number;
}

export interface PaintEdit extends LayerEditCommon {
  biome: Biome;
}

export interface World {
  version: 1;
  seed: number;
  grid: { cols: number; rows: number; hexMiles: number; orientation: Orientation };
  terrain: { seaLevelM: number; maxElevationM: number; designRes: number; erodedRes: number };
  base: BaseTerrain;
  ops: Op[];
  sculpt: SculptEdit[];
  paint: PaintEdit[];
  erosion: ErosionSettings;
  climate: ClimateSettings;
  /** Optional landmarks, placed in continuous world km. Unknown kinds remain metadata. */
  features: Feature[];
  environment?: WorldEnvironment;
  meta: {
    name: string;
    notes?: string;
    createdAt: string;
    updatedAt: string;
    views?: Record<string, ViewSpec>;
    preview?: { exag?: number; timeOfDay?: number; hexGrid?: boolean; initialView?: string };
    /** recent edits made through the terrain CLI (newest last), so the next session knows what happened */
    edits?: { at: string; label: string; ops: string[] }[];
  };
}
