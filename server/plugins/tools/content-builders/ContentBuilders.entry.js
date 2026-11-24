const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
// The release builder replaces null with a compressed, self-contained source bundle.
const PAYLOAD = null;
let child, restartTimer, running = false, failures = 0;
const port = 3890 + Number(process.env.WT_SLOT || 0);
function tools() {
    return { tools: process.env.CACHE_EDITOR_ENABLED === '1' && process.env.BROWSER_HOST !== '1'
        ? [
            { id: 'npc-editor', label: 'NPC Creator', url: `http://localhost:${port}/embedded?view=npc`, aliases: [{ id: 'content-builders' }, { id: 'content-builders', view: 'npc' }] },
            { id: 'gear-editor', label: 'Gear Creator', url: `http://localhost:${port}/embedded?view=gear`, aliases: [{ id: 'content-builders', view: 'gear' }] },
        ] : [] };
}
function findRoot() {
    let root=process.env.TSPS_ROOT || __dirname;
    while(!fs.existsSync(path.join(root,'client/package.json')) || !fs.existsSync(path.join(root,'server/package.json'))) {
        const parent=path.dirname(root);if(parent===root)throw new Error('Creator requires a TSPS checkout with client and server dependencies.');root=parent;
    }
    return root;
}
function installRuntime() {
    const { gunzipSync }=require('node:zlib');
    const files=JSON.parse(gunzipSync(Buffer.from(PAYLOAD,'base64'),{maxOutputLength:2*1024*1024}).toString('utf8'));
    const runtime=path.join(__dirname,'data/runtime');
    for(const [name,source] of Object.entries(files)) {
        if(!/^(?:runtime\.(?:effects|gear-set|attack)\.cjs)$|^(?:public|shared)\/[a-z-]+\.(?:mjs|html|css)$|^[a-z-]+\.(?:mjs|ts|cjs)$/.test(name))throw new Error('Invalid Creator runtime path.');
        const destination=path.join(runtime,name);fs.mkdirSync(path.dirname(destination),{recursive:true});
        if(!fs.existsSync(destination)||fs.readFileSync(destination,'utf8')!==source)fs.writeFileSync(destination,source);
    }
    return path.join(runtime,'start.cjs');
}
function shortcuts(event) {
    if (process.env.CACHE_EDITOR_ENABLED !== '1' || process.env.BROWSER_HOST === '1') return;
    event.tools.push(
        { id: 'npc-editor', label: 'NPC Creator', params: { cache: '1', tool: 'npc-editor' } },
        { id: 'gear-editor', label: 'Gear Creator', params: { cache: '1', tool: 'gear-editor' } },
    );
}
function start(api) {
    if (running) return;
    if (process.env.CACHE_EDITOR_ENABLED !== '1' || process.env.BROWSER_HOST === '1') return;
    running = true; failures = 0;
    launch(api);
}
function launch(api) {
    if (!running) return;
    const root=findRoot(),launcher=PAYLOAD?installRuntime():path.join(root,'tools/content-builders/start.cjs');
    const env={...process.env,TSPS_ROOT:root};
    if(PAYLOAD)env.CONTENT_BUILDERS_PROJECTS=path.join(__dirname,'data/projects');
    const started = Date.now();
    const instance = child = spawn(process.execPath, [launcher, String(port)], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
    instance.on('error', error => { reportError(error); recover(instance, api, started); });
    instance.on('exit', (code, signal) => { if (running) console.error(`[content-builders] local editor exited (${signal || code}). Retrying.`); recover(instance, api, started); });
    api.log?.('Creator starting', { port });
}
function reportError(error) { console.error('[content-builders]', error.message); }
function recover(instance, api, started) {
    if (child !== instance) return;
    child = undefined;
    if (!running) return;
    failures = Date.now() - started > 30000 ? 0 : failures + 1;
    restartTimer = setTimeout(() => { restartTimer = undefined; launch(api); }, Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5)));
    restartTimer.unref?.();
}
function stop() {
    running = false; clearTimeout(restartTimer); restartTimer = undefined;
    const instance = child; child = undefined; instance?.kill('SIGTERM');
}
module.exports = {
    name: 'ContentBuilders',
    category: '@ Ghost Plugins @',
    description: 'Visual creature and gear creation in the cache editor. Projects and exported plugins stay outside the OSRS cache.',
    dependsOn: ['CacheEditorCatalog'],
    register(api) {
        api.registerContentEndpoint('cache-editor-tools', tools);
        api.onCustomEvent('WorldAdmin:tools', shortcuts);
        api.onServerStartup(start.bind(null, api));
        api.onServerShutdown(stop);
    },
};
