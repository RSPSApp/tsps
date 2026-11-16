// Run after `yarn build`: node --test tests/soulflame-horn-pvp-roll.test.cjs
//
// Wiki (Soulflame horn): against a player, Entice is "a 50% accuracy increase" on the next melee attack,
// and only the affected accuracy roll. Claws keep their first check ordinary and affect their second;
// applying the PvP replacement to that same second check is inferred from the adjacent Wiki rules.
// Real plugins, real Players/NPCs and real PendingHits exercise both branches and the roll cache.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { World } = require("../dist/game/World");
const { TaskManager } = require("../dist/game/task/TaskManager");

let core;
let cycle = 5000;
const processCycle = World.getProcessCycle;
let watchedAttacker;
let broadRolls = 0;
let broadDamage = 0;
let replacementSpecial;
before(async () => {
  World.getProcessCycle = () => cycle;
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  // Real production registration/startup without unrelated admin servers or persistence services.
  for (const file of ["items/ItemDefinitionLoader", "combat/SpecialAttacks", "combat/EquipmentEffects"]) {
    const plugin = require(`../plugins/${file}.plugin`);
    plugin.register(PM.createApi(plugin.name));
  }
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  const probe = PM.createApi("SoulflameBranchProbe");
  probe.onCombatHitRoll(({ attacker }) => { if (attacker === watchedAttacker) broadRolls++; });
  probe.onCombatHitDamage(({ attacker }) => { if (attacker === watchedAttacker) broadDamage++; });
  probe.onCombatHitPrepare(({ attacker }) => {
    if (attacker !== watchedAttacker || !replacementSpecial) return;
    attacker.setCombatSpecial(replacementSpecial);
    replacementSpecial = undefined;
  });
});
after(() => {
  World.getProcessCycle = processCycle;
  PM.emitServerShutdown({});
});

function player(name, x) {
  const p = new Player(new BotPlayerSession());
  p.setUsername(name);
  p.isRegistered = () => true;
  p.setLocation(new core.Location(x, 3218, 0));
  for (const skill of [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.HITPOINTS]) {
    p.getSkillManager().setMaxLevel(skill, 99);
    p.getSkillManager().setCurrentLevel(skill, 99);
  }
  return p;
}

function npc() {
  return core.NPC.create(core.NpcIdentifiers.MAN, new core.Location(3223, 3218, 0)).setHitpoints(200);
}

/** Actual formula and damage resolution; only accuracy RNG draws and transport are controlled. */
function branchHit(t, attacker, target, itemId, wins = [], { precache = false, replaceSpecial } = {}) {
  wield(attacker, itemId);
  attacker.setSpecialPercentage(100);
  attacker.setSpecialActivated(true);
  const method = attacker.getCombatSpecial().getCombatMethod();
  AccuracyFormulasDpsCalc.clearRollCache(attacker);
  const plain = AccuracyFormulasDpsCalc.specialRolls(attacker, target, core.CombatType.MELEE).attack;
  if (!precache) AccuracyFormulasDpsCalc.clearRollCache(attacker);
  const rolls = [];
  const actualRolls = AccuracyFormulasDpsCalc.specialRolls.bind(AccuracyFormulasDpsCalc);
  let draws = 0;
  t.mock.method(AccuracyFormulasDpsCalc, "specialRolls", (...args) => {
    const result = actualRolls(...args);
    if (args[0] === attacker) rolls.push(result.attack);
    return result;
  });
  t.mock.method(AccuracyFormulasDpsCalc, "randomInclusive", (maximum) => {
    const index = Math.floor(draws / 2);
    const attackDraw = draws++ % 2 === 0;
    return (wins[index] === true) === attackDraw ? maximum : 0;
  });
  t.mock.method(Math, "random", () => 0.5);
  watchedAttacker = attacker;
  broadRolls = broadDamage = 0;
  replacementSpecial = replaceSpecial;
  try {
    const hit = new PendingHit(attacker, target, method);
    return { hit, rolls, plain, broadRolls, broadDamage, accuracyChecks: draws / 2 };
  } finally {
    watchedAttacker = undefined;
    replacementSpecial = undefined;
    t.mock.restoreAll();
  }
}

function wield(p, itemId) {
  p.getEquipment().setItem(Equipment.WEAPON_SLOT, new core.Item(itemId, 1));
  WeaponInterfaceManager.assign(p);
}

/** The attack rolls `attacker`'s dragon dagger special asks for against `target`, in hit order. */
function ddsRolls(t, attacker, target, { precache = false } = {}) {
  wield(attacker, core.ItemIdentifiers.DRAGON_DAGGER);
  attacker.setSpecialPercentage(100);
  attacker.setSpecialActivated(true);
  AccuracyFormulasDpsCalc.clearRollCache(attacker);
  const rolls = [];
  const roll = AccuracyFormulasDpsCalc.attackMeleeRoll.bind(AccuracyFormulasDpsCalc);
  t.mock.method(AccuracyFormulasDpsCalc, "attackMeleeRoll", (entity) => {
    const value = roll(entity);
    if (entity === attacker) rolls.push(value);
    return value;
  });
  if (precache) roll(attacker);
  new PendingHit(attacker, target, attacker.getCombatSpecial().getCombatMethod());
  t.mock.restoreAll();
  // A roll asks for the attack roll more than once; consecutive equal values are one roll.
  return rolls.filter((v, i) => i === 0 || v !== rolls[i - 1]);
}

function enticed(user, ally) {
  wield(user, core.ItemIdentifiers.SOULFLAME_HORN);
  user.getLocalPlayers().push(ally);
  user.setSpecialPercentage(100);
  user.setSpecialActivated(false);
  CombatSpecial.activate(user);
  user.getLocalPlayers().length = 0;
  assert.equal(user.getSpecialPercentage(), 75, "Entice reached the other player");
}

for (const precache of [false, true]) {
  test(`PvP: +50% on the first stab only${precache ? ", with the roll cached earlier that cycle" : ""}`, (t) => {
    cycle += 100;
    const user = player(`horn${precache ? "b" : "a"}`, 3222);
    const victim = player(`victim${precache ? "b" : "a"}`, 3223);
    const plain = ddsRolls(t, user, victim);
    assert.equal(plain.length, 1, `an unempowered special rolls one attack roll for both stabs: ${plain}`);
    cycle += 10;
    enticed(user, victim);
    cycle += 1;
    const rolls = ddsRolls(t, user, victim, { precache });
    assert.deepEqual(rolls, [Math.floor(plain[0] * 1.5), plain[0]], `rolls ${rolls}, plain ${plain[0]}`);
  });
}

for (const [weapon, hitCount, delays] of [
  ["DRAGON_CLAWS", 4, [0, 0, 1, 1]],
  ["BURNING_CLAWS", 3, undefined],
]) {
  for (const firstLands of [false, true]) {
    test(`${weapon}: first check ${firstLands ? "lands" : "misses"}, Entice is spent by this attack`, (t) => {
      cycle += 100;
      const attacker = player("clawproof", 3222), ally = player("clawally", 3223), target = npc();
      enticed(attacker, ally);
      const messages = [];
      t.mock.method(attacker, "sendMessage", (message) => messages.push(message));
      const result = branchHit(t, attacker, target, core.ItemIdentifiers[weapon], [firstLands]);
      assert.equal(result.hit.getFirstSuccessfulRangeIndex(), firstLands ? 0 : 1);
      assert.equal(result.accuracyChecks, 1, "first check is natural; second is guaranteed only if needed");
      assert.equal(result.hit.getFailedAccuracyChecks(), firstLands ? 0 : 1);
      assert.equal(result.hit.getHits().length, hitCount);
      assert.deepEqual(result.hit.getHitDelays(), delays);
      assert.equal(result.broadRolls, 0, "first-successful path does not fan out ordinary roll hooks");
      assert.equal(result.broadDamage, 0, "first-successful path does not introduce ordinary damage hooks");
      const damage = result.hit.getHits().map((hit) => hit.getDamage());
      if (weapon === "DRAGON_CLAWS" && !firstLands) assert.equal(damage[0], 0);
      assert.ok(result.hit.getTotalDamage() <= target.getHitpoints());
      const next = branchHit(t, attacker, target, core.ItemIdentifiers[weapon]);
      assert.equal(next.hit.getFirstSuccessfulRangeIndex(), -1, "no grant survives an early first-check success");
      assert.equal(next.accuracyChecks, hitCount);
      assert.ok(next.hit.getTotalDamage() <= 2, "unempowered all-miss fallback is preserved");
      // branchHit restores RNG probes; capture real TaskManager expiry output separately.
      t.mock.method(attacker, "sendMessage", (message) => messages.push(message));
      for (let tick = 0; tick < 11; tick++) { cycle++; TaskManager.process(); }
      assert.ok(!messages.some((message) => message.includes("effect fades")), "spent grant has no stale fade");
    });
  }

  for (const precache of [false, true]) {
    test(`${weapon}: PvP boosts only the second check, pre-cache=${precache}`, (t) => {
      cycle += 100;
      const attacker = player("pvpproof", 3222), target = player("pvptarget", 3223);
      enticed(attacker, target);
      const result = branchHit(t, attacker, target, core.ItemIdentifiers[weapon], [false, false, true], { precache });
      assert.deepEqual(result.rolls, [result.plain, Math.floor(result.plain * 1.5), result.plain]);
      assert.equal(result.hit.getFirstSuccessfulRangeIndex(), 2, "PvP bonus is accuracy, never a guarantee");
      const next = branchHit(t, attacker, target, core.ItemIdentifiers[weapon], [true], { precache: true });
      assert.deepEqual(next.rolls, [next.plain], "later same-cycle attack has no scoped multiplier");
    });
  }

  test(`${weapon}: PvP first-check success still consumes Entice`, (t) => {
    cycle += 100;
    const attacker = player("earlyproof", 3222), target = player("earlytarget", 3223);
    enticed(attacker, target);
    const first = branchHit(t, attacker, target, core.ItemIdentifiers[weapon], [true]);
    assert.deepEqual(first.rolls, [first.plain]);
    const next = branchHit(t, attacker, target, core.ItemIdentifiers.DRAGON_DAGGER, [true, true]);
    assert.deepEqual(next.rolls, [next.plain, next.plain], "grant cannot transfer to the next ordinary roll");
  });

  test(`${weapon}: guaranteed second branch still caps distributed damage to rolled target HP`, (t) => {
    cycle += 100;
    const attacker = player("capproof", 3222), ally = player("capally", 3223), target = npc().setHitpoints(1);
    enticed(attacker, ally);
    const { hit } = branchHit(t, attacker, target, core.ItemIdentifiers[weapon]);
    assert.equal(hit.getFirstSuccessfulRangeIndex(), 1);
    assert.equal(hit.getTotalDamage(), 1);
    assert.equal(hit.getHits().reduce((total, damage) => total + damage.getDamage(), 0), 1);
    assert.equal(target.getHitpoints(), 1, "preparing a hit does not mutate target HP before impact");
  });
}

test("first-successful Vesta single range uses the ordinary first-check Entice rule", (t) => {
  cycle += 100;
  const attacker = player("spearproof", 3222), ally = player("spearally", 3223);
  enticed(attacker, ally);
  const result = branchHit(t, attacker, npc(), core.ItemIdentifiers.VESTAS_SPEAR_BH_);
  assert.equal(result.hit.getFirstSuccessfulRangeIndex(), 0);
  assert.equal(result.accuracyChecks, 0);
  assert.equal(result.hit.getHits().length, 2);
  assert.deepEqual(result.hit.getHitDelays(), [0, 2]);
  const next = branchHit(t, attacker, npc(), core.ItemIdentifiers.VESTAS_SPEAR_BH_);
  assert.equal(next.hit.getFirstSuccessfulRangeIndex(), -1);
  assert.deepEqual(next.hit.getHits().map((hit) => hit.getDamage()), [0, 0]);
  cycle += 10;
  enticed(attacker, ally);
  const pvp = branchHit(t, attacker, ally, core.ItemIdentifiers.VESTAS_SPEAR_BH_, [false], { precache: true });
  assert.deepEqual(pvp.rolls, [Math.floor(pvp.plain * 1.5)]);
  assert.equal(pvp.hit.getFirstSuccessfulRangeIndex(), -1);
  const followup = branchHit(t, attacker, ally, core.ItemIdentifiers.VESTAS_SPEAR_BH_, [true]);
  assert.deepEqual(followup.rolls, [followup.plain]);
});

test("claw classification uses the attack's special snapshot before prepare hooks", (t) => {
  cycle += 100;
  const attacker = player("snapshotproof", 3222), ally = player("snapshotally", 3223);
  enticed(attacker, ally);
  const result = branchHit(t, attacker, npc(), core.ItemIdentifiers.DRAGON_CLAWS, [false], {
    replaceSpecial: CombatSpecial.getById("vestas_spear_bh"),
  });
  assert.equal(result.hit.getFirstSuccessfulRangeIndex(), 1, "newly assigned special cannot move the bonus to first check");
  assert.equal(result.accuracyChecks, 1);
});

test("a newer grant survives the old expiry task and is consumed by the claw attack", (t) => {
  cycle += 100;
  const attacker = player("renewproof", 3222), ally = player("renewally", 3223);
  enticed(attacker, ally);
  for (let tick = 0; tick < 6; tick++) { cycle++; TaskManager.process(); }
  enticed(attacker, ally);
  for (let tick = 0; tick < 4; tick++) { cycle++; TaskManager.process(); }
  const { hit } = branchHit(t, attacker, npc(), core.ItemIdentifiers.DRAGON_CLAWS);
  assert.equal(hit.getFirstSuccessfulRangeIndex(), 1, "the newer grant outlives the earlier timer");
});
