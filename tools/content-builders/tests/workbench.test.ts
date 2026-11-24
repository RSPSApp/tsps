// Browser workflow regression. Uses a temporary Chrome profile, server and projects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createBuilderServer } from '../server';
const root = path.resolve(import.meta.dirname, '../../..');
const chrome = process.env.BUILDER_CHROME ?? '/usr/bin/google-chrome';
test('workbench edits creatures and worn gear, recovers drafts and exports valid packages in Chrome', { skip: !fs.existsSync(chrome), timeout: 120000 }, async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-builder-browser-'));
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
        await call('Runtime.enable'); await call('Page.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1500, height: 960, deviceScaleFactor: 1, mobile: false });
        await call('Page.navigate', { url: origin }); await waitFor(`document.querySelectorAll('#part-cards .part-card').length > 2`);
        assert.equal(await evaluate(`!!document.getElementById('welcome')`),false,'no wizard blocks the parts library');
        const painted = selector => evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)});const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>45||pixels[i+1]>45||pixels[i+2]>45)count++;return count;})()`);
        await waitFor(`document.querySelector('#results canvas')?.getContext('2d').getImageData(40,30,1,1).data[3] > 0`);
        assert.ok(await painted('#results canvas')>30,'source cards render actual cache geometry');
        await screenshot('empty-creator');
        await search('npc',2477);await waitFor(`document.getElementById('source-name').textContent==='Giant spider'`);
        await evaluate(`document.querySelector('[data-part-key=whole] button').click()`);await waitFor(`document.querySelectorAll('#parts .part').length===1`);
        assert.ok(await painted('#view')>500,'first Add immediately starts a visible creature');
        await search('npc',655);await waitFor(`document.getElementById('source-name').textContent==='Goblin'`);
        const head=await evaluate(`Array.from(document.querySelectorAll('.part-card')).find(c=>c.querySelector('strong').textContent==='Head').dataset.partKey`);
        assert.ok(head,'the goblin has a recognizable head card');
        assert.ok(await painted(`[data-part-key="${head}"] canvas`)>50,'head has a pictured preview');
        const dropPoint=await evaluate(`(()=>{const r=document.getElementById('view').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        const dragData={items:[{mimeType:'application/x-tsps-part',data:JSON.stringify({kind:'npc',id:655,variant:'body',key:head})}],dragOperationsMask:1};
        for(const type of ['dragEnter','dragOver','drop'])await call('Input.dispatchDragEvent',{type,...dropPoint,data:dragData});
        await waitFor(`document.querySelectorAll('#parts .part').length===2`);
        assert.match(await evaluate(`document.getElementById('inspector-title').textContent`),/Head/,'drop selects the attached head');
        await evaluate(`const input=document.querySelector('input[aria-label="Width value"]');input.value='1.4';input.dispatchEvent(new Event('change'));`);
        assert.equal(await evaluate(`document.querySelector('input[aria-label="Width value"]').value`),'1.4');
        await evaluate(`Array.from(document.querySelectorAll('#properties button')).find(b=>b.textContent==='Duplicate').click()`);await waitFor(`document.querySelectorAll('#parts .part').length===3`);
        await evaluate(`document.getElementById('undo').click()`);await waitFor(`document.querySelectorAll('#parts .part').length===2`);
        await evaluate(`Array.from(document.querySelectorAll('.part-card')).find(c=>c.querySelector('strong').textContent.includes('arm')).querySelector('button').click()`);await waitFor(`document.querySelectorAll('#parts .part').length===3`);
        assert.equal(await evaluate(`Array.from(document.querySelectorAll('#properties label')).find(l=>l.textContent==='Mirror to the other side').querySelector('input').checked`),true,'side limbs start mirrored');
        await evaluate(`document.querySelector('[data-mode=paint]').click()`);await waitFor(`document.querySelectorAll('.paint-swatches .paint-swatch').length>0`);
        await evaluate(`document.querySelector('.paint-swatches .paint-swatch').click()`);
        assert.equal(await evaluate(`document.getElementById('build-library').hidden`),true,'paint replaces the library with paint tools');
        assert.equal(await evaluate(`!!document.querySelector('#properties input[aria-label="Width value"]')`),false,'paint hides transform controls');
        await evaluate(`document.querySelector('.paint-preset').click()`);
        await waitFor(`!!document.querySelector('canvas[aria-label="After palette preview, current view"]')`);
        assert.ok(await painted('canvas[aria-label="After palette preview, current view"]')>30,'palette preview renders the assembled model');
        await screenshot('palette-preview');
        await evaluate(`Array.from(document.querySelectorAll('#properties button')).find(b=>b.textContent==='Apply colours').click()`);
        await waitFor(`document.getElementById('status').textContent.startsWith('Applied ')`);
        await screenshot('palette-tools');await evaluate(`document.getElementById('undo').click()`);
        await evaluate(`document.querySelector('[data-mode=sculpt]').click()`);
        assert.ok(await evaluate(`!!document.querySelector('[data-sculpt-selection=connected]')`),'Sculpt exposes connected-face selection');
        await evaluate(`document.querySelector('[data-sculpt-selection=all]').click()`);
        assert.match(await evaluate(`document.querySelector('.sculpt-count').textContent`),/^[1-9][\d,]* of/,'select all creates a visible face selection');
        await screenshot('sculpt-selection');
        await evaluate(`Array.from(document.querySelectorAll('#properties button')).find(b=>b.textContent==='Smooth once').click()`);
        await waitFor(`document.getElementById('status').textContent.includes('Smooth')`);
        await evaluate(`document.getElementById('undo').click()`);
        await evaluate(`document.querySelector('[data-mode=build]').click();document.getElementById('gizmo').click();document.getElementById('fit').click();`);
        await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        const movePoint=await evaluate(`(()=>{const c=document.getElementById('view'),r=c.getBoundingClientRect(),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data,ids=[];for(let i=0;i<p.length;i+=4)if(p[i]>90||p[i+1]>90||p[i+2]>90)ids.push(i/4);const n=ids[Math.floor(ids.length/2)];return{x:r.left+(n%c.width)*r.width/c.width,y:r.top+Math.floor(n/c.width)*r.height/c.height}})()`);
        await evaluate(`document.querySelector('[data-mode=sculpt]').click();document.querySelector('[data-sculpt-selection=clear]').click()`);
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',...movePoint});
        await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        await screenshot('sculpt-hover');
        await call('Input.dispatchMouseEvent',{type:'mousePressed',...movePoint,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',...movePoint,button:'left',clickCount:1});
        assert.match(await evaluate(`document.querySelector('.sculpt-count').textContent`),/^[1-9]/,'clicking the model selects source faces through the integrated viewport');
        const facesBeforeDelete=await evaluate(`Number(document.querySelector('.sculpt-count').textContent.match(/of ([\\d,]+)/)[1].replace(/,/g,''))`);
        await evaluate(`document.querySelector('[data-sculpt-delete]').click()`);
        await waitFor(`document.getElementById('status').textContent.startsWith('Deleted 1 faces')`);
        assert.equal(await evaluate(`Number(document.querySelector('.sculpt-count').textContent.match(/of ([\\d,]+)/)[1].replace(/,/g,''))`),facesBeforeDelete-1);
        await evaluate(`document.getElementById('undo').click()`);
        assert.equal(await evaluate(`Number(document.querySelector('.sculpt-count').textContent.match(/of ([\\d,]+)/)[1].replace(/,/g,''))`),facesBeforeDelete);
        await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        assert.ok(await evaluate(`!!document.querySelector('[data-sculpt-tool="bridge"]')&&!!document.querySelector('[data-sculpt-tool="add-face"]')`),'new topology tools are discoverable beside selection');
        await evaluate(`document.querySelector('[data-mode=paint]').click();const c=document.querySelector('input[aria-label="Paint colour"]');c.value='#dd2233';c.dispatchEvent(new Event('input'));`);
        await call('Input.dispatchMouseEvent',{type:'mousePressed',...movePoint,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',...movePoint,button:'left',clickCount:1});
        await waitFor(`document.getElementById('status').textContent.startsWith('Painted ')`);
        await evaluate(`document.getElementById('undo').click();document.querySelector('[data-mode=build]').click()`);
        await call('Input.dispatchMouseEvent',{type:'mousePressed',...movePoint,button:'left',clickCount:1});
        const beforeMove=await evaluate(`document.querySelector('input[aria-label="X (left) value"]').value`);
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:movePoint.x+35,y:movePoint.y+10,button:'left',buttons:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:movePoint.x+35,y:movePoint.y+10,button:'left',clickCount:1});
        assert.notEqual(await evaluate(`document.querySelector('input[aria-label="X (left) value"]').value`),beforeMove,'dragging a visible part moves it without a move-mode toggle');
        await evaluate(`document.getElementById('undo').click()`);
        await evaluate(`document.getElementById('name').value='Spider goblin';document.getElementById('name').dispatchEvent(new Event('change'));document.getElementById('save').click();`);
        await waitFor(`document.getElementById('status').textContent==='Saved Spider goblin'`);
        await evaluate(`document.querySelector('[data-mode=build]').click()`);await screenshot('spider-goblin');
        await evaluate(`document.querySelector('[data-animation=idle]').click()`);await waitFor(`document.getElementById('status').textContent.includes('native frames')`);await evaluate(`document.getElementById('rest').click()`);
        await reload();await waitFor(`document.getElementById('name').value==='Spider goblin'`);
        assert.equal(await evaluate(`document.querySelectorAll('#parts .part').length`),3,'saved assembly restores after reload');
        await evaluate(`document.querySelector('[data-mode=data]').click();const s=document.querySelector('select[aria-label="Weak against"]');s.closest('details').open=true;s.value='1';s.dispatchEvent(new Event('change'));`);
        assert.equal(await evaluate(`document.querySelector('select[aria-label="Weak against"]').selectedOptions[0].textContent`),'Air (wind)','weakness uses named choices');
        assert.equal(await evaluate(`document.querySelector('input[aria-label="Elemental weakness bonus (%)"]').disabled`),false);
        await evaluate(`const d=document.querySelector('select[aria-label="What drops on a kill?"]');d.value='custom';d.dispatchEvent(new Event('change'));const i=document.querySelector('input[aria-label="Item to add"]');i.closest('details').open=true;i.value='995';i.dispatchEvent(new Event('input'));`);
        await waitFor(`Array.from(document.querySelectorAll('.picker-results button')).some(b=>b.textContent==='Coins')`);
        await evaluate(`Array.from(document.querySelectorAll('.picker-results button')).find(b=>b.textContent==='Coins').click()`);
        await waitFor(`!!document.querySelector('.data-drop-pick canvas')`);
        await evaluate(`document.querySelector('.data-drop-pick').scrollIntoView({block:'center'})`);
        await waitFor(`(()=>{const c=document.querySelector('.data-drop-pick canvas');return c&&Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data).filter((v,i)=>i%4!==3&&v>45).length>10})()`);
        await evaluate(`const n=document.querySelector('input[aria-label="Chance on each kill (%)"]');n.value='50';n.dispatchEvent(new Event('change'));Array.from(document.querySelectorAll('#properties button')).find(b=>b.textContent==='Try 10 kills').click()`);
        assert.equal(await evaluate(`document.querySelectorAll('ol[aria-label="Ten sample kills"] li').length`),10,'drop simulator displays ten outcomes without granting items');
        await screenshot('named-game-data');
        const metadata=await evaluate(`Promise.all(['/api/game-data?kind=npc&id=655','/api/drop-table?id=655','/api/special-donors?q=dragon','/api/search?kind=item&q=995&references=1'].map(async url=>{const r=await fetch(url);return {ok:r.ok,data:await r.json()};}))`);
        assert.ok(metadata.every(row=>row.ok),'game-data lookup routes are wired');
        assert.ok(metadata[2].data.rows.length>0,'special donors resolve bundled attacks');

        await evaluate(`document.querySelectorAll('#parts .part button')[2].click();document.querySelector('[data-mode=animate]').click();Array.from(document.querySelectorAll('#properties button')).find(b=>b.textContent==="Use this part's source movements").click();`);
        await waitFor(`Array.from(document.querySelectorAll('#properties button')).some(b=>b.textContent==='Source + poses'&&b.getAttribute('aria-pressed')==='true')`);
        assert.equal(await evaluate(`document.getElementById('build-library').hidden`),true,'Animate replaces the visual library with movement tools');
        await evaluate(`document.querySelector('button[aria-label="Play attack"]').click()`);await waitFor(`document.getElementById('status').textContent.startsWith('Attack preview.')`);
        await evaluate(`Array.from(document.querySelectorAll('#properties button')).find(b=>b.textContent==='Rest pose').click();Array.from(document.querySelectorAll('#job-tools button')).find(b=>b.textContent==='Swing').click();`);
        await waitFor(`document.getElementById('status').textContent.startsWith('Attack preview.') && document.querySelectorAll('.animate-pose-strip button').length===4`);
        await evaluate(`document.querySelector('.animate-pose-strip button[title="Edit pose 2"]').click()`);
        assert.ok(await evaluate(`!!document.querySelector('input[aria-label="Swing value"]')`),'poses expose direct movement sliders');
        await screenshot('part-animation');
        await waitFor(`document.querySelectorAll('.creature-attack-choice').length>0`);
        await evaluate(`document.querySelector('.creature-attack-choice button').click()`);
        await waitFor(`document.getElementById('status').textContent.startsWith('Trying ')&&document.querySelector('select[aria-label="Attack to edit"]').options.length===1`);
        await evaluate(`document.querySelectorAll('.creature-attack-choice button')[1].click()`);
        await waitFor(`document.querySelector('select[aria-label="Attack to edit"]').options.length===2&&!!document.querySelector('input[aria-label="Damage cap"]')`);
        assert.ok(await evaluate(`document.querySelector('select[aria-label="Attack to edit"]').selectedOptions[0].textContent.includes('attack')`),'saved attacks display names and styles');
        await evaluate(`Array.from(document.querySelectorAll('#properties button')).find(b=>b.textContent==='Rest pose').click()`);
        await evaluate(`document.querySelector('[data-mode=build]').click();document.querySelector('.view-menu').open=true;document.getElementById('outline').click();document.getElementById('gizmo').click();`);
        assert.equal(await evaluate(`document.getElementById('outline').checked`),false);assert.equal(await evaluate(`document.getElementById('gizmo').checked`),true,'gizmo is independent of selection rectangle');
        assert.ok(await evaluate(`!document.getElementById('attack-preview').hidden&&document.getElementById('attack-preview').options.length===2`),'Build offers the authored named attack in its quick preview');
        await screenshot('placement-gizmo');
        await evaluate(`document.querySelector('.view-menu').open=false;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        const axisPoint=await evaluate(`(()=>{const c=document.getElementById('view'),r=c.getBoundingClientRect(),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data,points=[];for(let i=0;i<p.length;i+=4)if(p[i]===237&&p[i+1]===121&&p[i+2]===109)points.push([i/4%c.width,Math.floor(i/4/c.width)]);if(!points.length)return null;const xs=points.map(p=>p[0]),middle=Math.min(...xs)+(Math.max(...xs)-Math.min(...xs))*.45;points.sort((a,b)=>Math.abs(a[0]-middle)-Math.abs(b[0]-middle));return{x:r.left+points[0][0]*r.width/c.width,y:r.top+points[0][1]*r.height/c.height}})()`);
        assert.ok(axisPoint,'the red movement handle is visible');
        const position=()=>evaluate(`['X (left)','Y (down)','Z (back)'].map(label=>Number(document.querySelector('input[aria-label="'+label+' value"]').value))`);
        const beforeAxis=await position();
        await call('Input.dispatchMouseEvent',{type:'mousePressed',...axisPoint,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:axisPoint.x+24,y:axisPoint.y,button:'left',buttons:1});
        const duringAxis=await position();assert.notEqual(duringAxis[0],beforeAxis[0],'gizmo updates inspector while the pointer is still down');
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:axisPoint.x+24,y:axisPoint.y,button:'left',clickCount:1});
        const afterAxis=await position();assert.notEqual(afterAxis[0],beforeAxis[0],'dragging the X handle moves the part');assert.deepEqual(afterAxis.slice(1),beforeAxis.slice(1),'the X handle leaves Y and Z unchanged');
        await evaluate(`document.getElementById('undo').click()`);
        await evaluate(`document.getElementById('export').click()`);await waitFor(`!document.getElementById('export-download').disabled`);
        await call('Page.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(temporary,'downloads')});
        await evaluate(`document.getElementById('export-download').click()`);await waitFor(`document.getElementById('status').textContent.startsWith('Plugin downloaded.')`);
        const requireServer=createRequire(path.join(root,'server/package.json'));const {readPluginZip}=requireServer(path.join(root,'server/plugins/tools/worldadmin/PluginZip.WorldAdmin.js'));
        // The directory appears before Chrome finishes and renames its .crdownload.
        for(let n=0;n<100&&(!fs.existsSync(path.join(temporary,'downloads'))||!fs.readdirSync(path.join(temporary,'downloads')).some(name=>name.endsWith('.zip')));n++)await new Promise(r=>setTimeout(r,50));
        const downloads=fs.readdirSync(path.join(temporary,'downloads')).filter(n=>n.endsWith('.zip'));assert.equal(downloads.length,1);readPluginZip(fs.readFileSync(path.join(temporary,'downloads',downloads[0])));
        await evaluate(`document.getElementById('export-dialog').close();document.querySelector('[data-workspace=gear]').click();`);
        await waitFor(`document.getElementById('source-kind').value==='item'&&document.getElementById('source-name').textContent.includes('scimitar')`);
        await search('item',4587);await waitFor(`document.getElementById('source-name').textContent==='Dragon scimitar'`);await evaluate(`document.querySelector('[data-part-key=whole] button').click()`);await waitFor(`document.getElementById('name').value==='Custom Dragon scimitar'`);
        await evaluate(`document.getElementById('variant').value='female';document.getElementById('variant').dispatchEvent(new Event('change'));document.getElementById('mannequin').click()`);
        await waitFor(`document.querySelector('#parts .part button')?.textContent==='Dragon scimitar'`);await screenshot('gear-creator');
        await evaluate(`(()=>{const original=window.fetch;window.fetch=(route,options)=>{if(route==='/api/animate')window.lastGearPreview=JSON.parse(options.body);return original(route,options);};const checkbox=document.getElementById('mannequin');checkbox.checked=true;checkbox.dispatchEvent(new Event('change'));})()`);
        await evaluate(`document.querySelector('[data-animation=idle]').click()`);await waitFor(`window.lastGearPreview&&document.getElementById('status').textContent.includes('native frames')`);assert.ok(await evaluate(`window.lastGearPreview.mesh.vertices.length>150`),'quick idle includes the native player for standalone gear');await screenshot('gear-quick-idle-with-body');
        await evaluate(`document.getElementById('rest').click();const checkbox=document.getElementById('mannequin');checkbox.checked=false;checkbox.dispatchEvent(new Event('change'));window.lastGearPreview=null;`);await evaluate(`document.querySelector('[data-animation=walk]').click()`);await waitFor(`window.lastGearPreview&&document.getElementById('status').textContent.includes('native frames')`);assert.ok(await evaluate(`window.lastGearPreview.mesh.alpha.filter(a=>a===255).length>100`),'hidden references retain the body rig for correct pivots');await evaluate(`document.getElementById('rest').click()`);

        await evaluate(`document.querySelector('[data-mode=data]').click()`);await waitFor(`Array.from(document.querySelectorAll('#properties label')).some(l=>l.textContent.startsWith('Magic damage'))`);
        await evaluate(`Array.from(document.querySelectorAll('#properties details')).find(d=>d.querySelector('summary').textContent==='Equipment bonuses').open=true;const l=Array.from(document.querySelectorAll('#properties label')).find(l=>l.textContent.startsWith('Magic damage'));l.querySelector('input').value='16.5';l.querySelector('input').dispatchEvent(new Event('change'));`);
        assert.equal(await evaluate(`Array.from(document.querySelectorAll('#properties details')).find(d=>d.querySelector('summary').textContent==='Equipment bonuses').open`),true);
        await evaluate(`Array.from(document.querySelectorAll('#properties button')).find(b=>b.textContent==='Special Attacks').click();Array.from(document.querySelectorAll('.combat-behaviour button')).find(b=>b.textContent==='Create an attack').click()`);
        await waitFor(`!!document.querySelector('input[aria-label="Number of hits"]')`);
        assert.equal(await evaluate(`document.querySelector('input[aria-label="Number of hits"]').value`),'2','original special starts with two configurable native hits');
        assert.equal(await evaluate(`document.querySelector('input[aria-label="Damage multiplier"]').value`),'1.15','the damage modifier uses an exact, readable value');
        await evaluate(`document.querySelector('.gear-effects').scrollIntoView({block:'start'})`);await screenshot('gear-effects');
        await evaluate(`document.getElementById('save').click()`);await waitFor(`document.getElementById('status').textContent==='Saved Custom Dragon scimitar'`);
        await evaluate(`document.querySelector('.inspector').scrollTop=0`);await screenshot('gear-game-data');
        await evaluate(`const reference=document.getElementById('mannequin');reference.checked=true;reference.dispatchEvent(new Event('change'));document.querySelector('[data-mode=animate]').click();document.querySelector('button[aria-label="Play attack"]').click()`);
        await waitFor(`document.getElementById('status').textContent.startsWith('Attack preview.')`);
        assert.ok(await painted('#view')>500,'gear animation renders the native player with worn gear');
        await screenshot('gear-animation');
        await evaluate(`Array.from(document.querySelectorAll('#properties button')).find(b=>b.textContent==='Next frame').click()`);
        await waitFor(`document.querySelector('input[aria-label="Preview position"]')?.disabled===false`);
        await evaluate(`document.querySelector('[data-mode=paint]').click();const scope=document.querySelector('select[aria-label="Apply to"]');scope.value='all';scope.dispatchEvent(new Event('change'));document.querySelector('.paint-preset').click()`);
        await waitFor(`!!document.querySelector('canvas[aria-label="After palette preview, current view"]')`);
        assert.ok(await evaluate(`document.querySelector('#properties').textContent.includes('Applying also paints every other item view')`),'gear palette scope explains all-view application');
        await screenshot('gear-palette');
        await evaluate(`document.querySelector('[data-mode=build]').click()`);
        // A rotated attachment's labels and visible Size handles must agree.
        await evaluate(`for(const [label,value] of [['Pitch',82],['Yaw',180]]){const input=document.querySelector('input[aria-label="'+label+' value"]');input.value=value;input.dispatchEvent(new Event('change'));}`);
        assert.equal(await evaluate(`document.querySelector('input[aria-label="Height value"]').closest('label').querySelector('small').textContent`),'Z');
        const heightControl=await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Height value"]');input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',...heightControl});
        await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        assert.equal(await evaluate(`document.getElementById('gizmo-mode').value`),'move','hover does not switch the chosen transform mode');
        await screenshot('rotated-scale-direction');
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
        await evaluate(`document.getElementById('undo').click();document.getElementById('undo').click()`);
        assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'desktop fits without overflow');
        await call('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});
        await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        assert.equal(await evaluate(`innerWidth`),430,'closed drawers do not enlarge the mobile viewport');
        assert.ok(await evaluate(`document.getElementById('view').getBoundingClientRect().width>=420`),'the mobile model uses the full width');
        await evaluate(`document.getElementById('toggle-properties').click()`);assert.equal(await evaluate(`document.getElementById('toggle-properties').getAttribute('aria-expanded')`),'true');
        assert.ok(await evaluate(`document.querySelector('.inspector').getBoundingClientRect().right<=innerWidth+1`),'properties drawer opens inside the screen');
        await screenshot('mobile-properties');await evaluate(`document.getElementById('toggle-properties').click()`);
        await screenshot('mobile-creator');assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'narrow layout fits');
        await call('Emulation.setDeviceMetricsOverride',{width:1500,height:960,deviceScaleFactor:1,mobile:false});
        const overlays=await evaluate(`(async()=>{
            const{Viewport}=await import('/viewport.mjs');const canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;
            let highlighted=null;const view=new Viewport(canvas,{passive:true,faceOverlay:p=>p.partId===highlighted?{fill:'#ff0000cc',stroke:'#ff0000',lineWidth:2}:null});
            view.yaw=0;view.pitch=0;view.target=[0,0,0];view.distance=400;
            const mesh=z=>({vertices:[[-80,-80,z],[0,80,z],[80,-80,z]],faces:[[0,1,2,22000]]});
            view.setItems([{id:'rear',mesh:mesh(40)},{id:'front',mesh:mesh(0)}]);
            const pixel=()=>Array.from(canvas.getContext('2d').getImageData(150,150,1,1).data);
            const results=[];for(const native of [true,false]){
                if(!native)view.materialRenderer={draw:()=>false,drawFallbackFace:()=>false};highlighted=null;view.draw(0);const before=pixel();
                highlighted='rear';view.draw(0);const hidden=pixel();highlighted='front';view.draw(0);const visible=pixel();
                results.push({native,before,hidden,visible});
            }return results;
        })()`);
        for(const result of overlays){assert.deepEqual(result.hidden,result.before,`hidden face overlays stay occluded with native materials=${result.native}`);assert.notDeepEqual(result.visible,result.before,`visible face overlays render with native materials=${result.native}`);}
        const textured=await evaluate(`(async()=>{const{Viewport}=await import('/viewport.mjs'),{texturesReady}=await import('/materials.mjs'),source=await(await fetch('/api/source?kind=item&id=6570&variant=male')).json(),canvas=document.createElement('canvas');canvas.width=600;canvas.height=600;canvas.style.cssText='position:fixed;inset:100px auto auto 400px;z-index:9999';document.body.append(canvas);const view=new Viewport(canvas,{passive:true});view.setItems([{id:'cape',mesh:source.mesh}]);view.fit();view.yaw=Math.PI;await texturesReady(source.mesh);view.draw(0);const before=canvas.getContext('2d').getImageData(0,0,600,600).data;view.draw(1200);const after=canvas.getContext('2d').getImageData(0,0,600,600).data;let changed=0;for(let i=0;i<before.length;i+=4)if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2])changed++;window.textureCanvas=canvas;return{webgl:!!view.materialRenderer.gl,loaded:view.materialRenderer.textures.size,changed};})()`);
        assert.equal(textured.webgl,true,'Chrome uses the textured renderer');assert.ok(textured.loaded>0,'native texture pixels load');assert.ok(textured.changed>100,'the fire cape pattern moves without a creature animation');
        await screenshot('animated-texture');await evaluate(`window.textureCanvas.remove();delete window.textureCanvas`);
        // Standalone entry buttons also preserve both unsaved drafts without a replacement prompt.
        await evaluate(`document.getElementById('name').value='Standalone gear draft';document.getElementById('name').dispatchEvent(new Event('change'));document.querySelector('[data-workspace=npc]').click()`);
        await waitFor(`document.getElementById('project-kind').value==='npc'&&document.getElementById('name').value==='Spider goblin'&&document.querySelector('#results [aria-selected="true"]')?.dataset.source.startsWith('npc/')&&['Restored unsaved project.','Drag a part into the centre, or click Add.'].includes(document.getElementById('status').textContent)`);
        await evaluate(`document.getElementById('name').value='Standalone NPC draft';document.getElementById('name').dispatchEvent(new Event('change'));document.querySelector('[data-workspace=gear]').click()`);
        await waitFor(`document.getElementById('name').value==='Standalone gear draft'&&document.querySelector('#results [aria-selected="true"]')?.dataset.source.startsWith('item/')&&document.getElementById('status').textContent==='Restored unsaved project.'`);
        await evaluate(`document.querySelector('[data-workspace=npc]').click()`);
        await waitFor(`document.getElementById('name').value==='Standalone NPC draft'&&document.querySelector('#results [aria-selected="true"]')?.dataset.source.startsWith('npc/')&&document.getElementById('status').textContent==='Restored unsaved project.'`);
        assert.equal(await evaluate(`document.getElementById('save-state').textContent`),'Unsaved');
        await evaluate(`document.getElementById('open').click()`);
        await waitFor(`document.getElementById('projects-dialog').open`);
        assert.ok(!(await evaluate(`document.getElementById('projects').textContent`)).includes('Dragon scimitar'),'Open lists projects for this creator');
        await evaluate(`document.getElementById('projects-dialog').close()`);
        // Exercise the native entry host with the actual plugin's declared contributions.
        const pluginModule = { exports: {} as any }, endpoints: any = {};
        vm.runInNewContext(fs.readFileSync(path.join(root, 'server/plugins/tools/content-builders/ContentBuilders.entry.js'), 'utf8'), {
            module: pluginModule, require: requireServer, __dirname: path.join(root, 'server/plugins/tools/content-builders'),
            process: { env: { CACHE_EDITOR_ENABLED: '1' }, execPath: process.execPath }, console,
        });
        pluginModule.exports.register({ registerContentEndpoint: (name, fn) => endpoints[name] = fn, onCustomEvent() {}, onServerStartup() {}, onServerShutdown() {} });
        const contributedTools = endpoints['cache-editor-tools']().tools.map(tool => ({ ...tool, url: origin + new URL(tool.url).pathname + new URL(tool.url).search }));
        const requireClient = createRequire(path.join(root, 'client/package.json')), esbuild = requireClient('esbuild');
        const bundle = await esbuild.build({
            stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CacheEditorTools}from${JSON.stringify(path.join(root,'client/custom/cache-editor/CacheEditorTools.tsx'))};
                function Host(){const[selection,setSelection]=React.useState(null);const[mode,setMode]=React.useState('definitions');
                    window.chooseSource=(kind,id)=>setSelection({kind,id,exists:true,name:'Source',label:kind});
                    return <main className="cache-editor" style={{position:'fixed',inset:0,display:'grid',gridTemplateColumns:'300px minmax(0,1fr)',gridTemplateRows:'60px minmax(0,1fr)',background:'#17181b',color:'#e4dfd3',font:'14px Segoe UI,sans-serif'}}>
                        <header className="cache-editor-header"><strong>Cache editor</strong><CacheEditorTools contentBase={${JSON.stringify(origin)}} selection={selection} onReturn={next=>{window.returned=next;setMode(next)}}/></header>
                        <aside className="cache-editor-sidebar"><div className="cache-editor-mode-tabs" role="tablist" aria-label="Cache editor sections" style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            <button role="tab" aria-selected={mode==='definitions'} onClick={()=>setMode('definitions')}>Definitions</button><button role="tab" aria-selected={mode==='assets'} onClick={()=>setMode('assets')}>Assets</button>
                        </div><p>Native sidebar</p></aside><article>Native {mode}</article></main>;
                }createRoot(document.getElementById('host')).render(<Host/>);`, resolveDir: path.join(root,'client'), loader:'tsx' },
            bundle:true,write:false,format:'esm',jsx:'automatic',logLevel:'silent',plugins:[{name:'test-content-api',setup(build){
                build.onResolve({filter:/network\/serverConnection\/contentApi$/},()=>({path:'test-api',namespace:'test'}));
                build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export async function fetchContent(){return(await fetch('/test-tools')).json()}`}));
            }}],
        });
        let toolUnavailable = false, pluginEnabled = true;
        const originalHandler = app.server.listeners('request')[0];
        app.server.removeAllListeners('request');
        app.server.on('request', (req,res) => {
            const route = req.url?.split('?')[0];
            if (route === '/test-host') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/test-host.css"><body style="margin:0"><div id="host"></div><script>const realTimeout=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>realTimeout(fn,ms===12000?400:ms,...args);</script><script type="module" src="/test-host.mjs"></script>'); }
            else if (route === '/test-host.mjs') { res.setHeader('Content-Type','text/javascript'); res.end(bundle.outputFiles[0].contents); }
            else if (route === '/test-host.css') { res.setHeader('Content-Type','text/css'); res.end(fs.readFileSync(path.join(root,'client/custom/cache-editor/CacheEditor.css'))); }
            else if (route === '/test-tools') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({tools:pluginEnabled ? contributedTools : []})); }
            else if (toolUnavailable && route === '/embedded') { res.writeHead(503,{'Content-Type':'text/html'}); res.end('Temporarily offline'); }
            else originalHandler(req,res);
        });
        const activeFrame = `document.querySelector('[data-cache-tool-overlay] [role=tabpanel]:not([hidden]) iframe')`;
        const frameDocument = `${activeFrame}.contentDocument`;
        const safeFrameDocument = `${activeFrame}?.contentDocument`;
        const frameReady = `${safeFrameDocument}?.querySelectorAll('#part-cards .part-card').length>0`;
        await call('Emulation.setDeviceMetricsOverride',{width:1500,height:960,deviceScaleFactor:1,mobile:false});
        await call('Page.navigate',{url:origin+'/test-host'});
        await waitFor(`document.querySelectorAll('.cache-editor-mode-tabs button').length===4`);
        assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.cache-editor-mode-tabs button'),b=>b.textContent)`), ['Definitions','Assets','NPC Creator','Gear Creator']);
        assert.equal(await evaluate(`document.querySelectorAll('.cache-editor-header button, iframe').length`),0,'no nested header launcher or eager workspace');
        await clickText('NPC Creator'); await waitFor(frameReady);
        assert.equal(await evaluate(`${frameDocument}.title`),'NPC Creator | TSPS');
        assert.equal(await evaluate(`${frameDocument}.querySelector('select#project-kind')`),null,'no Creature/Gear dropdown');
        assert.equal(await evaluate(`${frameDocument}.querySelector('.creators').getClientRects().length`),0,'embedded entry has no second Creator navigation');
        assert.ok(await evaluate(`${activeFrame}.getBoundingClientRect().width>innerWidth-10`),'the editor spans the native page');
        assert.equal(await evaluate(`getComputedStyle(${frameDocument}.querySelector('.library')).display`),'flex');
        await evaluate(`window.chooseSource('npc',7221)`);
        await waitFor(`${frameDocument}.getElementById('source-name').textContent==='Scurrius'`);
        const frameName = await evaluate(`${frameDocument}.getElementById('name').value`);
        await evaluate(`window.npcWindow=${activeFrame}.contentWindow;true`);
        await screenshot('embedded-npc-creator');
        await clickText('Definitions'); assert.equal(await evaluate('window.returned'),'definitions');
        await clickText('NPC Creator');
        assert.equal(await evaluate(`${activeFrame}.contentWindow===window.npcWindow`),true,'native switching retains the frame and undo state');
        assert.equal(await evaluate(`${frameDocument}.getElementById('name').value`),frameName);
        await clickText('Gear Creator'); await waitFor(frameReady);
        assert.equal(await evaluate(`${frameDocument}.getElementById('project-kind').value`),'gear');
        const gearDraft = 'Unsaved native gear';
        await evaluate(`${frameDocument}.getElementById('name').value=${JSON.stringify(gearDraft)};${frameDocument}.getElementById('name').dispatchEvent(new Event('change'))`);
        await evaluate(`window.gearWindow=${activeFrame}.contentWindow;true`);
        await clickText('NPC Creator');
        assert.equal(await evaluate(`${activeFrame}.contentWindow===window.npcWindow`),true);
        assert.equal(await evaluate(`${frameDocument}.getElementById('name').value`),frameName,'gear edits do not replace the creature assembly');
        await clickText('Gear Creator');
        assert.equal(await evaluate(`${frameDocument}.getElementById('name').value`),gearDraft);
        await clickText('Assets'); assert.equal(await evaluate('window.returned'),'assets');
        await clickText('Gear Creator');
        assert.equal(await evaluate(`${activeFrame}.contentWindow===window.gearWindow`),true);
        assert.equal(await evaluate(`document.querySelector('.cache-editor-sidebar').inert`),true,'covered native controls are not keyboard targets');
        const tabPoint = await evaluate(`(()=>{const r=document.querySelector('[data-cache-tool-overlay] [aria-selected=true]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await call('Input.dispatchMouseEvent',{type:'mousePressed',...tabPoint,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',...tabPoint,button:'left',clickCount:1});
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
        await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
        assert.equal(await evaluate('document.activeElement.textContent'),'NPC Creator','arrow keys reach the adjacent workspace');
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await waitFor(`${activeFrame}.title==='NPC Creator'`);
        await call('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});
        await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        assert.equal(await evaluate('innerWidth'),430,'the host uses the phone viewport');
        assert.equal(await evaluate(`${activeFrame}.contentWindow.innerWidth`),430,'the embedded creator uses the phone viewport');
        assert.ok(await evaluate(`${activeFrame}.getBoundingClientRect().width>=420`),'embedded mobile workspace uses the full width');
        assert.ok(await evaluate(`${frameDocument}.querySelector('.topbar').getBoundingClientRect().height<140`),'embedded mobile header stays compact');
        await screenshot('embedded-mobile-npc');
        await call('Emulation.setDeviceMetricsOverride',{width:1500,height:960,deviceScaleFactor:1,mobile:false});
        // Old URLs and drafts still work. The untouched active legacy draft is a fallback.
        const oldDraft = 'Unsaved shortcut creature';
        await evaluate(`(async()=>{
            const f=${activeFrame}.contentWindow,result=await(await f.fetch('/api/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'npc',baseId:655,partKey:'body'})})).json();
            result.project.name=${JSON.stringify(oldDraft)};result.dirty=true;
            const db=await new Promise(r=>{const request=f.indexedDB.open('tsps-content-forge',1);request.onsuccess=()=>r(request.result)});
            await new Promise(r=>{const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts');store.put(result,'active');store.put(result,'workspace:npc');store.delete('workspace:gear');tx.oncomplete=r;});db.close();
        })()`);
        await call('Page.navigate',{url:origin+'/test-host?tool=content-builders&tool-view=gear'}); await waitFor(frameReady);
        assert.equal(await evaluate(`${frameDocument}.getElementById('project-kind').value`),'gear');
        assert.equal(await evaluate(`${frameDocument}.getElementById('source-kind').value`),'item');
        assert.equal(await evaluate(`${frameDocument}.getElementById('name').value`),'','a legacy NPC draft never becomes a gear draft');
        await evaluate(`window.chooseSource('npc',655)`);
        await waitFor(`${frameDocument}.getElementById('source-name').textContent==='Goblin'`);
        await evaluate(`${frameDocument}.querySelector('.part-card button').click()`);
        await waitFor(`${frameDocument}.getElementById('status').textContent.startsWith('Start with an item.')`);
        assert.equal(await evaluate(`${frameDocument}.getElementById('name').value`),'','a different source type does not silently change creators');
        await evaluate(`window.chooseSource('item',4587)`);
        await waitFor(`${frameDocument}.getElementById('source-name').textContent==='Dragon scimitar'`);
        await evaluate(`${frameDocument}.querySelector('.part-card button').click()`);
        await waitFor(`${frameDocument}.querySelectorAll('#parts .part').length>0`);
        await evaluate(`${frameDocument}.getElementById('name').value=${JSON.stringify(gearDraft)};${frameDocument}.getElementById('name').dispatchEvent(new Event('change'))`);
        await evaluate(`new Promise(r=>setTimeout(r,450))`);
        await call('Page.navigate',{url:origin+'/test-host?tool=content-builders&tool-view=npc'});
        await waitFor(`${safeFrameDocument}?.getElementById('name')?.value===${JSON.stringify(oldDraft)}`);
        assert.equal(await evaluate(`${frameDocument}.getElementById('save-state').textContent`),'Unsaved');
        await call('Page.navigate',{url:origin+'/test-host?tool=gear-editor'});
        await waitFor(`${safeFrameDocument}?.getElementById('name')?.value===${JSON.stringify(gearDraft)}`);
        await call('Page.navigate',{url:origin+'/test-host?tool=content-builders'});
        await waitFor(`${safeFrameDocument}?.getElementById('name')?.value===${JSON.stringify(oldDraft)}`);
        toolUnavailable = true;
        await call('Page.navigate',{url:origin+'/test-host?tool=npc-editor'});
        await waitFor(`!!document.querySelector('[role=alert]')`);
        assert.match(await evaluate(`document.querySelector('[role=alert]').textContent`),/NPC Creator is not responding/);
        assert.ok(!(await evaluate('document.body.textContent')).includes('CACHE_EDITOR_ENABLED=1'));
        toolUnavailable = false; await clickText('Retry now');
        await waitFor(`${frameReady}&&!document.querySelector('[role=alert]')`);
        pluginEnabled = false;
        await call('Page.navigate',{url:origin+'/test-host?tool=npc-editor'});
        await waitFor(`document.querySelectorAll('.cache-editor-mode-tabs button').length===2`);
        assert.equal(await evaluate(`document.querySelectorAll('iframe').length`),0,'absent or disabled plugins leave only native sections');
        assert.deepEqual(errors, [], 'no browser runtime exceptions');
    } finally {
        socket?.close();
        if (child && child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done; }
        await new Promise<void>(resolve => app.server.close(() => resolve())); app.cache.close();
        fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3 });
    }
});
