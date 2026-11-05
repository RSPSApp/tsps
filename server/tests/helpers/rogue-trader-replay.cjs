// Shared harness for the Rogue Trader tests: a real Player and ClientConnection, a real Ali Morrisane (3533) beside the
// stall at 3304,3211, and a replay of fixtures built from rsprox captures (tests/fixtures/rogue-trader/*.json, made
// with knowledge/.../2623/fixture.py from captures 3169, 1756, 3170 and 549). A fixture is the capture's own sequence
// of say / menu / pick / varbit / msg events; replay() plays the picks as real packets and asserts the server answers
// with exactly the captured lines, menus and Rogue Trader varbit changes, in the captured order.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { Server } = require('../../dist/Server');
const { CachePipeline } = require('../../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../../dist/plugins/PluginManager');
const { Player } = require('../../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../../dist/net/PlayerSession');
const { ClientConnection } = require('../../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../../dist/game/model/menu/MultiChatboxPrompt');

process.env.DISABLE_PLAYER_BOTS = '1';
Server.installProductionPathResolver();
const ALI = 3533, STALL = [3304, 3211];
let core, Quests, next = 3350;

async function setup() {
  await CachePipeline.initialize(path.resolve(__dirname, '..', '..'));
  // The generated shop definitions, as GameBuilder loads them at boot: the page's open_shop finds "Ali's Discount Wares." among them.
  new (require('../../dist/game/definition/loader/impl/ShopDefinitionLoader').ShopDefinitionLoader)().load();
  PM.loadFromDirectory(path.resolve(__dirname, '..', '..', 'plugins'));
  core = PM.getCoreApi(); Quests = require('../../plugins/quests/QuestRuntime');
  core.RegionManager.init(); core.RegionManager.loadMapFiles(STALL[0], STALL[1]);
  PM.emitServerStartup({});
  return core;
}
const teardown = () => PM.emitServerShutdown({});

/** Aubury (2886) in Varrock, the player beside him. */
function aubury(f) {
  core.RegionManager.loadMapFiles(3253, 3403);
  f.p.setLocation(new core.Location(3252, 3403, 0)); f.p.setNeedsPlacement(false);
  const npc = core.NPC.create(2886, new core.Location(3253, 3403, 0));
  core.World.getNpcs().add(npc); npc.setRegistered(true);
  f.aubury = npc;
  return npc;
}
const talkTo = async (f, npc, option = 'Talk-to') => {
  const index = npc.getCurrentDefinition(f.p).getActions().indexOf(option) + 1;
  assert.ok(index > 0, `${option} on ${npc.getId()}`);
  f.p.closeInterruptibleInterfaces();
  await send(f, { type: 'npc_option', index: npc.getIndex(), clickType: index });
};
/** A native interface button: widget_action on group:child, with the slot the capture's sub= gave. */
const click = (f, group, child, slot = -1) => send(f, { type: 'widget_action', widgetId: (group << 16) | child, groupId: group, childId: child, slot, buttonNum: 1, opId: 1 });
const setState = (f, values) => f.p.setAttribute('rogue-trader:state', values);

/** A player beside Ali. Quests default to what the captured players had: The Feud, Icthlarin's Little Helper and Rune Mysteries done. */
function actor(t, { feud = true, icthlarin = true, runeMysteries = true } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('rogue' + next); p.setRegistered(true);
  p.setLocation(new core.Location(STALL[0] - 1, STALL[1], 0)); p.setNeedsPlacement(false);
  const c = new ClientConnection(channel); c.player = p;
  const npc = core.NPC.create(ALI, new core.Location(STALL[0], STALL[1], 0));
  core.World.getNpcs().add(npc); npc.setRegistered(true);
  const shops = [], messages = [], varbits = [];
  t.mock.method(core.ShopManager, 'open', (player, id) => { if (player === p) shops.push(id); return true; });
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendMessage', (m) => { messages.push(m); return sender; });
  const sendTyped = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, 'sendTypedMessage', (type, text, ...r) => { messages.push(text); return sendTyped(type, text, ...r); });
  const sendVarbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, 'sendVarbit', (id, value, ...r) => { if (id >= 911 && id <= 922) varbits.push([id, value]); return sendVarbit(id, value, ...r); });
  t.after(() => {
    npc.setRegistered(false); core.World.getNpcs().remove(npc);
    PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex());
  });
  const done = { experience: false, scroll: false, announce: false };
  if (feud) Quests.questNamed('The Feud').complete(p, done);
  if (icthlarin) Quests.questNamed("Icthlarin's Little Helper").complete(p, done);
  if (runeMysteries) Quests.questNamed('Rune Mysteries').complete(p, done);
  return { p, c, npc, shops, messages, varbits };
}
async function drain(f) { for (let i = 0; i < 4; i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); } }
async function send(f, packet) { await f.c.dispatch([packet]); f.c.processTurnPackets(); await drain(f); }
async function talk(f, option = 'Talk-to') {
  const index = f.npc.getCurrentDefinition(f.p).getActions().indexOf(option) + 1;
  assert.ok(index > 0, `the cache gives Ali ${option}`);
  f.p.closeInterruptibleInterfaces();
  await send(f, { type: 'npc_option', index: f.npc.getIndex(), clickType: index });
}
async function nextLine(f) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  await send(f, { type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 });
}
const choose = (f, n) => send(f, { type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: n });
const clean = (s) => String(s).replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const varbit = (f, id) => f.p.getPacketSender().getVarbit(id);
const fixture = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'rogue-trader', name + '.json'), 'utf8'));

/** Continues through lines until a choice opens or the chat ends: the clean lines read, and the pending choice. */
async function read(f) {
  const lines = [];
  for (let i = 0; i < 150; i++) {
    const pending = MultiChatboxPrompt.getPending(f.p);
    if (pending) return { lines, pending };
    const current = f.p.getDialogueManager().getCurrent();
    if (!current) return { lines, pending: null };
    const text = current.getText?.();
    if (text) lines.push(clean(text));
    await nextLine(f);
  }
  throw new Error('conversation did not settle after: ' + lines.slice(-2).join(' | '));
}

/**
 * Replays captured events against the server. `opens` is how the conversation starts (talk(f) by default; pass
 * `false` when it is already open). Says are compared with the open chat line, menus with the pending choice, picks are
 * sent as native packets, varbits must arrive in order and not early, messages must have been sent by their turn.
 */
async function replay(f, events, { start = () => talk(f), looseMenu = false } = {}) {
  const name = f.p.getDisplayName?.() ?? f.p.getUsername();
  const text = (s) => clean(s.replace(/<player>/g, name));
  let varIndex = 0, msgIndex = 0;
  if (start) await start();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const where = `event ${i} (tick ${e.t})`;
    if (e.k === 'say') {
      assert.equal(f.varbits.length, varIndex, `${where}: no Rogue Trader varbit before this line that the capture does not have yet`);
      const current = f.p.getDialogueManager().getCurrent();
      assert.ok(current, `${where}: a chat line is open for "${e.text.slice(0, 40)}"`);
      // The decoder cuts a long message_game text at about 190 characters (1756's "...a resul"): a cut line must still start the server's.
      const got = clean(current.getText()), want = text(e.text);
      if (want.length >= 180 && got.length > want.length) assert.ok(got.startsWith(want), where + ': ' + got);
      else assert.equal(got, want, where);
      if (e.who === 'player') assert.ok(current instanceof core.PlayerDialogue, `${where}: the player speaks`);
      else assert.ok(current instanceof core.NpcDialogue, `${where}: ${e.who} speaks`);
      await nextLine(f);
    } else if (e.k === 'varbit') {
      assert.deepEqual(f.varbits[varIndex], [e.id, e.value], `${where}: varbit ${e.id} -> ${e.value}`);
      varIndex++;
    } else if (e.k === 'menu') {
      assert.equal(f.varbits.length, varIndex, `${where}: no unexpected varbit before the menu`);
      const pending = MultiChatboxPrompt.getPending(f.p);
      assert.ok(pending, `${where}: a choice is open`);
      // "Buy all the runes for N": the amount depends on the casket's random contents.
      const norm = (list) => list.map((o) => o.replace(/(Buy all the runes for )[\d,]+/, '$1N'));
      // looseMenu: a menu that another (generated) dialogue draws with older wording; only its last option, ours, must be there.
      if (looseMenu) assert.ok(pending.options.includes(e.options[e.options.length - 1]), where);
      else assert.deepEqual(norm(pending.options), norm(e.options), where);
    } else if (e.k === 'pick') {
      await choose(f, e.n);
    } else if (e.k === 'msg') {
      assert.ok(f.messages.slice(msgIndex).includes(text(e.text)), `${where}: message "${e.text.slice(0, 50)}"`);
      msgIndex = f.messages.length;
      // A message box (OBJECTBOX-less statement) stays up until the player continues.
      if (e.kind === 'mesbox') {
        const box = f.p.getDialogueManager().getCurrent();
        assert.ok(box instanceof core.StatementDialogue, `${where}: a message box is open`);
        assert.equal(clean(box.getText()), text(e.text), where);
        await nextLine(f);
      }
    }
  }
  assert.equal(f.varbits.length, varIndex, 'no Rogue Trader varbit beyond the capture');
}

module.exports = { setup, teardown, actor, aubury, talkTo, click, setState, talk, nextLine, choose, read, replay, fixture, varbit, send, drain, clean, MultiChatboxPrompt, get core() { return core; }, Quests: () => Quests };
