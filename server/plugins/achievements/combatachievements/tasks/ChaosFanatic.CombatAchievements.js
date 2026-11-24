/**
 * The Chaos Fanatic's Combat Achievements that his fight decides:
 * - Sorry, What Was That?: "Kill the Chaos Fanatic without anyone being hit by his explosion
 *   attack." The boss (ChaosFanatic.plugin.js) marks himself for the rest of his life once a
 *   book lands on any player's tile, so a bystander's hit fails it for everyone.
 * - Praying to the Gods: "Kill the Chaos Fanatic 10 times without drinking any potion which
 *   restores prayer or leaving the Wilderness." His killer's kills are counted in a row; a
 *   prayer-restoring potion or leaving the Wilderness ("wilderness:left", Ferox Enclave included)
 *   starts the count over, and logging out doesn't (Wiki).
 * Chaos Fanatic Champion and Adept (10 and 25 kills) finish from the kill count.
 */
const { EXPLOSION_HIT_ATTRIBUTE } = require("../../../bosses/ChaosFanatic.plugin");

const NPC_NAME = "Chaos Fanatic";
const PRAYING_TO_THE_GODS = "Praying to the Gods";
const PRAYING_TO_THE_GODS_KILLS = 10;
/** Persisted: Chaos Fanatic kills since the last prayer-restoring potion or leaving the Wilderness. */
const PRAYING_KILLS_ATTRIBUTE = "combat-achievements:praying-to-the-gods-kills";

/**
 * The Wiki's list (Praying to the Gods, "Strategy": only these), by the names "potions:drunk"
 * gives; a blighted super restore is a Super restore.
 */
const PRAYER_RESTORING_POTIONS = new Set([
  "Prayer potion", "Prayer regeneration potion", "Zamorak brew", "Super restore", "Sanfew serum",
  "Ancient brew", "Moonlight moth mix",
]);

let api;

const npcName = (npc) => String(npc?.getCurrentDefinition?.()?.getName?.() ?? npc?.getDefinition?.()?.getName?.() ?? "");

function resetPrayingKills({ player }) {
  if (Number(player?.getAttribute?.(PRAYING_KILLS_ATTRIBUTE)) > 0) player.setAttribute(PRAYING_KILLS_ATTRIBUTE, 0);
}

function drank(event) {
  if (PRAYER_RESTORING_POTIONS.has(event?.name)) resetPrayingKills(event);
}

function prayingDone(player) {
  const request = { player, task: PRAYING_TO_THE_GODS, done: false };
  api.emitCustomEvent("combat-achievements:has-task", request);
  return request.done === true;
}

function died({ npc, killer, preventDeath }) {
  if (preventDeath || npcName(npc) !== NPC_NAME) return;
  if (killer?.isPlayer?.() !== true || prayingDone(killer)) return;
  const kills = (Number(killer.getAttribute(PRAYING_KILLS_ATTRIBUTE)) || 0) + 1;
  killer.setAttribute(PRAYING_KILLS_ATTRIBUTE, kills);
  if (kills >= PRAYING_TO_THE_GODS_KILLS) api.emitCustomEvent("combat-achievements:complete", { player: killer, task: PRAYING_TO_THE_GODS });
}

module.exports = function attachChaosFanaticTasks(pluginApi, Fights) {
  api = pluginApi;
  api.persistAttribute(PRAYING_KILLS_ATTRIBUTE, 0);
  api.onNpcDeath(died);
  api.onCustomEvent("potions:drunk", drank);
  api.onCustomEvent("wilderness:left", resetPrayingKills);
  Fights.onKill(NPC_NAME, {
    "Sorry, What Was That?": (fight) => fight.npc?.getAttribute?.(EXPLOSION_HIT_ATTRIBUTE) !== true,
  });
};

Object.assign(module.exports, {
  PRAYING_KILLS_ATTRIBUTE, PRAYER_RESTORING_POTIONS,
  _test: { died, drank, resetPrayingKills },
});
