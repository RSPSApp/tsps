// Run after `yarn build`: node --test tests/weapon-families-melee-misc.test.cjs
// Partisans, sickles, machetes, cutlasses, scythes, banners and canes: plain melee weapons
// with no ammunition, no durability and no special-attack bar. The Keris passive and the
// Scythe of vitur charge upkeep are covered below and in scythe-and-bowfa.test.cjs.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { Barrows } = require("../dist/game/content/combat/Barrows");
const { RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Misc } = require("../dist/util/Misc");

const items = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "definitions", "item-gameplay.json"), "utf8"),
);
const FAMILY = /partisan|sickle|machete|cutlass|scythe|banner|\bcane\b/i;
const wieldable = items.filter((item) => FAMILY.test(item.name ?? "") && item.weaponInterface && !/candy/i.test(item.name));

// Every other special plugin registers too, so a family id claimed by any of them would show up.
const specialsDir = path.join(__dirname, "..", "plugins", "combat", "specials");
for (const file of fs.readdirSync(specialsDir).filter((name) => name.endsWith(".SpecialAttack.js"))) {
  try {
    require(path.join(specialsDir, file))({ core: PluginManager.getCoreApi(), registerCombatSpecial: CombatSpecial.register });
  } catch {
    // a plugin that needs more of the api than the fake offers cannot claim these ids anyway
  }
}

test("the melee weapon families exist in the weapon data", () => {
  assert.ok(wieldable.length > 80, `found ${wieldable.length} wieldable family items`);
  for (const word of ["partisan", "sickle", "machete", "cutlass", "scythe", "banner", "cane"]) {
    assert.ok(wieldable.some((item) => new RegExp(word, "i").test(item.name)), word);
  }
});

test("no family weapon fires or consumes ammunition", () => {
  for (const { id, name } of wieldable) {
    assert.equal(RangedWeapon.getSelfAmmo(id), undefined, `${name} (${id}) throws nothing`);
  }
  const ranged = /BOW|THROWN|CHINCHOMPA|SALAMANDER|^STAFF$/;
  for (const { name, weaponInterface } of wieldable) {
    assert.ok(!ranged.test(weaponInterface), `${name} is melee`);
  }
});

test("no family weapon degrades or breaks", () => {
  for (const { id, name } of wieldable) {
    assert.equal(Barrows.isBarrowsItem(id), false, `${name} (${id}) has no durability stages`);
  }
});

// Wiki: only the corruption and sun partisans carry a special attack; every other family
// weapon (Keris partisan, Breaching, Amascut, sickles, machetes, cutlasses, scythes,
// banners, canes) has no special bar, so the bar stays hidden for them.
const SPECIAL_PARTISANS = new Set([
  ItemIdentifiers.KERIS_PARTISAN_OF_CORRUPTION,
  ItemIdentifiers.KERIS_PARTISAN_OF_CORRUPTION_2,
  ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN,
  ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN_2,
]);

test("only the corruption and sun partisans have a special-attack bar entry", () => {
  for (const { id, name } of wieldable) {
    const special = CombatSpecial.getForWeaponId(id);
    if (SPECIAL_PARTISANS.has(id)) {
      assert.ok(special, `${name} (${id}) has its special`);
    } else {
      assert.equal(special, null, `${name} (${id}) has no special`);
    }
  }
});

test("a partisan special drains 75% exactly once and refreshes the bar", () => {
  for (const id of SPECIAL_PARTISANS) {
    const special = CombatSpecial.getForWeaponId(id);
    assert.equal(special.getDrainAmount(), 75);
    let energy = 100;
    let orbUpdates = 0;
    const character = {
      isPlayer: () => true,
      getAsPlayer() { return this; },
      decrementSpecialPercentage: (amount) => { energy -= amount; },
      getSpecialPercentage: () => 100, // keeps the restore task out of this test
      isSpecialActivated: () => false,
      getWeapon: () => null,
      getPacketSender: () => ({
        updateSpecialAttackOrb: () => { orbUpdates++; },
        sendSpecialAttackState: () => {},
      }),
    };
    CombatSpecial.drain(character, special.getDrainAmount());
    assert.equal(energy, 25, `item ${id} drains once`);
    assert.equal(orbUpdates, 1, "the bar refreshes once");
  }
});

function kerisPlayer(weaponId, targetName) {
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ get: (slot) => (slot === Equipment.WEAPON_SLOT ? { getId: () => weaponId } : null) }),
    getCombat: () => ({
      getTarget: () => ({
        isNpc: () => true,
        getAsNpc: () => ({ getCurrentDefinition: () => ({ getName: () => targetName }) }),
      }),
    }),
  };
}

test("Keris partisans, including the Theatre of Blood and Tombs of Amascut variants, hit kalphites harder", () => {
  let damage;
  let accuracy;
  require("../plugins/items/Keris.plugin").register({
    registerMeleeHitModifier: (fn) => { damage = fn; },
    registerMeleeAttackAccuracyModifier: (fn) => { accuracy = fn; },
  });
  const I = ItemIdentifiers;
  const roll = Misc.randomInclusive;
  try {
    Misc.randomInclusive = () => 2; // no 1/51 crit
    for (const id of [I.KERIS_PARTISAN, I.KERIS_PARTISAN_OF_BREACHING, I.KERIS_PARTISAN_OF_CORRUPTION, I.KERIS_PARTISAN_OF_THE_SUN]) {
      assert.equal(damage(kerisPlayer(id, "Kalphite Queen"), 30), 40, `item ${id} deals 4/3 to kalphites`);
      assert.equal(damage(kerisPlayer(id, "Scabaras Lancer"), 30), 30, "only kalphites and scabarites");
      assert.equal(damage(kerisPlayer(id, "Scarab mage"), 30), 30);
    }
    assert.equal(damage(kerisPlayer(I.KERIS_PARTISAN_OF_AMASCUT, "Kalphite Worker"), 100), 115, "Amascut: +15%");
    assert.equal(damage(kerisPlayer(I.KERIS_PARTISAN, "Goblin"), 30), 30);
    assert.equal(damage(kerisPlayer(I.ABYSSAL_WHIP, "Kalphite Queen"), 30), 30, "other weapons are untouched");

    Misc.randomInclusive = () => 1; // the 1/51 crit triples it
    assert.equal(damage(kerisPlayer(I.KERIS_PARTISAN, "Kalphite Queen"), 30), 120);
    assert.equal(damage(kerisPlayer(I.KERIS_PARTISAN_OF_AMASCUT, "Kalphite Queen"), 100), 345);

    assert.equal(accuracy(kerisPlayer(I.KERIS_PARTISAN_OF_BREACHING, "Kalphite Queen"), 900), 1200, "Breaching: 4/3 accuracy");
    assert.equal(accuracy(kerisPlayer(I.KERIS_PARTISAN, "Kalphite Queen"), 900), 900);
    assert.equal(accuracy(kerisPlayer(I.KERIS_PARTISAN_OF_BREACHING, "Goblin"), 900), 900);
  } finally {
    Misc.randomInclusive = roll;
  }
});
