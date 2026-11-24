import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { findRoot } from './root.mjs';
import { extract } from './shared/mesh.mjs';
import { BuilderCache } from './cache';
import { ProjectStore } from './store.mjs';
import { newProject, makePart, validateProject } from './shared/project.mjs';
import { compileProject, pluginZip } from './export.mjs';
import { validateMesh } from './shared/mesh.mjs';
import { compileMotion } from './shared/motion.mjs';
import { attackRole } from './shared/creature-attacks.mjs';
import { SET_FORMAT, SET_ITEM_LIMIT, isGearSet, validateDocument, validateGearSet, documentItems } from './shared/gear-set.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 24 * 1024 * 1024;
const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
async function body(req: http.IncomingMessage) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Send JSON.'), { status: 415 });
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(new Error('Project exceeds the 24 MB request limit.'), { status: 413 }); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createBuilderServer({ root = findRoot(), directory = process.env.CONTENT_BUILDERS_PROJECTS ?? path.join(here, '.local/projects'), cache = new BuilderCache(root) } = {}) {
    const store = new ProjectStore(directory, root);
    // The existing store reserves six standard actions. Optional attack clips
    // reserve their own eight-ID block and are considered by every HTTP allocator.
    const reserveSequences = (count: number, reserved: any[] = []) => {
        const used=new Set<number>(),include=(ids:any)=>{
            for(const [base,length] of [[ids?.sequenceBase,6],[ids?.attackSequenceBase,8]])if(Number.isInteger(base))for(let n=0;n<length;n++)used.add(base+n);
        };
        for(const row of store.list())if(!row.error)for(const ids of row.identities??[row.ids])include(ids);
        reserved.forEach(include);
        const imported=path.join(root,'server/plugins/imported');
        if(fs.existsSync(imported))for(const entry of fs.readdirSync(imported,{withFileTypes:true}))if(entry.isDirectory()){
            const dir=path.join(imported,entry.name);for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.plugin.js'))){const file=path.join(dir,name);if(fs.statSync(file).size>1024*1024)continue;const match=fs.readFileSync(file,'utf8').match(/^\/\/ content-builders:identity (.+)\n/);if(match){const identity=JSON.parse(match[1]);for(const ids of identity.items??[identity])include(ids);}}
        }
        for(let base=Math.max(50000,cache.counts().seq);base+count-1<=65534;base++)if(Array.from({length:count},(_,n)=>base+n).every(id=>!used.has(id)))return base;
        throw new Error('No custom movement IDs remain.');
    };
    const allocateIdentity=(kind:string,reserved:any[]=[])=>({...store.allocate(kind,reserved),sequenceBase:reserveSequences(6,reserved)});
    const reassignDocument=(input:any)=>{
        const p=validateDocument(input),reserved=documentItems(p).map((item:any)=>item.ids);
        for(const item of documentItems(p)){
            item.ids=allocateIdentity(item.kind,reserved);reserved.push(item.ids);
            if(item.attacks.length){const base=reserveSequences(14,reserved);item.ids.sequenceBase=base;item.ids.attackSequenceBase=base+6;reserved.push(item.ids);}
        }
        return p;
    };
    const createSetItem=(baseId:number,reserved:any[])=>{
        const source=cache.describe('item',baseId,'inventory'),item:any=newProject(`creation-${randomUUID().slice(0,8)}`,'gear',source,allocateIdentity('gear',reserved),cache.info.name);
        for(const variant of ['male','female','maleHead','femaleHead'])try{item.parts.push(makePart(cache.describe('item',source.id,variant),variant));}catch(error:any){if(['male','female'].includes(variant))item.warnings.push(error.message);}
        return item;
    };
    const adoptSavedSequences=(project:any)=>{
        // Older hosts copy only sequenceBase out of a save response. Retain a
        // matching saved attack block until those hosts adopt the full ID object.
        if(project.ids.attackSequenceBase || !fs.existsSync(store.file(project.id)))return;
        const saved=store.read(project.id).project;
        if(saved.ids.definition===project.ids.definition&&saved.ids.modelBase===project.ids.modelBase&&saved.ids.sequenceBase===project.ids.sequenceBase&&saved.ids.attackSequenceBase)project.ids.attackSequenceBase=saved.ids.attackSequenceBase;
    };
    const env = fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '';
    const clientPort = Number(process.env.PORT ?? env.match(/^PORT=(\d+)$/m)?.[1] ?? 3000);
    const panelPort = Number(process.env.WORLD_ADMIN_PORT ?? env.match(/^WORLD_ADMIN_PORT=(\d+)$/m)?.[1] ?? 49600);
    const panelProtocol = process.env.WORLD_ADMIN_TLS_CERT || env.match(/^WORLD_ADMIN_TLS_CERT=.+$/m) ? 'https' : 'http';
    const navigation = { cacheEditor: `http://localhost:${clientPort}/?cache=1`, webPanel: `${panelProtocol}://localhost:${panelPort}/` };
    const server = http.createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
        // The game uses cross-origin isolation for its workers. An embedded local tool must
        // opt in too, even though it does not need SharedArrayBuffer itself.
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Content-Security-Policy', `default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'self' http://localhost:${clientPort} http://127.0.0.1:${clientPort}; base-uri 'none'`);
        try {
            const port = (server.address() as any)?.port;
            const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
            if (!allowed.includes(req.headers.host ?? '') || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Use the local builder address.' });
            if (req.headers.origin && !allowed.some(host => req.headers.origin === `http://${host}`)) return json(res, 403, { error: 'Use the local builder page.' });
            const url = new URL(req.url ?? '/', 'http://localhost'), route = url.pathname;
            const get = req.method === 'GET', post = req.method === 'POST';
            if (get && route === '/api/info') return json(res, 200, { cache: cache.info, counts: cache.counts(), weaponStyles: cache.weaponStyles(), storage: directory, navigation, features: { gearSetStart: true, parentAnimationAttachments: true, combatVisuals: true, nativeEffectTemplates: true, visualAssetBrowser: true, effectTriggers: true } });
            if (get && route === '/api/search') return json(res, 200, cache.search(url.searchParams.get('kind') ?? 'npc', (url.searchParams.get('q') ?? '').slice(0, 100), Math.max(0, Math.min(100000, Number(url.searchParams.get('offset')) || 0)), { creaturesOnly: url.searchParams.get('creaturesOnly') === '1', unique: url.searchParams.get('unique') === '1', references:url.searchParams.get('references')==='1' }));
            if(get&&route==='/api/game-data')return json(res,200,cache.gameData(url.searchParams.get('kind')??'npc',Number(url.searchParams.get('id'))));
            if(get&&route==='/api/drop-table')return json(res,200,cache.dropTable(Number(url.searchParams.get('id'))));
            if(get&&route==='/api/special-donors')return json(res,200,cache.specialDonors(url.searchParams.get('q')??'',Number(url.searchParams.get('offset'))||0));
            if(get&&route==='/api/special-features')return json(res,200,cache.specialFeatures());
            if(get&&route==='/api/creature-attacks')return json(res,200,cache.attackChoices(Number(url.searchParams.get('id'))));
            if(get&&route==='/api/visual-effect')return json(res,200,cache.effect(Number(url.searchParams.get('id'))));
            if(get&&route==='/api/effect-references')return json(res,200,cache.effectReferences(url.searchParams.get('kind')??'special',(url.searchParams.get('q')??'').slice(0,100),Math.max(0,Number(url.searchParams.get('offset'))||0)));
            if(get&&route==='/api/combat-enemies')return json(res,200,{rows:cache.combatEnemies()});
            if(get&&route==='/api/character-animations')return json(res,200,cache.movementChoices(url.searchParams.get('q')??'',Number(url.searchParams.get('offset'))||0,{actor:url.searchParams.get('actor')??'player',npcId:Number(url.searchParams.get('npcId')??-1),category:url.searchParams.get('category')??'all'}));
            if(get&&route==='/api/animation-preview')return json(res,200,cache.movementPreview(Number(url.searchParams.get('id')),{actor:url.searchParams.get('actor')??'player',npcId:Number(url.searchParams.get('npcId')??-1),gender:url.searchParams.get('gender')??'male'}));
            if (get && route === '/api/source') return json(res, 200, cache.describe(url.searchParams.get('kind') ?? 'npc', Number(url.searchParams.get('id')), url.searchParams.get('variant') ?? 'body'));
            if (get && route === '/api/texture') return json(res,200,cache.texture(Number(url.searchParams.get('id'))));
            if(post&&route==='/api/animate-gear'){
                const input=await body(req);if(!Array.isArray(input.projects)||!input.projects.length||input.projects.length>16||!['male','female'].includes(input.variant))throw new Error('Choose worn gear projects and a player model view.');
                const projects=input.projects.map(validateProject);if(projects.some(p=>p.kind!=='gear'))throw new Error('Only gear belongs in a fitting preview.');
                const sequence=Number(input.sequence);if(!Number.isInteger(sequence)||!cache.movementChoices(String(sequence),0,{actor:'player'}).rows.some(row=>row.id===sequence))throw new Error('Choose a compatible player movement.');
                const style=input.style==='character'?'character':'dummy',reference=cache.mannequin(input.variant,projects.map(p=>p.settings.equipmentType),style);
                return json(res,200,cache.animateGear(projects,input.variant,sequence,reference.mesh,{visible:input.visible===true,style}));
            }
            if(get&&route==='/api/gear-textures')return json(res,200,cache.textureCatalog((url.searchParams.get('q')??'').slice(0,100),Math.max(0,Number(url.searchParams.get('offset'))||0)));
            if(get&&route==='/api/hitsplat-themes')return json(res,200,{rows:cache.hitsplatThemes()});
            if(get&&route==='/api/preview-ammunition')return json(res,200,{ammunition:cache.previewAmmunition(Number(url.searchParams.get('weaponId')??-1))});
            if(get&&route==='/api/combat-audio')return json(res,200,cache.combatAudio(Number(url.searchParams.get('npcId')??-1),Number(url.searchParams.get('weaponId')??-1)));
            if(get&&route==='/api/sound'){const wave=cache.sound(Number(url.searchParams.get('id')),Number(url.searchParams.get('loops')??1));res.writeHead(200,{'Content-Type':'audio/wav'});return res.end(wave);}
            if (get && route === '/api/mannequin') return json(res, 200, cache.mannequin(url.searchParams.get('gender') ?? 'male', url.searchParams.has('slots')?(url.searchParams.get('slots')??'').split(',').slice(0,24):url.searchParams.get('slot') ?? 'NONE', url.searchParams.get('style') ?? 'dummy'));
            if (get && route === '/api/preview-scene') return json(res, 200, cache.previewScene(url.searchParams.get('id') ?? 'studio'));
            if (get && route === '/api/projects') return json(res, 200, { projects: store.list() });
            if (get && route.startsWith('/api/projects/')) return json(res, 200, store.read(decodeURIComponent(route.slice('/api/projects/'.length))));
            if (post && route === '/api/create') {
                const input = await body(req), kind = input.kind === 'gear' ? 'gear' : 'npc';
                const source = cache.describe(kind === 'npc' ? 'npc' : 'item', Number(input.baseId), kind === 'npc' ? 'body' : 'inventory');
                const id = `creation-${randomUUID().slice(0, 8)}`, project: any = newProject(id, kind, source, allocateIdentity(kind), cache.info.name);
                if (input.partKey && input.partKey !== 'whole') {
                    const donor = input.variant && input.variant !== source.variant ? cache.describe(kind === 'npc' ? 'npc' : 'item', source.id, input.variant) : source;
                    const offer = donor.parts.find(part => part.key === input.partKey);
                    if(!offer)throw new Error('Choose a part from this source.');
                    project.parts[0].mesh = extract(donor.mesh, offer.faces);
                    project.parts[0].name = `${offer.name} (${source.name})`;
                    project.parts[0].role = offer.role;
                    project.parts[0].source.region = offer.key;
                }
                if (kind === 'gear') for (const variant of ['male', 'female', 'maleHead', 'femaleHead']) {
                    try { project.parts.push(makePart(cache.describe('item', source.id, variant), variant)); }
                    catch (error: any) { if (['male', 'female'].includes(variant)) project.warnings.push(error.message); }
                }
                return json(res, 201, store.save(project, null));
            }
            if(post&&route==='/api/gear-set'){
                const input=await body(req),item=input.project?validateProject(input.project):createSetItem(Number(input.baseId),[]);if(item.kind!=='gear')throw new Error('Start with a gear item.');
                const copy=input.project?reassignDocument(item):item,set={format:SET_FORMAT,id:`gear-set-${randomUUID().slice(0,8)}`,kind:'gear',name:input.name??`${item.name} set`,items:[copy]};
                return json(res,201,store.save(set,null));
            }
            if(post&&route==='/api/gear-set/item'){
                const input=await body(req),set=validateGearSet(input.project);if(set.items.length>=SET_ITEM_LIMIT)throw new Error(`Keep at most ${SET_ITEM_LIMIT} items in a gear set.`);
                let item:any;
                if(input.item){
                    item=validateProject(input.item);if(item.kind!=='gear')throw new Error('Choose a gear item.');
                    const oldId=item.id,oldDefinition=item.ids.definition;item.id=`creation-${randomUUID().slice(0,8)}`;
                    for(const effect of item.effects.passives)for(const piece of effect.set?.pieces??[])piece.itemIds=piece.itemIds.map((value:any)=>value===`item:${oldId}`||value===oldDefinition?'self':value);
                    item.ids=allocateIdentity('gear',set.items.map(item=>item.ids));
                }else item=createSetItem(Number(input.baseId),set.items.map(item=>item.ids));
                set.items.push(item);return json(res,201,store.save(set,input.revision,input.editor));
            }
            if (post && route === '/api/save') {
                const input = await body(req),p=validateDocument(input.project);
                if(isGearSet(p))return json(res,200,store.save(p,input.revision,input.editor));
                adoptSavedSequences(p);
                if(!p.ids.sequenceBase)p.ids.sequenceBase=reserveSequences(6);
                if(p.attacks.length&&!p.ids.attackSequenceBase){
                    // Include this unsaved project's standard block in this allocation.
                    let base=reserveSequences(14);p.ids.sequenceBase=base;p.ids.attackSequenceBase=base+6;
                }
                return json(res,200,store.save(p,input.revision,input.editor));
            }
            if (post && route === '/api/import') {
                const input=await body(req),p=reassignDocument(input.project);p.id=`${isGearSet(p)?'gear-set':'creation'}-${randomUUID().slice(0,8)}`;
                for(const item of documentItems(p))if(item.cache!==cache.info.name)item.warnings.push(`Imported from ${item.cache}. Check template IDs and animation rigs against ${cache.info.name} before exporting.`);
                return json(res,201,store.save(p,null));
            }
            if(post&&route==='/api/reassign'){const input=await body(req);return json(res,200,{project:reassignDocument(input.project)});}
            if (post && route === '/api/animate') { const input = await body(req); validateMesh(input.mesh); return json(res, 200, cache.animate(input.mesh, Number(input.sequence), Number(input.samples) || 24)); }
            if(post&&route==='/api/animate-project'){const input=await body(req),p=validateProject(input.project);if(p.kind!=='npc')throw new Error('Independent creature movements need the creature body view.');if(!['idle','walk','run','attack','block','death',...p.attacks.map(a=>attackRole(a.id))].includes(input.role))throw new Error('Choose a movement.');return json(res,200,compileMotion(p,cache,input.role));}
            if (post && (route === '/api/verify' || route === '/api/export')) {
                const input=await body(req),p=validateDocument(input.project);
                for(const item of documentItems(p)){
                    if(!isGearSet(p))adoptSavedSequences(item);
                    const count=cache.counts()[item.kind==='npc'?'npc':'item'];
                    if(item.baseId>=count)throw new Error('The template ID is missing from this cache.');
                    for(const id of Object.values(item.animations) as number[])if(id>=cache.counts().seq)throw new Error(`Animation ${id} is missing from this cache.`);
                    if(item.kind==='gear'&&item.settings.weaponInterface&&!cache.weaponStyles().includes(item.settings.weaponInterface))throw new Error('Unknown weapon style.');
                }
                const compiled = compileProject(p, cache);
                if (route === '/api/verify') return json(res, 200, compiled.summary);
                const data = pluginZip(compiled); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${compiled.manifest.id}.zip"` }); return res.end(data);
            }
            if (get) {
                // Repo previews use the client's canonical sampler. Portable bundles carry
                // its full source in shared/gear-visuals.mjs instead of a repo-relative import.
                if(route==='/shared/gear-visuals.mjs'){
                    const sampler=path.join(root,'client/custom/items/GearVisualMath.mjs');
                    if(fs.existsSync(sampler)){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});return res.end(fs.readFileSync(sampler));}
                }
                const files: Record<string, string> = { '/': 'public/index.html', '/embedded': 'public/index.html', '/app.mjs': 'public/app.mjs', '/viewport.mjs': 'public/viewport.mjs', '/gizmo.mjs': 'public/gizmo.mjs', '/library.mjs': 'public/library.mjs', '/data.mjs': 'public/data.mjs', '/picker.mjs': 'public/picker.mjs', '/materials.mjs': 'public/materials.mjs', '/style.css': 'public/style.css', '/shared/mesh.mjs': 'shared/mesh.mjs', '/shared/project.mjs': 'shared/project.mjs', '/shared/motion.mjs':'shared/motion.mjs' };
                // Tool-owned modules and styles can be added without another host edit.
                // Only basename assets in public/shared are exposed, never runtime data.
                const publicAsset=route.match(/^\/([a-z][a-z0-9-]*\.(?:mjs|css))$/);
                const sharedAsset=route.match(/^\/shared\/([a-z][a-z0-9-]*\.mjs)$/);
                const candidate=publicAsset?`public/${publicAsset[1]}`:sharedAsset?`shared/${sharedAsset[1]}`:undefined;
                const relative = files[route]??(candidate&&fs.existsSync(path.join(here,candidate))?candidate:undefined);
                if (relative) { const type = relative.endsWith('.html') ? 'text/html' : relative.endsWith('.css') ? 'text/css' : 'text/javascript'; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(fs.readFileSync(path.join(here, relative))); }
            }
            return json(res, 404, { error: 'Route not found.' });
        } catch (error: any) { if (!res.headersSent) json(res, error.status ?? 400, { error: error.message, ...(error.conflict?{conflict:error.conflict}:{}) }); else res.end(); }
    });
    server.requestTimeout = 30000; server.headersTimeout = 10000;
    return { server, cache, store };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = findRoot(), env = fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '';
    const slot = Number(env.match(/^WT_SLOT=(\d+)$/m)?.[1] ?? 0);
    const port = Number(process.argv[2] ?? 3890 + slot);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Pass a port from 1024 to 65535.');
    const app = createBuilderServer();
    app.server.on('error', error => { console.error(error.message); app.cache.close(); process.exitCode = 1; });
    app.server.listen(port, '127.0.0.1', () => console.log(`Content builders: http://localhost:${port}\nCache: ${app.cache.info.name}\nProjects: ${app.store.directory}`));
    let closing = false;
    const close = () => { if (closing) return; closing = true; app.server.close(() => { app.cache.close(); process.exit(0); }); app.server.closeAllConnections(); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
}
