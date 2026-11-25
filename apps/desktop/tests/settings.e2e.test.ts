import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecReport } from '@aether/codemode';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

async function until<T>(probe: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline=Date.now()+12000;
  let value=await probe();
  while(Date.now()<deadline){value=await probe();if(ready(value))return value;await new Promise(resolve=>setTimeout(resolve,50));}
  throw new Error(`Settings did not settle: ${JSON.stringify(value)}`);
}
describe('Settings in the trusted shell',()=>{
  let app:DesktopApp;
  const evaluate=<T>(expression:string)=>app.request<T>('shellEval',{expression});
  const send=(command:object)=>evaluate<{ok:boolean;error?:string}>(`window.aether.send(${JSON.stringify(command)})`);
  beforeAll(async()=>{app=await startDesktop({keepHome:true});await until(()=>evaluate<boolean>("Boolean(document.querySelector('.toolbar'))"),Boolean);},60000);
  afterAll(async()=>{await app?.close();});

  it('does not create config.json on startup and rejects settings writes outside Settings',async()=>{
    expect(existsSync(path.join(app.home,'config.json'))).toBe(false);
    const result=await send({type:'settings.save',settings:{cookieBanners:'accept',minFreeMemoryRatio:.3,memoryEnabled:false}});
    expect(result.ok).toBe(false);
    expect(existsSync(path.join(app.home,'config.json'))).toBe(false);
  });
  it('opens a real Settings tab, saves person-edited values and shares memory state with the panel',async()=>{
    await send({type:'settings.open'});
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.settings-page'))"),Boolean);
    expect(await evaluate<string>("document.querySelector('#cookie-preference').value")).toBe('reject');
    expect(await evaluate<string>("document.querySelector('#memory-reserve').value")).toBe('20');
    await evaluate("(()=>{const select=document.querySelector('#cookie-preference');select.value='off';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#memory-reserve').focus();})()");
    // This suite checks editing/persistence; native keyboard flow is covered in a11y.e2e.
    await evaluate("(()=>{const input=document.querySelector('#memory-reserve');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'30');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await until(()=>evaluate<string>("document.querySelector('#memory-reserve').value"),(value)=>value==='30');
    await evaluate("document.querySelector('.settings-checkbox input').click()");
    await evaluate("document.querySelector('.settings-actions button').click()");
    await until(()=>evaluate<string>("document.querySelector('.settings-actions [role=status]').textContent"),(value)=>value.includes('Settings saved'));
    expect(JSON.parse(readFileSync(path.join(app.home,'config.json'),'utf8'))).toEqual({cookieBanners:'off',minFreeMemoryRatio:.3});
    await send({type:'panel.toggle',open:true});
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.memory-panel'))"),Boolean);
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.memory-toggle input:not(:disabled)'))"),Boolean);
    expect(await evaluate<boolean>("document.querySelector('.memory-toggle input').checked")).toBe(false);
    await send({type:'panel.toggle',open:false});
  });
  it('keeps remote pages unprivileged and agents cannot open or edit Settings through Code Mode',async()=>{
    const before=readFileSync(path.join(app.home,'config.json'),'utf8');
    const {id}=await app.request<{id:string}>('agentSpace',{name:'Settings isolation'});
    await app.request('openTab',{spaceId:id,url:'about:blank',activate:true});
    await app.request('showSpace',{spaceId:id});
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.settings-page'))"),(value)=>!value);
    expect((await send({type:'settings.save',settings:{cookieBanners:'accept',minFreeMemoryRatio:.1,memoryEnabled:true}})).ok).toBe(false);
    expect(readFileSync(path.join(app.home,'config.json'),'utf8')).toBe(before);
    let report=await app.request<ExecReport>('exec',{space:'Settings isolation',thought:'Check the settings boundary',code:"try {await space.open('aether://settings/');return {unexpected:true};} catch(error){return {code:(error as {code?:string}).code};}"});
    for(let attempt=0;report.outcome.status==='held'&&attempt<5;attempt++)report=await app.request<ExecReport>('exec',{space:'Settings isolation',thought:'Wait for refusal',wait:report.outcome.token});
    expect(report.outcome.status).toBe('complete');
    if(report.outcome.status==='complete')expect(JSON.parse(report.outcome.json??'{}')).toEqual({code:'refused'});
    expect(readFileSync(path.join(app.home,'config.json'),'utf8')).toBe(before);
    await send({type:'settings.open'});
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.settings-page'))"),Boolean);
    expect(await evaluate<string>("document.querySelector('#cookie-preference').value")).toBe('off');
  },60000);
});
