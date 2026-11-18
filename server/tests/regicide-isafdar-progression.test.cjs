// Regicide: the Isafdar leg after King Lathas (stages 2-5), which stopped twice on live play.
// - Idris, Morvran and Essyllt are not world spawns; the quest owner-spawns Idris for a stage-2
//   player in Isafdar, and the transcript's Ru0gbO action brings Morvran and Essyllt (stage 3).
// - After Iorwerth (stage 4) the Elf Tracker asks for proof and refuses, which is stage 5
//   ("tracker refused") that Iorwerth's crystal pendant answers; nothing set it before.
// From server/: node --test tests/regicide-isafdar-progression.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const N = core.NpcIdentifiers;

const spawned = [];
const removed = [];

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  const fakes = {
    spawnNpc: (spec) => { const npc = { spec }; spawned.push(npc); return npc; },
    removeNpc: (npc) => { removed.push(npc); },
  };
  const real = PluginManager.createApi('regicide isafdar test');
  const api = new Proxy(real, { get: (target, key) => fakes[key] ?? target[key] });
  require('../plugins/quests/quests/Regicide.Quest.js')(api);
});

function regicide() {
  return getRegisteredQuests().find((quest) => quest.key === 'regicide');
}

function playerFixture(x, y) {
  const attributes = new Map();
  const sender = new Proxy({}, { get: (target, key) => (key === 'getVarbit' ? () => 0 : () => sender) });
  return {
    getUsername: () => 'regicide-test',
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getLocation: () => new core.Location(x, y, 0),
    getInventory: () => ({ getAmount: () => 0, contains: () => false }),
    getEquipment: () => ({ contains: () => false }),
    isPlayerBot: () => false,
    isRegistered: () => true,
    sendMessage() {},
  };
}

test('a stage-2 player in Isafdar meets Idris, and the scouts arrive when he is killed', () => {
  const quest = regicide();
  const player = playerFixture(2312, 3216);
  quest.setStage(player, 2);
  spawned.length = 0;
  PluginManager.emitPlayerLogin({ player, username: 'regicide-test' });
  assert.deepEqual(spawned.map((npc) => npc.spec.id), [N.IDRIS], 'Idris waits for the player');
  assert.equal(spawned[0].spec.owner, player);
  assert.equal(spawned[0].spec.ownerOnly, true);

  PluginManager.emitCustomEvent('npc-dialogue:action', { player, npcId: N.IDRIS, stepId: 'Ru0gbO', handled: false });
  assert.equal(quest.getStage(player), 3, 'meeting the scouts is stage 3');
  assert.ok(removed.includes(spawned[0]), 'Idris is killed');
  assert.deepEqual(spawned.slice(1).map((npc) => npc.spec.id).sort(), [N.ESSYLLT, N.MORVRAN].sort());
  PluginManager.emitPlayerLogout({ player, username: 'regicide-test' });
});

test('no scouts outside Isafdar or at other stages', () => {
  const quest = regicide();
  const away = playerFixture(2578, 3293);
  quest.setStage(away, 2);
  const later = playerFixture(2312, 3216);
  quest.setStage(later, 4);
  spawned.length = 0;
  PluginManager.emitPlayerLogin({ player: away, username: 'regicide-test' });
  PluginManager.emitPlayerLogin({ player: later, username: 'regicide-test' });
  assert.deepEqual(spawned.filter((npc) => [N.IDRIS, N.MORVRAN, N.ESSYLLT].includes(npc.spec.id)), []);
});

test('after Iorwerth, the Elf Tracker refuses without proof and that is stage 5', () => {
  const quest = regicide();
  const scouted = playerFixture(2257, 3150);
  quest.setStage(scouted, 3);
  assert.deepEqual(PluginManager.emitNpcDialogueVariant({ player: scouted, npcId: N.ELF_TRACKER }),
    { page: 'Regicide', variant: 'entering-isafdar-talking-to-the-elf-tracker-before-iorwerth' });

  const sent = playerFixture(2257, 3150);
  quest.setStage(sent, 4);
  assert.deepEqual(PluginManager.emitNpcDialogueVariant({ player: sent, npcId: N.ELF_TRACKER }),
    { page: 'Regicide', variant: 'tracking-tyras-camp-speaking-with-the-elf-tracker' });
  assert.equal(quest.getStage(sent), 5);
  assert.deepEqual(PluginManager.emitNpcDialogueVariant({ player: sent, npcId: N.LORD_IORWERTH }),
    { page: 'Regicide', variant: 'tracking-tyras-camp-speaking-with-lord-iorwerth-again' },
    'Iorwerth then hands over the crystal pendant');
});
