import * as THREE from 'three';
import { EYE_M, MARCH_KMH } from '../core/travel';
import type { App } from './app';

/** Continuous terrain travel. Drag to look, click visible ground to march there. */
export class GroundTravel {
  enabled = false;
  destination: THREE.Vector2 | null = null;
  acceleration = 600;
  elapsedSeconds = 0;
  distanceKm = 0;
  message = '';
  private pointer: { x:number; y:number; lastX:number; lastY:number; dragged:boolean } | null = null;
  private euler = new THREE.Euler(0,0,0,'YXZ');
  private initialized = false;
  constructor(private app: App, canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', ev => {
      if (!this.enabled || app.settings.mapMode || ev.button !== 0) return;
      this.pointer = {x:ev.clientX,y:ev.clientY,lastX:ev.clientX,lastY:ev.clientY,dragged:false};
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener('pointermove', ev => {
      const p=this.pointer;
      if (!this.enabled || !p) return;
      if (Math.hypot(ev.clientX-p.x,ev.clientY-p.y)>4) p.dragged=true;
      if (p.dragged) {
        this.euler.setFromQuaternion(app.camera.quaternion,'YXZ');
        this.euler.y -= (ev.clientX-p.lastX)*0.003;
        this.euler.x=THREE.MathUtils.clamp(this.euler.x-(ev.clientY-p.lastY)*0.003,-1.5,1.5);
        app.camera.quaternion.setFromEuler(this.euler);
        app.invalidate();
      }
      p.lastX=ev.clientX;p.lastY=ev.clientY;
    });
    canvas.addEventListener('pointerup', ev => {
      const p=this.pointer;this.pointer=null;
      if (!this.enabled || !p || p.dragged) return;
      const r=canvas.getBoundingClientRect();
      const hit=app.pick((ev.clientX-r.left)/r.width*2-1,1-(ev.clientY-r.top)/r.height*2);
      if (hit) this.goTo(hit.x,hit.z); else this.message='Click visible ground to choose a destination.';
    });
    canvas.addEventListener('pointercancel',()=>{this.pointer=null;});
    window.addEventListener('blur',()=>this.stop('Travel paused.'));
    window.addEventListener('keydown',ev=>{if(this.enabled && ev.code==='Escape')this.stop('Travel paused.');});
  }
  enter() {
    this.app.freeFlight.setEnabled(false);
    this.app.setSettings({mapMode:false});
    this.app.controls.enabled=false;
    this.enabled=true;this.destination=null;this.message='';
    if (!this.initialized) {
      const city=this.app.world.features.find(f=>f.kind==='walled-city'&&f.pos);
      if(city?.pos) this.app.camera.position.set(city.pos[0]-(city.radiusKm??1.15)-0.06,0,city.pos[1]+0.08);
      const dir=new THREE.Vector3(-1,0,-0.05);
      this.app.camera.lookAt(this.app.camera.position.clone().add(dir));
      this.initialized=true;
    }
    this.placeCamera();
    this.app.invalidate();
  }
  leave(){this.enabled=false;this.destination=null;this.pointer=null;}
  reset(){this.leave();this.initialized=false;this.distanceKm=0;this.elapsedSeconds=0;}
  stop(message=''){this.destination=null;this.message=message;this.app.invalidate();}
  goTo(x:number,z:number) {
    if(!this.enabled || !Number.isFinite(x+z))return false;
    if(x<0||z<0||x>this.app.worldW||z>this.app.worldH){this.stop('Destination lies outside this region.');return false;}
    this.destination=new THREE.Vector2(x,z);this.message='Marching';this.app.invalidate();return true;
  }
  placeCamera() {
    const p=this.app.camera.position;
    const ground=this.app.terrain.surfaceHeightAt(p.x,p.z,(x,z)=>this.app.surfaceAt(x,z));
    p.y=(ground+EYE_M)*0.001*this.app.settings.exag;
  }
  update(dt:number):number {
    if(!this.enabled)return 0;
    this.placeCamera();
    if(!this.destination)return 0;
    const p=this.app.camera.position;
    let remaining=MARCH_KMH/3600*this.acceleration*Math.min(dt,0.05), walked=0;
    // Substeps prevent accelerated travel from jumping across cliffs or water.
    while(remaining>0 && this.destination) {
      const dx=this.destination.x-p.x,dz=this.destination.y-p.z,d=Math.hypot(dx,dz);
      if(d<0.0001){this.stop('Arrived');break;}
      let step=Math.min(remaining,d,0.005),x=p.x+dx/d*step,z=p.z+dz/d*step;
      let h=this.app.heightAt(x,z);const old=this.app.heightAt(p.x,p.z);
      if(this.app.surfaceAt(x,z)-h>0.3){this.stop('Water ahead — marching stopped.');break;}
      if(Math.abs(h-old)/(step*1000)>0.84){this.stop('Too steep — choose another approach.');break;}
      let length=Math.hypot(step,(h-old)/1000);
      if(length>remaining){step*=remaining/length;x=p.x+dx/d*step;z=p.z+dz/d*step;h=this.app.heightAt(x,z);length=Math.hypot(step,(h-old)/1000);}
      p.x=x;p.z=z;walked+=length;remaining-=length;
      if(step>=d-1e-9)this.stop('Arrived');
    }
    this.placeCamera();
    const seconds=walked/MARCH_KMH*3600;
    this.distanceKm+=walked;this.elapsedSeconds+=seconds;
    this.app.invalidate();
    return seconds;
  }
}
