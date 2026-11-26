import * as THREE from 'three';
import type { EnvironmentController } from '../environment/Environment';
import type { RippleSimulation } from '../ocean/RippleSimulation';

const MAX_DROPS = 2600;

export class RainSystem {
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(MAX_DROPS * 3);
  private readonly speeds = new Float32Array(MAX_DROPS);
  private accumulator = 0;

  constructor(private readonly environment: EnvironmentController, private readonly ripples: RippleSimulation) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({ color: 0xc3ded8, size: .075, transparent: true, opacity: .58, depthWrite: false, blending: THREE.NormalBlending });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    for (let i=0;i<MAX_DROPS;i++) this.reset(i, new THREE.Vector3());
  }

  private reset(index:number, center:THREE.Vector3):void {
    const i=index*3;
    this.positions[i]=center.x+(Math.random()-.5)*70;
    this.positions[i+1]=8+Math.random()*32;
    this.positions[i+2]=center.z+(Math.random()-.5)*70;
    this.speeds[index]=22+Math.random()*18;
  }

  update(dt:number,camera:THREE.Camera):void {
    const s=this.environment.state;
    const count=Math.floor(MAX_DROPS*Math.pow(s.precipitation,1.25));
    this.points.geometry.setDrawRange(0,count);
    const windX=Math.cos(s.windDirection)*s.windSpeed*9;
    const windZ=Math.sin(s.windDirection)*s.windSpeed*9;
    this.accumulator=Math.min(this.accumulator+dt*s.precipitation*(1.4+8.6*Math.pow(s.precipitation,.72)),3);
    for(let n=0;n<count;n++){
      const i=n*3; this.positions[i+1]-=this.speeds[n]*dt; this.positions[i]+=windX*dt; this.positions[i+2]+=windZ*dt;
      if(this.positions[i+1]<.15){
        if(this.accumulator>=1){
          this.accumulator-=1;
          this.ripples.addImpact(this.positions[i],this.positions[i+2],.38+Math.random()*.5);
        }
        this.reset(n,camera.position);
      }
    }
    // English: Budget visible impacts so the 32 ripple slots preserve complete lifetimes instead of replacing every ring after a few frames.
    // 日本語: 32個の波紋スロットで寿命全体を保てるよう、可視着水の生成量を制限し、数フレームでリングが置き換わらないようにする。
    while(this.accumulator>1){
      this.accumulator-=1;
      this.ripples.addImpact(camera.position.x+(Math.random()-.5)*38,camera.position.z+(Math.random()-.5)*38,.38+Math.random()*.5);
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;
    (this.points.material as THREE.PointsMaterial).opacity=.35+s.precipitation*.4;
  }

  dispose():void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
