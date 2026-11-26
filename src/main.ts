import './style.css';
import { OceanApp } from './core/OceanApp';

const host = document.querySelector<HTMLDivElement>('#app');
if (!host) throw new Error('Missing #app mount point');
const mountHost=host;
const status=document.querySelector<HTMLDivElement>('#app-status');
const notice=document.querySelector<HTMLDivElement>('#app-notice');
const controlsHelp=document.querySelector<HTMLElement>('#controls-help');
const controlsHelpClose=document.querySelector<HTMLButtonElement>('#controls-help-close');
let noticeTimer=0;
let app:OceanApp|null=null;
let fatalError=false;

function showFatalError(message:string):void {
  fatalError=true;
  if(!status)return;
  status.hidden=false;status.classList.add('error');status.textContent=message;
}

function showNotice(message:string):void {
  if(!notice)return;
  window.clearTimeout(noticeTimer);notice.textContent=message;notice.hidden=false;
  noticeTimer=window.setTimeout(()=>{notice.hidden=true;},3200);
}

function toggleControlsHelp():void {
  if(!controlsHelp)return;
  controlsHelp.hidden=!controlsHelp.hidden;
}

controlsHelpClose?.addEventListener('click',toggleControlsHelp);

function bootstrap():void {
  const probe=document.createElement('canvas');
  const probeContext=probe.getContext('webgl2');
  if(!probeContext){
    showFatalError('WebGL2 is unavailable. Portfolio v0.1 requires a WebGL2-capable browser and an enabled hardware-accelerated graphics driver.');
    return;
  }
  probeContext.getExtension('WEBGL_lose_context')?.loseContext();
  try{
    app=new OceanApp(mountHost,{toggleControlsHelp,notify:showNotice,reportFatalError:showFatalError});
    app.start();
    requestAnimationFrame(()=>{if(status&&!fatalError)status.hidden=true;});
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    showFatalError(`Ocean initialization failed: ${detail}`);
  }
}

bootstrap();

window.addEventListener('pagehide',(event)=>{
  if(event.persisted)return;
  window.clearTimeout(noticeTimer);
  controlsHelpClose?.removeEventListener('click',toggleControlsHelp);
  if(app)void app.dispose();
});
