// Run after `yarn build`: node --test tests/npc-dialogue-jump-loops-native.test.cjs
//
// Wiki "same as above/below" jumps whose target was lost in the dump must not replay a line until the jump limit:
// every plugin loaded, a real Player, the NPCs' own spawns and native npc_option / dialogue_continue packets.
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

const NECROVARUS = { id: 2986, at: [3660, 3516] };
const LUMBRIDGE_GUIDE = { id: 306, at: [3238, 3220] };
const ENTRANCE_GUARDIAN = { id: 5978, at: [3363, 3304] };
let core, next = 9700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  for (const { at } of [NECROVARUS, LUMBRIDGE_GUIDE, ENTRANCE_GUARDIAN]) core.RegionManager.loadMapFiles(at[0], at[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function npcOf(id, at) {
  return [...core.World.getNpcs()].find((npc) => npc && npc.getId() === id)
    ?? PM.spawnNpc({ id, x: at[0], y: at[1], z: 0, wanderRadius: 0 });
}

function harness(t, npc) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername('jumper' + next); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  const at = npc.getLocation();
  player.setLocation(new core.Location(at.getX() + 1, at.getY(), at.getZ())); player.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = player;
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const tick = () => { core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process(); core.TaskManager.process(); c.processTurnPackets(); };
  const send = async (packet) => { await c.dispatch([packet]); for (let i = 0; i < 3; i++) tick(); };
  const group = () => player.getPacketSender().getChatboxGroupId();
  const text = () => player.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g, ' ');
  const said = [];
  async function menu() {
    for (let i = 0; i < 40; i++) {
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
  async function talk() {
    const op = npc.getCurrentDefinition(player).getActions().findIndex((action) => action === 'Talk-to') + 1;
    await send({ type: 'npc_option', index: npc.getIndex(), clickType: op });
  }
  const count = (line) => said.filter((entry) => entry === line).length;
  return { player, said, menu, choose, talk, count };
}

// Transcript:Necrovarus: "What happened to everyone here?" and "How do I get into the town?" are each the player's
// line, then {{tact|above}}. The second used to land on the first (its line, then only a jump), whose jump was
// skipped in turn, so "What happened to everyone here?" was said until the jump limit.
test('Necrovarus: "How do I get into the town?" is said once and answered, with no repeated line', async (t) => {
  const necrovarus = npcOf(NECROVARUS.id, NECROVARUS.at);
  const f = harness(t, necrovarus);
  f.player.getEquipment().set(core.Equipment.AMULET_SLOT, new core.Item(core.ItemIdentifiers.GHOSTSPEAK_AMULET, 1));
  await f.talk();
  await f.choose('How do I get into the town?');
  await f.menu();
  assert.equal(f.count('How do I get into the town?'), 1, JSON.stringify(f.said));
  assert.equal(f.count('What happened to everyone here?'), 0, JSON.stringify(f.said));
  assert.ok(f.said.length >= 2 && f.said.length <= 4, `an answer follows: ${JSON.stringify(f.said)}`);
});

// Transcript:Lumbridge Guide: "Yes, but what should I fight once I have got a weapon?" is the last option of its menu,
// its line then {{tact|below}}. Nothing is below it, and the fallback (the last option recorded) was the option itself.
test('Lumbridge Guide: the last option\'s "same as below" does not replay its own line', async (t) => {
  const guide = npcOf(LUMBRIDGE_GUIDE.id, LUMBRIDGE_GUIDE.at);
  const f = harness(t, guide);
  await f.talk();
  await f.choose('What monsters should I fight?');
  await f.choose('Yes, but what should I fight once I have got a weapon?');
  await f.menu();
  assert.equal(f.count('Yes, but what should I fight once I have got a weapon?'), 1, JSON.stringify(f.said));
});

// Transcript:Entrance Guardian: the jump's similar-text pick opens with the line the player has just said.
test('Entrance Guardian: "Can you explain the different portals?" is said once before the answer', async (t) => {
  const guardian = npcOf(ENTRANCE_GUARDIAN.id, ENTRANCE_GUARDIAN.at);
  const f = harness(t, guardian);
  f.player.setAttribute(require('../plugins/minigames/magetrainingarena/Common.MageTrainingArena').HAT_GIVEN_ATTRIBUTE, true);
  await f.talk();
  await f.choose('Can you explain the different portals?');
  await f.menu();
  assert.equal(f.count('Can you explain the different portals?'), 1, JSON.stringify(f.said));
  assert.ok(f.said.some((line) => line.startsWith('They lead to four areas to train your magic')), JSON.stringify(f.said));
});
