// Tells the client the rate this player's Hitpoints XP is paid at: the world's experience
// multiplier times their own (a league profile's), as SkillManager.addExperience applied it.
// The client's Customizable XP Drops plugin divides a Hitpoints gain by it to predict the hit
// before the hitsplat lands; without it, a 10x world predicts hits ten times too large.
const DATASET = "hitpointsXpRate";
/**
 * Hitpoints XP paid without the rates (a league relic's bonus, Equilibrium's, lands in the same
 * tick as the hit's own): the client takes it out of the gain it predicts the hit from.
 */
const UNMULTIPLIED_DATASET = "hitpointsXpUnmultiplied";

/** The rate last sent to each player, so a gain at the same rate sends nothing. */
const sent = new WeakMap();
let core = null;

function send(player, rate) {
  if (!Number.isFinite(rate) || rate <= 0 || sent.get(player) === rate) return;
  sent.set(player, rate);
  player.getPacketSender().sendContentData("server", [{ key: DATASET, rows: [rate] }]);
}

/** The world's rate; a player's own rate isn't known until their first Hitpoints gain. */
function login({ player }) {
  sent.delete(player);
  send(player, core.GameConstants.EXPERIENCE_MULTIPLIER);
}

/**
 * `skills:experience-gained`: a Hitpoints gain with the rates applied carries the full rate; one
 * without them is tagged, so it isn't read as part of a hit.
 */
function gained({ player, skill, multiplied, rate, experience }) {
  if (skill !== core.Skill.HITPOINTS) return;
  if (multiplied) send(player, rate);
  else if (experience > 0) player.getPacketSender().sendContentData("server", [{ key: UNMULTIPLIED_DATASET, rows: [experience] }]);
}

module.exports = {
  name: "Hitpoints XP Rate",
  register(api) {
    core = api.core;
    api.onPlayerLogin(login);
    api.onCustomEvent("skills:experience-gained", gained);
  },
};
