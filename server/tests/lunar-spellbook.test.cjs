// Run after `yarn build`: node --test tests/lunar-spellbook.test.cjs
// Lunar spellbook audit (issue 1931): each spell's level and runes come from its cache spell obj,
// and the spells are reached by the packet the client sends for them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
const { Skill } = require("../dist/game/model/Skill");
const { Spell } = require("../dist/game/content/combat/magic/Spell");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

const castable = (run) => {
  const original = Spell.prototype.canCast;
  Spell.prototype.canCast = () => true;
  try { return run(); } finally { Spell.prototype.canCast = original; }
};

/** A Lunar caster with an inventory of `[id, amount]` slots. */
function caster(slots) {
  const items = slots.map(([id, amount]) => {
    const item = { id, amount, getId: () => item.id, setId: (next) => { item.id = next; }, getAmount: () => item.amount };
    return item;
  });
  const valid = () => items.filter((item) => item.id >= 0 && item.amount > 0);
  const experience = {};
  return {
    items, experience, messages: [],
    getIndex: () => 1,
    getPrivateArea: () => null,
    getPacketSender: () => ({ sendSoundEffect() {} }),
    isRegistered: () => true,
    performAnimation() {}, performGraphic() {},
    getSkillManager: () => ({
      getMaxLevel: () => 99, getCurrentLevel: () => 99,
      addExperiences(skill, amount) { experience[skill.getName()] = (experience[skill.getName()] ?? 0) + amount; },
    }),
    getInventory: () => ({
      getItems: () => items, getValidItems: valid, refreshItems() {},
      getAmount: (id) => valid().filter((item) => item.id === id).reduce((sum, item) => sum + item.amount, 0),
      contains: (id) => valid().some((item) => item.id === id),
      deleteNumber(id, amount) { valid().find((item) => item.id === id).amount -= amount; },
    }),
    sendMessage(message) { this.messages.push(message); },
  };
}

test("every Lunar spell takes its level and runes from the cache", () => {
  const books = [LunarSpells.SELF, LunarSpells.SPELLS, LunarSpells.TELEPORTS, LunarSpells.GROUP_TELEPORTS];
  let checked = 0;
  for (const book of books) {
    for (const [name, spell] of book) {
      const cached = CacheDefinitions.getSpellRequirements(name);
      assert.ok(cached, `${name} is a cache spell`);
      assert.equal(spell.levelRequired(), cached.level, `${name} level`);
      assert.deepEqual(spell.itemsRequired().map((rune) => [rune.getId(), rune.getAmount()]),
        cached.runes.map((rune) => [rune.id, rune.amount]), `${name} runes`);
      checked++;
    }
  }
  assert.equal(checked, 32);
  // Spot checks against the Wiki's tables, which the old hand-typed lists got wrong.
  const runes = (name) => Object.fromEntries(CacheDefinitions.getSpellRequirements(name).runes.map((rune) => [rune.id, rune.amount]));
  assert.deepEqual(runes("Barbarian Teleport"), { 563: 2, 9075: 2, 554: 3 });
  assert.deepEqual(runes("Tele Group Ice Plateau"), { 563: 3, 9075: 3, 555: 16 });
  assert.deepEqual(runes("Dream"), { 9075: 2, 564: 1, 559: 5 });
  assert.deepEqual(runes("Heal Group"), { 9075: 4, 563: 6, 565: 3 });
  assert.deepEqual(runes("String Jewellery"), { 9075: 2, 555: 5, 557: 10 });
});

test("String Jewellery strings an unstrung amulet, not a ring", () => {
  const player = caster([[1635, 1], [1673, 1]]);
  castable(() => LunarSpells.handleSelf(player, "String Jewellery"));
  assert.deepEqual(player.items.map((item) => item.id), [1635, 1692]);
  assert.equal(player.experience.Crafting, 4);
  assert.equal(player.experience.Magic, 83);
});

test("Plank Make is cast on a log: one plank per cast at 70% of the sawmill price", () => {
  const player = caster([[995, 1000], [1521, 1], [1511, 1]]);
  assert.equal(castable(() => LunarSpells.handleItemTarget(player, 1521, 1, "Plank Make")), true);
  assert.deepEqual(player.items.map((item) => [item.id, item.amount]), [[995, 825], [8778, 1], [1511, 1]]);
  assert.equal(player.experience.Magic, 90);
  assert.equal(LunarSpells.handleSelf(player, "Plank Make"), false, "it has no self-cast");
});

test("Bake Pie gives each pie's own Cooking XP", () => {
  const player = caster([[2317, 1]]);
  castable(() => LunarSpells.handleSelf(player, "Bake Pie"));
  assert.deepEqual(player.items.map((item) => item.id), [2323]);
  assert.equal(player.experience.Cooking, 130);
  assert.equal(player.experience.Magic, 60);
});

test("the potion shares are cast on a potion, not on a player", () => {
  assert.equal(LunarSpells.handlePlayerTarget(caster([]), caster([]), "Stat Restore Pot Share"), false);
  assert.equal(LunarSpells.handlePlayerTarget(caster([]), caster([]), "Boost Potion Share"), false);
});

/** A player for the player-target spells: `hp` of 99, full special bar and run energy unless given. */
function fighter({ hp = 99, special = 100, run = 100 } = {}) {
  const state = { hp, special, run, messages: [] };
  const sink = { updateSpecialAttackOrb: () => sink, sendRunEnergy: () => sink };
  return Object.assign(state, {
    getIndex: () => 2, isRegistered: () => true, performAnimation() {}, performGraphic() {}, getPrivateArea: () => null,
    getAttribute: () => null,
    getLocation: () => ({ isWithinDistance: () => true }),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences() {} }),
    getHitpoints: () => state.hp, setHitpoints(next) { state.hp = next; },
    heal(amount) { state.hp = Math.min(99, state.hp + amount); },
    getSpecialPercentage: () => state.special, setSpecialPercentage(next) { state.special = next; },
    getRunEnergy: () => state.run, setRunEnergy(next) { state.run = next; },
    getPacketSender: () => sink,
    sendMessage(message) { state.messages.push(message); },
  });
}

test("Heal Other gives no more than the target is missing, and nothing to a healthy target", () => {
  const player = fighter(), target = fighter({ hp: 90 });
  castable(() => LunarSpells.handlePlayerTarget(player, target, "Heal Other"));
  assert.equal(target.hp, 99);
  assert.equal(player.hp, 90);
  const healthy = fighter();
  castable(() => LunarSpells.handlePlayerTarget(player, healthy, "Heal Other"));
  assert.equal(player.hp, 90, "a healthy target costs nothing");
});

test("Energy Transfer costs 10 Hitpoints and gives a full special bar and full run energy", () => {
  const player = fighter({ run: 40 }), target = fighter({ special: 0, run: 5 });
  castable(() => LunarSpells.handlePlayerTarget(player, target, "Energy Transfer"));
  assert.deepEqual([player.hp, player.special, player.run], [89, 0, 40]);
  assert.deepEqual([target.special, target.run], [100, 100]);
  const weak = fighter({ hp: 10 });
  castable(() => LunarSpells.handlePlayerTarget(weak, fighter(), "Energy Transfer"));
  assert.deepEqual(weak.messages, ["You need more hitpoints to cast this spell."]);
});

test("Monster Examine sends interface 522 the text live sends script 1179", () => {
  // rsprox 3235 tick 89, an Outlaw. Live also lists "Strength bonus: -21"; this server keeps no
  // NPC strength bonuses, so that line is the one difference.
  const live = "<col=ffb000>Stats</col><br>Combat level: 32<br>Hitpoints: 20<br>Attack: 35<br>Defence: 25<br>" +
    "Strength: 30<br>Magic: 1<br>Ranged: 1<br>Max standard hit: 3<br>Main attack style: Crush|" +
    "<col=ffb000>Aggressive Stats</col><br>Attack speed: 4<br>Strength bonus: -21|" +
    "<col=ffb000>Defensive Stats</col><br>Stab: 0<br>Slash: 0<br>Crush: 0<br>Magic: 0<br>Light Ranged: 0<br>" +
    "Standard Ranged: 0<br>Heavy Ranged: 0|<col=ffb000>Other Attributes</col><br>- Is not a slayer monster.|Outlaw";
  const definition = {
    getStats: () => [35, 30, 25, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    getAttackStyle: () => "crush", getAttackSpeed: () => 4, getSlayerLevel: () => 0, isPoisonImmune: () => false,
    getElementalWeakness: () => null, getCombatLevel: () => 32, getMaxHit: () => 3, getName: () => "Outlaw",
    getRangedDefenceBonus: () => 0,
  };
  const npc = { getCurrentDefinition: () => definition,
    getCurrentLevel: skill => definition.getStats()[[Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC].indexOf(skill)],
    getHitpoints: () => 20, getLocation: () => ({}), performGraphic() {} };
  const sent = [];
  const sender = {
    sendMagicTabInterface(id) { sent.push(["mount", id]); return sender; },
    sendClientScript(id, text) { sent.push(["script", id, text]); return sender; },
    sendSoundEffect() { return sender; },
  };
  const player = Object.assign(caster([]), {
    getPacketSender: () => sender, setPositionToFace() {}, getLocation: () => ({ isWithinDistance: () => true }),
  });
  castable(() => LunarSpells.handleNpcTarget(player, npc, "Monster Examine"));
  assert.deepEqual(sent, [["mount", 522], ["script", 1179, live.replace("<br>Strength bonus: -21", "")]]);

  const options = { includeMaxHit: false, includeAttackStyle: false, meleeBonusLabel: "Attack bonus" };
  assert.equal(LunarSpells.monsterStats(npc, options), live.replace("<br>Strength bonus: -21", "")
    .replace("<br>Max standard hit: 3", "").replace("<br>Main attack style: Crush", ""));
  const withBonus = { ...npc, getCurrentDefinition: () => ({ ...definition,
    getStats: () => [35, 30, 25, 1, 1, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  }) };
  assert.ok(LunarSpells.monsterStats(withBonus, options).includes("<br>Attack bonus: 7"));
  assert.ok(LunarSpells.monsterStats(withBonus).includes("<br>Crush bonus: 7"), "optional field controls leave the Lunar defaults intact");
  const drained = { ...npc, getCurrentLevel: skill => new Map([
    [Skill.ATTACK, 3], [Skill.DEFENCE, 0], [Skill.STRENGTH, 2], [Skill.MAGIC, 1], [Skill.RANGED, 0],
  ]).get(skill) };
  for (const settings of [undefined, options]) {
    assert.ok(LunarSpells.monsterStats(drained, settings).includes(
      "Attack: 3<br>Defence: 0<br>Strength: 2<br>Magic: 1<br>Ranged: 0"),
      "both inspection spells report temporary instance levels instead of the base definition");
  }
});
