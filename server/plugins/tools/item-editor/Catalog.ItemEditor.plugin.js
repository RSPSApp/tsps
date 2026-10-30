// Read-only effective item metadata; no character or cache writes.
let core;
let catalog;
function startup(apiCore) { core = apiCore; catalog = undefined; }
function itemRow(id, source) {
    const obj = core.CacheDefinitions.getItem(id);
    if (!obj?.name || obj.name === 'null')
        return undefined;
    const definition = core.ItemDefinition.forId(id);
    const noted = definition.isNoted() || obj.noteTemplate >= 0;
    const placeholder = obj.placeholderTemplate >= 0;
    const equipmentSlot = definition.getEquipmentType().getSlot();
    return { id, name: obj.name, source, noted, equipmentSlot,
        equipable: !noted && !placeholder && equipmentSlot >= 0,
        reason: noted ? 'Noted items cannot be equipped' : placeholder ? 'Placeholders cannot be equipped'
            : equipmentSlot < 0 ? 'This item cannot be equipped' : '' };
}
function readCatalog() {
    if (!core)
        return { status: 'unavailable', items: [] };
    if (!catalog) {
        const items = [];
        for (let id = 0; id < core.CacheDefinitions.getCounts().items; id++) {
            const row = itemRow(id, 'cache');
            if (row)
                items.push(row);
        }
        for (const item of core.CacheDefinitions.getCustomItems()) {
            const row = itemRow(item.id, 'custom');
            if (row)
                items.push(row);
        }
        catalog = { status: 'ok', items };
    }
    return catalog;
}
module.exports = {
    name: 'ItemEditorCatalog',
    dependsOn: ['ItemDefinitionLoader'],
    register(api) {
        api.onServerStartup(startup.bind(null, api.core));
        api.registerContentEndpoint('item-editor', readCatalog);
    },
};
module.exports.itemRow = itemRow;
