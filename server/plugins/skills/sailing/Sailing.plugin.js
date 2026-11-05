// The client side of being on a boat: the boarded varbits and the sailing sidepanel on the
// combat tab, applied whenever Sailing puts a player aboard and cleared whenever they leave
// (disembarking, sinking or logging out). Values follow xrsps's raft port, taken from rsmod's
// `applyBoardedState` (https://github.com/rsmod/rsmod, ISC).
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { WeaponInterfaceManager } = require("../../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager");
const {
  VARBIT,
  MOVE_MODE,
  HELM_STATUS,
  ROLE_CAPTAIN,
  SIDEPANEL_GROUP,
  content,
  boatType,
  suppliedBoatProfile,
  setVarbit,
  getVarbit,
  animateSails,
} = require("./SailingContent.Sailing");
const { repairKitUses } = require("./Cargo.Sailing");
const { specFor, boatStatsForRow } = require("./BoatParts.Sailing");
const { hotspotLocs } = require("./BoatFacilities.Sailing");
const { describeBoat, boatVarps, describeSuppliedBoat, suppliedBoatVarps,
  openSidepanel, clearBoatVarps, DESCRIPTION_VARBITS } = require("./Sidepanel.Sailing");
const StaticShips = require("./StaticShips.Sailing");
const { sendBoatVarbits } = require("./BoatVarbits.Sailing");

const suppliedPanels = new WeakMap();
let core;

function attachCore(api) {
  core = api.core;
}

/** Values from live OSRS boarding traces (docs/sailing-osrs-reference.md). */
function boardedVarbits(type, owned) {
  const slot = owned.slot + 1;
  return {
    ...describeBoat(type, owned),
    [VARBIT.BOARDED_BOAT]: 1,
    [VARBIT.BOARDED_BOAT_WORLD]: 1,
    [VARBIT.BOARDED_BOAT_TYPE]: type.typeId,
    [VARBIT.PLAYER_IS_ON_PLAYER_BOAT]: 1,
    [VARBIT.BOAT_SPAWNED]: slot,
    [VARBIT.LAST_PERSONAL_BOAT_BOARDED]: slot,
    [VARBIT.PREVIOUS_BOAT_DATA_SLOT]: slot,
    [VARBIT.PREVIOUS_BOAT_TYPE_ID]: type.typeId,
    [VARBIT.PRELOADED_ANIMS]: 1,
    [VARBIT.SIDEPANEL_PLAYER_ROLE]: ROLE_CAPTAIN,
    [VARBIT.SIDEPANEL_PLAYERS_ON_BOARD_TOTAL]: 1,
    [VARBIT.SIDEPANEL_HELM_STATUS]: HELM_STATUS.FREE,
    [VARBIT.SIDEPANEL_REPAIRKITS]: repairKitUses(owned),
    [VARBIT.SIDEPANEL_VISIBLE]: 1,
    [VARBIT.SIDEPANEL_VISIBLE_FROM_COMBAT_TAB]: 1,
    [VARBIT.SIDEPANEL_BOAT_MOVE_MODE]: MOVE_MODE.MOORED,
  };
}

const COMBAT_OPTIONS_GROUP = 593;
const VIEW_SAILING_OPTIONS_CHILD = 48;
/** The sidepanel's "View Combat Options" (see Sidepanel.Sailing.js). */
const VIEW_COMBAT_OPTIONS_CHILD = 1;

/** Everything reset when leaving a boat, whatever set it. */
const LEFT_VARBITS = [
  VARBIT.BOARDED_BOAT,
  VARBIT.BOARDED_BOAT_WORLD,
  VARBIT.BOARDED_BOAT_TYPE,
  VARBIT.PLAYER_IS_ON_PLAYER_BOAT,
  VARBIT.BOAT_SPAWNED,
  VARBIT.FACILITY_LOCKEDIN,
  VARBIT.SIDEPANEL_VISIBLE,
  VARBIT.SIDEPANEL_VISIBLE_FROM_COMBAT_TAB,
  VARBIT.SIDEPANEL_BOAT_MOVE_MODE,
  VARBIT.SIDEPANEL_SAIL_BUTTON_TOGGLED,
  VARBIT.SIDEPANEL_PLAYER_AT_HELM,
  ...DESCRIPTION_VARBITS,
];

function applyBoarded(player, owned) {
  const type = boatType(owned.type);
  if (!type) return;
  const varbits = boardedVarbits(type, owned);
  const varps = boatVarps(type, owned);
  for (const [id, value] of Object.entries(varbits)) setVarbit(player, Number(id), value);
  const sender = player.getPacketSender();
  for (const [id, value] of Object.entries(varps)) sender.sendConfig(Number(id), value);
  openSidepanel(player, type, varbits, varps);
}

/** A tick after boarding, once the deck scene (or, on login, the gameframe) is in place. */
function onBoarded({ player, boat, owned }) {
  if (core.BoatManager.getBoatAboard(player) === boat) suppliedPanels.delete(player);
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player); }
    execute() {
      if (player.getArea()?.boat !== boat) return this.stop();
      applyBoarded(player, owned);
      // Boarding shows the sails at rest, on the mast and the sail cloth (rsprox).
      animateSails(player, boat, "down", "down", { settle: false });
      this.stop();
    }
  })());
}

function suppliedPanelAboard(player, record) {
  const { boat, profile } = record;
  return player.isRegistered()
    && player.getHitpoints() > 0 && !player.isDying
    && getVarbit(player, VARBIT.SHIPYARD_MODE) === 0
    && boat.static && boat.ownerOnly && boat.ownerPlayerId === player.getIndex()
    && core.BoatManager.getBoat(boat.entityIndex) === boat && core.BoatManager.getBoatAboard(player) === boat
    && suppliedBoatProfile(boat) === profile;
}

function currentSuppliedPanel(player, record) {
  return suppliedPanels.get(player) === record && suppliedPanelAboard(player, record);
}

/** The delayed mount and Combat-tab reapply read the live control state, never initial defaults. */
function applySuppliedPanel(player, record) {
  if (!currentSuppliedPanel(player, record)) return false;
  const ship = StaticShips.get(record.boat.entityIndex);
  const values = describeSuppliedBoat(record.description, ship.hitpoints, ship.maxHitpoints);
  for (const id of record.controlVarbits) values[id] = getVarbit(player, id);
  for (const [id, value] of Object.entries(values)) setVarbit(player, Number(id), value);
  const varps = suppliedBoatVarps(record.description);
  for (const [id, value] of Object.entries(varps)) player.getPacketSender().sendConfig(Number(id), value);
  openSidepanel(player, record.profile, values, varps);
  return true;
}

/** This request deliberately does not broadcast an owned-boat boarding to cargo/crew listeners. */
function boardSuppliedPanel(event) {
  event.accepted = false;
  const { player, boat } = event;
  const profile = suppliedBoatProfile(boat);
  if (!player || !boat || !profile || !Number.isInteger(profile.sidepanelBoatType)
    || profile.sidepanelBoatType < 0 || !Number.isInteger(profile.typeId) || profile.typeId < 0
    || !Number.isInteger(profile.sidepanelFacilitySlots) || profile.sidepanelFacilitySlots < 0) return;
  if (!suppliedPanelAboard(player, { boat, profile })) return;
  const stats = boatStatsForRow(profile.sidepanelBoatType);
  if (!stats) return;
  const previous = suppliedPanels.get(player);
  if (previous?.boat === boat && currentSuppliedPanel(player, previous)) {
    event.accepted = true;
    return;
  }
  const atHelm = boat.helmPlayerId === player.getIndex();
  const values = {
    [VARBIT.BOARDED_BOAT]: 1,
    [VARBIT.BOARDED_BOAT_WORLD]: 1,
    [VARBIT.BOARDED_BOAT_TYPE]: profile.typeId,
    [VARBIT.PLAYER_IS_ON_PLAYER_BOAT]: 1,
    [VARBIT.SIDEPANEL_PLAYER_ROLE]: ROLE_CAPTAIN,
    [VARBIT.SIDEPANEL_PLAYERS_ON_BOARD_TOTAL]: 1,
    [VARBIT.SIDEPANEL_VISIBLE]: 1,
    [VARBIT.SIDEPANEL_VISIBLE_FROM_COMBAT_TAB]: 1,
    [VARBIT.FACILITY_LOCKEDIN]: atHelm ? getVarbit(player, VARBIT.FACILITY_LOCKEDIN) : 0,
    [VARBIT.SIDEPANEL_HELM_STATUS]: atHelm ? HELM_STATUS.NAVIGATING : HELM_STATUS.FREE,
    [VARBIT.SIDEPANEL_PLAYER_AT_HELM]: atHelm ? 1 : 0,
    [VARBIT.SIDEPANEL_BOAT_MOVE_MODE]: atHelm ? getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE)
      : event.stopped === true ? MOVE_MODE.STOPPED : MOVE_MODE.MOORED,
    [VARBIT.SIDEPANEL_SAIL_BUTTON_TOGGLED]: atHelm ? getVarbit(player, VARBIT.SIDEPANEL_SAIL_BUTTON_TOGGLED) : 0,
  };
  const record = { boat, profile, description: { ...profile, stats }, controlVarbits: Object.keys(values).map(Number) };
  suppliedPanels.set(player, record);
  if (!currentSuppliedPanel(player, record)) {
    suppliedPanels.delete(player);
    if (previous) suppliedPanels.set(player, previous);
    return;
  }
  for (const [id, value] of Object.entries(values)) setVarbit(player, Number(id), value);
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player); }
    execute() { this.stop(); applySuppliedPanel(player, record); }
  })());
  event.accepted = true;
}

function leaveSuppliedPanel({ player, boat, reason }) {
  const record = suppliedPanels.get(player);
  if (!record || record.boat !== boat) return;
  suppliedPanels.delete(player);
  // Identity is sufficient after physical leave; an older scene cannot clear a newer lease.
  if (reason !== "logout") for (const id of record.controlVarbits) setVarbit(player, id, 0);
  onLeft({ player, boat, reason });
}

function onLeft({ player, boat, reason }) {
  const supplied = suppliedPanels.get(player);
  if (supplied && supplied.boat !== boat) return;
  if (supplied) suppliedPanels.delete(player);
  // A player logging out has no client left to update.
  if (reason === "logout") return;
  // Disembarking docks the boat; a teleport or Escape sinks it.
  sendBoatVarbits(player);
  for (const id of LEFT_VARBITS) setVarbit(player, id, 0);
  clearBoatVarps(player);
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  player.getPacketSender().sendTabInterface(0, 0);
}

/**
 * The combat tab's "View" button (593:48) and the sidepanel's "Combat Options" (937:33) swap
 * the combat tab between the combat options and the sailing sidepanel while aboard; the
 * client only plays a click (script 489), the server remounts the tab.
 */
function switchCombatTab(event) {
  const { player } = event;
  if (event.groupId === COMBAT_OPTIONS_GROUP && event.childId === VIEW_SAILING_OPTIONS_CHILD) {
    event.handled = true;
    const supplied = suppliedPanels.get(player);
    if (supplied && applySuppliedPanel(player, supplied)) return;
    const owned = Sailing.instanceAboard(player) && Sailing.activeBoat(player);
    if (owned) applyBoarded(player, owned);
  } else if (event.groupId === SIDEPANEL_GROUP && event.childId === VIEW_COMBAT_OPTIONS_CHILD) {
    event.handled = true;
    WeaponInterfaceManager.assign(player);
  }
}

/** A boat as built: its parts, and on each hotspot its facility or the hotspot's placeholder. */
function builtSpec(boat, base) {
  const spec = specFor(boat, base);
  return { ...spec, locs: [...spec.locs, ...hotspotLocs(boat)] };
}

/** Describes owned boats; Schematics restores only recipes the player has learned. */
function describeBoatsOnLogin({ player }) {
  sendBoatVarbits(player);
}

module.exports = {
  name: "Sailing",
  members: true,
  register(api) {
    attachCore(api);
    content();
    api.onCustomEvent("sailing:boarded", onBoarded);
    api.onCustomEvent("sailing:board-supplied-panel", boardSuppliedPanel);
    api.onCustomEvent("sailing:leave-supplied-panel", leaveSuppliedPanel);
    api.onCustomEvent("sailing:left", onLeft);
    api.onPlayerLogin(describeBoatsOnLogin);
    Sailing.setSpecResolver(builtSpec);
    api.onInterfaceActionClick(switchCombatTab);
  },
};
