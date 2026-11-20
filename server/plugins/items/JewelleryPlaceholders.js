/** Jagex Content Poll 56: full/depleted stay separate; partial charges share the cache's representative. */
module.exports = function attachJewelleryPlaceholders(api, families) {
  api.onCustomEvent("bank:placeholder-identity", event => {
    const family = families.find(ids => ids.includes(event.itemId));
    if (!family) return;
    // Some legacy family tables also list placeholder objects: they are never usable charge states.
    const partial = family.filter(id => api.core.CacheDefinitions.getItem(id).placeholderTemplate === -1).slice(1);
    if (!partial.includes(event.itemId)) return;
    const representative = partial.find(id => api.core.ItemDefinition.forId(id).getPlaceholderId() >= 0);
    if (representative === undefined) return;
    event.placeholderId = representative;
    event.itemIds = partial;
  });
};
