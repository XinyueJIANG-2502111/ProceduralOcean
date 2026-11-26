export const paletteGLSL = /* glsl */`
uniform vec3 uPalette[16];
uniform float uDitherStrength;
uniform float uQuantLevels;
uniform float uPaletteStrength;
uniform int uRenderingMode;

const int MATERIAL_SKY=0;
const int MATERIAL_WATER=1;
const int MATERIAL_CLOUD=2;
const int MATERIAL_HIGHLIGHT=3;
const int MATERIAL_FOAM=4;
const int MATERIAL_UNDERWATER=5;

float bayer4(vec2 p) {
  ivec2 q=ivec2(mod(floor(p),4.0));
  int index=q.x+q.y*4;
  float m[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  return m[index]/16.0-.5;
}

vec3 toneMapLinear(vec3 linearColor) {
  // English: Compress luminance after exposure, then restore chroma as a ratio so sky/water contrast is not flattened per channel.
  // 日本語: 露出後の輝度を圧縮し、色度を比率として戻すことで、空と水の差をチャンネル単位で潰さない。
  vec3 exposed=max(linearColor,vec3(0.0))*1.25;
  float luminance=max(dot(exposed,vec3(.2126,.7152,.0722)),.00001);
  float mappedLuminance=luminance/(1.0+luminance);
  vec3 chroma=exposed/luminance;
  vec3 mapped=mix(vec3(mappedLuminance),chroma*mappedLuminance,.9);
  float peak=max(max(mapped.r,mapped.g),mapped.b);
  return clamp(mapped/max(1.0,peak),0.0,1.0);
}

float semanticPaletteBias(int paletteIndex,int materialSemantic) {
  if(materialSemantic==MATERIAL_WATER) {
    // English: Let water use adjacent luminance steps from the same palette so distant low-frequency structure survives quantization.
    // 日本語: 同じパレット内の隣接輝度段階を水面に許可し、遠距離の低周波構造を量子化後も残す。
    if(paletteIndex>=2&&paletteIndex<=10) return 0.0;
    if(paletteIndex==1||paletteIndex==11) return .022;
    return .052;
  }
  if(materialSemantic==MATERIAL_UNDERWATER) {
    // English: Underwater volume gradients may use a wider adjacent ramp so the Snell window is not reduced to concentric palette bands.
    // 日本語: 水中の連続的な濃度勾配では隣接色域を広く使い、スネル窓が同心円状のパレット帯へ潰れないようにする。
    if(paletteIndex>=1&&paletteIndex<=11) return 0.0;
    return .035;
  }
  if(materialSemantic==MATERIAL_CLOUD) {
    // English: Clouds overlap the atmosphere's middle ramp so rain and storm layers do not become a separate bright cutout.
    // 日本語: 雨天や嵐の雲が別の明るい切り抜きにならないよう、中間色域を大気と共有する。
    return paletteIndex>=4&&paletteIndex<=10 ? 0.0 : .02;
  }
  if(materialSemantic==MATERIAL_HIGHLIGHT) {
    return paletteIndex>=8&&paletteIndex<=11 ? 0.0 : .12;
  }
  if(materialSemantic==MATERIAL_FOAM) {
    return paletteIndex>=7&&paletteIndex<=11 ? 0.0 : .09;
  }
  if(paletteIndex<=2||paletteIndex>=14) return .042;
  return paletteIndex>=6&&paletteIndex<=13 ? 0.0 : .012;
}

vec3 semanticPaletteTarget(vec3 mapped,int materialSemantic) {
  if(materialSemantic==MATERIAL_WATER) {
    float luminance=dot(mapped,vec3(.2126,.7152,.0722));
    float luminanceShape=mix(.91,1.1,smoothstep(.1,.58,luminance));
    float expandedLuminance=max(.012,.075+(luminance-.075)*mix(1.28,1.0,smoothstep(.08,.34,luminance)));
    vec3 lowLightExpanded=mapped*(expandedLuminance/max(luminance,.0001));
    return clamp(lowLightExpanded*vec3(.92,.97,1.0)*luminanceShape,0.0,1.0);
  }
  if(materialSemantic==MATERIAL_CLOUD) {
    float luminance=dot(mapped,vec3(.2126,.7152,.0722));
    return clamp(mix(mapped,vec3(luminance),.12)*1.04,0.0,1.0);
  }
  if(materialSemantic==MATERIAL_HIGHLIGHT) return clamp(mapped*1.12+vec3(.025),0.0,1.0);
  if(materialSemantic==MATERIAL_FOAM) {
    float luminance=dot(mapped,vec3(.2126,.7152,.0722));
    return clamp(mix(mapped,vec3(luminance),.38)*vec3(.98,1.02,1.0)*1.06,0.0,1.0);
  }
  return clamp(mapped*1.07+vec3(.012,.018,.025),0.0,1.0);
}

float evaluateSemanticPaletteIndex(vec3 linearColor,int materialSemantic) {
  vec3 paletteTarget=semanticPaletteTarget(toneMapLinear(linearColor),materialSemantic);
  vec3 weights=vec3(.30,.59,.11);
  float bestDistance=1e9;
  float bestIndex=0.0;
  for(int i=0;i<16;i++) {
    vec3 delta=paletteTarget-uPalette[i];
    float distanceToColor=dot(delta*delta,weights)+semanticPaletteBias(i,materialSemantic);
    if(distanceToColor<bestDistance) { bestDistance=distanceToColor; bestIndex=float(i); }
  }
  return bestIndex/15.0;
}

vec3 applyRenderingPipeline(vec3 linearColor,float ditherScale,int materialSemantic) {
  if(uRenderingMode==0) return max(linearColor,vec3(0.0));
  vec3 mapped=toneMapLinear(linearColor);
  if(uRenderingMode==1) return mapped;

  vec3 paletteTarget=semanticPaletteTarget(mapped,materialSemantic);
  vec3 weights=vec3(.30,.59,.11);
  float bestDistance=1e9,secondDistance=1e9;
  vec3 nearest=uPalette[0],secondNearest=uPalette[1];
  for(int i=0;i<16;i++) {
    vec3 delta=paletteTarget-uPalette[i];
    float distanceToColor=dot(delta*delta,weights)+semanticPaletteBias(i,materialSemantic);
    if(distanceToColor<bestDistance) {
      secondDistance=bestDistance; secondNearest=nearest;
      bestDistance=distanceToColor; nearest=uPalette[i];
    } else if(distanceToColor<secondDistance) {
      secondDistance=distanceToColor; secondNearest=uPalette[i];
    }
  }
  // English: Every semantic still uses the same 16 colors; matching bias preserves material identity across quantization.
  // 日本語: すべての意味領域が同じ16色を使い、マッチングのバイアスだけで量子化後の材質識別を保つ。
  // English: Preserve part of the continuous physical gradient only for the underwater volume; all colors still come from the same global palette target.
  // 日本語: 水中ボリュームだけは連続した物理勾配を一部残し、参照する色域自体は同じグローバルパレットのままとする。
  if(uRenderingMode==2) return materialSemantic==MATERIAL_UNDERWATER?mix(mapped,nearest,uPaletteStrength*.35):nearest;
  vec3 paletteColor=nearest;
  float ambiguity=bestDistance/max(bestDistance+secondDistance,.000001);
  float levelResponse=clamp(6.0/max(uQuantLevels,2.0),.55,1.6);
  float mappedLuminance=dot(mapped,vec3(.2126,.7152,.0722));
  float lowLight=1.0-smoothstep(.07,.26,mappedLuminance);
  float lowLightDitherScale=materialSemantic==MATERIAL_WATER?mix(1.0,.42,lowLight):1.0;
  float threshold=ambiguity*uDitherStrength*ditherScale*lowLightDitherScale*levelResponse*2.0;
  if(bayer4(gl_FragCoord.xy)+.5<threshold) paletteColor=secondNearest;
  // English: Keep underwater gradients predominantly continuous; the shared palette remains a restrained style bias instead of forming depth contours.
  // 日本語: 水中勾配の連続性を優先し、共有パレットは深度等高線を作らない控えめな風格付けとして使う。
  float semanticPaletteStrength=materialSemantic==MATERIAL_UNDERWATER?uPaletteStrength*.16:uPaletteStrength;
  return mix(mapped,paletteColor,semanticPaletteStrength);
}
`;

export const noiseGLSL = /* glsl */`
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float noise2(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1)),f.x),f.y);
}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise2(p);p=p*2.03+17.7;a*=0.5;}return v;}
`;

export const atmosphereGLSL = /* glsl */`
uniform float uTurbidity;
uniform float uRayleighStrength;
uniform float uMieStrength;
uniform float uHorizonHaze;
uniform vec3 uMoonDirection;
uniform float uMoonIntensity;
uniform float uMoonDiscScale;

float rayleighPhase(float mu){return .0596831*(1.0+mu*mu);}
float miePhase(float mu){
  float g=.82;
  return .119366*(1.0-g*g)*(1.0+mu*mu)/((2.0+g*g)*pow(max(.001,1.0+g*g-2.0*g*mu),1.5));
}
const float SUN_DISC_FADE_LOW=-.012;
const float SUN_DISC_FADE_HIGH=.004;

float evaluateSunDiscVisibility(float sunElevation){return smoothstep(SUN_DISC_FADE_LOW,SUN_DISC_FADE_HIGH,sunElevation);}
float evaluateDirectSunIntensity(float sunElevation){
  // English: Keep direct solar radiance strong until the geometric horizon is close; warmth begins before strong extinction.
  // 日本語: 幾何学的な地平線へ近づくまでは直達日射を十分に保ち、強い減衰より先に暖色化を開始する。
  float highSun=smoothstep(.025,.14,sunElevation);
  float horizonExtinction=smoothstep(-.012,.03,sunElevation);
  return mix(.78,1.0,highSun)*horizonExtinction;
}
vec3 evaluateSunColor(float sunElevation){
  float sunsetWarmth=1.0-smoothstep(.025,.20,sunElevation);
  return mix(vec3(1.18,1.04,.76),vec3(1.62,.38,.055),sunsetWarmth);
}
float evaluateSkyDayFactor(float sunElevation){return smoothstep(.025,.22,sunElevation);}
float evaluateRayleighDayWeight(float sunElevation){return smoothstep(-.015,.19,sunElevation);}
float evaluateTwilightFactor(float sunElevation){
  float aboveNight=smoothstep(-.22,-.035,sunElevation);
  float belowDay=1.0-smoothstep(.07,.24,sunElevation);
  return aboveNight*belowDay;
}
float evaluateSkyAmbient(float sunElevation,float storm){
  float ambient=mix(.065,.64,evaluateSkyDayFactor(sunElevation));
  ambient+=evaluateTwilightFactor(sunElevation)*.17;
  return ambient*mix(1.0,.74,storm);
}
float evaluateSunAngularProximity(vec3 viewDirection,vec3 sunDirection){
  return max(dot(normalize(viewDirection),normalize(sunDirection)),0.0);
}

vec3 evaluateSolarRadiance(vec3 sunDirection) {
  float sunElevation=sunDirection.y;
  // English: Solar radiance and geometric disc visibility are separate quantities; every lighting path applies horizon visibility exactly once.
  // 日本語: 太陽放射輝度と太陽円盤の幾何学的可視性を分離し、各ライティング経路で地平線可視性を一度だけ適用する。
  return evaluateSunColor(sunElevation)*evaluateDirectSunIntensity(sunElevation);
}

float evaluateMoonVisibility(vec3 moonDir,vec3 sunDir) {
  return smoothstep(-.01,.02,moonDir.y)*(1.0-smoothstep(-.10,.05,sunDir.y));
}

vec3 evaluateMoonLightRadiance(vec3 moonDir) {
  // English: Lunar irradiance stays independent of the bright disc so a visible moon does not turn the whole ocean into daylight.
  // 日本語: 月面の見かけの輝度と月光の照度を分け、月を見やすくしても海全体を昼のように明るくしない。
  return vec3(.16,.20,.28)*mix(.82,1.0,clamp(moonDir.y,0.0,1.0));
}

vec3 evaluateMoonDiscRadiance(vec3 moonDir) {
  return vec3(.82,1.02,1.32)*mix(.8,1.0,clamp(moonDir.y,0.0,1.0));
}

vec3 evaluateAtmosphere(vec3 direction,vec3 sunDirection,float storm) {
  vec3 ray=normalize(direction);
  float height=clamp(ray.y,-.08,1.0);
  float sunElevation=sunDirection.y;
  // English: Global sunset state comes only from world-space sun elevation; view direction controls local angular scattering around the sun.
  // 日本語: 日没の全体状態は世界座標の太陽高度だけから決め、視線方向は太陽周辺の局所的な角度散乱だけを制御する。
  float skyDayFactor=evaluateSkyDayFactor(sunElevation);
  float rayleighDayWeight=evaluateRayleighDayWeight(sunElevation);
  float mu=clamp(dot(ray,sunDirection),-1.0,1.0);
  float airMass=1.0/max(.075,height*.82+.095);
  float horizon=exp(-max(height,0.0)*mix(7.0,3.0,uHorizonHaze));
  vec3 rayleighBeta=vec3(.18,.42,1.0)*uRayleighStrength;
  vec3 mieBeta=vec3(1.0,.82,.62)*uMieStrength*(.004+uTurbidity*.001);
  vec3 extinction=exp(-(vec3(.018,.035,.075)*uRayleighStrength+vec3(.024)*uTurbidity)*airMass);
  vec3 rayleighScattered=rayleighBeta*rayleighPhase(mu)*(.65+.35*extinction);
  vec3 mieScattered=mieBeta*miePhase(mu)*(.55+horizon*1.8);
  float twilight=evaluateTwilightFactor(sunElevation);
  float nearSun=pow(evaluateSunAngularProximity(ray,sunDirection),80.0);
  float sunHorizontalLength=length(sunDirection.xz);
  float viewHorizontalLength=length(ray.xz);
  float sunSide=0.0;
  if(sunHorizontalLength>1e-4&&viewHorizontalLength>1e-4) sunSide=max(dot(ray.xz/viewHorizontalLength,sunDirection.xz/sunHorizontalLength),0.0);
  float broadWarmHorizon=horizon*twilight;
  float localSunWarmth=nearSun*horizon*twilight;
  vec3 broadDuskColor=mix(vec3(.13,.10,.24),vec3(.82,.24,.065),sunSide);
  vec3 afterglow=broadDuskColor*broadWarmHorizon*.105+vec3(1.42,.31,.045)*localSunWarmth*.19;
  vec3 zenithNight=vec3(.006,.012,.03);
  vec3 zenithDusk=vec3(.032,.052,.115);
  vec3 zenithDay=vec3(.055,.17,.48);
  float duskToNight=smoothstep(-.22,-.035,sunElevation);
  vec3 zenith=mix(zenithNight,zenithDusk,duskToNight);
  zenith=mix(zenith,zenithDay,skyDayFactor);
  float mieIllumination=mix(.07,1.0,skyDayFactor)+twilight*.22;
  vec3 atmosphere=zenith+rayleighScattered*rayleighDayWeight+mieScattered*mieIllumination+afterglow;
  atmosphere+=vec3(.25,.29,.34)*horizon*(skyDayFactor+twilight*.28)*uHorizonHaze*.31;
  return max(mix(atmosphere,vec3(.055,.075,.082)+atmosphere*.34,storm*.82),vec3(.002));
}
`;

export const cloudGLSL = /* glsl */`
uniform float uTime;
uniform float uClouds;
uniform float uWind;
uniform vec2 uWindVector;

struct CloudResult {
  vec3 color;
  vec3 baseColor;
  float alpha;
  float lowFrequencyAlpha;
  float lightResponse;
  float stylizationNoise;
};

CloudResult evaluateCloudComponents(vec3 direction,vec3 sunDirection,float storm,vec2 maskRange) {
  vec3 ray=normalize(direction);
  float upperMask=smoothstep(maskRange.x,maskRange.y,ray.y);
  // English: Upper-hemisphere octahedral mapping stays bounded at the horizon, preventing reflected clouds from stretching into long strips.
  // 日本語: 上半球のオクタヘドラル写像で地平線付近の座標を有限に保ち、反射した雲が長い帯へ引き伸ばされるのを防ぐ。
  float directionNorm=abs(ray.x)+abs(ray.y)+abs(ray.z)+.0001;
  vec2 projected=ray.xz/directionNorm*3.2;
  vec2 drift=uWindVector*uTime*(.009+.028*uWind);
  vec2 warp=vec2(fbm(projected*.31+drift*.37),fbm(projected*.31-drift*.29))-.5;
  float lowFrequencyField=fbm(projected*.76+warp*1.18+drift);
  float detailField=fbm(projected*1.83-warp*.54-drift*.31)*.32;
  float field=lowFrequencyField+detailField;
  float threshold=mix(1.15,.48,clamp(uClouds,0.0,1.0));
  float density=smoothstep(threshold-.09,threshold+.1,field)*upperMask;
  float lowFrequencyDensity=smoothstep(threshold-.20,threshold+.08,lowFrequencyField)*upperMask;
  float sunFacing=max(dot(normalize(vec3(ray.x,.38,ray.z)),sunDirection),0.0);
  float skyDayFactor=evaluateSkyDayFactor(sunDirection.y);
  float skyAmbient=evaluateSkyAmbient(sunDirection.y,storm);
  vec3 nightCloudAmbient=vec3(.025,.034,.052);
  vec3 duskCloudAmbient=vec3(.12,.12,.16);
  vec3 dayCloudAmbient=vec3(.43,.47,.47);
  vec3 cloudAmbient=mix(nightCloudAmbient,duskCloudAmbient,smoothstep(-.22,-.035,sunDirection.y));
  cloudAmbient=mix(cloudAmbient,dayCloudAmbient,skyDayFactor)*mix(.72,1.08,skyAmbient);
  float sunVisibility=evaluateSunDiscVisibility(sunDirection.y);
  vec3 cloudDirect=evaluateSolarRadiance(sunDirection)*sunVisibility*sunFacing*.22*mix(1.0,.25,storm);
  float moonVisibility=evaluateMoonVisibility(uMoonDirection,sunDirection);
  vec3 moonDirectLight=evaluateMoonLightRadiance(uMoonDirection)*moonVisibility*uMoonIntensity;
  float moonFacing=max(dot(normalize(vec3(ray.x,.38,ray.z)),uMoonDirection),0.0);
  vec3 cloudMoonDirect=moonDirectLight*moonFacing*.52*mix(1.0,.2,storm);
  // English: Night clouds combine sky ambient and visible lunar illumination while hidden sunlight contributes nothing.
  // 日本語: 夜の雲は天空環境光と可視の月光を合成し、地平線下の太陽光は加えない。
  vec3 color=cloudAmbient+cloudDirect+cloudMoonDirect;
  color=mix(color,vec3(.06,.078,.088)*mix(.55,1.0,skyAmbient),storm*.65);
  vec3 clearCloudBase=vec3(.42,.47,.48);
  vec3 stormCloudBase=vec3(.075,.095,.10);
  float internalShade=mix(.84,1.04,clamp(lowFrequencyField,0.0,1.0));
  vec3 dayBase=mix(clearCloudBase,stormCloudBase,storm*.65);
  vec3 nightBase=cloudAmbient+cloudMoonDirect*.62;
  vec3 baseColor=mix(nightBase,dayBase,smoothstep(-.18,.08,sunDirection.y))*internalShade;
  float sunAlignment=max(dot(normalize(vec3(ray.x,.38,ray.z)),normalize(sunDirection)),0.0);
  float sunResponse=pow(sunAlignment,3.0)*sunVisibility*evaluateDirectSunIntensity(sunDirection.y)*mix(1.0,.25,storm);
  float moonResponse=pow(moonFacing,3.0)*moonVisibility*uMoonIntensity*.55*mix(1.0,.2,storm);
  float detailFieldNormalized=clamp(detailField/.32,0.0,1.0);
  float stylizationNoise=clamp(lowFrequencyField*.65+detailFieldNormalized*.35,0.0,1.0);
  float opacity=mix(.68,.94,storm);
  CloudResult result;
  result.color=color;
  result.baseColor=baseColor;
  result.alpha=density*opacity;
  result.lowFrequencyAlpha=lowFrequencyDensity*opacity;
  result.lightResponse=sunResponse+moonResponse;
  result.stylizationNoise=stylizationNoise;
  return result;
}

vec4 evaluateCloudLayer(vec3 direction,vec3 sunDirection,float storm) {
  // English: Visible and cubemap clouds share one horizon mask so reflected cloud coverage matches the sky at grazing angles.
  // 日本語: 可視空とキューブマップの雲で同じ地平線マスクを使い、掠れ角の反射雲分布を一致させる。
  CloudResult result=evaluateCloudComponents(direction,sunDirection,storm,vec2(-.06,.025));
  return vec4(result.color,result.alpha);
}

CloudResult evaluateVisibleCloudLayer(vec3 direction,vec3 sunDirection,float storm) {
  // English: Visible clouds finish their hemisphere transition at the true horizon so the mask cannot draw a latitude arc across the sky.
  // 日本語: 可視雲の半球遷移を実際の地平線付近で完了させ、マスクが空に緯度状の弧を描かないようにする。
  return evaluateCloudComponents(direction,sunDirection,storm,vec2(-.06,.025));
}
`;

export const skyEnvironmentGLSL = /* glsl */`
vec3 evaluatePhysicalSky(vec3 direction,vec3 sunDirection,float storm,out float cloudAlpha,out float solarHighlight) {
  vec3 ray=normalize(direction);
  vec3 physicalSky=evaluateAtmosphere(ray,sunDirection,storm);
  vec4 cloud=evaluateCloudLayer(ray,sunDirection,storm);
  physicalSky=mix(physicalSky,cloud.rgb,cloud.a);
  float angularDistance=acos(clamp(dot(ray,sunDirection),-1.0,1.0));
  float disc=1.0-smoothstep(.015,.023,angularDistance);
  float halo=pow(evaluateSunAngularProximity(ray,sunDirection),180.0)*(.32+uMieStrength*.45);
  float sunVisibility=evaluateSunDiscVisibility(sunDirection.y);
  physicalSky+=evaluateSolarRadiance(sunDirection)*sunVisibility*(disc*3.2+halo)*(1.0-cloud.a*.82);
  float moonCos=clamp(dot(ray,uMoonDirection),-1.0,1.0);
  // English: Disc thresholds are cosines of angular radii; capture scales only the high-frequency disc, leaving analytic ocean glints in control.
  // 日本語: 円盤の閾値には角半径の余弦を使い、環境取得では高周波の月盤だけを弱めて海面の解析的な反射を主役にする。
  float moonDisc=smoothstep(.99974,.99992,moonCos);
  float moonHalo=pow(max(moonCos,0.0),1400.0)*.075;
  float moonVisibility=evaluateMoonVisibility(uMoonDirection,sunDirection);
  physicalSky+=evaluateMoonDiscRadiance(uMoonDirection)*moonVisibility*uMoonIntensity*(moonDisc+moonHalo)*uMoonDiscScale*(1.0-cloud.a*.9);
  cloudAlpha=cloud.a;
  solarHighlight=max(disc,halo)*sunVisibility;
  return physicalSky;
}
`;
