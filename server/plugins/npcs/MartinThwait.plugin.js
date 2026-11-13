"use strict";

/**
 * Martin Thwait in the Rogues' Den. Wiki (Martin Thwait): "To access his store, players must have a level of 50 or
 * higher in both the Thieving and Agility skills, or have a Thieving level of 99. Boosts cannot be used to fulfil
 * either of these requirements." His transcript checks that on Talk-to and on Trade alike (its "right-click trade
 * option" section): below 50 Thieving, then 50-98 Thieving without 50 Agility, he says to train up; otherwise his
 * Lost and Found opens. No recording has him, so the transcript's lines are the ones played.
 *
 * Trade plays that section instead of the generic shops.json binding, which opened the shop for anyone, and this
 * answers its condition steps (the runtime would otherwise take the first, "train up your Thieving", every time).
 */

const TRADE_VARIANT = "right-click-trade-option";
const THIEVING = 50;
const AGILITY = 50;
const THIEVING_OUTRIGHT = 99;

let api;

function levels(player) {
  const skills = player.getSkillManager();
  // Base levels: boosts don't count.
  return { thieving: skills.getMaxLevel(api.core.Skill.THIEVING), agility: skills.getMaxLevel(api.core.Skill.AGILITY) };
}

/** Whether a player may open the Lost and Found. */
function hasAccess(player) {
  const { thieving, agility } = levels(player);
  return thieving >= THIEVING_OUTRIGHT || (thieving >= THIEVING && agility >= AGILITY);
}

/** The transcript's three condition steps, by their prose (the same on Talk-to and Trade). */
function answer({ player, npcId, text }) {
  if (npcId !== api.core.NpcIdentifiers.MARTIN_THWAIT || !player) return null;
  const prose = String(text ?? "");
  const { thieving, agility } = levels(player);
  if (/doesn't have at least level 50 Thieving/i.test(prose)) return thieving < THIEVING;
  if (/between level 50-98 Thieving/i.test(prose)) return thieving >= THIEVING && thieving < THIEVING_OUTRIGHT && agility < AGILITY;
  if (/over level 50 Thieving and Agility/i.test(prose)) return hasAccess(player);
  return null;
}

function trade(event) {
  const request = { player: event.player, npc: event.npc, npcId: api.core.NpcIdentifiers.MARTIN_THWAIT, variant: TRADE_VARIANT, handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  if (request.handled) event.handled = true;
  return request.handled;
}

module.exports = {
  name: "MartinThwait",
  description: "Martin Thwait's Lost and Found needs 50 Thieving and 50 Agility, or 99 Thieving, on Talk-to and Trade.",
  hasAccess,
  register(pluginApi) {
    api = pluginApi;
    api.onNpcDialogueCondition(answer);
    api.onNpcInteraction("Martin Thwait", { Trade: trade });
  },
};
