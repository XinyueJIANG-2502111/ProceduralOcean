import GUI from 'lil-gui';
import type { ProceduralAudioEngine } from '../audio/ProceduralAudioEngine';
import type { EnvironmentController, EnvironmentState } from '../environment/Environment';

type NumericKey = { [K in keyof EnvironmentState]: EnvironmentState[K] extends number ? K : never }[keyof EnvironmentState];
type NumericControl = [NumericKey,number,number,number,string];
export type UIMode = 'showcase' | 'debug';

export interface RuntimeStats {
  fps:number;
  frameTimeMs:number;
  resolution:string;
  drawCalls:number;
  triangles:number;
}

export interface DebugPanelActions {
  resetShowcase():void;
  resetCamera():void;
  toggleControlsHelp():void;
  notify(message:string):void;
}

export class DebugPanel {
  private readonly gui=new GUI({title:'OCEAN SHOWCASE',width:310});
  private readonly onKeyDown=(event:KeyboardEvent):void=>{
    if(event.key.toLowerCase()==='h')this.gui.show(this.gui._hidden);
  };

  constructor(environment:EnvironmentController,audio:ProceduralAudioEngine,stats:RuntimeStats,actions:DebugPanelActions){
    const s=environment.state;
    const addControls=(folder:GUI,controls:NumericControl[])=>{
      for(const [key,min,max,step,label] of controls){
        // Route slider edits to the target while displaying the interpolated state.
        // スライダー入力は目標値に送り、表示には補間された現在値を使う。
        const binding={
          get value(){return s[key];},
          set value(next:number){environment.setTarget(key,next);},
        };
        folder.add(binding,'value',min,max,step).name(label).listen();
      }
    };

    const scene=this.gui.addFolder('Showcase Controls / 展示控制');
    scene.add(s,'timeOfDay',0,24,.01).name('Time of Day / 时间').listen().onChange((value:number)=>environment.setTarget('timeOfDay',value));
    addControls(scene,[['precipitation',0,1,.01,'Weather / Rain'],['windSpeed',0,1,.01,'Wind / 风速']]);
    scene.add(s,'renderingMode',{'Physical':0,'Physical + Tone Mapping':1,'Palette':2,'Final / Palette + Dithering':3}).name('Rendering Mode').listen().onChange((value:number)=>environment.setTarget('renderingMode',Number(value)));
    scene.open();

    const audioFolder=this.gui.addFolder('Audio / 音频');
    const enabledControl=audioFolder.add(audio.settings,'enabled').name('Enable Audio / Mute').listen().onChange(async (enabled:boolean)=>{
      if(!enabled){audio.setEnabled(false);return;}
      try{
        // English: Audio startup must follow a user gesture to satisfy browser autoplay restrictions without blocking visual initialization.
        // 日本語: ブラウザの自動再生制限に対応するため、音声開始はユーザー操作後に行い、映像の初期化を妨げないようにする。
        await audio.start();
      }catch(error){
        if(!audio.settings.enabled)return;
        audio.setEnabled(false);enabledControl.updateDisplay();
        actions.notify(error instanceof Error?`Audio unavailable: ${error.message}`:'Audio could not be started.');
      }
    });
    audioFolder.add(audio.settings,'masterVolume',0,1,.01).name('Master Volume').listen().onChange((value:number)=>audio.setMasterVolume(value));
    audioFolder.open();

    const presets=this.gui.addFolder('Environment Presets / 环境预设');
    const presetActions={calmDay:()=>environment.applyPreset('calm-day'),sunset:()=>environment.applyPreset('sunset'),rain:()=>environment.applyPreset('rain'),storm:()=>environment.applyPreset('storm')};
    presets.add(presetActions,'calmDay').name('Calm Day / 晴朗白天');presets.add(presetActions,'sunset').name('Sunset / 黄昏');
    presets.add(presetActions,'rain').name('Rain / 降雨');presets.add(presetActions,'storm').name('Storm / 暴风雨');presets.open();

    const actionsFolder=this.gui.addFolder('Help & Reset / 帮助与重置');
    const showcaseActions={controlsHelp:actions.toggleControlsHelp,resetDefault:actions.resetShowcase,resetCamera:actions.resetCamera};
    actionsFolder.add(showcaseActions,'controlsHelp').name('Controls Help / 操作帮助');
    actionsFolder.add(showcaseActions,'resetDefault').name('Reset to Default / 重置场景');
    actionsFolder.add(showcaseActions,'resetCamera').name('Reset Camera / 重置相机');actionsFolder.open();

    const advanced=this.gui.addFolder('Advanced / Debug');
    this.buildAdvancedControls(advanced,environment,audio,stats,addControls);advanced.close();advanced.hide();
    const interfaceState:{mode:UIMode}={mode:'showcase'};
    this.gui.add(interfaceState,'mode',{'Showcase':'showcase','Advanced / Debug':'debug'}).name('Interface').onChange((mode:UIMode)=>{
      if(mode==='debug'){advanced.show();advanced.open();}else{advanced.close();advanced.hide();}
    });

    window.addEventListener('keydown',this.onKeyDown);
  }

  dispose():void {window.removeEventListener('keydown',this.onKeyDown);this.gui.destroy();}

  private buildAdvancedControls(advanced:GUI,environment:EnvironmentController,audio:ProceduralAudioEngine,stats:RuntimeStats,addControls:(folder:GUI,controls:NumericControl[])=>void):void {
    const s=environment.state;
    const time=advanced.addFolder('Time & Moon / 时间与月光');
    time.add(s,'animateTime').name('自动流逝').listen().onChange((value:boolean)=>environment.setTarget('animateTime',value));
    time.add(s,'timeScale',0,.5,.005).name('时间速度').listen().onChange((value:number)=>environment.setTarget('timeScale',value));
    time.add(s,'moonEnabled').name('Moon / 月光').listen().onChange((value:boolean)=>environment.setTarget('moonEnabled',value));addControls(time,[['moonIntensity',0,2,.01,'Moon Intensity / 月光强度']]);time.close();

    const weather=advanced.addFolder('Environment / 环境响应');addControls(weather,[['windDirection',0,Math.PI*2,.01,'风向'],['cloudCoverage',0,1,.01,'云量'],['stormIntensity',0,1,.01,'暴风强度'],['aerialDensity',.002,.04,.001,'大气透视']]);weather.close();
    const atmosphere=advanced.addFolder('Atmosphere / 大气');addControls(atmosphere,[['turbidity',1,8,.05,'浑浊度'],['rayleighStrength',.2,2,.01,'Rayleigh'],['mieStrength',.1,2,.01,'Mie'],['horizonHaze',0,1.5,.01,'地平线霾']]);atmosphere.close();

    const ocean=advanced.addFolder('Ocean Internals / 海面参数');addControls(ocean,[
      ['swellCount',4,6,1,'Swell 数量'],['swellStrength',0,1.8,.01,'Swell 强度'],['swellDirection',0,Math.PI*2,.01,'Swell 方向'],['swellDirectionOffset',-1.2,1.2,.01,'Swell 方向偏移'],
      ['mainWaveCount',8,20,1,'主风浪数量'],['mainWaveStrength',0,2,.01,'主风浪强度'],['peakWavelength',22,48,.5,'峰值波长'],['directionSpread',.12,1.2,.01,'方向散布'],
      ['midNormalStrength',0,.3,.005,'中尺度法线'],['highNormalStrength',0,.16,.002,'高频法线'],['waveSeed',0,9999,1,'Wave Seed'],['detailFalloff',.004,.05,.001,'距离细节衰减'],['rippleStrength',0,2,.01,'雨圈强度'],
    ]);
    ocean.add(s,'waveDebugMode',{'Combined / 组合':0,'Swell Only / 仅涌浪':1,'Main Waves Only / 仅主风浪':2,'Surface Detail Only / 仅表面细节':3,'Foam Mask / 泡沫遮罩':4,'Foam Shading / 泡沫着色':5,'Reflection Only / 仅反射':6,'Water Body Only / 仅水体':7,'Aerial Contribution / 大气贡献':8,'Water Palette Index / 水体色阶':9,'Reflection Continuous / 连续反射':10,'Moon Specular Only / 仅月光高光':11}).name('Wave Debug').listen().onChange((value:number)=>environment.setTarget('waveDebugMode',Number(value)));ocean.close();

    const waterVolume=advanced.addFolder('Water Volume / 水体');addControls(waterVolume,[['averageWaterDepth',2,20,.1,'Water Depth / 水深'],['absorptionR',.01,.4,.005,'Absorption R'],['absorptionG',.01,.25,.005,'Absorption G'],['absorptionB',.005,.15,.005,'Absorption B'],['scatteringStrength',0,1.5,.01,'Scattering / 散射'],['refractionStrength',0,1,.01,'Refraction / 折射'],['seabedVariation',0,12,.1,'Seabed Variation / 海床变化']]);
    waterVolume.add(s,'waterVolumeDebugMode',{'Combined Physical / 组合':0,'Water Depth / 水深':1,'Transmittance / 透射率':2,'Transmission Only / 仅透射':3,'Reflection Only / 仅反射':4}).name('Volume Debug').listen().onChange((value:number)=>environment.setTarget('waterVolumeDebugMode',Number(value)));waterVolume.close();

    const underwater=advanced.addFolder('Underwater / 水下');underwater.add(s,'underwaterDebugCamera').name('Move Test Camera / 移动测试相机').listen().onChange((value:boolean)=>environment.setTarget('underwaterDebugCamera',value));
    underwater.add(s,'cameraMediumOverride',{'Auto / 自动':'auto','Force Air / 强制空气':'air','Force Water / 强制水下':'water'}).name('Camera Medium Override').listen().onChange((value:string)=>environment.setTarget('cameraMediumOverride',value));
    addControls(underwater,[['underwaterTestDepth',.2,18,.2,'Test Depth / 测试深度'],['waterScatteringR',0,.25,.005,'Scattering Color R'],['waterScatteringG',0,.25,.005,'Scattering Color G'],['waterScatteringB',0,.25,.005,'Scattering Color B'],['underwaterEnvironmentIntensity',0,1.5,.01,'Environment Intensity / 环境亮度']]);
    underwater.add(s,'underwaterDebugView',{'Underwater Physical / 水下物理':0,'Underwater Normal / 水下法线':1,'Water Transmittance / 水体透射率':2,'Water In-Scattering / 水体内散射':3,'Snell Window':4,'TIR Mask / 全反射':5,'Seabed Radiance Before Attenuation / 海床原始光照':6,'Underwater Reflection / 水下反射':7}).name('Underwater Debug View').listen().onChange((value:number)=>environment.setTarget('underwaterDebugView',Number(value)));
    underwater.add(s,'sunShaftsEnabled').name('Sun Shafts / 太阳光束').listen().onChange((value:boolean)=>environment.setTarget('sunShaftsEnabled',value));addControls(underwater,[['sunShaftStrength',0,2,.01,'Shaft Strength / 光束强度'],['sunShaftContrast',.1,2,.01,'Shaft Contrast / 光束对比'],['sunShaftMaxDistance',2,42,.5,'Shaft Max Distance / 最大距离']]);
    underwater.add(s,'surfaceCrossingDebugView',{'Normal / 正常':0,'Camera Medium / 相机介质':1,'Signed Surface Depth / 波面深度':2,'Water Path Length / 水中光程':3,'Surface Hit / Miss':4,'Surface Hit Distance':5,'Ray Direction Y':6,'Refraction Only':7,'TIR Reflection Only':8,'Fresnel':9,'Combined Interface':10}).name('Crossing Debug').listen().onChange((value:number)=>environment.setTarget('surfaceCrossingDebugView',Number(value)));
    underwater.add(s,'cameraPhysicalMedium').name('Physical Medium').listen().disable();underwater.add(s,'cameraEffectiveMedium').name('Effective Medium').listen().disable();underwater.add(s,'cameraSurfaceDelta').name('Camera - Surface').listen().disable();underwater.close();

    const rendering=advanced.addFolder('Stylization / 风格化');addControls(rendering,[['paletteStrength',0,1,.01,'Palette 强度'],['quantizationLevels',3,8,1,'量化色阶'],['ditheringStrength',0,1.5,.01,'Dithering'],['skyQuantizationStrength',0,1,.01,'Sky Quantization'],['skyDitherStrength',0,1,.01,'Sky Dither'],['skyHorizonPreservation',0,1.5,.01,'Horizon Preservation'],['skyElevationBias',0,1,.01,'Elevation Bias'],['skyLumaWeight',0,1,.01,'Luma Weight']]);
    rendering.add(s,'skyDebugView',{'Composite / 最终组合':0,'Sky Physical':1,'Sky ToneMapped':2,'Sky Ramp Only':3,'Sky Ramp + Dither':4,'Atmosphere Only':5,'Cloud Only':6,'Cloud Light Response':7,'Cloud Base Before Palette':8,'Cloud Stylized':9,'Direct Sun Intensity':10,'Twilight Factor':11,'Rayleigh Day Weight':12,'Moon Visibility':13,'Moon Direct Light':14}).name('Sky Debug View').listen().onChange((value:number)=>environment.setTarget('skyDebugView',Number(value)));rendering.close();

    const reflection=advanced.addFolder('Environment Reflection / 环境反射');reflection.add(s,'environmentReflectionEnabled').name('启用环境反射').listen().onChange((value:boolean)=>environment.setTarget('environmentReflectionEnabled',value));reflection.add(s,'environmentReflectionOnly').name('仅显示环境反射').listen().onChange((value:boolean)=>environment.setTarget('environmentReflectionOnly',value));addControls(reflection,[['environmentMapUpdateRate',1,6,1,'更新间隔（帧）']]);reflection.close();
    const audioDebug=advanced.addFolder('Audio Diagnostics / 音频诊断');audioDebug.add(audio.settings,'oceanVolume',0,1,.01).name('Ocean Volume').listen().onChange((value:number)=>audio.setOceanVolume(value));audioDebug.add(audio.settings,'rainVolume',0,1,.01).name('Rain Volume').listen().onChange((value:number)=>audio.setRainVolume(value));audioDebug.add(audio.debug,'oceanGain').name('Ocean Gain').listen().disable();audioDebug.add(audio.debug,'rainGain').name('Rain Gain').listen().disable();audioDebug.add(audio.debug,'underwaterBlend').name('Underwater Blend').listen().disable();audioDebug.add(audio.debug,'contextState').name('Audio Context').listen().disable();audioDebug.close();
    const performance=advanced.addFolder('Performance / 性能');performance.add(stats,'fps').name('FPS (CPU cadence)').listen().disable();performance.add(stats,'frameTimeMs').name('Frame Time (ms)').listen().disable();performance.add(stats,'resolution').name('Renderer Resolution').listen().disable();performance.add(stats,'drawCalls').name('Draw Calls').listen().disable();performance.add(stats,'triangles').name('Triangles').listen().disable();performance.close();
  }
}
