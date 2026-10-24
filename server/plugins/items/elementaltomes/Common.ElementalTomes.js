const State = require('./State.ElementalTomes');
const META_KEY = 'elemental-tomes';
const MAX_CHARGES = 20000;
const CHARGES_PER_PAGE = 20;
let core;
let definitions = new Map();

function initialize(api) {
  core = api.core;
  const I = core.ItemIdentifiers;
  const tomes = [
    { element:'fire', name:'Tome of Fire', rune:I.FIRE_RUNE, chargedId:I.TOME_OF_FIRE,
      emptyId:I.TOME_OF_FIRE_EMPTY_, pageId:I.BURNT_PAGE,
      specialPageId:I.SEARING_PAGE },
    { element:'water', name:'Tome of Water', rune:I.WATER_RUNE, chargedId:I.TOME_OF_WATER,
      emptyId:I.TOME_OF_WATER_EMPTY_, pageId:I.SOAKED_PAGE },
    { element:'earth', name:'Tome of Earth', rune:I.EARTH_RUNE, chargedId:I.TOME_OF_EARTH,
      emptyId:I.TOME_OF_EARTH_EMPTY_, pageId:I.SOILED_PAGE },
  ];
  definitions = new Map();
  for (const tome of tomes) {
    Object.freeze(tome);
    for (const id of [tome.chargedId, tome.emptyId]) {
      if (id !== undefined) definitions.set(id, tome);
    }
  }
}

function getDefinition(itemId) {
  return definitions.get(itemId) ?? null;
}

function getEquipped(player) {
  const item = player.getEquipment().getItems()[core.Equipment.SHIELD_SLOT];
  if (!item || item.getAmount() < 1) return null;
  const definition = getDefinition(item.getId());
  return definition ? { item, definition, state:State.read(item) } : null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

module.exports = {
  initialize, getDefinition, getEquipped, refresh,
  read:State.read, set:State.set, wholePages:State.wholePages,
  META_KEY, MAX_CHARGES, CHARGES_PER_PAGE,
  get core() { return core; },
};
