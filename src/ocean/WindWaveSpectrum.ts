import * as THREE from 'three';

export const MAX_WIND_WAVES=20;

export interface WindWaveSpectrumSettings {
  mainWaveCount:number;
  peakWavelength:number;
  waveSeed:number;
}

const fract=(value:number):number=>value-Math.floor(value);

function seededSample(index:number,seed:number):number {
  return fract(Math.sin((index+1)*127.1+seed*31.7)*43758.5453123);
}

export class WindWaveSpectrum {
  readonly waves=Array.from({length:MAX_WIND_WAVES},()=>new THREE.Vector4());

  generate(settings:WindWaveSpectrumSettings):void {
    const count=THREE.MathUtils.clamp(Math.round(settings.mainWaveCount),4,MAX_WIND_WAVES);
    // English: With 700 / 240 world units between vertices, 20 m remains safely sampled while concentrating energy in readable mid-scale motion.
    // 日本語: 頂点間隔が 700 / 240 ワールド単位でも20 mなら安全に標本化でき、読み取りやすい中尺度運動へエネルギーを集中できる。
    const minimumWavelength=20;
    const maximumWavelength=56;
    const logMin=Math.log(minimumWavelength);
    const logRange=Math.log(maximumWavelength)-logMin;
    const logBandwidth=logRange/count;
    const peak=THREE.MathUtils.clamp(settings.peakWavelength,22,48);
    const sigma=.42;

    for(let i=0;i<MAX_WIND_WAVES;i++){
      if(i>=count){
        this.waves[i].set(1,0,0,0);
        continue;
      }
      // English: Spectrum energy, rather than a wavelength power law, determines the amplitude of every directional component.
      // 日本語: 各方向成分の振幅は波長の単純なべき乗ではなく、スペクトルエネルギーから決定する。
      // English: Stratified jitter in log-wavelength space covers several scales without a regular arithmetic sequence.
      // 日本語: 対数波長空間を層化してジッターを加え、規則的な等差列を作らず複数スケールを覆う。
      const stratum=(i+.12+.76*seededSample(i,settings.waveSeed+19))/count;
      const wavelength=Math.exp(logMin+stratum*logRange);
      const logDistance=Math.log(wavelength/peak);
      const wavelengthEnergy=Math.exp(-.5*(logDistance*logDistance)/(sigma*sigma));
      const signedOffset=seededSample(i+41,settings.waveSeed)*2-1;
      const amplitude=Math.sqrt(wavelengthEnergy*logBandwidth)*.52;
      const phase=seededSample(i+79,settings.waveSeed)*Math.PI*2;
      this.waves[i].set(wavelength,amplitude,signedOffset,phase);
    }
  }
}
