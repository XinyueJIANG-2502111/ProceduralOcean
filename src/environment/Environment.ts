import * as THREE from 'three';
import { createShowcaseEnvironmentState, SHOWCASE_PRESETS, type ShowcasePreset } from '../config/showcase';

export type CameraMedium = 'air' | 'water';
export type CameraMediumOverride = 'auto' | CameraMedium;

export interface MoonLighting {
  direction: THREE.Vector3;
  visibility: number;
  intensity: number;
}

export interface EnvironmentState {
  timeOfDay: number;
  timeScale: number;
  animateTime: boolean;
  moonEnabled: boolean;
  moonIntensity: number;
  cloudCoverage: number;
  precipitation: number;
  windSpeed: number;
  windDirection: number;
  stormIntensity: number;
  waveStrength: number;
  quantizationLevels: number;
  ditheringStrength: number;
  rippleStrength: number;
  turbidity: number;
  rayleighStrength: number;
  mieStrength: number;
  horizonHaze: number;
  swellCount: number;
  swellStrength: number;
  swellDirection: number;
  swellDirectionOffset: number;
  mainWaveCount: number;
  mainWaveStrength: number;
  peakWavelength: number;
  waveSeed: number;
  waveDebugMode: number;
  directionSpread: number;
  midNormalStrength: number;
  highNormalStrength: number;
  foamStrength: number;
  detailFalloff: number;
  aerialDensity: number;
  paletteStrength: number;
  renderingMode: number;
  environmentReflectionEnabled: boolean;
  environmentReflectionOnly: boolean;
  environmentMapUpdateRate: number;
  waterLevel: number;
  averageWaterDepth: number;
  absorptionR: number;
  absorptionG: number;
  absorptionB: number;
  scatteringStrength: number;
  refractionStrength: number;
  seabedVariation: number;
  seabedScale: number;
  waterVolumeDebugMode: number;
  underwaterDebugCamera: boolean;
  underwaterTestDepth: number;
  cameraMediumOverride: CameraMediumOverride;
  cameraPhysicalMedium: CameraMedium;
  cameraEffectiveMedium: CameraMedium;
  cameraY: number;
  cameraX: number;
  cameraZ: number;
  cameraYaw: number;
  cameraPitch: number;
  cameraForwardY: number;
  cameraDebugHeight: number;
  sunElevation: number;
  cameraSurfaceY: number;
  cameraSurfaceDelta: number;
  waterScatteringR: number;
  waterScatteringG: number;
  waterScatteringB: number;
  underwaterEnvironmentIntensity: number;
  underwaterDebugView: number;
  surfaceCrossingDebugView: number;
  sunShaftsEnabled: boolean;
  sunShaftStrength: number;
  sunShaftContrast: number;
  sunShaftMaxDistance: number;
  skyQuantizationStrength: number;
  skyDitherStrength: number;
  skyHorizonPreservation: number;
  skyElevationBias: number;
  skyLumaWeight: number;
  skyDebugView: number;
}

export class EnvironmentController {
  readonly moonLighting: MoonLighting = {direction:new THREE.Vector3(),visibility:0,intensity:0};
  private readonly solarDirection = new THREE.Vector3();
  readonly state: EnvironmentState = createShowcaseEnvironmentState();

  private readonly target: EnvironmentState = { ...this.state };

  update(dt: number): void {
    if (this.state.animateTime) {
      this.state.timeOfDay = (this.state.timeOfDay + dt * this.state.timeScale) % 24;
      this.target.timeOfDay = this.state.timeOfDay;
    }
    // English: Weather values converge instead of switching, so every renderer observes one continuous environment.
    // 日本語: 各描画系が同じ連続した環境を見るよう、天候値は瞬時に切り替えず補間して収束させる。
    const blend = 1 - Math.exp(-dt * 1.35);
    const keys: (keyof EnvironmentState)[] = [
      'cloudCoverage', 'precipitation', 'windSpeed', 'stormIntensity', 'turbidity', 'horizonHaze', 'aerialDensity', 'moonIntensity',
      'swellStrength', 'swellDirectionOffset', 'mainWaveStrength', 'peakWavelength', 'directionSpread', 'midNormalStrength', 'highNormalStrength',
    ];
    for (const key of keys) {
      const current = this.state[key] as number;
      const next = this.target[key] as number;
      (this.state[key] as number) = THREE.MathUtils.lerp(current, next, blend);
    }
    // English: Directional controls use the shortest angular arc so crossing north never spins the wind or swell field through a full revolution.
    // 日本語: 北方向をまたいでも風向やうねり場が一周しないよう、方向パラメータは最短角度で補間する。
    this.state.windDirection=lerpAngle(this.state.windDirection,this.target.windDirection,blend);
    this.state.swellDirection=lerpAngle(this.state.swellDirection,this.target.swellDirection,blend);
    this.getMoonDirection(this.moonLighting.direction);
    const sunElevation=this.solarDirection.y;
    const moonElevation=this.moonLighting.direction.y;
    // English: Smooth horizon and night gates keep the first full-moon approximation continuous through sunset and moonrise.
    // 日本語: 地平線と夜間のゲートを滑らかにし、満月近似の初版でも日没から月の出まで連続させる。
    this.moonLighting.visibility=smoothstep(-.01,.02,moonElevation)*(1-smoothstep(-.10,.05,sunElevation));
    this.moonLighting.intensity=this.state.moonEnabled?this.state.moonIntensity:0;
  }

  setTarget(key: keyof EnvironmentState, value: number | boolean | string): void {
    (this.target[key] as number | boolean | string) = value;
    if (![
      'cloudCoverage', 'precipitation', 'windSpeed', 'windDirection', 'stormIntensity', 'turbidity', 'horizonHaze', 'aerialDensity', 'moonIntensity',
      'swellStrength', 'swellDirection', 'swellDirectionOffset', 'mainWaveStrength', 'peakWavelength', 'directionSpread', 'midNormalStrength', 'highNormalStrength',
    ].includes(key)) {
      (this.state[key] as number | boolean | string) = value;
    }
  }

  applyPreset(name: ShowcasePreset): void {
    const preset = SHOWCASE_PRESETS[name];
    for (const [key, value] of Object.entries(preset)) this.setTarget(key as keyof EnvironmentState, value as number);
  }

  resetToShowcaseDefaults():void {
    const defaults=createShowcaseEnvironmentState();
    for(const key of Object.keys(defaults) as (keyof EnvironmentState)[]){
      (this.state[key] as EnvironmentState[typeof key])=defaults[key];
      (this.target[key] as EnvironmentState[typeof key])=defaults[key];
    }
  }

  getSunDirection(target = new THREE.Vector3()): THREE.Vector3 {
    const angle = ((this.state.timeOfDay - 6) / 24) * Math.PI * 2;
    return target.set(Math.cos(angle) * .72, Math.sin(angle), -.55).normalize();
  }

  getMoonDirection(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.getSunDirection(this.solarDirection)).negate().normalize();
  }
}

function smoothstep(edge0:number,edge1:number,value:number):number {
  const t=THREE.MathUtils.clamp((value-edge0)/(edge1-edge0),0,1);
  return t*t*(3-2*t);
}

function lerpAngle(current:number,target:number,t:number):number {
  const delta=Math.atan2(Math.sin(target-current),Math.cos(target-current));
  return (current+delta*t+Math.PI*2)%(Math.PI*2);
}
