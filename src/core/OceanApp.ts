import * as THREE from 'three';
import { CameraController } from './CameraController';
import { EnvironmentController, type CameraMedium } from '../environment/Environment';
import { ProceduralEnvironmentMap } from '../environment/ProceduralEnvironmentMap';
import { OceanRenderer } from '../ocean/OceanRenderer';
import { PaletteManager } from '../palette/PaletteManager';
import { SkyRenderer } from '../sky/SkyRenderer';
import { DebugPanel } from '../ui/DebugPanel';
import { RainSystem } from '../weather/RainSystem';
import { ProceduralAudioEngine } from '../audio/ProceduralAudioEngine';
import { SHOWCASE_CAMERA } from '../config/showcase';
import type { RuntimeStats } from '../ui/DebugPanel';

export interface OceanAppOptions {
  toggleControlsHelp():void;
  notify(message:string):void;
  reportFatalError(message:string):void;
}

export class OceanApp {
  private readonly renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(56,1,.1,1000);
  private readonly cameraController:CameraController;
  private readonly environment = new EnvironmentController();
  private readonly palette = new PaletteManager();
  private readonly reflectionEnvironment: ProceduralEnvironmentMap;
  private readonly ocean: OceanRenderer;
  private readonly sky: SkyRenderer;
  private readonly rain: RainSystem;
  private readonly audioEngine=new ProceduralAudioEngine();
  private readonly debugPanel:DebugPanel;
  private readonly clock = new THREE.Clock();
  private readonly aboveWaterCameraPosition = new THREE.Vector3();
  private aboveWaterYaw=.665;
  private aboveWaterPitch=-.315;
  private readonly debugCameraPosition=new THREE.Vector3();
  private readonly debugSunDirection=new THREE.Vector3();
  private underwaterDebugCameraActive=false;
  private appliedUnderwaterDepth=Number.NaN;
  private appliedUnderwaterView=-1;
  private running=false;
  private disposed=false;
  private physicalMedium:CameraMedium='air';
  private statsElapsed=0;
  private statsFrames=0;
  readonly runtimeStats:RuntimeStats={fps:0,frameTimeMs:0,resolution:'—',drawCalls:0,triangles:0};

  constructor(private readonly host:HTMLElement,private readonly options:OceanAppOptions){
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.NoToneMapping;
    this.renderer.info.autoReset=false;
    this.renderer.debug.onShaderError=()=>this.options.reportFatalError('Shader compilation failed. Check browser and GPU compatibility.');
    this.host.appendChild(this.renderer.domElement);
    this.camera.position.set(...SHOWCASE_CAMERA.position);
    this.cameraController=new CameraController(this.camera,this.renderer.domElement,SHOWCASE_CAMERA.yaw,SHOWCASE_CAMERA.pitch,(height)=>{
      if(!this.underwaterDebugCameraActive)this.environment.setTarget('cameraDebugHeight',height);
    });
    this.palette.update(this.environment.state);
    this.reflectionEnvironment=new ProceduralEnvironmentMap(this.environment);
    this.ocean=new OceanRenderer(this.environment,this.palette,this.reflectionEnvironment.texture,this.reflectionEnvironment.maxMipLevel);
    this.sky=new SkyRenderer(this.environment,this.palette,this.ocean,this.reflectionEnvironment.texture);
    this.rain=new RainSystem(this.environment,this.ocean.ripples);
    this.scene.add(this.sky.mesh,this.ocean.mesh,this.rain.points);
    this.debugPanel=new DebugPanel(this.environment,this.audioEngine,this.runtimeStats,{
      resetShowcase:this.resetShowcaseDefaults,
      resetCamera:this.resetCamera,
      toggleControlsHelp:this.options.toggleControlsHelp,
      notify:this.options.notify,
    });
    this.renderer.domElement.addEventListener('webglcontextlost',this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored',this.onContextRestored);
    window.addEventListener('resize',this.resize);
    this.resize();
  }

  start():void{if(this.running||this.disposed)return;this.running=true;this.renderer.setAnimationLoop(this.frame);}
  async dispose():Promise<void>{
    if(this.disposed)return;
    this.disposed=true;
    this.running=false;this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize',this.resize);
    this.renderer.domElement.removeEventListener('webglcontextlost',this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored',this.onContextRestored);
    this.cameraController.dispose();
    this.debugPanel.dispose();this.rain.dispose();this.sky.dispose();this.ocean.dispose();this.reflectionEnvironment.dispose();
    try {
      await this.audioEngine.dispose();
    } finally {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
  private readonly resetShowcaseDefaults=():void=>{
    this.environment.resetToShowcaseDefaults();this.audioEngine.resetToShowcaseDefaults();
    // Keep the current view when resetting settings, including a view reached with the test camera.
    // テストカメラで到達した視点も含め、設定リセット時の現在視点を維持する。
    this.underwaterDebugCameraActive=false;
    this.environment.setTarget('cameraDebugHeight',this.camera.position.y);
    this.options.notify('Showcase defaults restored. Camera position was preserved.');
  };
  private readonly resetCamera=():void=>{
    this.environment.setTarget('underwaterDebugCamera',false);this.environment.setTarget('cameraDebugHeight',SHOWCASE_CAMERA.position[1]);
    this.underwaterDebugCameraActive=false;this.appliedUnderwaterDepth=Number.NaN;this.appliedUnderwaterView=-1;
    this.cameraController.setTransform(new THREE.Vector3(...SHOWCASE_CAMERA.position),SHOWCASE_CAMERA.yaw,SHOWCASE_CAMERA.pitch);
    this.options.notify('Camera returned to the default showcase view.');
  };
  private readonly onContextLost=(event:Event):void=>{event.preventDefault();this.options.reportFatalError('WebGL context lost. Reload the page to restart the renderer.');};
  private readonly onContextRestored=():void=>this.options.notify('WebGL context restored. Reload if the scene does not resume correctly.');
  private syncUnderwaterDebugCamera():void{
    const state=this.environment.state;
    if(state.underwaterDebugCamera!==this.underwaterDebugCameraActive){
      this.underwaterDebugCameraActive=state.underwaterDebugCamera;
      if(this.underwaterDebugCameraActive){
        this.aboveWaterCameraPosition.copy(this.camera.position);this.aboveWaterYaw=this.cameraController.yaw;this.aboveWaterPitch=this.cameraController.pitch;
        // English: Start slightly off the vertical axis so the center lies inside Snell's window while the viewport edges can cross the critical angle into TIR.
        // 日本語: 中央をスネルの窓内に置きつつ画面端が臨界角を越えて全反射へ移れるよう、鉛直軸から少しだけずらして開始する。
        this.debugCameraPosition.set(0,state.waterLevel-state.underwaterTestDepth,3);
        this.cameraController.setTransform(this.debugCameraPosition,0,Math.atan2(state.underwaterTestDepth+.5,3));
        this.appliedUnderwaterDepth=state.underwaterTestDepth;
        this.appliedUnderwaterView=state.underwaterDebugView;
      }else{
        this.cameraController.setTransform(this.aboveWaterCameraPosition,this.aboveWaterYaw,this.aboveWaterPitch);
        this.appliedUnderwaterDepth=Number.NaN;
        this.appliedUnderwaterView=-1;
      }
    }
    if(this.underwaterDebugCameraActive&&state.underwaterDebugView!==this.appliedUnderwaterView){
      this.appliedUnderwaterView=state.underwaterDebugView;
      if(state.underwaterDebugView===3){
        this.debugCameraPosition.set(0,state.waterLevel-state.underwaterTestDepth,3);
        this.cameraController.setTransform(this.debugCameraPosition,0,0);
        this.appliedUnderwaterDepth=state.underwaterTestDepth;
      }else if(state.underwaterDebugView===6){
        this.debugCameraPosition.set(0,state.waterLevel-state.underwaterTestDepth,0);
        this.cameraController.setTransform(this.debugCameraPosition,0,Math.atan2(-4,3));
        this.appliedUnderwaterDepth=state.underwaterTestDepth;
      }
    }
    if(this.underwaterDebugCameraActive&&state.underwaterTestDepth!==this.appliedUnderwaterDepth){
      this.camera.position.y+=this.appliedUnderwaterDepth-state.underwaterTestDepth;
      this.appliedUnderwaterDepth=state.underwaterTestDepth;
    }
  }
  private evaluateCameraMedium(elapsed:number):CameraMedium{
    const state=this.environment.state;
    const surfaceY=this.ocean.evaluateWaterSurfaceHeight(this.camera.position.x,this.camera.position.z,elapsed);
    const signedDepth=this.camera.position.y-surfaceY;
    // English: Hysteresis stabilizes the discrete medium label; optical water distance still follows the continuous signed depth.
    // 日本語: ヒステリシスは離散的な媒質ラベルだけを安定させ、光学的な水中距離は連続した符号付き深さに従う。
    if(this.physicalMedium==='air'&&signedDepth<-.06)this.physicalMedium='water';
    else if(this.physicalMedium==='water'&&signedDepth>.06)this.physicalMedium='air';
    const effectiveMedium=state.cameraMediumOverride==='auto'?this.physicalMedium:state.cameraMediumOverride;
    state.cameraPhysicalMedium=this.physicalMedium;
    state.cameraEffectiveMedium=effectiveMedium;
    state.cameraX=this.camera.position.x;
    state.cameraY=this.camera.position.y;
    state.cameraZ=this.camera.position.z;
    state.cameraYaw=this.cameraController.yaw;
    state.cameraPitch=this.cameraController.pitch;
    state.cameraForwardY=Math.sin(this.cameraController.pitch);
    state.sunElevation=this.environment.getSunDirection(this.debugSunDirection).y;
    state.cameraSurfaceY=surfaceY;
    state.cameraSurfaceDelta=signedDepth;
    // English: Debug camera placement and shader medium selection are independent; only the resolved effective medium reaches rendering.
    // 日本語: デバッグ用カメラ配置とシェーダーの媒質選択を分離し、解決済みの有効媒質だけを描画へ渡す。
    return effectiveMedium;
  }
  private readonly resize=():void=>{
    const width=Math.max(1,this.host.clientWidth),height=Math.max(1,this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height,false);
  };
  private readonly frame=():void=>{
    const frameInterval=this.clock.getDelta();
    const dt=Math.min(frameInterval,.05),elapsed=this.clock.elapsedTime;
    this.renderer.info.reset();
    this.environment.update(dt);this.palette.update(this.environment.state);
    this.syncUnderwaterDebugCamera();
    if(!this.underwaterDebugCameraActive)this.camera.position.y=this.environment.state.cameraDebugHeight;
    this.cameraController.update(dt);
    const cameraMedium=this.evaluateCameraMedium(elapsed),cameraUnderwater=cameraMedium==='water';
    const state=this.environment.state;
    this.audioEngine.update({
      windSpeed:state.windSpeed,
      swellEnergy:THREE.MathUtils.clamp(state.swellStrength*state.waveStrength/1.8,0,1),
      waveEnergy:THREE.MathUtils.clamp(this.ocean.waveEnergy/1.5,0,1),
      rainIntensity:state.precipitation,
      stormIntensity:state.stormIntensity,
      cameraSurfaceDelta:state.cameraSurfaceDelta,
    },dt);
    this.rain.points.visible=!cameraUnderwater;
    this.sky.update(elapsed,this.camera,cameraUnderwater);this.reflectionEnvironment.update(this.renderer,elapsed);this.ocean.update(elapsed,dt,this.camera,cameraUnderwater);this.rain.update(dt,this.camera);
    this.renderer.render(this.scene,this.camera);
    if(frameInterval>0)this.updateRuntimeStats(frameInterval);
  };
  private updateRuntimeStats(dt:number):void {
    this.statsElapsed+=dt;this.statsFrames++;
    if(this.statsElapsed<.5)return;
    this.runtimeStats.fps=Math.round(this.statsFrames/this.statsElapsed);
    this.runtimeStats.frameTimeMs=Number((this.statsElapsed/this.statsFrames*1000).toFixed(1));
    this.runtimeStats.drawCalls=this.renderer.info.render.calls;this.runtimeStats.triangles=this.renderer.info.render.triangles;
    const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());this.runtimeStats.resolution=`${size.x} × ${size.y}`;
    this.statsElapsed=0;this.statsFrames=0;
  }
}
