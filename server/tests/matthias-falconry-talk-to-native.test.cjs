// Run after `yarn build`: node --test tests/matthias-falconry-talk-to-native.test.cjs
//
// Talk-to "could I have a go?" lends a falcon (Wiki: Falconry, 500 coins, or free once invested), through
// Matthias's real transcript: every plugin loaded, a real Player, his spawn (1340) and native
// npc_option / dialogue_continue packets.
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

const MATTHIAS = 1340;
const AT = [2376, 3606, 0];
const INVEST = 'Could I invest in your setup here?';
let core, matthias, next = 9660;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
  matthias = [...core.World.getNpcs()].find((npc) => npc && npc.getId() === MATTHIAS)
    ?? PM.spawnNpc({ id: MATTHIAS, x: AT[0], y: AT[1], z: 0, wanderRadius: 0 });
});
after(() => PM.emitServerShutdown({}));

function harness(t, coins) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername('falconer' + next); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.getSkillManager().setMaxLevel(core.Skill.HUNTER, 43).setCurrentLevel(core.Skill.HUNTER, 43);
  if (coins) player.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, coins), false);
  const at = matthias.getLocation();
  player.setLocation(new core.Location(at.getX() + 1, at.getY(), 0)); player.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = player;
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const tick = () => { core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process(); core.TaskManager.process(); c.processTurnPackets(); };
  const send = async (packet) => { await c.dispatch([packet]); for (let i = 0; i < 3; i++) tick(); };
  const group = () => player.getPacketSender().getChatboxGroupId();
  const text = () => player.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g, ' ');
  const said = [], chat = [];
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = (message, ...rest) => { chat.push(String(message)); return sendMessage(message, ...rest); };
  async function menu() {
    for (let i = 0; i < 30; i++) {
      const current = player.getDialogueManager().getCurrent();
      if (typeof current?.getOptions === 'function') return current.getOptions();
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending) return pending.options;
      if (!player.getDialogueManager().isActive()) return null;
      if (text()) said.push(text());
      await send({ type: 'dialogue_continue', widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
    }
    return null;
  }
  async function choose(option) {
    const options = await menu();
    assert.ok(options?.includes(option), `${option} in ${JSON.stringify(options)}`);
    await send({ type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: options.indexOf(option) + 1 });
  }
  async function talk(option) {
    await send({ type: 'npc_option', index: matthias.getIndex(), clickType: option });
  }
  const op = (name) => matthias.getCurrentDefinition(player).getActions().findIndex((action) => action === name) + 1;
  return { player, said, chat, menu, choose, talk, op };
}

const GO = 'That sounds like fun; could I have a go?';
const weapon = (player) => player.getEquipment().get(core.Equipment.WEAPON_SLOT).getId();

test('Talk-to "could I have a go?" then "Ok" takes 500 coins and lends a falcon', async (t) => {
  const f = harness(t, 1000);
  await f.talk(f.op('Talk-to'));
  await f.choose('What is this place?');
  await f.choose(GO);
  await f.choose('Ok, that seems reasonable.');
  await f.menu();
  assert.ok(f.chat.some((line) => line.startsWith("The falconer gives you a large leather glove")), JSON.stringify(f.chat));
  assert.equal(weapon(f.player), core.ItemIdentifiers.FALCONERS_GLOVE_2, 'a falcon lent');
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 500, 'the 500-coin fee taken once');
});

test('an investor asking for a go is lent a falcon free', async (t) => {
  const f = harness(t, 1000);
  f.player.setAttribute('hunter:falconry-invested', true);
  await f.talk(f.op('Talk-to'));
  await f.choose('What is this place?');
  await f.choose(GO);
  await f.menu();
  assert.ok(f.said.includes('Absolutely, are you ready?'), JSON.stringify(f.said));
  assert.equal(weapon(f.player), core.ItemIdentifiers.FALCONERS_GLOVE_2, 'a falcon lent');
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 1000, 'no fee');
});

test('a wielded weapon is put away first, and under 43 Hunter he lends none; neither pays', async (t) => {
  const armed = harness(t, 1000);
  armed.player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.BRONZE_DAGGER, 1));
  await armed.talk(armed.op('Talk-to'));
  await armed.choose('What is this place?');
  await armed.choose(GO);
  await armed.choose('Ok, that seems reasonable.');
  await armed.menu();
  assert.ok(armed.said.some((line) => line.startsWith('Good, however you really need both hands free.')), JSON.stringify(armed.said));
  assert.equal(weapon(armed.player), core.ItemIdentifiers.BRONZE_DAGGER);
  assert.equal(armed.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 1000);

  const novice = harness(t, 1000);
  novice.player.getSkillManager().setMaxLevel(core.Skill.HUNTER, 42).setCurrentLevel(core.Skill.HUNTER, 42);
  await novice.talk(novice.op('Talk-to'));
  await novice.choose('What is this place?');
  await novice.choose(GO);
  await novice.menu();
  assert.ok(novice.said.some((line) => line.startsWith("I'm sorry, but training falcons is a lot of work")), JSON.stringify(novice.said));
  assert.equal(weapon(novice.player), -1);
  assert.equal(novice.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 1000);
});
