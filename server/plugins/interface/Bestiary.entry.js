const Layout = require('./bestiary/Layout.Bestiary');
const Navigation = require('./bestiary/MapNavigation.Bestiary');
const { catalog, encounterIds, groupedEntries, normalizeQuery } = require('./bestiary/Catalog.Bestiary');
const { knownSpawns } = require('./bestiary/Spawns.Bestiary');
const { canOpen: allowedToOpen } = require('./monsterexamine/Access.MonsterExamine');
const { GROUP_ID: EXAMINE_GROUP_ID } = require('./monsterexamine/Layout.MonsterExamine');
const CHANNEL = 'bestiary';
const CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE = 'interface:close-on-interface-close';
const PIN_LIFETIME_MS = 10 * 60 * 1000;
const REQUEST_INTERVAL_MS = 200;
const browsing = new WeakMap();
const clientReady = new WeakSet();
const selections = new Map();
const lastFind = new WeakMap();
let api;
let catalogRows;
let catalogEntries;
let revision = 0;

function rows() { return catalogRows ??= catalog(api.core, encounterIds(api)); }
function entries() { return catalogEntries ??= groupedEntries(rows(), id => api.core.CacheDefinitions.getNpc(id).idleSeqId ?? -1); }
function selection(player) {
  const selected = selections.get(player);
  if (selected && selected.expiresAt <= Date.now()) { selections.delete(player); return undefined; }
  return selected;
}
function stateFor(player) {
  let state = browsing.get(player);
  if (!state) { state = { query: '', sent: false }; browsing.set(player, state); }
  return state;
}
function canOpen(player) {
  return allowedToOpen(api.core, player, [Layout.GROUP_ID, EXAMINE_GROUP_ID]);
}
function render(player, mount = false) {
  const state = stateFor(player), sender = player.getPacketSender();
  if (mount) {
    player.setInterfaceId(Layout.GROUP_ID);
    player.setAttribute(CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE, true);
    sender.sendInterfaceScript(917, [-1, -3]);
    sender.sendSubInterface(Layout.MAIN_MODAL_UID, Layout.GROUP_ID, 0, {
      postScripts: [{ scriptId: 917, args: [-1, -3] }, { scriptId: 227, args: [Layout.uid(Layout.C.FRAME), 'Bestiary'] }],
    });
  }
  // Only names/stats travel here. Native models are bound by the client's visible-slot pool.
  if (!state.sent) {
    const parts = [[]]; let bytes = 2;
    for (const entry of entries()) {
      const size = Buffer.byteLength(JSON.stringify(entry), 'latin1') + 1;
      if (bytes + size > 40000) { parts.push([]); bytes = 2; }
      parts.at(-1).push(entry); bytes += size;
    }
    if (parts.length > Layout.DATA_COMPONENTS.length) throw new Error('Bestiary catalogue exceeds its packet budget.');
    Layout.DATA_COMPONENTS.forEach((component, index) => sender.sendString(JSON.stringify(parts[index] ?? []), Layout.uid(component)));
    sender.sendString(state.query, Layout.uid(Layout.C.SEARCH_TEXT));
    state.sent = true;
  }
}

function open(event) {
  const { player } = event;
  if (!canOpen(player)) return false;
  if (event.query !== undefined) { const state = stateFor(player); state.query = normalizeQuery(event.query); state.sent = false; }
  render(player, true);
  event.handled = true;
  return true;
}
function command({ player, parts = [] }) { open({ player, query: parts.length > 1 ? parts.slice(1).join(' ') : undefined }); return true; }
function send(player, data) { player.getSession().sendClientPacket(api.core.encodePluginMessage(CHANNEL, data)); }
function clear(player) {
  selections.delete(player);
  if (player.getPacketSender().isSubInterfaceOpen(Navigation.GROUP_ID)) player.getPacketSender().closeSubInterface(Navigation.HOST_UID);
  send(player, { type: 'clear', revision: ++revision });
}
function find(event) {
  const { player, npcId } = event;
  const row = rows().find(row => row.id === npcId);
  if (!canOpen(player) || !row) return;
  event.handled = true;
  findRows(player, [row]);
}
function findRows(player, variants) {
  if (Date.now() - (lastFind.get(player) ?? 0) < REQUEST_INTERVAL_MS) return;
  lastFind.set(player, Date.now());
  clear(player);
  if (!clientReady.has(player)) {
    player.getPacketSender().sendMessage('Enable Monster Examine in the client plugins to show Bestiary pins.');
    return;
  }
  const npcIds = variants.map(row => row.id), { name, level } = variants[0];
  const { points, limited } = knownSpawns(api.core, player, npcIds);
  if (!points.length) {
    player.getPacketSender().sendMessage(`No known spawn locations for ${name} (level ${level}).`);
    return;
  }
  const selected = { npcId: npcIds[0], npcIds, name, level, points, limited, index: 0, expiresAt: Date.now() + PIN_LIFETIME_MS };
  selections.set(player, selected);
  sendSelection(player, selected);
  const sender = player.getPacketSender();
  if (!sender.isWorldMapOpen()) sender.toggleWorldMap();
  renderNavigation(player);
  sender.sendMessage(`${name} (level ${level}): ${points.length} known locations${limited ? ' (list limited)' : ''}. Use Previous and Next to visit their map locations.`);
}
function sendSelection(player, selected) {
  const { npcId, name, level, points, limited, expiresAt, index } = selected;
  send(player, { type: 'find', revision: ++revision, npcId, name, level, points, limited, expiresAt, focusIndex: index });
}
function renderNavigation(player) {
  const selected = selection(player);
  if (!selected) return;
  const sender = player.getPacketSender();
  if (!sender.isSubInterfaceOpen(Navigation.GROUP_ID)) sender.sendSubInterface(Navigation.HOST_UID, Navigation.GROUP_ID, 1);
  const { points, index, name, level, npcIds, limited } = selected, point = points[index];
  sender.sendString(`${name} - Level ${level}${npcIds.length > 1 ? ` (${npcIds.length} variants)` : ''}`, Navigation.uid(Navigation.C.TITLE));
  sender.sendString(`Location ${index + 1} of ${points.length}${limited ? ' (list limited)' : ''}`, Navigation.uid(Navigation.C.STATUS));
  sender.sendString(`Tile ${point.x}, ${point.y} - Floor ${point.plane}`, Navigation.uid(Navigation.C.POSITION));
}
function mapOpened({ player, groupId }) {
  if (groupId === Navigation.WORLD_MAP_GROUP_ID) {
    if (selection(player)) renderNavigation(player);
    else if (player.getPacketSender().isSubInterfaceOpen(Navigation.GROUP_ID)) player.getPacketSender().closeSubInterface(Navigation.HOST_UID);
  }
}
function navigate(event) {
  const { player, buttonId } = event, sender = player.getPacketSender();
  if (event.handled || !sender.isWorldMapOpen() || !sender.isSubInterfaceOpen(Navigation.GROUP_ID)) return;
  event.handled = true;
  const c = buttonId & 0xffff, selected = selection(player);
  if (!selected || [Navigation.C.CLEAR, Navigation.C.CLEAR_TEXT].includes(c)) { clear(player); return; }
  const direction = [Navigation.C.PREVIOUS, Navigation.C.PREVIOUS_TEXT].includes(c) ? -1 : 1;
  selected.index = (selected.index + direction + selected.points.length) % selected.points.length;
  sendSelection(player, selected);
  renderNavigation(player);
}
function selectionChanged({ player, npcId }) {
  if (selection(player) && !selection(player).npcIds.includes(npcId)) clear(player);
}
function click(event) {
  const { player, buttonId } = event;
  if (event.handled || player.getInterfaceId() !== Layout.GROUP_ID || !canOpen(player)) return;
  event.handled = true;
  const c = buttonId & 0xffff, op = event.opId ?? event.action ?? 1;
  if ([Layout.C.CLEAR, Layout.C.CLEAR_TEXT].includes(c)) { clear(player); return; }
  const belongs = Layout.CARD_COMPONENTS.some(start => c >= start && c < start + Layout.SLOTS);
  if (!belongs || !Number.isInteger(event.slot)) return;
  const entry = entries().find(row => row.id === event.slot);
  if (!entry) return;
  if (entry.expandable) {
    if (op === 2) {
      const ids = new Set(entries().filter(child => child.parentId === entry.id).map(child => child.npc));
      findRows(player, rows().filter(row => ids.has(row.id)));
    }
    return;
  }
  const npcId = entry.npc;
  if (op === 2) { find({ player, npcId }); return; }
  if (op !== 1) return;
  const first = knownSpawns(api.core, player, npcId).points[0];
  const request = { player, npcId, fromGroupId: Layout.GROUP_ID,
    location: first ? new api.core.Location(first.x, first.y, first.plane) : null, handled: false };
  api.emitCustomEvent('monster-examine:open-definition', request);
  if (!request.handled) player.getPacketSender().sendMessage('Monster Examine is disabled. Enable it to open creature details.');
}

function receive(event) {
  if (event.channel !== CHANNEL) return;
  event.handled = true;
  if (event.data?.type !== 'client-state' || typeof event.data.enabled !== 'boolean') return;
  if (event.data.enabled) clientReady.add(event.player);
  else {
    clientReady.delete(event.player); clear(event.player);
    if (event.player.getInterfaceId() === Layout.GROUP_ID) render(event.player);
  }
}
function forget({ player }) {
  browsing.delete(player); clientReady.delete(player); selections.delete(player); lastFind.delete(player);
}
function clearEvent(event) { if (canOpen(event.player)) { clear(event.player); event.handled = true; } }
function shutdown() { for (const player of selections.keys()) clear(player); catalogRows = catalogEntries = undefined; }
function attach(pluginApi) {
  api = pluginApi;
  api.registerCustomInterface(Layout.DEFINITION);
  api.registerCustomInterface(Navigation.DEFINITION);
  api.registerCommand('bestiary', command, api.core?.PlayerRights?.NONE, 'Browse creatures, their stats, drops and known spawn locations');
  api.onInterfaceActionButton([...Layout.CARD_UIDS, ...[Layout.C.SEARCH, Layout.C.SEARCH_TEXT, Layout.C.CLEAR,
    Layout.C.CLEAR_TEXT].map(Layout.uid)], click);
  api.onCustomEvent('bestiary:open', open);
  api.onCustomEvent('bestiary:find', find);
  api.onCustomEvent('bestiary:clear', clearEvent);
  api.onCustomEvent('bestiary:view', selectionChanged);
  api.onCustomEvent('interface:opened', mapOpened);
  api.onInterfaceActionButton(Navigation.BUTTONS.map(Navigation.uid), navigate);
  api.onCustomEvent('network:plugin-message', receive);
  api.onPlayerLogout(forget);
  api.onPlayerDisconnect(forget);
  api.onServerShutdown(shutdown);
}
module.exports = { name: 'Bestiary', category: '@ Ghost Plugins @',
  description: 'Browse native 3D creatures, examine their drops and find known spawn locations.',
  register(api) { attach(api); },
  _test: { Layout, Navigation, open, click, find, receive, selectionChanged, forget, shutdown, render, PIN_LIFETIME_MS } };
