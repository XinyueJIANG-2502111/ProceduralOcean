export const waterVolumeGLSL = /* glsl */`
uniform float uWaterLevel;
uniform float uAverageWaterDepth;
uniform vec3 uWaterAbsorption;
uniform vec3 uWaterScatteringColor;
uniform float uWaterScatteringStrength;
uniform float uSeabedScale;
uniform float uSeabedVariation;
uniform float uRefractionStrength;
uniform float uRefractionNormalDetail;
uniform int uWaterVolumeDebugMode;

const float MAX_WATER_TRACE_DISTANCE=42.0;
const float DEBUG_MAX_WATER_DEPTH=28.0;

float seabedFbm(vec2 p) {
  float value=0.0;
  float amplitude=.5;
  for(int octave=0;octave<3;octave++) {
    value+=amplitude*noise2(p);
    p=p*2.03+17.7;
    amplitude*=.5;
  }
  return value/.875;
}

float evaluateSeabedHeight(vec2 worldXZ) {
  float large=(seabedFbm(worldXZ*uSeabedScale)-.5)*uSeabedVariation;
  float small=(seabedFbm(worldXZ*uSeabedScale*3.7+vec2(19.3,-7.1))-.5)*uSeabedVariation*.18;
  // English: A low-frequency world-space height field supplies stable depth variation without turning the seabed into a terrain showcase.
  // 日本語: 低周波のワールド空間高さ場で安定した水深差を作り、海底を地形デモのように目立たせない。
  float calculatedHeight=uWaterLevel-uAverageWaterDepth+large+small;
  // English: Keep the procedural seabed below the surface so shallow peaks cannot invert the optical water path.
  // 日本語: 浅い海底ピークで水中の光路が反転しないよう、プロシージャル海底を必ず水面より下に保つ。
  return min(calculatedHeight,uWaterLevel-.75);
}

vec3 evaluateSeabedColor(vec3 worldPosition) {
  float broad=seabedFbm(worldPosition.xz*.055+vec2(4.7,13.1));
  float grain=seabedFbm(worldPosition.xz*.16-vec2(8.2,3.6));
  vec3 sandA=vec3(.38,.31,.19);
  vec3 sandB=vec3(.105,.13,.115);
  float materialVariation=smoothstep(.28,.76,broad*.82+grain*.18);
  return mix(sandA,sandB,materialVariation);
}

vec3 evaluateSeabedNormal(vec2 worldXZ) {
  float epsilon=.32;
  float height=evaluateSeabedHeight(worldXZ);
  float heightX=evaluateSeabedHeight(worldXZ+vec2(epsilon,0.0));
  float heightZ=evaluateSeabedHeight(worldXZ+vec2(0.0,epsilon));
  return normalize(vec3(height-heightX,epsilon,height-heightZ));
}

bool traceSeabed(vec3 origin,vec3 direction,out vec3 hitPosition,out float travelDistance) {
  if(direction.y>=-.005) {
    travelDistance=MAX_WATER_TRACE_DISTANCE;
    hitPosition=origin+direction*travelDistance;
    return false;
  }
  float lowT=.06;
  float lowDelta=(origin+direction*lowT).y-evaluateSeabedHeight((origin+direction*lowT).xz);
  float stepLength=MAX_WATER_TRACE_DISTANCE/8.0;
  for(int i=0;i<8;i++) {
    float highT=float(i+1)*stepLength;
    vec3 samplePosition=origin+direction*highT;
    float highDelta=samplePosition.y-evaluateSeabedHeight(samplePosition.xz);
    if(highDelta<=0.0&&lowDelta>0.0) {
      // English: Trace the refracted ray with eight coarse steps and two refinements to estimate the actual optical path through water.
      // 日本語: 屈折光線を8回の粗いステップと2回の細分化で追跡し、水中の実際の光路長を近似する。
      for(int refinement=0;refinement<2;refinement++) {
        float middleT=(lowT+highT)*.5;
        vec3 middlePosition=origin+direction*middleT;
        float middleDelta=middlePosition.y-evaluateSeabedHeight(middlePosition.xz);
        if(middleDelta>0.0) lowT=middleT;
        else highT=middleT;
      }
      travelDistance=highT;
      hitPosition=origin+direction*highT;
      return true;
    }
    lowT=highT;
    lowDelta=highDelta;
  }
  travelDistance=MAX_WATER_TRACE_DISTANCE;
  hitPosition=origin+direction*travelDistance;
  return false;
}

vec3 evaluateWaterScatteringCoefficient() {
  float tintLuminance=max(dot(max(uWaterScatteringColor,vec3(0.0)),vec3(.2126,.7152,.0722)),1e-4);
  vec3 scatteringChroma=max(uWaterScatteringColor,vec3(0.0))/tintLuminance;
  return scatteringChroma*(.018*uWaterScatteringStrength);
}

vec3 evaluateWaterExtinctionCoefficient() {
  // English: Absorption removes energy while out-scattering is a separate loss term; their sum is the Beer-Lambert extinction coefficient.
  // 日本語: 吸収と外向き散乱を別々の損失項として扱い、その和を Beer-Lambert の消散係数とする。
  return max(uWaterAbsorption,vec3(0.0))+evaluateWaterScatteringCoefficient();
}

vec3 evaluateWaterTransmittance(float distanceInWater) {
  return exp(-evaluateWaterExtinctionCoefficient()*max(distanceInWater,0.0));
}

vec3 integrateWaterInScattering(vec3 sourceRadiance,vec3 transmittance) {
  vec3 extinction=max(evaluateWaterExtinctionCoefficient(),vec3(1e-4));
  vec3 singleScatteringAlbedo=evaluateWaterScatteringCoefficient()/extinction;
  return max(sourceRadiance,vec3(0.0))*(vec3(1.0)-transmittance)*singleScatteringAlbedo;
}

vec3 evaluateSeabedRadiance(vec3 worldPosition,vec3 seabedNormal,vec3 seabedAmbient,vec3 underwaterSunDirection,vec3 underwaterSunRadiance,vec3 underwaterMoonDirection,vec3 moonDirectLight) {
  vec3 seabedToSunDirection=-underwaterSunDirection;
  float noL=max(dot(seabedNormal,seabedToSunDirection),0.0);
  vec3 seabedAlbedo=evaluateSeabedColor(worldPosition);
  float ambientSlopeResponse=mix(.48,1.0,smoothstep(.08,.92,max(seabedNormal.y,0.0)));
  vec3 ambientContribution=seabedAlbedo*seabedAmbient*ambientSlopeResponse;
  vec3 directContribution=seabedAlbedo*underwaterSunRadiance*noL*.94;
  if(dot(moonDirectLight,moonDirectLight)>0.0) {
    float verticalDepth=max(uWaterLevel-worldPosition.y,0.0);
    float moonDepth=verticalDepth/max(abs(underwaterMoonDirection.y),.18);
    vec3 moonTransmittance=evaluateWaterTransmittance(moonDepth);
    float moonNoL=max(dot(seabedNormal,-underwaterMoonDirection),0.0);
    directContribution+=seabedAlbedo*moonDirectLight*moonTransmittance*moonNoL*.42;
  }
  // English: Separate seabed illumination from camera-to-seabed transmission to avoid double attenuation.
  // 日本語: 海底面への照明と海底面からカメラへの透過を分離し、減衰の二重適用を防ぐ。
  return ambientContribution+directContribution;
}
`;
