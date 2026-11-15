// Run after `yarn build`: node --test tests/prifddinas-rabbit.test.cjs
// The Prifddinas rabbit (Wiki: Rabbit (Prifddinas), Elven rabbit cave): the ids against the
// cache's gamevals, what the data already holds (its spawn, stats, drops and immunities), the
// cave's Enter and Exit, the cannon refusal, and the plugin's own rules: the 6-hour respawn,
// the Defence-based Magic defence roll, thrall, freeze and Monster Examine/Inspect immunity,
// and the reset when its target leaves the cave.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
const { Spell } = require("../dist/game/content/combat/magic/Spell");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Rabbit = require("../plugins/bosses/PrifddinasRabbit.plugin");
const MonsterInspect = require("../plugins/combat/MonsterInspect.plugin");

const RABBIT = 9118;
const CAVE_ENTRANCE = 36598;
const CAVE_EXIT = 36597;
const CRYSTAL_GRAIL = 24000;
const RABBIT_BONE = 7896;
const SPAWN = [3295, 12581];
const CANNON_REFUSAL = "A strange magical force won't let you set up a cannon here.";
/** The NPC.getDefenceBonus slot of Magic defence (as the Eye of Ayak's special reads it). */
const MAGIC_DEFENCE_BONUS = 3;

const core = PluginManager.getCoreApi();
const hooks = {};
const areas = [];
const startup = [];
const spellOnNpc = [];
const attackSpeed = [];

function emit(name, event) {
  // Dream Mentor is done for Monster Examine; the quest plugins are not loaded here.
  if (name === "quest:is-complete") event.complete = true;
  for (const handler of hooks[name] ?? []) handler(event);
}

const api = new Proxy(
  {
    core,
    registerArea: (area) => areas.push(area),
    onServerStartup: (handler) => startup.push(handler),
    onCustomEvent: (name, handler) => { (hooks[name] ??= []).push(handler); },
    onSpellOnNpc: (handler) => spellOnNpc.push(handler),
    onAttackSpeed: (handler) => attackSpeed.push(handler),
    emitCustomEvent: emit,
  },
  { get: (target, key) => target[key] ?? (() => {}) },
);

let gamevals = null;
let cave = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  new NpcDefinitionLoader().load();
  gamevals = new Gamevals();
  Rabbit.register(api);
  MonsterInspect.register(api);
  cave = areas[0];
  for (const handler of startup) handler({});
});

const at = ([x, y, z = 0]) => new core.Location(x, y, z);
const inCave = ({ x, y, z = 0 }) =>
  z === Rabbit.CAVE.z && x >= Rabbit.CAVE.minX && x <= Rabbit.CAVE.maxX && y >= Rabbit.CAVE.minY && y <= Rabbit.CAVE.maxY;

function rabbit() {
  const npc = core.NPC.create(RABBIT, at(SPAWN));
  npc.isRegistered = () => true;
  npc.setNeedsPlacement(false);
  return npc;
}

/** A player standing in the cave, every packet recorded on `sent`. */
function player(name, index, x = 3296, y = 12580) {
  const p = new Player(null);
  p.setUsername(name);
  p.setIndex(index);
  const sent = [];
  const sender = new Proxy({}, { get: (_, key) => (...args) => { sent.push([key, ...args]); return sender; } });
  p.getPacketSender = () => sender;
  p.sent = sent;
  p.setLocation(new core.Location(x, y, 0));
  p.isRegistered = () => true;
  p.setNeedsPlacement(false);
  return p;
}

const messages = (p) => p.sent.filter(([name]) => name === "sendMessage").map(([, message]) => message);

/** The first object in `value` that `matches`, depth first. */
function find(value, matches) {
  if (!value || typeof value !== "object") return null;
  if (matches(value)) return value;
  for (const child of Object.values(value)) {
    const found = find(child, matches);
    if (found) return found;
  }
  return null;
}

// ------------------------------------------------------------------ the cache and the data

test("the ids are the cache's rabbit gamevals, and the plugin is members-only", () => {
  assert.equal(core.NpcIdentifiers.RABBIT_12, RABBIT);
  assert.equal(gamevals.namesOf(GamevalKind.NPC).get(RABBIT), "caerbannog");
  const loc = gamevals.namesOf(GamevalKind.LOC);
  assert.equal(loc.get(CAVE_ENTRANCE), "prif_rabbit_cave_entrance");
  assert.equal(loc.get(CAVE_EXIT), "prif_rabbit_cave_exit");
  assert.equal(core.ObjectIdentifiers.CAVE_72, CAVE_ENTRANCE);
  assert.equal(core.ObjectIdentifiers.STEPS_16, CAVE_EXIT);
  assert.equal(core.ItemIdentifiers.CRYSTAL_GRAIL, CRYSTAL_GRAIL);
  assert.equal(Rabbit.name, "PrifddinasRabbit");
  assert.equal(Rabbit.members, true);
});

test("the data holds the Wiki's rabbit: one spawn in the cave, its stats and immunities, the grail and the rabbit bone", () => {
  const spawns = require("../data/definitions/npc-spawns.json");
  const all = Array.isArray(spawns) ? spawns : spawns.spawns ?? Object.values(spawns).flat();
  assert.deepEqual(all.filter((spawn) => spawn.id === RABBIT).map(({ x, y }) => [x, y]), [SPAWN]);
  assert.ok(inCave({ x: SPAWN[0], y: SPAWN[1] }));

  const monster = require("../data/definitions/monsters-complete.json")[String(RABBIT)];
  assert.equal(monster.wiki_name, "Rabbit (Prifddinas)");
  assert.deepEqual(
    [monster.combat_level, monster.hitpoints, monster.max_hit, monster.attack_speed, monster.aggressive, monster.members],
    [2, 2000, 40, 3, false, true],
  );
  assert.deepEqual([monster.defence_level, monster.magic_level, monster.immune_poison, monster.immune_venom], [450, 300, true, true]);
  const definition = core.NpcDefinition.forId(RABBIT);
  assert.equal(definition.getMaxHit(), 40);
  assert.equal(definition.getAttackSpeed(), 3);
  assert.equal(definition.isPoisonImmune(), true);
  assert.equal(definition.isMembers(), true);

  const drops = require("../data/definitions/npc-drops.json");
  const table = find(drops, (value) => value.table_id === "rabbit_prifddinas");
  assert.deepEqual(table.entries.map(({ item_id, always }) => [item_id, always]), [[CRYSTAL_GRAIL, true]]);
  assert.deepEqual(table.tertiary.map(({ item_id, rarity }) => [item_id, rarity]), [[RABBIT_BONE, 0.25]]);
  assert.ok(table.tertiary[0].notes.some((note) => note.includes("Rag and Bone Man II")));
});

test("the crystal grail sways like the ale of the gods: the cache's drunk hold-item stand and walk", () => {
  const seqs = gamevals.namesOf(GamevalKind.SEQ);
  assert.equal(seqs.get(3040), "drunk_holditem_ready");
  assert.equal(seqs.get(3039), "drunk_holditem_walk");
  const rows = require("node:fs").readFileSync(path.join(__dirname, "../data/definitions/item-gameplay.json"), "utf8")
    .split("\n").filter((line) => /^\s*\{"id":(20056|24000),/.test(line)).map((line) => JSON.parse(line.trim().replace(/,$/, "")));
  assert.deepEqual(rows.map((row) => row.name).sort(), ["Ale of the gods", "Crystal grail"]);
  for (const row of rows) {
    // Wiki: they sway "when standing or walking"; running and turning keep the human defaults.
    assert.deepEqual(
      [row.standAnim, row.walkAnim, row.runAnim, row.standTurnAnim, row.turn180Anim, row.turn90CWAnim, row.turn90CCWAnim],
      [3040, 3039, 824, 823, 820, 821, 821], row.name,
    );
  }
});

// ------------------------------------------------------------------ in and out

test("the Cave's Enter lands in the cave above the Steps, and the Steps' Exit lands below the Cave", () => {
  const { locs } = require("../plugins/world/data/loc-teleports.json");
  const entrance = locs.find((entry) => entry.name === "prif_rabbit_cave_entrance");
  const exit = locs.find((entry) => entry.name === "prif_rabbit_cave_exit");
  assert.deepEqual([entrance.id, entrance.option, entrance.x, entrance.y, entrance.z], [CAVE_ENTRANCE, "Enter", 2264, 3418, 0]);
  assert.deepEqual(entrance.to, [3295, 12574, 0]);
  assert.deepEqual([exit.id, exit.option, exit.x, exit.y, exit.z], [CAVE_EXIT, "Exit", 3294, 12572, 0]);
  assert.deepEqual(exit.to, [2265, 3417, 0]);
  for (const entry of [entrance, exit]) {
    assert.equal(core.CacheDefinitions.getObject(entry.id).actions[entry.op - 1], entry.option);
    assert.equal(entry.fade, true);
    // Both from the 2026-11-15 recording: 9 crossings each way, all alike.
    assert.equal(entry.recordings, 1);
    assert.match(entry.source, /^RSProx capture 2026-11-15/);
    // Captured: the fade out two ticks after arriving, the move on tick 4.
    assert.deepEqual([entry.animTick, entry.tick], [2, 4], entry.name);
    RegionManager.loadMapFiles(entry.to[0], entry.to[1]);
    assert.equal(RegionManager.blocked(at(entry.to), null), false, `${entry.name} lands on a walkable tile`);
  }
  assert.ok(inCave({ x: entrance.to[0], y: entrance.to[1] }), "in: inside the cave area");
  assert.ok(!inCave({ x: exit.to[0], y: exit.to[1] }), "out: outside it");
  assert.equal(gamevals.namesOf(GamevalKind.SEQ).get(entrance.anim), "human_longcrawl");
  assert.deepEqual([entrance.sound, entrance.soundDelay], [2454, 4]);
  assert.equal(exit.anim, undefined, "the Steps play no animation of their own");
  assert.equal(exit.sound, undefined);
});

test("live's rabbit roams the whole cave floor out of combat, so its spawn wanders 7 tiles", () => {
  const spawns = require("../data/definitions/npc-spawns.json");
  const all = Array.isArray(spawns) ? spawns : spawns.spawns ?? Object.values(spawns).flat();
  const spawn = all.find((entry) => entry.id === RABBIT);
  assert.equal(spawn.wanderRadius, 7);
  // Captured (2026-11-15) at (3293, 12574) and across x 3291-3300: every floor tile is in reach.
  const { minX, maxX, minY, maxY } = Rabbit.CAVE;
  for (const [x, y] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY], [3293, 12574]]) {
    assert.ok(Math.max(Math.abs(x - spawn.x), Math.abs(y - spawn.y)) <= spawn.wanderRadius, `${x},${y}`);
  }
});

test("a cannon can't be set up in the cave: the Wiki's message over the whole floor", () => {
  const { restrictions } = require("../plugins/items/data/cannon-restrictions.json");
  const entry = restrictions.find((restriction) => restriction.name === "Elven rabbit cave");
  assert.equal(entry.message, CANNON_REFUSAL);
  const { minX, maxX, minY, maxY, z } = Rabbit.CAVE;
  assert.deepEqual(entry.areas, [{ points: [[minX, minY], [maxX + 1, minY], [maxX + 1, maxY + 1], [minX, maxY + 1]], z }]);
  const Restrictions = require("../plugins/items/dwarfcannon/Restrictions.DwarfCannon");
  assert.equal(Restrictions.restrictionAt(at(SPAWN)), CANNON_REFUSAL);
  assert.equal(Restrictions.restrictionAt(at([3295, 12574])), CANNON_REFUSAL, "the landing tile");
  assert.equal(Restrictions.restrictionAt(at([2265, 3417])), null, "outside the Cave");
});

// ------------------------------------------------------------------ the plugin's rules

test("it respawns 6 hours after death: the cave is shared, so one rabbit for everyone", () => {
  assert.equal(Rabbit.RESPAWN_TICKS, 6 * 60 * 60 / 0.6);
  assert.equal(core.NpcDefinition.forId(RABBIT).getRespawn(), Rabbit.RESPAWN_TICKS);
});

test("it attacks every 4 ticks as captured, though the generated data says 3; nobody else's speed changes", () => {
  assert.equal(Rabbit.ATTACK_SPEED, 4);
  const speed = (attacker) => {
    const event = { attacker, target: null, combatType: core.CombatType.MELEE, speed: 3 };
    for (const handler of attackSpeed) handler(event);
    return event.speed;
  };
  assert.equal(speed(rabbit()), 4);
  assert.equal(speed(player("speed", 1)), 3);
  assert.equal(speed(core.NPC.create(core.NpcIdentifiers.MAN, at(SPAWN))), 3);
});

test("its death plays rabbit_update_death and keeps it 5 ticks before the grail lands, as captured", () => {
  const definition = core.NpcDefinition.forId(RABBIT);
  assert.equal(gamevals.namesOf(GamevalKind.SEQ).get(definition.getDeathAnim()), "rabbit_update_death");
  assert.deepEqual([definition.getAttackAnim(), definition.getDefenceAnim(), definition.getDeathAnim()], [6090, 6091, 6092]);
  // Live: killing hit T, the drop and removal on T+6; NPCDeathTask animates on T+1 and removes deathTicks later.
  assert.equal(definition.getDeathTicks(), 5);
});

test("its Magic defence roll uses its Defence level in place of its Magic level", () => {
  const npc = rabbit();
  const magic = npc.getCurrentLevel(core.Skill.MAGIC) + 9;
  const defence = npc.getCurrentLevel(core.Skill.DEFENCE) + 9;
  const bonus = npc.getDefenceBonus(MAGIC_DEFENCE_BONUS) + 64;
  assert.deepEqual([magic, defence, bonus], [309, 459, 214]);
  assert.equal(AccuracyFormulasDpsCalc.defenseMagicRoll(npc), magic * bonus, "the engine's roll, from its Magic level");
  const request = { attacker: null, target: npc, spell: null, defenceRoll: magic * bonus };
  emit("combat:magic-defence-roll", request);
  assert.equal(request.defenceRoll, defence * bonus);

  const other = { attacker: null, target: { isNpc: () => true, getId: () => core.NpcIdentifiers.RABBIT }, spell: null, defenceRoll: 1000 };
  emit("combat:magic-defence-roll", other);
  assert.equal(other.defenceRoll, 1000, "another rabbit is untouched");
});

test("a thrall's attack lands no hit on it", () => {
  const attack = { player: null, thrall: null, target: rabbit(), cancelled: false };
  emit("magic:thrall-attack", attack);
  assert.equal(attack.cancelled, true);
  const other = { player: null, thrall: null, target: { isNpc: () => true, getId: () => core.NpcIdentifiers.RABBIT }, cancelled: false };
  emit("magic:thrall-attack", other);
  assert.equal(other.cancelled, false);
});

test("no thrall rises in the cave: the captured message, before the cast; outside it is untouched", (t) => {
  t.mock.method(PluginManager, "emitCustomEvent", emit);
  const { ArceuusThralls } = require("../dist/game/content/combat/magic/ArceuusThralls");
  assert.equal(ArceuusThralls.refusal(player("necro", 1)), "You can't resurrect a thrall here.");
  assert.equal(Rabbit.THRALL_REFUSAL, "You can't resurrect a thrall here.");
  assert.equal(ArceuusThralls.refusal(player("outside", 2, 2265, 3417)), null, "outside the Cave");
  // Every resurrect spell asks it before its runes, cooldown or prayer are touched.
  const { ArceuusSpells } = require("../dist/game/content/combat/magic/ArceuusSpells");
  const resurrects = [...ArceuusSpells.SELF_SPELLS].filter(([key]) => key.startsWith("resurrect "));
  assert.equal(resurrects.length, 9);
  const caster = player("necro", 3);
  for (const [key, spell] of resurrects) assert.equal(spell.data.blocked(caster), Rabbit.THRALL_REFUSAL, key);
});

test("damage stays: it regenerates 1 Hitpoint every 10 ticks, not the server's tenth a tick", (t) => {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const npc = rabbit();
  npc.setHitpoints(1866);
  cave.process(npc); // the first tick starts its clock and turns the default regeneration off
  assert.equal(npc.hasFlag("combat:no-regen"), true);
  assert.equal(Rabbit.REGEN_TICKS, 10);
  cycle += 9;
  cave.process(npc);
  assert.equal(npc.getHitpoints(), 1866, "nothing before 10 ticks");
  cycle += 1;
  cave.process(npc);
  assert.equal(npc.getHitpoints(), 1867);
  cycle += 35; // ticks it wasn't processed still count
  cave.process(npc);
  assert.equal(npc.getHitpoints(), 1870);
  npc.setHitpoints(2000);
  cycle += 10;
  cave.process(npc);
  assert.equal(npc.getHitpoints(), 2000, "never past its maximum");
  // The recording's bounds (20261115T080012-f20d3d7): at most 8 in 60 ticks, at least 1 in 22.
  assert.ok(Math.floor(60 / Rabbit.REGEN_TICKS) <= 8 && Math.floor(22 / Rabbit.REGEN_TICKS) >= 1);
});

test("the cave refuses a freeze on it (only a visual stall) and has no opinion on anyone else", () => {
  assert.equal(cave.getName(), "Elven rabbit cave");
  assert.equal(cave.canFreeze(rabbit(), null), false);
  assert.equal(cave.canFreeze(player("frozen", 9), null), null);
  const npc = rabbit();
  cave.enter(npc);
  npc.setArea(cave); // as AreaManager does when it walks in
  core.CombatFactory.freezeTicks(npc, 32, null, null, "ice barrage");
  assert.equal(npc.getTimers().has(core.TimerKey.FREEZE), false, "Ice Barrage never holds it");
  cave.leave(npc, false);
  npc.setArea(null);
});

test("a player can't block it: it walks under players, a fresh or respawned rabbit too", () => {
  const npc = rabbit();
  assert.equal(npc.canWalkThroughNPCs(), false, "a new NPC, before the cave's tick");
  cave.process(npc);
  assert.equal(npc.hasFlag(core.NPC.WALK_THROUGH_ENTITIES_FLAG), true);
  assert.equal(npc.canWalkThroughNPCs(), true);

  // The engine's own check: a player on the next tile no longer stops it.
  const blocker = player("blocker", 7, SPAWN[0], SPAWN[1] + 1);
  const occupying = (target) => core.World.isPlayerOccupyingTile(target, null, 1, null, true);
  const original = core.World.isPlayerOccupyingTile;
  core.World.isPlayerOccupyingTile = (tile) => tile.getX() === blocker.getLocation().getX() && tile.getY() === blocker.getLocation().getY();
  try {
    assert.equal(occupying(at([SPAWN[0], SPAWN[1] + 1])), true, "the blocker is on the tile");
    assert.equal(npc.getMovementQueue().isDynamicallyOccupied(at([SPAWN[0], SPAWN[1] + 1])), false, "the rabbit steps under them");
    const other = core.NPC.create(core.NpcIdentifiers.RABBIT, at(SPAWN));
    assert.equal(other.getMovementQueue().isDynamicallyOccupied(at([SPAWN[0], SPAWN[1] + 1])), true, "an ordinary rabbit is blocked");
  } finally {
    core.World.isPlayerOccupyingTile = original;
  }
});

test("every kill drops the crystal grail; the rabbit bone only during Rag and Bone Man II", () => {
  const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");
  // RagAndBoneManII.Quest.js answers the bone's quest condition: allowed only while the quest
  // is in progress and the bone not yet handed in.
  let duringQuest = false;
  NpcDrops.register({
    core,
    getPluginConfig: (key, fallback) => fallback,
    getItemOnGroundManager() {},
    onCustomEvent() {},
    emitCustomEvent: (name, event) => {
      if (name === "npc-drops:quest-item" && event.itemId === RABBIT_BONE) event.allowed = duringQuest;
    },
    onNpcDeath() {},
    registerCommand() {},
    log() {},
  });
  const { __internals } = NpcDrops;
  __internals.loadDrops();
  const [table] = __internals.tablesByNpc.get(RABBIT);
  assert.equal(__internals.questRequirement(table.tertiary[0]).key, "quest_ragandboneman2");
  const killer = { getAttribute: () => undefined, getInventory: () => ({ getAmount: () => 0 }), getBanks: () => [] };
  const npc = rabbit();
  const original = Math.random;
  const bones = (drops) => drops.filter((drop) => drop.itemId === RABBIT_BONE).length;
  try {
    for (const random of [0, 0.5, 0.999]) {
      Math.random = () => random;
      const drops = __internals.rollTable(table, killer, npc);
      assert.equal(drops.filter((drop) => drop.itemId === CRYSTAL_GRAIL).length, 1, `grail at ${random}: ${JSON.stringify(drops)}`);
      assert.equal(bones(drops), 0, "no bone outside the quest");
    }
    duringQuest = true;
    Math.random = () => 0;
    assert.equal(bones(__internals.rollTable(table, killer, npc)), 1, "during the quest, a lucky roll drops it");
    Math.random = () => 0.999;
    assert.equal(bones(__internals.rollTable(table, killer, npc)), 0, "and an unlucky one doesn't (1/4)");
  } finally {
    Math.random = original;
  }
});

test("Monster Examine is refused on it with the Wiki's message, before the spell casts", (t) => {
  t.mock.method(PluginManager, "emitCustomEvent", emit);
  t.mock.method(Spell.prototype, "canCast", () => true);
  const p = player("examiner", 1);
  assert.equal(LunarSpells.handleNpcTarget(p, rabbit(), "Monster Examine"), true, "the click is taken");
  assert.deepEqual(messages(p), [Rabbit.EXAMINE_REFUSAL]);
  assert.ok(!p.sent.some(([name]) => name === "sendMagicTabInterface"), "no stats panel");

  const other = { player: p, npc: { isNpc: () => true, getId: () => core.NpcIdentifiers.RABBIT }, spell: "Monster Examine", refusal: null };
  emit("magic:can-examine-npc", other);
  assert.equal(other.refusal, null, "another rabbit can be examined");
});

test("Monster Inspect is refused on it too, and its runes stay", () => {
  const widget = core.CacheDefinitions.getSpellByName("Monster Inspect");
  const resolution = { spellName: "Monster Inspect", spellWidget: widget.widgetId, spell: null };
  emit("magic:resolve-spell", resolution);
  assert.ok(resolution.spell, "the cache's Monster Inspect");
  const p = player("inspector", 1);
  let consumed = 0;
  const event = { player: p, npc: rabbit(), spell: resolution.spell, handled: false, consumeRunes: () => { consumed++; return true; } };
  for (const handler of spellOnNpc) handler(event);
  assert.equal(event.handled, true);
  assert.equal(consumed, 0);
  assert.deepEqual(messages(p), [Rabbit.EXAMINE_REFUSAL]);
  assert.ok(!p.sent.some(([name]) => name === "sendMagicTabInterface"), "no stats panel");
});

test("its target walking out resets its aggression and stats; someone else leaving does not", () => {
  const npc = rabbit();
  const leaver = player("leaver", 1);
  const target = player("target", 2, 3297, 12580);
  cave.enter(npc);
  cave.enter(leaver);
  cave.enter(target);
  assert.deepEqual(cave.getPlayers().map((p) => p.getUsername()).sort(), ["leaver", "target"]);
  npc.getCombat().target = target;
  npc.setCurrentLevels(core.Skill.DEFENCE, 100);
  npc.setCurrentLevels(core.Skill.ATTACK, 50);
  assert.equal(npc.getCurrentLevel(core.Skill.DEFENCE), 100);

  cave.leave(leaver, false);
  assert.equal(npc.getCombat().getTarget(), target, "its target is still inside");
  assert.equal(npc.getCurrentLevel(core.Skill.DEFENCE), 100);

  cave.leave(target, false);
  assert.equal(npc.getCombat().getTarget(), null, "aggression reset");
  assert.equal(npc.getCurrentLevel(core.Skill.DEFENCE), 450, "stats reset");
  assert.equal(npc.getCurrentLevel(core.Skill.ATTACK), 600);
  cave.leave(npc, false);
});

test("the last player out resets it even when it was fighting nobody; a drained Magic defence bonus stays (the Eye of Ayak)", () => {
  const npc = rabbit();
  const only = player("only", 1);
  cave.enter(npc);
  cave.enter(only);
  npc.setCurrentLevels(core.Skill.MAGIC, 10);
  const before = npc.getDefenceBonus(MAGIC_DEFENCE_BONUS);
  const overrides = [];
  overrides[MAGIC_DEFENCE_BONUS] = before - 100;
  npc.setDefenceBonusOverrides(overrides);
  assert.equal(npc.getDefenceBonus(MAGIC_DEFENCE_BONUS), before - 100);

  cave.leave(only, false);
  assert.equal(npc.getCurrentLevel(core.Skill.MAGIC), 300, "its level is back");
  assert.equal(npc.getDefenceBonus(MAGIC_DEFENCE_BONUS), before - 100, "the drained bonus is not a level, so it stays");
  cave.leave(npc, false);
});
