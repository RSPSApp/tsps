/**
 * The task list (league_tasks, 657), as captured on Leagues VI: the side panel's View Tasks opens it
 * in the toplevel floater as an overlay with the click events on its dropdowns' option lists, rows
 * and menu frame (this cache's components; the data says which), then script 9404 (the list's
 * override wipe); a dropdown option slot sets that filter's varbit to slot - 1 (the client's scripts
 * filter the rows from the varbits), kept across logins; a row click is the client's own
 * expand/collapse and gets no reply; the search bar starts the client's search (two varbits and
 * chatdefault_stopinput); the close button ends a search, closes the floater and runs script 9431.
 * Clicks count only after View Tasks opened the list.
 */
const Common = require("./Common.LeagueTasks");

/** if_setevents OP1 (as SideJournalDefaults sends it). */
const FLAGS_OP1 = 1 << 1;

/** Players whose list is open. */
const viewing = new WeakSet();
/** Players searching the open list (the client is reading the keyboard). */
const searching = new WeakSet();

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
  sender.sendInterfaceFlagsRange(uid(group, rows), 0, lastRow(type), FLAGS_OP1);
  sender.sendInterfaceFlagsRange(uid(group, menuFrame), menuFrameSlots[0], menuFrameSlots[1], FLAGS_OP1);
  sender.sendInterfaceScript(Common.data.interface.scripts.taskWipe, []);
  viewing.add(player);
  searching.delete(player);
  return true;
}

/**
 * The rows' events end at the list enum's last key, as captured: Demonic Pacts' 1592 (its cache
 * list, one row of it outside the league) and Raging Echoes' 1589. A league whose list we send has
 * its task count there, as Raging Echoes' was.
 */
function lastRow(type) {
  const catalog = Common.catalog(type);
  return catalog.fromCache ? catalog.slots - 1 : catalog.tasks.length;
}

function searchClick({ player }) {
  if (!viewing.has(player) || Common.leagueOf(player) === null) return false;
  const { search, scripts } = Common.data.interface;
  const sender = player.getPacketSender();
  sender.sendVarbit(search.searchingVarbit, 1);
  sender.sendVarbit(search.keyboardVarbit, 1);
  sender.sendInterfaceScript(scripts.stopInput, []);
  searching.add(player);
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
  const { group, search, scripts } = Common.data.interface;
  const sender = player.getPacketSender();
  const wasSearching = searching.delete(player);
  if (wasSearching) {
    sender.sendVarbit(search.searchingVarbit, 0);
    sender.sendVarbit(search.keyboardVarbit, 0);
  }
  sender.closeInterface(group);
  if (wasSearching) sender.sendInterfaceScript(scripts.restoreInput, []);
  sender.sendInterfaceScript(scripts.close, []);
  return true;
}

/** A league screen opening as the main modal closes the list first, as captured (rev 237: 1104). */
function modalOpening({ player }) {
  if (player) close({ player });
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
  api.onInterfaceActionButton(uid(group, Common.data.interface.search.component), searchClick);
  api.onInterfaceActionButton(uid(group, closeChild), close);
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("league:modal-opening", modalOpening);
};
