// Run after `yarn build`: node --test tests/archery-judge-native.test.cjs
//
// Issue #4371: the Competition Judge's menu answers the option the player picks. Every plugin
// loaded, a real Player, the Ranging Guild's judge spawn (6070) and native npc_option /
// dialogue_continue packets.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const Session = require('../plugins/minigames/archerycompetition/Session.ArcheryCompetition');

const JUDGE = 6070;
const AT = [2669, 3418, 0];
let core, judge, next = 9860;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
  judge = [...core.World.getNpcs()].find((npc) => npc && npc.getId() === JUDGE)
    ?? PM.spawnNpc({ id: JUDGE, x: AT[0], y: AT[1], z: 0, wanderRadius: 0 });
});
after(() => PM.emitServerShutdown({}));

function harness(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername('archery' + next); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.getSkillManager().setMaxLevel(core.Skill.RANGED, 40).setCurrentLevel(core.Skill.RANGED, 40);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 1000), false);
  const at = judge.getLocation();
  player.setLocation(new core.Location(at.getX() + 1, at.getY(), 0)); player.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = player;
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const tick = () => { core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process(); core.TaskManager.process(); c.processTurnPackets(); };
  const send = async (packet) => { await c.dispatch([packet]); for (let i = 0; i < 3; i++) tick(); };
  const group = () => player.getPacketSender().getChatboxGroupId();
  const text = () => player.getDialogueManager().getCurrent()?.getText?.();
  /** Continues lines until a menu shows; returns its options. */
  async function menu() {
    for (let i = 0; i < 20; i++) {
      const current = player.getDialogueManager().getCurrent();
      if (typeof current?.getOptions === 'function') return current.getOptions();
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending) return pending.options;
      if (!player.getDialogueManager().isActive()) return null;
      await send({ type: 'dialogue_continue', widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
    }
    return null;
  }
  async function choose(option) {
    const options = await menu();
    assert.ok(options, 'a menu opened');
    const at = options.indexOf(option);
    assert.ok(at >= 0, `${option} in ${JSON.stringify(options)}`);
    await send({ type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: at + 1 });
  }
  return { player, send, choose, text };
}

async function talk(f) {
  const op = judge.getCurrentDefinition(f.player).getActions().findIndex((action) => action === 'Talk-to') + 1;
  assert.ok(op > 0);
  await f.send({ type: 'npc_option', index: judge.getIndex(), clickType: op });
  assert.equal(f.player.getDialogueManager().isActive(), true);
}

test('"Sure, I\'ll give it a go." accepts: 200 coins for 10 bronze arrows', async (t) => {
  const f = harness(t);
  await talk(f);
  await f.choose("Sure, I'll give it a go.");
  assert.equal(f.text(), "Sure, I'll give it a go.");
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 800);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BRONZE_ARROW), 10);
});

test('"What are the rules?" and "No thanks." answer as chosen', async (t) => {
  const f = harness(t);
  await talk(f);
  await f.choose('What are the rules?');
  assert.equal(f.text(), 'What are the rules?');
  await f.choose('No thanks.');
  assert.equal(f.text(), 'No thanks.');
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 1000, 'nothing paid');
});

test('a full pack whose only bronze arrows are a preset stack is refused before the fee', async (t) => {
  const f = harness(t);
  const inventory = f.player.getInventory();
  const preset = new core.Item(core.ItemIdentifiers.BRONZE_ARROW, 50);
  preset.setMetaValue(core.Item.PRESET_META, true);
  inventory.add(preset, false);
  while (inventory.getFreeSlots() > 0) inventory.add(new core.Item(core.ItemIdentifiers.LOGS, 1), false);
  await talk(f);
  await f.choose("Sure, I'll give it a go.");
  assert.equal(inventory.getAmount(core.ItemIdentifiers.COINS), 1000, 'no fee taken');
  assert.equal(inventory.getAmount(core.ItemIdentifiers.BRONZE_ARROW), 50, 'only the preset stack');
  assert.equal(Session.sessionOf(f.player), null, 'no round started');
});

test('a full pack with a plain bronze arrow stack still starts a round', async (t) => {
  const f = harness(t);
  const inventory = f.player.getInventory();
  inventory.add(new core.Item(core.ItemIdentifiers.BRONZE_ARROW, 5), false);
  while (inventory.getFreeSlots() > 0) inventory.add(new core.Item(core.ItemIdentifiers.LOGS, 1), false);
  await talk(f);
  await f.choose("Sure, I'll give it a go.");
  assert.equal(inventory.getAmount(core.ItemIdentifiers.COINS), 800);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.BRONZE_ARROW), 15);
});
