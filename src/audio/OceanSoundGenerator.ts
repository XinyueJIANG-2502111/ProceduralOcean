export interface OceanSoundParameters {
  rumble: number;
  broadNoise: number;
  surgeAmount: number;
  brightness: number;
}

export class OceanSoundGenerator {
  private readonly rumbleSource:AudioBufferSourceNode;
  private readonly broadSource:AudioBufferSourceNode;
  private readonly rumbleGain:GainNode;
  private readonly broadGain:GainNode;
  private readonly broadLowpass:BiquadFilterNode;
  private readonly washGain:GainNode;
  private readonly surgeGain:GainNode;
  private nextSurgeTime=0;
  private lastRumble=-1;
  private lastBroad=-1;
  private lastBrightness=-1;
  private lastSurgeAmount=.2;
  private disposed=false;

  constructor(private readonly context:AudioContext,destination:AudioNode) {
    this.rumbleSource=context.createBufferSource();
    this.rumbleSource.buffer=createSeamlessNoiseBuffer(context,13.7,'brown');
    this.rumbleSource.loop=true;
    const rumbleHighpass=context.createBiquadFilter();
    rumbleHighpass.type='highpass';rumbleHighpass.frequency.value=30;rumbleHighpass.Q.value=.4;
    const rumbleLowpass=context.createBiquadFilter();
    rumbleLowpass.type='lowpass';rumbleLowpass.frequency.value=185;rumbleLowpass.Q.value=.45;
    this.rumbleGain=context.createGain();this.rumbleGain.gain.value=0;

    this.broadSource=context.createBufferSource();
    this.broadSource.buffer=createSeamlessNoiseBuffer(context,17.3,'pink');
    this.broadSource.loop=true;
    const broadHighpass=context.createBiquadFilter();
    broadHighpass.type='highpass';broadHighpass.frequency.value=135;broadHighpass.Q.value=.45;
    this.broadLowpass=context.createBiquadFilter();
    this.broadLowpass.type='lowpass';this.broadLowpass.frequency.value=2450;this.broadLowpass.Q.value=.4;
    this.broadGain=context.createGain();this.broadGain.gain.value=0;
    const washBand=context.createBiquadFilter();
    washBand.type='bandpass';washBand.frequency.value=420;washBand.Q.value=.55;
    this.washGain=context.createGain();this.washGain.gain.value=0;
    this.surgeGain=context.createGain();this.surgeGain.gain.value=.72;

    this.rumbleSource.connect(rumbleHighpass).connect(rumbleLowpass).connect(this.rumbleGain).connect(this.surgeGain);
    this.broadSource.connect(broadHighpass).connect(this.broadLowpass).connect(this.broadGain).connect(this.surgeGain);
    // English: A broad low-mid wash keeps calm open water audible as moving water instead of leaving only sub-bass and wind-like hiss.
    // 日本語: 低中域の広い水音を加え、穏やかな外洋でも低音と風のようなノイズだけにならず、水の動きとして聞こえるようにする。
    this.broadSource.connect(washBand).connect(this.washGain).connect(this.surgeGain);
    this.surgeGain.connect(destination);
    this.rumbleSource.start();
    this.broadSource.start(.13);
    this.nextSurgeTime=context.currentTime+.5;
  }

  update(parameters:OceanSoundParameters):void {
    if(this.disposed)return;
    const now=this.context.currentTime;
    if(Math.abs(parameters.rumble-this.lastRumble)>.004){
      this.rumbleGain.gain.setTargetAtTime((.025+parameters.rumble*.29),now,.45);
      this.lastRumble=parameters.rumble;
    }
    if(Math.abs(parameters.broadNoise-this.lastBroad)>.004){
      this.broadGain.gain.setTargetAtTime((.008+parameters.broadNoise*.18),now,.32);
      this.washGain.gain.setTargetAtTime(.028+parameters.broadNoise*.13+parameters.rumble*.055,now,.5);
      this.lastBroad=parameters.broadNoise;
    }
    if(Math.abs(parameters.brightness-this.lastBrightness)>.01){
      this.broadLowpass.frequency.setTargetAtTime(1750+parameters.brightness*1800,now,.55);
      this.lastBrightness=parameters.brightness;
    }
    this.lastSurgeAmount=parameters.surgeAmount;
    if(now>=this.nextSurgeTime){
      const duration=3.2+Math.random()*4.8;
      const variation=(Math.random()-.5)*2;
      const target=.74+variation*(.08+this.lastSurgeAmount*.17);
      // English: Modulate the broadband ocean noise with a slow, non-periodic envelope to avoid a static wind-like sound.
      // 日本語: 広帯域の海洋ノイズをゆっくりとした非周期的な包絡で変調し、一定の風音のように聞こえることを防ぐ。
      this.surgeGain.gain.setTargetAtTime(clamp(target,.46,1.0),now,duration*.28);
      this.nextSurgeTime=now+duration;
    }
  }

  dispose():void {
    if(this.disposed)return;
    this.disposed=true;
    try{this.rumbleSource.stop();}catch{}
    try{this.broadSource.stop();}catch{}
    this.rumbleSource.disconnect();this.broadSource.disconnect();
    this.rumbleGain.disconnect();this.broadGain.disconnect();this.broadLowpass.disconnect();this.washGain.disconnect();this.surgeGain.disconnect();
  }
}

export function createSeamlessNoiseBuffer(context:AudioContext,duration:number,color:'white'|'pink'|'brown'):AudioBuffer {
  const sampleRate=context.sampleRate;
  const length=Math.max(2048,Math.floor(duration*sampleRate));
  const overlap=Math.min(Math.floor(sampleRate*.8),Math.floor(length*.12));
  const raw=new Float32Array(length+overlap);
  let pink0=0,pink1=0,pink2=0,brown=0;
  for(let i=0;i<raw.length;i++){
    const white=Math.random()*2-1;
    pink0=.99765*pink0+white*.099046;
    pink1=.963*pink1+white*.2965164;
    pink2=.57*pink2+white*1.0526913;
    brown=(brown+white*.022)/1.022;
    raw[i]=color==='white'?white:color==='pink'?(pink0+pink1+pink2+white*.1848)*.17:brown*2.4;
  }
  const buffer=context.createBuffer(1,length,sampleRate);
  const output=buffer.getChannelData(0);
  output.set(raw.subarray(0,length));
  // English: Crossfade a continuation of the tail into the beginning so the fixed buffer can loop without an impulse at its seam.
  // 日本語: 固定バッファの継ぎ目にインパルスが出ないよう、末尾の連続部分を先頭へクロスフェードする。
  for(let i=0;i<overlap;i++){
    const x=i/Math.max(overlap-1,1),t=x*x*(3-2*x);
    output[i]=raw[length+i]*(1-t)+raw[i]*t;
  }
  return buffer;
}

function clamp(value:number,min:number,max:number):number{return Math.min(max,Math.max(min,value));}
