import './style.css';
import { OceanApp } from './core/OceanApp';
import { pageText, type Locale, type PageMessage } from './ui/translations';

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
let locale:Locale='en';
type Message={key:PageMessage;detail?:string};
let statusMessage:Message={key:'initializing'};
let noticeMessage:Message|null=null;

function messageText(message:Message):string {
  const text=pageText(message.key,locale);
  return message.detail?text+' ('+message.detail+')':text;
}

function setLanguage(next:Locale):void {
  locale=next;
  document.documentElement.lang=locale;
  for(const element of document.querySelectorAll<HTMLElement>('[data-i18n]')){
    const message=pageText(element.dataset.i18n as PageMessage,locale);
    const parts=message.split(/(\{[WSH]\})/g);
    element.replaceChildren(...parts.map(part=>{
      if(!/^\{[WSH]\}$/.test(part))return part;
      const key=document.createElement('kbd');
      key.textContent=part[1];
      return key;
    }));
  }
  controlsHelpClose?.setAttribute('aria-label',pageText('closeControls',locale));
  if(status)status.textContent=messageText(statusMessage);
  if(notice&&noticeMessage)notice.textContent=messageText(noticeMessage);
}

function showFatalError(key:PageMessage,detail?:string):void {
  fatalError=true;
  statusMessage={key,detail};
  if(!status)return;
  status.hidden=false;status.classList.add('error');status.textContent=messageText(statusMessage);
}

function showContextLost():void {
  if(!status||fatalError)return;
  statusMessage={key:'contextLost'};
  status.textContent=messageText(statusMessage);
  status.hidden=false;
}

function hideRenderStatus():void {
  if(status&&!fatalError)status.hidden=true;
}

function showNotice(key:PageMessage,detail?:string):void {
  if(!notice)return;
  noticeMessage={key,detail};
  window.clearTimeout(noticeTimer);notice.textContent=messageText(noticeMessage);notice.hidden=false;
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
    showFatalError('webglUnavailable');
    return;
  }
  probeContext.getExtension('WEBGL_lose_context')?.loseContext();
  try{
    app=new OceanApp(mountHost,{toggleControlsHelp,notify:showNotice,reportFatalError:showFatalError,onContextLost:showContextLost,onFirstFrame:hideRenderStatus,onLanguageChange:setLanguage});
    app.start();
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    showFatalError('initializationFailed',detail);
  }
}

bootstrap();

window.addEventListener('pagehide',(event)=>{
  if(event.persisted)return;
  window.clearTimeout(noticeTimer);
  controlsHelpClose?.removeEventListener('click',toggleControlsHelp);
  if(app)void app.dispose();
});
