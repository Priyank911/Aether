import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecReport } from '@aether/codemode';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

async function until<T>(probe:()=>Promise<T>,ready:(value:T)=>boolean):Promise<T>{
  const deadline=Date.now()+12000;
  let value=await probe();
  while(Date.now()<deadline){value=await probe();if(ready(value))return value;await new Promise(resolve=>setTimeout(resolve,40));}
  throw new Error(`Keyboard flow did not settle: ${JSON.stringify(value)}`);
}

describe('Native keyboard-only decision flow',()=>{
  let app:DesktopApp;
  const evaluate=<T>(expression:string)=>app.request<T>('shellEval',{expression});
  const key=async(keyCode:string,modifiers?:string[])=>{
    await app.request('shellInput',{event:{type:'keyDown',keyCode,modifiers}});
    if (keyCode === 'Enter') await app.request('shellInput',{event:{type:'char',keyCode:String.fromCharCode(13)}});
    await app.request('shellInput',{event:{type:'keyUp',keyCode,modifiers}});
  };
  beforeAll(async()=>{app=await startDesktop({keepHome:true});await until(()=>evaluate<boolean>("Boolean(document.querySelector('.toolbar'))"),Boolean);},60000);
  afterAll(async()=>{await app?.close();});

  it('keeps Memory in the side panel and answers a live question without pointer input',async()=>{
    const running=app.request<ExecReport>('exec',{space:'Keyboard review',thought:'Ask the person for a destination',code:"const answer=await space.ask('Which destination should I use?');return {reply:answer.reply};"});
    await until(()=>app.request<{spaces:Array<{id:string}>}>('state'),state=>state.spaces.some(space=>space.id==='keyboard-review'));
    await app.request('showSpace',{spaceId:'keyboard-review'});
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.decision-card textarea'))"),Boolean);
    expect(await evaluate<string>("document.querySelector('.side-panel').tagName")).toBe('ASIDE');
    expect(await evaluate<string>("document.querySelector('.decision-card').getAttribute('role')")).toBe('dialog');
    expect(await evaluate<boolean>("Boolean(document.getElementById(document.querySelector('.decision-card').getAttribute('aria-labelledby'))?.textContent)")).toBe(true);
    expect(await evaluate<boolean>("Boolean(document.querySelector('.memory-panel'))")).toBe(true);
    expect(await evaluate<boolean>("Boolean(document.querySelector('.side-panel .milestones, .side-panel [role=tablist]'))")).toBe(false);
    await until(()=>evaluate<string>('document.activeElement.textContent'),text=>text==='Send answer');

    await key('Tab',['shift']);
    await until(()=>evaluate<string>('document.activeElement.tagName'),tag=>tag==='TEXTAREA');
    let prefix='';
    for(const keyCode of 'Pune'){
      await app.request('shellInput',{event:{type:'char',keyCode}});
      prefix+=keyCode;
      await until(()=>evaluate<string>("document.querySelector('.decision-card textarea').value"),value=>value===prefix);
    }
    await key('Tab');
    await until(()=>evaluate<string>('document.activeElement.textContent'),text=>text==='Send answer');

    await key('Enter');
    await until(()=>evaluate<{present:boolean;error:string}>("({present:Boolean(document.querySelector('.decision-card')),error:document.querySelector('.panel-error')?.textContent??''})"),value=>!value.present);
    let report=await running;

    for(let attempt=0;report.outcome.status==='held'&&attempt<5;attempt++)report=await app.request<ExecReport>('exec',{space:'Keyboard review',thought:'Collect the answer',wait:report.outcome.token});
    expect(report.outcome.status).toBe('complete');
    if(report.outcome.status==='complete')expect(JSON.parse(report.outcome.json??'{}')).toEqual({reply:'Pune'});
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.decision-card'))"),value=>!value);
    await key('\\',['control']);
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.side-panel'))"),value=>!value);
  },60000);
});
