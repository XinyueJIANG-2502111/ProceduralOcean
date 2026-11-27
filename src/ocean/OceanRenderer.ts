import * as THREE from 'three';
import type { EnvironmentController } from '../environment/Environment';
import type { PaletteManager } from '../palette/PaletteManager';
import { atmosphereGLSL, noiseGLSL, paletteGLSL } from '../shaders/common';
import { underwaterGLSL } from '../shaders/underwater';
import { surfaceBoundaryGLSL } from '../shaders/surfaceBoundary';
import { waterVolumeGLSL } from '../shaders/waterVolume';
import { SwellSpectrum } from './GerstnerWaveSpectrum';
import { RippleSimulation } from './RippleSimulation';
import { WindWaveSpectrum } from './WindWaveSpectrum';

const vertexShader = /* glsl */`
uniform float uTime;
uniform float uWind;
uniform float uSwellStrength;
uniform float uSwellDirection;
uniform float uSwellDirectionOffset;
uniform float uWindDirection;
uniform float uDirectionSpread;
uniform float uMainWaveStrength;
uniform vec3 uCameraPosition;
uniform int uSwellCount;
uniform int uMainWaveCount;
uniform vec4 uSwellWaves[6];
uniform vec2 uSwellShapes[6];
uniform vec4 uMainWaves[20];
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vWaveHeight;
varying float vWaveSlope;
varying float vWaveCurvature;

vec3 swellWave(vec2 p,vec4 data,vec2 shape,inout vec3 tangent,inout vec3 binormal,inout float crestCurvature,inout float curvatureWeight,inout vec2 waveNormalization) {
  float wavelength = data.x;
  float k = 6.2831853 / wavelength;
  // English: Deep-water dispersion gives each wavelength its own angular frequency, preventing synchronized texture-like motion.
  // 日本語: 深水波の分散関係で波長ごとの角周波数を決め、テクスチャのように全波が同期する動きを防ぐ。
  float omega = sqrt(9.81 * k);
  // English: Long swell keeps an independent direction and responds only weakly to the current local wind.
  // 日本語: 長周期のうねりは独立した方向を保ち、現在の局地風には弱くしか反応しない。
  float angle=uSwellDirection+uSwellDirectionOffset+data.z;
  vec2 dir = vec2(cos(angle), sin(angle));
  float phase = k * dot(dir, p) - omega * uTime + data.w;
  float a=data.y*uSwellStrength*mix(.92,1.08,smoothstep(.15,1.0,uWind));
  float q=shape.x/max(k*a*float(max(uSwellCount,1)),.001);
  float s = sin(phase), c = cos(phase);
  float curvatureScale=a*k*k;
  crestCurvature+=pow(max(s,0.0),4.0)*curvatureScale;
  curvatureWeight+=curvatureScale;
  waveNormalization+=vec2(a,a*k);
  tangent += vec3(-q*dir.x*dir.x*a*k*s, dir.x*a*k*c, -q*dir.x*dir.y*a*k*s);
  binormal += vec3(-q*dir.x*dir.y*a*k*s, dir.y*a*k*c, -q*dir.y*dir.y*a*k*s);
  return vec3(q*dir.x*a*c, a*s, q*dir.y*a*c);
}

void windWave(vec2 p,vec4 data,float distanceWeight,inout vec3 position,inout vec3 tangent,inout vec3 binormal,inout float crestCurvature,inout float curvatureWeight,inout vec2 waveNormalization) {
  float wavelength=data.x;
  float k=6.2831853/wavelength;
  float omega=sqrt(9.81*k);
  float windCurve=smoothstep(.03,1.0,uWind);
  float spreadResponse=mix(.9,1.18,windCurve);
  float angle=uWindDirection+data.z*uDirectionSpread*spreadResponse;
  vec2 dir=vec2(cos(angle),sin(angle));
  // English: A cosine-power directional distribution keeps most energy near the wind while retaining a controlled spread.
  // 日本語: 余弦べき乗の方向分布により、制御された広がりを残しつつエネルギーを主風向付近へ集中させる。
  float directionalAmplitude=pow(max(cos(data.z*uDirectionSpread),0.0),1.35);
  // English: Main waves carry the most readable motion at ordinary wind speeds; deep-water dispersion still controls their speed.
  // 日本語: 通常風況で最も読み取りやすい運動を主風浪が担い、速度自体は引き続き深水分散則で決まる。
  float amplitude=data.y*uMainWaveStrength*directionalAmplitude*mix(.16,1.55,pow(windCurve,.72))*distanceWeight;
  float phase=k*dot(dir,p)-omega*uTime+data.w;
  float s=sin(phase),c=cos(phase);
  float curvatureScale=amplitude*k*k;
  crestCurvature+=pow(max(s,0.0),4.0)*curvatureScale;
  curvatureWeight+=curvatureScale;
  waveNormalization+=vec2(amplitude,amplitude*k);
  // English: Main wind waves carry vertical displacement and analytic slope, leaving strong horizontal Gerstner motion to the swell layer.
  // 日本語: 主風浪は鉛直変位と解析的勾配を担い、強い水平Gerstner変位はうねり層だけに残す。
  position.y+=amplitude*s;
  tangent.y+=amplitude*k*dir.x*c;
  binormal.y+=amplitude*k*dir.y*c;
}

void main() {
  vec4 baseWorld=modelMatrix*vec4(position,1.0);
  vec3 pos=baseWorld.xyz; vec3 tangent=vec3(1,0,0); vec3 binormal=vec3(0,0,1);
  float crestCurvature=0.0;
  float curvatureWeight=0.0;
  vec2 waveNormalization=vec2(0.0);
  float horizontalDistance=length(baseWorld.xz-uCameraPosition.xz);
  // English: Preserve most main-wave displacement at long range, removing only the portion that would become under-sampled.
  // 日本語: 遠距離でも主風浪変位の大部分を残し、標本不足になる成分だけを抑える。
  float mainDistanceWeight=mix(.72,1.0,1.0/(1.0+pow(horizontalDistance/250.0,2.0)));
  for (int i=0; i<6; i++) {
    if (i >= uSwellCount) break;
    // English: Anchor phase in world space so mesh recentering never resets the visible wave pattern.
    // 日本語: メッシュを再配置しても波の見た目がリセットされないよう、位相をワールド空間に固定する。
    pos+=swellWave(baseWorld.xz,uSwellWaves[i],uSwellShapes[i],tangent,binormal,crestCurvature,curvatureWeight,waveNormalization);
  }
  for(int i=0;i<20;i++){
    if(i>=uMainWaveCount)break;
    windWave(baseWorld.xz,uMainWaves[i],mainDistanceWeight,pos,tangent,binormal,crestCurvature,curvatureWeight,waveNormalization);
  }
  // English: Stabilize only far vertical geometry so low tessellation cannot bend the silhouette; analytic normals and fragment-scale reflection detail remain active.
  // 日本語: 低テッセレーションで輪郭が曲がらないよう遠方の鉛直ジオメトリだけを安定化し、解析法線とフラグメント反射ディテールは維持する。
  float farGeometryWeight=mix(.42,1.0,1.0/(1.0+pow(horizontalDistance/520.0,2.0)));
  pos.y=baseWorld.y+(pos.y-baseWorld.y)*farGeometryWeight;
  vWorldNormal=normalize(cross(binormal,tangent));
  vWorldPosition=pos;
  vWaveHeight=(pos.y-baseWorld.y)/max(waveNormalization.x,.001);
  vWaveSlope=length(vec2(tangent.y,binormal.y))/max(waveNormalization.y,.001);
  vWaveCurvature=crestCurvature/max(curvatureWeight,.0001);
  gl_Position=projectionMatrix*viewMatrix*vec4(pos,1.0);
}
`;

const fragmentShader = /* glsl */`
precision highp float;
uniform float uTime; uniform float uWind;
uniform float uRain; uniform float uStorm; uniform float uClouds;
uniform float uRippleStrength; uniform float uMidStrength; uniform float uHighStrength;
uniform float uFoamStrength; uniform float uWaveEnergy;
uniform float uDetailFalloff; uniform float uAerialDensity;
uniform float uEnvironmentMaxMip;
uniform int uEnvironmentReflectionEnabled; uniform int uEnvironmentReflectionOnly; uniform int uWaveDebugMode;
uniform vec3 uSunDirection; uniform vec3 uCameraPosition;
uniform vec4 uRipples[32];
uniform samplerCube uEnvironmentMap;
varying vec3 vWorldPosition; varying vec3 vWorldNormal;
varying float vWaveHeight; varying float vWaveSlope; varying float vWaveCurvature;
${noiseGLSL}
${atmosphereGLSL}
${waterVolumeGLSL}
${surfaceBoundaryGLSL}
${underwaterGLSL}
${paletteGLSL}

float rippleHeight(vec2 p) {
  float total=0.0;
  for(int i=0;i<32;i++) {
    vec4 r=uRipples[i]; float d=distance(p,r.xy); float radius=r.z*2.35;
    float ring=sin((d-radius)*13.0)*exp(-abs(d-radius)*3.15);
    float onset=smoothstep(0.0,.11,r.z);
    float lifetime=1.0-smoothstep(2.9,4.6,r.z);
    // English: Let each rain ring expand and fade through a full lifecycle; impact-rate limiting prevents newer drops from evicting it immediately.
    // 日本語: 各雨波紋を完全な寿命で拡張・減衰させ、着水頻度の制限によって新しい雨粒が即座に押し出さないようにする。
    total += ring*onset*lifetime*exp(-r.z*.24)*r.w*step(r.z,4.6);
  }
  return total*uRippleStrength;
}

float directionalWave(vec2 p,vec2 direction,float frequency,float phase,float timeSpeed) {
  float wavePhase=dot(p,direction)*frequency+phase+uTime*timeSpeed;
  float phaseFootprint=fwidth(wavePhase);
  // English: Fade detail only when its phase is smaller than a pixel, preventing distant mid/high components from aliasing into stable bands.
  // 日本語: 位相がピクセルより細かい場合だけディテールを弱め、遠方の中高周波成分が固定縞へエイリアシングしないようにする。
  float resolvable=1.0-smoothstep(1.15,3.14159265,phaseFootprint);
  return sin(wavePhase)*resolvable;
}

vec2 detailHeights(vec2 p) {
  vec2 wind=vec2(cos(uWindDirection),sin(uWindDirection));
  vec2 crossWind=vec2(-wind.y,wind.x);
  float warpA=fbm(p*.025+wind*uTime*.009);
  float warpB=fbm(p*.037-crossWind*uTime*.007);
  vec2 warpedP=p+wind*(warpA-.5)*2.1+crossWind*(warpB-.5)*1.65;
  vec2 d0=normalize(wind+crossWind*-.22);
  vec2 d1=normalize(wind+crossWind*.11);
  vec2 d2=normalize(wind+crossWind*.31);
  vec2 d3=normalize(wind+crossWind*-.37);
  vec2 d4=normalize(wind+crossWind*.47);
  vec2 d5=normalize(wind+crossWind*-.08);
  // English: Several irregular directional components use low-frequency phase warping, preserving wind alignment without exposing periodic sine bands.
  // 日本語: 複数の不規則な方向成分に低周波位相ワープを加え、風向きを保ちながら周期的な正弦縞が露出しないようにする。
  float mid=directionalWave(warpedP,d0,.31,1.13,.29)*.25
    +directionalWave(warpedP,d1,.47,4.71,-.23)*.21
    +directionalWave(warpedP,d2,.69,2.37,.38)*.17
    +directionalWave(warpedP,d3,.93,5.82,-.31)*.14
    +directionalWave(warpedP,d4,1.21,.64,.46)*.11
    +directionalWave(warpedP,d5,1.57,3.49,-.42)*.08;
  float high=directionalWave(warpedP,d1,1.37,3.18,.72)*.12
    +directionalWave(warpedP,d5,1.83,.91,-.61)*.095
    +directionalWave(warpedP,d2,2.41,5.26,.94)*.072
    +directionalWave(warpedP,d0,3.07,2.04,-.83)*.054
    +directionalWave(warpedP,d4,3.89,4.43,1.17)*.039
    +directionalWave(warpedP,d3,4.73,.27,-1.04)*.028;
  float patchNoise=fbm(p*.018+wind*uTime*.004-crossWind*uTime*.002);
  mid*=mix(.78,1.12,patchNoise);
  high*=mix(.82,1.08,patchNoise);
  return vec2(mid,high);
}

vec3 evaluateSurfaceNormal(vec2 p,float horizontalDistance,out vec3 opticalNormal,out float midWeight,out float highWeight,out float opticalDetail) {
  float distanceScale=clamp(.018/max(uDetailFalloff,.004),.72,1.6);
  float midResponseDistance=1.0/(1.0+pow(horizontalDistance/(155.0*distanceScale),2.0));
  float highResponseDistance=1.0/(1.0+pow(horizontalDistance/(52.0*distanceScale),2.0));
  float rainResponseDistance=1.0/(1.0+pow(horizontalDistance/(30.0*distanceScale),3.0));
  // English: Distance removes high frequencies first while retaining mid-frequency slope and the geometry wave field.
  // 日本語: 距離では高周波から先に除去し、中周波の勾配と幾何波フィールドは長く保持する。
  midWeight=mix(.34,1.0,midResponseDistance);
  highWeight=mix(.045,1.0,highResponseDistance);
  float rainWeight=rainResponseDistance;
  float eps=.08;
  vec2 h=detailHeights(p), hx=detailHeights(p+vec2(eps,0)), hz=detailHeights(p+vec2(0,eps));
  float rh=rippleHeight(p), rx=rippleHeight(p+vec2(eps,0)), rz=rippleHeight(p+vec2(0,eps));
  float midResponse=uMidStrength*mix(.35,1.45,smoothstep(.08,.82,uWind));
  float highResponse=uHighStrength*mix(.18,1.8,smoothstep(.02,.68,uWind))+uRain*.055;
  // English: Retaining a small statistical roughness floor keeps distant grazing reflections from collapsing into a perfect macro mirror.
  // 日本語: 遠方でも統計的な粗さを少量残し、掠れ角の反射が完全なマクロ鏡面へ退化するのを防ぐ。
  float detailEnabled=float(uWaveDebugMode==0||uWaveDebugMode==3||uWaveDebugMode==4||uWaveDebugMode==5);
  float rainEnabled=float(uWaveDebugMode==0);
  vec2 midSlope=vec2((h.x-hx.x)/eps,(h.x-hz.x)/eps)*midResponse*midWeight;
  vec2 opticalHighSlope=vec2((h.y-hx.y)/eps,(h.y-hz.y)/eps)*highResponse*highWeight*detailEnabled;
  opticalDetail=clamp(length(opticalHighSlope)*1.7,0.0,1.0);
  // English: High-frequency detail should mainly break reflected shapes and highlights, not carve the near field into a pitted solid.
  // 日本語: 高周波ディテールは主に反射形状とハイライトを砕き、近景を凹凸だらけの固体へ削らないようにする。
  vec2 shapingSlope=(midSlope+opticalHighSlope*.18)*detailEnabled;
  vec2 opticalSlope=(midSlope+opticalHighSlope*.52)*detailEnabled;
  vec2 rainSlope=vec2((rh-rx)*.32,(rh-rz)*.32)*rainWeight*rainEnabled;
  vec3 shapingNormal=normalize(vWorldNormal+vec3(shapingSlope.x,0.0,shapingSlope.y)+vec3(rainSlope.x,0.0,rainSlope.y));
  opticalNormal=normalize(vWorldNormal+vec3(opticalSlope.x,0.0,opticalSlope.y)+vec3(rainSlope.x,0.0,rainSlope.y));
  return shapingNormal;
}

float evaluatePhysicalReflectionRoughness(float opticalDetail) {
  float normalRoughness=clamp(uMidStrength*1.8+uHighStrength*4.0,0.0,1.0);
  float weatherRoughness=clamp(uWind*.22+sqrt(max(uRain,0.0))*.22+uStorm*.2,0.0,1.0);
  return clamp(.04+smoothstep(.05,1.0,weatherRoughness+normalRoughness*.24)*.68+opticalDetail*.08,.04,.82);
}

float evaluateDistanceLodBias(float horizontalDistance) {
  // English: Physical roughness is weather-driven; distance contributes only a restrained anti-aliasing mip bias.
  // 日本語: 物理的粗さは天候で決まり、距離は控えめなアンチエイリアス用Mipバイアスだけを加える。
  return smoothstep(140.0,420.0,horizontalDistance)*.18;
}

float environmentMipLevel(float roughness,float distanceLodBias) {
  // English: Sample a blurrier environment mip as surface roughness increases, approximating the angular spread of reflected light.
  // 日本語: 表面粗さが増えるほどぼかした環境マップのMipを参照し、反射光の角度的な広がりを近似する。
  float lodFactor=pow(clamp(roughness,0.0,1.0),1.15);
  return min(uEnvironmentMaxMip*.86,lodFactor*uEnvironmentMaxMip*.72+distanceLodBias);
}

vec3 sampleEnvironment(vec3 direction,float roughness,float distanceLodBias) {
  vec3 environmentSample=textureCubeLodEXT(uEnvironmentMap,direction,environmentMipLevel(roughness,distanceLodBias)).rgb;
  float overcastResponse=smoothstep(.5,.95,max(uClouds,max(uRain*.82,uStorm*.9)));
  float reflectionLuminance=max(dot(environmentSample,vec3(.2126,.7152,.0722)),.0001);
  float compressedLuminance=reflectionLuminance/(1.0+reflectionLuminance*1.25);
  vec3 compressedReflection=environmentSample*(compressedLuminance/reflectionLuminance);
  // English: Compress only dense-cloud HDR reflections so grazing Fresnel cannot turn overcast water into a clipped white sheet.
  // 日本語: 濃い雲のHDR反射だけを圧縮し、掠れ角フレネルで曇天の水面が白く飽和しないようにする。
  return mix(environmentSample,compressedReflection,overcastResponse);
}

vec3 evaluateEnvironmentReflection(vec3 reflectionDirection,float roughness,float distanceLodBias,vec3 waterBody) {
  if(uEnvironmentReflectionEnabled==0)return waterBody;
  vec3 environmentSample=sampleEnvironment(reflectionDirection,roughness,distanceLodBias);
  // English: Fade lower-hemisphere reflections into the water body continuously without collapsing directions toward the horizon.
  // 日本語: 反射方向を地平線へ潰さず、下半球の反射を水本体へ連続的にフェードする。
  float environmentWeight=smoothstep(-.10,.02,reflectionDirection.y);
  return mix(waterBody,environmentSample,environmentWeight);
}

vec3 evaluateDirectionalWaterSpecular(vec2 p,vec3 lightDirection,vec3 lightRadiance,float concentration,vec3 n,vec3 viewDir,float highWeight,float opticalDetail,out float spec) {
  if(dot(lightRadiance,lightRadiance)<.000001) {spec=0.0;return vec3(0.0);}
  vec3 halfDir=normalize(viewDir+lightDirection);
  float specPower=mix(120.0,34.0,smoothstep(.08,1.0,uWind))*concentration;
  float noL=max(dot(n,lightDirection),0.0);
  spec=pow(max(dot(n,halfDir),0.0),specPower)*noL;
  vec2 wind=vec2(cos(uWindDirection),sin(uWindDirection));
  float specNoise=fbm(p*.12+wind*uTime*.028);
  spec*=mix(.86,1.08,specNoise)*mix(.82,1.0,highWeight)*mix(1.0,.9,opticalDetail);
  // English: Sun and moon share one normal-driven glint; the analytic moon reflection resolves wave highlights beyond the cubemap's 64-pixel faces.
  // 日本語: 太陽と月で法線駆動の高光を共有し、64ピクセルのキューブ面では表せない月光の波面ハイライトを解析的に描く。
  return lightRadiance*spec;
}

float evaluateFoamMask(vec2 p,float distanceToCamera,float midWeight) {
  vec2 wind=vec2(cos(uWindDirection),sin(uWindDirection));
  vec2 crossWind=vec2(-wind.y,wind.x);
  vec2 advected=p-wind*uTime*(.18+uWind*.38);
  vec2 foamSpace=vec2(dot(advected,wind),dot(advected,crossWind));
  float weatherResponse=smoothstep(.22,.58,uWind+uStorm*.12);
  float energyResponse=smoothstep(.18,.92,uWaveEnergy);
  float energyWindGate=smoothstep(.22,.42,uWind+uStorm*.2);
  float environmentFoamDrive=max(weatherResponse,energyResponse*.85*energyWindGate);
  float crestScore=smoothstep(.24,.62,vWaveHeight);
  float steepnessScore=smoothstep(.28,.62,vWaveSlope);
  // English: vWaveCurvature is a crest-localized proxy, so normalize its measured scale before combining it with height and slope.
  // 日本語: vWaveCurvature は波峰付近の代理値なので、実測スケールを正規化してから高さ・勾配と組み合わせる。
  float curvatureScore=smoothstep(.08,.34,vWaveCurvature);
  float breakingScore=crestScore*.5+curvatureScore*.38+steepnessScore*.12;
  breakingScore*=mix(.78,1.12,weatherResponse);
  // English: Threshold normalized crest proxies at their meaningful range so overcast weather increases foam quantity without turning the entire surface into foam.
  // 日本語: 正規化した波峰代理値を有効な範囲で閾値化し、曇天で泡を増やしても水面全体が泡にならないようにする。
  float baseBreakingMask=pow(smoothstep(.44,.78,breakingScore),.75);
  float foamNoise=fbm(foamSpace*.11+wind*uTime*.014);
  float breakup=mix(.58,1.0,smoothstep(.3,.72,foamNoise));
  float phaseEnvelope=.5+.5*sin(uTime*.075+noise2(foamSpace*.052+31.4)*6.2831853);
  float lifecycle=mix(.76,1.0,smoothstep(.16,.84,phaseEnvelope));
  float distanceResponse=mix(.68,1.0,midWeight)*mix(1.0,.82,smoothstep(220.0,390.0,distanceToCamera));
  // English: Build one continuous breaking score first; noise and lifetime only fragment visible foam instead of multiplying gates until it disappears.
  // 日本語: まず連続した砕波スコアを作り、ノイズや寿命は泡を消すのではなく、見える泡の形を崩すためだけに使う。
  return clamp(baseBreakingMask*breakup*lifecycle*environmentFoamDrive*uFoamStrength*distanceResponse,0.0,1.0);
}

vec3 evaluateAerialPerspective(vec3 surfaceColor) {
  vec2 toFragmentXZ=vWorldPosition.xz-uCameraPosition.xz;
  float horizontalDistance=length(toFragmentXZ);
  float fogDistance=max(horizontalDistance-82.0,0.0);
  float fogDensity=uAerialDensity*(.65+uHorizonHaze*.35+uStorm*.3);
  // English: Delay aerial blending through the middle distance so the horizon converges without erasing readable water structure too early.
  // 日本語: 中距離の大気混合を遅らせ、地平線へ収束しながら水面構造を早期に消さない。
  float fogScale=mix(.23,.16,uStorm);
  float fogFactor=(1.0-exp(-fogDistance*fogDensity*fogScale))*.88;
  vec3 atmosphereColor=surfaceColor;
  if(horizontalDistance>.02) {
    vec2 horizonXZ=toFragmentXZ/horizontalDistance;
    vec3 horizonDirection=normalize(vec3(horizonXZ.x,.035,horizonXZ.y));
    float aerialMipFactor=mix(.25,.50,fogFactor);
    atmosphereColor=textureCubeLodEXT(uEnvironmentMap,horizonDirection,uEnvironmentMaxMip*aerialMipFactor).rgb;
  }
  return mix(surfaceColor,atmosphereColor,fogFactor);
}

vec3 evaluateUnderwaterSurface(vec3 shapingNormal,vec3 opticalNormal,vec3 viewDir,float reflectionRoughness,out bool totalInternalReflection,out vec3 underwaterNormal,out vec3 underwaterReflection,out vec3 underwaterRefraction,out float interfaceFresnel,out vec3 interfaceRadiance) {
  vec3 stableNormal=normalize(mix(shapingNormal,opticalNormal,.28));
  underwaterNormal=gl_FrontFacing?stableNormal:-stableNormal;
  if(dot(underwaterNormal,viewDir)<0.0) underwaterNormal=-underwaterNormal;
  vec3 incidentDir=-viewDir;
  vec3 refractedToAir=refract(incidentDir,underwaterNormal,IOR_WATER/IOR_AIR);
  float refractedLengthSquared=dot(refractedToAir,refractedToAir);
  // English: Water-to-air refraction can fail beyond the critical angle; never normalize that zero vector and route it to total internal reflection.
  // 日本語: 水中から空気への屈折は臨界角を超えると成立しないため、ゼロベクトルを正規化せず全反射へ分岐する。
  totalInternalReflection=refractedLengthSquared<1e-6;
  vec3 reflectedDir=normalize(reflect(incidentDir,underwaterNormal));
  // English: The reflected branch is always an underwater environment; only valid water-to-air refraction may sample the sky cubemap through Snell's window.
  // 日本語: 反射分岐は常に水中環境とし、有効な水中から空気への屈折だけがスネルの窓を通して空のキューブマップを参照する。
  vec3 reflectedRadiance=evaluateUnderwaterEnvironmentApproximation(reflectedDir,vWorldPosition,uRain,uStorm);
  underwaterReflection=reflectedRadiance;
  float cosTheta=clamp(-dot(incidentDir,underwaterNormal),0.0,1.0);
  interfaceFresnel=fresnelWaterToAir(cosTheta);
  vec3 transmittedRadiance=vec3(0.0);
  if(!totalInternalReflection) {
    refractedToAir=normalize(refractedToAir);
    transmittedRadiance=sampleEnvironment(refractedToAir,.075,0.0)*uUnderwaterEnvironmentIntensity;
  }
  underwaterRefraction=transmittedRadiance;
  interfaceRadiance=mix(transmittedRadiance,reflectedRadiance,interfaceFresnel);
  return interfaceRadiance;
}

void main() {
  vec2 p=vWorldPosition.xz;
  float distanceToCamera=length(vWorldPosition-uCameraPosition);
  float horizontalDistance=length(p-uCameraPosition.xz);
  float midWeight,highWeight;
  vec3 opticalNormal;
  float opticalDetail;
  vec3 n=evaluateSurfaceNormal(p,horizontalDistance,opticalNormal,midWeight,highWeight,opticalDetail);
  vec3 viewDir=normalize(uCameraPosition-vWorldPosition);
  vec3 reflectionDir=normalize(reflect(-viewDir,opticalNormal));
  float reflectionRoughness=evaluatePhysicalReflectionRoughness(opticalDetail);
  float distanceLodBias=evaluateDistanceLodBias(horizontalDistance);

  // English: The effective camera medium includes CPU hysteresis; signed surface depth remains a diagnostic and ray-segment input instead of independently flipping the whole shader.
  // 日本語: 有効なカメラ媒質には CPU のヒステリシスを含め、符号付き水面深度は画面全体の分岐ではなく診断と光路計算に使用する。
  bool opticalUnderwater=uCameraMediumOverride==2||(uCameraMediumOverride==0&&uCameraUnderwater==1);
  if(opticalUnderwater) {
    bool totalInternalReflection;
    vec3 underwaterNormal;
    vec3 underwaterReflection;
    vec3 underwaterRefraction;
    float interfaceFresnel;
    vec3 interfaceRadiance;
    evaluateUnderwaterSurface(n,opticalNormal,viewDir,reflectionRoughness,totalInternalReflection,underwaterNormal,underwaterReflection,underwaterRefraction,interfaceFresnel,interfaceRadiance);
    float cameraWaterDistance=length(uCameraPosition-vWorldPosition);
    vec3 cameraTransmittance=evaluateWaterTransmittance(cameraWaterDistance);
    vec3 cameraRayDirection=normalize(vWorldPosition-uCameraPosition);
    vec3 cameraMediumPosition=(uCameraPosition+vWorldPosition)*.5;
    vec3 cameraScattering=evaluateWaterInScattering(cameraWaterDistance,cameraMediumPosition,cameraRayDirection,vWorldPosition.y,uRain,uStorm);
    vec3 underwaterColor=interfaceRadiance*cameraTransmittance+cameraScattering;
    if(uUnderwaterDebugView==1) underwaterColor=underwaterNormal*.5+.5;
    if(uUnderwaterDebugView==2) underwaterColor=cameraTransmittance;
    if(uUnderwaterDebugView==3) underwaterColor=cameraScattering;
    if(uUnderwaterDebugView==4) underwaterColor=totalInternalReflection?vec3(0.0):vec3(1.0);
    if(uUnderwaterDebugView==5) underwaterColor=totalInternalReflection?vec3(1.0):vec3(0.0);
    if(uUnderwaterDebugView==6) underwaterColor=vec3(0.0);
    if(uUnderwaterDebugView==7) underwaterColor=underwaterReflection;
    if(uSurfaceCrossingDebugView==1) underwaterColor=uCameraUnderwater==1?vec3(.08,.48,.9):vec3(.95,.62,.1);
    if(uSurfaceCrossingDebugView==2) underwaterColor=vec3(clamp(.5-uCameraSurfaceDelta*.12,0.0,1.0));
    if(uSurfaceCrossingDebugView==3) underwaterColor=vec3(clamp(cameraWaterDistance/96.0,0.0,1.0));
    if(uSurfaceCrossingDebugView==4) underwaterColor=vec3(1.0);
    if(uSurfaceCrossingDebugView==5) underwaterColor=vec3(clamp(cameraWaterDistance/96.0,0.0,1.0));
    if(uSurfaceCrossingDebugView==6) underwaterColor=vec3(clamp(.5-viewDir.y*.5,0.0,1.0));
    if(uSurfaceCrossingDebugView==7) underwaterColor=underwaterRefraction;
    if(uSurfaceCrossingDebugView==8) underwaterColor=totalInternalReflection?underwaterReflection:vec3(0.0);
    if(uSurfaceCrossingDebugView==9) underwaterColor=vec3(interfaceFresnel);
    if(uSurfaceCrossingDebugView==10) underwaterColor=interfaceRadiance;
    bool rawUnderwaterDebug=uUnderwaterDebugView>0||uSurfaceCrossingDebugView>0;
    vec3 underwaterOutput=rawUnderwaterDebug?underwaterColor:applyRenderingPipeline(underwaterColor,.72,MATERIAL_UNDERWATER);
    gl_FragColor=vec4(underwaterOutput,1.0);
    #include <colorspace_fragment>
    return;
  }

  // English: Refraction deliberately uses a smoother normal than reflection so high-frequency optical detail cannot make the seabed jitter.
  // 日本語: 海底の高周波な揺れを防ぐため、屈折には反射より滑らかな法線を使用する。
  vec3 refractionNormal=normalize(mix(n,opticalNormal,uRefractionNormalDetail));
  if(dot(refractionNormal,viewDir)<0.0) refractionNormal=-refractionNormal;
  vec3 incidentDir=-viewDir;
  vec3 straightWaterDir=normalize(vec3(incidentDir.x,min(incidentDir.y,-.025),incidentDir.z));
  vec3 physicalRefractedDir=refract(incidentDir,refractionNormal,1.0/1.333);
  if(length(physicalRefractedDir)<.001||physicalRefractedDir.y>=-.005) physicalRefractedDir=straightWaterDir;
  vec3 refractedDir=normalize(mix(straightWaterDir,physicalRefractedDir,uRefractionStrength));
  refractedDir=normalize(vec3(refractedDir.x,min(refractedDir.y,-.005),refractedDir.z));
  vec3 seabedHitPosition;
  float waterPathLength;
  bool seabedHit=traceSeabed(vWorldPosition,refractedDir,seabedHitPosition,waterPathLength);
  vec3 waterTransmittance=evaluateWaterTransmittance(waterPathLength);
  vec3 waterMediumPosition=vWorldPosition+refractedDir*(waterPathLength*.5);
  vec3 waterScattering=evaluateWaterInScattering(waterPathLength,waterMediumPosition,refractedDir,vWorldPosition.y,uRain,uStorm);
  float cloudOcclusion=smoothstep(.35,.9,max(uClouds,uStorm*.85));
  float diffuseSunTransmission=mix(1.0,.28,cloudOcclusion);
  float underwaterMoonVisibility;
  vec3 underwaterMoonDirection=refractMoonIntoWater(uMoonDirection,underwaterMoonVisibility);
  vec3 underwaterMoonLight=evaluateMoonLightRadiance(uMoonDirection)*underwaterMoonVisibility*uMoonIntensity;
  vec3 seabedNormal=seabedHit?evaluateSeabedNormal(seabedHitPosition.xz):vec3(0.0,1.0,0.0);
  vec3 seabedAmbient=seabedHit?evaluateUnderwaterDownwellingLight(seabedHitPosition,vWorldPosition.y,uRain,uStorm):vec3(0.0);
  vec3 seabedSunTravelDirection;
  float seabedSunVisibility;
  vec3 seabedSunRadiance=seabedHit?evaluateUnderwaterSunRadiance(seabedHitPosition,vWorldPosition.y,uRain,uStorm,seabedSunTravelDirection,seabedSunVisibility):vec3(0.0);
  vec3 transmittedSource=seabedHit
    ?evaluateSeabedRadiance(seabedHitPosition,seabedNormal,seabedAmbient,seabedSunTravelDirection,seabedSunRadiance,underwaterMoonDirection,underwaterMoonLight)
    :vec3(.004,.018,.025);
  vec3 transmissionColor=transmittedSource*waterTransmittance+waterScattering;

  float sunElevation=uSunDirection.y;
  float directWaterSun=evaluateDirectSunIntensity(sunElevation)*evaluateSunDiscVisibility(sunElevation)*diffuseSunTransmission;
  float twilightWater=evaluateTwilightFactor(sunElevation);
  float waterDayFactor=smoothstep(.06,.24,sunElevation);
  float duskToNight=smoothstep(-.22,-.035,sunElevation);
  vec3 waterNight=vec3(.008,.024,.036);
  vec3 waterDusk=vec3(.016,.057,.071);
  vec3 waterDay=vec3(.018,.082,.098);
  vec3 waterBase=mix(waterNight,waterDusk,duskToNight);
  waterBase=mix(waterBase,waterDay,waterDayFactor);
  float skyAmbient=evaluateSkyAmbient(sunElevation,uStorm);
  float ambientWaterLighting=.32+skyAmbient*.78;
  float directWaterLighting=directWaterSun*.55;
  float ambientNormalResponse=mix(.8,1.12,smoothstep(.74,.995,clamp(n.y,0.0,1.0)));
  // English: Twilight water remains readable through low-level sky illumination; wave geometry is unchanged and direct sunlight fades independently.
  // 日本語: 薄明時の水面は弱い天空照明で視認性を保ち、波形を変更せず直射日光だけを独立して減衰させる。
  vec3 waterBody=waterBase*(ambientWaterLighting*ambientNormalResponse+directWaterLighting);
  waterBody+=waterDusk*twilightWater*.11;
  waterBody+=vec3(.015,.055,.04)*uStorm;
  vec3 environmentReflection=evaluateEnvironmentReflection(reflectionDir,reflectionRoughness,distanceLodBias,waterBody);
  float noV=clamp(dot(n,viewDir),0.0,1.0);
  float continuousFresnel=.025+.975*pow(1.0-noV,5.0);
  vec3 physical=mix(transmissionColor,environmentReflection,continuousFresnel);
  float sunVisibility=evaluateSunDiscVisibility(uSunDirection.y);
  float moonVisibility=evaluateMoonVisibility(uMoonDirection,uSunDirection);
  vec3 sunDirectLight=evaluateSolarRadiance(uSunDirection)*sunVisibility*(1.35-uStorm*.55)*mix(1.0,.08,cloudOcclusion);
  vec3 moonDirectLight=evaluateMoonLightRadiance(uMoonDirection)*moonVisibility*uMoonIntensity*1.35*mix(1.0,.12,cloudOcclusion);
  float sunSpec,moonSpec;
  vec3 sunSpecular=evaluateDirectionalWaterSpecular(p,uSunDirection,sunDirectLight,1.0,opticalNormal,viewDir,highWeight,opticalDetail,sunSpec);
  vec3 moonSpecular=evaluateDirectionalWaterSpecular(p,uMoonDirection,moonDirectLight,3.2,opticalNormal,viewDir,highWeight,opticalDetail,moonSpec);
  physical+=sunSpecular+moonSpecular;
  float foam=0.0;
  vec3 foamColor=vec3(0.0);
  float foamShadingWeight=0.0;
  if(uFoamStrength>.0001) {
    // English: Foam is explicitly disabled for this integration pass; retaining the uniform branch avoids paying for mask noise while strength is zero.
    // 日本語: この統合パスでは泡を明示的に無効化し、強度ゼロ時はマスクノイズの計算コストも回避する。
    foam=evaluateFoamMask(p,horizontalDistance,midWeight);
    foamColor=mix(vec3(.46,.56,.54),vec3(.72,.76,.69),clamp(directWaterSun+skyAmbient*.35,0.0,1.0))*(1.0-uStorm*.14);
    foamShadingWeight=smoothstep(.01,.14,foam);
    physical=mix(physical,foamColor,foamShadingWeight*.72);
  }
  vec3 combinedBeforeAerial=physical;
  vec3 combinedWithAerial=evaluateAerialPerspective(combinedBeforeAerial);
  if(uWaveDebugMode==4) physical=vec3(foam);
  if(uWaveDebugMode==5) physical=mix(waterBody*.16,foamColor,foamShadingWeight);
  if(uWaveDebugMode==6) physical=environmentReflection;
  if(uWaveDebugMode==7) physical=waterBody;
  if(uWaveDebugMode==8) physical=abs(combinedWithAerial-combinedBeforeAerial)*4.0;
  if(uWaveDebugMode==9) physical=vec3(evaluateSemanticPaletteIndex(combinedWithAerial,MATERIAL_WATER));
  if(uWaveDebugMode==10) physical=sampleEnvironment(reflectionDir,reflectionRoughness,distanceLodBias);
  if(uWaveDebugMode==11) physical=moonSpecular;
  if(uWaterVolumeDebugMode==1) physical=vec3(clamp(waterPathLength/DEBUG_MAX_WATER_DEPTH,0.0,1.0));
  if(uWaterVolumeDebugMode==2) physical=waterTransmittance;
  if(uWaterVolumeDebugMode==3) physical=transmissionColor;
  if(uWaterVolumeDebugMode==4) physical=environmentReflection;
  if(uWaveDebugMode<4&&uWaterVolumeDebugMode==0) physical=combinedWithAerial;

  if(uEnvironmentReflectionOnly==1) {
    physical=sampleEnvironment(reflectionDir,reflectionRoughness,distanceLodBias);
  }
  if(uSurfaceCrossingDebugView==1) physical=uCameraUnderwater==1?vec3(.08,.48,.9):vec3(.95,.62,.1);
  if(uSurfaceCrossingDebugView==2) physical=vec3(clamp(.5-uCameraSurfaceDelta*.12,0.0,1.0));
  if(uSurfaceCrossingDebugView==3) physical=vec3(clamp(waterPathLength/96.0,0.0,1.0));
  if(uSurfaceCrossingDebugView==4) physical=vec3(1.0);
  if(uSurfaceCrossingDebugView==5) physical=vec3(clamp(distanceToCamera/96.0,0.0,1.0));
  if(uSurfaceCrossingDebugView==6) physical=vec3(clamp(.5-viewDir.y*.5,0.0,1.0));
  float ditherDistance=mix(.4,1.0,midWeight);
  int materialSemantic=MATERIAL_WATER;
  if(sunSpec>.08||dot(moonSpecular,vec3(.2126,.7152,.0722))>.105) materialSemantic=MATERIAL_HIGHLIGHT;
  if(uFoamStrength>.0001&&foam>.025) materialSemantic=MATERIAL_FOAM;
  bool rawWaveDebug=uWaveDebugMode>=4;
  bool rawWaterVolumeDebug=uWaterVolumeDebugMode>0;
  vec3 outputColor=uEnvironmentReflectionOnly==1||rawWaveDebug||rawWaterVolumeDebug||uSurfaceCrossingDebugView>0?physical:applyRenderingPipeline(physical,ditherDistance,materialSemantic);
  gl_FragColor=vec4(outputColor,1.0);
  #include <colorspace_fragment>
}
`;

export class OceanRenderer {
  readonly mesh: THREE.Mesh;
  readonly ripples = new RippleSimulation();
  private readonly material: THREE.ShaderMaterial;
  private readonly swellSpectrum=new SwellSpectrum();
  private readonly windWaveSpectrum=new WindWaveSpectrum();
  private spectrumKey='';
  private currentWaveEnergy=0;

  get activeSwellCount():number {
    const state=this.environment.state;
    const mode=Math.round(state.waveDebugMode);
    if(mode===2||mode===3)return 0;
    return THREE.MathUtils.clamp(Math.round(state.swellCount),1,this.swellSpectrum.waves.length);
  }

  get activeMainWaveCount():number {
    const state=this.environment.state;
    const mode=Math.round(state.waveDebugMode);
    if(mode===1||mode===3)return 0;
    return THREE.MathUtils.clamp(Math.round(state.mainWaveCount),4,this.windWaveSpectrum.waves.length);
  }

  get waveEnergy():number{return this.currentWaveEnergy;}
  get surfaceWaveData(){return {swellWaves:this.swellSpectrum.waves,swellShapes:this.swellSpectrum.shapes,mainWaves:this.windWaveSpectrum.waves};}

  constructor(private readonly environment: EnvironmentController,palette: PaletteManager,environmentTexture: THREE.CubeTexture,environmentMaxMip: number) {
    const s=environment.state;
    this.swellSpectrum.generate(s);
    this.windWaveSpectrum.generate(s);
    this.material = new THREE.ShaderMaterial({ side:THREE.DoubleSide,vertexShader, fragmentShader, uniforms: {
      uTime:{value:0},uWind:{value:0},uSwellStrength:{value:s.swellStrength},uSwellDirection:{value:s.swellDirection},uSwellDirectionOffset:{value:s.swellDirectionOffset},
      uWindDirection:{value:0},uDirectionSpread:{value:s.directionSpread},uMainWaveStrength:{value:s.mainWaveStrength},uSwellCount:{value:this.activeSwellCount},uMainWaveCount:{value:this.activeMainWaveCount},uWaveDebugMode:{value:s.waveDebugMode},
      uSwellWaves:{value:this.swellSpectrum.waves},uSwellShapes:{value:this.swellSpectrum.shapes},uMainWaves:{value:this.windWaveSpectrum.waves},uRain:{value:0},uStorm:{value:0},uClouds:{value:s.cloudCoverage},
      uRippleStrength:{value:1},uMidStrength:{value:.12},uHighStrength:{value:.04},uFoamStrength:{value:s.foamStrength},uWaveEnergy:{value:0},uDetailFalloff:{value:.018},uAerialDensity:{value:.012},
      uSunDirection:{value:new THREE.Vector3()},uMoonDirection:{value:new THREE.Vector3()},uMoonIntensity:{value:s.moonIntensity},uMoonDiscScale:{value:0},uCameraPosition:{value:new THREE.Vector3()},uRipples:{value:this.ripples.data},uPalette:{value:palette.colors},
      uEnvironmentMap:{value:environmentTexture},uEnvironmentMaxMip:{value:environmentMaxMip},uEnvironmentReflectionEnabled:{value:s.environmentReflectionEnabled?1:0},uEnvironmentReflectionOnly:{value:s.environmentReflectionOnly?1:0},
      uDitherStrength:{value:.1},uQuantLevels:{value:6},uPaletteStrength:{value:.78},uRenderingMode:{value:s.renderingMode},uTurbidity:{value:2.8},uRayleighStrength:{value:1},uMieStrength:{value:.75},uHorizonHaze:{value:.72},
      uWaterLevel:{value:s.waterLevel},uAverageWaterDepth:{value:s.averageWaterDepth},uWaterAbsorption:{value:new THREE.Vector3(s.absorptionR,s.absorptionG,s.absorptionB)},
      uWaterScatteringColor:{value:new THREE.Vector3(s.waterScatteringR,s.waterScatteringG,s.waterScatteringB)},uWaterScatteringStrength:{value:s.scatteringStrength},uSeabedScale:{value:s.seabedScale},uSeabedVariation:{value:s.seabedVariation},
      uRefractionStrength:{value:s.refractionStrength},uRefractionNormalDetail:{value:.18},uWaterVolumeDebugMode:{value:s.waterVolumeDebugMode},
      uCameraUnderwater:{value:0},uUnderwaterEnvironmentIntensity:{value:s.underwaterEnvironmentIntensity},uUnderwaterDebugView:{value:s.underwaterDebugView},
      uCameraSurfaceDelta:{value:s.cameraSurfaceDelta},uCameraMediumOverride:{value:0},uSurfaceCrossingDebugView:{value:s.surfaceCrossingDebugView},
      uSunShaftsEnabled:{value:s.sunShaftsEnabled?1:0},uSunShaftStrength:{value:s.sunShaftStrength},uSunShaftContrast:{value:s.sunShaftContrast},uSunShaftMaxDistance:{value:s.sunShaftMaxDistance},
    }});
    const geometry=new THREE.PlaneGeometry(1800,1800,360,360);geometry.rotateX(-Math.PI/2);
    this.mesh=new THREE.Mesh(geometry,this.material);this.mesh.frustumCulled=false;
  }

  evaluateWaterSurfaceHeight(worldX:number,worldZ:number,time:number):number {
    this.ensureSpectrum();
    const s=this.environment.state;
    const windCurve=smoothstep(.03,1,s.windSpeed);
    let baseX=worldX,baseZ=worldZ;
    const swellCount=this.activeSwellCount;
    for(let iteration=0;iteration<2;iteration++){
      let displacementX=0,displacementZ=0;
      for(let i=0;i<swellCount;i++){
        const wave=this.swellSpectrum.waves[i],shape=this.swellSpectrum.shapes[i];
        const k=Math.PI*2/wave.x,angle=s.swellDirection+s.swellDirectionOffset+wave.z;
        const dirX=Math.cos(angle),dirZ=Math.sin(angle);
        const amplitude=wave.y*s.swellStrength*s.waveStrength*THREE.MathUtils.lerp(.92,1.08,smoothstep(.15,1,s.windSpeed));
        const q=shape.x/Math.max(k*amplitude*swellCount,.001);
        const phase=k*(dirX*baseX+dirZ*baseZ)-Math.sqrt(9.81*k)*time+wave.w;
        displacementX+=q*dirX*amplitude*Math.cos(phase);displacementZ+=q*dirZ*amplitude*Math.cos(phase);
      }
      baseX=worldX-displacementX;baseZ=worldZ-displacementZ;
    }
    let displacementHeight=0;
    for(let i=0;i<swellCount;i++){
      const wave=this.swellSpectrum.waves[i];
      const k=Math.PI*2/wave.x;
      const omega=Math.sqrt(9.81*k);
      const angle=s.swellDirection+s.swellDirectionOffset+wave.z;
      const phase=k*(Math.cos(angle)*baseX+Math.sin(angle)*baseZ)-omega*time+wave.w;
      const amplitude=wave.y*s.swellStrength*s.waveStrength*THREE.MathUtils.lerp(.92,1.08,smoothstep(.15,1,s.windSpeed));
      displacementHeight+=amplitude*Math.sin(phase);
    }
    const mainCount=this.activeMainWaveCount;
    const spreadResponse=THREE.MathUtils.lerp(.9,1.18,windCurve);
    for(let i=0;i<mainCount;i++){
      const wave=this.windWaveSpectrum.waves[i];
      const k=Math.PI*2/wave.x;
      const omega=Math.sqrt(9.81*k);
      const angle=s.windDirection+wave.z*s.directionSpread*spreadResponse;
      const directionalAmplitude=Math.pow(Math.max(Math.cos(wave.z*s.directionSpread),0),1.35);
      const amplitude=wave.y*s.mainWaveStrength*s.waveStrength*directionalAmplitude*THREE.MathUtils.lerp(.16,1.55,Math.pow(windCurve,.72));
      const phase=k*(Math.cos(angle)*baseX+Math.sin(angle)*baseZ)-omega*time+wave.w;
      const horizontalDistance=Math.hypot(baseX-worldX,baseZ-worldZ);
      const mainDistanceWeight=THREE.MathUtils.lerp(.72,1,1/(1+(horizontalDistance/250)**2));
      displacementHeight+=amplitude*mainDistanceWeight*Math.sin(phase);
    }
    // English: Camera medium detection samples the same macro wave components and phase equations as the vertex shader, not the mean water level or fragment-only detail.
    // 日本語: カメラの媒質判定は平均水位やフラグメント専用ディテールではなく、頂点シェーダーと同じマクロ波成分と位相式を参照する。
    const horizontalDistance=Math.hypot(baseX-worldX,baseZ-worldZ);
    const farGeometryWeight=THREE.MathUtils.lerp(.42,1,1/(1+(horizontalDistance/520)**2));
    return s.waterLevel+displacementHeight*farGeometryWeight;
  }

  private ensureSpectrum():void {
    const s=this.environment.state;
    const nextKey=[s.swellCount,s.mainWaveCount,s.peakWavelength,s.waveSeed].join('|');
    if(nextKey!==this.spectrumKey){this.swellSpectrum.generate(s);this.windWaveSpectrum.generate(s);this.spectrumKey=nextKey;}
  }

  update(elapsed:number,dt:number,camera:THREE.Camera,cameraUnderwater:boolean):void {
    const s=this.environment.state;
    this.ensureSpectrum();
    this.ripples.update(dt);
    const u=this.material.uniforms;
    u.uTime.value=elapsed;u.uWind.value=s.windSpeed;u.uSwellStrength.value=s.swellStrength*s.waveStrength;u.uSwellDirection.value=s.swellDirection;u.uSwellDirectionOffset.value=s.swellDirectionOffset;
    u.uWindDirection.value=s.windDirection;u.uDirectionSpread.value=s.directionSpread;u.uMainWaveStrength.value=s.mainWaveStrength*s.waveStrength;u.uSwellCount.value=this.activeSwellCount;u.uMainWaveCount.value=this.activeMainWaveCount;u.uWaveDebugMode.value=Math.round(s.waveDebugMode);
    u.uRain.value=s.precipitation;u.uStorm.value=s.stormIntensity;u.uClouds.value=s.cloudCoverage;u.uRippleStrength.value=s.rippleStrength;u.uMidStrength.value=s.midNormalStrength;u.uHighStrength.value=s.highNormalStrength;u.uFoamStrength.value=s.foamStrength;
    u.uDetailFalloff.value=s.detailFalloff;u.uAerialDensity.value=s.aerialDensity;u.uDitherStrength.value=s.ditheringStrength;u.uQuantLevels.value=s.quantizationLevels;u.uPaletteStrength.value=s.paletteStrength;u.uRenderingMode.value=s.renderingMode;
    u.uEnvironmentReflectionEnabled.value=s.environmentReflectionEnabled?1:0;u.uEnvironmentReflectionOnly.value=s.environmentReflectionOnly?1:0;
    u.uTurbidity.value=s.turbidity;u.uRayleighStrength.value=s.rayleighStrength;u.uMieStrength.value=s.mieStrength;u.uHorizonHaze.value=s.horizonHaze;
    u.uWaterLevel.value=s.waterLevel;u.uAverageWaterDepth.value=s.averageWaterDepth;u.uWaterAbsorption.value.set(s.absorptionR,s.absorptionG,s.absorptionB);u.uWaterScatteringStrength.value=s.scatteringStrength;
    u.uWaterScatteringColor.value.set(s.waterScatteringR,s.waterScatteringG,s.waterScatteringB);
    u.uSeabedScale.value=s.seabedScale;u.uSeabedVariation.value=s.seabedVariation;u.uRefractionStrength.value=s.refractionStrength;u.uWaterVolumeDebugMode.value=Math.round(s.waterVolumeDebugMode);
    u.uCameraUnderwater.value=cameraUnderwater?1:0;u.uUnderwaterEnvironmentIntensity.value=s.underwaterEnvironmentIntensity;u.uUnderwaterDebugView.value=Math.round(s.underwaterDebugView);
    u.uCameraSurfaceDelta.value=s.cameraSurfaceDelta;u.uCameraMediumOverride.value=s.cameraMediumOverride==='air'?1:s.cameraMediumOverride==='water'?2:0;
    u.uSurfaceCrossingDebugView.value=Math.round(s.surfaceCrossingDebugView);u.uSunShaftsEnabled.value=s.sunShaftsEnabled?1:0;u.uSunShaftStrength.value=s.sunShaftStrength;u.uSunShaftContrast.value=s.sunShaftContrast;u.uSunShaftMaxDistance.value=s.sunShaftMaxDistance;
    this.environment.getSunDirection(u.uSunDirection.value);u.uMoonDirection.value.copy(this.environment.moonLighting.direction);u.uMoonIntensity.value=this.environment.moonLighting.intensity;u.uCameraPosition.value.copy(camera.position);
    this.mesh.position.x=Math.round(camera.position.x/20)*20;this.mesh.position.y=s.waterLevel;this.mesh.position.z=Math.round(camera.position.z/20)*20;
    const windEnergy=smoothstep(.05,1,s.windSpeed);
    this.currentWaveEnergy=THREE.MathUtils.clamp(s.swellStrength*.22+s.mainWaveStrength*windEnergy*.58+(s.midNormalStrength*1.8+s.highNormalStrength*4)*windEnergy*.2,0,1.5);
    u.uWaveEnergy.value=this.currentWaveEnergy;
  }

  dispose():void {this.mesh.geometry.dispose();this.material.dispose();}
}

function smoothstep(edge0:number,edge1:number,value:number):number {
  const x=THREE.MathUtils.clamp((value-edge0)/(edge1-edge0),0,1);
  return x*x*(3-2*x);
}
