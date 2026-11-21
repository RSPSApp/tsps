// Run after `yarn build`: node --test tests/myreque-vanstrom-chathead.test.cjs
// In Search of the Myreque's chatheads (#6412) against the rsprox capture of a whole live playthrough (revision 242,
// docs/in-search-of-the-myreque.md): Vanstrom in the pub has his human head (tick 9), and every line in the hideout
// cutscene has its speaker's cutscene actor (ticks 1307-1359). Real PluginManager, Players, cache, transcript runner.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');

const STAGE = 'quest.in_search_of_the_myreque.stage';
const BRIDGE = 'quest.in_search_of_the_myreque.bridge';
let core, next = 5600;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => runtime.getRegisteredQuests().find((q) => q.key === 'in_search_of_the_myreque');

/** A real player whose packets, messages and animations are recorded. */
function actor(t, stage, x, y, z = 0) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('myrequecap' + next);
  p.setRegistered(true); p.setLocation(new core.Location(x, y, z)); p.needsPlacement = false;
  p.setAttribute('bot-skip-persistence', true);
  p.setAttribute(STAGE, stage);
  p.messages = []; p.anims = []; p.varbits = []; p.sounds = []; p.objects = []; p.removed = []; p.interfaces = []; p.graphics = [];
  p.sendMessage = (text) => { p.messages.push(text); };
  const perform = p.performAnimation.bind(p);
  p.performAnimation = (animation) => { p.anims.push(animation.getId?.() ?? animation.id); return perform(animation); };
  const graphic = p.performGraphic.bind(p);
  p.performGraphic = (g) => { p.graphics.push([g.id, g.height]); return graphic(g); };
  const sender = p.getPacketSender();
  const wrap = (name, record) => { const original = sender[name].bind(sender); sender[name] = (...args) => { record(...args); return original(...args); }; };
  wrap('sendVarbit', (id, value) => p.varbits.push([id, value]));
  wrap('sendSound', (id, loops, delay) => p.sounds.push([id, delay]));
  wrap('sendObject', (object) => p.objects.push([object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()]));
  wrap('sendObjectRemoval', (object) => p.removed.push([object.getId(), object.getLocation().getX(), object.getLocation().getY()]));
  wrap('sendInterface', (id) => p.interfaces.push(id));
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
const login = (p) => PM.emitPlayerLogin({ player: p, username: p.getUsername() });
const at = (p) => { const l = p.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
const varbit = (p, id) => p.varbits.filter(([v]) => v === id).map(([, value]) => value);

/** One game tick: tasks, then movement, as the engine orders them. */
function tick(p, n = 1) {
  for (let i = 0; i < n; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    for (const player of [p].flat()) {
      const q = player.getMovementQueue(); q.beginCycle?.(); if (q.hasPendingWork?.()) q.process();
      core.TaskManager.processWalkTo(player.getIndex());
      core.AreaManager?.process?.(player);
      player.setNeedsPlacement(false); player.setResetMovementQueue(false);
    }
  }
}

function placed(x, y, ids) {
  return MapObjects.getObjectsAt(new core.Location(x, y, 0), null).find((o) => ids.includes(o.getId()));
}

/** Clicks a real placed loc's option the way the packet does, from where the player stands. */
function click(p, object, option) {
  const actions = ObjectDefinition.forPlayer(object.getId(), p).getActions();
  const clickType = actions.indexOf(option) + 1;
  assert.ok(clickType > 0, `${object.getId()} offers ${option}: ${JSON.stringify(actions)}`);
  const event = { player: p, object, objectId: object.getId(), location: object.getLocation(), clickType,
    definition: ObjectDefinition.forPlayer(object.getId(), p), handled: false };
  PM.emitObjectInteraction(event);
  return event;
}

function bridgeMaterials(p, rungs = 3) {
  const I = core.ItemIdentifiers;
  p.getInventory().adds(I.PLANK, rungs); p.getInventory().adds(I.STEEL_NAILS, 75 * rungs); p.getInventory().adds(I.HAMMER, 1);
}

// ---- Conversations through the real transcript runner ----
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const PAGE = 'In Search of the Myreque';

/**
 * Plays a conversation one tick per step: a menu takes the next scripted option, a line is continued; every step is a
 * game tick. `start` begins it; it runs until the chat is idle for `idleTicks` ticks in a row or `maxTicks` pass.
 */
async function converse(p, start, script = [], { maxTicks = 200, idleTicks = 4, onTick } = {}) {
  const channel = p.getSession?.().getChannel?.();
  const connection = new ClientConnection(channel ?? { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  connection.player = p;
  const lines = [];
  const sender = p.getPacketSender();
  const original = sender.sendString.bind(sender);
  sender.sendString = (text, ...rest) => { if (typeof text === 'string' && text) lines.push(text); return original(text, ...rest); };
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  start();
  let picks = 0, idle = 0;
  for (let n = 0; n < maxTicks && idle < idleTicks; n++) {
    onTick?.(n, lines);
    const current = p.getDialogueManager().getCurrent();
    const pending = MultiChatboxPrompt.getPending(p) ?? (typeof current?.getOptions === 'function' ? { options: current.getOptions() } : null);
    if (pending) {
      const index = picks < script.length ? pending.options.indexOf(script[picks]) : -1;
      if (index < 0) break;
      picks++;
      idle = 0;
      await send({ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
    } else if (p.getDialogueManager().getCurrent()) {
      idle = 0;
      await send({ type: 'dialogue_continue', widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
    } else {
      idle++;
    }
    tick(p);
  }
  sender.sendString = original;
  return lines;
}

const WEAPONS = [['STEEL_LONGSWORD', 1], ['STEEL_SHORTSWORD', 2], ['STEEL_DAGGER', 1], ['STEEL_MACE', 1], ['STEEL_WARHAMMER', 1]];
const giveWeapons = (p) => { for (const [name, amount] of WEAPONS) p.getInventory().adds(core.ItemIdentifiers[name], amount); };
const metAll = (p) => { for (const flag of ['met_sani', 'met_harold', 'met_radigad', 'met_polmafi', 'met_ivan']) p.setAttribute(`quest.in_search_of_the_myreque.${flag}`, true); };
const sceneNpcs = (p) => [...core.World.getNpcs()].filter((npc) => npc?.__questSceneOwner === p);


/** Every NPC line as [speaker name, chathead NPC id], in the order the client gets them. */
function heads(p) {
  const out = [];
  const sender = p.getPacketSender();
  const npcHead = sender.sendNpcHeadOnInterface.bind(sender);
  let pending = null;
  sender.sendNpcHeadOnInterface = (id, uid) => { pending = id; return npcHead(id, uid); };
  const str = sender.sendString.bind(sender);
  sender.sendString = (text, uid, ...rest) => {
    if (pending != null && (uid & 0xffff) === 4) { out.push([text, pending]); pending = null; }
    return str(text, uid, ...rest);
  };
  return out;
}

test('Vanstrom in the pub has his human head (5056), not the cutscene vampyre (9632) In Aid of the Myreque uses', async (t) => {
  const p = actor(t, 0, 3492, 3477);
  login(p);
  const shown = heads(p);
  await converse(p, () => PM.emitCustomEvent('npc-dialogue:start', {
    player: p, npcId: core.NpcIdentifiers.VANSTROM_KLAUSE_8, variant: { page: PAGE, variant: 'starting-out-vanstrom-klause' }, exact: true,
  }), [], { maxTicks: 10 });
  const vanstrom = shown.filter(([name]) => name === 'Vanstrom Klause');
  assert.ok(vanstrom.length > 0, JSON.stringify(shown));
  assert.deepEqual([...new Set(vanstrom.map(([, id]) => id))], [5056]);
});

test('the hideout cutscene: each speaker has their cutscene actor\'s head, Vanstrom his vampyre form (9632)', async (t) => {
  const p = actor(t, 65, 3506, 9837);
  giveWeapons(p); metAll(p);
  login(p);
  const shown = heads(p);
  await converse(p, () => PM.emitCustomEvent('npc-dialogue:start', {
    player: p, npcId: core.NpcIdentifiers.VELIAF_HURTZ_2,
    variant: { page: PAGE, variant: 'myreque-hideout-speaking-to-veliaf-after-introduced-to-other-members' }, exact: true,
  }), ["Let's talk about the weapons."], { maxTicks: 120, idleTicks: 16 });
  // Live (ticks 1307-1359): Harold 9625, Veliaf 9621, Sani 9623, Vanstrom 9632 twice, Sani, Vanstrom, Harold, Vanstrom.
  const scene = shown.slice(shown.findIndex(([name]) => name === 'Harold Evans'));
  assert.deepEqual(scene, [
    ['Harold Evans', 9625], ['Veliaf Hurtz', 9621], ['Sani Piliu', 9623], ['Vanstrom Klause', 9632], ['Vanstrom Klause', 9632],
    ['Sani Piliu', 9623], ['Vanstrom Klause', 9632], ['Harold Evans', 9625], ['Vanstrom Klause', 9632], ['Vanstrom Klause', 9632],
  ]);
});
