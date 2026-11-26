// Run after `yarn build`: node --test tests/npc-melee-defence-style.test.cjs
// A monster's melee hit rolls against the player's defence bonus for the monster's own style
// (stab, slash or crush, the "Main attack style" Monster Examine shows), as on the OSRS Wiki's
// combat formulas; a monster listed only as "melee" keeps the best of the three.
"use strict";
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const { BonusManager } = require("../dist/game/model/equipment/BonusManager");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");

const GOBLIN = 2486; // stab
const BLACK_KNIGHT = 1545; // slash
const COW = 2790; // crush
const BANSHEE = 414; // "melee" (and magic): no single melee style
const TEKTON = 7542; // slash, crush, stab: no single melee style
const ENRAGED_TEKTON = 7544;
const YAMA = 14176; // melee, slash, ranged, magic: slash

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
});

/** A player whose stab, slash and crush defence bonuses all differ, so each roll is told apart. */
function armouredPlayer() {
  const player = new Player(null);
  player.setLocation(new Location(3222, 3218, 0));
  const defence = player.getBonusManager().getDefenceBonus();
  defence[BonusManager.DEFENCE_STAB] = 150;
  defence[BonusManager.DEFENCE_SLASH] = 90;
  defence[BonusManager.DEFENCE_CRUSH] = 10;
  return player;
}

function meleeDefenceRoll(npcId, player) {
  const npc = new NPC(npcId, new Location(3223, 3218, 0));
  return AccuracyFormulasDpsCalc.specialRolls(npc, player, CombatType.MELEE).defence;
}

test("the sample monsters carry the attack styles the cases rely on", () => {
  assert.equal(NpcDefinition.forId(GOBLIN).getAttackStyle(), "stab");
  assert.equal(NpcDefinition.forId(BLACK_KNIGHT).getAttackStyle(), "slash");
  assert.equal(NpcDefinition.forId(COW).getAttackStyle(), "crush");
  assert.equal(NpcDefinition.forId(BANSHEE).getAttackStyle(), "melee");
  // Monster Examine's "Main attack style" stays the dump's first entry.
  assert.equal(NpcDefinition.forId(TEKTON).getAttackStyle(), "slash");
  assert.equal(NpcDefinition.forId(YAMA).getAttackStyle(), "melee");
  assert.equal(NpcDefinition.forId(TEKTON).getMeleeAttackStyle(), "");
  assert.equal(NpcDefinition.forId(YAMA).getMeleeAttackStyle(), "slash");
});

test("stab, slash and crush monsters roll against the player's stab, slash and crush defence", () => {
  const player = armouredPlayer();
  const stab = AccuracyFormulasDpsCalc.defenseMeleeRoll(player, BonusManager.ATTACK_STAB);
  const slash = AccuracyFormulasDpsCalc.defenseMeleeRoll(player, BonusManager.ATTACK_SLASH);
  const crush = AccuracyFormulasDpsCalc.defenseMeleeRoll(player, BonusManager.ATTACK_CRUSH);
  assert.ok(stab > slash && slash > crush, "the three defence rolls differ");
  assert.equal(meleeDefenceRoll(GOBLIN, player), stab);
  assert.equal(meleeDefenceRoll(BLACK_KNIGHT, player), slash);
  assert.equal(meleeDefenceRoll(COW, player), crush);
  // Yama's one melee style comes after a plain "melee" in the dump.
  assert.equal(meleeDefenceRoll(YAMA, player), slash);
});

test("a monster with no single melee style still rolls against the best of the three", () => {
  const player = armouredPlayer();
  const best = AccuracyFormulasDpsCalc.defenseMeleeRoll(player, BonusManager.ATTACK_STAB);
  assert.equal(meleeDefenceRoll(BANSHEE, player), best);
  // Tekton swings stab, slash or crush, so its first dump entry is no main style.
  assert.equal(meleeDefenceRoll(TEKTON, player), best);
  assert.equal(meleeDefenceRoll(ENRAGED_TEKTON, player), best);
});
