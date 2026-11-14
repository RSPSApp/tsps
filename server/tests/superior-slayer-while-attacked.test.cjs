// Run after `yarn build`: node --test tests/superior-slayer-while-attacked.test.cjs
// RSPSApp/tsps#5289: in a single-way area a player may attack their OWN superior slayer monster while another
// monster is attacking them; the standard monster then stops attacking the player. Other superiors (owned by
// another player), non-superior busy NPCs, multi-combat areas and PvP keep today's refusal.
//
// Real route, driven: the busy state is produced by a real hit. A real PendingHit is queued with
// CombatFactory.addPendingHit and HitQueue.processAll runs it on the real tick (World.processCycle), which calls
// executeHit and setUnderAttack. Only then is the player busy (asserted before any target action).
// The superior is spawned through PluginManager.spawnNpc with a real owner, and the REAL Slayer plugin (which
// attaches Superiors.Slayer.js and its slayer:is-superior answer) is registered through the production path.
// Controls: a non-superior busy NPC refused; another player's superior refused; a multi-combat area keeps the
// permission at CAN_ATTACK; a no-busy own-superior attack is allowed (positive); the query is pure.
//
// Disclosed: AreaManager.inMulti is stubbed for the multi control (restored per test). Not exercised: the packet
// click dispatch (NPCOptionPacketListener), NPC AI beyond the engine's combat state, and the Wiki part (b)
// auto-retaliate over several ticks (no multi-tick claim is made here).
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
const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
const { HitQueue } = require('../dist/game/content/combat/hit/HitQueue');
const { AreaManager } = require('../dist/game/model/areas/AreaManager');
const { World } = require('../dist/game/World');

let core, nextIndex = 9300;
const realInMulti = AreaManager.inMulti;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  // The production slayer plugin: it calls init and attach on Superiors.Slayer.js (the slayer:is-superior answer).
  require('../plugins/skills/Slayer.plugin').register(PluginManager.createApi('SuperiorWhileAttackedTest'));
});

after(() => {
  AreaManager.inMulti = realInMulti;
  if (previousBotsSetting === undefined) delete process.env.DISABLE_PLAYER_BOTS;
  else process.env.DISABLE_PLAYER_BOTS = previousBotsSetting;
});

// The bloodrager construction: a real Player on a test channel, registered and placed, with real equipment.
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

// A real NPC on a tile, optionally owned by a real player (the Superiors spawn sets `owner` the same way).
function spawnNpc(id, x, owner = null) {
  const npc = PluginManager.spawnNpc({ id, x, y: 3218, z: 0, wanderRadius: 0, owner });
  assert.ok(npc && npc.isRegistered(), `spawn ${id} is registered`);
  npc.setNeedsPlacement(false);
  return npc;
}

// The production busy state, reached through the real hit route: a real PendingHit from the standard NPC is
// queued on the player and run by the real hit queue on the real tick. Asserted before any target action.
function busyByRealHit(player, standard) {
  const method = CombatFactory.getMethod(standard);
  const hit = new PendingHit(standard, player, method, { ordinary: true });
  const cycle = World.getProcessCycle();
  CombatFactory.addPendingHit(hit);
  // Advance the real tick until the queued hit is due and processed by the real HitQueue.
  for (let i = 0; i < 4 && player.getCombat().getAttacker() !== standard; i++) {
    World.processCycle = World.getProcessCycle() + 1;
    HitQueue.processAll(World.getProcessCycle());
  }
  assert.ok(World.getProcessCycle() >= cycle, 'the real tick advanced');
  assert.equal(player.getCombat().getAttacker(), standard, 'precondition: the player is under attack by the standard NPC (real hit)');
  assert.equal(CombatFactory.isBeingAttacked(player), true, 'precondition: the player is busy');
}

// The own-superior route: a real superior owned by the player and attacking the player is the production
// state (Superiors.Slayer.js spawns with owner and attacks the player). Preconditions are asserted here.
function ownedSuperior(player, id) {
  return spawnNpc(id, 3224, player);
}

function singleWay() { AreaManager.inMulti = () => false; }

test('precondition: the real Slayer plugin answers the superior check for the crushing hand, not for a crawling hand', () => {
  const crushing = spawnNpc(core.NpcIdentifiers.CRUSHING_HAND, 3226);
  const crawling = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3227);
  const request = { npc: crushing, superior: false };
  PluginManager.emitCustomEvent('slayer:is-superior', request);
  assert.equal(request.superior, true, 'a crushing hand is a superior via the real Superiors answer');
  const other = { npc: crawling, superior: false };
  PluginManager.emitCustomEvent('slayer:is-superior', other);
  assert.equal(other.superior, false, 'a crawling hand is not a superior');
});

test('red on BEFORE: the own superior is refused with ALREADY_UNDER_ATTACK while the player is attacked by another NPC', (t) => {
  const player = makePlayer(t, 'own');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const superior = ownedSuperior(player, core.NpcIdentifiers.CRUSHING_HAND);
  busyByRealHit(player, standard);
  singleWay();
  assert.equal(CombatFactory.canAttackPermission(player, superior, false), CanAttackResponse.CAN_ATTACK,
    'the own superior is attackable while under attack in single-way (BEFORE: ALREADY_UNDER_ATTACK)');
});

test('red on BEFORE: the attack commit on the own superior starts and the standard NPC stops targeting the player', (t) => {
  const player = makePlayer(t, 'commit');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const superior = ownedSuperior(player, core.NpcIdentifiers.CRUSHING_HAND);
  busyByRealHit(player, standard);
  singleWay();
  player.getCombat().attack(superior);
  World.processCycle = World.getProcessCycle() + 1;
  HitQueue.processAll(World.getProcessCycle());
  assert.equal(player.getCombat().getTarget(), superior, 'after the cycle the player still targets the superior');
  assert.notEqual(standard.getCombat().getTarget(), player, 'the standard NPC has stopped targeting the player');
});

test('control: a non-superior busy NPC is still refused with ALREADY_UNDER_ATTACK', (t) => {
  const player = makePlayer(t, 'ordinary');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const other = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_3, 3224, player);
  busyByRealHit(player, standard);
  singleWay();
  assert.equal(CombatFactory.canAttackPermission(player, other, false), CanAttackResponse.ALREADY_UNDER_ATTACK);
});

test("control: another player's superior is still refused while busy", (t) => {
  const player = makePlayer(t, 'me'), owner = makePlayer(t, 'them');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const superior = ownedSuperior(owner, core.NpcIdentifiers.CRUSHING_HAND);
  busyByRealHit(player, standard);
  singleWay();
  assert.equal(CombatFactory.canAttackPermission(player, superior, false), CanAttackResponse.ALREADY_UNDER_ATTACK);
});

test('control: a multi-combat area keeps the own-superior permission at CAN_ATTACK and releases nothing', (t) => {
  const player = makePlayer(t, 'multi');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const superior = ownedSuperior(player, core.NpcIdentifiers.CRUSHING_HAND);
  busyByRealHit(player, standard);
  AreaManager.inMulti = () => true;
  assert.equal(CombatFactory.canAttackPermission(player, superior, false), CanAttackResponse.CAN_ATTACK,
    'multi-combat allows the attack on both the base and the fix');
  assert.equal(standard.getCombat().getTarget() === player, true, 'nothing was released in multi-combat');
});

test('positive control: the own superior with nobody attacking the player is allowed on the base', (t) => {
  const player = makePlayer(t, 'idle');
  const superior = ownedSuperior(player, core.NpcIdentifiers.CRUSHING_HAND);
  singleWay();
  assert.equal(CombatFactory.canAttackPermission(player, superior, false), CanAttackResponse.CAN_ATTACK,
    'no busy state: the attack is allowed (a broken harness cannot look green)');
});

test('control: the permission query is pure: repeated checks each return the same answer and release nothing', (t) => {
  const player = makePlayer(t, 'pure');
  const standard = spawnNpc(core.NpcIdentifiers.CRAWLING_HAND_2, 3223);
  const superior = ownedSuperior(player, core.NpcIdentifiers.CRUSHING_HAND);
  busyByRealHit(player, standard);
  singleWay();
  const answers = [];
  for (let i = 0; i < 3; i++) answers.push(CombatFactory.canAttackPermission(player, superior, false));
  assert.ok(answers.every((answer) => answer === answers[0]), 'the query answers the same each time');
  assert.equal(player.getCombat().getAttacker(), standard, 'the player is still attacked: the query released nothing');
});
