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
// Controls in this file: the Slayer precondition, a non-superior busy NPC (one refusal), another owner's superior
// (INVALID_TARGET), a multi-combat area, an idle positive swing, the pure query, a too-low Slayer level (no release),
// and another PLAYER attacking this player (refusal, no release). R3 tests assert the player stays in combat each tick;
// "no re-engagement" rests on the release and the single-way early return in NpcAggression.process, not on a tested
// aggression decision (the harness proof separately shows the real aggression pass hunts an idle player).
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
const { NpcAggression } = require('../dist/game/entity/impl/npc/NpcAggression');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');

let core, nextIndex = 9300;
const hitLog = [];
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
  // Every damage event, with the world cycle it happened in: the aggression tests assert that a released monster lands none.
  PluginManager.createApi('SuperiorHitWatch').onCombatHitDamage((event) => {
    hitLog.push({ attacker: event.attacker, target: event.target, cycle: World.getProcessCycle() });
  });
});

after(() => {
  AreaManager.inMulti = realInMulti;
  if (previousBotsSetting === undefined) delete process.env.DISABLE_PLAYER_BOTS;
  else process.env.DISABLE_PLAYER_BOTS = previousBotsSetting;
});

// A real Player (the bloodrager construction) with a recording packet sender, so the spam count is observable.
function makePlayer(t, label, { low = false, slayer = 99 } = {}) {
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
  // NPC.isAggressiveTo: a player's combat level must be at most twice the NPC's, so the aggression tests use a
  // low-level player (level 1 attack/strength/defence, 99 hitpoints: combat level 25); the rest keep the level-99 player.
  const level = low ? 1 : 99, hitpoints = 99;
  for (const skill of [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE]) {
    player.getSkillManager().setMaxLevel(skill, level); player.getSkillManager().setCurrentLevel(skill, level);
  }
  player.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, hitpoints);
  player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, hitpoints);
  player.getSkillManager().setMaxLevel(core.Skill.SLAYER, slayer);
  player.getSkillManager().setCurrentLevel(core.Skill.SLAYER, slayer);
  player.setHitpoints(hitpoints);
  const style = core.WeaponInterfaces.MACE;
  player.setWeapon(style); player.setFightType(style.getFightType()[0]);
  core.BonusManager.update(player);
  const spawned = [];
  t.after(() => {
    console.error = originalError;
    AreaManager.inMulti = realInMulti;
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

// One combat cycle for the given mobiles at the CURRENT world cycle: no tick, so hits already queued stay queued.
function cycleNow(...mobiles) {
  for (const mobile of mobiles) {
    mobile.getCombat().preMovementProcess();
    mobile.getCombat().postMovementProcess();
  }
}

const slayerLevelOf = (npc) => (npc.getCurrentDefinition?.() ?? npc.getDefinition()).getSlayerLevel();

// A real aggressive melee NPC from the cache (the first one in a small id range), chosen once; logged so the raw run
// shows which one it was. The aggression tests assert it really hunts (see the harness proof test).
let aggressiveId = null;
function aggressiveNpcId() {
  if (aggressiveId !== null) return aggressiveId;
  aggressiveId = -1;
  const limit = Math.min(3000, CacheDefinitions.getCounts().npcs);
  for (let id = 1; id < limit; id++) {
    const def = NpcDefinition.forId(id);
    if (!def || !def.isAggressive() || !def.isAttackable() || !def.doesFightBack() || def.getSize() !== 1) continue;
    const level = def.getCombatLevel();
    if (level < 15 || level > 40 || String(def.getName()).trim().length === 0) continue;
    aggressiveId = id;
    console.log(`# aggressive standard NPC: id=${id} name=${def.getName()} combatLevel=${level}`);
    break;
  }
  return aggressiveId;
}

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

test("control: another player's superior stays non-attackable (INVALID_TARGET) and no hit is queued, while the busy standard NPC is untouched", (t) => {
  const player = makePlayer(t, 'me'), owner = makePlayer(t, 'them');
  const standard = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_2, 3222, 3219);
  const superior = spawnNpc(owner, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, owner);
  standardAttacks(player, standard, t);
  singleWay();
  assert.equal(CombatFactory.canAttackPermission(player, superior, false), CanAttackResponse.INVALID_TARGET,
    'another owner\'s superior is refused by the ownership guard (CombatFactory.validTarget)');
  player.getCombat().attack(superior);
  for (let i = 0; i < 8; i++) tick(player);
  assert.equal(superior.getCombat().getHitQueue().hasPendingWork(), false, 'no hit is queued on another owner\'s superior');
  assert.equal(standard.getCombat().getTarget() === player || player.getCombat().getAttacker() === standard, true, 'the busy standard NPC is untouched');
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
  assert.equal(CombatFactory.canAttackPermission(player, superior, false), CanAttackResponse.CAN_ATTACK,
    'precondition: the idle player may attack the superior (Slayer level and policy satisfied)');
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

// ---- R1 / R2 / R3 (reviewer's findings on the first fix) ----

test("R2: the standard NPC's next hit is queued, not yet processed, at the click: the own superior attack starts with no refusal and swings", (t) => {
  const player = makePlayer(t, 'r2');
  const standard = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_2, 3222, 3219);
  const superior = spawnNpc(player, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, player);
  superior.getCombat().attack(player);
  standardAttacks(player, standard, t);
  singleWay();
  // The standard's NEXT hit is in flight: queued on the player and not processed (cycleNow does not tick the hit queue).
  CombatFactory.addPendingHit(new PendingHit(standard, player, CombatFactory.getMethod(standard), { ordinary: true }));
  assert.equal(player.getCombat().getHitQueue().isEmpty(superior), false, 'precondition: a hit from the standard NPC is queued on the player');
  player.getCombat().attack(superior);
  cycleNow(player);
  assert.equal(player.messages.filter((m) => m === SPAM).length, 0,
    'no "I\'m already under attack." refusal in the first cycle with the standard NPC\'s hit in flight (R2; BEFORE: one refusal)');
  for (let i = 0; i < 6; i++) tick(player, standard);
  assert.ok(superior.getCombat().getHitQueue().hasPendingWork() || superior.getHitpoints() < superior.getDefinition().getHitpoints(),
    'the player swings on the superior');
  assert.notEqual(standard.getCombat().getTarget(), player, 'the standard NPC stopped targeting the player at the first swing');
});

test("R4: the standard NPC's hit is in flight at the release and lands after it: the superior still attacks its owner (no TARGET_IN_COMBAT)", (t) => {
  const player = makePlayer(t, 'r4');
  const standard = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_2, 3222, 3219);
  const superior = spawnNpc(player, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, player);
  superior.getCombat().attack(player);
  standardAttacks(player, standard, t);
  singleWay();
  player.getCombat().attack(superior);
  // Advance the combat cycle without processing the hit queue, until the first swing releases the standard NPC.
  for (let i = 0; i < 12 && standard.getCombat().getTarget() === player; i++) {
    World.processCycle = World.getProcessCycle() + 1;
    cycleNow(player, standard);
  }
  assert.notEqual(standard.getCombat().getTarget(), player, 'precondition: the standard NPC was released at the first swing');
  // The standard NPC's hit that was swung before the release is in flight now: queued, not yet landed.
  CombatFactory.addPendingHit(new PendingHit(standard, player, CombatFactory.getMethod(standard), { ordinary: true }));
  // The in-flight hit lands: it re-tags the player with the released standard NPC (the defect's trigger).
  for (let i = 0; i < 6 && player.getCombat().getAttacker() !== standard; i++) tick(player, standard);
  assert.equal(player.getCombat().getAttacker(), standard, 'precondition: the landed in-flight hit re-tagged the player with the released standard NPC');
  // With the standard NPC no longer targeting the player, the superior must be able to attack its owner.
  const verdicts = [];
  for (let i = 0; i < 12; i++) {
    verdicts.push(CombatFactory.canAttackPermission(superior, player, false));
    tick(player, superior, standard);
  }
  assert.equal(verdicts.includes(CanAttackResponse.TARGET_IN_COMBAT), false,
    'the superior is not refused as busy after the released standard NPC\'s hit lands (BEFORE: TARGET_IN_COMBAT for the re-tag window)');
  assert.equal(superior.getCombat().getTarget(), player, 'the superior fights its owner');
});

test('R1 control: the own superior while the Slayer level is too low: the click is refused and the standard NPC is NOT released', (t) => {
  const player = makePlayer(t, 'r1', { slayer: 1 });
  const standard = spawnNpc(player, core.NpcIdentifiers.CRAWLING_HAND_2, 3222, 3219);
  const superior = spawnNpc(player, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, player);
  assert.ok(slayerLevelOf(superior) > 1, 'precondition: the crushing hand needs a Slayer level above 1');
  superior.getCombat().attack(player);
  standardAttacks(player, standard, t);
  singleWay();
  assert.notEqual(CombatFactory.canAttackPermission(player, superior, false), CanAttackResponse.CAN_ATTACK,
    'precondition: the Slayer level refuses the attack');
  player.getCombat().attack(superior);
  for (let i = 0; i < 8; i++) tick(player, standard);
  assert.equal(superior.getCombat().getHitQueue().hasPendingWork(), false, 'no swing at the superior');
  assert.equal(standard.getCombat().getTarget(), player, 'a refused click does not release the standard NPC (R1)');
});

test('harness proof (R3): a free aggressive NPC in range hunts an idle low-level player through the real NpcAggression.process', (t) => {
  const id = aggressiveNpcId();
  assert.ok(id > 0, 'precondition: an aggressive melee NPC (combat level 15-40) exists in the cache');
  const player = makePlayer(t, 'hunt', { low: true });
  const hunter = spawnNpc(player, id, 3222, 3219);
  player.getLocalNpcs().push(hunter);
  singleWay();
  assert.equal(CombatFactory.inCombat(player), false, 'precondition: the player is idle');
  assert.equal(hunter.isAggressiveTo(player), true, 'precondition: the NPC is aggressive to this player (combat level)');
  NpcAggression.process(player);
  assert.equal(hunter.getCombat().getTarget(), player, 'the real aggression pass makes the free hunter attack the idle player');
});

// The standard NPC is a real aggressive NPC in the player's local list; the own superior is spawned as production does
// (owned, attacking the player). After the click, run the real aggression pass and the combat cycles for several ticks.
function aggressionScenario(t, label, { previouslyHit, superiorTicks }) {
  const id = aggressiveNpcId();
  assert.ok(id > 0, 'precondition: an aggressive melee NPC exists in the cache');
  const player = makePlayer(t, label, { low: true });
  const standard = spawnNpc(player, id, 3222, 3219);
  const superior = spawnNpc(player, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, player);
  player.getLocalNpcs().push(standard, superior);
  superior.getCombat().attack(player);
  standardAttacks(player, standard, t);
  if (previouslyHit) standard.getCombat().setUnderAttack(player); // the player hit the standard NPC earlier
  singleWay();
  hitLog.length = 0;
  player.getCombat().attack(superior);
  const mobiles = superiorTicks ? [player, standard, superior] : [player, standard];
  let releasedAt = null, inCombatAtRelease = null;
  for (let i = 0; i < 12; i++) {
    // NpcAggression.process returns at once while the player is in combat (NpcAggression.ts:15); it is called here so
    // the real path runs, and "no re-engagement" rests on the release plus that single-way early return, not on a tested
    // aggression decision (see the harness proof for aggression itself).
    NpcAggression.process(player);
    tick(...mobiles);
    const cycle = World.getProcessCycle();
    assert.equal(CombatFactory.inCombat(player), true, `cycle ${cycle}: the player stays in combat with its own superior`);
    if (releasedAt === null) {
      if (standard.getCombat().getTarget() !== player) { releasedAt = cycle; inCombatAtRelease = CombatFactory.inCombat(player); }
    } else {
      assert.notEqual(standard.getCombat().getTarget(), player, `cycle ${cycle}: the released standard NPC has not re-targeted the player`);
    }
  }
  return { player, standard, superior, releasedAt, inCombatAtRelease };
}

test('R3: the standard NPC never hit by the player, the superior has not retaliated yet (the window): it neither re-targets nor lands a new hit', (t) => {
  // The in-flight window is a judgement: 4 ticks after the release, a hit from the released standard still counts as new.
  const r = aggressionScenario(t, 'r3a', { previouslyHit: false, superiorTicks: false });
  assert.notEqual(r.releasedAt, null, 'the standard NPC was released at the first real swing (BEFORE: never released)');
  assert.equal(r.inCombatAtRelease, true, 'in the window the player is in combat through its own target (the superior), so single-way aggression does not run');
  const late = hitLog.filter((h) => h.attacker === r.standard && h.target === r.player && h.cycle > r.releasedAt + 4);
  assert.equal(late.length, 0, 'no new hit from the released standard NPC after the in-flight window');
});

test('R3: the standard NPC the player had hit and the superior retaliating: it neither re-targets nor lands a new hit and auto-retaliation answers the superior', (t) => {
  const r = aggressionScenario(t, 'r3b', { previouslyHit: true, superiorTicks: true });
  assert.notEqual(r.releasedAt, null, 'the standard NPC was released at the first real swing (BEFORE: never released)');
  const late = hitLog.filter((h) => h.attacker === r.standard && h.target === r.player && h.cycle > r.releasedAt + 4);
  assert.equal(late.length, 0, 'no new hit from the released standard NPC after the in-flight window');
  assert.equal(r.player.getCombat().getTarget(), r.superior, 'the player is fighting the superior, not the standard NPC');
});

test('control (PvP): another PLAYER attacking this player keeps the busy rule: the own-superior click is refused, one message, no swing, and that player is NOT released', (t) => {
  const player = makePlayer(t, 'pvp-victim'), attacker = makePlayer(t, 'pvp-attacker');
  const superior = spawnNpc(player, core.NpcIdentifiers.CRUSHING_HAND, 3223, 3218, player);
  superior.getCombat().attack(player);
  // The other player's real hit lands on this player (the busy state is a player attacker, not a monster).
  attacker.getCombat().attack(player, true);
  CombatFactory.addPendingHit(new PendingHit(attacker, player, CombatFactory.getMethod(attacker), { ordinary: true }));
  // Only the hit queue runs here: the attacker's own combat cycle would run the area policy (player vs player is
  // CANT_ATTACK_IN_AREA outside the Wilderness) and clear its target. Its hit lands on this player through the queue.
  for (let i = 0; i < 6 && player.getCombat().getAttacker() !== attacker; i++) tick();
  assert.equal(player.getCombat().getAttacker(), attacker, 'precondition: the player is attacked by another PLAYER (real hit)');
  assert.equal(attacker.getCombat().getTarget(), player, 'precondition: the attacking player targets this player');
  singleWay();
  assert.equal(CombatFactory.canAttackPermission(player, superior, false), CanAttackResponse.ALREADY_UNDER_ATTACK,
    'precondition: the busy rule refuses the own superior while a player attacks this player');
  player.getCombat().attack(superior);
  for (let i = 0; i < 8; i++) tick(player);
  assert.equal(player.messages.filter((m) => m === SPAM).length, 1, 'exactly one refusal message (the busy rule is live for a player attacker)');
  assert.equal(superior.getCombat().getHitQueue().hasPendingWork(), false, 'no swing at the superior');
  assert.equal(player.getCombat().getAttacker(), attacker, 'the attacking player is NOT released or cleared');
  assert.equal(attacker.getCombat().getTarget(), player, 'the attacking player still targets this player');
});
