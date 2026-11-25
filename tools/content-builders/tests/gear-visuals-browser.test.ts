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
test('gear visuals edit, preview, save and export surfaces, particles and model tracks', { skip: !fs.existsSync(chrome), timeout: 120000 }, async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-gear-visuals-browser-'));
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
        await search('item',24424);await evaluate(`document.querySelector('[data-part-key=whole] button').click()`);await waitFor(`!document.getElementById('name').disabled`);
        await evaluate(`document.getElementById('variant').value='male';document.getElementById('variant').dispatchEvent(new Event('change'))`);await waitFor(`document.querySelector('#parts .part button.selected')&&document.getElementById('variant').value==='male'`);await evaluate(`document.getElementById('mannequin').checked=true;document.getElementById('mannequin').dispatchEvent(new Event('change'))`);
        const field=async(label,value)=>evaluate(`(()=>{const input=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');if(!input)throw Error('Missing field '+${JSON.stringify(label)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change'));})()`);
        await evaluate(`document.querySelector('[data-mode=visuals]').click()`);await clickText('Add layer');
        await field('Layer name','Lava surface');await field('Scroll per second V',-.7);await field('Texture tint','#bd6cff');
        assert.equal(await evaluate(`document.querySelector('[aria-label="Scroll per second V"]').value`),'-.7'.replace('-.','-0.'));
        await clickText('Search textures');await waitFor(`Array.from(document.querySelectorAll('#job-tools button')).some(b=>b.textContent.startsWith('Texture '))`);
        await field('Search native textures','40');await clickText('Search textures');await waitFor(`Array.from(document.querySelectorAll('#job-tools button')).some(b=>b.textContent.startsWith('Texture 40 '))`);
        await evaluate(`Array.from(document.querySelectorAll('#job-tools button')).find(b=>b.textContent.startsWith('Texture 40 ')).click()`);
        assert.equal(await evaluate(`document.querySelector('[aria-label="Native texture ID"]').value`),'40');
        await field('Texture source','pattern');await field('Projection','xy');await field('Procedural pattern','runes');
        await evaluate(`(async()=>{const transfer=new DataTransfer();for(const colour of ['#ff0000','#0000ff']){const canvas=document.createElement('canvas');canvas.width=canvas.height=8;const c=canvas.getContext('2d');c.fillStyle=colour;c.fillRect(0,0,8,8);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));transfer.items.add(new File([blob],colour+'.png',{type:'image/png'}));}const input=document.querySelector('#properties input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change'));})()`);
        await waitFor(`document.querySelectorAll('.visual-frame').length===2`);await evaluate(`document.querySelector('[aria-label="Move frame 2 earlier"]').click()`);
        await screenshot('gear-animated-texture');
        await clickText('Particles');await clickText('Add layer');await field('Layer name','Staff sparks');await field('Lifetime in seconds',2.3);await field('Launch velocity Y',-40);await field('Maximum live particles',20);await field('Emitter shape','ring');
        await clickText('Place emitter on model');assert.ok(await evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Cancel placement')`));await clickText('Cancel placement');
        await screenshot('gear-particles');
        await clickText('Model motion');await field('Layer preset','1');await clickText('Add layer');await field('Layer name','Pulsing orb');await field('Loop duration in seconds',4);
        assert.ok(await evaluate(`Array.from(document.querySelectorAll('.visual-timeline button')).some(b=>b.textContent==='4.00 s')`));
        await clickText('2.00 s');await field('Key rotation Y',45);await field('Preview time (seconds)',3);await clickText('Add key at cursor');
        assert.equal(await evaluate(`document.querySelector('[aria-label="Selected key time"]').value`),'3');
        await field('Loop duration in seconds',0);assert.ok(await evaluate(`document.getElementById('status').textContent.includes('Duration')`));
        assert.equal(await evaluate(`document.querySelector('[aria-label="Loop duration in seconds"]').value`),'4','invalid edits must leave the previous layer intact');
        await clickText('Duplicate layer');assert.equal(await evaluate(`document.querySelectorAll('.visual-layer').length`),2);await clickText('Remove layer');
        await evaluate(`document.getElementById('undo').click()`);assert.equal(await evaluate(`document.querySelectorAll('.visual-layer').length`),2);await evaluate(`document.getElementById('redo').click()`);assert.equal(await evaluate(`document.querySelectorAll('.visual-layer').length`),1);
        await screenshot('gear-model-motion');
        await evaluate(`document.getElementById('save').click()`);await waitFor(`document.getElementById('save-state').textContent==='Saved'`);
        const saved=app.store.list()[0],project=app.store.read(saved.id).project;
        assert.equal(project.visuals.textures.length,1);assert.equal(project.visuals.textures[0].frames.length,2);assert.equal(project.visuals.textures[0].source,'frames');
        assert.equal(project.visuals.particles[0].lifetime,2.3);assert.equal(project.visuals.models[0].duration,4);assert.equal(project.visuals.models[0].keys.length,4);
        await evaluate(`(()=>{const nativeFetch=window.fetch;window.fetch=async(...args)=>{const response=await nativeFetch(...args);if(String(args[0]).includes('/api/animate-gear')){const data=await response.clone().json();window.__visualClip={layers:data.visualLayers,frames:data.frames?.length,bindings:data.mesh?.visualTextures?.length};}return response;};document.querySelector('[data-animation=idle]').click();})()`);
        await waitFor(`window.__visualClip?.frames>1`);assert.deepEqual(await evaluate(`window.__visualClip.layers`),{textures:1,particles:1,models:1});assert.equal(await evaluate(`window.__visualClip.bindings`),1);await screenshot('gear-visuals-player-pose');await evaluate(`document.getElementById('rest').click()`);
        const result=await evaluate(`fetch('/api/projects/${saved.id}').then(r=>r.json()).then(p=>fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:p.project})})).then(async r=>({status:r.status,bytes:Array.from(new Uint8Array(await r.arrayBuffer()))}))`);
        assert.equal(result.status,200);const require=createRequire(path.join(root,'server/package.json')),parsed=require(path.join(root,'server/plugins/tools/worldadmin/PluginZip.WorldAdmin.js')).readPluginZip(Buffer.from(result.bytes));assert.match(parsed.source,/"visuals":\{"version":1/);
        await reload();await waitFor(`!document.getElementById('name').disabled`);await evaluate(`document.querySelector('[data-mode=visuals]').click()`);await waitFor(`document.querySelector('.visual-layer button')?.textContent==='Lava surface'`);
        await clickText('Particles');assert.equal(await evaluate(`document.querySelector('[aria-label="Lifetime in seconds"]').value`),'2.3');
        await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate(`document.getElementById('toggle-tools').click()`);await screenshot('gear-visuals-mobile');assert.ok(await evaluate(`document.documentElement.scrollWidth<=395`));
        assert.deepEqual(errors,[]);
    } finally {
        socket?.close();if(child&&child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;}
        await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.cache.close();fs.rmSync(temporary,{recursive:true,force:true,maxRetries:3});
    }
});
