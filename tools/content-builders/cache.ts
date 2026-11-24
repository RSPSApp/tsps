// The only adapter to TSPS internals. The workbench never loads the game or writes its cache.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { findRoot } from './root.mjs';
const root = findRoot();
const require = createRequire(path.join(root, 'client/package.json'));
const { CacheIndexDat2 } = require(path.join(root, 'client/rs/cache/CacheIndex'));
const { getCacheLoaderFactory } = require(path.join(root, 'client/rs/cache/loader/CacheLoaderFactory'));
const { FileStore } = require(path.join(root, 'server/src/main/typescript/elvarg/game/cache/codec/rs/cache/store/FileStore'));
const { ModelData } = require(path.join(root, 'client/rs/model/ModelData'));
const { SoundEffectLoader } = require(path.join(root,'client/rs/audio/SoundEffectLoader'));
import { encodeModel,modelVertexOrder } from './shared/model-codec.mjs';
import { describeParts, describeGearParts } from './shared/parts.mjs';
import { assemble } from './shared/mesh.mjs';
import { VISUAL_RECIPES } from './shared/visuals.mjs';
import {attackRecipe} from './shared/attack-recipes.mjs';
import {ATTACK_RULES} from './shared/attack-rules.mjs';
import { EFFECT_ANIMATIONS } from './shared/effects.mjs';
import { PREVIEW_SCENES, NEUTRAL_SKIN_HSL } from './shared/preview-scenes.mjs';
import {compileGearVisualScene} from './shared/gear-visual-compile.mjs';
import {sampleVisualGeometry} from './shared/gear-visuals.mjs';

export class BuilderCache {
    readonly info: any;
    private store: any;
    private factory: any;
    private catalog = new Map<string, any[]>();
    private combat: any;
    private jsonCache = new Map<string, any>();
    private names?: Map<number, string>;
    private sequenceSources?: Map<number, Set<string>>;
    private gamevalNames = new Map<number, Map<number,string>>();
    private sounds:any;
    private donorRows?: any[];
    private effectLabels?: Map<number,{name:string;aliases:string}>;
    private previewScenes = new Map<string, any>();
    constructor(readonly root: string) {
        const name = fs.readFileSync(path.join(root, 'server/target.txt'), 'utf8').trim();
        const directory = path.join(root, 'server/caches', name);
        if (!fs.existsSync(directory)) throw new Error('TSPS cache is missing. Run TSPS setup once before opening the builders.');
        const source = JSON.parse(fs.readFileSync(path.join(directory, 'info.json'), 'utf8'));
        this.info = { ...source, name, game: source.game ?? 'oldschool', revision: Number(name.match(/^osrs-(\d+)/)?.[1]), environment: 'live' };
        this.store = new FileStore(directory);
        const indices = new Map<number, any>();
        const system = { decodeProfile: {}, getIndex: (id: number) => {
            if (!indices.has(id)) indices.set(id, CacheIndexDat2.fromStore(id, this.store as any));
            return indices.get(id);
        } };
        this.factory = getCacheLoaderFactory(this.info, system as any);
        this.sounds=new SoundEffectLoader(this.info,{...system,indexExists:(id:number)=>{try{return !!system.getIndex(id);}catch{return false;}}});
    }
    close() { this.store.close(); }
    private loader(kind: string) {
        if (kind === 'npc') return this.factory.getNpcTypeLoader();
        if (kind === 'item') return this.factory.getObjTypeLoader();
        if (kind === 'seq') return this.factory.getSeqTypeLoader();
        if (kind === 'effect') return this.factory.getSpotAnimTypeLoader();
        throw new Error('Choose an NPC, item or animation.');
    }
    private effectLabel(id:number){
        if(!this.effectLabels){
            this.specialDonors();const labels=this.effectLabels=new Map();
            for(const row of [...this.donorRows!].sort((a,b)=>a.name.length-b.name.length))for(const id of row.graphics??[]){const previous=labels.get(id);labels.set(id,{name:previous?.name??`${row.name} effect`,aliases:`${previous?.aliases??''} ${row.name} ${row.specialName.replaceAll('_',' ')}`});}
            for(const recipe of VISUAL_RECIPES)for(const clip of recipe.clips){const previous=labels.get(clip.id);labels.set(clip.id,{name:recipe.clips.length===1?recipe.name:previous?.name??recipe.name,aliases:`${previous?.aliases??''} ${recipe.name}`});}
        }
        const nativeName=(this.gamevals(8).get(id)??`Unnamed VFX ${id}`).replaceAll('_',' '),label=this.effectLabels.get(id);
        const readable=nativeName.replace(/\b(?:spotanim|spot animation)\b/gi,'').replace(/\s+/g,' ').trim();
        return {name:label?.name??readable.charAt(0).toUpperCase()+readable.slice(1),nativeName,aliases:label?.aliases??''};
    }
    counts() { return { npc: this.loader('npc').getCount(), item: this.loader('item').getCount(), seq: this.loader('seq').getCount() }; }
    /** Only native sequences with evidence of use by the selected actor. Numeric searches do not bypass this filter. */
    movementChoices(text='',offset=0,{actor='player',npcId=-1,category='all'}:{actor?:string;npcId?:number;category?:string}={}){
        if(!['player','npc'].includes(actor))throw new Error('Choose a player or test opponent.');
        const key=actor==='player'?'player-movements':`npc-movements:${npcId}`;
        if(!this.catalog.has(key)){
            const names=this.sequenceNames(),evidence=new Map<number,string>(),preferred=new Map<number,string>(EFFECT_ANIMATIONS as any);
            if(actor==='player'){
                for(const [id,name] of names)if(/^(human_|emote_)/i.test(name)&&!/chathead|_transform(?:_|$)|_transmog(?:_|$)/i.test(name))evidence.set(id,name.replace(/^(human_|emote_)/i,'').replaceAll('_',' '));
                for(const [id,name] of preferred)evidence.set(id,name);
                this.specialDonors();for(const reference of this.donorRows!)if(reference.recipe)for(const id of [reference.recipe.animation,...reference.animations??[]])if(Number.isInteger(id)&&id>=0)evidence.set(id,preferred.get(id)??`${reference.name} special attack`);
                for(const item of this.json('item-gameplay.json'))for(const [field,role] of [['standAnim','Idle'],['walkAnim','Walk'],['runAnim','Run'],['attackAnim','Attack'],['blockAnim','Block']]){
                    const id=item[field],native=names.get(id)??'';
                    if(Number.isInteger(id)&&id>=0&&!/chathead|swarm|paintball|paintsplash|boulder_rolling/i.test(native))evidence.set(id,preferred.get(id)??`${item.name} ${role}`);
                }
            }else{
                const npc=this.gameData('npc',npcId),combat=npc.combat?.anims??{};
                for(const [role,id] of [...Object.entries(npc.fields).filter(([k])=>/SeqId$/.test(k)),...Object.entries(combat)])if(Number.isInteger(id)&&Number(id)>=0)evidence.set(Number(id),`${npc.name} ${String(role).replace(/SeqId$/,'')}`);
                for(const id of this.json('npc-animations.json')[npcId]??[])if(Number.isInteger(id)&&id>=0)evidence.set(id,(names.get(id)??`${npc.name} movement ${id}`).replaceAll('_',' '));
            }
            const rows=[];
            for(const [id,label] of evidence)try{
                const seq=this.loader('seq').load(id);if(!(seq.frameIds?.length||seq.getSkeletalDuration?.()>0))continue;
                const nativeName=names.get(id)??'',words=nativeName.replaceAll('_',' '),category=/cast|spell|magic|teleport/.test(words)?'casting':/block|defend|defence/.test(words)?'defence':/attack|slash|stab|punch|kick|lunge|cleave|special|smash|shoot|_bow\b|throw|strike|chop|swing/.test(nativeName)||preferred.has(id)?'combat':/^emote_/.test(nativeName)?'emotes':/walk|run|ready|idle|stand/.test(words)?'movement':'other';
                const name=preferred.get(id)??label.charAt(0).toUpperCase()+label.slice(1);
                rows.push({id,name,nativeName,category,actor});
            }catch{/* Missing native frames are not selectable. */}
            rows.sort((a,b)=>Number(!preferred.has(a.id))-Number(!preferred.has(b.id))||a.name.localeCompare(b.name)||a.id-b.id);
            this.catalog.set(key,rows);if(actor==='npc')while([...this.catalog.keys()].filter(k=>k.startsWith('npc-movements:')).length>4)this.catalog.delete([...this.catalog.keys()].find(k=>k.startsWith('npc-movements:'))!);
        }
        const needle=String(text).slice(0,100).trim().toLowerCase(),hits=this.catalog.get(key)!.filter(row=>(category==='all'||row.category===category)&&(/^\d+$/.test(needle)?row.id===Number(needle):needle.split(/\s+/).every(word=>`${row.name} ${row.nativeName}`.toLowerCase().includes(word))));
        offset=Math.max(0,Math.min(100000,Math.floor(Number(offset)||0)));return {total:hits.length,rows:hits.slice(offset,offset+50)};
    }
    movementPreview(id:number,{actor='player',npcId=-1,gender='male'}:{actor?:string;npcId?:number;gender?:string}={}){
        if(!this.movementChoices(String(id),0,{actor,npcId}).rows.some(row=>row.id===id))throw new Error('Choose a compatible movement for this player or opponent.');
        const mesh=actor==='player'?this.mannequin(gender,'NONE','character').mesh:this.describe('npc',npcId,'body').mesh;
        return {...this.animate(mesh,id,24),id,actor};
    }
    search(kind: string, text: string, offset = 0, options: {creaturesOnly?: boolean; unique?: boolean; references?: boolean} = {}) {
        offset = Math.max(0, Math.min(100000, Math.floor(Number(offset) || 0)));
        text = String(text).slice(0, 100);
        if(kind==='sound'){
            if(!this.catalog.has(kind)){
                const source=fs.readFileSync(path.join(this.root,'server/src/main/typescript/elvarg/game/Sound.ts'),'utf8');
                const names=new Map<number,string>();for(const match of source.matchAll(/\b([A-Z][A-Z0-9_]+)\s*=\s*new Sound\((\d+)/g))names.set(Number(match[2]),match[1].toLowerCase().replace(/_/g,' '));
                for(const [id,row] of Object.entries(this.json('npc-combat-defs.json').npcs??{}) as any)for(const [role,sound] of Object.entries(row.sounds??{}))if(Number.isInteger(sound)&&!names.has(Number(sound)))names.set(Number(sound),`${row.name} ${role}`);
                const index=CacheIndexDat2.fromStore(4,this.store as any);this.catalog.set(kind,Array.from(index.getArchiveIds(),(id:number)=>({id,name:names.get(id)??`Sound ${id}`})));
            }
            const needle=text.trim().toLowerCase();const hits=this.catalog.get(kind)!.filter(row=>/^\d+$/.test(needle)?row.id===Number(needle):row.name.toLowerCase().includes(needle));return {rows:hits.slice(offset,offset+50),total:hits.length};
        }
        const loader = this.loader(kind);
        if(kind==='effect'){
            if(!this.catalog.has(kind)){
                const rows=[];
                for(let id=0;id<loader.getCount();id++)try{const effect=loader.load(id);if(effect.modelId>=0)rows.push({id,...this.effectLabel(id),sequence:effect.sequenceId});}catch{}
                this.catalog.set(kind,rows);
            }
            const needle=text.trim().toLowerCase(),hits=this.catalog.get(kind)!.filter(row=>/^\d+$/.test(needle)?row.id===Number(needle):needle.split(/\s+/).every(word=>`${row.name} ${row.nativeName} ${row.aliases}`.toLowerCase().includes(word)));
            return {rows:hits.slice(offset,offset+50),total:hits.length};
        }
        if (kind === 'seq') {
            const words = (value:string) => value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_\W]+/g,' ').trim().toLowerCase();
            const needle = words(text), exact=/^\d+$/.test(needle), names = this.sequenceNames(), sources=this.animationSources();
            const matches=(value:string)=>needle.split(/\s+/).every(word=>words(value).includes(word));
            const alias=(id:number)=>[...(sources.get(id)??[])].find(matches);
            const ids = exact ? [Number(needle)] : [...new Set([...names.keys(),...sources.keys()])].filter(id => matches(names.get(id)??'')||alias(id));
            const valid = ids.filter(id => id >= 0 && id < loader.getCount());
            return { rows: valid.slice(offset, offset + 50).map(id => { const seq = loader.load(id); return { id, name: (!exact&&needle?alias(id):undefined)??names.get(id)?.replace(/_/g,' ')??[...(sources.get(id)??[])][0]??`Animation ${id}`, nativeName:names.get(id), frames: seq.frameIds?.length ?? seq.getSkeletalDuration?.() ?? 0, skeletal: seq.isSkeletalSeq() }; }), total: valid.length };
        }
        const catalogKey = kind === 'item' && options.references ? 'item-references' : kind;
        if (!this.catalog.has(catalogKey)) {
            const rows = [];
            for (let id = 0; id < loader.getCount(); id++) {
                try {
                    const type = loader.load(id);
                    const name = type.name;
                    if (!name || name === 'null' || name === 'Hidden' || !(kind === 'npc' ? type.modelIds?.length : options.references || type.model >= 0)) continue;
                    if (kind === 'item' && ((!options.references && type.noteTemplate >= 0) || type.placeholderTemplate >= 0)) continue;
                    rows.push({ id, name, signature: JSON.stringify([kind === 'npc' ? type.modelIds : type.model, Array.from(type.recolorTo ?? []),Array.from(type.retextureTo??[]), kind === 'npc' ? type.widthScale : 0, kind === 'npc' ? type.heightScale : 0]), walk: type.walkSeqId, ...(kind === 'item' ? { wearable: type.maleModel >= 0 || type.femaleModel >= 0, ...(options.references ? { noted: type.noteTemplate >= 0, modelAvailable: type.model >= 0 } : {}) } : { level: type.combatLevel }) });
                } catch { /* Corrupt/unavailable definitions cannot be useful part sources. */ }
            }
            this.catalog.set(catalogKey, rows);
        }
        const needle = text.toLowerCase().trim(), exact = /^\d+$/.test(needle);
        let hits = this.catalog.get(catalogKey)!.filter(row => exact ? String(row.id) === needle : row.name.toLowerCase().includes(needle));
        if (!exact && kind === 'npc' && options.creaturesOnly) {
            const humanWalks = new Set(this.catalog.get(kind)!.filter(row => ['man', 'woman'].includes(row.name.toLowerCase())).map(row => row.walk).filter(id => id >= 0));
            hits = hits.filter(row => !humanWalks.has(row.walk));
        }
        if(!exact)hits.sort((a,b)=>Number(b.name.toLowerCase()===needle)-Number(a.name.toLowerCase()===needle)||Number(b.name.toLowerCase().startsWith(needle))-Number(a.name.toLowerCase().startsWith(needle))||a.id-b.id);
        if(!exact && options.unique){const seen=new Set();hits=hits.filter(row=>{if(seen.has(row.signature))return false;seen.add(row.signature);return true;});}
        return { rows: hits.slice(offset, offset + 50).map(({signature,walk,...row})=>row), total: hits.length };
    }
    // Lightweight source metadata for comparison. No model decoding or game boot.
    gameData(kind: string, id: number) {
        if (!['npc', 'item'].includes(kind)) throw new Error('Choose a creature or native item.');
        const loader = this.loader(kind);
        if (!Number.isInteger(id) || id < 0 || id >= loader.getCount()) throw new Error('This native definition does not exist.');
        const type = loader.load(id);
        const fields = kind === 'npc' ? { idleSeqId: type.idleSeqId, walkSeqId: type.walkSeqId, turnLeftSeqId: type.turnLeftSeqId, turnRightSeqId: type.turnRightSeqId, size: type.size, combatLevel: type.combatLevel, actions: type.actions, attackLevel: type.attackLevel, strengthLevel: type.strengthLevel, defenceLevel: type.defenceLevel, rangedLevel: type.rangedLevel, magicLevel: type.magicLevel, hitpoints: type.hitpoints } : { wearPos: type.wearPos, wearPos2: type.wearPos2, wearPos3: type.wearPos3, zoom2d: type.zoom2d, xan2d: type.xan2d, yan2d: type.yan2d, zan2d: type.zan2d, offsetX2d: type.offsetX2d, offsetY2d: type.offsetY2d, inventoryActions: type.inventoryActions, isMembers: type.isMembers };
        this.combat ??= this.json('npc-combat-defs.json').npcs ?? {};
        const raw = kind === 'npc' ? this.json('monsters-complete.json')[id] : (this.json('item-gameplay.json') as any[]).find(row => row.id === id);
        const gameplay = raw?.name?.toLowerCase() === type.name?.toLowerCase() ? structuredClone(raw) : {};
        return { kind, id, name: type.name, fields: structuredClone(fields), gameplay, combat: kind === 'npc' ? structuredClone(this.combat[id] ?? {}) : {} };
    }
    // Read declarations, never require/execute gameplay plugins. Fail closed for
    // dynamic expressions the bounded literal evaluator cannot resolve.
    specialDonors(text = '', offset = 0) {
        if (!this.donorRows) {
            const mechanicsFile=path.join(this.root,'server/plugins/combat/specials/Mechanics.SpecialAttack.js'),mechanicSchema=fs.existsSync(mechanicsFile)?require(mechanicsFile).mechanicSchema:()=>({version:1,groups:[]});
            const ts = require('typescript'), directory = path.join(this.root, 'server/plugins/combat');
            const manifest = fs.readFileSync(path.join(directory, 'SpecialAttacks.plugin.js'), 'utf8');
            const identifiers = new Map<string, number>();
            const source = fs.readFileSync(path.join(this.root, 'server/src/main/typescript/elvarg/util/ItemIdentifiers.ts'), 'utf8');
            for (const match of source.matchAll(/\bstatic\s+([A-Z0-9_]+)\s*=\s*(\d+)/g)) identifiers.set(match[1], Number(match[2]));
            const soundIds=new Map<string,any>(),soundFile=path.join(this.root,'server/src/main/typescript/elvarg/game/Sound.ts');if(fs.existsSync(soundFile))for(const match of fs.readFileSync(soundFile,'utf8').matchAll(/static\s+(?:readonly\s+)?([A-Z0-9_]+)\s*=\s*new Sound\((\d+)(?:,\s*(\d+))?(?:,\s*(\d+))?/g))soundIds.set(match[1],{id:Number(match[2]),loops:Number(match[3]??1),delayCycles:Number(match[4]??0)});
            const rows = new Map<number, any>();
            const files = [...manifest.matchAll(/require\(["']\.\/specials\/([A-Za-z0-9]+\.SpecialAttack)["']\)/g)].map(([,file])=>path.join(directory,'specials',`${file}.js`));
            const pluginRoot=path.join(this.root,'server/plugins');
            for(const name of fs.readdirSync(pluginRoot,{recursive:true}) as string[]){if(!name.endsWith('.js')||/^(imported|tools)[/\\]/.test(name))continue;const file=path.join(pluginRoot,name);if(fs.statSync(file).size<160000&&fs.readFileSync(file,'utf8').includes('registerCombatSpecial'))files.push(file);}
            for (const filename of new Set(files)) {
                const file=path.basename(filename,'.js');
                if (!fs.existsSync(filename) || fs.statSync(filename).size > 160000) continue;
                const code = fs.readFileSync(filename, 'utf8');
                const tree = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
                const constants = new Map<string, any>(),functions=new Map<string,any>(),bindings=new Map<string,any>();
                const collect = (node: any) => {
                    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer);
                    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isIdentifier(node.left)&&ts.isNewExpression(node.right))constants.set(node.left.text,node.right);
                    if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node);
                    ts.forEachChild(node, collect);
                };collect(tree);
                const evaluate = (node: any, depth = 0): any => {
                    if (!node || depth > 12) return undefined;
                    if (ts.isNumericLiteral(node)) return Number(node.text);
                    if (ts.isStringLiteral(node)) return node.text;
                    if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;
                    if (ts.isIdentifier(node)) return bindings.has(node.text)?bindings.get(node.text):evaluate(constants.get(node.text), depth + 1);
                    if (ts.isPropertyAccessExpression(node) && (/(^|\.)ItemIdentifiers$/.test(node.expression.getText(tree))||['I','ids','ids()'].includes(node.expression.getText(tree)))) return identifiers.get(node.name.text);
                    if(ts.isPropertyAccessExpression(node)&&node.expression.getText(tree)==='Sound')return soundIds.get(node.name.text);
                    if(ts.isPropertyAccessExpression(node)){const value=evaluate(node.expression,depth+1);if(value&&typeof value==='object')return value[node.name.text];}
                    if(ts.isElementAccessExpression(node)){const value=evaluate(node.expression,depth+1),key=evaluate(node.argumentExpression,depth+1);if(value&&typeof value==='object'&&Object.hasOwn(value,key))return value[key];}
                    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((entry: any) => ts.isSpreadElement(entry)?Array.from(evaluate(entry.expression,depth+1)??[]):[evaluate(entry, depth + 1)]);
                    if(ts.isConditionalExpression(node)){const test=evaluate(node.condition,depth+1);if(test!==undefined)return evaluate(test?node.whenTrue:node.whenFalse,depth+1);const a=evaluate(node.whenTrue,depth+1),b=evaluate(node.whenFalse,depth+1);return Array.isArray(a)&&Array.isArray(b)?[...a,...b]:undefined;}
                    if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.MinusToken)return -evaluate(node.operand,depth+1);
                    if(ts.isBinaryExpression(node)){const a=evaluate(node.left,depth+1),b=evaluate(node.right,depth+1);if(typeof a==='number'&&typeof b==='number'){switch(node.operatorToken.kind){case ts.SyntaxKind.PlusToken:return a+b;case ts.SyntaxKind.MinusToken:return a-b;case ts.SyntaxKind.AsteriskToken:return a*b;case ts.SyntaxKind.SlashToken:return b?a/b:undefined;}}}
                    if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.filter((p:any)=>ts.isPropertyAssignment(p)).map((p:any)=>[p.name.getText(tree).replace(/[\"']/g,''),evaluate(p.initializer,depth+1)]));
                    if(ts.isNewExpression(node)){const name=node.expression.getText(tree),value=evaluate(node.arguments?.[0],depth+1);if(name==='Map'&&Array.isArray(value))return new Map(value);if(name==='Set'&&Array.isArray(value))return new Set(value);if(['Animation','Graphic'].includes(name))return value;if(name==='Sound'&&Number.isInteger(value))return {id:value,loops:evaluate(node.arguments?.[1],depth+1)??1,delayCycles:evaluate(node.arguments?.[2],depth+1)??0};}
                    if(ts.isCallExpression(node)){
                        if(ts.isIdentifier(node.expression)&&node.expression.text==='mechanicSchema')return mechanicSchema(evaluate(node.arguments[0],depth+1),evaluate(node.arguments[1],depth+1));
                        if(ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='keys'){const value=evaluate(node.expression.expression,depth+1);if(value instanceof Map||value instanceof Set)return [...value.keys()];}
                        if(ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='projectileEnd'){const profile=evaluate(node.arguments[0],depth+1);if(Number.isFinite(profile?.speed))return profile.speed;}
                        if(ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='getSeqId'){const name=evaluate(node.arguments[0],depth+1);return [...this.sequenceNames()].find(([,value])=>value===name)?.[0];}
                        if(ts.isIdentifier(node.expression)){const fn=functions.get(node.expression.text),returned=fn?.body?.statements.find((n:any)=>ts.isReturnStatement(n));if(returned)return evaluate(returned.expression,depth+1);}
                    }
                    if (ts.isParenthesizedExpression(node)) return evaluate(node.expression, depth + 1);
                    return undefined;
                };
                let registered = false;
                const registrations = (node: any) => { if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'registerCombatSpecial') registered = true; ts.forEachChild(node, registrations); }; registrations(tree);
                if(!registered){
                    const configurations=(node:any)=>{
                        if(ts.isCallExpression(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(tree)==='require'&&node.arguments[1]&&ts.isObjectLiteralExpression(node.arguments[1])){
                            const helper=node.expression.arguments[0]?.text,config=evaluate(node.arguments[1]);
                            if(typeof helper==='string'&&/^\.\/[A-Za-z0-9]+\.SpecialAttack$/.test(helper)&&Number.isInteger(config?.itemId)){
                                const helperFile=path.resolve(path.dirname(filename),helper+'.js');
                                if(fs.existsSync(helperFile)&&fs.readFileSync(helperFile,'utf8').includes('registerCombatSpecial')){
                                    const id=config.itemId,type=this.loader('item').load(id),helperText=fs.readFileSync(helperFile,'utf8'),energy=Number(helperText.match(/const DRAIN = (\d+)/)?.[1]??25);
                                    rows.set(id,{id,name:type.name,specialName:config.id,source:path.relative(this.root,filename).replaceAll("\\", "/"),animations:Number.isInteger(config.animation)?[config.animation]:[],graphics:Number.isInteger(config.graphic)?[config.graphic]:[],visualClips:Number.isInteger(config.graphic)?[{id:config.graphic,recipient:'player',phase:'launch'}]:[],traits:{skipAttack:/skipAttack:\s*true/.test(helperText)},style:/return CombatType.MAGIC/.test(helperText)?'magic':'melee',accuracy:1,damage:1,energy});
                                }
                            }
                        }ts.forEachChild(node,configurations);
                    };configurations(tree);continue;
                }

                const animations=new Set<number>(),graphics=new Set<number>();
                const visuals=(node:any)=>{if(ts.isNewExpression(node)&&node.arguments?.length){const name=node.expression.getText(tree),id=evaluate(node.arguments[0]);if(Number.isInteger(id)&&id>=0&&id<65535){if(name==='Animation')animations.add(id);if(name==='Graphic')graphics.add(id);}}ts.forEachChild(node,visuals);};visuals(tree);
                const visualClips:any[]=[],soundClips:any[]=[],projectileClips:any[]=[];
                const soundCalls=(node:any)=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='createProjectile'){let owner=node.parent;while(owner&&!ts.isMethodDeclaration(owner))owner=owner.parent;const [id,delay,end,startHeight,endHeight]=node.arguments.slice(2,7).map((arg:any)=>evaluate(arg));if(owner?.name?.getText(tree)==='start'&&[id,delay,end,startHeight,endHeight].every(Number.isFinite)&&end>delay){let angle=16,progress=64,chain=node.parent;for(let i=0;i<8&&chain;i++,chain=chain.parent)if(ts.isCallExpression(chain)&&ts.isPropertyAccessExpression(chain.expression)){if(chain.expression.name.text==='withAngle')angle=evaluate(chain.arguments[0])??angle;if(chain.expression.name.text==='withProgress')progress=evaluate(chain.arguments[0])??progress;}projectileClips.push({id,delayCycles:delay,baseCycles:end,cyclesPerTile:0,startHeight,endHeight,angle,progress});}}if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['sendSound','playAreaSoundAt'].includes(node.expression.name.text)){let owner=node.parent;while(owner&&!ts.isMethodDeclaration(owner))owner=owner.parent;if(owner?.name?.getText(tree)==='start'){const sound=evaluate(node.arguments[1]);if(Number.isInteger(sound?.id))soundClips.push({...sound,area:node.expression.name.text==='playAreaSoundAt',recipient:/target/.test(node.arguments[0]?.getText(tree))?'target':'player'});}}ts.forEachChild(node,soundCalls);};soundCalls(tree);
                const graphicId=(node:any,depth=0):any=>{if(!node||depth>8)return;if(ts.isIdentifier(node))return graphicId(constants.get(node.text),depth+1);if(ts.isNewExpression(node)&&node.expression.getText(tree)==='Graphic')return evaluate(node.arguments?.[0]);};
                const calls=(node:any)=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['performGraphic','performGraphicInSlot'].includes(node.expression.name.text)){
                    const id=graphicId(node.arguments[node.expression.name.text==='performGraphic'?0:1]);if(Number.isInteger(id)&&id>=0){const receiver=node.expression.expression.getText(tree),recipient=/target|victim|getTarget/i.test(receiver)?'target':'player';let owner=node.parent;while(owner&&!ts.isMethodDeclaration(owner))owner=owner.parent;const phase=owner?.name?.getText(tree)==='start'||recipient==='player'?'launch':'impact';if(!visualClips.some(c=>c.id===id&&c.recipient===recipient&&c.phase===phase))visualClips.push({id,recipient,phase});}
                }ts.forEachChild(node,calls);};calls(tree);
                const visit = (node: any) => {
                    if (ts.isObjectLiteralExpression(node)) {
                        const props = new Map<string, any>(node.properties.filter((p: any) => ts.isPropertyAssignment(p)).map((p: any) => [p.name.getText(tree).replace(/["']/g, ''), p.initializer]));
                        bindings.clear();const ids = evaluate(props.get('itemIds'));
                        if (Array.isArray(ids) && props.has('combatMethod')) for (const id of ids) {
                            if (!Number.isInteger(id) || id < 0 || id >= this.loader('item').getCount()) continue;
                            const type = this.loader('item').load(id);
                            if (!type.name || type.name === 'null') continue;
                            const conditional=props.get('itemIds');if(conditional&&ts.isConditionalExpression(conditional)&&ts.isIdentifier(conditional.condition)){bindings.clear();const yes=evaluate(conditional.whenTrue);bindings.set(conditional.condition.text,Array.isArray(yes)&&yes.includes(id));}
                            let itemEnergy = evaluate(props.get('drainAmount'));
                            const variants = props.get('drainAmountByItemId');
                            if (variants && ts.isObjectLiteralExpression(variants)) for (const p of variants.properties) if (ts.isPropertyAssignment(p) && ts.isComputedPropertyName(p.name) && evaluate(p.name.expression) === id) itemEnergy = evaluate(p.initializer);
                            const editor=evaluate(props.get('metadata'))?.editorMechanics;
                            const mechanics=editor?.version===1?editor.groups:[],declared=mechanics.filter(group=>group.preview?.graphic>=0).map(group=>({id:group.preview.graphic,recipient:group.preview.recipient??'target',phase:'impact'})),traits=evaluate(props.get('traits'))??{};
                            rows.set(id, { id, name: type.name, specialName: evaluate(props.get('id')) ?? file.replace('.SpecialAttack', ''), source:path.relative(this.root,filename).replaceAll("\\", "/"), animations:[...animations], graphics:[...new Set([...graphics,...declared.map(clip=>clip.id)])], visualClips:[...visualClips,...declared.filter(clip=>!visualClips.some(existing=>existing.id===clip.id&&existing.recipient===clip.recipient))], mechanics,soundClips,projectileClips, style:/extends (?:core\.)?RangedCombatMethod|new (?:core\.)?RangedCombatMethod|return (?:core\.)?CombatType.RANGED/.test(code)?'ranged':/extends (?:core\.)?MagicCombatMethod|return (?:core\.)?CombatType.MAGIC/.test(code)?'magic':'melee', traits,accuracy:traits.accuracyMultiplier??evaluate(props.get('accuracyMultiplier'))??1,damage:traits.damageMultiplier??evaluate(props.get('strengthMultiplier'))??1, ...(Number.isFinite(itemEnergy) ? { energy: itemEnergy } : {}) });
                        }
                    }
                    ts.forEachChild(node, visit);
                }; visit(tree);
            }
            this.donorRows = [...rows.values()].map(row=>({...row,recipe:attackRecipe(row)})).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
        }
        const needle = String(text).slice(0, 100).trim().toLowerCase(), exact = /^\d+$/.test(needle);
        const hits = this.donorRows.filter(row => exact ? row.id === Number(needle) : `${row.name} ${row.specialName}`.toLowerCase().includes(needle));
        const start = Math.max(0, Math.min(100000, Math.floor(Number(offset) || 0)));
        return { rows: hits.slice(start, start + 50), total: hits.length, source: 'Bundled native plugin declarations. Installation validates the active runtime registry.' };
    }
    effectReferences(kind:string,text='',offset=0){
        if(kind==='special')return this.specialDonors(text,offset);
        const key='set-references';
        if(!this.catalog.has(key)){
            const type=this.factory.getEnumTypeLoader().load(3047),rows=[];
            for(let n=0;n<type.keys.length;n++){
                const id=type.keys[n],raw=type.stringValues?.[n];if(id<=0||!raw||raw==='null')continue;
                const plain=raw.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'').replaceAll('\u00a0',' ').trim();
                const lines=plain.split('\n').map((line:string)=>line.trim()).filter(Boolean),title=lines[1]?.split(/:|\s[-+]\s/)[0]?.trim(),name=(lines[0]?.replace(/:$/,'')||`Set effect ${id}`)+(title&&title.length<45&&!/[.!?]/.test(title)?` · ${title}`:'');
                rows.push({id,name,description:plain,source:'Native cache equipment effects, enum 3047',graphics:/guthan/i.test(name)?[398]:[],animations:[]});
            }
            this.catalog.set(key,rows.sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id));
        }
        const needle=text.trim().toLowerCase(),hits=this.catalog.get(key)!.filter(row=>/^\d+$/.test(needle)?row.id===Number(needle):`${row.name} ${row.description}`.toLowerCase().includes(needle));
        return {rows:hits.slice(offset,offset+50),total:hits.length};
    }
    specialFeatures(){
        this.specialDonors();const seen=new Set<string>(),examples:Record<string,{id:number;name:string}>={};
        const preferred:Record<string,string>={'rule:hitCount':'Dragon dagger','action:drain-levels':'Seercull','rule:maximumDamageCap':'Dark bow'};
        const add=(key:string,reference:any)=>{if(!examples[key]||reference.name===preferred[key])examples[key]={id:reference.id,name:reference.name};};
        for(const reference of this.donorRows!){
            // Some native rules are imported as modifiers, or apply outside a special's recipe.
            for(const [type,value] of Object.entries(reference.traits??{}))if(Object.hasOwn(ATTACK_RULES,type)&&value!==undefined&&value!==null&&value!==false)add(`rule:${type}`,reference);
            const recipe=reference.recipe;
            for(const row of recipe?.rules??[])add(`rule:${row.type}`,reference);
            for(const row of recipe?.extras??[]){add(`extra:${row.type}`,reference);if(row.type==='ammo-damage'&&row.values.dragonCap>0)add('rule:maximumDamageCap',reference);}
            for(const row of recipe?.actions??[])add(`action:${row.type}`,reference);
            for(const row of recipe?.modifiers??[])add(`modifier:${row.type}`,reference);
            if(reference.damage!==1)add('modifier:damage',reference);
            if(reference.accuracy!==1)add('modifier:accuracy',reference);
            // The generic actions expose these same native mechanics independently.
            for(const group of reference.mechanics??[]){
                if(group.id==='recovery'&&group.parameters.some(p=>p.key==='prayerPercent'&&p.value>0))add('action:prayer',reference);
                if(group.id==='defence-drain')add('action:drain',reference);
                if(group.id==='damage-drain')add('action:drain-levels',reference);
                if(group.id==='ordered-drain')add('action:drain-stats',reference);
            }
        }
        // Ordinary-attack users are not special recipes. Check their canonical declarations.
        for(const [key,file,pattern,name,qualifier] of [
            ['rule:requireFirstAccurate','combat/specials/DualMacuahuitl.SpecialAttack.js',/requireFirstAccurate\s*:\s*!special/,'Dual macuahuitl',' (ordinary attacks)'],
            ['rule:bestOf','items/Obligator.plugin.js',/\bbestOf\s*:/,'Obligator','']
        ] as const){
            const source=path.join(this.root,'server/plugins',file);
            if(!fs.existsSync(source)||!pattern.test(fs.readFileSync(source,'utf8')))continue;
            const item=this.search('item',name,0,{references:true}).rows.find(row=>row.name.toLowerCase()===name.toLowerCase());
            if(item)add(key,{...item,name:item.name+qualifier});
        }
        return {examples,rows:this.donorRows!.flatMap(reference=>(reference.mechanics??[]).filter(group=>['handleAfterHitEffects','applySpecialFeature','getSpecialFeatureTraits'].includes(group.hook)).map(group=>({source:reference.id,sourceName:reference.name,group}))).filter(row=>{const key=JSON.stringify(row.group);if(seen.has(key))return false;seen.add(key);return true;})};
    }

    dropTable(id: number) {
        if (!Number.isInteger(id) || id < 0 || id >= this.loader('npc').getCount()) throw new Error('Choose a native creature.');
        const dump = this.json('npc-drops.json'), overrides = this.json('npc-drop-overrides.json');
        const npc = overrides.removeNpcs?.[id] ? null : dump.npcs?.[id] ?? overrides.addNpcs?.[id];
        const refs = [...new Set([...(npc?.tables ?? []), ...(!npc ? [] : overrides.addNpcs?.[id]?.tables ?? [])])] as string[];
        const tables = refs.slice(0, 8).flatMap(ref => {
            const source = dump.tables?.[ref]; if (!source) return [];
            const table = structuredClone(source), changes = overrides.tables?.[ref] ?? {};
            for (const [field, add] of [['entries', 'addEntries'], ['tertiary', 'addTertiary']]) {
                table[field] ??= [];
                for (const row of changes[add] ?? []) if (!table[field].some((existing: any) => existing.item_id === row.item_id)) table[field].push(structuredClone(row));
                table[field] = table[field].filter((row: any) => !(changes.removeSections ?? []).includes(row.section));
            }
            const entries = [...table.entries, ...table.tertiary];
            const rows = entries.slice(0, 80).map((row: any) => ({
                itemId: Number.isInteger(row.item_id) ? row.item_id : -1,
                name: String(row.name ?? row.shared_table ?? (row.nothing ? 'Nothing' : 'Conditional table entry')).slice(0, 120),
                amount: Array.isArray(row.quantity) ? row.quantity.join(' to ') : String(row.quantity_raw ?? 'See source rules').slice(0, 100),
                chance: row.always ? 'Guaranteed, if eligible' : row.rarity_raw ? String(row.rarity_raw).slice(0, 100) : row.weight > 0 && row.out_of > 0 ? `${row.weight} in ${row.out_of} source rolls` : 'See source rules',
                conditions: [...(row.notes ?? []).map((v: any) => String(v).slice(0, 250)), ...(row.separate_roll ? ['Separate roll'] : []), ...(row.shared_table ? ['Shared table'] : []), ...(row.noted ? ['Noted item'] : [])].slice(0, 8)
            }));
            return [{ name: String(table.table_name ?? table.label ?? ref).slice(0, 160), rows, more: Math.max(0, entries.length - rows.length) }];
        });
        return { id, tables, notice: 'Source-table reference only. TSPS applies player conditions, runtime corrections, shared rolls and plugin overrides when the creature dies. These rows are not final per-kill odds.' };
    }
    describe(kind: string, id: number, variant = 'body') {
        const loader = this.loader(kind);
        if (!Number.isInteger(id) || id < 0 || id >= loader.getCount()) throw new Error('This source definition does not exist in the current cache.');
        const type = loader.load(id), warnings: string[] = [];
        const ids = kind === 'npc' ? type.modelIds : variant === 'male' ? [type.maleModel, type.maleModel1, type.maleModel2] : variant === 'female' ? [type.femaleModel, type.femaleModel1, type.femaleModel2] : variant === 'maleHead' ? [type.maleHeadModel, type.maleHeadModel2] : variant === 'femaleHead' ? [type.femaleHeadModel, type.femaleHeadModel2] : [type.model];
        const meshes: any[] = [];
        for (const modelId of ids ?? []) {
            if (!(modelId >= 0)) continue;
            const data = this.factory.getModelLoader().getModel(modelId);
            if (!data) { warnings.push(`Model ${modelId} is missing.`); continue; }
            for (let i = 0; i < (type.recolorFrom?.length ?? 0); i++) data.recolor(type.recolorFrom[i], type.recolorTo[i]);
            for(let i=0;i<(type.retextureFrom?.length??0);i++)data.retexture(type.retextureFrom[i],type.retextureTo[i]);
            meshes.push(this.toMesh(data, warnings));
        }
        if (!meshes.length) throw new Error(`This ${type.name} has no ${variant} model. Try another view.`);
        // Keep independent vertex labels rather than deduplicating donor vertices.
        const mesh = assemble(meshes.map((mesh,i)=>({id:String(i),mesh}))) as any;
        if (kind === 'npc') for (const v of mesh.vertices) { v[0] *= (type.widthScale ?? 128) / 128; v[1] *= (type.heightScale ?? 128) / 128; v[2] *= (type.widthScale ?? 128) / 128; }
        if (kind === 'item') for (const v of mesh.vertices) {
            v[0] *= (type.resizeX ?? 128) / 128; v[1] *= (type.resizeY ?? 128) / 128; v[2] *= (type.resizeZ ?? 128) / 128;
            if (variant === 'male') { v[0] += type.manwearXOff ?? 0; v[1] += type.manwearYOff ?? 0; v[2] += type.manwearZOff ?? 0; }
            if (variant === 'female') { v[0] += type.womanwearXOff ?? 0; v[1] += type.womanwearYOff ?? 0; v[2] += type.womanwearZOff ?? 0; }
        }
        const fields = kind === 'npc' ? { idleSeqId: type.idleSeqId, walkSeqId: type.walkSeqId, turnLeftSeqId: type.turnLeftSeqId, turnRightSeqId: type.turnRightSeqId, size: type.size, combatLevel: type.combatLevel, actions: type.actions, attackLevel: type.attackLevel, strengthLevel: type.strengthLevel, defenceLevel: type.defenceLevel, rangedLevel: type.rangedLevel, magicLevel: type.magicLevel, hitpoints: type.hitpoints } : { wearPos: type.wearPos, wearPos2: type.wearPos2, wearPos3: type.wearPos3, zoom2d: type.zoom2d, xan2d: type.xan2d, yan2d: type.yan2d, zan2d: type.zan2d, offsetX2d: type.offsetX2d, offsetY2d: type.offsetY2d, inventoryActions: type.inventoryActions, isMembers: type.isMembers };
        this.combat ??= this.json('npc-combat-defs.json').npcs ?? {};
        const raw = kind === 'npc' ? this.json('monsters-complete.json')[id] : (this.json('item-gameplay.json') as any[]).find(row => row.id === id);
        const gameplay = raw?.name?.toLowerCase() === type.name.toLowerCase() ? raw : {};
        let rig;
        if (kind === 'npc') {
            try {
                const seq = this.loader('seq').load(type.walkSeqId >= 0 ? type.walkSeqId : type.idleSeqId);
                if (seq.isSkeletalSeq()) {
                    const skeletal = this.factory.getSkeletalSeqLoader()?.load(seq.skeletalId);
                    if (skeletal) rig = { weighted: true, parents: skeletal.skeletalBase.bones.map(b => b.parentId) };
                } else {
                    const base = this.factory.getSeqFrameLoader().load(seq.frameIds[0])?.base;
                    if (base) rig = { types: base.types, labels: base.labels };
                }
            } catch { /* Static or missing rigs still get disconnected-piece cards. */ }
        }
        const parts = kind === 'item' ? describeGearParts(mesh) : describeParts(mesh, rig);
        return { kind, id, variant, name: type.name, mesh, parts, fields, gameplay, combat: kind === 'npc' ? this.combat[id] ?? {} : {}, warnings: [...new Set(warnings)] };
    }
    private json(file: string) { if (!this.jsonCache.has(file)) { const name = path.join(this.root, 'server/data/definitions', file); this.jsonCache.set(file, fs.existsSync(name) ? JSON.parse(fs.readFileSync(name, 'utf8')) : file === 'item-gameplay.json' ? [] : {}); } return this.jsonCache.get(file); }
    sequenceNames() {
        if (!this.names) {
            this.names = new Map();
            try { const archive = CacheIndexDat2.fromStore(24, this.store as any).getArchive(7); for (const id of archive.fileIds) { const data = archive.getFile(id)?.data; if (data) this.names.set(id, Buffer.from(data).toString('utf8').replace(/\0+$/, '')); } } catch { /* Older caches may have no gameval names. Numeric sequence IDs still work. */ }
        }
        return this.names;
    }
    // Search aliases are read from canonical declarations and native character
    // records. No gameplay module is required or executed to build this index.
    private animationSources() {
        if(this.sequenceSources)return this.sequenceSources;
        const aliases=new Map<number,Set<string>>(),add=(id:any,name:string)=>{if(!Number.isInteger(id)||id<0||id>=this.loader('seq').getCount())return;if(!aliases.has(id))aliases.set(id,new Set());aliases.get(id)!.add(name.replace(/_/g,' '));};
        const ts=require('typescript'),sequenceIds=new Map([...this.sequenceNames()].map(([id,name])=>[name,id])),specials=path.join(this.root,'server/plugins/combat/specials'),items=path.join(this.root,'server/plugins/items');
        const files=[...fs.readdirSync(specials).filter(file=>file.endsWith('.SpecialAttack.js')).map(file=>[specials,file,'special attack']),...fs.readdirSync(items).filter(file=>file.endsWith('.js')).map(file=>[items,file,'item movement'])];
        for(const [directory,file,role] of files.sort((a,b)=>a[1].localeCompare(b[1]))){
            const filename=path.join(directory,file);if(fs.statSync(filename).size>160000)continue;
            const source=fs.readFileSync(filename,'utf8'),tree=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),constants=new Map<string,any>();
            const collect=(node:any)=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)constants.set(node.name.text,node.initializer);ts.forEachChild(node,collect);};collect(tree);
            const literal=(node:any,depth=0):string|undefined=>!node||depth>8?undefined:ts.isStringLiteral(node)?node.text:ts.isIdentifier(node)?literal(constants.get(node.text),depth+1):undefined;
            const values=(node:any,depth=0):number[]=>{
                if(!node||depth>8)return [];
                if(ts.isNumericLiteral(node))return [Number(node.text)];
                if(ts.isIdentifier(node))return values(constants.get(node.text),depth+1);
                if(ts.isParenthesizedExpression(node))return values(node.expression,depth+1);
                if(ts.isConditionalExpression(node))return [...values(node.whenTrue,depth+1),...values(node.whenFalse,depth+1)];
                if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='getSeqId'){
                    const name=literal(node.arguments[0]),id=name===undefined?undefined:sequenceIds.get(name);return id===undefined?[]:[id];
                }
                if(ts.isArrayLiteralExpression(node))return node.elements.flatMap((entry:any)=>values(entry,depth+1));
                if(ts.isElementAccessExpression(node)&&ts.isIdentifier(node.expression))return values(constants.get(node.expression.text),depth+1);
                return [];
            };
            const name=file.replace(/\.(SpecialAttack|plugin)\.js$|\.js$/,'').replace(/([a-z])([A-Z0-9])/g,'$1 $2').replace(/Bh$/,'(bh)');
            const visit=(node:any)=>{
                if(ts.isNewExpression(node)&&/(^|\.)Animation$/.test(node.expression.getText(tree)))for(const id of values(node.arguments?.[0]))add(id,`${name} ${role}`);
                if(ts.isPropertyAssignment(node)&&/^(animation|attackAnimation)$/.test(node.name.getText(tree)))for(const id of values(node.initializer))add(id,`${name} ${role}`);
                ts.forEachChild(node,visit);
            };visit(tree);
        }
        const combat=this.json('npc-combat-defs.json').npcs??{};
        for(const [id,row] of Object.entries(combat) as any){
            const name=row.name??`Creature ${id}`;
            for(const [role,sequence] of Object.entries(row.anims??{}))add(sequence,`${name} ${role}`);
        }
        for(const [id,sequences] of Object.entries(this.json('npc-animations.json'))){
            if(!Array.isArray(sequences))continue;
            let name=combat[id]?.name;try{name??=this.loader('npc').load(Number(id)).name;}catch{continue;}
            if(!name||name==='null')continue;for(const sequence of sequences)add(sequence,`${name} movement`);
        }
        for(const item of this.json('item-gameplay.json'))for(const [key,role] of [['standAnim','Idle'],['walkAnim','Walk'],['runAnim','Run'],['attackAnim','Attack'],['blockAnim','Block']])if(item.name)add(item[key],`${item.name} ${role}`);
        this.sequenceSources=aliases;return aliases;
    }
    attackChoices(id: number) {
        const source=this.gameData('npc',id), names=this.sequenceNames();
        // npc-animations contains observed per-NPC sequences, including styles
        // implemented by plugin CombatMethods instead of the single combat row.
        const observed=this.json('npc-animations.json')[id]??[], primary=source.combat?.anims?.attack;
        const ids=[...new Set<number>([primary,...(Array.isArray(observed)?observed:[])].filter(Number.isInteger))];
        const rows=ids.flatMap(sequence=>{
            const nativeName=names.get(sequence)??'',words=nativeName.replace(/_/g,' ');
            if(sequence!==primary && (!/attack|smash|shoot|cast|strike|spit|breath|punch|kick|slash|stab|crush|bite/i.test(words)||/defend|death|walk|idle|spawn|block/i.test(words)))return [];
            const style=/magic|cast/i.test(words)?'MAGIC':/ranged?|shoot|spit/i.test(words)?'RANGED':/melee|punch|kick|slash|stab|crush|bite/i.test(words)?'MELEE':source.gameplay?.attack_type?.includes('magic')?'MAGIC':source.gameplay?.attack_type?.includes('ranged')?'RANGED':'MELEE';
            const label=words.replace(/^.*?\battack\b\s*/i,'').trim();
            const name=label?label[0].toUpperCase()+label.slice(1):`${style[0]}${style.slice(1).toLowerCase()} attack`;
            return [{sourceKind:'npc',sourceId:id,sequence,name,style,nativeName,origin:sequence===primary?'Combat definition':'Observed source movements'}];
        }).slice(0,32);
        return {name:source.name,rows,note:'Movement choices use this creature\'s observed native rig. Boss-specific AI, prayer reading, arena hazards and summon rules are not copied.'};
    }
    gamevals(archiveId:number){if(!this.gamevalNames.has(archiveId)){const names=new Map<number,string>();try{const archive=CacheIndexDat2.fromStore(24,this.store as any).getArchive(archiveId);for(const id of archive.fileIds){const data=archive.getFile(id)?.data;if(data)names.set(id,Buffer.from(data).toString('utf8').replace(/\0+$/,''));}}catch{}this.gamevalNames.set(archiveId,names);}return this.gamevalNames.get(archiveId)!;}
    weaponStyles() { return Object.keys(this.json('item-combat-styles.json').weaponInterfaces ?? {}); }
    mannequin(gender: string, slots: string | string[], style = 'dummy') {
        if (!['dummy', 'character'].includes(style)) throw new Error('Choose a dummy or character body reference.');
        const female = gender === 'female', loader = this.factory.getIdkTypeLoader(), parts: any[] = [];
        const hide = new Set<number>();
        for (const slot of Array.isArray(slots) ? slots : [slots]) {
            if (['BODY', 'PLATEBODY'].includes(slot)) hide.add(2);
            if (slot === 'PLATEBODY') hide.add(3);
            if (slot === 'LEGS') hide.add(5);
            if (slot === 'GLOVES') hide.add(4);
            if (slot === 'BOOTS') hide.add(6);
            if (['FULL_HELMET', 'MED_HELMET', 'HAT', 'MASK', 'COIF'].includes(slot)) { hide.add(0); hide.add(1); }
        }
        const found = new Set<number>(), kits: {id:number;part:number}[] = [];
        for (let id = 0; id < loader.getCount(); id++) {
            const kit = loader.load(id), part = kit.bodyPartyId - (female ? 7 : 0);
            if (part < 0 || part > 6 || female && part === 1 || kit.nonSelectable || found.has(part) || hide.has(part) || !kit.modelIds?.length) continue;
            found.add(part);kits.push({id,part});
            for (const modelId of kit.modelIds) {
                const model = this.factory.getModelLoader().getModel(modelId); if (!model) continue;
                const mesh = this.toMesh(model, []);
                const kitColours = new Map((kit.recolorFrom ?? []).map((colour:number,i:number) => [colour, kit.recolorTo[i]]));
                // Native body recolour channels. Quiet clothing keeps attention on the custom gear.
                const bodyColours = new Map([[6798, 16], [8741, 12], [25238, 12], [4626, 12], [4550, NEUTRAL_SKIN_HSL], [55232, 16], [9104, 12]]);
                mesh.faces.forEach(f => { const colour = Number(kitColours.get(f[3]) ?? f[3]); f[3] = style === 'dummy' ? 60 : bodyColours.get(colour) ?? colour; });
                parts.push(mesh);
            }
        }
        const mesh = assemble(parts.map((mesh,i)=>({id:String(i),mesh})));
        return { mesh, style, skinColour: NEUTRAL_SKIN_HSL, gender: female ? 'female' : 'male', kits };
    }
    previewScene(id: string) {
        const preset = PREVIEW_SCENES.find(row => row.id === id);
        if (!preset) throw new Error('Choose a listed preview background.');
        if (this.previewScenes.has(id)) return this.previewScenes.get(id);
        if (preset.studio) return { ...preset, items: [] };
        const { SceneBuilder } = require(path.join(root, 'client/rs/scene/SceneBuilder'));
        const { LocModelLoader } = require(path.join(root, 'client/rs/config/loctype/LocModelLoader'));
        const f = this.factory, textures = f.getTextureLoader();
        const models = new LocModelLoader(f.getLocTypeLoader(), f.getModelLoader(), textures, f.getSeqTypeLoader(), f.getSeqFrameLoader(), f.getSkeletalSeqLoader());
        const builder = new SceneBuilder(this.info, f.getMapFileLoader(), f.getUnderlayTypeLoader(), f.getOverlayTypeLoader(), f.getLocTypeLoader(), models, new Map());
        const radius = 12, size = radius * 2 + 1, scene = builder.buildScene(preset.x - radius, preset.y - radius, size, size, true);
        const cx = radius * 128 + 64, cz = radius * 128 + 64, plane = preset.plane;
        if (!scene.tiles[plane][radius][radius]?.tileModel?.faces.length) throw new Error('This background has no floor at its viewpoint in this cache.');
        const floor = (scene.tileHeights[plane][radius][radius] + scene.tileHeights[plane][radius+1][radius] + scene.tileHeights[plane][radius][radius+1] + scene.tileHeights[plane][radius+1][radius+1]) / 4;
        const meshes: any[] = [], seen = new Set<any>(); let faces = 0, vertices = 0;
        const add = (mesh:any, x=0, y=0, z=0) => {
            if (!mesh.faces.length || faces + mesh.faces.length > 40000 || vertices + mesh.vertices.length > 60000) return;
            mesh.vertices = mesh.vertices.map(([vx,vy,vz]:number[]) => [vx+x-cx, vy+y-floor, vz+z-cz]);
            faces += mesh.faces.length; vertices += mesh.vertices.length;
            for (const channel of ['skins','bones','weights','faceLabels']) delete mesh[channel];
            meshes.push({id:`scene-${id}-${meshes.length}`,mesh,reference:true,opacity:1});
        };
        // Keep the roof the character stands on, plus the surrounding lower levels.
        // Higher ceilings are omitted so they cannot cover the preview character.
        for (let level = plane; level >= 0; level--) for (const column of scene.tiles[level]) for (const tile of column) {
            if (!tile) continue;
            if (tile.tileModel && !tile.skipRender) {
                const ground:any = {vertices:[],faces:[],textures:[],textureCoords:[],textureMappings:[]};
                for (const face of tile.tileModel.faces) {
                    const index = ground.vertices.length;
                    ground.vertices.push(...face.vertices.map((v:any) => [v.x,v.y,v.z]));
                    const colour = face.vertices[0].textureId >= 0 ? textures.getAverageHsl(face.vertices[0].textureId) : face.vertices[0].hsl;
                    if (colour < 0 || colour === 12345678) { ground.vertices.splice(index); continue; }
                    ground.faces.push([index,index+1,index+2,colour & 65535]);
                    const texture = face.vertices[0].textureId;
                    ground.textures.push(texture);
                    ground.textureCoords.push(texture >= 0 ? ground.textureMappings.length : -1);
                    if (texture >= 0) ground.textureMappings.push([index,index+1,index+2]);
                }
                add(ground);
            }
            for (const loc of [tile.wall,tile.wallDecoration,tile.floorDecoration,...tile.locs]) {
                if (!loc || seen.has(loc)) continue; seen.add(loc);
                for (const entity of [loc.entity,loc.entity0,loc.entity1]) {
                    // Animated/morphing scenery is unnecessary for a colour-comparison backdrop.
                    if (!entity?.verticesCount || !entity.faceCount) continue;
                    const mesh = this.toMesh(entity, []);
                    add(mesh, loc.x+(loc.offsetX??0), loc.height, loc.y+(loc.offsetY??0));
                }
            }
        }
        if (!faces) throw new Error('This cache has no scenery for that background.');
        const result = { ...preset, items:meshes };
        this.previewScenes.set(id,result);
        return result;
    }
    private toMesh(data: any, warnings: string[]) {
        const faces = Array.from({ length: data.faceCount }, (_, i) => {
            return [data.indices1[i], data.indices2[i], data.indices3[i], data.faceColors[i]];
        });
        if(Array.from(data.textureRenderTypes??[]).some((n:any)=>n!==0))throw new Error('This source uses a non-OSRS texture projection that the native v3 decoder cannot preserve.');
        return { vertices: Array.from({ length: data.verticesCount }, (_, i) => [data.verticesX[i], data.verticesY[i], data.verticesZ[i]]), faces,
            skins: Array.from({ length: data.verticesCount }, (_, i) => data.vertexSkins?.[i] ?? -1),
            bones: Array.from({ length: data.verticesCount }, (_, i) => Array.from(data.animMayaGroups?.[i] ?? [])), weights: Array.from({ length: data.verticesCount }, (_, i) => Array.from(data.animMayaScales?.[i] ?? [])),
            alpha: Array.from({ length: data.faceCount }, (_, i) => (data.faceAlphas?.[i] ?? 0) & 255), priorities: Array.from({ length: data.faceCount }, (_, i) => (data.faceRenderPriorities?.[i] ?? data.priority ?? 0) & 255),
            textures:Array.from({length:data.faceCount},(_,i)=>data.faceTextures?.[i]??-1),textureCoords:Array.from({length:data.faceCount},(_,i)=>data.textureCoords?.[i]===undefined||data.textureCoords[i]===-1?-1:data.textureCoords[i]&255),
            textureMappings:Array.from({length:data.textureFaceCount??data.texTriangleCount??0},(_,i)=>[data.textureMappingP[i]&65535,data.textureMappingM[i]&65535,data.textureMappingN[i]&65535]),faceLabels:Array.from({length:data.faceCount},(_,i)=>data.faceSkins?.[i]??-1),renderTypes:Array.from({length:data.faceCount},(_,i)=>(data.faceRenderTypes?.[i]??0)&255) };
    }
    hasTexture(id:number){return this.factory.getTextureLoader().getTextureIds().includes(id);}
    textureCatalog(query='',offset=0){
        const loader=this.factory.getTextureLoader(),q=query.trim().toLowerCase();
        const rows=loader.getTextureIds().map((id:number)=>{const m=loader.getMaterial(id),frames=loader.getFrameCount(id),motion=m.animU||m.animV?'Scrolling':frames>1?'Frame animation':'Static';return {id,name:`Texture ${id} · ${motion.toLowerCase()}`,description:`${frames} frames, U ${m.animU}, V ${m.animV}`,animU:m.animU,animV:m.animV,frameRate:m.animSpeed};}).filter((row:any)=>!q||`${row.id} ${row.name} ${row.description}`.toLowerCase().includes(q));
        return {rows:rows.slice(offset,offset+20),total:rows.length};
    }
    texture(id:number){
        const loader=this.factory.getTextureLoader();if(!Number.isInteger(id)||!loader.getTextureIds().includes(id))throw new Error('Texture is not available in this cache.');
        const size=128,count=Math.max(1,Math.min(32,loader.getFrameCount(id))),frames=[];
        for(let f=0;f<count;f++){const argb=loader.getPixelsArgb(id,size,false,1,f),rgba=Buffer.alloc(size*size*4);for(let i=0;i<argb.length;i++){const v=argb[i];rgba[i*4]=(v>>>16)&255;rgba[i*4+1]=(v>>>8)&255;rgba[i*4+2]=v&255;rgba[i*4+3]=(v>>>24)&255;}frames.push(rgba.toString('base64'));}
        return {id,size,frames,material:loader.getMaterial(id)};
    }
    effect(id:number) {
        const loader=this.loader('effect');if(!Number.isInteger(id)||id<0||id>=loader.getCount())throw new Error('Choose a VFX from this cache.');
        const type=loader.load(id),data=this.factory.getModelLoader().getModel(type.modelId);if(!data)throw new Error('This VFX has no available model.');
        for(let i=0;i<(type.recolorFrom?.length??0);i++)data.recolor(type.recolorFrom[i],type.recolorTo[i]);
        for(let i=0;i<(type.retextureFrom?.length??0);i++)data.retexture(type.retextureFrom[i],type.retextureTo[i]);
        const mesh=this.toMesh(data,[]);if(mesh.vertices.length>40000)throw new Error('This VFX exceeds the preview geometry limit.');
        let result:any={mesh,frames:[{duration:1000,vertices:mesh.vertices}],duration:1000};
        if(type.sequenceId>=0)result=this.animate(mesh,type.sequenceId,Math.max(1,Math.min(48,Math.floor(260000/mesh.vertices.length))));
        const angle=(type.orientation??0)*Math.PI/180,cs=Math.cos(angle),sn=Math.sin(angle);
        const transform=([x,y,z]:number[])=>[(x*cs+z*sn)*(type.widthScale??128)/128,y*(type.heightScale??128)/128,(-x*sn+z*cs)*(type.widthScale??128)/128];
        result.mesh={...result.mesh,vertices:result.mesh.vertices.map(transform)};
        result.frames=result.frames.map((frame:any)=>({...frame,vertices:frame.vertices.map(transform)}));
        return {...result,id,...this.effectLabel(id),sequence:type.sequenceId,duration:result.frames.reduce((n:number,f:any)=>n+f.duration,0)};
    }
    combatEnemies() {
        return ['Rock crab','Goblin','Hill giant','Green dragon'].map((name,index)=>{
            const rows=this.search('npc',name,0,{creaturesOnly:true}).rows;
            const row=rows.filter((row:any)=>row.name.toLowerCase()===name.toLowerCase()).sort((a:any,b:any)=>a.id-b.id)[0];
            return row?{...row,sizeLabel:['Small','Medium','Large','Extra large'][index]}:null;
        }).filter(Boolean);
    }
    previewAmmunition(weaponId:number){
        // Read the canonical compatibility declarations without starting gameplay or loading a world.
        const key='preview-ammunition';
        if(!this.catalog.has(key)){
            const ts=require('typescript'),filename=path.join(this.root,'server/src/main/typescript/elvarg/game/content/combat/ranged/RangedData.ts'),tree=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true),declarations=new Map<string,any>(),memo=new Map<string,any>(),ids=new Map<string,number>();
            for(const m of fs.readFileSync(path.join(this.root,'server/src/main/typescript/elvarg/util/ItemIdentifiers.ts'),'utf8').matchAll(/\bstatic\s+([A-Z0-9_]+)\s*=\s*(\d+)/g))ids.set(m[1],Number(m[2]));
            for(const node of tree.statements)if(ts.isClassDeclaration(node)&&node.name)for(const field of node.members)if(ts.isPropertyDeclaration(field)&&field.initializer)declarations.set(`${node.name.text}.${field.name.getText(tree)}`,field.initializer);
            let dragonStrength:number|undefined;
            const evaluate=(node:any,depth=0):any=>{
                if(!node||depth>16)return undefined;
                if(ts.isNumericLiteral(node))return Number(node.text);
                if(ts.isParenthesizedExpression(node))return evaluate(node.expression,depth+1);
                if(ts.isPropertyAccessExpression(node)){const name=node.getText(tree);if(node.expression.getText(tree)==='ItemIdentifiers')return ids.get(node.name.text);if(memo.has(name))return memo.get(name);const result=evaluate(declarations.get(name),depth+1);memo.set(name,result);return result;}
                if(ts.isArrayLiteralExpression(node))return node.elements.flatMap((entry:any)=>ts.isSpreadElement(entry)?evaluate(entry.expression,depth+1)??[]:[evaluate(entry,depth+1)]).filter(value=>value!==undefined);
                if(ts.isElementAccessExpression(node))return evaluate(node.expression,depth+1)?.[evaluate(node.argumentExpression,depth+1)];
                if(ts.isNewExpression(node)){const name=node.expression.getText(tree),args=node.arguments;if(name==='Ammunition'){const id=evaluate(args[0],depth+1),strength=evaluate(args[3],depth+1);return Number.isInteger(id)&&Number.isFinite(strength)?{id,strength}:undefined;}if(name==='RangedWeapon')return {weaponIds:evaluate(args[0],depth+1)??[],ammo:evaluate(args[1],depth+1)??[]};}
                if(ts.isCallExpression(node)){
                    const name=node.expression.getText(tree),args=node.arguments;
                    if(name==='Ammunition.dragonBolt')return {id:evaluate(args[0],depth+1),strength:dragonStrength};
                    if(name==='Ammunition.javelins'){const id=evaluate(args[0],depth+1),variants=evaluate(args[1],depth+1)??[],strength=evaluate(args[3],depth+1);return [id,...variants].filter(Number.isInteger).map(id=>({id,strength}));}
                    if(ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='getAmmunitionData')return evaluate(node.expression.expression,depth+1)?.ammo;
                }
            };
            // Read the helper's strength argument too, so future ammunition updates need no editor patch.
            const ammoClass=tree.statements.find((node:any)=>ts.isClassDeclaration(node)&&node.name?.text==='Ammunition'),helper=ammoClass?.members.find((node:any)=>node.name?.getText(tree)==='dragonBolt');
            const scan=(node:any)=>{if(ts.isNewExpression(node)&&node.expression.getText(tree)==='Ammunition')dragonStrength=evaluate(node.arguments?.[3]);ts.forEachChild(node,scan);};if(helper)scan(helper);
            if(helper&&!Number.isFinite(dragonStrength))throw new Error('Cannot read the native ammunition strength declaration.');
            const rows=[...declarations].filter(([name])=>name.startsWith('RangedWeapon.')).map(([,node])=>evaluate(node)).filter(row=>row?.weaponIds?.length&&row.ammo?.length);
            this.catalog.set(key,rows);
        }
        const row=this.catalog.get(key).find(row=>row.weaponIds.includes(weaponId));
        if(!row||row.ammo.length===1&&row.weaponIds.includes(row.ammo[0].id))return null;
        const definitions=new Map((this.json('item-gameplay.json') as any[]).map(item=>[item.id,item]));
        const candidates=row.ammo.filter(ammo=>Number.isInteger(ammo.id)).map(ammo=>({...ammo,strength:Number(definitions.get(ammo.id)?.bonuses?.[11]??ammo.strength??0),name:this.loader('item').load(ammo.id).name})).filter(ammo=>ammo.strength>0);
        candidates.sort((a,b)=>b.strength-a.strength||Number(/\((?:e|p)/i.test(a.name))-Number(/\((?:e|p)/i.test(b.name))||a.id-b.id);
        return candidates[0]??null;
    }
    hitsplatThemes(){
        const key='preview-hitsplat-themes';if(this.catalog.has(key))return this.catalog.get(key);
        const {ArchiveHitSplatTypeLoader}=require(path.join(this.root,'client/rs/config/hitsplat/HitSplatTypeLoader')),{SpriteLoader}=require(path.join(this.root,'client/rs/sprite/SpriteLoader')),{BitmapFont}=require(path.join(this.root,'client/rs/font/BitmapFont'));
        const indices=new Map<number,any>(),getIndex=(id:number)=>{if(!indices.has(id))indices.set(id,CacheIndexDat2.fromStore(id,this.store as any));return indices.get(id);},types=new ArchiveHitSplatTypeLoader(this.info,getIndex(2).getArchive(32)),fonts=new Map();
        const sprite=(id:number)=>{if(id<0)return null;const value=SpriteLoader.loadIntoIndexedSprite(getIndex(8),id);if(!value)return null;const pixels=Buffer.alloc(value.subWidth*value.subHeight*4);for(let i=0;i<value.pixels.length;i++){const colour=value.palette[value.pixels[i]];pixels[i*4]=(colour>>>16)&255;pixels[i*4+1]=(colour>>>8)&255;pixels[i*4+2]=colour&255;pixels[i*4+3]=value.alpha?.[i]??(value.pixels[i]===0?0:255);}return {width:value.subWidth,height:value.subHeight,rgba:pixels.toString('base64')};};
        const rows=[12,16,43,65,74].map(id=>{let type=types.load(id);const visited=new Set();while(type.multihitsplats&&!visited.has(type.id)){visited.add(type.id);const next=type.multihitsplats[0]??type.multihitsplats.at(-1);if(!(next>=0))break;type=types.load(next);}const fontId=type.fontId>=0?type.fontId:494;if(!fonts.has(fontId)){const font=BitmapFont.tryLoad({getIndex},fontId);fonts.set(fontId,font?{ascent:font.ascent,digits:Array.from({length:10},(_,n)=>{const code=48+n;return {width:font.widths[code],height:font.heights[code],left:font.leftBearings[code],top:font.topBearings[code],advance:font.advances[code],mask:Buffer.from(font.glyphPixels[code]??[]).toString('base64')};})}:null);}return {id,durationMs:type.displayCycles*20,fadeStartMs:type.fadeStartCycle*20,xOffset:type.xOffset,yOffset:type.yOffset,textOffsetY:type.textOffsetY,textColor:type.textColor,compareType:type.compareType,font:fonts.get(fontId),left:sprite(type.leftSpriteId),left2:sprite(type.leftSpriteId2),middle:sprite(type.middleSpriteId),right:sprite(type.rightSpriteId)};});
        this.catalog.set(key,rows);return rows;
    }
    sequenceSounds(id:number){
        if(!Number.isInteger(id)||id<0||id>=this.loader('seq').getCount())return [];
        const seq=this.loader('seq').load(id),skeletal=seq.isSkeletalSeq(),length=skeletal?seq.getSkeletalDuration():seq.frameIds?.length??0,rows:any[]=[];let timeMs=0;
        for(let frame=0;frame<length;frame++){
            let sounds=seq.frameSounds?.get(skeletal?frame+(seq.skeletalStart??0):frame);
            if(!sounds?.length){const packed=seq.soundEffects?.[frame];if(packed>0)sounds=[{id:packed>>8,loops:(packed>>4)&7,location:packed&15}];}
            for(const sound of sounds??[])if(sound.id>0&&(sound.loops??1)>0)rows.push({id:sound.id,loops:Math.min(10,sound.loops??1),timeMs,weight:sound.weight,location:sound.location??0});
            timeMs+=skeletal?20:Math.max(1,seq.frameLengths?.[frame]??1)*20;
        }
        return rows.slice(0,256);
    }
    combatAudio(npcId:number,weaponId:number){
        const named=new Map<string,number>(),source=fs.readFileSync(path.join(this.root,'server/src/main/typescript/elvarg/game/Sound.ts'),'utf8');for(const m of source.matchAll(/\b([A-Z][A-Z0-9_]+)\s*=\s*new Sound\((\d+)/g))named.set(m[1],Number(m[2]));
        const captured=this.json('npc-combat-sounds.json').npcs?.[npcId]??{},definition=this.json('npc-combat-defs.json').npcs?.[npcId]??{},item=(this.json('item-gameplay.json') as any[]).find(row=>row.id===weaponId),styles=this.json('item-combat-styles.json'),profile=styles.weaponInterfaces?.[item?.weaponInterface],fight=styles.fightTypes?.[profile?.fightTypes?.[0]],playerAttack=named.get(fight?.sound);
        return {npc:{attackBase:named.get('NPC_ATTACKING'),hit:captured.hit??[],attack:captured.attack??[],death:definition.sounds?.death>0?[[definition.sounds.death,0]]:captured.death??[],anims:definition.anims??{},style:definition.attackType??'MELEE'},player:{hit:named.get('PLAYER_GETTING_HIT'),block:named.get('DEFENCE_BLOCK'),attack:playerAttack,blockAnimation:item?.blockAnim??424}};
    }
    sound(id:number,loops=1){
        if(!Number.isInteger(id)||id<0||id>65534||!Number.isInteger(loops)||loops<1||loops>10)throw new Error('Choose a sound and repeat count.');const raw=this.sounds.load(id,false);if(!raw?.samples?.length)throw new Error('This sound has no playable sample.');
        const start=Math.max(0,Math.min(raw.samples.length,raw.start??0)),end=Math.max(start,Math.min(raw.samples.length,raw.end??0)),repeat=end>start?end-start:raw.samples.length,length=Math.min(raw.samples.length+repeat*(loops-1),raw.sampleRate*20),wave=Buffer.alloc(44+length*2);wave.write('RIFF',0);wave.writeUInt32LE(36+length*2,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(raw.sampleRate,24);wave.writeUInt32LE(raw.sampleRate*2,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(length*2,40);
        for(let i=0;i<length;i++){const index=loops===1?i:end>start?(i<end?i:i<end+repeat*(loops-1)?start+(i-end)%repeat:i-repeat*(loops-1)):i%raw.samples.length;wave.writeInt16LE((raw.samples[index]<<24>>24)*256,44+i*2);}return wave;
    }
    animateGear(projects:any[],variant:string,sequenceId:number,body:any,reference:any={}){
        const {mesh,compiled}=compileGearVisualScene(projects,variant,body,reference),sequence=this.loader('seq').load(sequenceId),skeletal=sequence.isSkeletalSeq(),length=skeletal?sequence.getSkeletalDuration():sequence.frameIds?.length;
        if(!length)throw new Error('This sequence has no playable frames.');
        const lengths=Array.from({length},(_,i)=>skeletal?20:Math.max(1,sequence.frameLengths?.[i]??1)*20),nativeDuration=lengths.reduce((a,b)=>a+b,0),duration=Math.min(60000,Math.max(8000,nativeDuration,...compiled.models.map(row=>row.duration*1000*(row.loop==='pingpong'?2:1)))),count=Math.max(2,Math.min(160,Math.floor(260000/mesh.vertices.length))),frames=[];
        for(let sample=0;sample<count;sample++){
            const time=sample*duration/count,posed={...mesh,vertices:mesh.vertices.map(v=>[...v]),alpha:[...mesh.alpha],faces:mesh.faces.map(f=>[...f])},colours=posed.faces.map(f=>f[3]);
            sampleVisualGeometry(posed.vertices,posed.alpha,colours,compiled,time/1000);posed.faces.forEach((f,i)=>f[3]=colours[i]);
            const data=ModelData.decode(new Int8Array(encodeModel(posed))),model=data.light(this.factory.getTextureLoader(),64,850,-30,-50,-30);let cursor=time%nativeDuration,index=0;
            while(index<length-1&&cursor>=lengths[index]){cursor-=lengths[index];index++;}
            if(skeletal){const clip=this.factory.getSkeletalSeqLoader()?.load(sequence.skeletalId);if(!clip)throw new Error('This skeletal movement is missing.');model.animateSkeletal(clip,index+sequence.skeletalStart);}
            else{const frame=this.factory.getSeqFrameLoader().load(sequence.frameIds[index]);if(!frame)throw new Error('This movement frame is missing.');model.animate(frame,undefined,false);}
            frames.push({duration:duration/count,visualTime:time/1000,colours,alpha:Array.from(model.faceAlphas??[],(n:number)=>n&255),vertices:Array.from({length:model.verticesCount},(_,i)=>[model.verticesX[i],model.verticesY[i],model.verticesZ[i]])});
        }
        const decoded:any=this.toMesh(ModelData.decode(new Int8Array(encodeModel(mesh))),[]);decoded.visualTextures=compiled.textures;
        const nativeSounds=this.sequenceSounds(sequenceId),soundEvents=[];for(let offset=0;offset<duration&&soundEvents.length<256;offset+=nativeDuration)for(const event of nativeSounds)if(event.timeMs+offset<duration&&soundEvents.length<256)soundEvents.push({...event,timeMs:event.timeMs+offset});
        return {mesh:decoded,frames,skeletal,length,visualLayers:{textures:compiled.textures.length,particles:compiled.particles.length,models:compiled.models.length},soundEvents};
    }
    animate(mesh: any, sequenceId: number, count = 24) {
        const loader = this.loader('seq');
        if (!Number.isInteger(sequenceId) || sequenceId < 0 || sequenceId >= loader.getCount()) throw new Error('Choose a valid animation from the OSRS cache.');
        const sequence = loader.load(sequenceId), skeletal = sequence.isSkeletalSeq(), length = skeletal ? sequence.getSkeletalDuration() : sequence.frameIds?.length;
        if (!length) throw new Error('This sequence has no playable frames.');
        if (skeletal && !mesh.bones?.some(row => row.length)) throw new Error('This animation needs weighted bones. Use a source with the same rig, or bind the parts first.');
        const encoded = new Int8Array(encodeModel(mesh)), frames: any[] = [], sampleCount = Math.min(length, Math.max(1, Math.min(48, count)));
        if (mesh.vertices.length * sampleCount > 280000) throw new Error('Preview is too large. Use fewer animation samples or a smaller model.');
        for (let sample = 0; sample < sampleCount; sample++) {
            const index = Math.floor(sample * length / sampleCount), data = ModelData.decode(encoded);
            const model = data.light(this.factory.getTextureLoader(),64, 850, -30, -50, -30);
            if (skeletal) {
                const seq = this.factory.getSkeletalSeqLoader()?.load(sequence.skeletalId);
                if (!seq) throw new Error('This skeletal animation is missing from the cache.');
                model.animateSkeletal(seq, index + sequence.skeletalStart);
            } else {
                const frame = this.factory.getSeqFrameLoader().load(sequence.frameIds[index]);
                if (!frame) throw new Error('This animation frame is missing from the cache.');
                model.animate(frame, undefined, false);
            }
            const endIndex=Math.floor((sample+1)*length/sampleCount);
            frames.push({ duration: skeletal ? 20 * (endIndex-index) : Array.from({length:endIndex-index},(_,n)=>Math.max(1,sequence.frameLengths?.[index+n]??1)*20).reduce((a,b)=>a+b,0), alpha:Array.from(model.faceAlphas??[],(v:any)=>v&255),
                vertices: Array.from({ length: model.verticesCount }, (_, i) => [model.verticesX[i], model.verticesY[i], model.verticesZ[i]]) });
        }
        // encodeModel reorders by first use; preview faces must use that same vertex order.
        const decoded = this.toMesh(ModelData.decode(encoded), []);
        return { mesh: decoded, frames, skeletal, length, soundEvents:this.sequenceSounds(sequenceId) };
    }
    // Compiler path: evaluate every native frame on the complete donor rig. The
    // returned vertices use source order, so extracting an arm cannot change pivots.
    sample(mesh:any,sequenceId:number){
        const loader=this.loader('seq');if(!Number.isInteger(sequenceId)||sequenceId<0||sequenceId>=loader.getCount())throw new Error('This donor animation is missing.');
        const sequence=loader.load(sequenceId),skeletal=sequence.isSkeletalSeq(),length=skeletal?sequence.getSkeletalDuration():sequence.frameIds?.length;
        if(!length||length>240||length*mesh.vertices.length>3000000)throw new Error('This donor animation exceeds the 240-frame sampling budget. Choose a shorter movement.');
        const encoded=new Int8Array(encodeModel(mesh)),order=modelVertexOrder(mesh),frames=[];
        for(let index=0;index<length;index++){
            const model=ModelData.decode(encoded).light(this.factory.getTextureLoader(),64,850,-30,-50,-30);
            if(skeletal){if(!mesh.bones?.some(row=>row.length))throw new Error('This movement needs a weighted donor rig.');const clip=this.factory.getSkeletalSeqLoader()?.load(sequence.skeletalId);if(!clip)throw new Error('The donor skeleton is missing.');model.animateSkeletal(clip,index+sequence.skeletalStart);}
            else{const frame=this.factory.getSeqFrameLoader().load(sequence.frameIds[index]);if(!frame)throw new Error('A donor animation frame is missing.');model.animate(frame,undefined,false);}
            const vertices=new Array(order.length);order.forEach((original,i)=>vertices[original]=[model.verticesX[i],model.verticesY[i],model.verticesZ[i]]);
            frames.push({duration:20*Math.max(1,skeletal?1:sequence.frameLengths?.[index]??1),vertices,alpha:Array.from(model.faceAlphas??mesh.alpha??[],(v:any)=>v&255)});
        }
        return {mesh,frames,duration:frames.reduce((n,f)=>n+f.duration,0)};
    }
    verify(mesh: any) {
        const bytes = encodeModel(mesh), data = ModelData.decode(new Int8Array(bytes));
        if (data.verticesCount !== mesh.vertices.length || data.faceCount !== mesh.faces.length) throw new Error('Model round-trip validation failed.');
        for(let i=0;i<mesh.faces.length;i++)if((data.faceTextures?.[i]??-1)!==(mesh.textures?.[i]??-1))throw new Error('Texture assignment did not survive export.');
        return { bytes: bytes.length, vertices: data.verticesCount, faces: data.faceCount, weighted: !!data.animMayaGroups };
    }
}
