// Per-item state only: page transfers and mixing rules belong to the item handlers.
function common() {
  return require('./Common.ElementalTomes');
}

function validCharges(charges) {
  return Number.isInteger(charges) && charges >= 0 && charges <= common().MAX_CHARGES;
}

function validPage(definition, pageId) {
  return pageId === definition.pageId ||
    (definition.specialPageId !== undefined && pageId === definition.specialPageId);
}

function read(item) {
  const Common = common();
  const definition = item && Common.getDefinition(item.getId());
  if (!definition) return { charges:0, pageId:null };
  const empty = { charges:0, pageId:definition.pageId };
  const state = item.getMetaValue(Common.META_KEY);
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !validCharges(state.charges) || !validPage(definition, state.pageId)) return empty;
  // Empty, noted, placeholder or mismatched variants cannot acquire a charge bonus
  // by carrying stale metadata from another item form.
  if (item.getId() !== definition.chargedId) return empty;
  return { charges:state.charges, pageId:state.pageId };
}

function set(item, definition, charges, pageId) {
  const Common = common();
  if (!definition || Common.getDefinition(item.getId()) !== definition) {
    throw new TypeError('Item must be a recognized variant of this tome');
  }
  if (!validCharges(charges)) throw new RangeError('Tome charges must be an integer from 0 to 20000');
  if (charges > 0 && !validPage(definition, pageId)) throw new TypeError('Invalid page type for tome');
  // Complete validation before either the item variant or its metadata changes.
  // Burnt and searing pages share the ordinary charged Fire tome item ID.
  item.setId(charges === 0 ? definition.emptyId : definition.chargedId);
  item.setMetaValue(Common.META_KEY, charges === 0 ? undefined : { charges, pageId });
}

function wholePages(state) {
  return Math.floor(state.charges / common().CHARGES_PER_PAGE);
}

module.exports = { read, set, wholePages };
