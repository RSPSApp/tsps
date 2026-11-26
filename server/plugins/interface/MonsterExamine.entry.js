const Layout = require('./monsterexamine/Layout.MonsterExamine');
const { buildDrops, groupRows, splitRows, plain } = require('./monsterexamine/Drops.MonsterExamine');
const { combatFacts, summary } = require('./monsterexamine/Facts.MonsterExamine');
const { canOpen } = require('./monsterexamine/Access.MonsterExamine');
const lastRequest = new WeakMap();
const viewed = new WeakMap();
const REQUEST_INTERVAL_MS = 500;
// Cache toplevel_mainmodal_background: -3 makes the native mount fill its
// available area in Resizable, while Fixed retains the cache's 512x334 pane.
const MAINMODAL_BACKGROUND_SCRIPT = 917;
const EXPANDED_MODAL_SIZE = -3;
const CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE = 'interface:close-on-interface-close';

function examine(api, event) {
  const { player, npc } = event;
  if (event.handled || !npc) return;
  const definition = npc.getCurrentDefinition(player);
  if (!definition?.isAttackable()) return;
  // Text fallback preserves bank, dialogue, trade, movement holds and cutscenes.
  if (!canOpen(api.core, player, [Layout.GROUP_ID])) return;
  const now = Date.now();
  if (now - (lastRequest.get(player) ?? 0) < REQUEST_INTERVAL_MS) return;
  lastRequest.set(player, now);
  show(api, player, npc, definition);
  event.handled = true;
}
function show(api, player, npc, definition, dropNpc = npc) {
  const npcId = definition.getId();
  const query = { player, npc: dropNpc, npcId, source: null };
  api.emitCustomEvent('npc-drops:describe', query);
  const display = buildDrops(query.source, id => api.core.ItemDefinition.forId(id).getName());
  const rows = groupRows(display.rows);
  const parts = splitRows(rows);
  const lines = combatFacts(api.core, player, npc, definition);
  const sender = player.getPacketSender();
  player.setInterfaceId(Layout.GROUP_ID);
  player.setAttribute(CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE, true);
  sender.sendInterfaceScript(MAINMODAL_BACKGROUND_SCRIPT, [-1, EXPANDED_MODAL_SIZE]);
  sender.sendSubInterface(Layout.MAIN_MODAL_UID, Layout.GROUP_ID, 0, {
    postScripts: [{ scriptId: MAINMODAL_BACKGROUND_SCRIPT, args: [-1, EXPANDED_MODAL_SIZE] },
      { scriptId: 227, args: [Layout.uid(Layout.C.FRAME), plain(definition.getName())] }],
  });
  sender.sendNpcHeadOnInterface(definition.getId(), Layout.uid(Layout.C.MODEL));
  sender.sendInterfaceAnimation(Layout.uid(Layout.C.MODEL), api.core.CacheDefinitions.getNpc(definition.getId()).idleSeqId ?? -1);
  sender.sendString(summary(npc, definition), Layout.uid(Layout.C.SUMMARY));
  sender.sendString(lines.join('<br>'), Layout.uid(Layout.C.FACTS));
  sender.sendString(String(12 + lines.reduce((height, line) => height + 14 * Math.max(1, Math.ceil(plain(line, 1000).length / 31)), 0)), Layout.uid(Layout.C.HEIGHT));
  const sentRows = parts.reduce((count, rows) => count + rows.length, 0);
  sender.sendString(`${sentRows < rows.length ? 'List capped. ' : ''}${display.note}`, Layout.uid(Layout.C.NOTE));
  player.getFrameUpdater().clear(Layout.uid(Layout.C.INPUT));
  sender.sendString('', Layout.uid(Layout.C.INPUT));
  Layout.DATA_COMPONENTS.forEach((component, index) => sender.sendString(JSON.stringify(parts[index] ?? []), Layout.uid(component)));
  viewed.set(player, npcId);
  api.emitCustomEvent('bestiary:view', { player, npcId });
}
function openDefinition(api, event) {
  const { player, npcId, fromGroupId, location } = event;
  if (event.handled || !Number.isInteger(npcId) || npcId < 0 || npcId >= api.core.CacheDefinitions.getCounts().npcs
    || !canOpen(api.core, player, [Layout.GROUP_ID, fromGroupId])) return;
  const definition = api.core.NpcDefinition.forId(npcId);
  if (!definition.isAttackable()) return;
  // The base NPC constructor only initializes a detached calculation subject.
  // Never NPC.create: registered implementations may start encounter machinery.
  const npc = new api.core.NPC(npcId, location ?? player.getLocation().clone());
  npc.getCurrentDefinition = () => definition;
  const dropNpc = location ? npc : { getCurrentDefinition: () => definition, getLocation: () => null };
  show(api, player, npc, definition, dropNpc);
  event.handled = true;
}
function navigation(api, event) {
  const { player, buttonId } = event;
  if (event.handled || player.getInterfaceId() !== Layout.GROUP_ID || !canOpen(api.core, player, [Layout.GROUP_ID])) return;
  const c = buttonId & 0xffff;
  const name = [Layout.C.BACK, Layout.C.BACK_TEXT].includes(c) ? 'bestiary:open'
    : [Layout.C.FIND, Layout.C.FIND_TEXT].includes(c) ? 'bestiary:find' : 'bestiary:clear';
  const request = { player, npcId: viewed.get(player), handled: false };
  api.emitCustomEvent(name, request);
  if (!request.handled) player.getPacketSender().sendMessage('Bestiary is disabled. Enable it in Ghost Plugins to browse or find creatures.');
  event.handled = true;
}
function forget({ player }) { lastRequest.delete(player); viewed.delete(player); }
module.exports = {
  name: 'MonsterExamine',
  category: '@ Ghost Plugins @',
  description: 'Examine attackable NPCs in a native game window with live combat stats and searchable effective drop sources.',
  register(api) {
    api.registerCustomInterface(Layout.DEFINITION);
    api.onCustomEvent('world:npc-examine', examine.bind(null, api));
    api.onCustomEvent('monster-examine:open-definition', openDefinition.bind(null, api));
    api.onInterfaceActionButton([Layout.C.BACK, Layout.C.BACK_TEXT, Layout.C.FIND, Layout.C.FIND_TEXT,
      Layout.C.CLEAR, Layout.C.CLEAR_TEXT].map(Layout.uid), navigation.bind(null, api));
    api.onPlayerLogout(forget);
    api.onPlayerDisconnect(forget);
  },
  _test: { examine, combatFacts, openDefinition, navigation, Layout, MAINMODAL_BACKGROUND_SCRIPT, EXPANDED_MODAL_SIZE },
};
