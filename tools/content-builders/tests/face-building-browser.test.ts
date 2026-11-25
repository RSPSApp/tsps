import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createBuilderServer } from '../server';
const root=path.resolve(import.meta.dirname,'../../..'),chrome=process.env.BUILDER_CHROME??'/usr/bin/google-chrome';

test('native armor face handles, free drags, snapping modifiers, gizmos and undo work through browser pointers',{skip:!fs.existsSync(chrome),timeout:90000},async()=>{
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tsps-face-browser-')),app=createBuilderServer({root,directory:path.join(temporary,'projects')});
    let child,socket;
    const snapshot=process.env.BUILDER_FACE_PROJECT?JSON.parse(fs.readFileSync(process.env.BUILDER_FACE_PROJECT,'utf8')):null;
    const document=snapshot?.project??snapshot,fixture=document?.items?.find(p=>p.name==='Ancient Chestplate')??document;
    const fixtureScript=fixture?`const project=${JSON.stringify(fixture).replace(/</g,'\\u003c')};project.parts=[...project.parts.filter(p=>p.variant==='female'),...project.parts.filter(p=>p.variant!=='female')];`:`const project=newProject('face-browser','gear',source,{definition:60000,modelBase:1100000},${JSON.stringify(app.cache.info.name)});const inventory=structuredClone(project.parts[0]);inventory.id+='-inventory';project.parts.push(inventory);project.parts[0].variant='male';`;

    try{
        const handler=app.server.listeners('request')[0];app.server.removeAllListeners('request');
        app.server.on('request',(req,res)=>{
            if(req.url!=='/face-harness')return handler(req,res);
            res.setHeader('Content-Type','text/html');res.end(`<!doctype html><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/sculpt.css">
            <style>body{display:grid;grid-template-columns:310px 1fr;height:100vh;margin:0;background:#191814}#tools{padding:12px;overflow:auto}#view{width:100%;height:100%;min-width:0}#status{position:absolute;bottom:0;left:325px;color:#dfc780}#properties{display:none}</style>
            <div id="tools"></div><canvas id="view"></canvas><div id="properties"></div><output id="status"></output>
            <script type="module">
            import {Viewport} from '/viewport.mjs';import {createSculptTab} from '/sculpt.mjs';import {assemble} from '/shared/mesh.mjs';import {newProject} from '/shared/project.mjs';import {meshTopology,faceEdges} from '/shared/sculpt.mjs';import{createPartClipboard}from'/part-clipboard.mjs';
            const source=await(await fetch('/api/source?kind=item&id=22327&variant=male')).json();${fixtureScript}
            const part=project.parts[0];${fixture?'':"part.rotation=[7,18,-5];part.scale=[1.1,.9,1.2];part.pivot=[0,-140,0];"}
            const state={project,selected:part.id,variant:part.variant,mode:'sculpt',history:[]};let tab;const $=id=>document.getElementById(id);
            const element=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs))if(k.startsWith('on'))e.addEventListener(k.slice(2).toLowerCase(),v);else if(k==='text')e.textContent=v;else if(k in e)e[k]=v;else e.setAttribute(k,v);e.append(...kids);return e;};
            const view=new Viewport($('view'),{editing:()=> 'brush',edit:(...args)=>tab.edit(...args),endEdit:()=>tab.endEdit(),hover:hit=>tab.onHover(hit),faceOverlay:p=>tab.faceOverlay(p)});
            let bodyReference=${fixture?'await(await fetch("/api/mannequin?gender=female&slots=PLATEBODY&style=character")).json()':'null'};
            const update=()=>view.setItems([...(bodyReference?[{id:'reference',mesh:bodyReference.mesh,reference:true,opacity:1}]:[]),...state.project.parts.filter(p=>p.visible&&(p.variant===state.variant||p.variant==='all')).map(p=>({id:p.id,mesh:assemble(state.project.parts,state.variant,new Set([p.id])),selected:p.id===state.selected}))]);
            const ctx={state,element,button:(text,fn,attrs)=>element('button',{text,onClick:fn,...attrs}),selected:()=>state.project.parts.find(p=>p.id===state.selected),activeParts:()=>state.project.parts.filter(p=>p.visible&&(p.variant===state.variant||p.variant==='all')),checkpoint:()=>state.history.push(JSON.stringify(state.project)),changed:()=>update(),renderView:update,viewport:view,status:t=>$('status').textContent=t,stop:()=>{},draft:()=>{}};
            ctx.change=fn=>{ctx.checkpoint();fn();ctx.render();update();};const clipboard=createPartClipboard(ctx);window.addEventListener('copy',clipboard.copy);window.addEventListener('paste',clipboard.paste);window.addEventListener('copy',e=>{if(e.defaultPrevented)window.capturedCopy=e.clipboardData.getData('text/plain');});
            tab=createSculptTab(ctx);ctx.beforePaste=()=>tab.reset();ctx.render=()=>{tab.renderTools($('tools'));tab.renderProperties($('properties'));};ctx.render();update();
            requestAnimationFrame(()=>{view.fit();${fixture?'view.target=[0,-135,0];view.distance=180;':''}view.pitch=-.65;view.yaw=.5;view.dirty=true;});
            window.faceTest={state,tab,ctx,view,meshTopology,faceEdges,reference:()=>bodyReference,setReference:ref=>{bodyReference=ref;update();ctx.render();},undo:()=>{state.project=JSON.parse(state.history.pop());ctx.render();update();}};
            </script>`);
        });
        await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
        child=spawn(chrome,['--headless=new','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${path.join(temporary,'chrome')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
        const debuggerUrl=await new Promise<string>((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log.slice(-1500))),10000);child.stderr.on('data',d=>{log=(log+d).slice(-4000);const match=log.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('error',reject);});
        const url=new URL(debuggerUrl);url.protocol='http:';url.pathname='/json/list';const pages=await(await fetch(url)).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
        await new Promise<void>((resolve,reject)=>{socket.addEventListener('open',()=>resolve(),{once:true});socket.addEventListener('error',reject,{once:true});});
        let serial=0;const pending=new Map(),errors=[];
        socket.addEventListener('message',e=>{const data=JSON.parse(String(e.data));if(data.id){const p=pending.get(data.id);pending.delete(data.id);clearTimeout(p?.timer);data.error?p?.reject(new Error(JSON.stringify(data.error))):p?.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);});
        const call=(method,params={})=>new Promise<any>((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP '+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
        const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
        const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw new Error('UI condition '+expression+' '+await evaluate(`document.getElementById('status').textContent`));};
        const click=async(x,y,modifiers=0)=>{await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1,modifiers});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1,modifiers});};
        const drag=async(a,b,modifiers=8)=>{await call('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',clickCount:1,modifiers});for(let i=1;i<=5;i++)await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/5,y:a.y+(b.y-a.y)*i/5,button:'left',buttons:1,modifiers});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',clickCount:1,modifiers});};
        const screenshot=async name=>{if(!process.env.BUILDER_SCREENSHOTS)return;fs.mkdirSync(process.env.BUILDER_SCREENSHOTS,{recursive:true});const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.BUILDER_SCREENSHOTS,name+'.png'),Buffer.from(r.data,'base64'));};
        await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1350,height:900,deviceScaleFactor:1,mobile:false});
        await call('Page.navigate',{url:`http://127.0.0.1:${(app.server.address()as any).port}/face-harness`});await wait('window.faceTest?.view.polygons.length>50');
        await evaluate(`document.querySelector('[data-sculpt-tool="add-face"]').click()`);
        const edge=await evaluate(`(()=>{const {view,state,meshTopology}=faceTest,part=state.project.parts[0],r=view.canvas.getBoundingClientRect();view.draw(0);for(const e of meshTopology(part.mesh).boundaryEdges.sort((a,b)=>Math.min(...[a.a,a.b].map(i=>part.mesh.vertices[i][1]))-Math.min(...[b.a,b.b].map(i=>part.mesh.vertices[i][1])))){const p=view.polygons.find(p=>p.sourceFaceId===e.faceId);if(!p)continue;const a=p.vertices[p.sourceFaceId===undefined?0:part.mesh.faces[e.faceId].indexOf(e.a)],b=p.vertices[part.mesh.faces[e.faceId].indexOf(e.b)];if(!a||!b)continue;const mid=a.map((n,i)=>(n+b[i])/2),screen=view.project(mid),hit=view.toolPick(view.pick(...screen),screen);if(hit?.sourceFaceId===e.faceId)return{x:r.x+screen[0],y:r.y+screen[1]};}return null;})()`);
        assert.ok(edge,'an exposed native collar edge can be picked');await click(edge.x,edge.y);
        await wait(`faceTest.view.toolInteraction()?.points().length===3`);
        const before=await evaluate(`JSON.stringify(faceTest.state.project.parts[0].mesh)`);
        const point=await evaluate(`(()=>{const v=faceTest.view,p=v.toolInteraction().points().find(p=>!p.locked),s=v.project(p.point),r=v.canvas.getBoundingClientRect();return{x:r.x+s[0],y:r.y+s[1]};})()`);
        const oldCorner=await evaluate(`faceTest.view.toolInteraction().points().find(p=>!p.locked).point`);
        await drag(point,{x:point.x+30,y:point.y-18},8);
        assert.notDeepEqual(await evaluate(`faceTest.view.toolInteraction().points().find(p=>!p.locked).point`),oldCorner,'Shift-drag moves the free corner with a real pointer');
        assert.equal(await evaluate(`JSON.stringify(faceTest.state.project.parts[0].mesh)`),before,'the drag is only a preview');
        await wait(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Apply face').disabled`);
        await screenshot('native-chestplate-face-drag');
        const axis=await evaluate(`(()=>{const v=faceTest.view;v.draw(0);const h=v.handles[0],a=h.points[0],b=h.points[1],r=v.canvas.getBoundingClientRect();return{x:r.x+a[0]+(b[0]-a[0])*.7,y:r.y+a[1]+(b[1]-a[1])*.7};})()`);
        const oldAxisCorner=await evaluate(`faceTest.view.toolInteraction().points().find(p=>!p.locked).point`);
        await drag(axis,{x:axis.x+18,y:axis.y+4},2);
        assert.notDeepEqual(await evaluate(`faceTest.view.toolInteraction().points().find(p=>!p.locked).point`),oldAxisCorner,'Ctrl-drag moves the corner with the native gizmo path');
        await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Apply face').click()`);
        assert.equal(await evaluate(`faceTest.state.history.length`),1);assert.equal(await evaluate(`faceTest.state.project.parts[0].mesh.faces.length-JSON.parse(${JSON.stringify(before)}).faces.length`),1);
        await evaluate(`faceTest.undo()`);assert.equal(await evaluate(`JSON.stringify(faceTest.state.project.parts[0].mesh)`),before);
        await evaluate(`document.querySelector('[data-sculpt-tool="add-face"]').click()`);
        const cuff=await evaluate(`(()=>{const {view,state,faceEdges}=faceTest,part=state.project.parts[0],r=view.canvas.getBoundingClientRect();view.pitch=0;view.yaw=0;view.dirty=true;view.draw(0);for(const e of faceEdges(part.mesh).filter(e=>!e.open&&part.mesh.faces[e.faceId].slice(0,3).every(i=>[19,22].includes(part.mesh.skins[i])))){const p=view.polygons.find(p=>p.partId===part.id&&p.sourceFaceId===e.faceId);if(!p)continue;const a=p.vertices[part.mesh.faces[e.faceId].indexOf(e.a)],b=p.vertices[part.mesh.faces[e.faceId].indexOf(e.b)],screen=view.project(a.map((n,i)=>(n+b[i])/2));const hit=view.toolPick(view.pick(...screen),screen);if(hit?.partId===part.id&&hit.sourceFaceId===e.faceId&&hit.edge?.every(i=>[e.a,e.b].includes(i)))return{x:r.x+screen[0],y:r.y+screen[1]};}return null;})()`);
        assert.ok(cuff,'a closed sleeve edge is highlighted and selectable');await click(cuff.x,cuff.y);await wait(`faceTest.view.toolInteraction()?.points().length===3`);
        await evaluate(`(()=>{const mirror=document.querySelector('[aria-label="Mirror across part X"]');mirror.checked=true;mirror.dispatchEvent(new Event('change'));})()`);
        await wait(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Apply face').disabled`);
        assert.equal(await evaluate(`(()=>{const p=faceTest.state.project.parts[0];return faceTest.view.previewItems().find(i=>i.id===p.id).mesh.faces.length-p.mesh.faces.length;})()`),2,'the cuff preview contains matching faces on both sides');
        await screenshot('mirrored-sleeve-face-preview');
        await evaluate(`(()=>{const mirror=document.querySelector('[aria-label="Mirror across part X"]');mirror.checked=false;mirror.dispatchEvent(new Event('change'));})()`);
        await wait(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Apply face').disabled`);await screenshot('sleeve-edge-face-preview');
        const referenceBefore=await evaluate(`(async()=>{if(!faceTest.reference())faceTest.setReference(await(await fetch('/api/mannequin?gender='+faceTest.state.variant+'&slots=PLATEBODY&style=character')).json());faceTest.view.draw(0);return JSON.stringify(faceTest.reference().mesh);})()`);
        const snapTarget=await evaluate(`(()=>{const v=faceTest.view,r=v.canvas.getBoundingClientRect(),item=v.items.find(p=>p.id==='reference');for(const point of item.mesh.vertices.filter(p=>p[1]>=-105&&p[1]<=-85&&Math.abs(p[0])>=15)){const s=v.project(point),hit=v.pickSnap(s[0],s[1]);if(hit?.reference&&s[0]>15&&s[0]<r.width-15&&s[1]>15&&s[1]<r.height-15)return{point,x:r.x+s[0],y:r.y+s[1]};}return null;})()`);
        assert.ok(snapTarget,'a visible reference cuff corner exists outside the armor mesh');
        const freeCorner=await evaluate(`(()=>{const v=faceTest.view,p=v.toolInteraction().points().find(p=>!p.locked),s=v.project(p.point),r=v.canvas.getBoundingClientRect();return{x:r.x+s[0],y:r.y+s[1]};})()`);
        await drag(freeCorner,{x:snapTarget.x,y:snapTarget.y},0);
        const snapped=await evaluate(`faceTest.view.toolInteraction().points().find(p=>!p.locked).point`);
        assert.ok(Math.hypot(...snapped.map((n,i)=>n-snapTarget.point[i]))<1e-5,'the real pointer drag snaps exactly to the reference cuff corner');
        assert.equal(await evaluate(`JSON.stringify(faceTest.reference().mesh)`),referenceBefore,'reference geometry stays read-only');
        assert.match(await evaluate(`document.querySelector('.sculpt-connection-state').textContent`),/body reference/);
        await screenshot('reference-cuff-snap');

        await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Apply face').click();faceTest.undo()`);
        await evaluate(`document.querySelector('[data-sculpt-tool="vertex"]').click()`);
        const vertex=await evaluate(`(()=>{const v=faceTest.view;v.draw(0);const p=v.polygons.find(p=>!p.reference),a=p.points[0],center=p.points.reduce((s,q)=>s.map((n,i)=>n+q[i]/3),[0,0,0]),r=v.canvas.getBoundingClientRect();return{x:r.x+a[0]+(center[0]-a[0])*.03,y:r.y+a[1]+(center[1]-a[1])*.03};})()`);
        await click(vertex.x,vertex.y);
        await wait(`faceTest.view.toolInteraction()?.points().length===1`);
        await screenshot('native-chestplate-corner-gizmo');
        // Exercise trusted keyboard copy and paste events, including crossing
        // to another project and another view while retaining the clipboard.
        await evaluate(`document.activeElement?.blur();const p=faceTest.state.project.parts.find(p=>p.id===faceTest.state.selected);p.position=[17,-23,9];p.rotation=[13,24,-8];p.scale=[.9,1.2,.8];faceTest.ctx.renderView()`);
        const keys=async key=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0),modifiers:2});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0),modifiers:2});};
        await keys('c');await wait(`!!window.capturedCopy`);
        const copied=await evaluate(`JSON.parse(capturedCopy)`);assert.equal(copied.format,'tsps-part-clipboard/1');
        await evaluate(`faceTest.state.project=structuredClone(faceTest.state.project);faceTest.state.project.id='clipboard-destination';faceTest.state.variant='inventory';faceTest.tab.reset();faceTest.ctx.render();faceTest.ctx.renderView();`);
        const count=await evaluate(`faceTest.state.project.parts.length`);await keys('v');await wait(`faceTest.state.project.parts.length>${count}`);
        const pasted=await evaluate(`faceTest.state.project.parts.find(p=>p.id===faceTest.state.selected)`),original=copied.parts.find(p=>p.id===copied.root);
        assert.equal(pasted.variant,'inventory');for(const key of ['position','rotation','scale','mesh'])assert.deepEqual(pasted[key],original[key]);
        assert.deepEqual(errors,[],'no browser runtime errors');
    }finally{
        socket?.close();if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
        await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.cache.close();fs.rmSync(temporary,{recursive:true,force:true});
    }
});
