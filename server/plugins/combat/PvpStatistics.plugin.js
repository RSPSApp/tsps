const PLAYER_KILLS_ATTRIBUTE = "pvp:player-kills";
const BOT_KILLS_ATTRIBUTE = "pvp:bot-kills";
const PVP_DEATHS_ATTRIBUTE = "pvp:deaths";
const BOT_DEATHS_ATTRIBUTE = "pvp:bot-deaths";
const OTHER_DEATHS_ATTRIBUTE = "pvp:other-deaths";
const ELO_ATTRIBUTE = "pvp:elo";
const STREAK_ATTRIBUTE = "pvp:killstreak";
const PLAYER_KILLSTREAK_ATTRIBUTE = "pvp:player-killstreak";
const BOT_KILLSTREAK_ATTRIBUTE = "pvp:bot-killstreak";
const INITIAL_ELO = 1000;
const ELO_K = 32;
let pluginApi;

function realPlayer(player) {
  return player?.isPlayer?.() === true && player.isPlayerBot?.() !== true;
}

function count(player, key, fallback = 0) {
  const value = Number(player.getAttribute(key) ?? fallback);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function stats(player) {
  const playerKills = count(player, PLAYER_KILLS_ATTRIBUTE);
  const pvpDeaths = count(player, PVP_DEATHS_ATTRIBUTE);
  return {
    playerKills,
    botKills: count(player, BOT_KILLS_ATTRIBUTE),
    pvpDeaths,
    botDeaths: count(player, BOT_DEATHS_ATTRIBUTE),
    otherDeaths: count(player, OTHER_DEATHS_ATTRIBUTE),
    kdr: playerKills / Math.max(1, pvpDeaths),
    elo: count(player, ELO_ATTRIBUTE, INITIAL_ELO),
    killstreak: count(player, STREAK_ATTRIBUTE),
    playerKillstreak: count(player, PLAYER_KILLSTREAK_ATTRIBUTE),
    botKillstreak: count(player, BOT_KILLSTREAK_ATTRIBUTE),
  };
}

function queryStats(request) {
  if (realPlayer(request.player)) request.stats = stats(request.player);
}

function saveStats(player) {
  pluginApi.emitCustomEvent("persistence:save", { player, reason: "pvp-statistics" });
  pluginApi.emitCustomEvent("pvp:stats-changed", { player });
}

// Count actual deaths, rather than duel forfeits or the later reward/respawn hooks.
function recordDeath({ player: victim, killer }) {
  const victimIsPlayer = realPlayer(victim);
  const killerIsPlayer = killer !== victim && realPlayer(killer);
  if (!victimIsPlayer && !killerIsPlayer) return;
  const eligibility = { killer, victim, allow: true };
  pluginApi.emitCustomEvent("pvp:count-stats", eligibility);
  if (eligibility.allow === false) return;

  if (victimIsPlayer) {
    victim.setAttribute(PLAYER_KILLSTREAK_ATTRIBUTE, 0);
    victim.setAttribute(BOT_KILLSTREAK_ATTRIBUTE, 0);
  }
  if (victimIsPlayer && killerIsPlayer) {
    const winner = stats(killer);
    const loser = stats(victim);
    const expectedWin = 1 / (1 + 10 ** ((loser.elo - winner.elo) / 400));
    const change = Math.min(loser.elo, Math.round(ELO_K * (1 - expectedWin)));
    killer.setAttribute(PLAYER_KILLS_ATTRIBUTE, winner.playerKills + 1);
    killer.setAttribute(PLAYER_KILLSTREAK_ATTRIBUTE, winner.playerKillstreak + 1);
    victim.setAttribute(PVP_DEATHS_ATTRIBUTE, loser.pvpDeaths + 1);
    killer.setAttribute(ELO_ATTRIBUTE, winner.elo + change);
    victim.setAttribute(ELO_ATTRIBUTE, loser.elo - change);
    saveStats(killer);
    saveStats(victim);
  } else if (victimIsPlayer) {
    const attribute = killer?.isPlayerBot?.() === true ? BOT_DEATHS_ATTRIBUTE : OTHER_DEATHS_ATTRIBUTE;
    victim.setAttribute(attribute, count(victim, attribute) + 1);
    saveStats(victim);
  } else if (victim?.isPlayerBot?.() === true) {
    killer.setAttribute(BOT_KILLS_ATTRIBUTE, count(killer, BOT_KILLS_ATTRIBUTE) + 1);
    killer.setAttribute(BOT_KILLSTREAK_ATTRIBUTE, count(killer, BOT_KILLSTREAK_ATTRIBUTE) + 1);
    saveStats(killer);
  }
}

function initialize(api) {
  pluginApi = api;
}

module.exports = {
  name: "PvpStatistics",
  register(api) {
    initialize(api);
    api.persistAttribute(PLAYER_KILLS_ATTRIBUTE, 0);
    api.persistAttribute(PVP_DEATHS_ATTRIBUTE, 0);
    api.persistAttribute(BOT_DEATHS_ATTRIBUTE, 0);
    api.persistAttribute(BOT_KILLS_ATTRIBUTE, 0);
    api.persistAttribute(PLAYER_KILLSTREAK_ATTRIBUTE, 0);
    api.persistAttribute(BOT_KILLSTREAK_ATTRIBUTE, 0);
    api.persistAttribute(OTHER_DEATHS_ATTRIBUTE, 0);
    api.persistAttribute(ELO_ATTRIBUTE, INITIAL_ELO);
    api.onCustomEvent("player:dying", recordDeath);
    api.onCustomEvent("pvp:stats", queryStats);
  },
};
