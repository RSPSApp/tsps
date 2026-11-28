const Common = require('./Common.Leviathan');
const { own } = require('./Fight.Leviathan');
const Records = require('./Records.Leviathan');
const { sendBossKillCount } = require('../../interface/BossKillCount.plugin');
const MONSTER = Common.MONSTER;
const BOSS_NAME = 'Leviathan';
/** m:ss.cc, as the boss lines show a fight's time (0:34.20). */
function formatTicks(ticks) {
  const centis = Math.round(ticks * 60);
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

function current(npc, player = null) {
  const f = own(npc);
  return f && f.boss === npc && f.over && !f.stopped && !f.session.ended && f.session.fight === f &&
    npc.getHitpoints() === 0 && (!player || f.player === player) ? f : null;
}
function context(event) {
  const fight = current(event.npc, event.player);
  if (fight && event.context) event.context.perfectKill = fight.perfect;
}
/**
 * rsprox 227 (286 kills): the loot (and its spotanim 85) lands on 18 different tiles, wherever the
 * player stood, never on one fixed spot. Off the arena floor it falls back to the authored tile.
 */
function location(event) {
  const fight = current(event.npc, event.player);
  if (!fight) return;
  const at = fight.hazards.playerTile();
  event.location = fight.session.tile(fight.hazards.floor.has(`${at[0]},${at[1]}`) ? [...at, 0] : Common.data.arena.loot);
}
function died({ npc, killer }) {
  const fight = current(npc, killer);
  if (!fight || fight.rewarded || killer !== fight.player) return;
  fight.rewarded = true;
  // rsprox 227 (286/286 kills): "Fight duration" runs from the spawn to this kill message, after the
  // six-tick death animation, not to the lethal hit.
  fight.finishedTicks = Math.max(1, Common.core.World.getProcessCycle() - fight.startCycle);
  const { player, session, awakened } = fight;
  const key = awakened ? Common.AWAKENED_KILLS_ATTRIBUTE : Common.KILLS_ATTRIBUTE;
  const kills = awakened ? Common.count(player, key) + 1 : Math.max(fight.normalKillsAtStart + 1, Common.normalKills(player));
  const announce = count => sendBossKillCount(player, `Your ${awakened ? 'awakened ' : ''}Leviathan kill count is: <col=ff0000>${count}</col>.`);
  // The generic combat-achievement NPC-death hook owns kill-count achievements.
  announce(kills);
  player.setAttribute(key, kills);
  player.getPacketSender().sendConfig(Common.ids.varps[awakened ? 'awakenedKills' : 'kills'], kills);
  const bestKey = awakened ? Common.AWAKENED_BEST_ATTRIBUTE : Common.BEST_ATTRIBUTE;
  const previous = Common.count(player, bestKey), ticks = fight.finishedTicks;
  if (!previous || ticks < previous) player.setAttribute(bestKey, ticks);
  if (!previous || ticks < previous) Common.api.emitCustomEvent('boss:personal-best', { player, boss: `${awakened ? 'Awakened ' : ''}${BOSS_NAME}`, ticks });
  Records.won(fight);
  // rsprox 227/00100.txt:78155 "Fight duration: <col=ff0000>0:34.20</col> (new personal best)", and :80961
  // "Fight duration: <col=ff0000>0:35.40</col>. Personal best: 0:34.20".
  player.sendMessage(!previous || ticks < previous
    ? `Fight duration: <col=ff0000>${formatTicks(ticks)}</col> (new personal best)`
    : `Fight duration: <col=ff0000>${formatTicks(ticks)}</col>. Personal best: ${formatTicks(previous)}`);
  const complete = task => Common.api.emitCustomEvent('combat-achievements:complete', { player, task });
  if (awakened) complete('Leviathan Sleeper');
  else {
    if (fight.unconventional.eligible && fight.unconventional.fired) complete('Unconventional');
    if (fight.perfect && ++session.perfectKills >= 5) complete('Perfect Leviathan');
    if (fight.stuns <= 1) complete('Serpentine Solo');
    if (!fight.onSlayerTask) for (const [name, seconds] of [['Trialist', 110], ['Chaser', 85], ['Runner', 70]])
      if (ticks * 0.6 < seconds) complete(`Leviathan Speed-${name}`);
  }
  session.scheduleRespawn?.(fight);
  // The island rowboat becomes "Leave" (49214) at the kill, and the rubble crumbles a tick later.
  session.killed?.();
  Common.later(Common.data.rubbleCrumbleTicks, () => { if (!session.ended && session.fight === fight) fight.hazards.crumble(); });
}
function counts(request) { const count = Common.count(request.player, Common.KILLS_ATTRIBUTE); if (count) request.counts[MONSTER] = Math.max(count, Number(request.counts[MONSTER]) || 0); }
function best(request) {
  if (request.monster !== MONSTER) return;
  const own = Common.count(request.player, Common.BEST_ATTRIBUTE);
  if (own > 0) request.best = request.best > 0 ? Math.min(request.best, own) : own;
}
function login({ player }) {
  const kills = Common.normalKills(player);
  player.setAttribute(Common.KILLS_ATTRIBUTE, kills);
  player.getPacketSender().sendConfig(Common.ids.varps.kills, kills);
  player.getPacketSender().sendConfig(Common.ids.varps.awakenedKills, Common.count(player, Common.AWAKENED_KILLS_ATTRIBUTE));
}
function attach(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.AWAKENED_KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_ATTRIBUTE, 0);
  api.persistAttribute(Common.AWAKENED_BEST_ATTRIBUTE, 0);
  api.onNpcDeath(died);
  api.onPlayerLogin(login);
  api.onCustomEvent('npc-drops:context', context);
  api.onCustomEvent('npc-drops:location', location);
  api.onCustomEvent('combat-achievements:kill-count', counts);
  api.onCustomEvent('combat-achievements:personal-best', best);
}
module.exports = { attach };
