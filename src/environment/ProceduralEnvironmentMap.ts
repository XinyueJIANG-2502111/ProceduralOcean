import * as THREE from 'three';
import type { EnvironmentController } from './Environment';
import { atmosphereGLSL, cloudGLSL, noiseGLSL, skyEnvironmentGLSL } from '../shaders/common';

const vertexShader = /* glsl */`
varying vec3 vDirection;
void main() {
  vDirection=normalize(position);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}
`;

const fragmentShader = /* glsl */`
precision highp float;
uniform float uStorm;
uniform vec3 uSunDirection;
varying vec3 vDirection;
${noiseGLSL}
${atmosphereGLSL}
${cloudGLSL}
${skyEnvironmentGLSL}

void main() {
  vec3 direction=normalize(vDirection);
  vec3 upperEnvironment=evaluatePhysicalSky(direction,uSunDirection,uStorm,step(0.0,direction.y));

  float horizontalLength=length(direction.xz);
  vec3 horizonDirection=vec3(0.0,.035,1.0);
  if(horizontalLength>.0001) {
    horizonDirection=normalize(vec3(direction.x/horizontalLength,.035,direction.z/horizontalLength));
  }
  vec3 horizonEnvironment=evaluatePhysicalSky(horizonDirection,uSunDirection,uStorm,0.0);
  vec3 lowerBase=mix(vec3(.012,.045,.055),vec3(.026,.055,.062),uStorm);
  vec3 lowerEnvironment=mix(horizonEnvironment,lowerBase,smoothstep(0.0,.82,-direction.y));
  // English: Fill the lower hemisphere continuously with horizon and water-compatible color instead of folding directions upward.
  // 日本語: 方向を上半球へ折り返さず、地平線色と水になじむ色で下半球を連続的に埋める。
  vec3 environmentColor=mix(lowerEnvironment,upperEnvironment,smoothstep(-.035,.045,direction.y));
  gl_FragColor=vec4(environmentColor,1.0);
}
`;

export class ProceduralEnvironmentMap {
  readonly texture: THREE.CubeTexture;
  readonly maxMipLevel = 6;
  private readonly scene = new THREE.Scene();
  private readonly target: THREE.WebGLCubeRenderTarget;
  private readonly camera: THREE.CubeCamera;
  private readonly material: THREE.ShaderMaterial;
  private readonly captureShell:THREE.Mesh;
  private readonly sunDirection = new THREE.Vector3();
  private readonly moonDirection = new THREE.Vector3();
  private frameIndex = 0;
  private initialized = false;
  private lastTimeOfDay = Number.NaN;
  private lastCloudCoverage = Number.NaN;
  private lastStorm = Number.NaN;
  private lastWind = Number.NaN;
  private lastWindDirection = Number.NaN;
  private lastTurbidity = Number.NaN;
  private lastRayleigh = Number.NaN;
  private lastMie = Number.NaN;
  private lastHaze = Number.NaN;
  private lastMoonIntensity = Number.NaN;

  constructor(private readonly environment: EnvironmentController) {
    const s=environment.state;
    // English: Keep the established RGBA8 environment capture for now; test HalfFloatType only if highlight clipping, mip banding, or Snell-window dynamic range becomes a measured limitation.
    // 日本語: 現行のRGBA8環境キャプチャを維持し、ハイライトのクリップ、Mipバンディング、スネル窓のダイナミックレンジ不足が実測された場合のみHalfFloatTypeを検証する。
    this.target=new THREE.WebGLCubeRenderTarget(64,{
      format:THREE.RGBAFormat,
      type:THREE.UnsignedByteType,
      generateMipmaps:true,
      minFilter:THREE.LinearMipmapLinearFilter,
      magFilter:THREE.LinearFilter,
      depthBuffer:false,
    });
    this.texture=this.target.texture;
    this.texture.mapping=THREE.CubeReflectionMapping;
    this.texture.colorSpace=THREE.LinearSRGBColorSpace;
    this.material=new THREE.ShaderMaterial({
      side:THREE.BackSide,
      depthWrite:false,
      depthTest:false,
      vertexShader,
      fragmentShader,
      uniforms:{
        uTime:{value:0},uClouds:{value:s.cloudCoverage},uStorm:{value:s.stormIntensity},uWind:{value:s.windSpeed},
        uWindVector:{value:new THREE.Vector2()},uSunDirection:{value:this.sunDirection},uMoonDirection:{value:this.moonDirection},uMoonIntensity:{value:0},uMoonDiscScale:{value:.035},uTurbidity:{value:s.turbidity},
        uRayleighStrength:{value:s.rayleighStrength},uMieStrength:{value:s.mieStrength},uHorizonHaze:{value:s.horizonHaze},
      },
    });
    this.captureShell=new THREE.Mesh(new THREE.SphereGeometry(10,48,24),this.material);
    this.captureShell.frustumCulled=false;
    this.scene.add(this.captureShell);
    this.camera=new THREE.CubeCamera(.1,20,this.target);
    // English: The capture scene contains only procedural atmosphere and clouds, avoiding ocean reflection recursion.
    // 日本語: キャプチャシーンは手続き的大気と雲だけを含み、海面反射の再帰を避ける。
    this.scene.add(this.camera);
  }

  invalidate(): void {
    this.initialized = false;
  }

  update(renderer: THREE.WebGLRenderer,elapsed: number): void {
    const s=this.environment.state,u=this.material.uniforms;
    u.uTime.value=elapsed;u.uClouds.value=Math.max(s.cloudCoverage,s.stormIntensity*.82);u.uStorm.value=s.stormIntensity;u.uWind.value=s.windSpeed;
    u.uWindVector.value.set(Math.cos(s.windDirection),Math.sin(s.windDirection));this.environment.getSunDirection(this.sunDirection);
    this.moonDirection.copy(this.environment.moonLighting.direction);u.uMoonIntensity.value=this.environment.moonLighting.intensity;
    u.uTurbidity.value=s.turbidity;u.uRayleighStrength.value=s.rayleighStrength;u.uMieStrength.value=s.mieStrength;u.uHorizonHaze.value=s.horizonHaze;
    // Underwater refraction and aerial perspective also sample the cubemap.

    this.frameIndex++;
    const updateRate=Math.max(1,Math.round(s.environmentMapUpdateRate));
    const dirty=!this.initialized
      ||Math.abs(s.timeOfDay-this.lastTimeOfDay)>.03
      ||Math.abs(s.cloudCoverage-this.lastCloudCoverage)>.015
      ||Math.abs(s.stormIntensity-this.lastStorm)>.015
      ||Math.abs(s.windSpeed-this.lastWind)>.02
      ||Math.abs(s.windDirection-this.lastWindDirection)>.025
      ||Math.abs(s.turbidity-this.lastTurbidity)>.04
      ||Math.abs(s.rayleighStrength-this.lastRayleigh)>.02
      ||Math.abs(s.mieStrength-this.lastMie)>.02
      ||Math.abs(s.horizonHaze-this.lastHaze)>.02
      ||Math.abs(this.environment.moonLighting.intensity-this.lastMoonIntensity)>.01;
    // English: Refresh immediately for meaningful environment changes, otherwise throttle animated cloud capture to the selected frame interval.
    // 日本語: 有意な環境変化では即時更新し、それ以外の雲アニメーション取得は選択したフレーム間隔に制限する。
    if(!dirty&&this.frameIndex%updateRate!==0)return;
    this.camera.update(renderer,this.scene);
    this.initialized=true;
    this.lastTimeOfDay=s.timeOfDay;this.lastCloudCoverage=s.cloudCoverage;this.lastStorm=s.stormIntensity;
    this.lastWind=s.windSpeed;this.lastWindDirection=s.windDirection;this.lastTurbidity=s.turbidity;
    this.lastRayleigh=s.rayleighStrength;this.lastMie=s.mieStrength;this.lastHaze=s.horizonHaze;this.lastMoonIntensity=this.environment.moonLighting.intensity;
  }

  dispose():void {
    this.captureShell.geometry.dispose();this.material.dispose();this.target.dispose();
  }
}
