import * as THREE from 'three';
import type { EnvironmentState } from '../environment/Environment';

const DAY = ['071522','0b2638','103f52','175b68','20777d','2e9491','4fb0a3','79c8b2','a9dcc2','d8e8c7','f8df9a','fff0bd','547b8d','315568','183747','0a202e'];
const DUSK = ['100f26','1d183d','30204d','4c2b58','70405c','9b5d62','c77b64','eaa06e','f3c58a','ffe4ad','ddd0c7','8d82a5','5c5684','34375f','202342','15182f'];
const NIGHT = ['030812','07111f','0b1b2b','10283a','173b4c','1f5060','316b75','4d8588','779d98','a8b9a5','c4c7aa','e3d7ad','31475b','1e344a','10243a','081629'];
const STORM = ['050a10','09141c','10222a','18333a','24464a','345a59','4c706a','69877d','8fa39a','bbc1b5','e0d8bd','9aa3a0','667579','3e5158','22343d','101f29'];

const parse = (hex: string): THREE.Color => new THREE.Color(`#${hex}`);

export class PaletteManager {
  readonly colors = Array.from({ length: 16 }, () => new THREE.Color());
  private readonly day = DAY.map(parse);
  private readonly dusk = DUSK.map(parse);
  private readonly night = NIGHT.map(parse);
  private readonly storm = STORM.map(parse);

  update(state: EnvironmentState): void {
    const daylight = Math.max(0, Math.sin(((state.timeOfDay - 6) / 24) * Math.PI * 2));
    const duskWindow = Math.max(0, 1 - Math.abs(state.timeOfDay - 18.2) / 3.2) + Math.max(0, 1 - Math.abs(state.timeOfDay - 5.8) / 2.2) * .55;
    for (let i = 0; i < 16; i++) {
      // English: A hand-authored palette is blended by solar phase and storm, preserving color relationships instead of posterizing RGB channels.
      // 日本語: RGB各成分を単純量子化せず、設計済みパレットを太陽位相と嵐で補間して色同士の関係を保つ。
      this.colors[i].copy(this.night[i]).lerp(this.day[i], daylight).lerp(this.dusk[i], Math.min(1, duskWindow * .9)).lerp(this.storm[i], state.stormIntensity * .88);
    }
  }
}
