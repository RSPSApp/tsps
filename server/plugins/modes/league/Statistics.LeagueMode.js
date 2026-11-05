/**
 * The League Summary's statistics (data.statistics): the tracking varps its rows read, counted
 * from what the server's hooks see for a league character and sent at login and as they change.
 * Kills (NPCs; bosses by the cache's boss param, as NpcDrops reads it), deaths, players killed,
 * damage dealt to and taken from NPCs, the highest hit, food, potions and fish. Rows the server
 * has no source for stay 0 (data.statistics._comment). The logs and ore rows read varps the skills
 * own (data.statistics.skillCounters): Woodcutting and Mining count and send them on every world, so
 * this unit only reads them back for its answer and never writes them. Other plugins ask
 *
 *   api.emitCustomEvent("league:statistics", { player })  -> counters (name -> value)
 */
const Common = require("./Common.LeagueMode");

/** Counter name -> value. */
const STATISTICS_ATTRIBUTE = "league:statistics";

function statistics() {
  return Common.data.statistics;
}

function counters(player) {
  const value = player.getAttribute(STATISTICS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sendCounter(player, name, value) {
  const { varps, varbits } = statistics();
  const sender = player.getPacketSender();
  if (varps[name] !== undefined) sender.sendConfig(varps[name], value);
  else if (varbits[name] !== undefined) sender.sendVarbit(varbits[name], value);
}

function set(player, name, value) {
  const current = counters(player);
  if (current[name] === value) return;
  player.setAttribute(STATISTICS_ATTRIBUTE, { ...current, [name]: value });
  sendCounter(player, name, value);
}

function add(player, name, amount = 1) {
  if (!Common.isLeagueProfile(player) || !(amount > 0)) return;
  set(player, name, (Number(counters(player)[name]) || 0) + amount);
}

function raise(player, name, value) {
  if (!Common.isLeagueProfile(player) || !(value > (Number(counters(player)[name]) || 0))) return;
  set(player, name, value);
}

function damageOf(hit) {
  const damage = Number(hit?.getTotalDamage?.() ?? hit?.getDamage?.());
  return Number.isFinite(damage) && damage > 0 ? damage : 0;
}

function isBoss(npcId) {
  return Number.isInteger(Common.core.CacheDefinitions.getNpc(npcId)?.params?.get?.(statistics().bossParam));
}

function npcDeath({ killer, npcId }) {
  if (!killer?.isPlayer?.()) return;
  const player = killer.getAsPlayer?.() ?? killer;
  add(player, "npcsKilled");
  if (isBoss(npcId)) add(player, "bossesKilled");
}

/** Damage dealt to an NPC and the highest hit, from what each hitsplat took off it once it landed. */
function countLanded(player, hit) {
  for (const part of hit?.getHits?.() ?? []) {
    part?.onApplied?.((damage) => {
      add(player, "damageDealt", damage);
      raise(player, "highestHit", damage);
    });
  }
}

/**
 * A hit that reaches its target has its damage queued: a player's on an NPC is counted as each
 * hitsplat lands (a projectile cancelled by its shooter's death, or damage the NPC no longer has
 * hitpoints for, counts nothing); an NPC's on a player counts as it resolves.
 */
function hitResolved({ attacker, target, hit }) {
  if (attacker?.isPlayer?.() && target?.isNpc?.()) {
    const player = attacker.getAsPlayer?.() ?? attacker;
    if (Common.isLeagueProfile(player)) countLanded(player, hit);
    return;
  }
  if (!attacker?.isNpc?.() || !target?.isPlayer?.()) return;
  add(target.getAsPlayer?.() ?? target, "damageTaken", damageOf(hit));
}

function playerDeath({ player }) {
  add(player, "deaths");
}

function playerDefeated({ killer, victim }) {
  if (killer?.isPlayer?.() && victim?.isPlayer?.()) add(killer.getAsPlayer?.() ?? killer, "playersKilled");
}

const counted = (name) => ({ player }) => add(player, name);

/** The Fishing Trawler emits fishing:success once per reward, not per fish. */
function fishCaught(event) {
  if (event?.source !== "fishing-trawler") add(event.player, "fishCaught");
}

function login({ player }) {
  const { varps, varbits } = statistics();
  const current = counters(player);
  for (const name of [...Object.keys(varps), ...Object.keys(varbits)]) sendCounter(player, name, Number(current[name]) || 0);
}

/** A skill-owned counter, from the skill that sends its varp ({ player, count } queries). */
function skillCounter(player, event) {
  const query = { player, count: 0 };
  Common.api.emitCustomEvent(event, query);
  return Number(query.count) || 0;
}

function answer(query) {
  if (!query?.player || !Common.isLeagueProfile(query.player)) return;
  // The skill's count stands in for any this unit kept before it stopped counting them.
  const result = { ...counters(query.player) };
  for (const [name, event] of Object.entries(statistics().skillCounters)) {
    const count = skillCounter(query.player, event);
    if (count > 0) result[name] = count;
    else delete result[name];
  }
  query.counters = result;
}

module.exports = function attach(api) {
  api.persistAttribute(STATISTICS_ATTRIBUTE, {});
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("league:statistics", answer);
  api.onNpcDeath(npcDeath);
  api.onCombatHitResolved(hitResolved);
  api.onPlayerDeath(playerDeath);
  api.onPlayerDefeated(playerDefeated);
  api.onCustomEvent("food:eaten", counted("foodEaten"));
  api.onCustomEvent("potions:drunk", counted("potionsSipped"));
  api.onCustomEvent("fishing:success", fishCaught);
};

module.exports.counters = counters;
