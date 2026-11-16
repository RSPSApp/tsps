// Run after `yarn build`: node --test tests/soulflame-horn-pvp-roll.test.cjs
//
// Wiki (Soulflame horn): against a player, Entice is "a 50% accuracy increase" on the next melee attack,
// and only its first accuracy roll. Real plugins, real Players and a real PendingHit: an empowered
// player's two-hit dragon dagger special against a player rolls the first stab at 1.5x the attack roll and
// the second at the plain roll, even with the attack roll already cached earlier in the same cycle.
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

let core;
let cycle = 5000;
const processCycle = World.getProcessCycle;
before(async () => {
  World.getProcessCycle = () => cycle;
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
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
  return p;
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
