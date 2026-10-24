// Run after `yarn build`: node --test tests/sarachnis.test.cjs
// Sarachnis: the ids against the cache's gamevals, the lair and entrance, the fight's phases,
// web, heal and spawns, the instance fee, the Combat Achievement tasks and the ::teleports
// entries, each against the captures and Wiki facts in docs/sarachnis.md.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const Sarachnis = require("../plugins/bosses/Sarachnis.plugin");
const Common = require("../plugins/bosses/sarachnis/Common.Sarachnis");
const Fight = require("../plugins/bosses/sarachnis/Fight.Sarachnis");
const Lair = require("../plugins/bosses/sarachnis/Lair.Sarachnis");
const Entrance = require("../plugins/bosses/sarachnis/Entrance.Sarachnis");

const core = PluginManager.getCoreApi();
const areas = [];
const combatProviders = [];
const objectHooks = {};
const prompts = [];
const api = new Proxy({
  core,
  persistAttribute: () => {},
  registerArea: (area) => areas.push(area),
  registerNpcCombatMethodProvider: (ids, method) => combatProviders.push({ ids, method }),
  spawnNpc: ({ id, x, y, z }) => ({
    getId: () => id,
    getLocation: () => new Location(x, y, z),
    getSize: () => 5,
    getHitpoints: () => 400,
    getDefinition: () => ({ getHitpoints: () => 400 }),
    isRegistered: () => true,
    setFace: () => {},
    setMultiCombat: () => {},
    setArea: () => {},
    getPlayersWithinDistance: () => [],
    getPrivateArea: () => null,
  }),
  onObjectInteraction: (name, actions) => { objectHooks[name] = { ...(objectHooks[name] ?? {}), ...actions }; },
  sendMultiChatboxPrompt: (player, title, ...pairs) => {
    prompts.push({ title, options: pairs.filter((value) => typeof value === "string"), pairs });
    return true;
  },
}, { get: (target, key) => target[key] ?? (() => {}) });

let gamevals = null;
const runTicks = (n = 1) => { for (let i = 0; i < n; i++) TaskManager.process(); };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  new NpcDefinitionLoader().load();
  gamevals = new Gamevals();
  Sarachnis.register(api);
});

function fakeNpc(id, x = 1840, y = 9900, hp = 400) {
  return {
    getId: () => id,
    getLocation: () => new Location(x, y, 0),
    getSize: () => 5,
    getHitpoints: () => hp,
    getDefinition: () => ({ getHitpoints: () => 400 }),
    isRegistered: () => true,
    getPlayersWithinDistance: () => [],
    getPrivateArea: () => null,
  };
}

// ------------------------------------------------------------------ the cache

test("the ids are the cache's sarachnis gamevals", () => {
  const npc = gamevals.namesOf(GamevalKind.NPC);
  assert.equal(npc.get(Common.BOSS_ID), "sarachnis");
  assert.equal(npc.get(Common.MELEE_SPAWN_ID), "sarachnis_melee_spawn");
  assert.equal(npc.get(Common.MAGE_SPAWN_ID), "sarachnis_mage_spawn");
  const seq = gamevals.namesOf(GamevalKind.SEQ);
  assert.equal(seq.get(Common.ANIM.melee), "hosdun_spider_boss_attack_melee");
  assert.equal(seq.get(Common.ANIM.ranged), "hosdun_spider_boss_attack_ranged");
  assert.equal(seq.get(Common.ANIM.death), "hosdun_spider_boss_death");
  assert.equal(seq.get(Common.ANIM.wade), "human_aranea_boots_wade");
  const spotanim = gamevals.namesOf(GamevalKind.SPOTANIM);
  assert.equal(spotanim.get(Common.PROJECTILE_ID.ranged), "sarachnis_rangeproj");
  assert.equal(spotanim.get(Common.PROJECTILE_ID.web), "sarachnis_web_proj");
  assert.equal(spotanim.get(Common.PROJECTILE_ID.minionMage), "hosdun_spider_bolt_travel");
  const loc = gamevals.namesOf(GamevalKind.LOC);
  assert.equal(loc.get(Common.ENTRANCE_ID), "hosdun_sarachnis_entrance");
  assert.equal(loc.get(Common.EXIT_ID), "hosdun_sarachnis_exit");
  assert.equal(loc.get(Common.PEEK_WEB_ID), "sarachnis_web_peek");
  assert.equal(loc.get(Common.WEB_ID), "sarachnis_web");
  assert.equal(Sarachnis.members, true);
});

test("her stats and combat definitions match the captures", () => {
  assert.equal(CacheDefinitions.getNpc(Common.BOSS_ID).hitpoints, 400);
  assert.equal(CacheDefinitions.getNpc(Common.BOSS_ID).size, 5);
  const defs = require("../data/definitions/npc-combat-defs.json").npcs;
  assert.deepEqual(defs[String(Common.BOSS_ID)].anims, { attack: 8147, block: -1, death: 8318 });
  // Captured: removal 7 ticks after the death anim, the next one 16 after that.
  assert.equal(defs[String(Common.BOSS_ID)].deathTicks, 7);
  assert.equal(defs[String(Common.BOSS_ID)].respawn, 16);
  assert.equal(defs[String(Common.MAGE_SPAWN_ID)].projectile, 1682);
});

test("the spawn, teleport, entrance and web tiles are in the tomb and walkable", () => {
  const free = ([x, y]) => !RegionManager.blocked(new Location(x, y, 0), null);
  assert.ok(free(Common.SPAWN_TILE));
  assert.ok(free(Common.TELEPORT_TILE));
  assert.ok(free(Common.OUTSIDE_TILE));
  for (const corner of Common.CORNERS) assert.ok(free(corner), String(corner));
  assert.ok(Common.inLair(new Location(...Common.SPAWN_TILE)));
  assert.ok(Common.inLair(new Location(...Common.TELEPORT_TILE)));
  assert.ok(!Common.inLair(new Location(...Common.OUTSIDE_TILE)));
  assert.ok(!Common.inLair(new Location(...Common.PEEK_WEB_TILE)));
});

// ------------------------------------------------------------------ the fight

test("melee is edge-adjacent on the 5x5 body, ranged beyond it", () => {
  const npc = fakeNpc(Common.BOSS_ID);
  const nextTo = { getLocation: () => new Location(1844, 9900, 0) };
  const far = { getLocation: () => new Location(1842, 9911, 0) };
  assert.equal(Fight._test.isAdjacent(npc, nextTo), true);
  assert.equal(Fight._test.isAdjacent(npc, far), false);
});

test("every fourth attack is the web, with the captured heal, sounds and freeze", () => {
  assert.equal(Common.WEB_EVERY, 4);
  assert.deepEqual({ ...Common.HEAL }, { melee: 5, ranged: 10 });
  assert.equal(Common.WEB_FREEZE_TICKS, 6);
  assert.equal(Common.WEB_SAY, "Hsss!");
  assert.equal(Common.BOOTS_MESSAGE, "Your Aranea boots let you avoid the spider-based attack.");
  assert.equal(Common.LEECH_MESSAGE, "Sarachnis leeches some health as she damages you.");
  assert.equal(Common.SOUND.ranged, 555);
  assert.deepEqual([...Common.SOUND.melee], [543, 541]);
  assert.equal(Common.SOUND.web, 543);
  assert.ok(Common.ARANEA_BOOT_IDS.includes(29806));
});

test("the projectile ends grow with travel and the hit lands from the end", () => {
  const ranged = Common.PROJECTILE_SHAPE.ranged;
  assert.equal(ranged.start, 39);
  assert.equal(Common.projectileEnd(ranged, 5), 76 + 50);
  assert.equal(Common.landingTicks(156) - 1, 5);
  assert.equal(Common.landingTicks(71) - 1, 2);
  const web = Common.PROJECTILE_SHAPE.web;
  assert.equal(Common.projectileEnd(web, 1), 61);
  assert.ok(Common.projectileEnd(web, 20) <= web.cap);
});

test("spawns fire at two thirds and a third health, once each", () => {
  const created = [];
  const attacked = [];
  Fight._test.setCreateMinion((id, tile) => {
    const minion = {
      getId: () => id,
      getLocation: () => tile,
      isRegistered: () => true,
      getHitpoints: () => 30,
      setHitpoints: () => {},
      __skipDefaultRespawn: false,
      setMultiCombat: () => {},
      getCombat: () => ({ attack: (target) => attacked.push([id, target]) }),
    };
    created.push(minion);
    return minion;
  });
  try {
    const inLair = (x, y) => ({
      getLocation: () => new Location(x, y, 0),
      getPrivateArea: () => null,
      getHitpoints: () => 50,
      isPlayer: () => true,
    });
    const playerA = inLair(1840, 9900);
    const playerB = inLair(1841, 9901);
    let hp = 400;
    const npc = {
      ...fakeNpc(Common.BOSS_ID),
      getHitpoints: () => hp,
      getPlayersWithinDistance: () => [],
    };
    Fight.reset(npc);
    // Crossing with an empty room consumes nothing; the wave waits for company.
    hp = 265;
    Fight._test.checkSpawns(npc, 1);
    assert.ok(!Fight._test.stateOf(npc).spawned.has(0.66));
    assert.equal(created.length, 0);
    // One pair per player in the room, each attacking their own player.
    npc.getPlayersWithinDistance = () => [playerA, playerB];
    Fight._test.checkSpawns(npc, 1);
    const state = Fight._test.stateOf(npc);
    assert.ok(state.spawned.has(0.66));
    assert.equal(created.length, 4);
    assert.deepEqual(attacked.map(([id]) => id).sort(), [8714, 8714, 8715, 8715]);
    assert.ok(attacked.every(([, target]) => target === playerA || target === playerB));
    // Second wave only at the second threshold, once.
    hp = 133;
    const before = created.length;
    Fight._test.checkSpawns(npc, 1);
    assert.ok(Fight._test.stateOf(npc).spawned.has(0.33));
    assert.equal(created.length, before + 4);
    Fight._test.checkSpawns(npc, 50);
    assert.equal(created.length, before + 4);
  } finally {
    Fight._test.resetCreateMinion();
  }
});

test("the heal fires on successful hits, message only with damage", () => {
  const healed = [];
  const messages = [];
  let gfx = 0;
  let splats = 0;
  const boss = {
    ...fakeNpc(Common.BOSS_ID),
    heal: (amount) => healed.push(amount),
    showHitsplat: () => { splats++; },
    performGraphic: () => { gfx++; },
    setAttribute: () => {},
    getAttribute: () => null,
  };
  Fight.stateOf(boss).lastStyle = "melee";
  const player = {
    isPlayer: () => true,
    getAsPlayer: function () { return player; },
    sendMessage: (text) => messages.push(text),
  };
  const method = new (Fight.defineCombatMethod())();
  const hit = (accurate, damage) => ({
    getTarget: () => player,
    getAttacker: () => ({ getAsNpc: () => boss }),
    isAccurate: () => accurate,
    getTotalDamage: () => damage,
  });
  method.handleAfterHitEffects(hit(true, 0));
  assert.deepEqual(healed, [5]);
  assert.equal(gfx, 1);
  assert.equal(splats, 1);
  assert.deepEqual(messages, []);
  method.handleAfterHitEffects(hit(true, 12));
  assert.deepEqual(healed, [5, 5]);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /leeches some health/);
  method.handleAfterHitEffects(hit(false, 0));
  assert.deepEqual(healed, [5, 5]);
  // The style travels with the hit: a ranged bolt landing after the next attack
  // started still heals 10, even though shared state moved on.
  Fight.stateOf(boss).lastStyle = "melee";
  const late = hit(true, 12);
  late.sarachnisStyle = "ranged";
  method.handleAfterHitEffects(late);
  assert.deepEqual(healed, [5, 5, 10]);
});

test("she only goes for players inside, and lets go of leavers", () => {
  const inside = { getLocation: () => new Location(1840, 9900, 0) };
  const outside = { getLocation: () => new Location(1842, 9913, 0) };
  const boss = { getId: () => Common.BOSS_ID };
  const minion = { getId: () => Common.MELEE_SPAWN_ID };
  const other = { getId: () => 1 };
  assert.equal(Lair._test.aggressive(inside, boss), true);
  assert.equal(Lair._test.aggressive(inside, minion), true);
  assert.equal(Lair._test.aggressive(outside, boss), null);
  assert.equal(Lair._test.aggressive(outside, minion), null);
  assert.equal(Lair._test.aggressive(inside, other), null);

  let bossReset = 0;
  let playerReset = 0;
  const player = {
    isPlayer: () => true,
    getAsPlayer: function () { return player; },
    getLocalNpcs: () => [bossNpc, other],
    getCombat: () => ({ getTarget: () => bossNpc, reset: () => { playerReset++; } }),
  };
  const bossNpc = {
    getId: () => Common.BOSS_ID,
    getCombat: () => ({ getTarget: () => player, reset: () => { bossReset++; } }),
  };
  Lair._test.disengage(player);
  assert.equal(bossReset, 1);
  assert.equal(playerReset, 1);
});

test("the web comes after four standards, then the count restarts", () => {
  const said = [];
  const moves = [];
  const player = {
    getLocation: () => new Location(1841, 9900, 0),
    isPlayer: () => true,
    getAsPlayer: function () { return player; },
    getHitpoints: () => 99,
    getPrivateArea: () => null,
    getPacketSender: () => ({ sendSound: () => {} }),
    getEquipment: () => ({ get: () => ({ getId: () => 29806 }) }),
    sendMessage: () => {},
  };
  const npc = {
    getId: () => Common.BOSS_ID,
    getAsNpc: function () { return npc; },
    getLocation: () => new Location(1840, 9900, 0),
    getSize: () => 5,
    getHitpoints: () => 400,
    getDefinition: () => ({ getHitpoints: () => 400 }),
    isRegistered: () => true,
    getPlayersWithinDistance: () => [player],
    getPrivateArea: () => null,
    performAnimation: () => {},
    forceChat: (text) => said.push(text),
    setMobileInteraction: () => {},
    setPositionToFace: () => {},
    getCombat: () => ({ reset: () => {}, setAttackDelay: () => {}, getTarget: () => player }),
    getMovementQueue: () => ({ reset: () => {} }),
    setScriptedMovement: () => {},
    setFlag: () => {},
    removeFlag: () => {},
    moveTo: (to) => moves.push([to.getX(), to.getY()]),
    setAttribute: () => {},
    getAttribute: () => null,
  };
  Fight.reset(npc);
  const method = new (Fight.defineCombatMethod())();
  const character = { getAsNpc: () => npc };
  for (let i = 0; i < 4; i++) {
    method.start(character, player);
    assert.deepEqual(said, []);
  }
  assert.equal(Fight.stateOf(npc).attacks, 4);
  method.start(character, player);
  assert.deepEqual(said, [Common.WEB_SAY]);
  assert.equal(Fight.stateOf(npc).attacks, 0);
  runTicks(6);
  assert.ok(moves.length > 0);
});

test("an emptied room starts the next group fresh, without stale minions", () => {
  const killed = [];
  const alive = { isRegistered: () => true, getHitpoints: () => 30, setHitpoints: () => { killed.push("alive"); } };
  const dead = { isRegistered: () => true, getHitpoints: () => 0, setHitpoints: () => { killed.push("dead"); } };
  let hp = 400;
  const npc = { ...fakeNpc(Common.BOSS_ID), getHitpoints: () => hp };
  Fight.reset(npc);
  const state = Fight._test.stateOf(npc);
  state.spawned.add(0.66);
  state.minions.push(alive, dead);
  state.lastSeen = -1000;
  Fight._test.checkSpawns(npc, 0);
  assert.deepEqual([...Fight._test.stateOf(npc).spawned], []);
  assert.deepEqual(killed, ["alive"]);
});

test("the plugin registers its combat method, lair area and web handlers", () => {
  assert.ok(combatProviders.some(({ ids }) => ids.includes(8713)));
  assert.equal(areas.length, 1);
  assert.equal(areas[0].getName(), "Sarachnis' Lair");
  assert.equal(areas[0].isMulti(), true);
  assert.deepEqual(Object.keys(objectHooks["Web"] ?? {}).sort(), ["Peek", "Slash"]);
  assert.deepEqual(
    Object.keys(objectHooks["Thick Web"] ?? {}).sort(),
    ["Enter-crypt", "Exit", "Fight-privately", "Quick-Exit", "Quick-enter"]
  );
  runTicks(1);
});

// ------------------------------------------------------------------ entrance

test("Peek counts the room, captured for empty", () => {
  assert.equal(Entrance._test.peekText(0), "You listen and hear no adventurers inside the crypt");
  assert.equal(Entrance._test.peekText(1), "You listen and hear 1 adventurer inside the crypt");
  assert.equal(Entrance._test.peekText(3), "You listen and hear 3 adventurers inside the crypt");
});

test("the boots wade through; a tool slashes; otherwise refused", () => {
  const moves = [];
  const booted = {
    getEquipment: () => ({ get: () => ({ getId: () => 29806 }), getItems: () => [] }),
    getFightType: () => ({ getBonusType: () => 0 }),
    getInventory: () => ({ getItems: () => [] }),
    getMovementQueue: () => ({ reset: () => {}, setBlockMovement: () => {} }),
    performAnimation: () => {},
    isRegistered: () => true,
    moveTo: (to) => moves.push([to.getX(), to.getY()]),
  };
  const event = { player: booted, objectId: Common.PEEK_WEB_ID, location: { x: 1847, y: 9919, z: 0 } };
  assert.equal(Entrance._test.slashWeb(event), true);
  runTicks(1);
  assert.deepEqual(moves, [[1847, 9919]]);
  // Another server's webs are none of its business.
  assert.equal(Entrance._test.slashWeb({ ...event, objectId: 60759 }), false);
  assert.equal(Entrance._test.peek({ player: {}, objectId: 60759 }), false);

  const bare = {
    getEquipment: () => ({ get: () => ({ getId: () => -1 }), getItems: () => [] }),
    getFightType: () => ({ getBonusType: () => 0 }),
    getInventory: () => ({ getItems: () => [] }),
    sendMessage: (text) => bare.message = text,
  };
  assert.equal(Entrance._test.slashWeb({ player: bare, objectId: Common.PEEK_WEB_ID, location: { x: 1847, y: 9919, z: 0 } }), true);
  assert.match(bare.message, /slash weapon or a knife/);
});

test("the instance fee is 25k, 12.5k with the hard tier done", () => {
  const full = { getPacketSender: () => ({ getVarbit: () => 0 }) };
  const discounted = { getPacketSender: () => ({ getVarbit: (id) => (id === Common.HARD_TIER_VARBIT ? 1 : 0) }) };
  assert.equal(Entrance._test.instanceFee(full), 25000);
  assert.equal(Entrance._test.instanceFee(discounted), 12500);
  assert.equal(Common.HARD_TIER_VARBIT, 12865);
});

// ------------------------------------------------------------------ tasks

test("the three fight tasks judge what the fight saw", () => {
  const Data = require("../plugins/achievements/combatachievements/Data.CombatAchievements");
  Data(api);
  for (const name of ["Newspaper Enthusiast", "Ready to Pounce", "Inspect Repellent"]) {
    assert.ok(Data.taskNamed(name), `cache has "${name}"`);
  }
  assert.equal(Data.taskNamed("Newspaper Enthusiast").description, "Kill Sarachnis with a crush weapon.");
  const Fights = require("../plugins/achievements/combatachievements/Fights.CombatAchievements");
  Fights(api);
  const captured = {};
  require("../plugins/achievements/combatachievements/tasks/Sarachnis.CombatAchievements")(
    {}, { onKill: (name, tests) => { captured[name] = tests; } }
  );
  const rules = captured["Sarachnis"];
  assert.ok(rules["Newspaper Enthusiast"] && rules["Ready to Pounce"] && rules["Inspect Repellent"]);
  const crushFight = Fights.summary({}, fakeNpc(Common.BOSS_ID), {
    startTick: 0, lastTick: 100,
    dealt: [{ tick: 10, type: "MELEE", attackType: "crush", special: false, weapon: 23528, damage: 20 }],
    killingBlow: { tick: 100, type: "MELEE", special: false, weapon: 23528, prayers: new Set() },
  }, { npc: fakeNpc(Common.BOSS_ID), killer: {}, damagers: [{}] });
  assert.equal(rules["Newspaper Enthusiast"](crushFight), true);
  const stabFight = Fights.summary({}, fakeNpc(Common.BOSS_ID), {
    startTick: 0, lastTick: 100,
    dealt: [{ tick: 10, type: "MELEE", attackType: "stab", special: false, weapon: 1, damage: 20 }],
    killingBlow: { tick: 100, type: "MELEE", special: false, weapon: 1, prayers: new Set() },
  }, { npc: fakeNpc(Common.BOSS_ID), killer: {}, damagers: [{}] });
  assert.equal(rules["Newspaper Enthusiast"](stabFight), false);
  const clean = { getAttribute: () => null };
  const doubled = { getAttribute: (key) => (key === Common.ATTR_RANGED_TWICE ? true : null) };
  const bloody = { getAttribute: (key) => (key === Common.ATTR_DEALT_DAMAGE ? true : null) };
  assert.equal(rules["Ready to Pounce"]({}, { npc: clean }), true);
  assert.equal(rules["Ready to Pounce"]({}, { npc: doubled }), false);
  assert.equal(rules["Inspect Repellent"]({}, { npc: clean }), true);
  assert.equal(rules["Inspect Repellent"]({}, { npc: bloody }), false);
});

// ------------------------------------------------------------------ teleports

test("::teleports lists Sarachnis in the new interface and the dialogue", () => {
  const TeleportInterface = require("../plugins/interface/TeleportInterface.plugin");
  const sarachnis = TeleportInterface._test.Destinations.byKey("sarachnis");
  assert.ok(sarachnis.tabs.includes(TeleportInterface._test.TAB.BOSSES));
  assert.deepEqual(sarachnis.tile.slice(0, 2), [1842, 9913]);
});

test("the thick web lets out from the boss side, and the web passes both ways", () => {
  const stepped = [];
  const moved = [];
  const inside = {
    getLocation: () => new Location(1842, 9911, 0),
    getPacketSender: () => ({ sendInterfaceRemoval: () => {} }),
    getMovementQueue: () => ({ walkStep: (dx, dy) => stepped.push([dx, dy]) }),
    moveTo: (to) => moved.push([to.getX(), to.getY()]),
    isRegistered: () => true,
  };
  assert.equal(Entrance._test.quickEnter({ player: inside, objectId: Common.ENTRANCE_ID }), true);
  assert.deepEqual(moved, [[1842, 9913]]);
  assert.deepEqual(stepped, []);
  assert.equal(Entrance._test.enterCrypt({ player: inside, objectId: Common.ENTRANCE_ID }), true);
  assert.deepEqual(moved, [[1842, 9913], [1842, 9913]]);

  // South of the tomb web, Slash wades north onto it too.
  const wades = [];
  const southerner = {
    getEquipment: () => ({ get: () => ({ getId: () => 29806 }), getItems: () => [] }),
    getFightType: () => ({ getBonusType: () => 0 }),
    getInventory: () => ({ getItems: () => [] }),
    getMovementQueue: () => ({ reset: () => {}, setBlockMovement: () => {} }),
    performAnimation: () => {},
    isRegistered: () => true,
    moveTo: (to) => wades.push([to.getX(), to.getY()]),
  };
  const fromSouth = { player: southerner, objectId: Common.PEEK_WEB_ID, location: { x: 1847, y: 9919, z: 0 } };
  southerner.getLocation = () => new Location(1847, 9918, 0);
  assert.equal(Entrance._test.slashWeb(fromSouth), true);
  runTicks(1);
  assert.deepEqual(wades, [[1847, 9919]]);
});

test("a rented instance is entered on the other side of the web", () => {
  let area = null;
  let at = new Location(1842, 9912, 0);
  const steps = [];
  const messages = [];
  const renter = {
    getLocation: () => at,
    getPacketSender: () => ({ sendInterfaceRemoval: () => {}, getVarbit: () => 0 }),
    getBank: () => ({ getAmount: () => 30000, delete: () => {} }),
    getMovementQueue: () => ({
      reset: () => {},
      setBlockMovement: () => {},
      walkStep: (dx, dy) => { at = new Location(at.getX() + dx, at.getY() + dy, 0); },
    }),
    getDialogueManager: () => ({ startDialogues: () => {} }),
    getArea: () => area,
    setArea: (next) => { area = next; },
    getPrivateArea: () => (area instanceof Lair._test.instanceClass() ? area : null),
    getIndex: () => 7,
    isPlayer: () => true,
    isRegistered: () => true,
    getAsPlayer: function () { return renter; },
    moveTo: (to) => { at = to; },
    sendMessage: (text) => messages.push(text),
    getAttribute: () => null,
    setAttribute: () => {},
  };
  assert.equal(Entrance._test.fightPrivately({ player: renter, objectId: Common.ENTRANCE_ID }), true);
  assert.deepEqual([at.getX(), at.getY()], [1842, 9911]);
  assert.ok(messages.some((text) => text.includes("25,000")));
  // Atomic: the instance exists in the same tick as the payment, then the step in.
  assert.ok(renter.getPrivateArea() instanceof Lair._test.instanceClass());
});
