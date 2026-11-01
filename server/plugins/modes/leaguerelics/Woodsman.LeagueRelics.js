/**
 * Woodsman (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts' tier 2
 * relic: Fletching makes everything at once (the stackable ammunition 10 times the usual a cycle),
 * chopped logs are burnt for their full Firemaking XP while its burn toggle is on (the default;
 * attached before the other gathering relics, so a doubled harvest's extra logs are banked: ours),
 * and in Hunter every catch succeeds, traps look for prey faster (ours: every 2 ticks instead of
 * 5) and give double loot and XP, sent to the bank while its bank toggle is on (the default) and
 * the bank has room, and impling jars never break.
 * Not here: the herb or tree seed every trap drops (no list of them), the doubled Hunters'
 * rumour XP and loot sack rolls, the noted extra roll of an impling jar, and Quetzal whistles
 * that keep their charges (none of those asks a hook).
 */
const Common = require("./Common.LeagueRelics");
const Toggles = require("./Toggles.LeagueRelics");

let api;
let core;
let effect;

function active(player) {
  return Common.effectActive(player, effect);
}

function allAtOnce(request) {
  if (!active(request.player)) return;
  const actions = Common.batchActions(effect, request);
  if (actions) request.actions = Math.max(request.actions, actions);
}

function burning(player) {
  return active(player) && Toggles.on(player, effect.burnToggle);
}

function logXp(logId) {
  const fire = { logId, xp: null };
  api.emitCustomEvent("firemaking:log-xp", fire);
  return fire.xp;
}

/** A chopped log is burnt: its Firemaking XP, nothing to carry. */
function burn(request) {
  const { player, itemId, amount } = request;
  if (request.stored >= amount || request.skill !== core.Skill.WOODCUTTING || !burning(player)) return;
  const xp = logXp(itemId);
  if (!(xp > 0)) return;
  player.getSkillManager().addExperiences(core.Skill.FIREMAKING, xp * (amount - request.stored));
  request.stored = amount;
}

/** Burnt logs need no room. */
function room(request) {
  if (!request.room && request.skill === core.Skill.WOODCUTTING && burning(request.player) && logXp(request.itemId) > 0) request.room = true;
}

function catchChance(request) {
  if (active(request.player)) request.chance = 1;
}

function lure(request) {
  if (active(request.player)) request.ticks = Math.min(request.ticks, effect.lureTicks);
}

/** Double loot and XP; the loot to the bank while the toggle is on (what it has no room for stays with the trap's own delivery). */
function trapRewards(request) {
  if (!active(request.player)) return;
  request.xp *= effect.trapMultiplier;
  const rewards = request.rewards.map(([itemId, amount]) => [itemId, amount * effect.trapMultiplier]);
  request.rewards = Toggles.on(request.player, effect.bankToggle)
    ? rewards.filter(([itemId, amount]) => !Common.bank(request.player, itemId, amount))
    : rewards;
}

function jarKept(request) {
  if (active(request.player)) request.kept = true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  effect = Common.data.effects.woodsman;
  api.onCustomEvent("skills:actions-per-cycle", allAtOnce);
  api.onCustomEvent("storage:gather", burn);
  api.onCustomEvent("storage:room", room);
  api.onCustomEvent("hunter:catch-chance", catchChance);
  api.onCustomEvent("hunter:lure-interval", lure);
  api.onCustomEvent("hunter:rewards", trapRewards);
  api.onCustomEvent("hunter:jar-kept", jarKept);
};
