import { createSeamlessNoiseBuffer } from './OceanSoundGenerator';

export interface RainSoundParameters {
  bed: number;
  droplets: number;
  brightness: number;
}

interface DropletVoice {
  noise:AudioBufferSourceNode;
  tone:OscillatorNode;
  filter:BiquadFilterNode;
  gain:GainNode;
  busyUntil:number;
}

export class RainSoundGenerator {
  private readonly bedSource:AudioBufferSourceNode;
  private readonly bedGain:GainNode;
  private readonly bedHighpass:BiquadFilterNode;
  private readonly bedLowpass:BiquadFilterNode;
  private readonly bedTextureGain:GainNode;
  private readonly voices:DropletVoice[]=[];
  private nextDropTime=0;
  private nextTextureTime=0;
  private lastBed=-1;
  private lastBrightness=-1;
  private disposed=false;

  constructor(private readonly context:AudioContext,destination:AudioNode) {
    this.bedSource=context.createBufferSource();
    this.bedSource.buffer=createRainTextureBuffer(context,17.1);
    this.bedSource.loop=true;
    this.bedHighpass=context.createBiquadFilter();
    this.bedHighpass.type='highpass';this.bedHighpass.frequency.value=520;this.bedHighpass.Q.value=.3;
    this.bedLowpass=context.createBiquadFilter();
    this.bedLowpass.type='lowpass';this.bedLowpass.frequency.value=6400;this.bedLowpass.Q.value=.25;
    this.bedGain=context.createGain();this.bedGain.gain.value=0;
    this.bedTextureGain=context.createGain();this.bedTextureGain.gain.value=.92;
    this.bedSource.connect(this.bedHighpass).connect(this.bedLowpass).connect(this.bedGain).connect(this.bedTextureGain).connect(destination);
    this.bedSource.start(.27);

    const dropletBuffer=createSeamlessNoiseBuffer(context,2.7,'white');
    for(let i=0;i<16;i++){
      const noise=context.createBufferSource();noise.buffer=dropletBuffer;noise.loop=true;
      const tone=context.createOscillator();tone.type='sine';tone.frequency.value=700;
      const filter=context.createBiquadFilter();filter.type='bandpass';filter.Q.value=.52;
      const noiseLevel=context.createGain();noiseLevel.gain.value=.72;
      const toneLevel=context.createGain();toneLevel.gain.value=.22;
      const gain=context.createGain();gain.gain.value=.000001;
      noise.connect(filter).connect(noiseLevel).connect(gain);
      tone.connect(toneLevel).connect(gain).connect(destination);
      noise.start(i*.071);tone.start();
      this.voices.push({noise,tone,filter,gain,busyUntil:0});
    }
    this.nextDropTime=context.currentTime+.2;
    this.nextTextureTime=context.currentTime+.35;
  }

  update(parameters:RainSoundParameters,active:boolean):void {
    if(this.disposed)return;
    const now=this.context.currentTime;
    if(Math.abs(parameters.bed-this.lastBed)>.004){
      this.bedGain.gain.setTargetAtTime(parameters.bed*.135,now,.28);
      this.lastBed=parameters.bed;
    }
    if(Math.abs(parameters.brightness-this.lastBrightness)>.01){
      this.bedHighpass.frequency.setTargetAtTime(440+parameters.brightness*320,now,.4);
      this.bedLowpass.frequency.setTargetAtTime(5200+parameters.brightness*2600,now,.45);
      this.lastBrightness=parameters.brightness;
    }
    if(now>=this.nextTextureTime){
      // English: Slowly vary the rain bed so it reads as many impacts on water rather than a stationary electrical noise floor.
      // 日本語: 雨の基礎音をゆっくり不規則に変化させ、一定の電気ノイズではなく水面への多数の衝突として聞こえるようにする。
      this.bedTextureGain.gain.setTargetAtTime(.84+Math.random()*.18,now,.18+Math.random()*.2);
      this.nextTextureTime=now+.32+Math.random()*.72;
    }
    if(!active||parameters.droplets<.008){this.nextDropTime=now+.18;return;}
    const rate=.8+parameters.droplets*28;
    let emitted=0;
    while(now>=this.nextDropTime&&emitted<4){
      this.triggerDroplet(this.nextDropTime,parameters.droplets);
      const randomInterval=-Math.log(Math.max(1e-4,1-Math.random()))/rate;
      this.nextDropTime+=clamp(randomInterval,.025,1.25);
      emitted++;
    }
    if(this.nextDropTime<now-.1)this.nextDropTime=now+.04;
  }

  private triggerDroplet(time:number,intensity:number):void {
    let voice=this.voices[0];
    for(const candidate of this.voices)if(candidate.busyUntil<voice.busyUntil)voice=candidate;
    if(voice.busyUntil>time+.015)return;
    const attack=.001+Math.random()*.002;
    const decay=.035+Math.random()*.075;
    const peak=(.01+Math.random()*.021)*(.4+intensity*.6);
    const toneFrequency=520+Math.random()*980;
    voice.noise.playbackRate.setValueAtTime(.78+Math.random()*.48,time);
    voice.filter.frequency.setValueAtTime(1100+Math.random()*4300,time);
    voice.tone.frequency.cancelScheduledValues(time);
    voice.tone.frequency.setValueAtTime(toneFrequency,time);
    voice.tone.frequency.exponentialRampToValueAtTime(toneFrequency*(.42+Math.random()*.18),time+decay);
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setValueAtTime(.000001,time);
    voice.gain.gain.linearRampToValueAtTime(peak,time+attack);
    voice.gain.gain.exponentialRampToValueAtTime(.000001,time+attack+decay);
    voice.busyUntil=time+attack+decay+.01;
  }

  dispose():void {
    if(this.disposed)return;
    this.disposed=true;
    try{this.bedSource.stop();}catch{}
    this.bedSource.disconnect();this.bedGain.disconnect();this.bedHighpass.disconnect();this.bedLowpass.disconnect();this.bedTextureGain.disconnect();
    for(const voice of this.voices){
      try{voice.noise.stop();}catch{}
      try{voice.tone.stop();}catch{}
      voice.noise.disconnect();voice.tone.disconnect();voice.filter.disconnect();voice.gain.disconnect();
    }
    this.voices.length=0;
  }
}

function createRainTextureBuffer(context:AudioContext,duration:number):AudioBuffer {
  const sampleRate=context.sampleRate;
  const length=Math.max(4096,Math.floor(duration*sampleRate));
  const overlap=Math.min(Math.floor(sampleRate*1.1),Math.floor(length*.1));
  const raw=new Float32Array(length+overlap);
  let burst=0;
  let density=.72;
  let densityTarget=.72;
  let nextDensityChange=0;
  let peak=1e-6;
  for(let i=0;i<raw.length;i++){
    if(i>=nextDensityChange){
      densityTarget=.55+Math.random()*.85;
      nextDensityChange=i+Math.floor(sampleRate*(.08+Math.random()*.22));
    }
    density+=(densityTarget-density)*.0007;
    // English: Build the rain bed from many short stochastic impact bursts instead of a continuous white-noise floor.
    // 日本語: 連続したホワイトノイズではなく、多数の短い確率的な衝突バーストから雨の基礎音を作る。
    if(Math.random()<.0048*density)burst+=.18+Math.random()*.68;
    burst*=.982;
    const carrier=Math.random()*2-1;
    const sample=Math.tanh(carrier*burst*.72);
    raw[i]=sample;
    peak=Math.max(peak,Math.abs(sample));
  }
  const buffer=context.createBuffer(1,length,sampleRate);
  const output=buffer.getChannelData(0);
  const scale=.72/peak;
  for(let i=0;i<length;i++)output[i]=raw[i]*scale;
  for(let i=0;i<overlap;i++){
    const x=i/Math.max(overlap-1,1),t=x*x*(3-2*x);
    output[i]=(raw[length+i]*(1-t)+raw[i]*t)*scale;
  }
  return buffer;
}

function clamp(value:number,min:number,max:number):number{return Math.min(max,Math.max(min,value));}
