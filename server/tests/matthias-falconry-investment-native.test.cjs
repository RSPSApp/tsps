// Run after `yarn build`: node --test tests/matthias-falconry-investment-native.test.cjs
//
// Issue #4733 (Wiki: Falconry, a one-time 500,000-coin investment lends falcons free), through
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
  const said = [];
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
  return { player, said, menu, choose, talk, op };
}

test('500,000 coins invest once, and Quick-falcon then lends falcons free', async (t) => {
  const f = harness(t, 500000 + 1000);
  await f.talk(f.op('Talk-to'));
  await f.choose(INVEST);
  await f.choose('Yes');
  await f.menu();
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 1000, 'the investment taken');
  assert.equal(f.player.getAttribute('hunter:falconry-invested'), true);

  f.player.getPacketSender().sendInterfaceRemoval();
  await f.talk(f.op('Quick-falcon'));
  assert.equal(f.player.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(), core.ItemIdentifiers.FALCONERS_GLOVE_2, 'a falcon lent');
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 1000, 'no 500-coin fee');
});

test('without 500,000 coins he is told no, and an investor is told no more is needed', async (t) => {
  const poor = harness(t, 1000);
  await poor.talk(poor.op('Talk-to'));
  await poor.choose(INVEST);
  await poor.menu();
  assert.ok(poor.said.includes("Ah, I don't have that much on me right now."), JSON.stringify(poor.said));
  assert.equal(poor.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 1000);

  const investor = harness(t, 0);
  investor.player.setAttribute('hunter:falconry-invested', true);
  await investor.talk(investor.op('Talk-to'));
  await investor.choose(INVEST);
  await investor.menu();
  assert.ok(investor.said.includes("I appreciate that you want to invest more, but I really don't need it right now!"), JSON.stringify(investor.said));
});
