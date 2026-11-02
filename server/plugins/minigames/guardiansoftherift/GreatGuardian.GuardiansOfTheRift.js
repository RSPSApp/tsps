"use strict";

/**
 * The Great Guardian's Power-up: guardian stones become power, energy and Runecraft XP.
 *
 * rsprox captures: the click turns the player to the Guardian; two ticks later the
 * human_runecraft_walkmerge animation with the runecrafting spotanim (height 92) and sound 5369,
 * and a tick after that every stone leaves the inventory, the game's energy varbit rises and the
 * XP lands. The stones' energy is a stack's worth: 64 air, fire, nature or body stones gave 128.
 * Wiki: 2 energy per stone (3 for polyelemental and polycatalytic), 5 Runecraft XP per stone,
 * and 1% run energy per stone plus 1-11% with the special attack bar.
 *
 * Without stones, or while it rests between games, the Guardian answers from its transcript
 * ("standard-dialogue-interacting-with-the-great-guardian-without-any-type-of-guardian-stone").
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");

const STONES = [
  { item: Shared.ITEM.ELEMENTAL_STONE, type: "elemental", energy: 2 },
  { item: Shared.ITEM.CATALYTIC_STONE, type: "catalytic", energy: 2 },
  { item: Shared.ITEM.POLYELEMENTAL_STONE, type: "elemental", energy: 3 },
  { item: Shared.ITEM.POLYCATALYTIC_STONE, type: "catalytic", energy: 3 },
];

const XP_PER_STONE = 5;
const POWER_UP_SOUND = 5369;
const PROJECTILE = "pyramid_waterstrike_travel";
const VARIANT_WITHOUT_STONES = "standard-dialogue-interacting-with-the-great-guardian-without-any-type-of-guardian-stone";
/** The transcript's three conditions, by step id. */
const STEP = { RESTING: "dKs1aF", NOT_FULL: "MTgChk", FULL: "m820hq" };

function isGreatGuardian(npcId) {
  return npcId === Shared.npc(Shared.NPC.GREAT_GUARDIAN);
}

function resting() {
  return !Game.isRunning();
}

function stonesHeld(player) {
  return STONES.map((stone) => ({ ...stone, count: Shared.count(player, stone.item) })).filter((stone) => stone.count > 0);
}

function powerUp(event) {
  const { player, npc, npcId } = event;
  if (!isGreatGuardian(npcId)) return false;
  const held = stonesHeld(player);
  if (held.length === 0 || resting() || !Game.isPlaying(player)) {
    Shared.npcSays(player, npcId, VARIANT_WITHOUT_STONES);
    return true;
  }
  player.getMovementQueue().reset();
  player.setPositionToFace?.(npc.getLocation());
  Shared.later(2, () => feed(player, npc));
  return true;
}

const IDLE_FLOURISH_TICKS = 50;
const IDLE_FLOURISH_SEQ = 9372;

/** Capture 1840: the Guardian's idle flourish every 50 ticks while a game runs. */
function idleFlourish() {
  const clock = Game.clock();
  if (clock === 0 || clock % IDLE_FLOURISH_TICKS !== 0) return;
  const npc = Game.greatGuardian();
  if (npc?.isRegistered()) npc.performAnimation(new (Shared.core().Animation)(IDLE_FLOURISH_SEQ));
}

function feed(player, npc) {
  if (!player.isRegistered() || !Game.isPlaying(player) || resting()) return;
  Shared.animate(player, "human_runecraft_walkmerge");
  Shared.graphic(player, "runecrafting", 92);
  Shared.sound(player, POWER_UP_SOUND);
  const { Projectile } = Shared.core();
  Projectile.createProjectile(player, npc, Shared.spotanim(PROJECTILE), 25, 35, 100, 146).sendProjectile();
  Shared.later(1, () => absorb(player));
}

function absorb(player) {
  if (!player.isRegistered() || !Game.isPlaying(player) || resting()) return;
  const held = stonesHeld(player);
  if (held.length === 0) return;
  const inventory = player.getInventory();
  let stones = 0;
  for (const stone of held) {
    inventory.delete(Shared.obj(stone.item), stone.count);
    Game.addEnergy(player, stone.type, stone.count * stone.energy);
    stones += stone.count;
  }
  inventory.refreshItems();
  Shared.addXp(player, "RUNECRAFTING", stones * XP_PER_STONE);
  restoreRunEnergy(player, stones);
  Game.addPower(stones);
}

/** Wiki: 1% per stone, plus 1% (empty special bar) to 11% (full). */
function restoreRunEnergy(player, stones) {
  const bonus = 1 + Math.floor(player.getSpecialPercentage() / 10);
  player.setRunEnergy(player.getRunEnergy() + stones + bonus);
  player.getPacketSender().sendRunEnergy();
}

function answerCondition({ npcId, stepId }) {
  if (!isGreatGuardian(npcId)) return null;
  if (stepId === STEP.RESTING) return resting();
  if (stepId === STEP.NOT_FULL) return Game.powerPercent() < 100;
  if (stepId === STEP.FULL) return Game.powerPercent() >= 100;
  return null;
}

module.exports = {
  attach(api) {
    api.onNpcInteraction("The Great Guardian", { "Power-up": powerUp });
    api.onNpcDialogueCondition(answerCondition);
    Game.on("tick", idleFlourish);
  },
};
