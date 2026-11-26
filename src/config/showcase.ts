import type { AudioSettings } from '../audio/ProceduralAudioEngine';
import type { EnvironmentState } from '../environment/Environment';

export type ShowcasePreset = 'calm-day' | 'sunset' | 'rain' | 'storm';

export const SHOWCASE_CAMERA = {
  position: [18, 10.5, 23] as const,
  yaw: .665,
  pitch: -.315,
};

export const SHOWCASE_AUDIO_DEFAULTS: Readonly<AudioSettings> = {
  enabled: false,
  masterVolume: .45,
  oceanVolume: .6,
  rainVolume: .5,
};

export const SHOWCASE_PRESETS: Readonly<Record<ShowcasePreset, Readonly<Partial<EnvironmentState>>>> = {
  'calm-day': {timeOfDay:13.5,cloudCoverage:.12,precipitation:0,windSpeed:.24,stormIntensity:0,turbidity:2.2,horizonHaze:.58,aerialDensity:.004},
  sunset: {timeOfDay:17.7,cloudCoverage:.24,precipitation:0,windSpeed:.3,stormIntensity:0,turbidity:3.4,horizonHaze:.82,aerialDensity:.006},
  rain: {timeOfDay:16,cloudCoverage:.82,precipitation:.55,windSpeed:.58,stormIntensity:.48,turbidity:4.8,horizonHaze:1.05,aerialDensity:.015},
  storm: {timeOfDay:15.5,cloudCoverage:1,precipitation:1,windSpeed:1,stormIntensity:1,turbidity:6.2,horizonHaze:1.3,aerialDensity:.022},
};

// English: Keep showcase defaults separate from debug parameters so public presentation settings do not change the rendering implementation.
// 日本語: 公開展示用の初期設定とデバッグ用パラメータを分離し、展示設定が描画実装そのものを変更しないようにする。
export function createShowcaseEnvironmentState():EnvironmentState {
  return {
    timeOfDay:17.6,timeScale:.055,animateTime:true,moonEnabled:true,moonIntensity:1,
    cloudCoverage:.28,precipitation:0,windSpeed:.36,windDirection:.7,stormIntensity:0,waveStrength:1,
    quantizationLevels:6,ditheringStrength:.1,rippleStrength:.9,turbidity:2.8,rayleighStrength:1.05,mieStrength:.75,horizonHaze:.72,
    swellCount:5,swellStrength:.72,swellDirection:.42,swellDirectionOffset:.12,mainWaveCount:16,mainWaveStrength:1.18,
    peakWavelength:27,waveSeed:1337,waveDebugMode:0,directionSpread:.7,midNormalStrength:.12,highNormalStrength:.04,
    foamStrength:0,detailFalloff:.018,aerialDensity:.006,paletteStrength:.82,renderingMode:3,
    environmentReflectionEnabled:true,environmentReflectionOnly:false,environmentMapUpdateRate:3,
    waterLevel:0,averageWaterDepth:6.5,absorptionR:.18,absorptionG:.085,absorptionB:.04,scatteringStrength:.58,
    refractionStrength:1,seabedVariation:8.5,seabedScale:.022,waterVolumeDebugMode:0,
    underwaterDebugCamera:false,underwaterTestDepth:2.5,cameraMediumOverride:'auto',cameraPhysicalMedium:'air',cameraEffectiveMedium:'air',
    cameraY:SHOWCASE_CAMERA.position[1],cameraX:SHOWCASE_CAMERA.position[0],cameraZ:SHOWCASE_CAMERA.position[2],
    cameraYaw:SHOWCASE_CAMERA.yaw,cameraPitch:SHOWCASE_CAMERA.pitch,cameraForwardY:-.31,cameraDebugHeight:SHOWCASE_CAMERA.position[1],
    sunElevation:.5,cameraSurfaceY:0,cameraSurfaceDelta:SHOWCASE_CAMERA.position[1],
    waterScatteringR:.014,waterScatteringG:.085,waterScatteringB:.105,underwaterEnvironmentIntensity:.72,
    underwaterDebugView:0,surfaceCrossingDebugView:0,sunShaftsEnabled:false,sunShaftStrength:.12,sunShaftContrast:1.3,sunShaftMaxDistance:26,
    skyQuantizationStrength:.88,skyDitherStrength:.32,skyHorizonPreservation:.44,skyElevationBias:.15,skyLumaWeight:.75,skyDebugView:0,
  };
}
