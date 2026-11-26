export const underwaterGLSL = /* glsl */`
uniform int uCameraUnderwater;
uniform float uUnderwaterEnvironmentIntensity;
uniform int uUnderwaterDebugView;
uniform int uSunShaftsEnabled;
uniform float uSunShaftStrength;
uniform float uSunShaftContrast;
uniform float uSunShaftMaxDistance;
uniform int uSurfaceCrossingDebugView;

const float IOR_AIR=1.0;
const float IOR_WATER=1.333;

float fresnelWaterToAir(float cosI) {
  float n1=IOR_WATER;
  float n2=IOR_AIR;
  cosI=clamp(cosI,0.0,1.0);
  float eta=n1/n2;
  float sin2T=eta*eta*(1.0-cosI*cosI);
  if(sin2T>=1.0)return 1.0;
  float cosT=sqrt(max(1.0-sin2T,0.0));
  float rs=(n1*cosI-n2*cosT)/max(n1*cosI+n2*cosT,1e-6);
  float rp=(n2*cosI-n1*cosT)/max(n2*cosI+n1*cosT,1e-6);
  // English: Use exact water-to-air Fresnel so reflectance approaches total internal reflection continuously at the critical angle.
  // 日本語: 水から空気への正確なフレネル式を使い、臨界角へ近づく際に反射率が全反射へ連続的に移行するようにする。
  return clamp(.5*(rs*rs+rp*rp),0.0,1.0);
}

vec3 refractSunIntoWater(vec3 sunDirection,out float sunVisibility) {
  float discVisibility=evaluateSunDiscVisibility(sunDirection.y);
  vec3 transmitted=refract(-sunDirection,vec3(0.0,1.0,0.0),IOR_AIR/IOR_WATER);
  float validDirection=step(1e-6,dot(transmitted,transmitted));
  // English: Disc visibility and refraction validity are independent gates; each is applied exactly once.
  // 日本語: 太陽円盤の可視性と屈折方向の有効性を独立したゲートとして扱い、それぞれ一度だけ適用する。
  sunVisibility=discVisibility*validDirection;
  return validDirection>0.0?normalize(transmitted):vec3(0.0,-1.0,0.0);
}

vec3 refractMoonIntoWater(vec3 moonDirection,out float moonVisibility) {
  moonVisibility=evaluateMoonVisibility(moonDirection,uSunDirection);
  vec3 transmitted=refract(-moonDirection,vec3(0.0,1.0,0.0),IOR_AIR/IOR_WATER);
  float validDirection=step(1e-6,dot(transmitted,transmitted));
  moonVisibility*=validDirection;
  // English: Moonlight follows the same air-to-water Snell path as sunlight; its visibility is applied once before seabed lighting.
  // 日本語: 月光も太陽光と同じ空気から水へのスネル経路を通し、可視性は海底照明の前に一度だけ適用する。
  return validDirection>0.0?normalize(transmitted):vec3(0.0,-1.0,0.0);
}

float evaluateWaterPhase(float cosTheta) {
  float g=.18;
  float denominator=max(1.0+g*g-2.0*g*clamp(cosTheta,-1.0,1.0),.08);
  // English: A weak bounded Henyey-Greenstein lobe adds directional single scattering without becoming a synthetic light shaft.
  // 日本語: 弱く制限した Henyey-Greenstein 位相関数で、人工的な光柱にならない方向性単一散乱を加える。
  return clamp((1.0-g*g)/pow(denominator,1.5),.58,1.55);
}

vec3 evaluateUnderwaterDownwellingLight(vec3 worldPosition,float surfaceHeight,float rain,float storm) {
  float depth=max(surfaceHeight-worldPosition.y,0.0);
  vec3 skySampleDirection=normalize(vec3(-uSunDirection.x*.16,.96,-uSunDirection.z*.16));
  vec3 physicalSkyIrradiance=textureCube(uEnvironmentMap,skySampleDirection).rgb;
  float skyPath=depth/.68;
  float weatherTransmission=mix(1.0,.66,smoothstep(.35,1.0,max(uClouds,max(rain*.7,storm))));
  // English: Diffuse sky light follows a protected oblique path through the water so depth changes remain continuous.
  // 日本語: 拡散天空光に保護された斜めの水中光路を与え、水深による変化を連続させる。
  return physicalSkyIrradiance*evaluateWaterTransmittance(skyPath)*weatherTransmission*.42;
}

vec3 evaluateUnderwaterSunRadiance(vec3 worldPosition,float surfaceHeight,float rain,float storm,out vec3 sunTravelDirection,out float sunVisibility) {
  sunTravelDirection=refractSunIntoWater(uSunDirection,sunVisibility);
  float depth=max(surfaceHeight-worldPosition.y,0.0);
  float lightPath=depth/max(-sunTravelDirection.y,.18);
  float cloudTransmission=mix(1.0,.16,smoothstep(.28,.9,max(uClouds,max(rain*.72,storm))));
  return evaluateSolarRadiance(uSunDirection)*sunVisibility*cloudTransmission*evaluateWaterTransmittance(lightPath);
}

vec3 evaluateUnderwaterAmbientRadiance(vec3 worldPosition,vec3 viewDirection,float surfaceHeight,float rain,float storm) {
  vec3 ray=normalize(viewDirection);
  float upwardView=smoothstep(-.35,.8,ray.y);
  float horizontalView=1.0-smoothstep(.12,.82,abs(ray.y));
  vec3 downwelling=evaluateUnderwaterDownwellingLight(worldPosition,surfaceHeight,rain,storm);
  float lowLight=evaluateSkyAmbient(uSunDirection.y,storm);
  vec3 waterAmbient=uWaterScatteringColor*(.28+lowLight*.55)*uUnderwaterEnvironmentIntensity;
  // English: Blend continuous directional responses: upward rays receive more downwelling sky, horizontal rays retain water-body scattering, and downward rays favor the local medium.
  // 日本語: 上向きは天空からの下降光、水平は水体散乱、下向きは局所媒質を連続的に混合する。
  return mix(waterAmbient,downwelling,clamp(.18+upwardView*.68,0.0,1.0))*(1.0+horizontalView*.18);
}

vec3 evaluateWaterInScattering(float distanceInWater,vec3 worldPosition,vec3 viewDirection,float surfaceHeight,float rain,float storm) {
  float waterDistance=max(distanceInWater,0.0);
  if(waterDistance<=.0001)return vec3(0.0);
  vec3 transmittance=evaluateWaterTransmittance(waterDistance);
  vec3 ambientSource=evaluateUnderwaterAmbientRadiance(worldPosition,viewDirection,surfaceHeight,rain,storm);
  vec3 sunTravelDirection;
  float sunVisibility;
  vec3 sunRadiance=evaluateUnderwaterSunRadiance(worldPosition,surfaceHeight,rain,storm,sunTravelDirection,sunVisibility);
  float phase=evaluateWaterPhase(dot(sunTravelDirection,-normalize(viewDirection)));
  vec3 directionalSource=sunRadiance*phase*.035;
  float weatherResponse=1.0+rain*.04+storm*.06;
  return integrateWaterInScattering((ambientSource+directionalSource)*weatherResponse,transmittance);
}

vec3 applyUnderwaterMedium(vec3 radiance,float distanceInWater,vec3 worldPosition,vec3 viewDirection,float surfaceHeight,float rain,float storm) {
  float waterDistance=max(distanceInWater,0.0);
  if(waterDistance<=.0001)return radiance;
  vec3 transmittance=evaluateWaterTransmittance(waterDistance);
  // English: Apply attenuation and in-scattering once along the actual water segment; no second underwater fog model is used.
  // 日本語: 実際の水中区間に対して減衰と内部散乱を一度だけ適用し、別の水中フォグは使用しない。
  return radiance*transmittance+evaluateWaterInScattering(waterDistance,worldPosition,viewDirection,surfaceHeight,rain,storm);
}

float evaluateShaftFocus(vec2 worldXZ) {
  float focus=.38;
  // English: Reuse a few actual macro-wave phases at the sunlight entry point; shafts remain anchored to the moving surface without a separate animated noise field.
  // 日本語: 太陽光の入射点で実際のマクロ波位相を少数再利用し、独立したアニメーションノイズを使わず光芒を水面へ固定する。
  for(int i=0;i<4;i++) {
    if(i>=uMainWaveCount)break;
    vec4 wave=uMainWaves[i];
    float k=6.2831853/wave.x;
    float angle=uWindDirection+wave.z*uDirectionSpread*mix(.9,1.18,smoothstep(.03,1.0,uWind));
    vec2 direction=vec2(cos(angle),sin(angle));
    float phase=k*dot(worldXZ,direction)-sqrt(9.81*k)*uTime+wave.w;
    focus+=sin(phase*(2.3+float(i)*.42)+wave.w*.27)*(.26-float(i)*.035);
  }
  return smoothstep(.48,.72,focus);
}

vec3 evaluateUnderwaterSunShafts(vec3 origin,vec3 rayDirection,float waterLength,float surfaceReferenceHeight) {
  if(uSunShaftsEnabled==0||uSunShaftStrength<=0.0||waterLength<=.005)return vec3(0.0);
  float sunVisibility;
  vec3 sunTravel=refractSunIntoWater(uSunDirection,sunVisibility);
  float cloudTransmission=pow(1.0-smoothstep(.25,.8,max(uClouds,uStorm*.85)),2.0);
  float drive=sunVisibility*cloudTransmission*(.3+.7*max(dot(-rayDirection,sunTravel),0.0));
  if(drive<.002)return vec3(0.0);
  float integratedLength=min(waterLength,uSunShaftMaxDistance);
  float stepLength=integratedLength/10.0;
  vec3 accumulation=vec3(0.0);
  for(int i=0;i<10;i++) {
    float viewLength=(float(i)+.5)*stepLength;
    vec3 samplePosition=origin+rayDirection*viewLength;
    // English: The geometric ray supplies its exact water segment; a local surface-height reference avoids retracing the full spectrum at every light sample.
    // 日本語: 幾何学的光線が正確な水中区間を与えるため、局所水面高を参照して各光サンプルで全波スペクトルを再計算しない。
    float depth=max(surfaceReferenceHeight-samplePosition.y,0.0);
    if(depth<.005)continue;
    float sunlightLength=depth/max(-sunTravel.y,.15);
    vec2 sunlightEntry=samplePosition.xz-sunTravel.xz*sunlightLength;
    float focus=evaluateShaftFocus(sunlightEntry);
    float contrast=pow(focus,1.0+uSunShaftContrast*2.0);
    vec3 sunTransmission=evaluateWaterTransmittance(sunlightLength);
    vec3 viewTransmission=evaluateWaterTransmittance(viewLength);
    accumulation+=sunTransmission*viewTransmission*contrast*stepLength;
  }
  // English: This is only a directional, nonuniform addition to the existing scattering integral; each sample includes both solar and camera water paths.
  // 日本語: 既存の散乱積分へ方向性のある不均一な増分だけを加え、各サンプルで太陽側とカメラ側の水中光路を両方減衰させる。
  return accumulation*evaluateSolarRadiance(uSunDirection)*uWaterScatteringColor*uWaterScatteringStrength*uSunShaftStrength*drive*12.0;
}

vec3 evaluateUnderwaterEnvironmentApproximation(vec3 direction,vec3 origin,float rain,float storm) {
  vec3 ray=normalize(direction);
  float downward=clamp(-ray.y,0.0,1.0);
  vec3 ambient=evaluateUnderwaterAmbientRadiance(origin+ray*.35,ray,origin.y,rain,storm);
  vec3 deepWater=uWaterScatteringColor*(.24+.22*evaluateSkyAmbient(uSunDirection.y,storm));
  vec3 shallowDownwelling=evaluateUnderwaterDownwellingLight(origin,origin.y,rain,storm)*1.18;
  vec3 reflectedWater=mix(shallowDownwelling,deepWater,smoothstep(.28,1.0,downward)*.46);
  vec3 source=mix(reflectedWater,ambient,.22);
  // English: TIR reflects the shallow water-side illumination, not a fixed blue fallback, keeping the Snell-window boundary continuous in source color.
  // 日本語: 全反射では固定青色ではなく浅い水側照明を反射し、スネル窓境界の光源色を連続させる。
  // English: Return interface radiance without camera-path attenuation; the caller applies Beer-Lambert exactly once after Fresnel mixing.
  // 日本語: 界面放射輝度だけを返し、カメラ光路の Beer-Lambert 減衰はフレネル混合後に呼び出し側で一度だけ適用する。
  return source*mix(.72,1.0,uUnderwaterEnvironmentIntensity);
}
`;
