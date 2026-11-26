'use strict';
// Embedded once in a gear-set package. All members are checked before any
// registry is changed, and their item IDs are already resolved by the exporter.
const CONTENT = /* BUILDER_CONTENT */ null;
const effectRuntime = /* BUILDER_EFFECT_RUNTIME */ null;
let effects = [];

function startup(api) {
    const core=api.core,cache=core.CacheDefinitions,counts=cache.getBaseCounts();
    const previousItems=cache.getCustomItems(),previousModels=cache.getCustomModels(),items=CONTENT.items;
    if(items.some(c=>c.item?.visuals)&&cache.ITEM_VISUALS_VERSION!==1)throw new Error('This gear set requires a TSPS host with item visual layers support.');
    const definitions=new Set(),models=new Set(),prepared=[];
    for(const c of items){
        if(c.id<Math.max(50000,counts.items)||c.id>65022||c.baseId>=counts.items||definitions.has(c.id)||cache.getCustomDefinitionOwner('item',c.id)!==undefined||previousItems.some(row=>row.id===c.id))throw new Error('A gear-set item ID is unavailable. Reassign the set IDs and export again.');
        definitions.add(c.id);
        if(c.cache!==cache.getCacheInfo?.()?.name)api.log?.('cache compatibility',{name:c.name,builtWith:c.cache,note:'Template IDs and animation rigs must match after a cache revision change.'});
        effectRuntime?.checkEffectCapabilities(api,c.effects);
        const base=core.ItemDefinition.forId(c.baseId),type=base.getEquipmentType().constructor[c.settings.equipmentType],weapon=c.settings.weaponInterface?core.WeaponInterfaces[c.settings.weaponInterface]:undefined;
        if(!type||c.settings.weaponInterface&&!weapon)throw new Error('A gear-set equipment slot or weapon style is unavailable.');
        if(c.settings.specialFrom>=0&&!core.CombatSpecial.getForWeaponId(c.settings.specialFrom))throw new Error('A gear-set special attack donor is unavailable.');
        for(const model of c.models){
            if(models.has(model.id)||previousModels.some(old=>old.id===model.id))throw new Error('A gear-set model ID collides with another package. Reassign the set IDs.');
            models.add(model.id);core.encodeContentData('server',[{key:'customModels',rows:[model]}]);
        }
        prepared.push({c,type,weapon});
    }
    const rows=[...previousItems,...items.map(c=>c.item)];
    if (!cache.getCustomItemPackets) core.encodeContentData('server', [{ key: 'customItems', rows }]);
    cache.registerCustomItems(rows);
    for(const {c,type,weapon}of prepared){
        const definition=core.ItemDefinition.registerCustom(c.id,c.baseId,{
            ...c.settings,equipmentType:type,...(weapon&&{weaponInterface:weapon}),
            standAnim:c.animations.idle,walkAnim:c.animations.walk,runAnim:c.animations.run,attackAnim:c.animations.attack,blockAnim:c.animations.block
        });
        definition.attackSpeed=c.settings.attackSpeed;
        if(c.settings.specialFrom>=0)core.CombatSpecial.setItemSpecial(c.id,{from:c.settings.specialFrom,drainAmount:c.settings.specialEnergy});
        if(c.effects)effects.push(effectRuntime.registerEffects(api,c.effects));
    }
    cache.setCustomModels([...previousModels,...items.flatMap(c=>c.models)]);
    api.log?.('gear set loaded',{name:CONTENT.name,items:items.map(c=>({name:c.name,id:c.id}))});
}

function shutdown() { for(const effect of effects)effect.dispose();effects=[]; }

module.exports = {
    name: 'BUILDER_PLUGIN_NAME',
    category: '@ Ghost Plugins @',
    description: 'A complete custom gear set exported by TSPS Creator.',
    members: false,
    dependsOn: ['ItemDefinitionLoader','CacheEditorCatalog',...(CONTENT?.items?.some(item=>item.effects?.config.special?.nativeFrom!==undefined)?['SpecialAttacks']:[])],
    register(api) {
        api.onServerStartup(startup.bind(null,api));
        api.onServerShutdown?.(shutdown);
    },
};
