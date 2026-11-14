// Run after `yarn build`: node --test tests/superior-slayer-while-attacked.test.cjs
// RSPSApp/tsps#5289: in a single-way area a player may attack their OWN superior slayer monster while another
// monster is attacking them; the standard monster then stops attacking the player. Other superiors (owned by
// another player), non-superior busy NPCs, multi-combat areas and PvP keep today's refusal.
//
// Production state reproduced: the standard NPC attacks the player (a real hit lands through the real hit queue,
// setting the player's attacker), and the own superior is spawned owned by the player and attacks the player
// (Superiors.Slayer.js spawnForTask: owner set, then superior.getCombat().attack(player)). The player then clicks
// the superior: player.getCombat().attack(superior), and the REAL combat cycle runs for several ticks
// (Combat.preMovementProcess / postMovementProcess via World.processCycle).
//
// Outcomes asserted (not permission values): the refusal message "I'm already under attack." count on a recording
// packet sender; whether a hit is queued/dealt on the superior; the standard NPC's target. The permission query
// is also asserted pure.
//
// Disclosed: AreaManager.inMulti is stubbed per test and restored in t.after. Not exercised: the packet click
// dispatch (NPCOptionPacketListener), NPC AI beyond the engine's combat state.
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
const { TaskManager } = require('../dist/game/task/TaskManager');
const { World } = require('../dist/game/World');

let core, nextIndex = 9300;
const realInMulti = AreaManager.inMulti;
const SPAM = "I'm already under attack.";

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  // The production slayer plugin: init and attach on each unit, including Superiors.Slayer.js (slayer:is-superior).
  require('../plugins/skills/Slayer.plugin').register(PluginManager.createApi('SuperiorWhileAttackedTest'));
});

after(() => {
  AreaManager.inMulti = realInMulti;
  if (previousBotsSetting === undefined) delete process.env.DISABLE_PLAYER_BOTS;
  else process.env.DISABLE_PLAYER_BOTS = previousBotsSetting;
});

// A real Player (the bloodrager construction) with a recording packet sender, so the spam count is observable.
function makePlayer(t, label) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const messages = [];
  const sender = player.getPacketSender();
  const realTyped = sender.sendTypedMessage.bind(sender);
  sender.sendTypedMessage = (type, text) => { messages.push(text); return realTyped(type, text); };
  const errors = [], originalError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError.apply(console, args); };
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
  const spawned = [];
  t.after(() => {
    console.error = originalError;
    for (const npc of spawned) { npc.getCombat().getHitQueue().clear(); PluginManager.removeNpc(npc); }
    TaskManager.cancelTasks(player.getIndex());
    player.setRegistered(false);
    assert.deepEqual(errors, [], `${label}: no swallowed errors`);
  });
  player.messages = messages;
  player.spawned = spawned;
  return player;
}

function spawnNpc(player, id, x, y, owner = null) {
  const npc = PluginManager.spawnNpc({ id, x, y, z: 0, wanderRadius: 0, owner });
  assert.ok(npc && npc.isRegistered(), `spawn ${id} is registered`);
  npc.setNeedsPlacement(false);
  player.spawned.push(npc);
  return npc;
}

// The real tick: advances World.processCycle and runs the real hit queue, then the real combat cycle for the
// mobiles that have a target (Combat.preMovementProcess / postMovementProcess).
function tick(...mobiles) {
  World.processCycle = World.getProcessCycle() + 1;
  HitQueue.processAll(World.getProcessCycle());
  for (const mobile of mobiles) {
    mobile.getCombat().preMovementProcess();
    mobile.getCombat().postMovementProcess();
  }
}

// The standard NPC attacks the player and a real hit lands (setUnderAttack on the player).
function standardAttacks(player, standard, t) {
  const method = CombatFactory.getMethod(standard);
  standard.getCombat().attack(player, true);
  // A real hit delivers the busy state: queued through addPendingHit, run by the real hit queue.
  CombatFactory.addPendingHit(new PendingHit(standard, player, method, { ordinary: true }));
  for (let i = 0; i < 6 && player.getCombat().getAttacker() !== standard; i++) tick(standard);
  assert.equal(player.getCombat().getAttacker(), standard, 'precondition: the player is under attack by the standard NPC (real hit)');
  assert.equal(CombatFactory.isBeingAttacked(player), true, 'precondition: the player is busy');
}

function singleWay() { AreaManager.inMulti = () => false; }

test('precondition: the real Slayer plugin answers the superior check: crushing hand yes, crawling hand no', (t) => {
  const player = makePlayer(t, 'answer');
  const crushing = spawnNpc(player, core.NpcIdentifiers.CRUSHING_HAND, 3226, 3218);
  const crawling = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_2, 3227, 3218);
  const request = { npc: crushing, superior: false };
  PluginManager.emitCustomEvent('slayer:is-superior', request);
  assert.equal(request.superior, true, 'a crushing hand is a superior through the real Superiors answer');
  const other = { npc: crawling, superior: false };
  PluginManager.emitCustomEvent('slayer:is-superior', other);
  assert.equal(other.superior, false, 'a crawling hand is not a superior');
});

test('red on BEFORE: the player clicks their own superior while attacked; the attack starts and lands (not refused)', (t) => {
  const player = makePlayer(t, 'own');
  const standard = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_2, 3222, 3219);
  const superior = spawnNpc(player, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, player);
  // Production spawn state (Superiors.Slayer.js): owned by the player, and the superior attacks the player.
  superior.getCombat().attack(player);
  standardAttacks(player, standard, t);
  singleWay();
  const superiorHpBefore = superior.getHitpoints();
  player.getCombat().attack(superior);
  for (let i = 0; i < 8; i++) tick(player, standard);
  assert.equal(player.messages.filter((m) => m === SPAM).length, 0, 'no "I\'m already under attack." refusal for the own superior (BEFORE: one refusal)');
  assert.equal(player.getCombat().getTarget(), superior, 'the player keeps the superior as target');
  assert.ok(superior.getHitpoints() < superiorHpBefore || superior.getCombat().getHitQueue().hasPendingWork(),
    'the player swings: a hit is dealt or queued on the superior (BEFORE: none)');
  assert.notEqual(standard.getCombat().getTarget(), player, 'the standard NPC has stopped targeting the player');
});

test('control: a non-superior busy NPC: the refusal message is shown and no player hit is queued on it', (t) => {
  const player = makePlayer(t, 'ordinary');
  const standard = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_2, 3222, 3219);
  const other = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_3, 3223, 3218, player);
  standardAttacks(player, standard, t);
  singleWay();
  player.getCombat().attack(other);
  for (let i = 0; i < 8; i++) tick(player);
  assert.equal(player.messages.filter((m) => m === SPAM).length, 1, 'exactly one refusal message (the busy rule is live)');
  assert.equal(other.getCombat().getHitQueue().hasPendingWork(), false, 'no hit is queued on the non-superior');
});

test("control: another player's superior: the refusal message is shown and no player hit is queued on it", (t) => {
  const player = makePlayer(t, 'me'), owner = makePlayer(t, 'them');
  const standard = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_2, 3222, 3219);
  const superior = spawnNpc(owner, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, owner);
  standardAttacks(player, standard, t);
  singleWay();
  player.getCombat().attack(superior);
  for (let i = 0; i < 8; i++) tick(player);
  assert.equal(player.messages.filter((m) => m === SPAM).length, 1, 'exactly one refusal message for another owner\'s superior');
  assert.equal(superior.getCombat().getHitQueue().hasPendingWork(), false, 'no hit is queued on another owner\'s superior');
});

test('control: a multi-combat area keeps the own-superior permission at CAN_ATTACK and releases nothing', (t) => {
  const player = makePlayer(t, 'multi');
  const standard = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_2, 3222, 3219);
  const superior = spawnNpc(player, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, player);
  standardAttacks(player, standard, t);
  AreaManager.inMulti = () => true;
  assert.equal(CombatFactory.canAttackPermission(player, superior, false), CanAttackResponse.CAN_ATTACK,
    'multi-combat allows the attack on both the base and the fix');
  assert.equal(standard.getCombat().getTarget() === player, true, 'nothing was released in multi-combat');
});

test('positive control: the own superior with nobody attacking the player is attacked and hit on the base', (t) => {
  const player = makePlayer(t, 'idle');
  const superior = spawnNpc(player, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, player);
  singleWay();
  const hpBefore = superior.getHitpoints();
  player.getCombat().attack(superior);
  for (let i = 0; i < 8; i++) tick(player);
  assert.equal(player.messages.filter((m) => m === SPAM).length, 0, 'no refusal when nothing is attacking the player');
  assert.ok(superior.getHitpoints() < hpBefore || superior.getCombat().getHitQueue().hasPendingWork(),
    'the idle player swings on the superior: a hit is dealt or queued (proves the harness can swing)');
});

test('control: the permission query is pure: repeated checks return the same answer and release nothing', (t) => {
  const player = makePlayer(t, 'pure');
  const standard = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_2, 3222, 3219);
  const superior = spawnNpc(player, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, player);
  standardAttacks(player, standard, t);
  singleWay();
  const answers = [];
  for (let i = 0; i < 3; i++) answers.push(CombatFactory.canAttackPermission(player, superior, false));
  assert.ok(answers.every((answer) => answer === answers[0]), 'the query answers the same each time');
  assert.equal(player.getCombat().getAttacker(), standard, 'the player is still attacked: the query released nothing');
});
