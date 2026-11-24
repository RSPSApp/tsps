// The TSPS importer accepts exactly a manifest and a single JavaScript entry.
// Bundle authoring assets inside that entry; no source patching on installation.
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findRoot } from './root.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = findRoot(), require = createRequire(path.join(root, 'server/package.json'));
const AdmZip = require('adm-zip');
export function authoringZip() {
    const files = {};
    for (const name of ['root.mjs', 'start.cjs', 'server.ts', 'cache.ts', 'store.mjs', 'export.mjs', 'runtime.cjs', 'runtime.gear-set.cjs', 'runtime.effects.cjs', 'runtime.attack.cjs', ...['public', 'shared'].flatMap(dir => fs.readdirSync(path.join(here, dir)).filter(name => /\.(mjs|html|css)$/.test(name)).map(name => dir + '/' + name))])
        files[name] = fs.readFileSync(path.join(here, name), 'utf8');
    files['shared/gear-visuals.mjs']=fs.readFileSync(path.join(root,'client/custom/items/GearVisualMath.mjs'),'utf8');
    const payload = gzipSync(Buffer.from(JSON.stringify(files)), { level: 9 }).toString('base64');
    const notice = `/*\n${fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')}\n*/\n`;
    const source = notice + fs.readFileSync(path.join(root, 'server/plugins/tools/content-builders/ContentBuilders.entry.js'), 'utf8').replace('const PAYLOAD = null;', `const PAYLOAD = '${payload}';`);
    if (Buffer.byteLength(source) > 1024 * 1024)
        throw new Error('Creator exceeds TSPS plugin size limit.');
    const manifest = { category: '@ Ghost Plugins @', format: 1, id: 'content-builders', name: 'ContentBuilders', version: '2.2.0', description: 'Visual creature and gear creator. Requires the generic optional-tool tab host in the TSPS cache editor.' };
    const zip = new AdmZip();
    zip.addFile('plugin.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    zip.addFile('ContentBuilders.plugin.js', Buffer.from(source));
    return zip.toBuffer();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const destination = path.resolve(process.argv[2] ?? path.join(here, 'release/content-builders-2.2.0.zip'));
    const zip = authoringZip();
    const { readPluginZip } = require(path.join(root, 'server/plugins/tools/worldadmin/PluginZip.WorldAdmin.js'));
    readPluginZip(zip);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, zip);
    console.log(`${destination} (${zip.length} bytes)`);
}
