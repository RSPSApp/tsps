// Run after `yarn build`: node --test tests/superior-slayer-while-attacked.test.cjs
// RSPSApp/tsps#5289: in a single-way area a player may attack their OWN superior slayer monster while another
// monster is attacking them; the standard monster then stops attacking the player. Other superiors (owned by
// another player), non-superior busy NPCs, multi-combat areas and PvP keep today's refusal.
//
// Harness: real Player (bloodrager construction), real NPCs spawned through PluginManager.spawnNpc, the REAL
// slayer:is-superior answer (Superiors.Slayer.js, by cache name), the real CombatFactory.canAttackPermission and
// the real Combat.attack commit path. Disclosed: AreaManager.inMulti is stubbed for the multi control only; the
// superior is spawned with a real owner through spawnNpc's owner field.
// Not exercised: the packet/menu dispatch of the attack click, NPC AI beyond the engine's own combat state.
const previousBotsSetting = process.env.DISABLE_PLAYER_BOTS;
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { CombatFactory, CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
const { AreaManager } = require('../dist/game/model/areas/AreaManager');
const { TaskManager } = require('../dist/game/task/TaskManager');

let core, nextIndex = 9300;
const realInMulti = AreaManager.inMulti;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
});

after(() => {
  AreaManager.inMulti = realInMulti;
  if (previousBotsSetting === undefined) delete process.env.DISABLE_PLAYER_BOTS;
  else process.env.DISABLE_PLAYER_BOTS = previousBotsSetting;
});

// The bloodrager construction: a real Player on a test channel, registered, placed, with real equipment.
function makePlayer(t, label) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const errors = [], originalError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError.apply(console, args); };
  t.after(() => { console.error = originalError; assert.deepEqual(errors, [], `${label}: no swallowed errors`); });
  player.setIndex(nextIndex++); player.setUsername(label + player.getIndex());
  player.setRights(core.PlayerRights.NONE);
  player.setRegistered(true); player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(3222, 3218, 0)); player.setNeedsPlacement(false);
  for (const skill of [core.Skill.HITPOINTS, core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE]) {
    player.getSkillManager().setMaxLevel(skill, 99); player.getSkillManager().setCurrentLevel(skill, 99);
  }
  player.setHitpoints(99);
  const style = core.WeaponInterfaces.MACE;
  player.setWeapon(style); player.setFightType(style.getFightType()[0]);
  core.BonusManager.update(player);
  return player;
}

// A real NPC, spawned on the player's tile, optionally owned by a real player (the superior's owner field).
function spawnNpc(id, x, owner = null) {
  const npc = PluginManager.spawnNpc({ id, x, y: 3218, z: 0, wanderRadius: 0, owner });
  assert.ok(npc && npc.isRegistered(), `spawn ${id} is registered`);
  npc.setNeedsPlacement(false);
  return npc;
}

// The busy precondition, through the real route: the standard NPC engages the player (the engine's own
// attack state), then the player is asserted busy before any target action.
function engagedBy(player, npc) {
  npc.getCombat().attack(player, true);
  assert.equal(player.getCombat().getAttacker(), npc, 'precondition: the player is under attack by the standard NPC');
  assert.equal(CombatFactory.isBeingAttacked(player), true, 'precondition: the player is busy');
}

test('red on BEFORE: the own superior is refused with ALREADY_UNDER_ATTACK while the player is attacked by another NPC', (t) => {
  const player = makePlayer(t, 'own');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const superior = spawnNpc(core.NpcIdentifiers.CRUSHING_HAND, 3224, player);
  engagedBy(player, standard);
  AreaManager.inMulti = () => false;
  assert.equal(CombatFactory.canAttackPermission(player, superior, false),
    CanAttackResponse.CAN_ATTACK, 'the own superior is attackable while under attack in single-way (BEFORE: ALREADY_UNDER_ATTACK)');
});

test('red on BEFORE: the commit starts the attack on the own superior and the standard NPC stops targeting the player', (t) => {
  const player = makePlayer(t, 'commit');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const superior = spawnNpc(core.NpcIdentifiers.CRUSHING_HAND, 3224, player);
  engagedBy(player, standard);
  AreaManager.inMulti = () => false;
  player.getCombat().attack(superior);
  assert.equal(player.getCombat().getTarget(), superior, 'the player now targets the superior');
  assert.notEqual(standard.getCombat().getTarget(), player, 'the standard NPC has stopped targeting the player');
  player.getCombat().attack(superior); // idempotent: a second commit releases nothing further
  assert.equal(player.getCombat().getTarget(), superior);
});

test('control: a non-superior busy NPC is still refused with ALREADY_UNDER_ATTACK', (t) => {
  const player = makePlayer(t, 'ordinary');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const other = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_3, 3224, player);
  engagedBy(player, standard);
  AreaManager.inMulti = () => false;
  assert.equal(CombatFactory.canAttackPermission(player, other, false), CanAttackResponse.ALREADY_UNDER_ATTACK);
});

test("control: another player's superior is still refused while busy", (t) => {
  const player = makePlayer(t, 'me'), owner = makePlayer(t, 'them');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const superior = spawnNpc(core.NpcIdentifiers.CRUSHING_HAND, 3224, owner);
  engagedBy(player, standard);
  AreaManager.inMulti = () => false;
  assert.equal(CombatFactory.canAttackPermission(player, superior, false), CanAttackResponse.ALREADY_UNDER_ATTACK);
});

test('control: a multi-combat area keeps today\'s path (no release of the standard NPC)', (t) => {
  const player = makePlayer(t, 'multi');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const superior = spawnNpc(core.NpcIdentifiers.CRUSHING_HAND, 3224, player);
  engagedBy(player, standard);
  AreaManager.inMulti = () => true;
  CombatFactory.canAttackPermission(player, superior, false);
  assert.equal(standard.getCombat().getTarget() === player, true, 'no release in multi-combat');
});

test('control: a query is pure: repeated permission checks release nothing', (t) => {
  const player = makePlayer(t, 'pure');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const superior = spawnNpc(core.NpcIdentifiers.CRUSHING_HAND, 3224, player);
  engagedBy(player, standard);
  AreaManager.inMulti = () => false;
  for (let i = 0; i < 3; i++) CombatFactory.canAttackPermission(player, superior, false);
  assert.equal(player.getCombat().getAttacker(), standard, 'the player is still attacked: the query released nothing');
});
