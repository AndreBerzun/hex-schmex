import * as THREE from 'three';

const FLIGHT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'Space', 'ShiftLeft', 'ShiftRight']);

/** Pointer-locked inspection camera; positions and speeds are in scene kilometres. */
export class FreeFlight {
  enabled = false;
  speed = 0.03;
  private keys = new Set<string>();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private move = new THREE.Vector3();
  onChange = () => {};
  get locked() { return document.pointerLockElement === this.canvas; }

  constructor(private camera: THREE.PerspectiveCamera, private canvas: HTMLCanvasElement, private invalidate: () => void) {
    canvas.addEventListener('click', () => {
      if (this.enabled && !this.locked) void this.canvas.requestPointerLock()?.catch(() => this.onChange());
    });
    document.addEventListener('pointerlockchange', () => {
      // A delayed acquisition notification must not erase the first keydown.
      if (!this.locked) this.keys.clear();
      this.onChange();
    });
    document.addEventListener('mousemove', (ev) => {
      if (!this.enabled || !this.locked) return;
      this.euler.setFromQuaternion(camera.quaternion, 'YXZ');
      this.euler.y -= ev.movementX * 0.002;
      this.euler.x = THREE.MathUtils.clamp(this.euler.x - ev.movementY * 0.002, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      camera.quaternion.setFromEuler(this.euler);
      invalidate();
    });
    window.addEventListener('keydown', (ev) => {
      if (!this.enabled || !this.locked) return;
      // Ctrl/Command/Alt belong to browser and desktop shortcuts. In particular,
      // Ctrl+W and Ctrl+Shift+W can close a tab/window even under pointer lock.
      if (ev.ctrlKey || ev.metaKey || ev.altKey) { this.keys.clear(); return; }
      if (!FLIGHT_KEYS.has(ev.code)) return;
      ev.preventDefault();
      this.keys.add(ev.code);
    });
    window.addEventListener('keyup', (ev) => { this.keys.delete(ev.code); });
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.keys.clear(); });
  }
  setEnabled(value: boolean) {
    this.enabled = value;
    this.release();
    this.onChange();
  }
  release() {
    this.keys.clear();
    if (this.locked) document.exitPointerLock();
  }
  update(dt: number): boolean {
    if (!this.enabled || !this.locked || this.keys.size === 0) return false;
    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.camera.up).normalize();
    this.move.set(0, 0, 0);
    if (this.keys.has('KeyW')) this.move.add(this.forward);
    if (this.keys.has('KeyS')) this.move.sub(this.forward);
    if (this.keys.has('KeyD')) this.move.add(this.right);
    if (this.keys.has('KeyA')) this.move.sub(this.right);
    if (this.keys.has('Space')) this.move.y += 1;
    if (this.keys.has('KeyC')) this.move.y -= 1;
    if (this.move.lengthSq() === 0) return false;
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 10 : 1;
    this.camera.position.addScaledVector(this.move.normalize(), this.speed * boost * Math.min(dt, 0.05));
    this.invalidate();
    return true;
  }
}
