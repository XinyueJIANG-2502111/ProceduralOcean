import GUI, { type Controller } from 'lil-gui';
import { languageOptions, panelLabel, type Locale, type PageMessage, type PanelLabel } from './translations';
import type { ProceduralAudioEngine } from '../audio/ProceduralAudioEngine';
import type { EnvironmentController, EnvironmentState } from '../environment/Environment';

type NumericKey = { [K in keyof EnvironmentState]: EnvironmentState[K] extends number ? K : never }[keyof EnvironmentState];
type NumericControl = [NumericKey,number,number,number,PanelLabel];
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
  notify(message:PageMessage, detail?:string):void;
  onLanguageChange(locale:Locale):void;
}

export class DebugPanel {
  private readonly gui=new GUI({title:'OCEAN SHOWCASE',width:310});
  private readonly language:{locale:Locale}={locale:'en'};
  private readonly updateLabels:Array<() => void>=[];

  private label(controller:Controller,key:PanelLabel):Controller {
    this.updateLabels.push(()=>controller.name(panelLabel(key,this.language.locale)));
    return controller.name(key);
  }

  private folder(parent:GUI,key:PanelLabel):GUI {
    const folder=parent.addFolder(key);
    this.updateLabels.push(()=>folder.title(panelLabel(key,this.language.locale)));
    return folder;
  }

  private select<Model extends object>(parent:GUI,model:Model,property:keyof Model,choices:Partial<Record<PanelLabel,number|string>>):Controller {
    const controller=parent.add(model,property,choices);
    this.updateLabels.push(()=>{
      const translated=Object.entries(choices).map(([key,value])=>[panelLabel(key as PanelLabel,this.language.locale),value]);
      controller.options(Object.fromEntries(translated));
    });
    return controller;
  }
  private readonly onKeyDown=(event:KeyboardEvent):void=>{
    if(event.key.toLowerCase()==='h')this.gui.show(this.gui._hidden);
  };

  constructor(environment:EnvironmentController,audio:ProceduralAudioEngine,stats:RuntimeStats,actions:DebugPanelActions){
    this.label(this.gui.add(this.language,'locale',languageOptions),'Language').onChange((locale:Locale)=>{
      this.gui.title(panelLabel('OCEAN SHOWCASE',locale));
      for(const updateLabel of this.updateLabels)updateLabel();
      actions.onLanguageChange(locale);
    });
    const s=environment.state;
    const addControls=(folder:GUI,controls:NumericControl[])=>{
      for(const [key,min,max,step,label] of controls){
        // Route slider edits to the target while displaying the interpolated state.
        // スライダー入力は目標値に送り、表示には補間された現在値を使う。
        const binding={
          get value(){return s[key];},
          set value(next:number){environment.setTarget(key,next);},
        };
        this.label(folder.add(binding,'value',min,max,step),label).listen();
      }
    };

    const scene=this.folder(this.gui,"Showcase Controls");
    this.label(scene.add(s,'timeOfDay',0,24,.01),"Time of Day").listen().onChange((value:number)=>environment.setTarget('timeOfDay',value));
    addControls(scene,[['precipitation',0,1,.01,"Weather / Rain"],['windSpeed',0,1,.01,"Wind"]]);
    this.label(this.select(scene,s,'renderingMode',{"Physical":0,"Physical + Tone Mapping":1,"Palette":2,"Final / Palette + Dithering":3}),"Rendering Mode").listen().onChange((value:number)=>environment.setTarget('renderingMode',Number(value)));
    scene.open();

    const audioFolder=this.folder(this.gui,"Audio");
    const enabledControl=this.label(audioFolder.add(audio.settings,'enabled'),"Enable Audio / Mute").listen().onChange(async (enabled:boolean)=>{
      if(!enabled){audio.setEnabled(false);return;}
      try{
        // English: Audio startup must follow a user gesture to satisfy browser autoplay restrictions without blocking visual initialization.
        // 日本語: ブラウザの自動再生制限に対応するため、音声開始はユーザー操作後に行い、映像の初期化を妨げないようにする。
        await audio.start();
      }catch(error){
        if(!audio.settings.enabled)return;
        audio.setEnabled(false);enabledControl.updateDisplay();
        actions.notify('audioUnavailable',error instanceof Error?error.message:undefined);
      }
    });
    this.label(audioFolder.add(audio.settings,'masterVolume',0,1,.01),"Master Volume").listen().onChange((value:number)=>audio.setMasterVolume(value));
    audioFolder.open();

    const presets=this.folder(this.gui,"Environment Presets");
    const presetActions={calmDay:()=>environment.applyPreset('calm-day'),sunset:()=>environment.applyPreset('sunset'),rain:()=>environment.applyPreset('rain'),storm:()=>environment.applyPreset('storm')};
    this.label(presets.add(presetActions,'calmDay'),"Calm Day");this.label(presets.add(presetActions,'sunset'),"Sunset");
    this.label(presets.add(presetActions,'rain'),"Rain");this.label(presets.add(presetActions,'storm'),"Storm");presets.open();

    const actionsFolder=this.folder(this.gui,"Help & Reset");
    const showcaseActions={controlsHelp:actions.toggleControlsHelp,resetDefault:actions.resetShowcase,resetCamera:actions.resetCamera};
    this.label(actionsFolder.add(showcaseActions,'controlsHelp'),"Controls Help");
    this.label(actionsFolder.add(showcaseActions,'resetDefault'),"Reset to Default");
    this.label(actionsFolder.add(showcaseActions,'resetCamera'),"Reset Camera");actionsFolder.open();

    const advanced=this.folder(this.gui,"Advanced / Debug");
    this.buildAdvancedControls(advanced,environment,audio,stats,addControls);advanced.close();advanced.hide();
    const interfaceState:{mode:UIMode}={mode:'showcase'};
    this.label(this.select(this.gui,interfaceState,'mode',{"Showcase":'showcase',"Advanced / Debug":'debug'}),"Interface").onChange((mode:UIMode)=>{
      if(mode==='debug'){advanced.show();advanced.open();}else{advanced.close();advanced.hide();}
    });

    window.addEventListener('keydown',this.onKeyDown);
  }

  dispose():void {window.removeEventListener('keydown',this.onKeyDown);this.gui.destroy();}

  private buildAdvancedControls(advanced:GUI,environment:EnvironmentController,audio:ProceduralAudioEngine,stats:RuntimeStats,addControls:(folder:GUI,controls:NumericControl[])=>void):void {
    const s=environment.state;
    const mediumLabel=(medium:'air'|'water')=>panelLabel(medium==='air'?'Air':'Water',this.language.locale);
    const audioStates:Record<string,PanelLabel>={'not started':'Not started',running:'Running',suspended:'Suspended',interrupted:'Interrupted',closed:'Closed',disposed:'Disposed'};
    const panel=this;
    const diagnostics={
      get physicalMedium(){return mediumLabel(s.cameraPhysicalMedium);},
      get effectiveMedium(){return mediumLabel(s.cameraEffectiveMedium);},
      get audioContext(){return panelLabel(audioStates[audio.debug.contextState]??'Not started',panel.language.locale);},
    };
    const time=this.folder(advanced,"Time & Moon");
    this.label(time.add(s,'animateTime'),"Advance Time").listen().onChange((value:boolean)=>environment.setTarget('animateTime',value));
    this.label(time.add(s,'timeScale',0,.5,.005),"Time Speed").listen().onChange((value:number)=>environment.setTarget('timeScale',value));
    this.label(time.add(s,'moonEnabled'),"Moon").listen().onChange((value:boolean)=>environment.setTarget('moonEnabled',value));addControls(time,[['moonIntensity',0,2,.01,"Moon Intensity"]]);time.close();

    const weather=this.folder(advanced,"Environment");addControls(weather,[['windDirection',0,Math.PI*2,.01,"Wind Direction"],['cloudCoverage',0,1,.01,"Cloud Cover"],['stormIntensity',0,1,.01,"Storm Intensity"],['aerialDensity',.002,.04,.001,"Aerial Perspective"]]);weather.close();
    const atmosphere=this.folder(advanced,"Atmosphere");addControls(atmosphere,[['turbidity',1,8,.05,"Turbidity"],['rayleighStrength',.2,2,.01,"Rayleigh"],['mieStrength',.1,2,.01,"Mie"],['horizonHaze',0,1.5,.01,"Horizon Haze"]]);atmosphere.close();

    const ocean=this.folder(advanced,"Ocean Internals");addControls(ocean,[
      ['swellCount',4,6,1,"Swell Count"],['swellStrength',0,1.8,.01,"Swell Strength"],['swellDirection',0,Math.PI*2,.01,"Swell Direction"],['swellDirectionOffset',-1.2,1.2,.01,"Swell Direction Offset"],
      ['mainWaveCount',8,20,1,"Wind Wave Count"],['mainWaveStrength',0,2,.01,"Wind Wave Strength"],['peakWavelength',22,48,.5,"Peak Wavelength"],['directionSpread',.12,1.2,.01,"Directional Spread"],
      ['midNormalStrength',0,.3,.005,"Mid-Scale Normals"],['highNormalStrength',0,.16,.002,"High-Frequency Normals"],['waveSeed',0,9999,1,"Wave Seed"],['detailFalloff',.004,.05,.001,"Detail Falloff"],['rippleStrength',0,2,.01,"Rain Ripple Strength"],
    ]);
    this.label(this.select(ocean,s,'waveDebugMode',{"Combined":0,"Swell Only":1,"Main Waves Only":2,"Surface Detail Only":3,"Foam Mask":4,"Foam Shading":5,"Reflection Only":6,"Water Body Only":7,"Aerial Contribution":8,"Water Palette Index":9,"Continuous Reflection":10,"Moon Specular Only":11}),"Wave Debug").listen().onChange((value:number)=>environment.setTarget('waveDebugMode',Number(value)));ocean.close();

    const waterVolume=this.folder(advanced,"Water Volume");addControls(waterVolume,[['averageWaterDepth',2,20,.1,"Water Depth"],['absorptionR',.01,.4,.005,"Absorption R"],['absorptionG',.01,.25,.005,"Absorption G"],['absorptionB',.005,.15,.005,"Absorption B"],['scatteringStrength',0,1.5,.01,"Scattering"],['refractionStrength',0,1,.01,"Refraction"],['seabedVariation',0,12,.1,"Seabed Variation"]]);
    this.label(this.select(waterVolume,s,'waterVolumeDebugMode',{"Combined Physical":0,"Water Depth":1,"Transmittance":2,"Transmission Only":3,"Reflection Only":4}),"Volume Debug").listen().onChange((value:number)=>environment.setTarget('waterVolumeDebugMode',Number(value)));waterVolume.close();

    const underwater=this.folder(advanced,"Underwater");this.label(underwater.add(s,'underwaterDebugCamera'),"Move Test Camera").listen().onChange((value:boolean)=>environment.setTarget('underwaterDebugCamera',value));
    this.label(this.select(underwater,s,'cameraMediumOverride',{"Auto":'auto',"Force Air":'air',"Force Water":'water'}),"Camera Medium Override").listen().onChange((value:string)=>environment.setTarget('cameraMediumOverride',value));
    addControls(underwater,[['underwaterTestDepth',.2,18,.2,"Test Depth"],['waterScatteringR',0,.25,.005,"Scattering Color R"],['waterScatteringG',0,.25,.005,"Scattering Color G"],['waterScatteringB',0,.25,.005,"Scattering Color B"],['underwaterEnvironmentIntensity',0,1.5,.01,"Environment Intensity"]]);
    this.label(this.select(underwater,s,'underwaterDebugView',{"Underwater Physical":0,"Underwater Normal":1,"Water Transmittance":2,"Water In-Scattering":3,"Snell's Window":4,"Total Internal Reflection Mask":5,"Seabed Radiance Before Attenuation":6,"Underwater Reflection":7}),"Underwater Debug View").listen().onChange((value:number)=>environment.setTarget('underwaterDebugView',Number(value)));
    this.label(underwater.add(s,'sunShaftsEnabled'),"Sun Shafts").listen().onChange((value:boolean)=>environment.setTarget('sunShaftsEnabled',value));addControls(underwater,[['sunShaftStrength',0,2,.01,"Shaft Strength"],['sunShaftContrast',.1,2,.01,"Shaft Contrast"],['sunShaftMaxDistance',2,42,.5,"Shaft Max Distance"]]);
    this.label(this.select(underwater,s,'surfaceCrossingDebugView',{"Normal":0,"Camera Medium":1,"Signed Surface Depth":2,"Water Path Length":3,"Surface Hit / Miss":4,"Surface Hit Distance":5,"Ray Direction Y":6,"Refraction Only":7,"Total Internal Reflection Only":8,"Fresnel":9,"Combined Interface":10}),"Crossing Debug").listen().onChange((value:number)=>environment.setTarget('surfaceCrossingDebugView',Number(value)));
    this.label(underwater.add(diagnostics,'physicalMedium'),"Physical Medium").listen().disable();this.label(underwater.add(diagnostics,'effectiveMedium'),"Effective Medium").listen().disable();this.label(underwater.add(s,'cameraSurfaceDelta'),"Camera - Surface").listen().disable();underwater.close();

    const rendering=this.folder(advanced,"Stylization");addControls(rendering,[['paletteStrength',0,1,.01,"Palette Strength"],['quantizationLevels',3,8,1,"Quantization Levels"],['ditheringStrength',0,1.5,.01,"Dithering"],['skyQuantizationStrength',0,1,.01,"Sky Quantization"],['skyDitherStrength',0,1,.01,"Sky Dither"],['skyHorizonPreservation',0,1.5,.01,"Horizon Preservation"],['skyElevationBias',0,1,.01,"Elevation Bias"],['skyLumaWeight',0,1,.01,"Luma Weight"]]);
    this.label(this.select(rendering,s,'skyDebugView',{"Composite":0,"Sky Physical":1,"Sky Tone Mapping":2,"Sky Ramp Only":3,"Sky Ramp + Dither":4,"Atmosphere Only":5,"Cloud Only":6,"Cloud Light Response":7,"Cloud Base Before Palette":8,"Cloud Stylized":9,"Direct Sun Intensity":10,"Twilight Factor":11,"Rayleigh Day Weight":12,"Moon Visibility":13,"Moon Direct Light":14}),"Sky Debug View").listen().onChange((value:number)=>environment.setTarget('skyDebugView',Number(value)));rendering.close();

    const reflection=this.folder(advanced,"Environment Reflection");this.label(reflection.add(s,'environmentReflectionEnabled'),"Enable Environment Reflection").listen().onChange((value:boolean)=>environment.setTarget('environmentReflectionEnabled',value));this.label(reflection.add(s,'environmentReflectionOnly'),"Environment Reflection Only").listen().onChange((value:boolean)=>environment.setTarget('environmentReflectionOnly',value));addControls(reflection,[['environmentMapUpdateRate',1,6,1,"Update Interval (frames)"]]);reflection.close();
    const audioDebug=this.folder(advanced,"Audio Diagnostics");this.label(audioDebug.add(audio.settings,'oceanVolume',0,1,.01),"Ocean Volume").listen().onChange((value:number)=>audio.setOceanVolume(value));this.label(audioDebug.add(audio.settings,'rainVolume',0,1,.01),"Rain Volume").listen().onChange((value:number)=>audio.setRainVolume(value));this.label(audioDebug.add(audio.debug,'oceanGain'),"Ocean Gain").listen().disable();this.label(audioDebug.add(audio.debug,'rainGain'),"Rain Gain").listen().disable();this.label(audioDebug.add(audio.debug,'underwaterBlend'),"Underwater Blend").listen().disable();this.label(audioDebug.add(diagnostics,'audioContext'),"Audio Context").listen().disable();audioDebug.close();
    const performance=this.folder(advanced,"Performance");this.label(performance.add(stats,'fps'),"FPS (CPU cadence)").listen().disable();this.label(performance.add(stats,'frameTimeMs'),"Frame Time (ms)").listen().disable();this.label(performance.add(stats,'resolution'),"Renderer Resolution").listen().disable();this.label(performance.add(stats,'drawCalls'),"Draw Calls").listen().disable();this.label(performance.add(stats,'triangles'),"Triangles").listen().disable();performance.close();
  }
}
