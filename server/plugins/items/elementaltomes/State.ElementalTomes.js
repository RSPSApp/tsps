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

/**
 * "item:fill-charges" { player, item, handled }: content that hands out a tome ready to use
 * (the PvP Arena's load-outs) asks for a full one, charged with its own pages.
 */
function fillCharges(event) {
  const definition = event.item && common().getDefinition(event.item.getId());
  if (!definition) return;
  set(event.item, definition, common().MAX_CHARGES, definition.pageId);
  event.handled = true;
}

function attach(api) {
  api.onCustomEvent('item:fill-charges', fillCharges);
}

module.exports = { read, set, wholePages, fillCharges, attach };
