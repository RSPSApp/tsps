/**
 * Idle points and upgrades (plugins/modes/data/idle-mode.json "progression"). An idle account
 * earns a point per `xpPerPoint` XP in the idle skills (and the combat skills), online and offline (the offline XP lands
 * through the same experience hook). Points buy upgrade levels with `::idle buy <upgrade>`:
 * Quick Hands (a chance an action takes a tick less: `skills:action-interval`, `fishing:interval`),
 * Long Dreams (more offline hours) and Bountiful Harvest (a chance of an extra resource to the bank;
 * offline, its expected share). `::idle points` and `::idle shop` show them.
 */
const Common = require("./Common.IdleMode");

const POINTS_ATTRIBUTE = "idle-mode:points";
/** XP gained toward the next point, below `xpPerPoint`. */
const PROGRESS_ATTRIBUTE = "idle-mode:point-progress";
/** { upgradeId: level }. */
const UPGRADES_ATTRIBUTE = "idle-mode:upgrades";
/**
 * Saved: every idle point earned, spent or not (the hiscores). An account from before it was kept
 * starts from its points and what its upgrades cost.
 */
const EARNED_ATTRIBUTE = "idle-mode:points-earned";

/** Gathering actions Quick Hands speeds up (`skills:action-interval` kinds). */
const QUICK_KINDS = new Set(["chop", "mine"]);

function config() {
  return Common.data.progression;
}

function points(player) {
  return Number(player.getAttribute(POINTS_ATTRIBUTE)) || 0;
}

function levelOf(player, id) {
  return Number(player.getAttribute(UPGRADES_ATTRIBUTE)?.[id]) || 0;
}

function upgrade(id) {
  return config().upgrades[id] ?? null;
}

/** The hours of time away paid: the base cap and Long Dreams' levels. */
function capHours(player) {
  return Common.data.offline.capHours + levelOf(player, "long-dreams") * (upgrade("long-dreams")?.offlineHoursPerLevel ?? 0);
}

/** Bountiful Harvest's chance of an extra resource. */
function bountyChance(player) {
  return levelOf(player, "bountiful-harvest") * (upgrade("bountiful-harvest")?.extraChancePerLevel ?? 0);
}

function tickSaveChance(player) {
  return levelOf(player, "quick-hands") * (upgrade("quick-hands")?.tickSaveChancePerLevel ?? 0);
}

/**
 * Whether this XP earns points: an idle skill's, or idle combat's (`combat.pointsFromXp`), or
 * idle production's (`production.pointsFromXp`).
 */
function earns(player, skill) {
  if (Common.idleGather(player, skill)) return true;
  if (!Common.isIdle(player)) return false;
  if (Common.data.combat.pointsFromXp && Common.idleCombatSkill(skill)) return true;
  return Common.data.production.pointsFromXp === true && Common.idleProductionSkill(skill);
}

/** `onExperienceGained`: idle XP fills points. */
function earn({ player, skill, experience }) {
  if (!earns(player, skill) || !(experience > 0)) return;
  const progress = (Number(player.getAttribute(PROGRESS_ATTRIBUTE)) || 0) + experience;
  const earned = Math.floor(progress / config().xpPerPoint);
  player.setAttribute(PROGRESS_ATTRIBUTE, progress - earned * config().xpPerPoint);
  if (earned > 0) {
    player.setAttribute(EARNED_ATTRIBUTE, earnedPoints(player) + earned);
    player.setAttribute(POINTS_ATTRIBUTE, points(player) + earned);
  }
  Common.changed(player);
}

/** Every point earned, spent or not. */
function earnedPoints(player) {
  const saved = player.getAttribute(EARNED_ATTRIBUTE);
  if (saved !== null && saved !== undefined) return Number(saved) || 0;
  let spent = 0;
  for (const [id, entry] of Object.entries(config().upgrades)) spent += entry.costs.slice(0, levelOf(player, id)).reduce((total, cost) => total + cost, 0);
  return points(player) + spent;
}

/** Gives idle points (a daily goal's reward). */
function addPoints(player, amount) {
  if (!(amount > 0)) return;
  player.setAttribute(EARNED_ATTRIBUTE, earnedPoints(player) + amount);
  player.setAttribute(POINTS_ATTRIBUTE, points(player) + amount);
  Common.changed(player);
}

/** XP gained toward the next point. */
function progress(player) {
  return Number(player.getAttribute(PROGRESS_ATTRIBUTE)) || 0;
}

/** Each upgrade for the Idle screen: { id, name, description, level, maxLevel, cost (null at max) }. */
function upgradeRows(player) {
  return Object.entries(config().upgrades).map(([id, entry]) => {
    const level = levelOf(player, id);
    // `short` is the panel's line; `description` is the long one ::idle upgrades prints.
    return { id, name: entry.name, description: entry.description, short: entry.short ?? entry.description, level, maxLevel: entry.costs.length, cost: entry.costs[level] ?? null };
  });
}

function quickHands(request) {
  if (request.ticks <= 1) return;
  if (Math.random() < tickSaveChance(request.player)) request.ticks -= 1;
}

/** `skills:action-interval`: a chop or a swing of the pickaxe, or any idle production's action. */
function actionInterval(request) {
  const { player, skill, kind } = request;
  const gathering = QUICK_KINDS.has(kind) && Common.idleGather(player, skill);
  const making = Common.isIdle(player) && Common.idleProductionSkill(skill);
  if (gathering || making) quickHands(request);
}

function fishingInterval(request) {
  if (Common.idleGather(request.player, Common.core.Skill.FISHING)) quickHands(request);
}

/** `storage:gather`: Bountiful Harvest's extra resource goes to the bank, with no XP. */
function bounty(request) {
  const { player } = request;
  if (!Common.idleGather(player, request.skill) || request.amount <= 0) return;
  if (Math.random() < bountyChance(player)) Common.bank(player, request.itemId, 1);
}

function shopLines(player) {
  const lines = [`You have ${points(player).toLocaleString("en-US")} idle points.`];
  for (const [id, entry] of Object.entries(config().upgrades)) {
    const level = levelOf(player, id);
    const next = entry.costs[level];
    const price = next === undefined ? "max level" : `next level ${next.toLocaleString("en-US")} points`;
    lines.push(`${entry.name} (${id}) ${level}/${entry.costs.length}: ${entry.description}. ${price}.`);
  }
  lines.push("Buy a level with ::idle buy <name>.");
  return lines;
}

/** Buys the upgrade's next level; the message for the player. */
function buy(player, id) {
  const entry = upgrade(id);
  if (!entry) return `There's no upgrade called ${id || "that"}. See ::idle shop.`;
  const level = levelOf(player, id);
  const cost = entry.costs[level];
  if (cost === undefined) return `${entry.name} is already at its highest level.`;
  if (points(player) < cost) return `${entry.name} level ${level + 1} costs ${cost.toLocaleString("en-US")} points; you have ${points(player).toLocaleString("en-US")}.`;
  player.setAttribute(POINTS_ATTRIBUTE, points(player) - cost);
  player.setAttribute(UPGRADES_ATTRIBUTE, { ...(player.getAttribute(UPGRADES_ATTRIBUTE) ?? {}), [id]: level + 1 });
  Common.changed(player);
  return `${entry.name} is now level ${level + 1}.`;
}

/** `::idle points | shop | buy <upgrade>`. */
function progressionCommand(player, parts) {
  const choice = String(parts[1] ?? "").toLowerCase();
  if (choice === "points") player.sendMessage(shopLines(player)[0]);
  else if (choice === "shop") shopLines(player).forEach((line) => player.sendMessage(line));
  else if (choice === "buy") player.sendMessage(buy(player, String(parts[2] ?? "").toLowerCase()));
}

module.exports = function attach(api) {
  api.persistAttribute(POINTS_ATTRIBUTE, 0);
  api.persistAttribute(PROGRESS_ATTRIBUTE, 0);
  api.persistAttribute(UPGRADES_ATTRIBUTE, {});
  // No fixed start: an account from before it was kept works it out (earnedPoints).
  api.persistAttribute(EARNED_ATTRIBUTE, null);
  api.onExperienceGained(earn);
  api.onCustomEvent("skills:action-interval", actionInterval);
  api.onCustomEvent("fishing:interval", fishingInterval);
  api.onCustomEvent("storage:gather", bounty);
};

module.exports.COMMANDS = ["points", "shop", "buy"];
module.exports.progressionCommand = progressionCommand;
module.exports.capHours = capHours;
module.exports.bountyChance = bountyChance;
module.exports.points = points;
module.exports.earned = earnedPoints;
module.exports.EARNED_ATTRIBUTE = EARNED_ATTRIBUTE;
module.exports.levelOf = levelOf;
module.exports.progress = progress;
module.exports.addPoints = addPoints;
module.exports.upgradeRows = upgradeRows;
module.exports.buy = buy;
