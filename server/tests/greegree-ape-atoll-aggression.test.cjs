// Ape Atoll natives in human form (#4101 B7). The Wiki (Monkey Madness I, Introduction): "All native creatures other than
// the level 5 birds will be aggressive towards you, regardless of your combat level, whenever you're not wearing the monkey
// greegree." The infoboxes add the Monkey Madness II gate. The explicit flip set is cross-checked against the Wiki's creature
// lists (Spider 5238, Jungle spider 5243, Snake 5244, Monkey Guard 5275/5276).
//
// The tolerance timer (NpcAggression :52) and the aggression range (:83) are NOT changed: the Wiki sentence is silent on them.
// Real greegree area object (registered through the plugin's own register), real NpcAggression.runAggression decision.
//
// Run after `yarn build`: node --test tests/greegree-ape-atoll-aggression.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NpcAggression } = require("../dist/game/entity/impl/npc/NpcAggression");
const { AggressionTolerance } = require("../dist/game/entity/impl/npc/AggressionTolerance");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const greegrees = require("../plugins/items/Greegrees.plugin");
const core = PluginManager.getCoreApi();

const FORM_ATTRIBUTE = "greegrees:form";
const TOLERANCE_ATTRIBUTE = AggressionTolerance.ATTRIBUTE;
const MM2 = "monkey_madness_ii";
let mm2Complete = false;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  // The production plugin registers the greegree area; the quest-completion answer comes from a stub that
  // stands in for Monkey Madness II (the event the diary plugins and the quest itself use).
  greegrees.register(PluginManager.createApi("GreegreesAggressionTest"));
  const quests = PluginManager.createApi("GreegreesAggressionQuestStub");
  quests.onCustomEvent("quest:is-complete", (request) => {
    if (request.key === MM2 && mm2Complete) request.complete = true;
  });
});

/** A human (or monkey, with `form`) player at `at`, level 90 (combat level well above a level 1 spider). */
function human(at, { level = 90, form = null, tolerance = null } = {}) {
  const player = new Player(null);
  player.setUsername("greegree-aggression");
  const sender = new Proxy({ getVarbit: () => 0, getVarp: () => 0 },
    { get: (object, key) => object[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true, processPackets: () => {} });
  player.setLocation(at.clone());
  // The engine assigns a mobile's area on its area pass each tick; run that pass once so the player is in the greegree area.
  AreaManager.process(player);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.autoRetaliateReturn = () => false;
  for (const skill of core.Skill.values()) {
    player.getSkillManager().setCurrentLevel(skill, level);
    player.getSkillManager().setMaxLevel(skill, level);
  }
  if (form) player.setAttribute(FORM_ATTRIBUTE, form);
  if (tolerance) player.setAttribute(TOLERANCE_ATTRIBUTE, tolerance);
  return player;
}

/** A real NPC of `npcId`: its spawn at `spawn`, standing at `at`. */
function npc(t, npcId, spawn, at = spawn) {
  const created = core.NPC.create(npcId, at.clone());
  created.setSpawnPosition(spawn.clone());
  created.isRegistered = () => true;
  created.setNeedsPlacement(false);
  created.setHitpoints(500);
  t.after(() => { core.World.unregisterNpcPosition(created); });
  return created;
}

/** Runs the real aggression decision for one NPC and reports whether it took the player as its target. */
function hunts(player, creature) {
  NpcAggression.runAggression(player, [creature]);
  return creature.getCombat().getTarget() === player;
}

const at = (x, y, z = 0) => new core.Location(x, y, z);
const SPIDER = core.NpcIdentifiers.SPIDER_5;            // 5238, cl1
const JUNGLE_SPIDER = core.NpcIdentifiers.JUNGLE_SPIDER_2; // 5243, cl37
const SNAKE = core.NpcIdentifiers.SNAKE_4;              // 5244, cl24
const GUARD = core.NpcIdentifiers.MONKEY_GUARD_2;       // 5275, cl167
const BIRD_LEVEL_5 = core.NpcIdentifiers.BIRD_2;        // 5241, the exemption
const BIRD_LEVEL_11 = core.NpcIdentifiers.BIRD;         // 5240, Wiki: Nature Altar only
const STINGRAY = core.NpcIdentifiers.STINGRAY;          // 15218, Wiki: sea only
const FAR_SPIDER = 3019;                                // Spider (Ape Atoll not; 180 spawns elsewhere, aggressive false)

// Ape Atoll island spider spawn (npc-spawns.json: Spider 5238 at 2734,2792).
const SPIDER_SPAWN = at(2734, 2792);

test("human form: a level 90 player is hunted by a flipped spider (the combat-level gate is lifted)", (t) => {
  const creature = npc(t, SPIDER, SPIDER_SPAWN);
  const player = human(at(2734, 2793));
  assert.equal(hunts(player, creature), true);
});

test("human form: the Wiki's flipped natives: jungle spider, snake and guard are aggressive too", (t) => {
  assert.equal(hunts(human(at(2737, 2793)), npc(t, JUNGLE_SPIDER, at(2736, 2793))), true, "jungle spider");
  assert.equal(hunts(human(at(2732, 2740)), npc(t, SNAKE, at(2732, 2740), at(2732, 2740))), true, "snake");
  assert.equal(hunts(human(at(2788, 2778)), npc(t, GUARD, at(2788, 2778))), true, "monkey guard (B6 guard part)");
});

test("the aggression range still applies: 8 tiles from the spawn is inside, 9 is outside", (t) => {
  const inside = npc(t, SPIDER, SPIDER_SPAWN, at(2742, 2792));
  assert.equal(hunts(human(at(2742, 2793)), inside), true, "eight tiles east of the spawn");
  const outside = npc(t, SPIDER, SPIDER_SPAWN, at(2742, 2792));
  assert.equal(hunts(human(at(2743, 2792)), outside), false, "nine tiles east of the spawn");
});

test("the time-based aggression tolerance still applies: a finished tolerance timer stops the hunt", (t) => {
  const finished = { older: at(2734, 2793), newer: at(2734, 2793), ticks: 1000 };
  assert.equal(hunts(human(at(2734, 2793), { tolerance: finished }), npc(t, SPIDER, SPIDER_SPAWN)), false);
});

test("monkey form stays passive: a worn greegree (form attribute set) means no hunt", (t) => {
  assert.equal(hunts(human(at(2734, 2793), { form: "karamjan-monkey" }), npc(t, SPIDER, SPIDER_SPAWN)), false);
  assert.equal(hunts(human(at(2788, 2779), { form: "karamjan-monkey" }), npc(t, GUARD, at(2788, 2778))), false, "guard");
});

test("the zoo is unchanged: a flip-id spider at the Ardougne zoo stays passive for a human", (t) => {
  // Same greegree area object as the island, but the NPC stands in the zoo rectangle (2594-2612 x 3272-3286).
  assert.equal(hunts(human(at(2600, 3280)), npc(t, SPIDER, at(2601, 3279))), false);
});

test("Monkey Madness II gate, spider row: aggressive before completing it, not after", (t) => {
  mm2Complete = false;
  assert.equal(hunts(human(at(2734, 2793)), npc(t, SPIDER, SPIDER_SPAWN)), true, "before MM2");
  mm2Complete = true;
  try {
    assert.equal(hunts(human(at(2734, 2793)), npc(t, SPIDER, SPIDER_SPAWN)), false, "after MM2");
  } finally { mm2Complete = false; }
});

test("Monkey Madness II gate, guard row: aggressive before completing it, not after", (t) => {
  mm2Complete = false;
  assert.equal(hunts(human(at(2788, 2779)), npc(t, GUARD, at(2788, 2778))), true, "before MM2");
  mm2Complete = true;
  try {
    assert.equal(hunts(human(at(2788, 2779)), npc(t, GUARD, at(2788, 2778))), false, "after MM2");
  } finally { mm2Complete = false; }
});

test("not flipped: the level 5 bird, the level 11 bird and the stingray stay passive", (t) => {
  assert.equal(hunts(human(at(2696, 2710)), npc(t, BIRD_LEVEL_5, at(2696, 2709))), false, "bird level 5");
  assert.equal(hunts(human(at(2741, 2713)), npc(t, BIRD_LEVEL_11, at(2741, 2712))), false, "bird level 11 (Wiki: Nature Altar)");
  assert.equal(hunts(human(at(2698, 2693)), npc(t, STINGRAY, at(2698, 2692))), false, "stingray (Wiki: sea only)");
});

test("outside the Ape Atoll rectangles nothing changes: a spider at 2920,9486 stays passive", (t) => {
  assert.equal(hunts(human(at(2920, 9486)), npc(t, FAR_SPIDER, at(2920, 9486))), false);
});

const SCORPION = 5242; // cl38, already aggressive in the data; the combat-level gate (2 x 38 = 76) still refused a level 90 human

test("human form: a level 90 player is hunted by a scorpion 5242 (the combat-level gate is lifted; BEFORE fails)", (t) => {
  assert.equal(hunts(human(at(2762, 2750)), npc(t, SCORPION, at(2762, 2749))), true);
});

test("Monkey Madness II complete: the scorpion follows the same gate (not aggressive to a level 90 human)", (t) => {
  mm2Complete = true;
  try {
    assert.equal(hunts(human(at(2762, 2750)), npc(t, SCORPION, at(2762, 2749))), false);
  } finally { mm2Complete = false; }
});

test("human form: the second Monkey Guard id (5276) is hunted like 5275", (t) => {
  assert.equal(hunts(human(at(2803, 2786)), npc(t, core.NpcIdentifiers.MONKEY_GUARD_3, at(2803, 2785))), true);
});

test("the Ape Atoll dungeon rectangle (y 9088 and up): a human level 90 is hunted by a flipped spider 5238", (t) => {
  assert.equal(hunts(human(at(2704, 9105)), npc(t, SPIDER, at(2704, 9104))), true);
});

test("a null area hook changes nothing: the base Area answers null for the override", () => {
  const base = new core.Area([]);
  assert.equal(base.npcAggressionOverride(human(at(2734, 2793)), null), null);
});
