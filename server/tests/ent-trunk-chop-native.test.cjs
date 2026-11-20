// Run after `yarn build`: node --test tests/ent-trunk-chop-native.test.cjs
//
// Issue #4357: an Ent killed in the Woodcutting Guild dungeon becomes a trunk its killer can chop
// (Wiki: Ent). Every plugin loaded, a real Player, a real Ent killed through NPCDeathTask, and a
// native npc_option "Chop" on the trunk.
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
const { NPCDeathTask } = require('../dist/game/task/impl/NPCDeathTask');
const Diaries = require('../plugins/achievements/AchievementDiaries.plugin');

const ENT = 7234;
const WILDERNESS_ENT = 6594;
const TRUNK = 9474;
const AT = [1548, 9893, 0];
let core, next = 9900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function harness(t, axe) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername('entchop' + next); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.getSkillManager().setMaxLevel(core.Skill.WOODCUTTING, 99).setCurrentLevel(core.Skill.WOODCUTTING, 99);
  // The crystal axe needs 71 Woodcutting and 50 Agility (Wiki: Crystal axe).
  player.getSkillManager().setMaxLevel(core.Skill.AGILITY, 50).setCurrentLevel(core.Skill.AGILITY, 50);
  if (axe) player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(axe, 1));
  const c = new ClientConnection(channel); c.player = player;
  const messages = [];
  const original = player.sendMessage.bind(player);
  player.sendMessage = (message, ...rest) => { messages.push(String(message)); return original(message, ...rest); };
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const tick = () => { core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process(); core.TaskManager.process(); c.processTurnPackets(); };
  const send = async (packet) => { await c.dispatch([packet]); for (let i = 0; i < 4; i++) tick(); };
  return { player, messages, tick, send };
}

/** A real Ent beside the player, killed by them through the engine's death task. */
function killEnt(f, id = ENT) {
  const ent = PM.spawnNpc({ id, x: AT[0], y: AT[1], z: 0, wanderRadius: 0 });
  assert.ok(ent, 'the Ent spawned');
  ent.__skipDefaultRespawn = true;
  f.player.setLocation(new core.Location(AT[0] + 2, AT[1], 0)); f.player.needsPlacement = false;
  ent.getCombat().addDamage(f.player, ent.getMaxHitpoints()); ent.setHitpoints(0);
  const death = new NPCDeathTask(ent);
  core.TaskManager.submit(death);
  for (let i = 0; i < 12 && ent.getNpcTransformationId() !== TRUNK; i++) f.tick();
  return ent;
}

test('the killer chops the Ent trunk with a crystal axe', async (t) => {
  const f = harness(t, core.ItemIdentifiers.CRYSTAL_AXE);
  const ent = killEnt(f);
  assert.equal(ent.getNpcTransformationId(), TRUNK, 'it became a trunk');
  assert.equal(ent.getCurrentDefinition(f.player).getActions()[0], 'Chop');
  assert.equal(ent.isRegistered(), true, 'the trunk is still in the world');
  await f.send({ type: 'npc_option', index: ent.getIndex(), clickType: 1 });
  assert.ok(f.messages.includes('You swing your axe at the Ent trunk.'), JSON.stringify(f.messages));
  // Each success: 25 XP and noted logs (Wiki); a roll of 0 always succeeds.
  const xp = f.player.getSkillManager().getExperience(core.Skill.WOODCUTTING);
  t.mock.method(Math, 'random', () => 0);
  for (let i = 0; i < 6; i++) f.tick();
  assert.ok(f.player.getSkillManager().getExperience(core.Skill.WOODCUTTING) >= xp + 25, 'Woodcutting XP for a chop');
  assert.ok(f.messages.some((message) => message.startsWith('The ent carcass yields:')), JSON.stringify(f.messages));
});

// Wiki (Ent): "Completing the medium Wilderness Diary increases the chance of successfully chopping
// ents in the Wilderness by 15%". At level 1 with a bronze axe the chance is 13/256 (0.0508); x1.15
// is 0.0584, so a roll of 0.055 misses without the diary and lands with it.
const BETWEEN_ROLL = 0.055;

/** Chops a trunk at level 1 with a bronze axe, every roll BETWEEN_ROLL; true if a log came. */
async function chopsAtLowRoll(t, id, diaryDone) {
  const f = harness(t, core.ItemIdentifiers.BRONZE_AXE);
  f.player.getSkillManager().setMaxLevel(core.Skill.WOODCUTTING, 1).setCurrentLevel(core.Skill.WOODCUTTING, 1);
  if (diaryDone) Diaries._test.diaryCommand({ player: f.player, parts: ['diary', 'wilderness', 'medium', 'complete'] });
  const ent = killEnt(f, id);
  assert.equal(ent.getNpcTransformationId(), TRUNK, 'it became a trunk');
  // Mocked before the click: the send's own ticks already reach the first attempt.
  const mock = t.mock.method(Math, 'random', () => BETWEEN_ROLL);
  await f.send({ type: 'npc_option', index: ent.getIndex(), clickType: 1 });
  assert.ok(f.messages.includes('You swing your axe at the Ent trunk.'), JSON.stringify(f.messages));
  for (let i = 0; i < 6; i++) f.tick();
  mock.mock.restore();
  return f.messages.some((message) => message.startsWith('The ent carcass yields:'));
}

test('the medium Wilderness Diary makes a Wilderness Ent trunk chop land 15% more often', async (t) => {
  assert.equal(await chopsAtLowRoll(t, WILDERNESS_ENT, true), true);
});

test('without the medium Wilderness Diary the same roll misses on a Wilderness Ent trunk', async (t) => {
  assert.equal(await chopsAtLowRoll(t, WILDERNESS_ENT, false), false);
});

test('the Wilderness Diary does not help on a Woodcutting Guild Ent trunk', async (t) => {
  assert.equal(await chopsAtLowRoll(t, ENT, true), false);
});
