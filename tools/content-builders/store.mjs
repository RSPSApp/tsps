import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validId } from './shared/project.mjs';
import { validateDocument, documentItems, isGearSet } from './shared/gear-set.mjs';
const revision = p => createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 20);
export class ProjectStore {
    constructor(directory, root) { this.directory = directory; this.root = root; this.editors = new Map(); }
    file(id) { return path.join(this.directory, `${validId(id)}.json`); }
    read(id) {
        const file = this.file(id);
        if (!fs.existsSync(file)) throw Object.assign(new Error('Project not found.'), { status: 404 });
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')), project = validateDocument(raw);
        // Optional schema additions must not invalidate a browser's saved revision.
        return { project, revision: revision(raw) };
    }
    list() {
        if (!fs.existsSync(this.directory)) return [];
        return fs.readdirSync(this.directory).filter(f => /^[a-z][a-z0-9-]{0,55}\.json$/.test(f)).map(file => {
            const id = file.slice(0, -5);
            try { const { project: p, revision } = this.read(id); return { id, name: p.name, kind: p.kind, ids: p.ids, ...(isGearSet(p)&&{set:true,itemCount:p.items.length,identities:p.items.map(item=>item.ids)}), revision, modified: fs.statSync(this.file(id)).mtime.toISOString() }; }
            catch (error) { return { id, error: error.message }; }
        }).sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''));
    }
    save(input, expected, editor) {
        const project = validateDocument(input), file = this.file(project.id), exists = fs.existsSync(file);
        if (exists ? expected !== this.read(project.id).revision : expected !== null) throw Object.assign(new Error('This project has a newer saved version. Choose how to resolve the conflict.'), { status: 409, conflict:{projectId:project.id,editor:this.editors.get(project.id)??null} });
        if(isGearSet(project))for(const row of this.list())if(!row.error&&row.id!==project.id)for(const ids of row.identities??[row.ids]){
            if(documentItems(project).some(item=>item.ids.definition===ids.definition||item.ids.modelBase<=ids.modelBase+4&&item.ids.modelBase+4>=ids.modelBase))throw new Error('A set item ID is reserved by another project. Reassign the set IDs.');
        }
        fs.mkdirSync(this.directory, { recursive: true });
        const temp = `${file}.${randomUUID()}.tmp`;
        try { fs.writeFileSync(temp, JSON.stringify(project), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
        finally { fs.rmSync(temp, { force: true }); }
        if(editor&&/^creator-[a-f0-9-]{36}$/.test(editor.tabId)&&typeof editor.label==='string'){this.editors.set(project.id,{tabId:editor.tabId,label:editor.label.slice(0,160),mode:String(editor.mode??'').slice(0,24),variant:String(editor.variant??'').slice(0,24)});while(this.editors.size>128)this.editors.delete(this.editors.keys().next().value);}
        return { project, revision: revision(project) };
    }
    allocate(kind,reserved=[]) {
        const used = new Set(), models = new Set(), sequences = new Set();
        const add = (id, modelBase) => { if (Number.isInteger(id)) used.add(id); if (Number.isInteger(modelBase)) for (let n = 0; n < 5; n++) models.add(modelBase + n); };
        for (const p of [...this.list(),...reserved.map(ids=>({ids}))]) if (!p.error) for(const ids of p.identities??[p.ids]){add(ids.definition, ids.modelBase);if(ids.sequenceBase)for(let n=0;n<6;n++)sequences.add(ids.sequenceBase+n);}
        const load = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
        const defs = path.join(this.root, 'server/data/definitions');
        for (const row of load(path.join(defs, 'custom-items.json'))) { add(row.id); for (const id of Object.keys(row.models ?? {})) models.add(Number(id)); }
        for (const row of load(path.join(defs, 'custom-definitions.json')).rows ?? []) add(row.id);
        const rawModels = load(path.join(defs, 'custom-models.json'));
        for (const row of Array.isArray(rawModels) ? rawModels : []) if (Number.isInteger(row.id)) models.add(row.id);
        if (!Array.isArray(rawModels)) for (const id of Object.keys(rawModels)) if (/^\d+$/.test(id)) models.add(Number(id));
        const overlay = load(path.join(defs, 'custom-definitions.json'));
        for (const asset of overlay.assets ?? []) if (asset.kind === 'model') models.add(asset.id);
        const imported = path.join(this.root, 'server/plugins/imported');
        if (fs.existsSync(imported)) for (const entry of fs.readdirSync(imported, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const directory = path.join(imported, entry.name);
            for (const name of fs.readdirSync(directory).filter(f => f.endsWith('.plugin.js'))) {
                const file = path.join(directory, name); if (fs.statSync(file).size > 1024 * 1024) continue;
                const identity = fs.readFileSync(file, 'utf8').match(/^\/\/ content-builders:identity (.+)\n/);
                if (identity) { const p = JSON.parse(identity[1]); for(const ids of p.items??[p]){add(ids.definition,ids.modelBase);if(ids.sequenceBase)for(let n=0;n<6;n++)sequences.add(ids.sequenceBase+n);} }
            }
        }
        let definition = kind === 'npc' ? 58000 : 60000;
        while (used.has(definition) && definition <= 65022) definition++;
        if (definition > 65022) throw new Error('No custom definition IDs remain in this range.');
        let modelBase = 1100000;
        while (Array.from({ length: 5 }, (_, n) => modelBase + n).some(id => models.has(id))) modelBase += 5;
        let sequenceBase=50000;while(sequenceBase<=65529&&Array.from({length:6},(_,n)=>sequenceBase+n).some(id=>sequences.has(id)))sequenceBase+=6;if(sequenceBase>65529)throw new Error('No custom animation IDs remain.');
        return { definition, modelBase, sequenceBase };
    }
}
