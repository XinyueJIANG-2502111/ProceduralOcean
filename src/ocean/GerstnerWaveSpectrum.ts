import * as THREE from 'three';

export const MAX_SWELL_WAVES=6;

export interface SwellSpectrumSettings {
  swellCount:number;
  waveSeed:number;
}

const fract=(value:number):number=>value-Math.floor(value);

function seededSample(index:number,seed:number):number {
  return fract(Math.sin((index+1)*91.345+seed*12.9898)*43758.5453);
}

export class SwellSpectrum {
  readonly waves=Array.from({length:MAX_SWELL_WAVES},()=>new THREE.Vector4());
  readonly shapes=Array.from({length:MAX_SWELL_WAVES},()=>new THREE.Vector2());

  generate(settings:SwellSpectrumSettings):void {
    const count=THREE.MathUtils.clamp(Math.round(settings.swellCount),1,MAX_SWELL_WAVES);
    const minWavelength=46;
    const maxWavelength=145;
    const logMin=Math.log(minWavelength);
    const logRange=Math.log(maxWavelength)-logMin;
    const logBandwidth=logRange/count;
    const peakWavelength=82;
    const sigma=.43;

    for(let i=0;i<MAX_SWELL_WAVES;i++){
      if(i>=count){
        this.waves[i].set(1,0,0,0);
        this.shapes[i].set(0,0);
        continue;
      }
      // English: Jittered log-space strata avoid harmonic wavelength ratios while keeping every refresh deterministic.
      // 日本語: ジッター付き対数空間層化により、更新ごとの再現性を保ちながら波長の倍音関係を避ける。
      const stratum=(i+.18+.64*seededSample(i,settings.waveSeed))/count;
      const wavelength=Math.exp(logMin+stratum*logRange);
      const logDistance=Math.log(wavelength/peakWavelength);
      const spectralEnergy=Math.exp(-.5*(logDistance*logDistance)/(sigma*sigma));
      const amplitude=Math.sqrt(spectralEnergy*logBandwidth)*.72;
      const directionOffset=(seededSample(i+17,settings.waveSeed)*2-1)*.24;
      const phase=seededSample(i+37,settings.waveSeed)*Math.PI*2;
      const steepness=.48+.2*seededSample(i+53,settings.waveSeed);
      this.waves[i].set(wavelength,amplitude,directionOffset,phase);
      this.shapes[i].set(steepness,0);
    }
  }
}
