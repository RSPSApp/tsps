// Browser workflow regression. Uses a temporary Chrome profile, server and projects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { assemble } from '../shared/mesh.mjs';
import { equippedParts } from '../shared/gear-set.mjs';
import { createBuilderServer } from '../server';
const root = path.resolve(import.meta.dirname, '../../..');
const chrome = process.env.BUILDER_CHROME ?? '/usr/bin/google-chrome';
test('gear sets edit named items together, undo, recover drafts and export one plugin in Chrome', { skip: !fs.existsSync(chrome), timeout: 120000 }, async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-gear-set-browser-'));
    const app = createBuilderServer({ root, directory: path.join(temporary, 'projects') });
    let child: ReturnType<typeof spawn>, socket: WebSocket;
    try {
        await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${(app.server.address() as any).port}`;
        child = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${path.join(temporary, 'chrome')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
        const debuggerUrl = await new Promise<string>((resolve, reject) => {
            let log = ''; const timer = setTimeout(() => reject(new Error('Chrome did not expose its test debugger. ' + log.slice(-2000))), 10000);
            child.stderr.on('data', data => { log = (log + data).slice(-6000); const match = log.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } }); child.once('error', reject);
        });
        const debuggerOrigin = new URL(debuggerUrl); debuggerOrigin.protocol = 'http:'; debuggerOrigin.pathname = '/json/list';
        const tabs = await (await fetch(debuggerOrigin)).json();
        socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
        await new Promise<void>((resolve, reject) => { socket.addEventListener('open', () => resolve(), { once: true }); socket.addEventListener('error', reject, { once: true }); });
        let serial = 0; const pending = new Map(), errors: any[] = [], contexts = new Map();
        socket.addEventListener('message', event => { const data = JSON.parse(String(event.data)); if (data.id) { const p = pending.get(data.id); pending.delete(data.id); clearTimeout(p?.timer); if (data.error) p?.reject(new Error(JSON.stringify(data.error))); else p?.resolve(data.result); } else if (data.method === 'Runtime.executionContextCreated') contexts.set(data.params.context.id, data.params.context); else if (data.method === 'Runtime.executionContextDestroyed') contexts.delete(data.params.executionContextId); else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails); else if (data.method === 'Page.javascriptDialogOpening') { if (data.params.type !== 'beforeunload') errors.push({ dialog: data.params.type, message: data.params.message }); void call('Page.handleJavaScriptDialog', { accept: data.params.type === 'beforeunload' }).catch(error => errors.push(error.message)); } });
        const call = (method, params = {}) => new Promise<any>((resolve, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 12000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
        const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
        const waitFor = async expression => { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 60)); } throw new Error(`UI condition failed: ${expression}\n${await evaluate('document.getElementById("status")?.textContent')} ${JSON.stringify(errors)}\n${JSON.stringify(await evaluate(`({focus:document.activeElement?.outerHTML?.slice(0,500),url:location.href})`))}`); };
        const reload = async () => {
            // Page.reload acknowledges navigation before replacing the old document.
            // Wait for its load event before looking for the restored project's name.
            let listener, timer;
            const loaded = new Promise<void>((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Reload did not finish')), 12000);
                listener = event => { if (JSON.parse(String(event.data)).method === 'Page.loadEventFired') resolve(); };
                socket.addEventListener('message', listener);
            });
            try { await call('Page.reload'); await loaded; }
            finally { clearTimeout(timer); socket.removeEventListener('message', listener); }
        };
        const clickText = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(text)} && b.getClientRects().length && !b.closest('[inert]')).click()`);
        const search = async (kind, id) => { await evaluate(`document.getElementById('source-kind').value=${JSON.stringify(kind)}; document.getElementById('search').value=${JSON.stringify(String(id))}; document.getElementById('search-go').click()`); await waitFor(`document.getElementById('result-count').textContent === '1' && document.querySelector('#results button')?.dataset.source === ${JSON.stringify(`${kind}/${id}`)}`); await evaluate(`document.querySelector('#results button').click()`); await waitFor(`document.querySelector('#part-cards .part-card')?.title.includes('faces') && document.querySelector('#results button').getAttribute('aria-selected')==='true'`); };
        const screenshot = async name => { if (!process.env.BUILDER_SCREENSHOTS) return; fs.mkdirSync(process.env.BUILDER_SCREENSHOTS, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(process.env.BUILDER_SCREENSHOTS, name + '.png'), Buffer.from(r.data, 'base64')); };
        await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1500,height:960,deviceScaleFactor:1,mobile:false});
        await call('Page.navigate',{url:origin+'/?view=gear'});await waitFor(`document.querySelectorAll('#results button').length>0`);
        await search('item',1163);await evaluate(`document.querySelector('[data-part-key=whole] button').click()`);await waitFor(`!document.getElementById('name').disabled`);
        await evaluate(`document.getElementById('create-set').click()`);await waitFor(`document.querySelectorAll('.set-item').length===1`);
        assert.equal(await evaluate(`document.getElementById('variant').value`),'male');
        const field=async(label,value)=>evaluate(`(()=>{const input=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));})()`);
        await field('Set name','My rune armor');await field('Item name','Ruby rune helm');
        assert.equal(await evaluate(`document.getElementById('name').value`),'Ruby rune helm');
        assert.ok(await evaluate(`document.querySelector('.set-item[aria-pressed="true"]').textContent.includes('Ruby rune helm')`),'inspector item name updates the set card');
        const countBeforeReferences=await evaluate(`document.getElementById('mesh-count').textContent`);
        await evaluate(`(async()=>{const {Viewport}=await import('/viewport.mjs'),original=Viewport.prototype.setItems;Viewport.prototype.setItems=function(items){if(this.canvas.id==='view')window.referenceOpacity=items.find(i=>i.id==='reference')?.opacity;return original.call(this,items);};})()`);
        await field('Reference body','dummy');await waitFor(`window.referenceOpacity===.4`);
        await evaluate(`window.dummyBody=document.getElementById('view').toDataURL()`);
        await field('Reference body','character');
        await waitFor(`document.getElementById('view').toDataURL()!==window.dummyBody && JSON.parse(localStorage.getItem('creator:view')).referenceStyle==='character'`);
        await screenshot('neutral-character-studio');
        for(const id of ['studio','studio-light','lumbridge','desert','varrock']){
            await field('Preview background',id);
            await waitFor(`document.getElementById('scene-status').textContent===''&&JSON.parse(localStorage.getItem('creator:view')).scene===${JSON.stringify(id)}`);
            await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
            await screenshot('neutral-character-'+id);
            if(id==='lumbridge')assert.ok(await evaluate(`(async()=>{const {Viewport}=await import('/viewport.mjs');const scene=await(await fetch('/api/preview-scene?id=lumbridge')).json(),body=await(await fetch('/api/mannequin?gender=male&style=character')).json();const canvas=document.createElement('canvas');canvas.width=880;canvas.height=700;const v=new Viewport(canvas,{passive:true});v.setItems([{id:'body',mesh:body.mesh}]);v.fit();v.setBackdrop(scene);v.draw(0);const ground=scene.items.find(i=>i.mesh.faces.length===2&&i.mesh.vertices.every(p=>Math.abs(p[0])<=65&&Math.abs(p[2])<=65));const result=v.backdropView.polygons.filter(p=>p.partId===ground.id).length;return result;})()`)>0,'the courtyard floor beneath the player is visible');
            assert.equal(await evaluate(`document.getElementById('mesh-count').textContent`),countBeforeReferences,'scenery and body never enter the editable mesh');
        }
        await field('Preview background','lumbridge');await field('Preview background','studio');
        await waitFor(`document.getElementById('scene-status').textContent===''&&JSON.parse(localStorage.getItem('creator:view')).scene==='studio'`);
        assert.equal(await evaluate(`document.getElementById('preview-scene').value`),'studio','late scenery responses cannot replace the selected background');
        await field('Preview background','desert');await waitFor(`document.getElementById('scene-status').textContent===''&&JSON.parse(localStorage.getItem('creator:view')).scene==='desert'`);
        await clickText('Generate draft views');await waitFor(`document.querySelectorAll('.gear-view-drafts canvas').length===2`);
        await screenshot('gear-generated-views');
        assert.equal(await evaluate(`document.getElementById('variant').value`),'male','draft preview preserves the edited source view');
        await clickText('Cancel draft');assert.equal(await evaluate(`document.querySelectorAll('.gear-view-drafts canvas').length`),0);
        await clickText('Generate draft views');await waitFor(`document.querySelectorAll('.gear-view-drafts canvas').length===2`);
        await clickText('Apply generated views');await waitFor(`document.getElementById('variant').value==='female'`);
        await screenshot('converted-helmet-pivot');
        await evaluate(`document.getElementById('variant').value='male';document.getElementById('variant').dispatchEvent(new Event('change'))`);
        await waitFor(`document.getElementById('variant').value==='male' && !document.querySelector('.gear-view-drafts')`);
        const nativePreview=await evaluate(`(async()=>{const {thumbnail}=await import('/viewport.mjs');const source=await(await fetch('/api/source?kind=item&id=1127&variant=inventory')).json();const canvas=document.createElement('canvas');canvas.width=100;canvas.height=110;document.body.append(canvas);const view=thumbnail(canvas,source.mesh,source);const points=view.items[0].mesh.vertices.map(p=>view.project(p));const result={yaw:view.yaw,pitch:view.pitch,minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))};canvas.remove();return result;})()`);
        assert.equal(nativePreview.yaw,0);assert.equal(nativePreview.pitch,0);
        const generatedIcon=await evaluate(`(async()=>{const [{newProject,makePart},{generateGearViews},{assemble},{thumbnail}]=await Promise.all([import('/shared/project.mjs'),import('/shared/gear-views.mjs'),import('/shared/mesh.mjs'),import('/viewport.mjs')]);const source=await(await fetch('/api/source?kind=item&id=30781&variant=inventory')).json(),male=await(await fetch('/api/source?kind=item&id=30781&variant=male')).json();const p=newProject('icon-regression','gear',source,{definition:58000,modelBase:1100000},'test');p.parts.push(makePart(male,'male'));const draft=generateGearViews(p,['inventory'],{male:male.mesh,inventory:source.mesh});const panel=document.createElement('div');panel.id='icon-regression';panel.style.cssText='position:fixed;top:160px;left:450px;z-index:9999;display:flex;gap:15px;padding:15px;background:#292722';document.body.append(panel);for(const [label,mesh,fields] of [['Template',source.mesh,source.fields],['Generated',assemble(draft.parts,'inventory'),draft.iconSettings]]){const figure=document.createElement('figure'),canvas=document.createElement('canvas');canvas.width=140;canvas.height=170;figure.append(canvas,document.createTextNode(label));panel.append(figure);thumbnail(canvas,mesh,{kind:'item',variant:'inventory',fields});}return draft.iconSettings;})()`);
        assert.equal(generatedIcon.xan2d,128);assert.equal(generatedIcon.zan2d,0);assert.ok(generatedIcon.zoom2d>0);
        await screenshot('generated-leg-inventory');await evaluate(`document.getElementById('icon-regression').remove()`);
        const skinPreview=await evaluate(`(async()=>{const {Viewport}=await import('/viewport.mjs');const canvas=document.createElement('canvas');canvas.width=200;canvas.height=200;const v=new Viewport(canvas,{passive:true});v.yaw=v.pitch=0;v.target=[0,0,0];v.distance=200;v.skinOverlay=true;const mesh={vertices:[[-20,-20,0],[20,-20,0],[0,20,0]],faces:[[0,2,1,4550]]};v.setItems([{id:'skin',mesh}]);v.draw(0);return {rgb:v.polygons[0].rgb,colour:mesh.faces[0][3]};})()`);
        assert.equal(skinPreview.colour,4550);assert.ok(skinPreview.rgb[0]>skinPreview.rgb[1]*2&&skinPreview.rgb[2]>skinPreview.rgb[1]*2,'skin renders magenta without changing the native marker');
        assert.ok(nativePreview.minX>=3&&nativePreview.maxX<=97&&nativePreview.minY>=3&&nativePreview.maxY<=107,'native-angle platebody fits a narrow card without cropping');
        const addItem=async(id)=>{
            const count=await evaluate(`document.querySelectorAll('.set-item').length`);
            await clickText('Add item');await waitFor(`document.getElementById('set-item-dialog').open`);
            await field('Start from an item',String(id));await waitFor(`document.querySelector('#set-item-options [role=option]')?.textContent.includes('Rune')`);
            const picker=await evaluate(`(()=>{const dialog=document.getElementById('set-item-dialog'),results=dialog.querySelector('.picker-results');return {height:results.getBoundingClientRect().height,position:getComputedStyle(results).position,dialogHeight:dialog.getBoundingClientRect().height};})()`);
            await screenshot('gear-set-picker');
            assert.equal(picker.position,'static');assert.ok(picker.height>=200,'set item picker shows multiple result rows');assert.ok(picker.dialogHeight<960,'dialog stays in its viewport');
            await evaluate(`document.querySelector('#set-item-options [role=option]').click()`);await clickText('Add custom item');
            await waitFor(`!document.getElementById('set-item-dialog').open && document.querySelectorAll('.set-item').length===${count+1}`);
        };
        await addItem(1127);await field('Creation name','Ruby rune body');await addItem(1079);await field('Creation name','Ruby rune legs');
        assert.equal(await evaluate(`document.querySelectorAll('.set-item').length`),3);
        await evaluate(`document.querySelector('[aria-label="Edit Ruby rune helm"]').click()`);await waitFor(`document.getElementById('name').value==='Ruby rune helm'`);
        await evaluate(`document.querySelector('[data-mode=paint]').click()`);await waitFor(`document.querySelectorAll('.paint-swatches button').length>0`);
        await evaluate(`document.querySelector('[data-mode=sculpt]').click()`);assert.ok(await evaluate(`!!document.querySelector('[data-sculpt-tool="delete-face"]')`));
        await evaluate(`document.querySelector('[data-mode=\"set-effects\"]').click()`);await clickText('Create a set bonus');
        await waitFor(`document.querySelectorAll('.effects-custom-picture').length===3`);
        assert.ok(await evaluate(`Array.from(document.querySelectorAll('.effects-piece-choice')).some(el=>el.textContent.includes('Ruby rune body'))`),'set bonus shows sibling names and real thumbnails');
        await evaluate(`document.getElementById('save').click()`);await waitFor(`document.getElementById('save-state').textContent==='Saved'`);
        let saved=await evaluate(`fetch('/api/projects').then(r=>r.json()).then(async r=>{const p=r.projects.find(p=>p.set);return fetch('/api/projects/'+p.id).then(r=>r.json())})`);
        assert.equal(saved.project.items.length,3);assert.equal(saved.project.items[0].name,'Ruby rune helm','inspector item name is saved for native export');assert.equal(saved.project.items[0].effects.passives.length,1);assert.equal(saved.project.items[1].effects.passives.length,0);
        assert.equal(saved.project.items[0].effects.passives[0].set.pieces[1].itemIds[0],'item:'+saved.project.items[1].id);
        await evaluate(`document.querySelector('[data-mode=build]').click()`);await clickText('Set bonus');await evaluate(`document.querySelector('.effects-piece').scrollIntoView({block:'start'})`);await screenshot('gear-set-effect');
        await evaluate(`document.querySelector('[data-mode=build]').click();document.querySelector('[aria-label="Edit Ruby rune body"]').click()`);await waitFor(`document.getElementById('name').value==='Ruby rune body'`);
        await field('Creation name','Changed body');await evaluate(`document.getElementById('undo').click()`);await waitFor(`document.getElementById('name').value==='Ruby rune body'`);
        await evaluate(`document.getElementById('redo').click()`);await waitFor(`document.getElementById('name').value==='Changed body'`);
        await field('Creation name','Ruby rune body');await evaluate(`document.getElementById('save').click()`);await waitFor(`document.getElementById('save-state').textContent==='Saved'`);
        await screenshot('gear-set-equipped');
        const worn=assemble([...equippedParts(saved.project),{id:'player',visible:true,variant:'male',mesh:app.cache.mannequin('male',['FULL_HELMET','PLATEBODY','LEGS']).mesh}],'male');
        await evaluate(`window.__setAnimationMeshes=[];const nativeFetch=window.fetch;window.fetch=async(...args)=>{if(args[0]==='/api/animate')window.__setAnimationMeshes.push(JSON.parse(args[1].body).mesh);return nativeFetch(...args);};document.querySelector('[data-animation=idle]').click()`);
        await waitFor(`document.getElementById('status').textContent.includes('native frames')`);
        assert.equal(await evaluate(`window.__setAnimationMeshes.at(-1).vertices.length`),worn.vertices.length,'toolbar playback animates every equipped custom item and the remaining player kits');
        await evaluate(`document.getElementById('rest').click();document.querySelector('[data-mode=animate]').click()`);await waitFor(`!!document.querySelector('.animate-roles')`);await evaluate(`Array.from(document.querySelectorAll('.animate-roles button')).find(b=>b.textContent==='Idle').click()`);await waitFor(`!!document.querySelector('[aria-label="Play idle"]')`);
        await evaluate(`document.querySelector('[aria-label="Play idle"]').click()`);await waitFor(`document.getElementById('status').textContent.startsWith('Idle preview.')`);
        assert.equal(await evaluate(`window.__setAnimationMeshes.at(-1).vertices.length`),worn.vertices.length,'Animate tab uses the same complete equipped preview');
        await evaluate(`document.getElementById('rest').click();document.querySelector('[data-mode=build]').click()`);
        const occlusion=await evaluate(`(async()=>{const {Viewport}=await import('/viewport.mjs');const canvas=document.createElement('canvas');canvas.width=200;canvas.height=200;const v=new Viewport(canvas,{passive:true});v.yaw=v.pitch=0;v.target=[0,0,0];v.distance=300;v.outline=v.gizmo=false;const mesh=z=>({vertices:[[-30,-30,z],[30,-30,z],[0,30,z]],faces:[[0,2,1,500]],skins:[0,0,0]});v.setItems([{id:'active',mesh:mesh(20)},{id:'sibling',reference:true,opacity:1,mesh:mesh(0)}]);v.draw(0);const solid={pick:v.pick(100,100),depth:v.depthAt(100,100),alpha:v.polygons.find(p=>p.partId==='sibling').alpha};v.setItems([{id:'active',mesh:mesh(20)},{id:'mannequin',reference:true,mesh:mesh(0)}]);v.draw(0);return {solid,ghostPick:v.pick(100,100)?.partId};})()`);
        assert.equal(occlusion.solid.alpha,1);assert.equal(occlusion.solid.pick,null,'opaque siblings protect the geometry behind them from brushes');assert.ok(Math.abs(occlusion.solid.depth)<.01);assert.equal(occlusion.ghostPick,'active','translucent body references remain click-through');

        await evaluate(`new Promise(r=>setTimeout(r,400))`);await reload();await waitFor(`document.querySelectorAll('.set-item').length===3 && document.getElementById('name').value==='Ruby rune body' && document.querySelectorAll('#part-cards .part-card').length>0`);
        assert.equal(await evaluate(`document.getElementById('reference-style').value`),'character','reference preference survives reload');
        assert.equal(await evaluate(`document.getElementById('preview-scene').value`),'desert','background preference survives reload');
        const refused=await evaluate(`(async()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Remove item').click();await new Promise(r=>setTimeout(r,0));return document.getElementById('status').textContent;})()`);assert.match(refused,/uses .* in/);assert.equal(await evaluate(`document.querySelectorAll('.set-item').length`),3);
        await evaluate(`document.querySelector('[aria-label="Edit Ruby rune helm"]').click()`);await waitFor(`document.getElementById('name').value==='Ruby rune helm'`);
        await evaluate(`document.getElementById('export').click()`);await waitFor(`!document.getElementById('export-download').disabled`);
        assert.match(await evaluate(`document.getElementById('check-result').textContent`),/3 custom items/);
        const exported=await evaluate(`fetch('/api/projects/${saved.project.id}').then(r=>r.json()).then(p=>fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:p.project})})).then(async r=>({status:r.status,bytes:Array.from(new Uint8Array(await r.arrayBuffer()))}))`);
        assert.equal(exported.status,200);const require=createRequire(path.join(root,'server/package.json'));const parsed=require(path.join(root,'server/plugins/tools/worldadmin/PluginZip.WorldAdmin.js')).readPluginZip(Buffer.from(exported.bytes));assert.match(parsed.source,/gear-set/);
        await evaluate(`document.getElementById('export-dialog').close();document.getElementById('new').click()`);await waitFor(`document.getElementById('name').disabled`);
        await evaluate(`document.getElementById('create-set').click()`);await waitFor(`document.getElementById('set-item-dialog').open`);
        await field('Start from an item','1163');await waitFor(`document.querySelector('#set-item-options [role=option]')?.textContent.includes('Rune')`);await evaluate(`document.querySelector('#set-item-options [role=option]').click()`);await clickText('Create gear set');await waitFor(`document.querySelectorAll('.set-item').length===1`);
        await addItem(1127);await clickText('Remove item');await waitFor(`document.querySelectorAll('.set-item').length===1`);await evaluate(`document.getElementById('undo').click()`);await waitFor(`document.querySelectorAll('.set-item').length===2`);await evaluate(`document.getElementById('redo').click()`);await waitFor(`document.querySelectorAll('.set-item').length===1`);
        assert.deepEqual(errors,[]);
    } finally {
        socket?.close();if(child&&child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;}
        await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.cache.close();fs.rmSync(temporary,{recursive:true,force:true,maxRetries:3});
    }
});
