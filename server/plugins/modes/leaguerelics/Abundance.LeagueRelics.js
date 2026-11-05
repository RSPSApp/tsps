/**
 * Abundance (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 1
 * relic: every non-combat skill is boosted by 10, every experience drop brings 2 more experience in
 * the same skill (with the league's rate, as the Wiki says), and every experience point gained
 * brings 2 coins, to the inventory while its toggle is on (the default) and there is room, else the
 * bank. Coins are paid on the gain as it landed (after the rates); fractions carry to the next gain
 * (ours).
 *
 * The +10 is a permanent, visible boost, as recorded: 233 of 246 Leagues VI recordings show every
 * non-combat skill (Slayer and Sailing too) at base + 10 and the combat skills unboosted, through
 * level-ups. As the Defence pact's boost (General.LeaguePacts): the current level rises by it, and
 * the core's resting level (registerRestingLevelModifier) is base + 10, so boost decay stops there
 * and natural restoration climbs back to it. Every skill check reads the current level, so nothing
 * more is added in them. The boost already added is kept in `league:abundance-boost-applied`; the
 * relic's unlock and a login move the current levels by what changed since.
 */
const Common = require("./Common.LeagueRelics");
const Toggles = require("./Toggles.LeagueRelics");

let core;
let effect;
let combat;

/** The levels the boost already added to each non-combat skill's current level, saved with those levels. */
const APPLIED_ATTRIBUTE = "league:abundance-boost-applied";

/** Players whose extra experience is being added, so it brings no extra of its own. */
const granting = new WeakSet();
/** Coins owed below one, per player. */
const owed = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

function nonCombat(skill) {
  if (!combat) combat = new Set(effect.combatSkills.map((name) => core.Skill[name]));
  return !combat.has(skill);
}

/** The level a non-combat skill rests at while the relic is active: base plus the boost. */
function restingLevel(player, skill, level) {
  if (!nonCombat(skill) || !active(player)) return level;
  return level + effect.levelBoost;
}

/**
 * Each non-combat skill's current level moved by what the boost changed since it was last applied.
 * A rise adds it; a fall takes it back only down to the new resting level (a drained level stays
 * drained), as the Defence pact's boost does.
 */
function applyBoost(player) {
  if (!player?.isPlayer?.()) return;
  const boost = active(player) ? effect.levelBoost : 0;
  const applied = Number(player.getAttribute(APPLIED_ATTRIBUTE)) || 0;
  if (boost === applied) return;
  const skills = player.getSkillManager();
  const delta = boost - applied;
  player.setAttribute(APPLIED_ATTRIBUTE, boost);
  for (const skill of core.Skill.values()) {
    if (!nonCombat(skill)) continue;
    const current = skills.getCurrentLevel(skill);
    const next = delta > 0 ? current + delta : Math.max(current + delta, Math.min(current, skills.getMaxLevel(skill) + boost));
    if (next !== current) skills.setCurrentLevel(skill, Math.max(1, next), true);
  }
}

/** `league:login`, `league:relic-unlocked` and `league:relics-reset`: the boost as the relic now stands. */
function refresh({ player }) {
  applyBoost(player);
}

/** The coins: the inventory while the toggle says so and it has room, else the bank, else the inventory's room. */
function payCoins(player, coins) {
  const { COINS } = core.ItemIdentifiers;
  const inventory = player.getInventory();
  const item = new core.Item(COINS, coins);
  if (Toggles.on(player, effect.coinsToggle) && inventory.getAddableAmount(item) >= coins) {
    inventory.adds(COINS, coins);
    return;
  }
  if (Common.bank(player, COINS, coins)) return;
  const room = inventory.getAddableAmount(item);
  if (room > 0) inventory.adds(COINS, Math.min(room, coins));
}

function gained({ player, skill, experience }) {
  if (!(experience > 0) || !active(player)) return;
  const total = (owed.get(player) ?? 0) + experience * effect.coinsPerXp;
  const coins = Math.floor(total);
  owed.set(player, total - coins);
  if (coins > 0) payCoins(player, coins);
  if (granting.has(player)) return;
  granting.add(player);
  try {
    player.getSkillManager().addExperiences(skill, effect.extraXp);
  } finally {
    granting.delete(player);
  }
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.abundance;
  api.persistAttribute(APPLIED_ATTRIBUTE, 0);
  api.registerRestingLevelModifier(restingLevel);
  api.onCustomEvent("league:login", refresh);
  api.onCustomEvent("league:relic-unlocked", refresh);
  api.onCustomEvent("league:relics-reset", refresh);
  api.onCustomEvent("skills:experience-gained", gained);
};
