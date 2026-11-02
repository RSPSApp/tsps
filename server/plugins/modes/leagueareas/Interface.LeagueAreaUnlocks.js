/**
 * The area interface (trailblazer_areas, 512), as captured: the side panel's View Areas opens it
 * as the main modal (busy and script 2524 first, rev 237) with the click events on its menu frame; a shield, a name or the name header
 * records the area viewed (varbit league_area_last_viewed) and runs the client's details script
 * with the area's state; the details' button teleports to an unlocked area; confirm unlocks the
 * viewed one. Clicks count only after View Areas opened the interface.
 */
const Common = require("./Common.LeagueAreaUnlocks");
const Unlock = require("./Unlock.LeagueAreaUnlocks");
const Teleport = require("./Teleport.LeagueAreaUnlocks");

/** if_setevents OP1 (as SideJournalDefaults sends it). */
const FLAGS_OP1 = 1 << 1;

/** Players who opened the interface through View Areas, and the area they last viewed (-1 none). */
const viewing = new WeakMap();

function ui() {
  return Common.data.interface;
}

function open({ player }) {
  const type = Common.leagueOf(player);
  if (type === null) return false;
  const { group, menuFrame, menuFrameSlots } = ui();
  Common.api.emitCustomEvent("league:send-content", { player });
  Common.api.emitCustomEvent("league:modal-opening", { player, group });
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(ui().modalSize[0], ui().modalSize[1]);
  sender.sendInterface(group);
  sender.sendInterfaceFlagsRange(Common.uid(group, menuFrame), menuFrameSlots[0], menuFrameSlots[1], FLAGS_OP1);
  viewing.set(player, -1);
  return true;
}

/** Shows an area's details: the varbit and script 3668 with its state (and, for an area outside the league, why). */
function view(player, type, area) {
  const { group, viewScript, viewScriptComponentsBefore, viewScriptComponentsAfter, states } = ui();
  const state = Unlock.state(player, type, area.id);
  const text = state === states.message ? Common.message(Unlock.refusal(player, type, area.id) ?? "notInLeague") : "";
  const sender = player.getPacketSender();
  viewing.set(player, area.id);
  sender.sendVarbit(Common.data.varbits.lastViewed, area.id);
  sender.sendInterfaceScript(viewScript, [
    area.id,
    ...viewScriptComponentsBefore.map((child) => Common.uid(group, child)),
    state,
    ...viewScriptComponentsAfter.map((child) => Common.uid(group, child)),
    text,
  ]);
  return true;
}

/** Every area's shield and name components (the cache table's), the buttons a view click can hit. */
function areaButtons() {
  return [...Common.areas.values()].flatMap((area) => [area.shield, area.nameComponent]);
}

/** The area whose shield or name the click hit. */
function areaOfButton(buttonId) {
  for (const area of Common.areas.values()) {
    if (area.shield === buttonId || area.nameComponent === buttonId) return area;
  }
  return null;
}

function shieldClicked({ player, buttonId }) {
  const type = Common.leagueOf(player);
  const area = areaOfButton(buttonId);
  if (type === null || !area || !viewing.has(player)) return false;
  return view(player, type, area);
}

/** The name header shows the last viewed area again (captured). */
function headerClicked({ player }) {
  const type = Common.leagueOf(player);
  const area = Common.area(viewing.get(player) ?? -1);
  if (type === null || !area) return false;
  return view(player, type, area);
}

function teleportClicked({ player }) {
  const type = Common.leagueOf(player);
  const area = Common.area(viewing.get(player) ?? -1);
  if (type === null || !area) return false;
  if (!Common.unlocked(player).includes(area.id)) return false;
  return Teleport.cast(player, type, area);
}

function confirmClicked({ player }) {
  if (!viewing.has(player)) return false;
  const area = viewing.get(player);
  if (area < 0) {
    player.sendMessage(Common.message("selectFirst"));
    return true;
  }
  Unlock.unlock(player, area);
  return true;
}

module.exports = function attach(api) {
  const { group, openButton, nameHeader, teleportButton, confirm } = ui();
  api.onInterfaceActionButton(Common.uid(openButton[0], openButton[1]), open);
  api.onInterfaceActionButton(areaButtons(), shieldClicked);
  api.onInterfaceActionButton(Common.uid(group, nameHeader), headerClicked);
  api.onInterfaceActionButton(Common.uid(group, teleportButton), teleportClicked);
  api.onInterfaceActionButton(Common.uid(group, confirm), confirmClicked);
  api.onCustomEvent("league:teleport-cast", Teleport.answerTeleportCast);
};

Object.assign(module.exports, { open });
