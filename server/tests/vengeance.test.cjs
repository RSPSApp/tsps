// Run after `yarn build`: node --test tests/vengeance.test.cjs
// Vengeance and Vengeance Other, against the OSRS Wiki (Vengeance, Vengeance_Other) and
// rsprox captures of live OSRS (docs/vengeance.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { EffectSpells } = require("../dist/game/content/combat/magic/EffectSpells");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
const { Spell } = require("../dist/game/content/combat/magic/Spell");
const { SecondsTimer } = require("../dist/game/model/SecondsTimer");
const { Skill } = require("../dist/game/model/Skill");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const VengeanceTimer = require("../plugins/interface/VengeanceTimer.plugin");
const TargetTeleport = require("../plugins/minigames/bountyhunter/TargetTeleport.BountyHunter");
const teleportTargets = new WeakMap();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/BlightedSpellSacks.plugin").register(PluginManager.createApi("BlightedSpellSacksTest"));
  const api = PluginManager.createApi("BlightedTargetTeleportTest");
  TargetTeleport(api, { inLobby: () => false });
  api.onCustomEvent("bounty-hunter:has-target", event => { event.target = teleportTargets.get(event.player); });
});

const COOLDOWN_MESSAGE = "You can only cast vengeance spells every 30 seconds.";

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

const castable = (run) => withStub(Spell.prototype, "canCast", () => true, run);

/** A Lunar caster with real vengeance state that records messages, XP and varbits. */
function lunarPlayer() {
  const player = {
    messages: [],
    experience: [],
    varbits: [],
    vengeance: false,
    timer: new SecondsTimer(),
    attributes: new Map(),
    getDueling: () => ({ inDuel: () => false }),
    getIndex: () => 0,
    getPrivateArea: () => null,
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getCurrentLevel: () => 99,
      addExperiences(skill, amount) { player.experience.push([skill, amount]); },
    }),
    hasVengeanceReturn: () => player.vengeance,
    setHasVengeance(value) { player.vengeance = value; },
    getVengeanceTimer: () => player.timer,
    getInventory: () => ({ deleteItemSet() {} }),
    getLocation: () => new (require("../dist/game/model/Location").Location)(3100, 3600),
    getAttribute(key) { return player.attributes.get(key) ?? null; },
    setAttribute(key, value) { player.attributes.set(key, value); },
    performAnimation() {},
    performGraphic() {},
    sendMessage(message) { player.messages.push(message); },
    getPacketSender: () => {
      const sender = {
        sendEffectTimer: () => sender,
        sendMessage(message) { player.messages.push(message); return sender; },
        sendVarbit(id, value) { player.varbits.push([id, value]); return sender; },
      };
      return sender;
    },
  };
  return player;
}

const castVengeance = (player) => castable(() => LunarSpells.handleSelf(player, "Vengeance"));
const castVengeanceOther = (player, target) => castable(() => LunarSpells.handlePlayerTarget(player, target, "Vengeance Other"));

test("Vengeance gives 112 Magic XP and no chat message", () => {
  const player = lunarPlayer();
  assert.equal(castVengeance(player), true);
  assert.equal(player.vengeance, true);
  assert.deepEqual(player.experience, [[Skill.MAGIC, 112]]);
  assert.deepEqual(player.messages, []);
  assert.equal(player.timer.finished(), false);
});

test("a vengeance spell on cooldown gives the live message", () => {
  const player = lunarPlayer();
  castVengeance(player);
  player.vengeance = false; // the rebound has fired, the cooldown still runs
  castVengeance(player);
  assert.equal(player.vengeance, false);
  assert.deepEqual(player.messages, [COOLDOWN_MESSAGE]);
  assert.equal(player.experience.length, 1);
});

test("Vengeance Other puts the caster on the shared cooldown, not the target", () => {
  const caster = lunarPlayer();
  const target = lunarPlayer();
  castVengeanceOther(caster, target);
  assert.equal(target.vengeance, true);
  assert.deepEqual(target.messages, ["You have the power of vengeance!"]);
  assert.equal(caster.timer.finished(), false, "caster's cooldown");
  assert.equal(target.timer.finished(), true, "target's cooldown");
  target.vengeance = false;
  castVengeance(target);
  assert.equal(target.vengeance, true, "the target can still cast Vengeance itself");

  const other = lunarPlayer();
  castVengeanceOther(caster, other);
  assert.equal(other.vengeance, false);
  assert.deepEqual(caster.messages, [COOLDOWN_MESSAGE]);
  castVengeance(caster);
  assert.equal(caster.vengeance, false, "Vengeance shares the cooldown");
});

test("a target on its own vengeance cooldown can still receive Vengeance Other", () => {
  const caster = lunarPlayer();
  const target = lunarPlayer();
  castVengeance(target);
  target.vengeance = false;
  castVengeanceOther(caster, target);
  assert.equal(target.vengeance, true);
});

function sackCaster({ x = 3100, y = 3600, sacks = 2, item = "BLIGHTED_VENGEANCE_SACK", magic = 99, defence = 99, book } = {}) {
  const core = PluginManager.getCoreApi();
  const player = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.messages = [];
  player.sendMessage = (message) => player.messages.push(message);
  player.setLocation(new core.Location(x, y, 0));
  player.setSpellbook(book ?? core.MagicSpellbook.LUNAR);
  for (const [skill, level] of [[Skill.MAGIC, magic], [Skill.DEFENCE, defence]]) {
    player.getSkillManager().setMaxLevels(skill, level, false);
    player.getSkillManager().setCurrentLevel(skill, level, false);
  }
  player.getInventory().resetItems();
  if (sacks) player.getInventory().add(new core.Item(core.ItemIdentifiers[item], sacks), false);
  return player;
}

test("blighted sacks pay one complete Vengeance cast, retaining regular runes and cooldown", () => {
  const core = PluginManager.getCoreApi();
  const player = sackCaster();
  for (const item of EffectSpells.VENGEANCE.itemsRequired(player)) player.getInventory().add(item.clone(), false);
  assert.equal(LunarSpells.handleSelf(player, "Vengeance"), true);
  assert.equal(player.hasVengeanceReturn(), true);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_VENGEANCE_SACK), 1);
  assert.ok(EffectSpells.VENGEANCE.itemsRequired(player).every(item => player.getInventory().getAmount(item.id) === item.getAmount()));
  player.setHasVengeance(false);
  LunarSpells.handleSelf(player, "Vengeance");
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_VENGEANCE_SACK), 1);
  assert.ok(player.messages.includes(COOLDOWN_MESSAGE));
});

test("blighted sacks also fund Vengeance Other, with normal target and cooldown checks", () => {
  const core = PluginManager.getCoreApi();
  const caster = sackCaster();
  const target = sackCaster({ x: 3101 });
  target.setAttribute("accept-aid", false);
  assert.equal(LunarSpells.handlePlayerTarget(caster, target, "Vengeance Other"), false);
  assert.equal(caster.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_VENGEANCE_SACK), 2);
  target.setAttribute("accept-aid", true);
  assert.equal(LunarSpells.handlePlayerTarget(caster, target, "Vengeance Other"), true);
  assert.equal(target.hasVengeanceReturn(), true);
  assert.equal(caster.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_VENGEANCE_SACK), 1);
  assert.equal(caster.getVengeanceTimer().finished(), false);
  assert.equal(target.getVengeanceTimer().finished(), true);
});

test("sacks preserve spell requirements and cannot supply another Lunar spell", () => {
  const core = PluginManager.getCoreApi();
  for (const options of [
    { magic: 93 }, { defence: 39 }, { book: core.MagicSpellbook.NORMAL },
    { x: 3200, y: 3200 }, { sacks: 0 },
  ]) {
    const player = sackCaster(options);
    LunarSpells.handleSelf(player, "Vengeance");
    assert.equal(player.hasVengeanceReturn(), false, JSON.stringify(options));
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_VENGEANCE_SACK), options.sacks ?? 2);
  }
  const player = sackCaster();
  LunarSpells.handleSelf(player, "Magic Imbue");
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_VENGEANCE_SACK), 2);
  assert.ok(player.messages.some(message => message.includes("required items")));
});

test("sacks can be used in Ferox, Mage Arena bank, supported PvP minigames and PvP worlds", (t) => {
  const core = PluginManager.getCoreApi();
  const players = [sackCaster({ x: 3130, y: 3630 }), sackCaster({ x: 2539, y: 4712 })];
  for (const name of ["Castle Wars", "Soul Wars"]) {
    const player = sackCaster({ x: 3200, y: 3200 });
    player.getArea = () => ({ getName: () => name });
    players.push(player);
  }
  for (const player of players) {
    LunarSpells.handleSelf(player, "Vengeance");
    assert.equal(player.hasVengeanceReturn(), true);
  }
  t.mock.method(core.WorldDefinition, "hasGlobalWorldTag", tag => tag === "pvp");
  const pvp = sackCaster({ x: 3200, y: 3200 });
  LunarSpells.handleSelf(pvp, "Vengeance");
  assert.equal(pvp.hasVengeanceReturn(), true);
});

const COMBAT_SACKS = [
  ["BLIGHTED_ANCIENT_ICE_SACK", ["ICE_RUSH", "ICE_BURST", "ICE_BLITZ", "ICE_BARRAGE"]],
  ["BLIGHTED_ENTANGLE_SACK", ["BIND", "SNARE", "ENTANGLE"]],
  ["BLIGHTED_TELEPORT_SPELL_SACK", ["TELEBLOCK"]],
  ["BLIGHTED_SURGE_SACK", ["WIND_WAVE", "WATER_WAVE", "EARTH_WAVE", "FIRE_WAVE", "WIND_SURGE", "WATER_SURGE", "EARTH_SURGE", "FIRE_SURGE"]],
];

for (const [item, names] of COMBAT_SACKS) {
  for (const name of names) {
    test(`blighted combat sack supplies ${name} through the real spell payment path`, () => {
      const core = PluginManager.getCoreApi(), spell = core.CombatSpells[name];
      const player = sackCaster({ item, book: spell.getSpellbook() });
      const sackId = core.ItemIdentifiers[item];
      assert.equal(spell.canCast(player, false), true, 'matching sacks supply a cast without runes');
      assert.equal(player.getInventory().getAmount(sackId), 2, 'validation does not pay');
      const runes = spell.itemsRequired(player);
      for (const rune of runes) player.getInventory().add(rune.clone(), false);
      assert.equal(spell.canCast(player, true), true);
      assert.equal(player.getInventory().getAmount(sackId), 1, 'one sack pays the complete cast');
      for (const rune of runes) assert.equal(player.getInventory().getAmount(rune.id), rune.getAmount(), 'ordinary runes remain');
      assert.equal(spell.canCast(player, true), false, 'the shared cast delay still rejects another payment');
      assert.equal(player.getInventory().getAmount(sackId), 1);
    });
  }
}

test('blighted teleport sacks supply the real Target Teleport handler on every spellbook', t => {
  const core = PluginManager.getCoreApi(), teleports = [];
  t.mock.method(core.TeleportHandler, 'teleport', player => teleports.push(player));
  t.mock.method(core.RegionManager, 'canMove', () => false);
  for (const book of [core.MagicSpellbook.NORMAL, core.MagicSpellbook.ANCIENT, core.MagicSpellbook.LUNAR, core.MagicSpellbook.ARCEUUS]) {
    const player = sackCaster({ x: 3423, y: 4061, book, item: 'BLIGHTED_TELEPORT_SPELL_SACK' });
    player.getArea = () => ({ getName: () => 'BountyHunterLobby' });
    const target = sackCaster({ x: 3424, y: 4061 });
    player.setAttribute(TargetTeleport._test.UNLOCKED_ATTRIBUTE, true);
    teleportTargets.set(player, target);
    assert.equal(PluginManager.emitSpellCast({ player, spellName: 'Teleport to Target', handled: false }), true);
    assert.ok(teleports.at(-1) === player, `the existing handler completes the cast: ${player.messages.join('; ')}`);
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_TELEPORT_SPELL_SACK), 1);
    assert.equal(TargetTeleport._test.usesOf(player, target), 1);
  }
});

test('combat sacks preserve levels, books, supply requirements and location restrictions', () => {
  const core = PluginManager.getCoreApi();
  for (const [item, names] of COMBAT_SACKS) {
    const spell = core.CombatSpells[names.at(-1)];
    for (const options of [
      { magic: spell.levelRequired() - 1 }, { book: core.MagicSpellbook.LUNAR },
      { x: 3200, y: 3200 }, { sacks: 0 }, { item: 'BLIGHTED_VENGEANCE_SACK' },
    ]) {
      const player = sackCaster({ item, book: spell.getSpellbook(), ...options });
      assert.equal(spell.canCast(player, true), false);
      const held = core.ItemIdentifiers[options.item ?? item];
      assert.equal(player.getInventory().getAmount(held), options.sacks ?? 2, 'a refused cast never pays');
    }
    for (const options of [{ sacks: 0 }, { x: 3200, y: 3200 }]) {
      const player = sackCaster({ item, book: spell.getSpellbook(), ...options });
      for (const rune of spell.itemsRequired(player)) player.getInventory().add(rune.clone(), false);
      assert.equal(spell.canCast(player, true), true, 'ordinary runes remain a fallback');
      for (const rune of spell.itemsRequired(player)) assert.equal(player.getInventory().getAmount(rune.id), 0);
      assert.equal(player.getInventory().getAmount(core.ItemIdentifiers[item]), options.sacks ?? 2);
    }
  }
});

test('combat sacks work in the existing permitted locations and both Bounty Hunter areas', t => {
  const core = PluginManager.getCoreApi(), spell = core.CombatSpells.ICE_BARRAGE;
  const players = [sackCaster({ x: 3130, y: 3630, item: 'BLIGHTED_ANCIENT_ICE_SACK', book: spell.getSpellbook() }),
    sackCaster({ x: 2539, y: 4712, item: 'BLIGHTED_ANCIENT_ICE_SACK', book: spell.getSpellbook() })];
  for (const name of ['Castle Wars', 'Clan Wars', 'Soul Wars', 'BountyHunterLobby', 'BountyHunterArena']) {
    const player = sackCaster({ x: 3200, y: 3200, item: 'BLIGHTED_ANCIENT_ICE_SACK', book: spell.getSpellbook() });
    player.getArea = () => ({ getName: () => name });
    players.push(player);
  }
  for (const player of players) {
    assert.equal(spell.canCast(player, true), true);
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_ANCIENT_ICE_SACK), 1);
  }
  t.mock.method(core.WorldDefinition, 'hasGlobalWorldTag', tag => tag === 'pvp');
  const pvp = sackCaster({ x: 3200, y: 3200, item: 'BLIGHTED_ANCIENT_ICE_SACK', book: spell.getSpellbook() });
  assert.equal(spell.canCast(pvp, true), true);
});

test('sacks cannot fund unrelated spells, anonymous spells or noted supplies', () => {
  const core = PluginManager.getCoreApi();
  for (const [item] of COMBAT_SACKS) {
    const player = sackCaster({ item, book: core.MagicSpellbook.NORMAL });
    assert.equal(core.CombatSpells.WIND_STRIKE.canCast(player, true), false);
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers[item]), 2);
  }
  const player = sackCaster({ item: 'BLIGHTED_ANCIENT_ICE_SACK_2', book: core.MagicSpellbook.ANCIENT });
  assert.equal(core.CombatSpells.ICE_BARRAGE.canCast(player, true), false);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_ANCIENT_ICE_SACK_2), 2);
  const items = [new core.Item(core.ItemIdentifiers.LAW_RUNE, 1)];
  const event = { player, items, spell: { getSpellbook: () => player.getSpellbook(), spellId: () => -1 } };
  PluginManager.emitCustomEvent('magic:spell-cost', event);
  assert.equal(event.items, items, 'an anonymous spell is not Target Teleport');
});

test('a rune bypass does not consume a sack for a free cast', t => {
  const core = PluginManager.getCoreApi(), spell = core.CombatSpells.ICE_BARRAGE;
  const player = sackCaster({ item: 'BLIGHTED_ANCIENT_ICE_SACK', book: spell.getSpellbook() });
  t.mock.method(PluginManager, 'emitSpellRuneBypass', () => true);
  assert.equal(spell.canCast(player, true), true);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_ANCIENT_ICE_SACK), 2);
});

test('Target Teleport refusals and five-use limit preserve sacks; normal runes still work', t => {
  const core = PluginManager.getCoreApi(), teleports = [];
  t.mock.method(core.TeleportHandler, 'teleport', player => teleports.push(player));
  t.mock.method(core.RegionManager, 'canMove', () => false);
  const make = (sacks = 6) => {
    const player = sackCaster({ x: 3423, y: 4061, book: core.MagicSpellbook.NORMAL, item: 'BLIGHTED_TELEPORT_SPELL_SACK', sacks });
    player.getArea = () => ({ getName: () => 'BountyHunterLobby' });
    player.setAttribute(TargetTeleport._test.UNLOCKED_ATTRIBUTE, true);
    teleportTargets.set(player, sackCaster({ x: 3424, y: 4061 }));
    return player;
  };
  const cast = player => PluginManager.emitSpellCast({ player, spellName: 'Teleport to Target', handled: false });
  for (const refuse of [
    player => player.setAttribute(TargetTeleport._test.UNLOCKED_ATTRIBUTE, false),
    player => teleportTargets.delete(player),
    player => player.setLocation(new core.Location(3200, 3200)),
    player => player.getSkillManager().setCurrentLevel(Skill.MAGIC, 84, false),
    player => player.getCombat().getTeleblockTimer().start(60),
    player => TargetTeleport._test.noteCombat({ attacker: player, target: teleportTargets.get(player) }),
  ]) {
    const player = make();
    refuse(player); cast(player);
    assert.equal(teleports.length, 0);
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_TELEPORT_SPELL_SACK), 6);
  }
  const player = make();
  for (let n = 0; n < 6; n++) cast(player);
  assert.equal(teleports.length, 5);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLIGHTED_TELEPORT_SPELL_SACK), 1);
  const fallback = make(0);
  for (const rune of core.CacheDefinitions.getSpellRequirements('Teleport to Target').runes) {
    fallback.getInventory().add(new core.Item(rune.id, rune.amount), false);
  }
  cast(fallback);
  assert.equal(teleports.at(-1), fallback);
  assert.ok(core.CacheDefinitions.getSpellRequirements('Teleport to Target').runes.every(rune => fallback.getInventory().getAmount(rune.id) === 0));
});

test("vengeance_rebound follows the effect; vengeance_timelimit the cooldown", () => {
  const hooks = {};
  VengeanceTimer.register({
    onPlayerLogin: (handler) => { hooks.login = handler; },
    onPlayerProcess: (handler) => { hooks.process = handler; },
    onPlayerLogout: (handler) => { hooks.logout = handler; },
  });
  const player = lunarPlayer();
  hooks.login({ player });
  assert.deepEqual(player.varbits, [[2451, 0], [2450, 0]]);
  castVengeance(player);
  player.varbits.length = 0;
  hooks.process({ player });
  assert.deepEqual(player.varbits, [[2451, 1], [2450, 1]]);
  player.varbits.length = 0;
  player.vengeance = false;
  hooks.process({ player });
  assert.deepEqual(player.varbits, [[2450, 0]]);
});

test("Vengeance can't be cast in a player-owned house, and entering one ends it", () => {
  const core = PluginManager.getCoreApi();
  const hooks = [];
  require("../plugins/skills/construction/Core.Construction").init({ core });
  const Instance = require("../plugins/skills/construction/Instance.Construction");
  const House = require("../plugins/skills/construction/House.Construction");
  const api = new Proxy({}, {
    get: (_, name) => (name === "onSpellDisabled" ? (handler) => hooks.push(handler) : () => {}),
  });
  House.attach(api);
  assert.equal(hooks.length, 1);

  const house = Object.create(Instance.PlayerHouseInstance.prototype);
  const player = lunarPlayer();
  player.getPrivateArea = () => house;
  const event = (spell) => ({ player, spellbook: null, spellId: spell.spellId(), spell, disabled: null });
  const vengeance = event(EffectSpells.VENGEANCE);
  hooks[0](vengeance);
  assert.equal(vengeance.disabled, true);
  assert.deepEqual(player.messages, ["You can't use this spell inside a player-owned house."]);
  const other = event(EffectSpells.BONES_TO_BANANAS);
  hooks[0](other);
  assert.equal(other.disabled, null);
  player.getPrivateArea = () => null;
  const outside = event(EffectSpells.VENGEANCE);
  hooks[0](outside);
  assert.equal(outside.disabled, null);

  player.vengeance = true;
  Object.assign(house, {
    save: {},
    getTemplateObjects() {},
    enter() {},
    getEntryLocation: () => null,
    rebuild: () => false,
  });
  player.getArea = () => null;
  player.moveTo = () => {};
  withStub(Instance.PlayerHouseInstance, "getTemplateObjects", () => {}, () => house.enterHouse(player, false));
  assert.equal(player.vengeance, false);
});


test("captured Vengeance casts emit one immediate radius10 area sound at their caster, never on refusal", () => {
  const { Sounds } = require("../dist/game/Sounds");
  const { Location } = require("../dist/game/model/Location");
  const sounds = [];
  withStub(Sounds, "playAreaSoundAt", (actor, sound, radius) => sounds.push([actor, sound.getId(), sound.getDelay(), radius]), () => {
    const self = lunarPlayer();
    castVengeance(self);
    assert.deepEqual(sounds, [[self,2907,0,10]], "raw1685 ticks61/192/315");
    self.vengeance = false; castVengeance(self);
    assert.equal(sounds.length,1,"cooldown refusal is silent");
    const caster = lunarPlayer(), recipient = lunarPlayer();
    caster.getLocation = () => new Location(3170,3475);
    recipient.getLocation = () => new Location(3169,3475);
    castVengeanceOther(caster,recipient);
    assert.deepEqual(sounds[1],[caster,2908,0,10],"raw2796 tick200 soundtile3170,3475 is caster1696, not recipient1432");
    castVengeanceOther(caster,recipient);
    assert.equal(sounds.length,2,"existing-effect/cooldown refusal adds nothing");
  });
});
