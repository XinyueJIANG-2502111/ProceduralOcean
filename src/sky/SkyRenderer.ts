import * as THREE from 'three';
import type { EnvironmentController } from '../environment/Environment';
import type { PaletteManager } from '../palette/PaletteManager';
import { atmosphereGLSL, cloudGLSL, noiseGLSL, paletteGLSL, skyEnvironmentGLSL } from '../shaders/common';
import { underwaterGLSL } from '../shaders/underwater';
import { surfaceBoundaryGLSL } from '../shaders/surfaceBoundary';
import { waterVolumeGLSL } from '../shaders/waterVolume';
import { skyStylizationGLSL } from '../shaders/skyStylization';
import type { OceanRenderer } from '../ocean/OceanRenderer';

const vertexShader = /* glsl */`
varying vec3 vDirection;
void main(){ vDirection=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;

const fragmentShader = /* glsl */`
precision highp float;
uniform float uStorm; uniform float uRain; uniform vec3 uSunDirection; uniform vec3 uCameraPosition;
uniform samplerCube uEnvironmentMap;
varying vec3 vDirection;
${noiseGLSL}
${atmosphereGLSL}
${waterVolumeGLSL}
${cloudGLSL}
${surfaceBoundaryGLSL}
${underwaterGLSL}
${skyEnvironmentGLSL}
${paletteGLSL}
${skyStylizationGLSL}

void main(){
  vec3 direction=normalize(vDirection);
  // English: Use the hysteresis-filtered effective medium for the camera branch; the traced ray still determines the actual interface segment.
  // 日本語: カメラ分岐にはヒステリシス処理済みの有効媒質を使い、実際の界面区間は追跡した光線で判定する。
  bool opticalUnderwater=uCameraMediumOverride==2||(uCameraMediumOverride==0&&uCameraUnderwater==1);
  if(opticalUnderwater) {
    vec3 surfaceHitPosition;
    float surfacePathLength;
    // English: A surface path exists only when the ray really crosses the displaced water field; no fixed view-direction cutoff or fabricated near-camera hit is used.
    // 日本語: 固定した視線方向の閾値やカメラ直前の疑似交点を使わず、変位水面を実際に横切る光線だけを水面経路とする。
    bool surfaceHit=traceMacroSurface(uCameraPosition,direction,surfaceHitPosition,surfacePathLength);
    vec3 seabedHitPosition;
    float cameraPathLength;
    bool seabedHit=false;
    if(surfaceHit)cameraPathLength=surfacePathLength;
    else seabedHit=traceSeabed(uCameraPosition,direction,seabedHitPosition,cameraPathLength);
    float cameraSurfaceReference=surfaceHit?surfaceHitPosition.y:(uCameraPosition.y-uCameraSurfaceDelta);
    vec3 cameraMediumPosition=uCameraPosition+direction*(cameraPathLength*.5);
    vec3 cameraTransmittance=evaluateWaterTransmittance(cameraPathLength);
    vec3 cameraScattering=evaluateWaterInScattering(cameraPathLength,cameraMediumPosition,direction,cameraSurfaceReference,uRain,uStorm);
    vec3 seabedNormal=vec3(0.0,1.0,0.0);
    vec3 seabedLit=vec3(0.0);
    vec3 underwaterColor;
    vec3 interfaceReflection=vec3(0.0);
    vec3 interfaceRefraction=vec3(0.0);
    vec3 combinedInterface=vec3(0.0);
    float interfaceFresnel=0.0;
    bool surfaceTIR=false;
    if(surfaceHit) {
      vec3 surfaceNormal=evaluateMacroSurfaceNormal(surfaceHitPosition.xz);
      vec3 waterSideNormal=-surfaceNormal;
      vec3 refractedToAir=refract(direction,waterSideNormal,IOR_WATER/IOR_AIR);
      bool totalInternalReflection=dot(refractedToAir,refractedToAir)<1e-6;
      surfaceTIR=totalInternalReflection;
      interfaceFresnel=fresnelWaterToAir(clamp(-dot(direction,waterSideNormal),0.0,1.0));
      vec3 reflected=reflect(direction,waterSideNormal);
      interfaceReflection=evaluateUnderwaterEnvironmentApproximation(reflected,surfaceHitPosition,uRain,uStorm);
      if(!totalInternalReflection) {
        // English: Match the ocean-mesh path by sampling the same generated environment for the refracted air ray.
        // 日本語: 屈折した空気側光線に同じ生成環境を参照し、海面メッシュ側の経路と一致させる。
        interfaceRefraction=textureCube(uEnvironmentMap,normalize(refractedToAir)).rgb*uUnderwaterEnvironmentIntensity;
      }
      combinedInterface=mix(interfaceRefraction,interfaceReflection,interfaceFresnel);
      // English: Only the camera-to-interface segment receives water attenuation; the refracted air ray is evaluated as sky without another underwater pass.
      // 日本語: 水中減衰はカメラから界面までに一度だけ適用し、屈折後の空気中の光線は追加の水中処理なしで天空として評価する。
      underwaterColor=combinedInterface*cameraTransmittance+cameraScattering;
    }else if(seabedHit) {
      seabedNormal=evaluateSeabedNormal(seabedHitPosition.xz);
      float moonVisibility;
      vec3 moonTravelDirection=refractMoonIntoWater(uMoonDirection,moonVisibility);
      vec3 moonDirectLight=evaluateMoonLightRadiance(uMoonDirection)*moonVisibility*uMoonIntensity;
      float seabedSurfaceHeight=evaluateMacroSurfaceHeight(seabedHitPosition.xz);
      vec3 seabedAmbient=evaluateUnderwaterDownwellingLight(seabedHitPosition,seabedSurfaceHeight,uRain,uStorm);
      vec3 sunTravelDirection;
      float sunVisibility;
      vec3 underwaterSunRadiance=evaluateUnderwaterSunRadiance(seabedHitPosition,seabedSurfaceHeight,uRain,uStorm,sunTravelDirection,sunVisibility);
      seabedLit=evaluateSeabedRadiance(seabedHitPosition,seabedNormal,seabedAmbient,sunTravelDirection,underwaterSunRadiance,moonTravelDirection,moonDirectLight);
      underwaterColor=seabedLit*cameraTransmittance+cameraScattering;
    }else{
      vec3 deepSource=evaluateUnderwaterAmbientRadiance(cameraMediumPosition,direction,cameraSurfaceReference,uRain,uStorm);
      underwaterColor=deepSource*cameraTransmittance+cameraScattering;
    }
    if(uUnderwaterDebugView==1) underwaterColor=seabedHit?seabedNormal*.5+.5:vec3(.5,1.0,.5);
    if(uUnderwaterDebugView==2) underwaterColor=cameraTransmittance;
    if(uUnderwaterDebugView==3) underwaterColor=cameraScattering;
    if(uUnderwaterDebugView==4||uUnderwaterDebugView==5) underwaterColor=vec3(0.0);
    if(uUnderwaterDebugView==6) underwaterColor=seabedHit?seabedLit:vec3(0.0);
    if(uUnderwaterDebugView==7) underwaterColor=evaluateUnderwaterEnvironmentApproximation(direction,uCameraPosition,uRain,uStorm);
    if(uSurfaceCrossingDebugView==1) underwaterColor=uCameraUnderwater==1?vec3(.08,.48,.9):vec3(.95,.62,.1);
    if(uSurfaceCrossingDebugView==2) underwaterColor=vec3(clamp(.5-uCameraSurfaceDelta*.12,0.0,1.0));
    if(uSurfaceCrossingDebugView==3) underwaterColor=vec3(clamp(cameraPathLength/96.0,0.0,1.0));
    if(uSurfaceCrossingDebugView==4) underwaterColor=surfaceHit?vec3(1.0):vec3(0.0);
    if(uSurfaceCrossingDebugView==5) underwaterColor=vec3(clamp(surfacePathLength/96.0,0.0,1.0));
    if(uSurfaceCrossingDebugView==6) underwaterColor=vec3(clamp(direction.y*.5+.5,0.0,1.0));
    if(uSurfaceCrossingDebugView==7) underwaterColor=interfaceRefraction;
    if(uSurfaceCrossingDebugView==8) underwaterColor=surfaceTIR?interfaceReflection:vec3(0.0);
    if(uSurfaceCrossingDebugView==9) underwaterColor=vec3(interfaceFresnel);
    if(uSurfaceCrossingDebugView==10) underwaterColor=combinedInterface;
    bool rawUnderwaterDebug=uUnderwaterDebugView>0||uSurfaceCrossingDebugView>0;
    vec3 underwaterOutput=rawUnderwaterDebug?underwaterColor:applyRenderingPipeline(underwaterColor,.78,MATERIAL_UNDERWATER);
    gl_FragColor=vec4(underwaterOutput,1.0);
    #include <colorspace_fragment>
    return;
  }
  float cloudAlpha,solarHighlight;
  vec3 physicalSky=evaluatePhysicalSky(direction,uSunDirection,uStorm,cloudAlpha,solarHighlight);
  if(uSurfaceCrossingDebugView>0){
    vec3 diagnostic=uSurfaceCrossingDebugView==1?(uCameraUnderwater==1?vec3(.08,.48,.9):vec3(.95,.62,.1)):uSurfaceCrossingDebugView==2?vec3(clamp(.5-uCameraSurfaceDelta*.12,0.0,1.0)):uSurfaceCrossingDebugView==6?vec3(clamp(direction.y*.5+.5,0.0,1.0)):vec3(0.0);
    gl_FragColor=vec4(diagnostic,1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==10) {
    gl_FragColor=vec4(vec3(evaluateDirectSunIntensity(uSunDirection.y)),1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==11) {
    gl_FragColor=vec4(vec3(evaluateTwilightFactor(uSunDirection.y)),1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==12) {
    gl_FragColor=vec4(vec3(evaluateRayleighDayWeight(uSunDirection.y)),1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==13) {
    gl_FragColor=vec4(vec3(evaluateMoonVisibility(uMoonDirection,uSunDirection)*step(.001,uMoonIntensity)),1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==14) {
    gl_FragColor=vec4(evaluateMoonLightRadiance(uMoonDirection)*evaluateMoonVisibility(uMoonDirection,uSunDirection)*uMoonIntensity,1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==1) {
    gl_FragColor=vec4(physicalSky,1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==2) {
    gl_FragColor=vec4(toneMapLinear(physicalSky),1.0);
    #include <colorspace_fragment>
    return;
  }

  // English: Preserve the established Physical and ToneMapped paths exactly; only visible Palette/Final sky enters the ordered semantic stylization path.
  // 日本語: 既存のPhysicalとToneMapped経路をそのまま保ち、可視のPalette/Final天空だけを順序付き意味スタイライズ経路へ送る。
  if(uRenderingMode<=1&&uSkyDebugView==0) {
    gl_FragColor=vec4(applyRenderingPipeline(physicalSky,1.0,MATERIAL_SKY),1.0);
    #include <colorspace_fragment>
    return;
  }

  vec3 atmospherePhysical=evaluateAtmosphere(direction,uSunDirection,uStorm);
  CloudResult cloudPhysical=evaluateVisibleCloudLayer(direction,uSunDirection,uStorm);
  float stylizedCloudAlpha=stylizeCloudAlpha(cloudPhysical.alpha,cloudPhysical.lowFrequencyAlpha);
  float angularDistance=acos(clamp(dot(direction,uSunDirection),-1.0,1.0));
  float sunDisc=1.0-smoothstep(.015,.023,angularDistance);
  float sunHalo=pow(max(dot(direction,uSunDirection),0.0),180.0)*(.32+uMieStrength*.45);
  float sunVisibility=evaluateSunDiscVisibility(uSunDirection.y);
  float sunMask=clamp((sunDisc+sunHalo*.42)*(1.0-stylizedCloudAlpha*.82)*sunVisibility,0.0,1.0);
  vec3 sunPhysical=evaluateSolarRadiance(uSunDirection)*(1.25+sunDisc*1.95+sunHalo*.55);
  bool useSkyDither=uRenderingMode==3;
  vec3 atmosphereStylized=atmospherePhysical;
  if(uRenderingMode==1) atmosphereStylized=toneMapLinear(atmospherePhysical);
  if(uRenderingMode>=2) atmosphereStylized=stylizeAtmosphere(atmospherePhysical,direction,useSkyDither);
  vec3 cloudStylized=stylizeVisibleCloud(cloudPhysical.baseColor,cloudPhysical.lightResponse,cloudPhysical.stylizationNoise);

  if(uSkyDebugView==3) atmosphereStylized=quantizeSkyRamp(atmospherePhysical,direction,false);
  if(uSkyDebugView==4) atmosphereStylized=quantizeSkyRamp(atmospherePhysical,direction,true);
  if(uSkyDebugView==3||uSkyDebugView==4||uSkyDebugView==5) {
    gl_FragColor=vec4(atmosphereStylized,1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==6) {
    vec3 neutralSky=mix(uPalette[3],uPalette[4],.45);
    gl_FragColor=vec4(mix(neutralSky,cloudStylized,stylizedCloudAlpha),1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==7) {
    gl_FragColor=vec4(vec3(cloudPhysical.lightResponse),1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==8) {
    gl_FragColor=vec4(cloudPhysical.baseColor,1.0);
    #include <colorspace_fragment>
    return;
  }
  if(uSkyDebugView==9) {
    gl_FragColor=vec4(cloudStylized,1.0);
    #include <colorspace_fragment>
    return;
  }

  // English: Atmosphere remains spatial while clouds keep stronger semantic contrast; the sun is composited afterward so the sky ramp cannot swallow its highlight identity.
  // 日本語: 大気は空間性を保ち、雲はより強い意味的コントラストを持たせ、太陽は最後に合成してSky Rampにハイライトの役割を奪わせない。
  vec3 stylizedSky=mix(atmosphereStylized,cloudStylized,stylizedCloudAlpha);
  vec3 stylizedSun=applyRenderingPipeline(sunPhysical,.18,MATERIAL_HIGHLIGHT);
  // English: Composite the visible sun additively so a fading disc cannot replace the local sky with a gray or hollow patch.
  // 日本語: 消えかけた太陽円盤が周囲の空を灰色や空洞状に置換しないよう、可視太陽を加算合成する。
  stylizedSky+=stylizedSun*sunMask;
  float moonCos=clamp(dot(direction,uMoonDirection),-1.0,1.0);
  float moonDisc=smoothstep(.99974,.99992,moonCos);
  float moonHalo=pow(max(moonCos,0.0),1400.0)*.075;
  float moonVisibility=evaluateMoonVisibility(uMoonDirection,uSunDirection);
  float moonMask=(moonDisc+moonHalo)*(1.0-stylizedCloudAlpha*.9)*moonVisibility*uMoonIntensity;
  vec3 stylizedMoon=applyRenderingPipeline(evaluateMoonDiscRadiance(uMoonDirection),.12,MATERIAL_HIGHLIGHT);
  stylizedSky+=stylizedMoon*moonMask;
  gl_FragColor=vec4(stylizedSky,1.0);
  #include <colorspace_fragment>
}`;

export class SkyRenderer {
  readonly mesh:THREE.Mesh;
  private readonly material:THREE.ShaderMaterial;
  constructor(private readonly environment:EnvironmentController,palette:PaletteManager,ocean:OceanRenderer,environmentTexture:THREE.CubeTexture){
    const s=environment.state;
    const waves=ocean.surfaceWaveData;
    this.material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,vertexShader,fragmentShader,uniforms:{
      uTime:{value:0},uClouds:{value:0},uStorm:{value:0},uWind:{value:0},uWindVector:{value:new THREE.Vector2()},uSunDirection:{value:new THREE.Vector3()},uMoonDirection:{value:new THREE.Vector3()},uMoonIntensity:{value:s.moonIntensity},uMoonDiscScale:{value:1},uPalette:{value:palette.colors},uEnvironmentMap:{value:environmentTexture},
      uDitherStrength:{value:.1},uQuantLevels:{value:6},uPaletteStrength:{value:s.paletteStrength},uRenderingMode:{value:s.renderingMode},uTurbidity:{value:s.turbidity},uRayleighStrength:{value:s.rayleighStrength},uMieStrength:{value:s.mieStrength},uHorizonHaze:{value:s.horizonHaze},
      uRain:{value:s.precipitation},uCameraPosition:{value:new THREE.Vector3()},uWaterLevel:{value:s.waterLevel},uAverageWaterDepth:{value:s.averageWaterDepth},uWaterAbsorption:{value:new THREE.Vector3(s.absorptionR,s.absorptionG,s.absorptionB)},
      uWaterScatteringColor:{value:new THREE.Vector3(s.waterScatteringR,s.waterScatteringG,s.waterScatteringB)},uWaterScatteringStrength:{value:s.scatteringStrength},uSeabedScale:{value:s.seabedScale},uSeabedVariation:{value:s.seabedVariation},
      uRefractionStrength:{value:s.refractionStrength},uRefractionNormalDetail:{value:.18},uWaterVolumeDebugMode:{value:s.waterVolumeDebugMode},uCameraUnderwater:{value:0},
      uUnderwaterEnvironmentIntensity:{value:s.underwaterEnvironmentIntensity},uUnderwaterDebugView:{value:s.underwaterDebugView},
      uSwellStrength:{value:s.swellStrength*s.waveStrength},uSwellDirection:{value:s.swellDirection},uSwellDirectionOffset:{value:s.swellDirectionOffset},uWindDirection:{value:s.windDirection},uDirectionSpread:{value:s.directionSpread},uMainWaveStrength:{value:s.mainWaveStrength*s.waveStrength},
      uSwellCount:{value:s.swellCount},uMainWaveCount:{value:s.mainWaveCount},uSwellWaves:{value:waves.swellWaves},uSwellShapes:{value:waves.swellShapes},uMainWaves:{value:waves.mainWaves},
      uCameraSurfaceDelta:{value:s.cameraSurfaceDelta},uCameraMediumOverride:{value:0},uSurfaceCrossingDebugView:{value:s.surfaceCrossingDebugView},
      uSunShaftsEnabled:{value:s.sunShaftsEnabled?1:0},uSunShaftStrength:{value:s.sunShaftStrength},uSunShaftContrast:{value:s.sunShaftContrast},uSunShaftMaxDistance:{value:s.sunShaftMaxDistance},
      uSkyQuantizationStrength:{value:s.skyQuantizationStrength},uSkyDitherStrength:{value:s.skyDitherStrength},uSkyHorizonPreservation:{value:s.skyHorizonPreservation},uSkyElevationBias:{value:s.skyElevationBias},uSkyLumaWeight:{value:s.skyLumaWeight},uSkyDebugView:{value:s.skyDebugView},
    }});
    // English: Extra dome tessellation prevents angular Mie gradients from exposing the sky sphere's triangles after quantization.
    // 日本語: 角度依存のMie勾配を量子化した際に空ドームの三角形が露出しないよう、十分な分割数を使う。
    this.mesh=new THREE.Mesh(new THREE.SphereGeometry(480,128,64),this.material);this.mesh.renderOrder=-1;
  }
  update(elapsed:number,camera:THREE.Camera,cameraUnderwater:boolean):void{
    const s=this.environment.state,u=this.material.uniforms;
    u.uTime.value=elapsed;u.uClouds.value=Math.max(s.cloudCoverage,s.stormIntensity*.82);u.uStorm.value=s.stormIntensity;u.uWind.value=s.windSpeed;
    u.uWindVector.value.set(Math.cos(s.windDirection),Math.sin(s.windDirection));this.environment.getSunDirection(u.uSunDirection.value);
    u.uMoonDirection.value.copy(this.environment.moonLighting.direction);u.uMoonIntensity.value=this.environment.moonLighting.intensity;
    u.uDitherStrength.value=s.ditheringStrength*.42;u.uQuantLevels.value=s.quantizationLevels;u.uPaletteStrength.value=s.paletteStrength;u.uRenderingMode.value=s.renderingMode;
    u.uTurbidity.value=s.turbidity;u.uRayleighStrength.value=s.rayleighStrength;u.uMieStrength.value=s.mieStrength;u.uHorizonHaze.value=s.horizonHaze;
    u.uRain.value=s.precipitation;u.uCameraPosition.value.copy(camera.position);u.uWaterLevel.value=s.waterLevel;u.uAverageWaterDepth.value=s.averageWaterDepth;u.uWaterAbsorption.value.set(s.absorptionR,s.absorptionG,s.absorptionB);
    u.uWaterScatteringColor.value.set(s.waterScatteringR,s.waterScatteringG,s.waterScatteringB);u.uWaterScatteringStrength.value=s.scatteringStrength;u.uSeabedScale.value=s.seabedScale;u.uSeabedVariation.value=s.seabedVariation;
    u.uRefractionStrength.value=s.refractionStrength;u.uWaterVolumeDebugMode.value=Math.round(s.waterVolumeDebugMode);u.uCameraUnderwater.value=cameraUnderwater?1:0;
    u.uUnderwaterEnvironmentIntensity.value=s.underwaterEnvironmentIntensity;u.uUnderwaterDebugView.value=Math.round(s.underwaterDebugView);
    u.uSwellStrength.value=s.swellStrength*s.waveStrength;u.uSwellDirection.value=s.swellDirection;u.uSwellDirectionOffset.value=s.swellDirectionOffset;u.uWindDirection.value=s.windDirection;u.uDirectionSpread.value=s.directionSpread;u.uMainWaveStrength.value=s.mainWaveStrength*s.waveStrength;
    u.uSwellCount.value=Math.round(s.swellCount);u.uMainWaveCount.value=Math.round(s.mainWaveCount);u.uCameraSurfaceDelta.value=s.cameraSurfaceDelta;u.uCameraMediumOverride.value=s.cameraMediumOverride==='air'?1:s.cameraMediumOverride==='water'?2:0;
    u.uSurfaceCrossingDebugView.value=Math.round(s.surfaceCrossingDebugView);u.uSunShaftsEnabled.value=s.sunShaftsEnabled?1:0;u.uSunShaftStrength.value=s.sunShaftStrength;u.uSunShaftContrast.value=s.sunShaftContrast;u.uSunShaftMaxDistance.value=s.sunShaftMaxDistance;
    u.uSkyQuantizationStrength.value=s.skyQuantizationStrength;u.uSkyDitherStrength.value=s.skyDitherStrength;u.uSkyHorizonPreservation.value=s.skyHorizonPreservation;u.uSkyElevationBias.value=s.skyElevationBias;u.uSkyLumaWeight.value=s.skyLumaWeight;u.uSkyDebugView.value=Math.round(s.skyDebugView);
    this.mesh.position.copy(camera.position);
  }
  dispose():void {this.mesh.geometry.dispose();this.material.dispose();}
}
