// Run after `yarn build`: node --test tests/lunar-spell-animations.test.cjs
// Lunar spells cast with their own animations and graphics, as in rsprox captures of live OSRS.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
const { Spell } = require("../dist/game/content/combat/magic/Spell");
const { TeleportHandler } = require("../dist/game/model/teleportation/TeleportHandler");
const { PluginManager } = require("../dist/plugins/PluginManager");
const LunarCures = require("../plugins/combat/LunarCures.plugin");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

const seq = (name) => CacheDefinitions.getSeqId(name);
const spotanim = (name) => CacheDefinitions.getSpotanimId(name);

/** Replaces `object[key]` with `value` while `run` runs. */
function withStub(object, key, value, run) {
  const original = object[key];
  object[key] = value;
  try {
    return run();
  } finally {
    object[key] = original;
  }
}

/** A player who can cast any Lunar spell and records the animations and graphics it is given. */
function caster(extra = {}) {
  const sink = () => sink;
  return {
    animations: [],
    graphics: [],
    attributes: new Map(),
    getIndex: () => 1,
    getPrivateArea: () => null,
    performAnimation(animation) { this.animations.push(animation.getId()); },
    performGraphic(graphic) { this.graphics.push(graphic.getId()); },
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences() {} }),
    getAttribute(key) { return this.attributes.get(key) ?? null; },
    setAttribute(key, value) { this.attributes.set(key, value); },
    getLocation: () => ({ isWithinDistance: () => true }),
    getCombat: () => ({ getPoisonImmunityTimer: () => ({ start() {} }) }),
    getPacketSender: () => ({ sendEffectTimer: () => ({ sendMessage() {} }) }),
    setPoisonDamage() {},
    setVenomed() {},
    sendMessage() {},
    ...extra,
  };
}

const castable = (run) => withStub(Spell.prototype, "canCast", () => true, run);

test("each captured Lunar spell names its cache animation and graphic", () => {
  const expected = {
    "bake pie": ["lunar_human_magic_summon2", "quest_lunar_bakepie_spotanim"],
    humidify: ["dream_player_humidify_spell", "dream_humidify_spell_spotanim"],
    "hunter kit": ["dream_player_hunter_box_spell", "dream_hunter_spell_spotanim"],
    "monster examine": ["dream_player_monsterexam_statspy", "dream_spell_monsterexam_statspy_spotanim"],
    "astral contact": ["lunar_human_magic_summon2", "quest_lunar_magic_flax_strim"],
    "plank make": ["dream_player_make_plank_spell", "dream_plank_make_spell_spotanim"],
    "spellbook swap": ["dream_player_spellbook_swap", "dream_spellbook_spotanim"],
    "string jewellery": ["lunar_human_magic_summon1", "quest_lunar_spellbook_string_jewelery_spot_anim"],
    "vengeance other": ["quest_lunar_pushing_magic_animation", null],
  };
  assert.deepEqual(Object.keys(LunarSpells.CASTS).sort(), Object.keys(expected).sort());
  for (const [spell, [animation, graphic]] of Object.entries(expected)) {
    assert.equal(LunarSpells.CASTS[spell].animation, seq(animation), spell);
    assert.equal(LunarSpells.CASTS[spell].graphic, graphic === null ? undefined : spotanim(graphic), spell);
  }
});

test("the registered Cure Me handler casts with its own animation and graphic", () => {
  let castSelf;
  LunarCures.register({
    core: PluginManager.getCoreApi(),
    onSpellCast: (handler) => { castSelf = handler; },
    onCustomEvent() {},
  });
  const player = caster({ isVenomed: () => false });
  const event = { player, spellName: "Cure Me", opId: 1, handled: false };
  castable(() => castSelf(event));
  assert.equal(event.handled, true);
  assert.deepEqual(player.animations, [seq("quest_lunar_pushing_magic_animation")]);
  assert.deepEqual(player.graphics, [spotanim("quest_lunar_cure_me_spot")]);
});

test("String Jewellery casts from the spellbook with its own animation and graphic", () => {
  // Gold amulet (u) -> Gold amulet; the spell has no target (op 1, Cast).
  let id = 1673;
  const amulet = { getId: () => id, setId(next) { id = next; } };
  const player = caster({ getInventory: () => ({ getValidItems: () => [amulet], refreshItems() {} }) });
  castable(() => LunarSpells.handleSelf(player, "String Jewellery"));
  assert.equal(id, 1692);
  assert.deepEqual(player.animations, [seq("lunar_human_magic_summon1")]);
  assert.deepEqual(player.graphics, [spotanim("quest_lunar_spellbook_string_jewelery_spot_anim")]);
});

test("Vengeance Other: the caster pushes the magic, the target only shows the graphic", () => {
  const player = caster({ getVengeanceTimer: () => ({ finished: () => true, start() {} }) });
  const target = caster({
    hasVengeanceReturn: () => false,
    getVengeanceTimer: () => ({ finished: () => true, start() {} }),
    setHasVengeance() {},
  });
  castable(() => LunarSpells.handlePlayerTarget(player, target, "Vengeance Other"));
  assert.deepEqual(player.animations, [seq("quest_lunar_pushing_magic_animation")]);
  assert.deepEqual(player.graphics, []);
  assert.deepEqual(target.animations, []);
  assert.deepEqual(target.graphics, [spotanim("quest_lunar_spellbook_vengeance_spot_anim")]);
});

test("a Lunar teleport leaves its animation and graphic to the teleport", () => {
  const player = caster();
  const teleports = [];
  castable(() =>
    withStub(TeleportHandler, "checkReqs", () => true, () =>
      withStub(TeleportHandler, "teleport", (...args) => teleports.push(args), () =>
        LunarSpells.handleSelf(player, "Moonclan Teleport"))));
  assert.equal(teleports.length, 1);
  assert.deepEqual(player.animations, []);
  assert.deepEqual(player.graphics, []);
});
