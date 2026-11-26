export const skyStylizationGLSL = /* glsl */`
uniform float uSkyQuantizationStrength;
uniform float uSkyDitherStrength;
uniform float uSkyHorizonPreservation;
uniform float uSkyElevationBias;
uniform float uSkyLumaWeight;
uniform int uSkyDebugView;

const int SKY_RAMP_LEVEL_COUNT=9;
const int CLOUD_RAMP_LEVEL_COUNT=7;
const float CLOUD_LIGHT_LEVEL_BIAS=.72;

float skyLuminance(vec3 color) {
  return dot(color,vec3(.2126,.7152,.0722));
}

vec3 skyRampColor(int level) {
  // English: These fixed semantic slots remain ordered by perceived luminance in every dynamically blended palette; no colors are duplicated outside the shared 16-color palette.
  // 日本語: 固定した意味スロットは動的に補間される全パレットで知覚明度順を保ち、共有16色以外の色は複製しない。
  if(level<=0) return uPalette[1];
  if(level==1) return uPalette[2];
  if(level==2) return uPalette[3];
  if(level==3) return uPalette[4];
  if(level==4) return uPalette[5];
  if(level==5) return uPalette[6];
  if(level==6) return uPalette[7];
  if(level==7) return uPalette[8];
  return uPalette[9];
}

float skyRampLuma(int level) {
  return skyLuminance(skyRampColor(level));
}

float evaluateSkyHorizonFactor(vec3 viewDirection) {
  return 1.0-smoothstep(.01,.16,max(viewDirection.y,0.0));
}

float evaluateSkyCoordinate(vec3 physicalAtmosphere,vec3 viewDirection) {
  vec3 ray=normalize(viewDirection);
  vec3 mapped=toneMapLinear(physicalAtmosphere);
  float rampMinimum=skyRampLuma(0);
  float rampMaximum=skyRampLuma(SKY_RAMP_LEVEL_COUNT-1);
  float remappedLuma=mix(rampMinimum,rampMaximum,smoothstep(.035,.72,skyLuminance(mapped)));
  float elevation=clamp(ray.y,0.0,1.0);
  float horizonFactor=evaluateSkyHorizonFactor(ray);
  float elevationReference=mix(rampMaximum,rampMinimum,elevation);
  float weightSum=max(uSkyLumaWeight+uSkyElevationBias,.0001);
  float weightedLuma=(remappedLuma*uSkyLumaWeight+elevationReference*uSkyElevationBias)/weightSum;
  float rampRange=max(rampMaximum-rampMinimum,.0001);
  float horizonLift=horizonFactor*uSkyHorizonPreservation*rampRange*.055;
  return clamp(weightedLuma+horizonLift,rampMinimum,rampMaximum);
}

vec3 quantizeSkyRamp(vec3 physicalAtmosphere,vec3 viewDirection,bool enableDither) {
  float coordinate=evaluateSkyCoordinate(physicalAtmosphere,viewDirection);
  int lowLevel=0;
  for(int i=0;i<SKY_RAMP_LEVEL_COUNT-1;i++) {
    if(coordinate>=skyRampLuma(i+1)) lowLevel=i+1;
  }
  int highLevel=min(lowLevel+1,SKY_RAMP_LEVEL_COUNT-1);
  float lowLuma=skyRampLuma(lowLevel);
  float highLuma=skyRampLuma(highLevel);
  float adjacentBlend=clamp((coordinate-lowLuma)/max(highLuma-lowLuma,.0001),0.0,1.0);
  float threshold=.5;
  if(enableDither) {
    // English: A temporally stable low-amplitude hash restores enough adjacent-level dithering to break seams without exposing the regular Bayer grid.
    // 日本語: 時間変化しない低振幅ハッシュで隣接段階のディザリングを適度に戻し、規則的なBayer格子を見せずに境界を崩す。
    float skyDitherMix=clamp(uSkyDitherStrength*.5,0.0,.25);
    float stableSkyNoise=hash21(floor(gl_FragCoord.xy*.5));
    threshold=mix(.5,stableSkyNoise,skyDitherMix);
  }
  return adjacentBlend>threshold?skyRampColor(highLevel):skyRampColor(lowLevel);
}

vec3 stylizeAtmosphere(vec3 physicalAtmosphere,vec3 viewDirection,bool enableDither) {
  vec3 mapped=toneMapLinear(physicalAtmosphere);
  vec3 rampColor=quantizeSkyRamp(physicalAtmosphere,viewDirection,enableDither);
  float strength=clamp(uSkyQuantizationStrength,0.0,1.0);
  // English: Palette keeps the authored ramp explicit, while Final retains more continuous atmospheric light than opaque clouds to avoid a solid dome.
  // 日本語: Paletteでは設計したRampを明確に保ち、Finalでは不透明な雲より連続した大気光を多く残して、固いドーム感を避ける。
  if(uRenderingMode==2) strength=clamp(strength,0.0,1.0);
  if(uRenderingMode==3) strength*=uPaletteStrength*.50;
  return mix(mapped,rampColor,strength);
}

vec3 cloudRampColor(int level) {
  // English: Shift the existing cloud ramp into darker shared palette slots at night, following the physical cloud's ambient and moonlight range.
  // 日本語: 夜間は既存の雲ランプを共有パレットの暗いスロットへ移し、物理雲の環境光と月光の明度域に合わせる。
  int firstSlot=1+int(floor(smoothstep(-.18,.08,uSunDirection.y)*3.0+.5));
  return uPalette[clamp(firstSlot+level,0,15)];
}

vec3 stylizeVisibleCloud(vec3 baseColor,float lightResponse,float stylizationNoise) {
  float baseLuminance=skyLuminance(toneMapLinear(baseColor));
  // English: Keep dark storm-cloud variation inside the first adjacent slots instead of clamping the whole layer to one minimum color.
  // 日本語: 暗い嵐雲の変化を最初の隣接スロット内に残し、雲層全体が単一の最暗色へ固定されないようにする。
  float baseCoordinate=smoothstep(.035,.42,baseLuminance)*5.05+(stylizationNoise-.5)*1.10;
  // English: Directional sun or moon light advances cloud luminance within adjacent palette levels, while cloud-space noise prevents a light-tracking contour.
  // 日本語: 太陽や月の方向光は隣接パレット段階内で雲の明度を上げ、雲空間ノイズで光源を追う等値線を防ぐ。
  float cloudCoordinate=clamp(baseCoordinate+lightResponse*CLOUD_LIGHT_LEVEL_BIAS,0.0,float(CLOUD_RAMP_LEVEL_COUNT-1));
  int lowLevel=int(floor(cloudCoordinate));
  int highLevel=min(lowLevel+1,CLOUD_RAMP_LEVEL_COUNT-1);
  float adjacentBlend=fract(cloudCoordinate);
  float cloudThreshold=fract(clamp(stylizationNoise,0.0,1.0)*2.37+.17);
  return adjacentBlend>cloudThreshold?cloudRampColor(highLevel):cloudRampColor(lowLevel);
}

float stylizeCloudAlpha(float physicalAlpha,float lowFrequencyAlpha) {
  // English: Broad low-frequency opacity defines the visible cloud mass; a small physical-alpha contribution preserves natural edge variation without restoring every FBM notch.
  // 日本語: 低周波の不透明度で可視雲の大きな塊を作り、少量の物理アルファだけを戻して、FBMの細かな切れ込みを復活させず自然な縁を保つ。
  float broadShape=smoothstep(.07,.82,lowFrequencyAlpha);
  float physicalShape=smoothstep(.10,.88,physicalAlpha);
  return clamp(mix(broadShape,physicalShape,.30),0.0,1.0);
}
`;
