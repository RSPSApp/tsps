/**
 * Abundance (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 1
 * relic: every non-combat skill is boosted by 10 (invisible here: it counts wherever a skill asks
 * `skills:level-boost`), every experience drop brings 2 more experience in the same skill (with
 * the league's rate, as the Wiki says), and every experience point gained brings 2 coins, to the
 * inventory while its toggle is on (the default) and there is room, else the bank. Coins are paid
 * on the gain as it landed (after the rates); fractions carry to the next gain (ours).
 */
const Common = require("./Common.LeagueRelics");
const Toggles = require("./Toggles.LeagueRelics");

let core;
let effect;
let combat;

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

function levelBoost(request) {
  if (nonCombat(request.skill) && active(request.player)) request.boost += effect.levelBoost;
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
  api.onCustomEvent("skills:level-boost", levelBoost);
  api.onCustomEvent("skills:experience-gained", gained);
};
