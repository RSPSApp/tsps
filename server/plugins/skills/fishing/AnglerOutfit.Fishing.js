/**
 * Angler's outfit (OSRS Wiki): hat 0.4%, top 0.8%, waders 0.6%, boots 0.2%, plus 0.5% for all
 * four, so 2.5% more Fishing XP. Spirit angler pieces count the same. Kylie Minnow also asks to
 * see the full set before she lets a player onto her platform.
 */
let ids = null;
let Equipment = null;
let pieces = [];
const SET_BONUS = 0.005;

function wornPieces(player) {
  const equipment = player.getEquipment().getItems();
  return pieces.filter((piece) => piece.ids.includes(equipment[Equipment[piece.slot]]?.getId()));
}

function wearsFullOutfit(player) {
  return wornPieces(player).length === pieces.length;
}

function xpMultiplier(player) {
  const worn = wornPieces(player);
  const bonus = worn.reduce((sum, piece) => sum + piece.bonus, 0);
  return 1 + bonus + (worn.length === pieces.length ? SET_BONUS : 0);
}

function attach(api) {
  ids = api.core.ItemIdentifiers;
  Equipment = api.core.Equipment;
  pieces = [
    { slot: "HEAD_SLOT", ids: [ids.ANGLER_HAT, ids.SPIRIT_ANGLER_HEADBAND], bonus: 0.004 },
    { slot: "BODY_SLOT", ids: [ids.ANGLER_TOP, ids.SPIRIT_ANGLER_TOP], bonus: 0.008 },
    { slot: "LEG_SLOT", ids: [ids.ANGLER_WADERS, ids.SPIRIT_ANGLER_WADERS], bonus: 0.006 },
    { slot: "FEET_SLOT", ids: [ids.ANGLER_BOOTS, ids.SPIRIT_ANGLER_BOOTS], bonus: 0.002 },
  ];
}

module.exports = { attach, wearsFullOutfit, xpMultiplier };
