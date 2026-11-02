"use strict";

/**
 * Assembling rift guardians at the essence piles, and the guardians themselves.
 *
 * rsprox captures (rev 241), from arrival at the pile:
 * - 0: "You scrape together what usable components you can find." (spam), human_pickupfloor,
 *   sound 942 x2.
 * - +2: "You carve out a place for the cell and carefully place it inside the guardian." (spam),
 *   gotr_chisel_guardian, sound 2586 x2.
 * - +4: the guardian rises at the pile (rift_guardian_spawn), which is gone for six ticks while it
 *   walks out; +5: the cell is used up, "The powers
 *   of the weak cell extend into the essence. A Guardian comes to life.", sound 956, 80 Crafting
 *   XP, the cell's Runecraft XP (30 weak, 250 overcharged) and the pile's energy (6/15/27/45).
 *   With ten guardians up: "The powers of the cell extend into the essence, but no guardian forms."
 * - Without a charged cell: objectbox with a weak cell, "You will need a charged cell to power any
 *   rift guardians you create from this essence pile."
 * - The HUD counts the guardians up to the cap of 10.
 * Wiki: a chisel is needed; the guardian's kind follows the pile and the cell (weak air or mind,
 * medium water or chaos, strong earth or death, overcharged fire or blood); every guardian and
 * creature dies at 100% power.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");
const Cells = require("./Cells.GuardiansOfTheRift");
const Creatures = require("./Creatures.GuardiansOfTheRift");

const PILES = [
  { loc: "gotr_guardian_spawn_east", type: "elemental", tile: { x: 3618, y: 9490 }, face: 0, guardians: ["air", "water", "earth", "fire"] },
  { loc: "gotr_guardian_spawn_west", type: "catalytic", tile: { x: 3611, y: 9490 }, face: 3, guardians: ["mind", "chaos", "death", "blood"] },
];
/**
 * The pile makes way for six ticks as a guardian rises (rsprox captures). Live raises it on the
 * pile; here it stands up on the pile's north edge, where it can walk out.
 */
const PILE_AWAY_TICKS = 6;
const PILE_SIZE = 2;
/** Wiki: energy for a guardian, 2x+1 of the cell's strengthening value (6 for a weak cell). */
const GUARDIAN_ENERGY = [0, 6, 15, 27, 45];
const CRAFTING_XP = 80;
const SOUND = { SCRAPE: 942, CARVE: 2586, ALIVE: 956 };
/** Ours: guardians hit 0-6 (rsprox captures), up by their cell's tier, every 4 ticks. */
const MAX_HIT = [0, 3, 4, 5, 6];
const ATTACK_TICKS = 4;
const SIGHT = 10;
const RANGED_REACH = 7;
/** Where the guardians hold, between the barriers and the rift. */
const POST = { minX: 3605, maxX: 3626, minY: 9512, maxY: 9517 };

const guardians = new Set();
let api = null;

function pileFor(objectId) {
  return PILES.find((pile) => Shared.loc(pile.loc) === objectId) ?? null;
}

function alive() {
  for (const npc of guardians) {
    if (!npc.isRegistered?.() || npc.getHitpoints() <= 0) guardians.delete(npc);
  }
  return guardians.size;
}

function assemble(event) {
  const { player, objectId } = event;
  const pile = pileFor(objectId);
  if (!pile || !Shared.inTemple(player.getLocation()) || !Shared.questComplete(player) || !Game.isPlaying(player)) return false;
  if (Shared.count(player, "chisel") <= 0) {
    Shared.itemStatement(player, "chisel", "You need a chisel to carve the essence into a guardian.");
    return true;
  }
  if (Cells.bestCell(player) === 0) {
    Shared.itemStatement(player, Shared.ITEM.CELLS[0], "You will need a charged cell to power any rift guardians you create from this essence pile.");
    return true;
  }
  Shared.spam(player, "You scrape together what usable components you can find.");
  Shared.animate(player, "human_pickupfloor");
  player.getPacketSender().sendSoundEffect(SOUND.SCRAPE, 2, 0);
  Shared.startAction(player, "assemble", (ticks) => step(player, pile, ticks));
  return true;
}

function step(player, pile, ticks) {
  if (ticks === 2) {
    Shared.spam(player, "You carve out a place for the cell and carefully place it inside the guardian.");
    Shared.animate(player, "gotr_chisel_guardian");
    player.getPacketSender().sendSoundEffect(SOUND.CARVE, 2, 0);
  }
  if (ticks < 5) return true;
  finish(player, pile);
  return false;
}

function finish(player, pile) {
  const tier = Cells.bestCell(player);
  if (tier === 0) return;
  player.getInventory().delete(Shared.obj(Shared.ITEM.CELLS[tier - 1]), 1);
  player.getInventory().refreshItems();
  Shared.sound(player, SOUND.ALIVE);
  Shared.addXp(player, "CRAFTING", CRAFTING_XP);
  Shared.addXp(player, "RUNECRAFTING", Cells.CELL[tier].xp);
  Game.addEnergy(player, pile.type, GUARDIAN_ENERGY[tier]);
  Game.addContribution(player, 10);
  if (alive() >= Shared.RIFT_GUARDIAN_CAP) {
    player.sendMessage("The powers of the cell extend into the essence, but no guardian forms.");
    return;
  }
  spawn(pile, tier);
  player.sendMessage(`The powers of the ${Cells.CELL[tier].name} cell extend into the essence. A Guardian comes to life.`);
}

function pileLoc(pile) {
  const { GameObject } = Shared.core();
  return new GameObject(Shared.loc(pile.loc), Shared.location(pile.tile), 10, pile.face, null);
}

function makeWay(pile) {
  const { ObjectManager } = Shared.core();
  ObjectManager.deregister(pileLoc(pile), true);
  Shared.later(PILE_AWAY_TICKS, () => ObjectManager.register(pileLoc(pile), true));
}

function spawn(pile, tier) {
  makeWay(pile);
  const id = Shared.npc(`gotr_guardian_${pile.guardians[tier - 1]}`);
  const npc = api.spawnNpc({ id, x: pile.tile.x, y: pile.tile.y + PILE_SIZE, z: 0, wanderRadius: 0 });
  if (!npc) return;
  guardians.add(npc);
  npc.__gotrTier = tier;
  npc.__gotrNextAttack = 0;
  // Guardians rise among the crowd at the pile; nothing standing there should pin them in.
  Shared.prepareNpc(npc, { walkThrough: true });
  npc.performAnimation(new (Shared.core().Animation)(Shared.seq("rift_guardian_spawn")));
  Shared.later(2, () => npc.isRegistered() && Shared.core().PathFinder.calculateWalkRoute(npc,
    Shared.random(POST.minX, POST.maxX), Shared.random(POST.minY, POST.maxY)));
  Game.setRiftGuardians(alive());
}

/** Full power: every guardian dies with the creatures (Wiki). */
function dismissAll() {
  for (const npc of guardians) if (npc.isRegistered() && npc.getHitpoints() > 0) npc.setHitpoints(0);
  guardians.clear();
  Game.setRiftGuardians(0);
}

/**
 * A guardian goes for the nearest creature it can see. Capture 1840: elementals only ever fight
 * beside it with the melee sequences, catalytics only at range with the ranged ones.
 */
function guardianTurn(npc, now) {
  const from = Creatures.tileOf(npc);
  const target = Creatures.nearestCreature(from, Creatures.sizeOf(npc), SIGHT);
  if (!target) return;
  const melee = Creatures.isElementalGuardian(npc);
  if (target.gap > (melee ? 1 : RANGED_REACH)) {
    const at = Creatures.tileOf(target.npc);
    Creatures.route(npc, at.x, at.y);
    return;
  }
  npc.getMovementQueue().reset();
  if (now < npc.__gotrNextAttack) return;
  npc.__gotrNextAttack = now + ATTACK_TICKS;
  npc.setPositionToFace?.(target.npc.getLocation());
  Creatures.animate(npc, melee ? "rift_guardian_attack_melee" : "rift_guardian_attack_ranged");
  Creatures.hit(target.npc, MAX_HIT[npc.__gotrTier ?? 1]);
  Creatures.struckBy(target.npc, npc);
}

function tick({ phase }) {
  Game.setRiftGuardians(alive());
  if (phase !== Game.PHASE.ATTACK) return;
  const now = Game.clock();
  for (const npc of guardians) guardianTurn(npc, now);
}

module.exports = {
  PILES, GUARDIAN_ENERGY, guardians, alive, dismissAll,
  attach(pluginApi) {
    api = pluginApi;
    pluginApi.onObjectInteraction("Essence pile (elemental)", { Assemble: assemble });
    pluginApi.onObjectInteraction("Essence pile (catalytic)", { Assemble: assemble });
    Game.on("charged", dismissAll);
    Game.on("lost", dismissAll);
    Game.on("tick", tick);
  },
};
