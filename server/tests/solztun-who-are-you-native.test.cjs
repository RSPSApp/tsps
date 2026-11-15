// Run after `yarn build`: node --test tests/solztun-who-are-you-native.test.cjs
//
// Wiki (Transcript:Solztun), "Who are you?": "If speaking for the first time:" he introduces himself; "If speaking
// again:" he says "As I said, I am Solztun...". Every plugin loaded, a real Player, Solztun (7673) and native
// npc_option / dialogue_continue packets. The asked-before flag is saved.
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
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');

const SOLZTUN = 7673;
const AT = [1863, 5243, 0];
let core, solztun, next = 9760;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
  solztun = [...core.World.getNpcs()].find((npc) => npc && npc.getId() === SOLZTUN)
    ?? PM.spawnNpc({ id: SOLZTUN, x: AT[0], y: AT[1], z: 0, wanderRadius: 0 });
});
after(() => PM.emitServerShutdown({}));

function harness(t, coins) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername('solztun' + next); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.getSkillManager().setMaxLevel(core.Skill.HUNTER, 43).setCurrentLevel(core.Skill.HUNTER, 43);
  if (coins) player.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, coins), false);
  const at = solztun.getLocation();
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
    await send({ type: 'npc_option', index: solztun.getIndex(), clickType: option });
  }
  const op = (name) => solztun.getCurrentDefinition(player).getActions().findIndex((action) => action === name) + 1;
  return { player, said, chat, menu, choose, talk, op };
}

const FIRST = 'I am Solztun, the greatest barbarian explorer!';
const AGAIN = 'As I said, I am Solztun, the greatest barbarian explorer! I came to explore this place, but unfortunately I died long before I made it to the treasure.';

async function askWhoHeIs(f) {
  await f.talk(f.op('Talk-to'));
  await f.choose('Who are you?');
  await f.menu();
}

test('"Who are you?" introduces him the first time, then "As I said..." from then on, across a save', async (t) => {
  const f = harness(t, 0);
  await askWhoHeIs(f);
  assert.ok(f.said.includes(FIRST), JSON.stringify(f.said));
  assert.ok(!f.said.includes(AGAIN));
  assert.equal(f.player.getAttribute('stronghold-of-security:solztun-met'), true);
  const save = PlayerSave.fromPlayer(f.player);
  assert.equal(save.attributes['stronghold-of-security:solztun-met'], true, 'saved');

  const again = harness(t, 0);
  save.applyToPlayer(again.player);
  await askWhoHeIs(again);
  assert.ok(again.said.includes(AGAIN), JSON.stringify(again.said));
  assert.ok(!again.said.includes(FIRST));
});

test('opening the conversation without asking "Who are you?" leaves him unintroduced', async (t) => {
  const f = harness(t, 0);
  await f.talk(f.op('Talk-to'));
  const options = await f.menu();
  assert.ok(options?.includes('Who are you?'), JSON.stringify(options));
  assert.notEqual(f.player.getAttribute('stronghold-of-security:solztun-met'), true);
});
