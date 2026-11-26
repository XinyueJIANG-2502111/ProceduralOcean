import { OceanSoundGenerator } from './OceanSoundGenerator';
import { RainSoundGenerator } from './RainSoundGenerator';
import { SHOWCASE_AUDIO_DEFAULTS } from '../config/showcase';

export interface AudioEnvironment {
  windSpeed:number;
  swellEnergy:number;
  waveEnergy:number;
  rainIntensity:number;
  stormIntensity:number;
  cameraSurfaceDelta:number;
}

export interface AudioSettings {
  enabled:boolean;
  masterVolume:number;
  oceanVolume:number;
  rainVolume:number;
}

export interface AudioDebugState {
  oceanGain:number;
  rainGain:number;
  underwaterBlend:number;
  contextState:string;
}

interface MappedAudioEnvironment {
  oceanRumble:number;
  oceanHiss:number;
  oceanSurge:number;
  oceanBrightness:number;
  rainBed:number;
  rainDroplets:number;
  rainBrightness:number;
}

export class ProceduralAudioEngine {
  readonly settings:AudioSettings={...SHOWCASE_AUDIO_DEFAULTS};
  readonly debug:AudioDebugState={oceanGain:0,rainGain:0,underwaterBlend:0,contextState:'not started'};
  private context:AudioContext|null=null;
  private ocean:OceanSoundGenerator|null=null;
  private rain:RainSoundGenerator|null=null;
  private masterGain:GainNode|null=null;
  private oceanVolumeGain:GainNode|null=null;
  private rainVolumeGain:GainNode|null=null;
  private airGain:GainNode|null=null;
  private waterGain:GainNode|null=null;
  private underwaterLowpass:BiquadFilterNode|null=null;
  private underwaterRainLowpass:BiquadFilterNode|null=null;
  private underwaterRainGain:GainNode|null=null;
  private smoothedUnderwaterBlend=0;
  private disposed=false;
  private readonly lastAutomation=new Map<string,number>();

  async start():Promise<void> {
    if(this.disposed)throw new Error('Audio engine has been disposed');
    if(!this.context)this.createGraph();
    const context=this.context;
    if(!context)return;
    if(context.state!=='running')await context.resume();
    if(this.disposed)return;
    this.debug.contextState=context.state;
    this.applyMasterGain();
  }

  update(environment:AudioEnvironment,deltaTime:number):void {
    if(this.disposed)return;
    const mapped=mapEnvironmentToAudio(environment);
    const targetBlend=1-smoothstep(-.35,.2,environment.cameraSurfaceDelta);
    const blendRate=1-Math.exp(-Math.max(deltaTime,0)*5.0);
    this.smoothedUnderwaterBlend=lerp(this.smoothedUnderwaterBlend,targetBlend,blendRate);
    this.debug.oceanGain=mapped.oceanRumble*.55+mapped.oceanHiss*.45;
    this.debug.rainGain=mapped.rainBed;
    this.debug.underwaterBlend=this.smoothedUnderwaterBlend;
    this.debug.contextState=this.context?.state??'not started';
    if(!this.context||!this.ocean||!this.rain||this.context.state!=='running')return;
    const now=this.context.currentTime;
    this.ocean.update({rumble:mapped.oceanRumble,broadNoise:mapped.oceanHiss,surgeAmount:mapped.oceanSurge,brightness:mapped.oceanBrightness});
    this.rain.update({bed:mapped.rainBed,droplets:mapped.rainDroplets,brightness:mapped.rainBrightness},this.settings.enabled);

    // English: Blend air and underwater audio continuously using camera depth relative to the animated water surface.
    // 日本語: 動的な水面に対するカメラの相対深度を用いて、空気中と水中の音を連続的に切り替える。
    const airLevel=Math.sqrt(Math.max(0,1-this.smoothedUnderwaterBlend));
    const waterLevel=Math.sqrt(Math.max(0,this.smoothedUnderwaterBlend))*.72;
    this.schedule(this.airGain?.gain,airLevel,now,.12,'air',.004);
    this.schedule(this.waterGain?.gain,waterLevel,now,.12,'water',.004);
    const depth=clamp(-environment.cameraSurfaceDelta,0,5)/5;
    this.schedule(this.underwaterLowpass?.frequency,lerp(430,270,depth),now,.22,'waterCutoff',1.5);
    this.schedule(this.underwaterRainLowpass?.frequency,lerp(330,210,depth),now,.22,'rainWaterCutoff',1.5);
  }

  setEnabled(enabled:boolean):void {this.settings.enabled=enabled;this.applyMasterGain();}
  setMasterVolume(value:number):void {this.settings.masterVolume=clamp01(value);this.applyMasterGain();}
  setOceanVolume(value:number):void {
    this.settings.oceanVolume=clamp01(value);
    if(this.context)this.schedule(this.oceanVolumeGain?.gain,this.settings.oceanVolume*.78,this.context.currentTime,.15,'oceanVolume',.001);
  }
  setRainVolume(value:number):void {
    this.settings.rainVolume=clamp01(value);
    if(this.context)this.schedule(this.rainVolumeGain?.gain,this.settings.rainVolume*.68,this.context.currentTime,.15,'rainVolume',.001);
  }

  resetToShowcaseDefaults():void {
    this.setEnabled(false);
    this.setMasterVolume(SHOWCASE_AUDIO_DEFAULTS.masterVolume);
    this.setOceanVolume(SHOWCASE_AUDIO_DEFAULTS.oceanVolume);
    this.setRainVolume(SHOWCASE_AUDIO_DEFAULTS.rainVolume);
  }

  async dispose():Promise<void> {
    if(this.disposed)return;
    this.disposed=true;this.settings.enabled=false;
    this.ocean?.dispose();this.rain?.dispose();
    this.ocean=null;this.rain=null;
    this.masterGain?.disconnect();this.oceanVolumeGain?.disconnect();this.rainVolumeGain?.disconnect();
    this.airGain?.disconnect();this.waterGain?.disconnect();this.underwaterLowpass?.disconnect();
    this.underwaterRainLowpass?.disconnect();this.underwaterRainGain?.disconnect();
    const context=this.context;this.context=null;
    if(context&&context.state!=='closed')await context.close();
    this.debug.contextState='disposed';
  }

  private createGraph():void {
    const context=new AudioContext({latencyHint:'interactive'});this.context=context;
    const oceanBus=context.createGain(),rainBus=context.createGain();
    this.oceanVolumeGain=context.createGain();this.rainVolumeGain=context.createGain();
    this.oceanVolumeGain.gain.value=this.settings.oceanVolume*.78;
    this.rainVolumeGain.gain.value=this.settings.rainVolume*.68;
    oceanBus.connect(this.oceanVolumeGain);rainBus.connect(this.rainVolumeGain);

    this.airGain=context.createGain();this.waterGain=context.createGain();
    this.airGain.gain.value=1;this.waterGain.gain.value=0;
    const oceanAirGain=context.createGain();oceanAirGain.gain.value=1;
    this.oceanVolumeGain.connect(oceanAirGain).connect(this.airGain);
    this.underwaterLowpass=context.createBiquadFilter();
    this.underwaterLowpass.type='lowpass';this.underwaterLowpass.frequency.value=350;this.underwaterLowpass.Q.value=.55;
    const oceanWaterGain=context.createGain();oceanWaterGain.gain.value=.86;
    this.oceanVolumeGain.connect(this.underwaterLowpass).connect(oceanWaterGain).connect(this.waterGain);

    const rainAirGain=context.createGain();rainAirGain.gain.value=1;
    this.rainVolumeGain.connect(rainAirGain).connect(this.airGain);
    this.underwaterRainLowpass=context.createBiquadFilter();
    this.underwaterRainLowpass.type='lowpass';this.underwaterRainLowpass.frequency.value=260;this.underwaterRainLowpass.Q.value=.5;
    this.underwaterRainGain=context.createGain();this.underwaterRainGain.gain.value=.055;
    this.rainVolumeGain.connect(this.underwaterRainLowpass).connect(this.underwaterRainGain).connect(this.waterGain);

    this.masterGain=context.createGain();this.masterGain.gain.value=0;
    const compressor=context.createDynamicsCompressor();
    compressor.threshold.value=-10;compressor.knee.value=12;compressor.ratio.value=3;compressor.attack.value=.012;compressor.release.value=.24;
    this.airGain.connect(this.masterGain);this.waterGain.connect(this.masterGain);
    this.masterGain.connect(compressor).connect(context.destination);
    this.ocean=new OceanSoundGenerator(context,oceanBus);
    this.rain=new RainSoundGenerator(context,rainBus);
    this.debug.contextState=context.state;
  }

  private applyMasterGain():void {
    if(!this.context||!this.masterGain)return;
    const target=this.settings.enabled?this.settings.masterVolume*.52:0;
    this.schedule(this.masterGain.gain,target,this.context.currentTime,.045,'master',.0005);
  }

  private schedule(param:AudioParam|undefined,target:number,time:number,timeConstant:number,key:string,epsilon:number):void {
    if(!param)return;
    const previous=this.lastAutomation.get(key);
    if(previous!==undefined&&Math.abs(previous-target)<=epsilon)return;
    param.setTargetAtTime(target,time,timeConstant);this.lastAutomation.set(key,target);
  }
}

export function mapEnvironmentToAudio(environment:AudioEnvironment):MappedAudioEnvironment {
  const wind=clamp01(environment.windSpeed),swell=clamp01(environment.swellEnergy),wave=clamp01(environment.waveEnergy);
  const rain=clamp01(environment.rainIntensity),storm=clamp01(environment.stormIntensity);
  return {
    oceanRumble:clamp01(.15+swell*.46+wave*.3+storm*.08),
    oceanHiss:clamp01(.045+Math.pow(wind,.8)*.46+wave*.27+storm*.08),
    oceanSurge:clamp01(.2+swell*.58+wave*.2),
    oceanBrightness:clamp01(.18+wind*.56+storm*.2),
    rainBed:clamp01(Math.pow(rain,.72)*(.72+storm*.16)),
    rainDroplets:clamp01(Math.pow(rain,.9)*(.82+storm*.12)),
    rainBrightness:clamp01(.2+rain*.62+storm*.16),
  };
}

function clamp01(value:number):number{return clamp(value,0,1);}
function clamp(value:number,min:number,max:number):number{return Math.min(max,Math.max(min,value));}
function lerp(a:number,b:number,t:number):number{return a+(b-a)*t;}
function smoothstep(edge0:number,edge1:number,value:number):number{
  const t=clamp((value-edge0)/(edge1-edge0),0,1);return t*t*(3-2*t);
}
