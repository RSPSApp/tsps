"use strict";

/**
 * Healing the pyromancers.
 *
 * Wiki ("Pyromancer", "Rejuvenation potion"): "Help", or a rejuvenation potion used on her,
 * heals her fully for one dose (from the potion with the fewest left) and earns 75 points.
 * Transcript: "That's no use!" for any other item, "No need! I'm fine thanks." at full health,
 * and "Looks like it's quiet for now. I don't need help, but thank you." between rounds.
 * Near-Reality: the statement when Help is used without a potion.
 */

const Shared = require("./WintertodtShared");
const Round = require("./WintertodtRound");
const Corners = require("./WintertodtCorners");
const Supplies = require("./Supplies.Wintertodt");

const HEAL_POINTS = 75;

function npcSay(player, npcId, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, text),
    new EndDialogue(1),
  ));
}

function cornerOfNpc(npc) {
  const at = npc?.getLocation?.();
  if (!at) return -1;
  return Shared.CORNERS.findIndex((c) => c.pyromancer.x === at.getX() && c.pyromancer.y === at.getY());
}

function hasPotion(player) {
  return Shared.POTIONS.some((id) => player.getInventory().contains(id));
}

function heal(player, npc) {
  const index = cornerOfNpc(npc);
  if (index < 0) return false;
  const c = Corners.corner(index);
  const npcId = npc.getId();
  if (!Round.isActive()) {
    npcSay(player, npcId, "Looks like it's quiet for now. I don't need help, but thank you.");
    return true;
  }
  if (c.pyromancerHealthy && c.pyromancerHp >= Corners.PYROMANCER_HITPOINTS) {
    npcSay(player, npcId, "No need! I'm fine thanks.");
    return true;
  }
  if (!hasPotion(player)) {
    Shared.statement(player, "You need a rejuvenation potion made from the bruma herb to do<br><br>that.");
    return true;
  }
  Supplies.useDose(player);
  const wasDown = !c.pyromancerHealthy;
  Corners.healPyromancer(index);
  Round.addPoints(player, HEAL_POINTS);
  if (wasDown) Round.broadcast();
  return true;
}

function help(event) {
  return heal(event.player, event.npc);
}

function itemOnPyromancer(event) {
  const index = cornerOfNpc(event.target);
  if (index < 0 || !/Pyromancer$/.test(Supplies.npcName(event.target) ?? "")) return;
  event.handled = true;
  if (!Shared.POTIONS.includes(event.itemId)) {
    npcSay(event.player, event.target.getId(), "That's no use!");
    return;
  }
  heal(event.player, event.target);
}

module.exports = function registerWintertodtPyromancers(api) {
  api.onNpcInteraction("Pyromancer", { Help: help });
  api.onNpcInteraction("Incapacitated Pyromancer", { Help: help });
  api.onItemOnNpc(itemOnPyromancer);
};

module.exports.heal = heal;
