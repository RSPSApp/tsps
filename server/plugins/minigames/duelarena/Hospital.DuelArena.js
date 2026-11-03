"use strict";

/**
 * Emir's Arena hospital staff (wiki: A'abla, Jaraah, Sabreen, Surgeon General Tafani). Their
 * Heal option and the "Can you heal me?" dialogue branch restore 20% of the player's total
 * Hitpoints plus 2, and never cure poison. Their transcripts carry PvP/Deadman-world guards;
 * this server has no such worlds, so without an answer playback would always take the first
 * ("Sorry, I'm not on duty.") branch.
 *
 * The formula is stated on https://oldschool.runescape.wiki/w/A%27abla; the other three
 * transcripts quote the same 21 Hitpoints, so it is used for all four.
 */

const NURSE_NAMES = new Set(["Jaraah", "A'abla", "Sabreen", "Surgeon General Tafani"]);
const HEAL_FRACTION = 0.2;
const HEAL_FLAT = 2;

let core;

function nurseName(event) {
  return event.definition?.getName?.() ?? null;
}

function healAmount(player) {
  return Math.floor(player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS) * HEAL_FRACTION) + HEAL_FLAT;
}

/** Heals the formula, capped at full; returns the Hitpoints actually restored. */
function heal(player) {
  const current = player.getHitpoints();
  const missing = player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS) - current;
  const amount = Math.min(healAmount(player), missing);
  if (amount > 0) player.heal(amount);
  return amount;
}

function healMessage(name, amount) {
  return `${name} heals you for ${amount} Hitpoint${amount === 1 ? "" : "s"}.`;
}

/** The Heal right-click option: silent at full health, the same heal as the dialogue otherwise. */
function healOption(event) {
  const name = nurseName(event);
  if (!NURSE_NAMES.has(name)) return false;
  const amount = heal(event.player);
  if (amount > 0) event.player.sendMessage(healMessage(name, amount));
  return true;
}

/** The transcripts' heal step: an "action" for three nurses, Tafani's is a game message. */
function healAction(event) {
  const name = nurseName(event);
  if (!NURSE_NAMES.has(name)) return;
  const healingAction = event.action === "heal";
  const healingMessage = event.kind === "message"
    && typeof event.text === "string" && /heals you for \d+ Hitpoints?/i.test(event.text);
  if (!healingAction && !healingMessage) return;
  const amount = heal(event.player);
  event.handled = true;
  event.player.sendMessage(healMessage(name, amount));
}

/** Answer the guards the transcripts ask about; the Hitpoints ones decide the heal branch. */
function answerCondition(event) {
  const name = nurseName(event);
  if (!NURSE_NAMES.has(name)) return null;
  const text = String(event.text ?? "");
  if (/pvp (?:arena )?world|deadman world/i.test(text)) return false;
  const full = event.player.getHitpoints() >= event.player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  if (/does not have full hitpoints/i.test(text)) return !full;
  if (/has full hitpoints/i.test(text)) return full;
  return null;
}

function attach(pluginApi) {
  core = pluginApi.core;
  pluginApi.onNpcsInteraction([...NURSE_NAMES], { Heal: healOption });
  pluginApi.onCustomEvent("npc-dialogue:action", healAction);
  pluginApi.onNpcDialogueCondition(answerCondition);
}

module.exports = { attach, heal, healOption, healAction, answerCondition, healAmount, NURSE_NAMES };
