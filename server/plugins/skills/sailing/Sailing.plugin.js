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
  setVarbit,
  animateDeckLocs,
  isSail,
  boatAnim,
} = require("./sailingContent");
const { repairKitUses } = require("./cargo");
const { specFor } = require("./boatParts");
const { hotspotLocs } = require("./boatFacilities");
const { describeBoat, boatVarps, openSidepanel, clearBoatVarps, DESCRIPTION_VARBITS } = require("./sidepanel");
const { sendBoatVarbits } = require("./boatVarbits");


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
const VIEW_SAILING_OPTIONS_CHILD = 46;
/** The sidepanel's "View Combat Options" (see sidepanel.js). */
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
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player); }
    execute() {
      if (player.getArea()?.boat !== boat) return this.stop();
      applyBoarded(player, owned);
      // Boarding lowers the sails to rest.
      const sailDown = boatAnim(boat, "sailDown");
      if (sailDown !== undefined) animateDeckLocs(player, boat, isSail, sailDown);
      this.stop();
    }
  })());
}

function onLeft({ player, reason }) {
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
 * The combat tab's "View" button (593:46) and the sidepanel's "Combat Options" (937:33) swap
 * the combat tab between the combat options and the sailing sidepanel while aboard; the
 * client only plays a click (script 489), the server remounts the tab.
 */
function switchCombatTab(event) {
  const { player } = event;
  if (event.groupId === COMBAT_OPTIONS_GROUP && event.childId === VIEW_SAILING_OPTIONS_CHILD) {
    event.handled = true;
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

/**
 * Facility and part schematics the customisation interface shows as "Unknown" until found
 * (cache script 9078: one varbit each, found at 1+): salvaging stations, the gale catcher,
 * eternal braziers, dragon hooks, rosewood cargo holds, the dragon cannon, the top-tier hulls,
 * sails, helms and keels, and the ballistic attractor. Every schematic is unlocked here; finding
 * them doesn't exist yet.
 */
const SCHEMATIC_VARBITS = [19544, 19545, 19546, 19547, 19548, 19549, 19550, 19551, 19552, 19553, 20227];

/**
 * Describes every owned boat (the per-boat varbits), as live OSRS has them at login, and
 * unlocks every schematic.
 */
function describeBoatsOnLogin({ player }) {
  for (const varbit of SCHEMATIC_VARBITS) setVarbit(player, varbit, 1);
  sendBoatVarbits(player);
}

module.exports = {
  name: "Sailing",
  members: true,
  register(api) {
    content();
    api.onCustomEvent("sailing:boarded", onBoarded);
    api.onCustomEvent("sailing:left", onLeft);
    api.onPlayerLogin(describeBoatsOnLogin);
    Sailing.setSpecResolver(builtSpec);
    api.onInterfaceActionClick(switchCombatTab);
  },
};
