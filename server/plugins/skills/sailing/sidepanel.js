// The sailing sidepanel's description of a boat (its facility hotspots, part tiers, stats and
// resistances) and the panel itself, shared by boarding and the shipyard. Values follow live
// OSRS captures (docs/sailing-osrs-reference.md).
const {
  VARBIT,
  VARP_SIDEPANEL_BOAT_TYPE,
  VARP_SIDEPANEL_DEFENCE,
  SIDEPANEL_GROUP,
  SIDEPANEL_FACILITIES_CHILD,
  COMBAT_TAB_UID,
  SCRIPT_SIDEPANEL_INIT,
  SCRIPT_SIDEBUTTON_SWITCH,
} = require("./sailingContent");
const { boatStats, partTiers } = require("./boatParts");
const { facilitiesOf } = require("./boatFacilities");

/** Hotspots 0-10 from 19156 (SIDEPANEL_FACILITY_HOTSPOT0); a sloop's 11 and 12 at 20185-20186. */
const HOTSPOT_VARBITS = [
  ...Array.from({ length: 11 }, (_, hotspot) => VARBIT.SIDEPANEL_FACILITY_HOTSPOT0 + hotspot),
  20185,
  20186,
];
/** The sidepanel's part tier varbits, by boatParts.partTiers field (helm is its steering). */
const PART_VARBITS = {
  sail: VARBIT.SIDEPANEL_FACILITY_SAIL,
  steering: VARBIT.SIDEPANEL_FACILITY_HELM,
  keel: VARBIT.SIDEPANEL_FACILITY_KEEL,
  hull: VARBIT.SIDEPANEL_FACILITY_HULL,
  trim: VARBIT.SIDEPANEL_FACILITY_TRIM,
};
/** The sidepanel's resistance varbits, by stat. */
const RESISTANCE_VARBITS = {
  stormResistance: VARBIT.SIDEPANEL_BOAT_STORMRESISTANCE,
  rapidResistance: VARBIT.SIDEPANEL_BOAT_RAPIDRESISTANCE,
  fetidWaterResistance: VARBIT.SIDEPANEL_BOAT_FETIDWATER_RESISTANT,
  crystalFleckedResistance: VARBIT.SIDEPANEL_BOAT_CRYSTALFLECKED_RESISTANT,
};
const STAT_VARBITS = {
  hitpoints: [VARBIT.SIDEPANEL_BOAT_HP_MAX, VARBIT.SIDEPANEL_BOAT_HP],
  baseSpeed: [VARBIT.SIDEPANEL_BOAT_BASESPEED],
  speedCap: [VARBIT.SIDEPANEL_BOAT_SPEEDCAP],
  speedBoostDuration: [VARBIT.SIDEPANEL_BOAT_SPEEDBOOST_DURATION],
  acceleration: [VARBIT.SIDEPANEL_BOAT_ACCELERATION],
};
/** Every varbit describeBoat sets, to clear when the panel goes. */
const DESCRIPTION_VARBITS = [
  ...HOTSPOT_VARBITS,
  ...Object.values(PART_VARBITS),
  ...Object.values(RESISTANCE_VARBITS),
  ...Object.values(STAT_VARBITS).flat(),
];

/**
 * The sidepanel's "View Combat Options" is built at runtime inside 937:1 (script 8715, from
 * the panel's onLoad 8710 via 8712), from several pieces; OSRS enables op 1 on its slots 0-12.
 */
const VIEW_COMBAT_OPTIONS_CHILD = 1;
const VIEW_COMBAT_OPTIONS_MAX_SLOT = 12;
const IF_EVENT_OP1 = 1 << 1;
const IF_EVENT_OP1_TO_OP4 = IF_EVENT_OP1 | (1 << 2) | (1 << 3) | (1 << 4);

/**
 * A boat's stats: from its parts in the cache, with any the cache doesn't hold (the captured
 * per-style defence) from its type in boats.json.
 */
function statsOf(type, owned) {
  return { ...type.stats, ...boatStats(owned) };
}

/** The varbits describing a boat: facility hotspots, part tiers, stats and resistances. */
function describeBoat(type, owned) {
  const values = {};
  const facilities = facilitiesOf(owned);
  HOTSPOT_VARBITS.forEach((varbit, hotspot) => { values[varbit] = facilities[hotspot] ?? 0; });
  const tiers = partTiers(owned);
  const stats = statsOf(type, owned);
  for (const [part, varbit] of Object.entries(PART_VARBITS)) values[varbit] = tiers[part] ?? 0;
  for (const [stat, varbit] of Object.entries(RESISTANCE_VARBITS)) values[varbit] = stats[stat] ?? 0;
  for (const [stat, varbits] of Object.entries(STAT_VARBITS)) {
    for (const varbit of varbits) values[varbit] = stats[stat] ?? 0;
  }
  return values;
}

/** The varps describing a boat: its type and defence stats. */
function boatVarps(type, owned) {
  const varps = { [VARP_SIDEPANEL_BOAT_TYPE]: type.sidepanelBoatType };
  const stats = statsOf(type, owned);
  for (const [stat, varp] of Object.entries(VARP_SIDEPANEL_DEFENCE)) varps[varp] = stats[stat] ?? 0;
  return varps;
}

function clearBoatVarps(player) {
  const sender = player.getPacketSender();
  sender.sendConfig(VARP_SIDEPANEL_BOAT_TYPE, -1);
  for (const varp of Object.values(VARP_SIDEPANEL_DEFENCE)) sender.sendConfig(varp, 0);
}

/** Mounts the sidepanel on the combat tab, with the varbits bundled so its onLoad sees them. */
function openSidepanel(player, type, varbits, varps) {
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_SIDEPANEL_INIT, [player.getUsername(), 1, "", 1]);
  sender.sendInterfaceScript(SCRIPT_SIDEBUTTON_SWITCH, [0]);
  sender.sendSubInterface(COMBAT_TAB_UID, SIDEPANEL_GROUP, 1, { varbits, varps });
  sender.sendInterfaceFlagsRange(
    (SIDEPANEL_GROUP << 16) | VIEW_COMBAT_OPTIONS_CHILD, 0, VIEW_COMBAT_OPTIONS_MAX_SLOT, IF_EVENT_OP1);
  sender.sendInterfaceFlagsRange(
    (SIDEPANEL_GROUP << 16) | SIDEPANEL_FACILITIES_CHILD, 0, type.sidepanelFacilitySlots, IF_EVENT_OP1_TO_OP4);
}

module.exports = { describeBoat, boatVarps, clearBoatVarps, openSidepanel, DESCRIPTION_VARBITS, HOTSPOT_VARBITS };
