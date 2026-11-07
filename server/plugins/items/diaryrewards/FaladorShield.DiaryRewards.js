/**
 * Falador shield (Wiki: Falador shield 1-4): Recharge-prayer restores 25%, 50% or 100% of the
 * Prayer level (rounded down) once a day, twice with shield 4; full Prayer spends no charge.
 * The restore plays the Elysian spirit shield's graphic (Wiki trivia). Check tells the charges
 * left. Uses count in varbit falador_shield_recharge. A recharge also clears the prayer drain
 * counter (Wiki: Prayer, Falador shield 4), so the next point is a whole drain-resistance away.
 */
const Rewards = require("./Common.DiaryRewards");

const DAILY_KEY = "falador-shield";
const FULL_MESSAGE = "Your Prayer points are already full.";
const SPENT_MESSAGE = "You have already used your shield's prayer restore for today.";
const RESTORED_MESSAGE = "Your shield restores your Prayer points.";
const CHARGES_MESSAGE = (left) => `Your shield has ${left} prayer ${left === 1 ? "restore" : "restores"} left for today.`;

function shield() {
  return Rewards.DATA.faladorShield;
}

function chargesLeft(player, tier) {
  return Math.max(0, shield().perDay[tier] - Rewards.dailyUses(player, DAILY_KEY));
}

function rechargePrayer(player, tier) {
  const { Skill, Graphic, GraphicHeight } = Rewards.core;
  const skills = player.getSkillManager();
  const max = skills.getMaxLevel(Skill.PRAYER);
  const current = skills.getCurrentLevel(Skill.PRAYER);
  if (current >= max) {
    player.sendMessage(FULL_MESSAGE);
    return;
  }
  if (chargesLeft(player, tier) <= 0) {
    player.sendMessage(SPENT_MESSAGE);
    return;
  }
  const restore = Math.floor(max * shield().restorePercent[tier] / 100);
  skills.setCurrentLevel(Skill.PRAYER, Math.min(max, current + restore), true);
  player.setPrayerPointDrain?.(0);
  player.performGraphic(new Graphic(Rewards.gamevalId("spotanim", shield().spotanim), GraphicHeight.LOW));
  const used = Rewards.useDaily(player, DAILY_KEY);
  Rewards.sendCount(player, Rewards.gamevalId("varbit", shield().varbit), used);
  player.sendMessage(RESTORED_MESSAGE);
}

function check(player, tier) {
  player.sendMessage(CHARGES_MESSAGE(chargesLeft(player, tier)));
}

function syncOnLogin({ player }) {
  const used = Rewards.dailyUses(player, DAILY_KEY);
  if (used > 0) Rewards.sendCount(player, Rewards.gamevalId("varbit", shield().varbit), used);
}

function actionsFor(tier) {
  const recharge = ({ player }) => rechargePrayer(player, tier);
  const checkCharges = ({ player }) => check(player, tier);
  return { "Recharge-prayer": recharge, "Recharge Prayer": recharge, Check: checkCharges };
}

module.exports = function attachFaladorShield(api) {
  for (const { name, tier } of Rewards.tierNames(shield().objs)) api.onItemAction(name, actionsFor(tier));
  api.onPlayerLogin(syncOnLogin);
};

module.exports._test = { rechargePrayer, check, chargesLeft, DAILY_KEY };
