export const surfaceBoundaryGLSL = /* glsl */`
uniform float uSwellStrength;
uniform float uSwellDirection;
uniform float uSwellDirectionOffset;
uniform float uWindDirection;
uniform float uDirectionSpread;
uniform float uMainWaveStrength;
uniform int uSwellCount;
uniform int uMainWaveCount;
uniform vec4 uSwellWaves[6];
uniform vec2 uSwellShapes[6];
uniform vec4 uMainWaves[20];
uniform float uCameraSurfaceDelta;
uniform int uCameraMediumOverride;

vec2 evaluateSwellHorizontalDisplacement(vec2 baseXZ) {
  vec2 displacement=vec2(0.0);
  for(int i=0;i<6;i++) {
    if(i>=uSwellCount)break;
    vec4 wave=uSwellWaves[i];
    float k=6.2831853/wave.x;
    float angle=uSwellDirection+uSwellDirectionOffset+wave.z;
    vec2 direction=vec2(cos(angle),sin(angle));
    float amplitude=wave.y*uSwellStrength*mix(.92,1.08,smoothstep(.15,1.0,uWind));
    float q=uSwellShapes[i].x/max(k*amplitude*float(max(uSwellCount,1)),.001);
    float phase=k*dot(direction,baseXZ)-sqrt(9.81*k)*uTime+wave.w;
    displacement+=q*direction*amplitude*cos(phase);
  }
  return displacement;
}

vec2 recoverMacroBaseXZ(vec2 displacedXZ) {
  vec2 baseXZ=displacedXZ;
  // English: Two inverse-Gerstner iterations align the analytical waterline with the horizontally displaced ocean mesh near the camera.
  // 日本語: 2 回の逆 Gerstner 反復で、解析的な水線をカメラ付近の水平変位した海面メッシュへ合わせる。
  for(int i=0;i<2;i++)baseXZ=displacedXZ-evaluateSwellHorizontalDisplacement(baseXZ);
  return baseXZ;
}

float evaluateMacroSurfaceHeight(vec2 worldXZ) {
  // English: Match the CPU medium probe and vertex displacement phases so the background waterline follows the same world-space waves.
  // 日本語: 背景の水線が同じワールド空間の波に従うよう、CPU の媒質判定と頂点変位の位相に合わせる。
  vec2 baseXZ=recoverMacroBaseXZ(worldXZ);
  float displacementHeight=0.0;
  float windCurve=smoothstep(.03,1.0,uWind);
  for(int i=0;i<6;i++) {
    if(i>=uSwellCount)break;
    vec4 wave=uSwellWaves[i];
    float k=6.2831853/wave.x;
    float angle=uSwellDirection+uSwellDirectionOffset+wave.z;
    vec2 direction=vec2(cos(angle),sin(angle));
    float amplitude=wave.y*uSwellStrength*mix(.92,1.08,smoothstep(.15,1.0,uWind));
    displacementHeight+=amplitude*sin(k*dot(direction,baseXZ)-sqrt(9.81*k)*uTime+wave.w);
  }
  for(int i=0;i<20;i++) {
    if(i>=uMainWaveCount)break;
    vec4 wave=uMainWaves[i];
    float k=6.2831853/wave.x;
    float angle=uWindDirection+wave.z*uDirectionSpread*mix(.9,1.18,windCurve);
    vec2 direction=vec2(cos(angle),sin(angle));
    float directionalAmplitude=pow(max(cos(wave.z*uDirectionSpread),0.0),1.35);
    float amplitude=wave.y*uMainWaveStrength*directionalAmplitude*mix(.16,1.55,pow(windCurve,.72));
    float horizontalDistance=length(baseXZ-uCameraPosition.xz);
    float mainDistanceWeight=mix(.72,1.0,1.0/(1.0+pow(horizontalDistance/250.0,2.0)));
    displacementHeight+=amplitude*mainDistanceWeight*sin(k*dot(direction,baseXZ)-sqrt(9.81*k)*uTime+wave.w);
  }
  float horizontalDistance=length(baseXZ-uCameraPosition.xz);
  float farGeometryWeight=mix(.42,1.0,1.0/(1.0+pow(horizontalDistance/520.0,2.0)));
  return uWaterLevel+displacementHeight*farGeometryWeight;
}

vec3 evaluateMacroSurfaceNormal(vec2 worldXZ) {
  float stepSize=.18;
  float dx=evaluateMacroSurfaceHeight(worldXZ+vec2(stepSize,0.0))-evaluateMacroSurfaceHeight(worldXZ-vec2(stepSize,0.0));
  float dz=evaluateMacroSurfaceHeight(worldXZ+vec2(0.0,stepSize))-evaluateMacroSurfaceHeight(worldXZ-vec2(0.0,stepSize));
  return normalize(vec3(-dx,2.0*stepSize,-dz));
}

bool traceMacroSurface(vec3 origin,vec3 direction,out vec3 hitPosition,out float travelDistance) {
  // English: The first sign change gives the nearest air-water crossing; refinement is bounded and avoids a flat mean-level screen split.
  // 日本語: 最初の符号変化を最寄りの空気と水の境界とし、限定された細分化で平均水位による画面分割を避ける。
  float originDelta=origin.y-evaluateMacroSurfaceHeight(origin.xz);
  if(originDelta<-.002&&direction.y<-.08) {
    // English: A clearly downward ray from inside the water cannot reach the upper height field, so skip repeated macro-wave samples and continue to the seabed trace.
    // 日本語: 水中から明確に下向きの光線は上側の高さ場へ到達しないため、波面の反復評価を省略して海底追跡へ進む。
    travelDistance=0.0;
    hitPosition=origin;
    return false;
  }
  float previousT=.005;
  float previousDelta=(origin+direction*previousT).y-evaluateMacroSurfaceHeight((origin+direction*previousT).xz);
  float planeEstimate=abs(direction.y)>1e-4?-originDelta/direction.y:-1.0;
  float searchEnd=48.0;
  if(planeEstimate>0.0)searchEnd=min(max(planeEstimate+14.0,48.0),192.0);
  for(int i=0;i<12;i++) {
    float fraction=float(i+1)/12.0;
    float nextT=.005+searchEnd*fraction*fraction;
    vec3 nextPosition=origin+direction*nextT;
    float nextDelta=nextPosition.y-evaluateMacroSurfaceHeight(nextPosition.xz);
    if(previousDelta*nextDelta<=0.0) {
      float low=previousT,high=nextT;
      for(int j=0;j<4;j++) {
        float middle=(low+high)*.5;
        vec3 middlePosition=origin+direction*middle;
        float middleDelta=middlePosition.y-evaluateMacroSurfaceHeight(middlePosition.xz);
        if(middleDelta*previousDelta>0.0)low=middle;
        else high=middle;
      }
      travelDistance=(low+high)*.5;
      hitPosition=origin+direction*travelDistance;
      return true;
    }
    previousT=nextT;
    previousDelta=nextDelta;
  }
  travelDistance=min(searchEnd,MAX_WATER_TRACE_DISTANCE*4.57);
  hitPosition=origin+direction*travelDistance;
  return false;
}
`;
