/**
 * The standard spellbook's grouped spells (docs/spellbook-sublist.md). "View" on the Jewellery
 * Enchantments button opens the Lvl-1 to Lvl-7 Enchant spells in the tab, and "Back" returns to the
 * whole book. Both only set `spellbook_sublist`, as captured; the tab's script (2611) redraws the list
 * from it (enum 5280 by spellbook, then that book's sublist enum).
 */

/** magic_spellbook:enchant_jewellery, op1 "View". */
const ENCHANT_JEWELLERY_VIEW = (218 << 16) | 15;
/** magic_spellbook:back_button, op1 "Back". */
const BACK_BUTTON = (218 << 16) | 4;
/** spellbook_sublist: 0 is the whole book, 1 the standard book's Jewellery Enchantments (enum 5281). */
const SPELLBOOK_SUBLIST = 9730;
const JEWELLERY_ENCHANTMENTS = 1;

const SUBLISTS = new Map([
  [ENCHANT_JEWELLERY_VIEW, JEWELLERY_ENCHANTMENTS],
  [BACK_BUTTON, 0],
]);

function showSublist({ player, buttonId }) {
  const sublist = SUBLISTS.get(buttonId);
  if (sublist === undefined) return false;
  const sender = player.getPacketSender();
  // rsprox: the varbit is only sent when it changes.
  if (sender.getVarbit(SPELLBOOK_SUBLIST) !== sublist) sender.sendVarbit(SPELLBOOK_SUBLIST, sublist);
  return true;
}

module.exports = {
  name: "SpellbookSublist",
  description: "The spellbook's Jewellery Enchantments View and Back buttons, which show the Enchant spells in the Magic tab.",
  register(api) {
    api.onInterfaceActionButton([...SUBLISTS.keys()], showSublist);
  },
  _test: { showSublist, SPELLBOOK_SUBLIST },
};
