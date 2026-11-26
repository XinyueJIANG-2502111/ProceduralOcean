import * as THREE from 'three';

interface Ripple { x: number; z: number; age: number; strength: number }

export class RippleSimulation {
  static readonly capacity = 32;
  readonly data = Array.from({ length: RippleSimulation.capacity }, () => new THREE.Vector4(0, 0, 99, 0));
  private readonly ripples: Ripple[] = [];

  addImpact(x: number, z: number, strength = 1): void {
    if (this.ripples.length >= RippleSimulation.capacity) this.ripples.shift();
    this.ripples.push({ x, z, age: 0, strength });
  }

  update(dt: number): void {
    for (const ripple of this.ripples) ripple.age += dt;
    while (this.ripples[0]?.age > 4.6) this.ripples.shift();
    for (let i = 0; i < RippleSimulation.capacity; i++) {
      const ripple = this.ripples[i];
      this.data[i].set(ripple?.x ?? 0, ripple?.z ?? 0, ripple?.age ?? 99, ripple?.strength ?? 0);
    }
  }
}
