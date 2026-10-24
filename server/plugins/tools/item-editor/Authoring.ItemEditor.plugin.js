// Separate local authoring port; game content endpoints stay read-only.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const { revision, upsert } = require('./Document.ItemEditor.cjs');
const { createCombatReader } = require('./Combat.ItemEditor.cjs');
function createAuthoring(core, root) {
    let combatReader;
    const documentPath = path.join(root, 'server/data/definitions/custom-items.json');
    function read() {
        const rows = JSON.parse(fs.readFileSync(documentPath, 'utf8'));
        if (!Array.isArray(rows))
            throw Error('Invalid custom item file');
        const seen = new Set();
        for (const row of rows) {
            if (!Number.isInteger(row.id))
                throw Error('Invalid saved custom ID');
            if (seen.has(row.id))
                throw Error('Duplicate custom ID in saved file');
            seen.add(row.id);
        }
        return rows;
    }
    function snapshot() {
        const rows = read();
        // Draft refresh replaces only the editor range; conflict detection covers every row.
        return { items: rows.filter(row => row.id >= 60000 && row.id <= 65022), revision: revision(rows), restartRequired: true };
    }
    function metadata(id) {
        if (!Number.isInteger(id) || !core.CacheDefinitions.hasItem(id))
            throw Error('Base item is unavailable');
        const def = core.ItemDefinition.forId(id);
        return { bonuses: def.getBonuses() ?? new Array(14).fill(0), requirements: def.getRequirements() ?? new Array(23).fill(0),
            value: def.getValue() ?? 0, tradeable: def.isTradeable(), equipmentSlot: def.getEquipmentType().getSlot() };
    }
    function save(payload) {
        const rows = upsert(read(), payload);
        const item = payload.item;
        if (item.id < core.CacheDefinitions.getCounts().items)
            throw Error('Custom ID overlaps the current cache');
        if (item.baseItemId >= core.CacheDefinitions.getCounts().items)
            throw Error('Choose an original cache item as the base');
        const base = core.CacheDefinitions.getItem(item.baseItemId);
        if (!base?.name || base.name === 'null' || base.noteTemplate >= 0 || base.placeholderTemplate >= 0)
            throw Error('Choose a normal cache item, not a note or placeholder');
        for (const key of ['equipmentType', 'weaponInterface'])
            if (item.itemDef?.[key] !== undefined)
                throw Error('Changing equipment or combat type is not supported in this stage');
        const previous = read().find(row => row.id === item.id);
        for (const [key, value] of Object.entries(item.objType))
            if (/^(model|(?:male|female)(?:Head)?Model[12]?)$/.test(key) && value !== (previous?.objType[key] ?? base[key]))
                throw Error('Replacing models is not supported in this stage');
        // Check the actual compressed transport before touching canonical content.
        const live = rows;
        // ContentData v1: 3-byte packet header + 5-byte compression header.
        if (deflateSync(Buffer.from(JSON.stringify({ gamemodeId: 'server', datasets: [{ key: 'customItems', rows: live }] }))).length + 8 > 65535)
            throw Error('Custom definitions exceed the game transport limit');
        const temp = `${documentPath}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temp, JSON.stringify(rows, null, 2) + '\n', { flag: 'wx' });
            fs.renameSync(temp, documentPath);
        }
        finally {
            if (fs.existsSync(temp))
                fs.unlinkSync(temp);
        }
        // The standard loader reads this canonical document on the next server start.
        return snapshot();
    }
    function allowedOrigin(origin) {
        try {
            const url = new URL(origin);
            return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === String(process.env.PORT || 3000);
        }
        catch {
            return false;
        }
    }
    async function handle(request, response) {
        const origin = request.headers.origin;
        if (!allowedOrigin(origin)) {
            response.writeHead(403);
            response.end();
            return;
        }
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (request.method === 'OPTIONS') {
            response.writeHead(204);
            response.end();
            return;
        }
        try {
            if (request.method === 'GET' && /^\/items\/\d+\/animations$/.test(request.url)) {
                const id = Number(request.url.split('/')[2]);
                if (!core.CacheDefinitions.hasItem(id))
                    throw Error('Item is unavailable');
                combatReader ??= createCombatReader(core, root);
                response.end(JSON.stringify(combatReader(id)));
                return;
            }
            if (request.method === 'GET' && /^\/items\/\d+$/.test(request.url)) {
                response.end(JSON.stringify(metadata(Number(request.url.split('/')[2]))));
                return;
            }
            if (request.url !== '/items') {
                response.writeHead(404);
                response.end();
                return;
            }
            if (request.method === 'GET') {
                response.end(JSON.stringify(snapshot()));
                return;
            }
            if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) {
                response.writeHead(405);
                response.end();
                return;
            }
            let body = '';
            for await (const chunk of request) {
                body += chunk;
                if (Buffer.byteLength(body) > 1024 * 1024)
                    throw Error('Item definition is too large');
            }
            response.end(JSON.stringify(save(JSON.parse(body))));
        }
        catch (error) {
            response.statusCode = error.status || 400;
            response.end(JSON.stringify({ error: error.message }));
        }
    }
    return { handle, save, snapshot, metadata };
}
function startup(apiCore) {
    // Opening a write service is an explicit local development choice.
    if (process.env.ITEM_EDITOR_ENABLED !== '1' || process.env.BROWSER_HOST === '1')
        return;
    const { handle } = createAuthoring(apiCore, path.resolve(__dirname, '../../../..'));
    const server = http.createServer(handle), port = Number(process.env.WEBSOCKET_PORT || 43594) + 1100;
    server.on('error', error => console.error('[item-editor] Local saving unavailable:', error.message));
    server.listen(port, '127.0.0.1', () => console.log(`[item-editor] Local authoring service :${port}`));
}
module.exports = { name: 'ItemEditorAuthoring', dependsOn: ['ItemDefinitionLoader'], register(api) { api.onServerStartup(startup.bind(null, api.core)); } };
module.exports.createAuthoring = createAuthoring;
