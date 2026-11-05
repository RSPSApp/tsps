/**
 * Sir Vyvin and White Knight rank progression (members).
 *
 * White equipment is sold from the rank's own White Knight Armoury after Wanted!; the kill
 * score starts counting once the player is deputised (Wanted! stage 4), gains 100 when the
 * quest is completed, and is capped at 1,300. Black knights count 1, elite dark
 * warriors/rangers/mages 6, elite black knights 12, and white knights remove 1 (not at Master).
 * The Port Sarim jail knight and the single Black Knights' Fortress wall guard do not count.
 *
 * Source: OSRS Wiki "White equipment", "Sir Vyvin" and the generated Sir Vyvin transcript's
 * rank conditions and open_interface actions.
 */
const SCORE_ATTRIBUTE = "white-knights:kill-score";
const WAS_RANKED_ATTRIBUTE = "white-knights:was-ranked";
const WANTED_BONUS_ATTRIBUTE = "white-knights:wanted-bonus";
const HIGHEST_RANK_ATTRIBUTE = "white-knights:highest-rank";

const MAX_SCORE = 1300;
const DEPUTISED_STAGE = 4;

/** Rank, kills needed and the shop the transcript opens for it. */
const RANKS = [
  { name: "Novice", kills: 100, shopId: 1381 },
  { name: "Peon", kills: 200, shopId: 1380 },
  { name: "Page", kills: 300, shopId: 1379 },
  { name: "Noble", kills: 500, shopId: 1378 },
  { name: "Adept", kills: 800, shopId: 1377 },
  { name: "Master", kills: 1300, shopId: 1376 },
];
const UNRANKED = { name: "Unranked", kills: 0, shopId: null };

/** Sir Vyvin's five "Do you have anything to trade?" action ids, by rank. */
const STEP_SHOPS = new Map([
  ["1dwanl", 1380],
  ["Vp8GI7", 1379],
  ["dv77EL", 1378],
  ["mNB6dJ", 1377],
  ["v6AAxZ", 1376],
]);

/** Black Knight kills that do not raise the score. */
const IGNORED_BLACK_KNIGHTS = new Set([1545, 4331]);

let api;
let core;

function score(player) {
  const value = Number(player.getAttribute(SCORE_ATTRIBUTE));
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_SCORE, Math.floor(value))) : 0;
}

function rankFor(value) {
  let rank = UNRANKED;
  for (const entry of RANKS) if (value >= entry.kills) rank = entry;
  return rank;
}

function questStage(player, key) {
  const request = { player, key, stage: null };
  api.emitCustomEvent("quest:get-stage", request);
  return request.stage;
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** The score value of this NPC death, or null when it is not one of the tracked knights. */
function killValue(npcId, name) {
  const lower = String(name ?? "").toLowerCase();
  if (IGNORED_BLACK_KNIGHTS.has(npcId)) return null;
  if (lower === "elite black knight") return 12;
  if (["elite dark warrior", "elite dark ranger", "elite dark mage"].includes(lower)) return 6;
  if (lower === "white knight") return -1;
  if (lower === "black knight" || lower === "black knight ") return 1;
  return null;
}

function addScore(player, delta, announce = true) {
  const current = score(player);
  if (delta > 0 && current >= MAX_SCORE) return;
  if (delta < 0 && current >= 1300) return;
  const next = Math.max(0, Math.min(MAX_SCORE, current + delta));
  if (next === current) return;
  player.setAttribute(SCORE_ATTRIBUTE, next);
  if (next >= 100) player.setAttribute(WAS_RANKED_ATTRIBUTE, true);
  announcePromotion(player, rankFor(current), rankFor(next), announce);
}

function announcePromotion(player, before, after, announce = true) {
  const index = RANKS.indexOf(after) + 1;
  if (index <= RANKS.indexOf(before) + 1) return;
  const highest = Number(player.getAttribute(HIGHEST_RANK_ATTRIBUTE)) || 0;
  if (index <= highest) return;
  player.setAttribute(HIGHEST_RANK_ATTRIBUTE, index);
  if (announce) player.sendMessage(`Congratulations! You are now a White Knight ${after.name}!`);
}

function awardWantedBonus(player, announce = true) {
  if (player.getAttribute(WANTED_BONUS_ATTRIBUTE) === true) return;
  player.setAttribute(WANTED_BONUS_ATTRIBUTE, true);
  addScore(player, 100, announce);
}

function onNpcDeath({ killer, npcId, npc }) {
  if (killer?.isPlayer?.() !== true || (killer.getHitpoints?.() ?? 1) <= 0) return;
  const name = npc?.getCurrentDefinition?.(killer)?.getName?.()
    ?? npc?.getDefinition?.()?.getName?.()
    ?? "";
  const value = killValue(npcId, name);
  if (value === null) return;
  if (value > 0 && !(Number(questStage(killer, "wanted")) >= DEPUTISED_STAGE)) return;
  addScore(killer, value);
}

function onQuestCompleted({ player, key }) {
  if (key === "wanted" && player) awardWantedBonus(player);
}

function onLogin({ player }) {
  if (player && questComplete(player, "wanted")) awardWantedBonus(player, false);
}

function onCondition({ player, npcId, text }) {
  if (npcId !== core.NpcIdentifiers.SIR_VYVIN || !player) return null;
  const value = String(text ?? "").toLowerCase();
  const current = score(player);
  const rank = rankFor(current).name.toLowerCase();
  const wasRanked = player.getAttribute(WAS_RANKED_ATTRIBUTE) === true;
  const wantedComplete = questComplete(player, "wanted");
  if (value.includes("unranked")) return !wantedComplete || (current < 100 && !wasRanked);
  if (value.includes("become unrated")) return wantedComplete && current < 100 && wasRanked;
  for (const entry of RANKS) {
    if (value.includes(`${entry.name.toLowerCase()} rank`)) return wantedComplete && rank === entry.name.toLowerCase();
  }
  return null;
}

function onAction(event) {
  if (event.npcId !== core.NpcIdentifiers.SIR_VYVIN || !event.player) return;
  if (event.action !== "open_interface") return;
  const shopId = STEP_SHOPS.get(event.stepId);
  if (!shopId || !questComplete(event.player, "wanted") || rankFor(score(event.player)).shopId !== shopId) return;
  event.handled = true;
  event.end = true;
  const { player } = event;
  const at = player.getLocation().clone();
  // The transcript closes its chatbox after this action; open the rank's shop next tick.
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      this.stop();
      if (player.isRegistered() && player.getLocation().equals(at)
          && player.getInterfaceId() === -1 && !player.getDialogueManager().getCurrent()) {
        core.ShopManager.open(player, shopId, true);
      }
    }
  })());
}

function bind(registry) {
  api = registry;
  core = registry.core;
  api.persistAttribute(SCORE_ATTRIBUTE, 0);
  api.persistAttribute(WAS_RANKED_ATTRIBUTE, false);
  api.persistAttribute(WANTED_BONUS_ATTRIBUTE, false);
  api.persistAttribute(HIGHEST_RANK_ATTRIBUTE, 0);
  api.onNpcDeath(onNpcDeath);
  api.onCustomEvent("quest:completed", onQuestCompleted);
  api.onPlayerLogin(onLogin);
  api.onNpcDialogueCondition(onCondition);
  api.onCustomEvent("npc-dialogue:action", onAction);
}

module.exports = {
  name: "SirVyvin",
  members: true,
  register(registry) {
    bind(registry);
  },
  _test: {
    RANKS, UNRANKED, STEP_SHOPS, SCORE_ATTRIBUTE, WAS_RANKED_ATTRIBUTE, WANTED_BONUS_ATTRIBUTE,
    rankFor, killValue, addScore, shopForStep: (stepId) => STEP_SHOPS.get(stepId),
    onCondition, onNpcDeath, onQuestCompleted, onLogin, onAction, awardWantedBonus,
  },
};
