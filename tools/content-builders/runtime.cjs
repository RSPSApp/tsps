'use strict';
// This file is embedded in every exported package. It uses only TSPS's plugin API.
const CONTENT = /* BUILDER_CONTENT */ null;
const effectRuntime = /* BUILDER_EFFECT_RUNTIME */ null;
let effectHandle = null;
let active = false;
let prepared = false;

// Deferred registration runs before saved NPC spawns are read. Models and gameplay settings
// load in startup, after TSPS has loaded its normal definitions and editor model assets.
function prepare(api) {
    if (CONTENT.kind !== 'npc') return;
    const cache = api.core.CacheDefinitions, c = CONTENT, count = cache.getBaseCounts().npcs;
    if (c.baseId >= count || c.id < Math.max(50000, count) || c.id > 65022 || cache.getCustomDefinitionOwner('npc', c.id) !== undefined) throw new Error('Builder NPC identity is unavailable. Reassign IDs or re-export.');
    cache.registerCustomDefinitions([c.definition], c.source);
    prepared = true;
}

function startup(api) {
    const core = api.core, cache = core.CacheDefinitions, c = CONTENT;
    if(c.item?.visuals&&cache.ITEM_VISUALS_VERSION!==1)throw new Error('This gear requires a TSPS host with item visual layers support.');
    effectRuntime?.checkEffectCapabilities(api, c.effects);
    const counts = cache.getBaseCounts();
    const count = c.kind === 'npc' ? counts.npcs : counts.items;
    if (c.cache !== core.CacheDefinitions.getCacheInfo?.()?.name) {
        api.log?.('cache compatibility', { builtWith: c.cache, note: 'Template IDs and animation rigs must still match after a cache revision change.' });
    }
    if (c.baseId >= count || c.id < Math.max(50000, count) || c.id > 65022) throw new Error('Builder package IDs are incompatible with this cache. Re-export the project.');
    const owner = cache.getCustomDefinitionOwner(c.kind === 'npc' ? 'npc' : 'item', c.id);
    if (owner !== undefined && !(prepared && owner === c.source) || cache.getCustomItems().some(row => row.id === c.id && c.kind === 'gear')) throw new Error(`Builder ID ${c.id} already belongs to another package. Reassign IDs in the builder.`);
    const previousModels = cache.getCustomModels();
    if (c.models.some(row => previousModels.some(old => old.id === row.id))) throw new Error('Builder model ID collision. Reassign IDs in the builder.');
    for (const model of c.models) core.encodeContentData('server', [{ key: 'customModels', rows: [model] }]);
    if(c.animationRows?.length){
        if(typeof cache.registerSampledAnimations!=='function')throw new Error('This content requires TSPS sampled-animation support. Install the v2 compatibility patch.');
        for(const row of c.animationRows)core.encodeContentData('server',[{key:'customSampledAnimations',rows:[row]}]);
        cache.registerSampledAnimations(c.animationRows,c.source);
    }
    if (c.kind === 'npc') {
        core.encodeContentData('server', [{ key: 'customDefinitions', rows: [c.definition] }]);
        if (core.CombatType[c.settings.attackType] === undefined) throw new Error('Builder combat style is unavailable.');
        if (!prepared) cache.registerCustomDefinitions([c.definition], c.source);
        core.NpcDefinition.invalidateCache(c.id);
        const definition = core.NpcDefinition.forId(c.id);
        const settings = { ...c.settings, stats: [...c.settings.stats], examine: c.examine, members: c.members, attackType: core.CombatType[c.settings.attackType], attackAnim: c.animations.attack, defenceAnim: c.animations.block, deathAnim: c.animations.death };
        Object.assign(definition, settings);
        if(c.attacks?.length) {
            if(typeof api.registerNpcCombatMethodProvider!=='function')throw new Error('This content needs the generic NPC combat-method provider capability.');
            api.registerNpcCombatMethodProvider(c.id, attackMethod(core), { singleton:false });
        }
    } else {
        const base = core.ItemDefinition.forId(c.baseId);
        const type = base.getEquipmentType().constructor[c.settings.equipmentType];
        const weapon = c.settings.weaponInterface ? core.WeaponInterfaces[c.settings.weaponInterface] : undefined;
        if (!type || c.settings.weaponInterface && !weapon) throw new Error('Builder equipment slot or weapon style is unavailable.');
        if (c.settings.specialFrom >= 0 && !core.CombatSpecial.getForWeaponId(c.settings.specialFrom)) throw new Error('The chosen special attack donor has no registered special.');
        const rows = [...cache.getCustomItems(), c.item];
        cache.validateItemVisualBudget?.(rows);
        core.encodeContentData('server', [{ key: 'customItems', rows }]);
        // registerCustomItems validates before replacing its maps; retain every other package's rows.
        // It clears the model list, which is restored with the complete merged list below.
        cache.registerCustomItems(rows);
        const def = core.ItemDefinition.registerCustom(c.id, c.baseId, {
            ...c.settings, equipmentType: type, ...(weapon && { weaponInterface: weapon }),
            standAnim: c.animations.idle, walkAnim: c.animations.walk, runAnim: c.animations.run,
            attackAnim: c.animations.attack, blockAnim: c.animations.block,
        });
        def.attackSpeed = c.settings.attackSpeed;
        if (c.settings.specialFrom >= 0) core.CombatSpecial.setItemSpecial(c.id, { from: c.settings.specialFrom, drainAmount: c.settings.specialEnergy });
    }
    if (c.effects) effectHandle = effectRuntime.registerEffects(api, c.effects);
    cache.setCustomModels([...previousModels, ...c.models]);
    active = true;
    api.log?.('builder content loaded', { name: c.name, id: c.id, models: c.models.length });
}

// Providers are constructed for every attack. NPC-owned cursors survive those
// instances without sharing state between creatures. Each hit has an immutable
// style, so a delayed ranged hit cannot turn magic when the next attack starts.
function attackMethod(core) {
    const {CombatMethod,CombatType,Animation,PendingHit,Projectile,Graphic}=core,c=CONTENT;
    const states=new WeakMap();
    class StyleHit extends CombatMethod {
        constructor(style){super();this.style=style;}
        type(){return this.style;}
        hits(){return [];}
    }
    return class BuilderAttacks extends CombatMethod {
        constructor(npc){super();this.state=states.get(npc)??{cursor:0};if(npc)states.set(npc,this.state);this.chosen=null;}
        start(npc,target){
            const distance=npc.calculateDistance(target),eligible=c.attacks.filter(a=>distance<=a.range);
            const choices=eligible.length?eligible:c.attacks;
            if(c.attackMode==='random'){
                let roll=Math.random()*choices.reduce((sum,a)=>sum+a.weight,0);this.chosen=choices.at(-1);
                for(const a of choices){roll-=a.weight;if(roll<0){this.chosen=a;break;}}
            }else{this.chosen=choices[this.state.cursor++%choices.length];}
            npc.performAnimation(new Animation(this.chosen.animation));
            npc.getCombat().setAttackDelay(this.chosen.speed);
            if(this.chosen.launchGraphicId>=0)npc.performGraphic(new Graphic(this.chosen.launchGraphicId));
        }
        hits(npc,target){
            const a=this.chosen;if(!a)return [];
            if(a.style==='MELEE'&&npc.calculateDistance(target)>1)return [];
            if(a.projectileId>=0)Projectile.createProjectile(npc,target,a.projectileId,40,Math.max(1,a.delay)*30,43,31).sendProjectile();
            const hit=new PendingHit(npc,target,new StyleHit(CombatType[a.style]),a.delay);
            if(hit.getTotalDamage()>a.maxHit)hit.setTotalDamage(a.maxHit);
            return [hit];
        }
        type(){return CombatType[this.chosen?.style??c.attacks.find(a=>a.style!=='MELEE')?.style??c.attacks[0].style];}
        attackDistance(){return Math.max(...c.attacks.map(a=>a.range));}
        canAttack(npc,target){return c.attacks.some(a=>npc.calculateDistance(target)<=a.range);}
        attackSpeed(){return this.chosen?.speed??c.settings.attackSpeed;}
    };
}

function shutdown() { active = false; effectHandle?.dispose(); effectHandle = null; }

function claimDrops(api, event) {
    const c = CONTENT;
    if (!active || c.kind !== 'npc' || event.handled || event.npcId !== c.id || !event.killer) return;
    event.handled = true;
    const drops = [], table = c.drops;
    if (table.mode === 'borrow') api.emitCustomEvent('npc-drops:roll-table', { player: event.killer, npcId: table.sourceId, drops });
    if (table.mode === 'custom') {
        const amount = row => row.min + Math.floor(Math.random() * (row.max - row.min + 1));
        for (const row of table.rows) if (row.weight === 0) drops.push({ itemId: row.itemId, amount: amount(row) });
        let roll = Math.random() * (table.emptyWeight + table.rows.reduce((sum, row) => sum + row.weight, 0));
        for (const row of table.rows) {
            if (row.weight === 0) continue;
            roll -= row.weight;
            if (roll < 0) { drops.push({ itemId: row.itemId, amount: amount(row) }); break; }
        }
    }
    if (drops.length) api.emitCustomEvent('npc-drops:place', { player: event.killer, drops, location: event.npc.getLocation(), npcId: c.id });
}

// Optional consumer: MonsterExamine's read-only drop inspection. This never rolls rewards.
function describeDrops(api, event) {
    const c = CONTENT;
    if (!active || c.kind !== 'npc' || event.npcId !== c.id) return;
    if (c.drops.mode === 'borrow') {
        const query = { player: event.player, npcId: c.drops.sourceId, source: null };
        api.emitCustomEvent('npc-drops:describe', query);
        event.source = query.source;
        return;
    }
    const rows = c.drops.mode === 'custom' ? c.drops.rows : [];
    event.source = { table: { entries: rows.map(row => ({ item_id: row.itemId, quantity: [row.min, row.max], weight: row.weight, always: row.weight === 0 })), main_max_roll: c.drops.emptyWeight + rows.reduce((sum, row) => sum + row.weight, 0) }, shared: {}, categories: {} };
}

module.exports = {
    name: 'BUILDER_PLUGIN_NAME',
    category: '@ Ghost Plugins @',
    description: 'Standalone content exported by TSPS content builders.',
    members: false,
    dependsOn: ['ItemDefinitionLoader', 'CacheEditorCatalog', 'NpcDrops', ...(CONTENT?.effects?.config.special?.nativeFrom!==undefined?['SpecialAttacks']:[])],
    registerDeferred: prepare,
    register(api) {
        api.onServerStartup(startup.bind(null, api));
        api.onServerShutdown?.(shutdown);
        api.onCustomEvent('npc-drops:claim', claimDrops.bind(null, api));
        api.onCustomEvent('npc-drops:describe', describeDrops.bind(null, api));
    },
};
