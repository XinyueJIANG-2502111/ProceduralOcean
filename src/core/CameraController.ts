import * as THREE from 'three';

const MAX_PITCH=Math.PI*.495;

export class CameraController {
  yaw:number;
  pitch:number;
  moveSpeed=12;
  yawSensitivity=.004;
  pitchSensitivity=.004;
  verticalDragSensitivity=.045;

  private leftDragging=false;
  private rightDragging=false;
  private activePointerId:number|null=null;
  private keyW=false;
  private keyS=false;
  private readonly horizontalForward=new THREE.Vector3();

  constructor(
    private readonly camera:THREE.PerspectiveCamera,
    private readonly canvas:HTMLCanvasElement,
    yaw=.665,
    pitch=-.315,
    private readonly onHeightChange?:(height:number)=>void,
  ){
    this.yaw=yaw;
    this.pitch=pitch;
    this.camera.rotation.order='YXZ';
    this.canvas.tabIndex=0;
    this.canvas.addEventListener('pointerdown',this.onPointerDown);
    this.canvas.addEventListener('pointermove',this.onPointerMove);
    this.canvas.addEventListener('pointerup',this.onPointerEnd);
    this.canvas.addEventListener('pointercancel',this.onPointerEnd);
    this.canvas.addEventListener('pointerleave',this.onPointerLeave);
    this.canvas.addEventListener('lostpointercapture',this.onLostPointerCapture);
    this.canvas.addEventListener('contextmenu',this.onContextMenu);
    window.addEventListener('keydown',this.onKeyDown);
    window.addEventListener('keyup',this.onKeyUp);
    window.addEventListener('blur',this.onWindowBlur);
    this.applyRotation();
  }

  update(deltaTime:number):void {
    this.applyRotation();
    const input=Number(this.keyW)-Number(this.keyS);
    if(input===0)return;
    // English: Horizontal movement follows yaw only so looking up or down never changes camera height or movement speed.
    // 日本語: 上下を見てもカメラ高度や移動速度が変わらないよう、水平移動にはヨー角だけを使用する。
    this.horizontalForward.set(-Math.sin(this.yaw),0,-Math.cos(this.yaw));
    this.camera.position.addScaledVector(this.horizontalForward,input*this.moveSpeed*deltaTime);
  }

  setTransform(position:THREE.Vector3,yaw:number,pitch:number):void {
    this.camera.position.copy(position);
    this.yaw=yaw;
    this.pitch=THREE.MathUtils.clamp(pitch,-MAX_PITCH,MAX_PITCH);
    this.applyRotation();
  }

  dispose():void {
    this.canvas.removeEventListener('pointerdown',this.onPointerDown);
    this.canvas.removeEventListener('pointermove',this.onPointerMove);
    this.canvas.removeEventListener('pointerup',this.onPointerEnd);
    this.canvas.removeEventListener('pointercancel',this.onPointerEnd);
    this.canvas.removeEventListener('pointerleave',this.onPointerLeave);
    this.canvas.removeEventListener('lostpointercapture',this.onLostPointerCapture);
    this.canvas.removeEventListener('contextmenu',this.onContextMenu);
    window.removeEventListener('keydown',this.onKeyDown);
    window.removeEventListener('keyup',this.onKeyUp);
    window.removeEventListener('blur',this.onWindowBlur);
  }

  private applyRotation():void {
    this.pitch=THREE.MathUtils.clamp(this.pitch,-MAX_PITCH,MAX_PITCH);
    this.yaw=THREE.MathUtils.euclideanModulo(this.yaw+Math.PI,Math.PI*2)-Math.PI;
    this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
  }

  private readonly onPointerDown=(event:PointerEvent):void=>{
    if(event.button!==0&&event.button!==2)return;
    event.preventDefault();
    this.canvas.focus({preventScroll:true});
    this.activePointerId=event.pointerId;
    if(event.button===0)this.leftDragging=true;
    if(event.button===2)this.rightDragging=true;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove=(event:PointerEvent):void=>{
    if(this.activePointerId!==event.pointerId)return;
    if(this.leftDragging){
      // English: One left-button gesture owns both look axes, matching a free editor viewport without introducing roll.
      // 日本語: ロールを発生させず、編集ビューポートの自由視点と同様に左ドラッグ一つで両方の視線軸を操作する。
      this.yaw-=event.movementX*this.yawSensitivity;
      this.pitch-=event.movementY*this.pitchSensitivity;
    }
    if(this.rightDragging){
      // English: Vertical right-drag translates the camera in world Y; dragging up rises and dragging down dives.
      // 日本語: 右ドラッグの上下入力をワールドY移動に変換し、上へドラッグすると上昇、下へドラッグすると潜降する。
      this.camera.position.y-=event.movementY*this.verticalDragSensitivity;
      this.onHeightChange?.(this.camera.position.y);
    }
  };

  private readonly onPointerEnd=(event:PointerEvent):void=>{
    if(this.activePointerId!==event.pointerId)return;
    if(event.type==='pointercancel'){this.clearPointerState();return;}
    if(event.button===0)this.leftDragging=false;
    if(event.button===2)this.rightDragging=false;
    if(this.leftDragging||this.rightDragging)return;
    if(this.canvas.hasPointerCapture(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);
    this.activePointerId=null;
  };

  private readonly onPointerLeave=(event:PointerEvent):void=>{
    if(this.activePointerId!==event.pointerId)return;
    this.clearPointerState();
  };

  private readonly onLostPointerCapture=(event:PointerEvent):void=>{
    if(this.activePointerId!==event.pointerId)return;
    this.leftDragging=false;
    this.rightDragging=false;
    this.activePointerId=null;
  };

  private readonly onContextMenu=(event:MouseEvent):void=>event.preventDefault();

  private readonly onKeyDown=(event:KeyboardEvent):void=>{
    if(isEditableTarget(event.target))return;
    if(event.code==='KeyW'){this.keyW=true;event.preventDefault();}
    if(event.code==='KeyS'){this.keyS=true;event.preventDefault();}
  };

  private readonly onKeyUp=(event:KeyboardEvent):void=>{
    if(event.code==='KeyW')this.keyW=false;
    if(event.code==='KeyS')this.keyS=false;
  };

  private readonly onWindowBlur=():void=>{
    this.keyW=false;
    this.keyS=false;
    this.clearPointerState();
  };

  private clearPointerState():void {
    const pointerId=this.activePointerId;
    this.leftDragging=false;
    this.rightDragging=false;
    this.activePointerId=null;
    if(pointerId!==null&&this.canvas.hasPointerCapture(pointerId))this.canvas.releasePointerCapture(pointerId);
  }
}

function isEditableTarget(target:EventTarget|null):boolean {
  return target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement||(target instanceof HTMLElement&&target.isContentEditable);
}
