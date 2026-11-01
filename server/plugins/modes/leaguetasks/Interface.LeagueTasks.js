/**
 * The task list (league_tasks, 657), as captured: the side panel's View Tasks opens it in the
 * toplevel floater as an overlay with the click events on its dropdowns' option lists, rows and
 * menu frame (this cache's components; the data says which); a dropdown option slot sets that
 * filter's varbit to slot - 1 (the client's scripts filter the rows from the varbits), kept across
 * logins; a row click is the client's own expand/collapse and gets no reply; the close button
 * closes the floater. Clicks count only after View Tasks opened the list.
 */
const Common = require("./Common.LeagueTasks");

/** if_setevents OP1 (as SideJournalDefaults sends it). */
const FLAGS_OP1 = 1 << 1;

/** Players whose list is open. */
const viewing = new WeakSet();

const uid = (group, child) => (group << 16) | child;

function filtersOf(player) {
  const value = player.getAttribute(Common.FILTERS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sendFilters(player) {
  const sender = player.getPacketSender();
  const saved = filtersOf(player);
  for (const [key, filter] of Object.entries(Common.data.filters)) sender.sendVarbit(filter.varbit, Number(saved[key]) || 0);
}

function open({ player }) {
  const type = Common.leagueOf(player);
  if (type === null) return false;
  const { group, floater, overlay, rows, menuFrame, menuFrameSlots } = Common.data.interface;
  // The catalog again, in case the client reloaded since login (LeagueMode's single sender).
  Common.api.emitCustomEvent("league:send-content", { player });
  const sender = player.getPacketSender();
  // The floater is an overlay: replacing the main modal must be explicit.
  sender.sendInterfaceRemoval();
  sender.sendSubInterface(uid(floater[0], floater[1]), group, overlay);
  for (const filter of Object.values(Common.data.filters)) {
    sender.sendInterfaceFlagsRange(uid(group, filter.component), filter.slots[0], filter.slots[1], FLAGS_OP1);
  }
  sender.sendInterfaceFlagsRange(uid(group, rows), 0, Common.catalog(type).slots, FLAGS_OP1);
  sender.sendInterfaceFlagsRange(uid(group, menuFrame), menuFrameSlots[0], menuFrameSlots[1], FLAGS_OP1);
  viewing.add(player);
  return true;
}

/** A dropdown's slot: slot 1 is the enum's "All" (0), the rest follow. */
function filterClick(key) {
  return ({ player, slot }) => {
    const filter = Common.data.filters[key];
    const index = Number(slot);
    if (!viewing.has(player) || Common.leagueOf(player) === null || !Number.isInteger(index) || index < filter.slots[0] || index > filter.slots[1]) return false;
    const value = index - 1;
    player.setAttribute(Common.FILTERS_ATTRIBUTE, { ...filtersOf(player), [key]: value });
    player.getPacketSender().sendVarbit(filter.varbit, value);
    return true;
  };
}

function rowClick({ player }) {
  return viewing.has(player);
}

function close({ player }) {
  if (!viewing.has(player)) return false;
  viewing.delete(player);
  player.getPacketSender().closeInterface(Common.data.interface.group);
  return true;
}

function login({ player, league }) {
  if (Common.catalog(league)) sendFilters(player);
}

module.exports = function attach(api) {
  const { group, openButton, rows, close: closeChild } = Common.data.interface;
  api.persistAttribute(Common.FILTERS_ATTRIBUTE, {});
  api.onInterfaceActionButton(uid(openButton[0], openButton[1]), open);
  for (const [key, filter] of Object.entries(Common.data.filters)) api.onInterfaceActionButton(uid(group, filter.component), filterClick(key));
  api.onInterfaceActionButton(uid(group, rows), rowClick);
  api.onInterfaceActionButton(uid(group, closeChild), close);
  api.onCustomEvent("league:login", login);
};
