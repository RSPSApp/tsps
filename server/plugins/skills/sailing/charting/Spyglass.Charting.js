// Spyglass views (rsprox 907, 938-948, 3455, 3461, 3467, 3837): the spyglass's Look-through near an
// uncharted view's hint marker plays that view's camera shots, then charts it. Live, in order:
//   +0  the helm let go of (from the helm, the rest a tick later), the telescope animation
//   +1  the screen fades out
//   +3  the cutscene variables, the minimap off, the view's first shot; the XP drops and every
//       side tab but Friends, Account, Logout and Music closed, NPC and ground item options hidden
//   +5  the spyglass overlay (936) fades in; the view's other shots follow
//   then the overlay fades out, three ticks later the camera, the tabs, the options and the
//   screen come back, and two ticks after that the view is charted. Both screen fades also clear
//   the NPC health overlay. NPCs can still attack during the view.
// Anywhere else: "There isn't anything nearby worth looking at." The shots are each view's own, as
// captured (data/charting.json `view`). Inspect: the spyglass's object box.
const common = require("./Common.Charting");
const RandomEventTabs = require("../../../npcs/random-events/Teleports.RandomEvents");

const ITEM_SPYGLASS = 31803;
const INSPECT = "This spyglass can be used to observe specific points of interest throughout the seas. These observations will then be added to your sea charts.";

const SEQ_TELESCOPE = 13301; // human_sailing_charting_telescope01
const NOTHING_NEARBY = "There isn't anything nearby worth looking at.";
/** How far from the tile under the player a view's marker can be (ours: the captures answer 0-7 from the boat's centre). */
const VIEW_RANGE = 7;

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const SPYGLASS_OVERLAY = 936; // sailing_spyglass
const SPYGLASS_FADE_UID = (SPYGLASS_OVERLAY << 16) | 4; // sailing_spyglass:fade
const SCRIPT_FADE_COMPONENT = 7059;
const XP_DROPS_UID = (161 << 16) | 9; // toplevel_osrs_stretch:xp_drops
const XP_DROPS_GROUP = 122;
const FADE_CYCLES = 50;
/** Ticks from the telescope to the first shot, the overlay, and from the fade out to the end. */
const FIRST_SHOT_TICKS = 3;
const OVERLAY_TICKS = 2;
const RESTORE_TICKS = 3;
const CHART_TICKS = 2;
/** The variables live sets for the view and puts back after it (rsprox: all 0 before). */
const CUTSCENE_VARBITS = Object.freeze([
  ["fov_clamp", 3],
  ["cutscene_status", 1],
  ["gravestone_tli_hide", 1],
  ["draw_distance_max_override", 1],
  ["option_hide_rooftops_override", 1],
]);

/** Players looking through a spyglass: player -> view in progress. */
const viewing = new Map();

function varbitId(name) {
  return common.core().CacheDefinitions.getVarbitId(name);
}

/** The nearest uncharted view whose marker is within reach of the player, or undefined. */
function viewNear(player) {
  const { BoatManager } = common.core();
  const here = BoatManager.getBoatAboard(player) ? BoatManager.rootLocation(player) : player.getLocation();
  let best;
  let bestDistance = Infinity;
  for (const spot of common.spotsOfType("spyglass")) {
    if (!spot.view || !spot.location || common.isCharted(player, spot)) continue;
    const distance = Math.max(Math.abs(spot.location[0] - here.getX()), Math.abs(spot.location[1] - here.getY()));
    if (distance <= VIEW_RANGE && distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

/** Runs `action` after `ticks` while the view is still on; a click doesn't cancel it. */
function later(player, view, ticks, action) {
  const { Task, TaskManager } = common.core();
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks); }
    execute() {
      this.stop();
      if (viewing.get(player) === view && player.isRegistered?.() !== false) action();
    }
  })());
}

function fadeScreen(player, out) {
  const content = require("../SailingContent.Sailing");
  content.fade(player, out);
  common.api().emitCustomEvent("boss-hud:reset", { player });
}

/** Closes the XP drops and the side tabs and hides NPC and ground item options for the view. */
function lockHud(player) {
  const sender = player.getPacketSender();
  sender.sendHideNpcOps(true).sendHideObjOps(true);
  sender.closeSubInterface(XP_DROPS_UID);
  RandomEventTabs.hideTabs(player);
}

/** Everything lockHud took away, with the sailing sidepanel back on the combat tab if it was shown. */
function unlockHud(player) {
  const api = common.api();
  const { getVarbit, VARBIT } = require("../SailingContent.Sailing");
  const sender = player.getPacketSender();
  if (player.getAttribute(api.core.XPDROPS_ENABLED_ATTRIBUTE) === true) sender.sendSubInterface(XP_DROPS_UID, XP_DROPS_GROUP, 1);
  // A random event that took the player away during the view keeps its own tabs closed.
  if (!RandomEventTabs.sessionOf(player)) {
    RandomEventTabs.restoreTabs(player, api);
    if (getVarbit(player, VARBIT.SIDEPANEL_VISIBLE) === 1) require("../Panel.Sailing").showSidepanel(player);
  }
  sender.sendHideNpcOps(false).sendHideObjOps(false);
}

function shoot(player, shot) {
  const [, kind, x, y, height, rate, rate2] = shot;
  const sender = player.getPacketSender();
  if (kind === "moveto") sender.sendCameraMoveTo(x, y, height, { rate, rate2 });
  else sender.sendCameraLookAt(x, y, height, { rate, rate2 });
}

function setCutscene(player, on) {
  const sender = player.getPacketSender();
  for (const [name, value] of CUTSCENE_VARBITS) {
    const id = varbitId(name);
    if (id !== null && id !== undefined) sender.sendVarbit(id, on ? value : 0);
  }
}

function fadeOverlay(player, from, to) {
  player.getPacketSender().sendInterfaceScript(SCRIPT_FADE_COMPONENT, [from, to, FADE_CYCLES, SPYGLASS_FADE_UID]);
}

function look(player, spot) {
  const view = { spot };
  viewing.set(player, view);
  player.performAnimation(new (common.core().Animation)(SEQ_TELESCOPE));
  const { shots, fadeOut } = spot.view;
  later(player, view, 1, () => fadeScreen(player, true));
  later(player, view, FIRST_SHOT_TICKS, () => {
    setCutscene(player, true);
    lockHud(player);
  });
  const byTick = new Map();
  for (const shot of shots) byTick.set(shot[0], [...(byTick.get(shot[0]) ?? []), shot]);
  for (const [dt, list] of byTick) later(player, view, FIRST_SHOT_TICKS + dt, () => list.forEach((shot) => shoot(player, shot)));
  later(player, view, FIRST_SHOT_TICKS + OVERLAY_TICKS, () => {
    player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, SPYGLASS_OVERLAY, 1);
    fadeOverlay(player, 0, 255);
  });
  const end = FIRST_SHOT_TICKS + fadeOut;
  later(player, view, end, () => fadeOverlay(player, 255, 0));
  later(player, view, end + RESTORE_TICKS, () => restore(player));
  later(player, view, end + RESTORE_TICKS + CHART_TICKS, () => {
    viewing.delete(player);
    player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
    if (!common.isCharted(player, spot)) common.complete(player, spot);
  });
}

/** The camera, the cutscene variables, the HUD and the screen back as they were. */
function restore(player) {
  setCutscene(player, false);
  player.getPacketSender().sendCameraReset();
  unlockHud(player);
  fadeScreen(player, false);
}

function lookThrough({ player }) {
  if (viewing.has(player)) return;
  const spot = viewNear(player);
  if (!spot) {
    player.sendMessage(NOTHING_NEARBY);
    return;
  }
  common.afterHelm(player, () => look(player, spot));
}

/** A view cut short by logging out leaves nothing behind: the variables aren't saved, and a login sends the tabs and options afresh. */
function onLogout({ player }) {
  viewing.delete(player);
}

function attach(api) {
  common.init(api);
  api.onItemAction("Spyglass", {
    "Look-through": lookThrough,
    Inspect: ({ player }) => common.inspect(player, ITEM_SPYGLASS, INSPECT),
  });
  api.onPlayerLogout?.(onLogout);
}

module.exports = attach;
module.exports.viewNear = viewNear;
module.exports.lookThrough = lookThrough;
module.exports.viewing = viewing;
module.exports.NOTHING_NEARBY = NOTHING_NEARBY;
module.exports.INSPECT = INSPECT;
