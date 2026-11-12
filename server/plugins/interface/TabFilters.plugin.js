/**
 * The prayer and spellbook filter menus (the funnel button on each tab), docs/tab-filters.md.
 *
 * Each menu row is a checkbox the cache scripts draw from one varbit (prayer rows: script 3156,
 * spellbook rows: script 2603); clicking a row only flips that varbit, as captured, and the
 * client's scripts redraw the tab. The rows' op1 events are part of the login's tab setup
 * (ClientProtocol gameframeFlagEntries). Choices are saved per player as a bitmask by row.
 *
 * A new account starts with spells it lacks the level for hidden ("The list is currently
 * filtered to only show the spells you have the Magic level for"), and leaving Tutorial
 * Island shows them again, as captured.
 */

/** prayerbook:filtermenu */
const PRAYER_FILTER_MENU = (541 << 16) | 42;
/** magic_spellbook:filtermenu */
const MAGIC_FILTER_MENU = (218 << 16) | 206;

/** Varbits by menu row, in the order the cache's menu scripts list the rows. */
const PRAYER_FILTER_VARBITS = [
  6574, // prayer_filter_blocklowtier: "Show lower tiers of tiered prayers"
  6575, // prayer_filter_allowcombinedtier: "Show tiered prayers even if multi-skill prayers are available"
  6576, // prayer_filter_blockhealing: "Show Rapid Healing prayers"
  6577, // prayer_filter_blocklacklevel: "Show prayers you lack the Prayer level to activate"
  6578, // prayer_filter_blocklocked: "Show prayers you lack the requirements to activate"
];
const MAGIC_FILTER_VARBITS = [
  6605, // magic_filter_blockcombat: "Show Combat spells"
  6609, // magic_filter_blockteleport: "Show Teleport spells"
  6606, // magic_filter_blockutility: "Show Utility spells"
  6607, // magic_filter_blocklacklevel: "Show spells you lack the Magic level to cast"
  6608, // magic_filter_blocklackrunes: "Show spells you lack the runes to cast"
  12137, // magic_filter_blocklocked: "Show spells you lack the requirements to cast"
  6548, // magic_spellbook_blockresizing: "Enable icon resizing"
];
const MAGIC_LACK_LEVEL_ROW = 3;

const PRAYER_FILTERS_ATTRIBUTE = "tab-filters:prayer";
const MAGIC_FILTERS_ATTRIBUTE = "tab-filters:magic";

const MENUS = new Map([
  [PRAYER_FILTER_MENU, { attribute: PRAYER_FILTERS_ATTRIBUTE, varbits: PRAYER_FILTER_VARBITS }],
  [MAGIC_FILTER_MENU, { attribute: MAGIC_FILTERS_ATTRIBUTE, varbits: MAGIC_FILTER_VARBITS }],
]);

const filters = (player, menu) => Number(player.getAttribute(menu.attribute)) | 0;

function setRow(player, menu, row, on) {
  const bit = 1 << row;
  const value = on ? filters(player, menu) | bit : filters(player, menu) & ~bit;
  player.setAttribute(menu.attribute, value);
  player.getPacketSender().sendVarbit(menu.varbits[row], on ? 1 : 0);
}

function toggleFilter({ player, buttonId, slot }) {
  const menu = MENUS.get(buttonId);
  if (!menu || !Number.isInteger(slot) || slot < 0 || slot >= menu.varbits.length) return false;
  setRow(player, menu, slot, (filters(player, menu) & (1 << slot)) === 0);
  return true;
}

function restoreFilters({ player }) {
  for (const menu of MENUS.values()) {
    const value = filters(player, menu);
    menu.varbits.forEach((varbit, row) => {
      if (value & (1 << row)) player.getPacketSender().sendVarbit(varbit, 1);
    });
  }
}

function hideSpellsLackingLevel({ player }) {
  setRow(player, MENUS.get(MAGIC_FILTER_MENU), MAGIC_LACK_LEVEL_ROW, true);
}

function showSpellsLackingLevel({ player }) {
  setRow(player, MENUS.get(MAGIC_FILTER_MENU), MAGIC_LACK_LEVEL_ROW, false);
}

module.exports = {
  name: "TabFilters",
  description: "Prayer and spellbook filter menus that hide prayers or spells, saved per player, with unusable spells hidden for new accounts.",
  register(api) {
    api.persistAttribute(PRAYER_FILTERS_ATTRIBUTE, 0);
    api.persistAttribute(MAGIC_FILTERS_ATTRIBUTE, 0);
    api.onPlayerLogin(restoreFilters);
    api.onInterfaceActionButton([...MENUS.keys()], toggleFilter);
    api.onCustomEvent("tutorial:started", hideSpellsLackingLevel);
    api.onCustomEvent("tutorial:completed", showSpellsLackingLevel);
  },
  _test: { toggleFilter, restoreFilters, hideSpellsLackingLevel, showSpellsLackingLevel },
};
