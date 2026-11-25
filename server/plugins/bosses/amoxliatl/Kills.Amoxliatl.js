/**
 * Amoxliatl's death, as captured: on the killing blow she plays her death (11532,
 * npc-combat-defs) and every icy pool goes with a puff. 2 ticks later (`deathTicks`) she is gone:
 * "Your Amoxliatl kill count is: N." (varp 4403, through Combat Achievements), the fight's
 * length against the personal best, and the loot on her middle tile (NpcDrops). The HUD fades 4
 * ticks after that. She rises again on her platform 28 ticks later (R1140 ticks 7945-7973) for as long as
 * the player stays.
 *
 * The quest's guardian doesn't die (R1140 ticks 7686-7693, R1695 4926-4934): at 0 HP she becomes
 * amoxliatl_quest_inactive (13687) with 11531 and "Zema ami miki!", her pools go with a puff, and she
 * throws a last icicle at the player. 3 ticks later the player teleports (4018, 2754) as she plays
 * her death (11532), the sound 7928 a tick after, and 6 ticks after the 0 HP the player is out:
 * the quest plugin's banishment ("amoxliatl:quest-defeated").
 */
const Common = require("./Common.Amoxliatl");
const CombatAchievements = require("./CombatAchievements.Amoxliatl");
const Scoreboard = require("./Scoreboard.Amoxliatl");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");

const HUD_FADE_AFTER_REMOVAL_TICKS = 4;
const BOSS_NAME = "Amoxliatl";

function bossBeforeDeath(event) {
  const fight = event.npc?.__amoxliatlFight;
  if (!fight || event.preventDeath) return;
  if (fight.session.quest) {
    event.preventDeath = true;
    if (!fight.over) questEnd(fight);
    return;
  }
  if (fight.over) return;
  fight.died();
}

/** The quest's guardian at 0 HP: she banishes the player instead of dying. */
function questEnd(fight) {
  const { Animation, ChatType, Graphic, Projectile } = Common.core;
  const { session, player, boss } = fight;
  const end = Common.data.questEnd;
  fight.died();
  boss.setHitpointsLocked(true);
  boss.getCombat().reset();
  boss.getCombat().getHitQueue().clear();
  player.getCombat().reset();
  boss.setNpcTransformationId(end.inactive);
  boss.setPositionToFace(player.getLocation());
  boss.performAnimation(new Animation(end.anim));
  boss.forceChat(end.say);
  player.getPacketSender().sendTypedMessage(ChatType.NPC_SAY, end.say, boss.getDefinition().getName());
  const spec = end.projectile;
  new Projectile(Projectile.centreOf(boss), player.getLocation(), null, spec.id, spec.start, spec.end,
    spec.startHeight, spec.endHeight, session.area)
    .withAngle(spec.angle)
    .withProgress(spec.progress)
    .sendProjectile();
  const live = () => !session.ended && player.isRegistered();
  Common.later(end.teleportTicks, () => {
    if (!live()) return;
    player.performAnimation(new Animation(end.playerAnim));
    player.performGraphic(new Graphic(end.playerSpotanim));
    boss.performAnimation(new Animation(end.deathAnim));
  });
  Common.later(end.soundTicks, () => live() && player.getPacketSender().sendSoundEffect(end.sound, 1, 0));
  Common.later(end.outTicks, () => {
    if (!live()) return;
    fight.hideHud();
    session.end();
    Common.api.emitCustomEvent('amoxliatl:quest-defeated', { player });
  });
}

function bossDeath(event) {
  const fight = event.npc?.__amoxliatlFight;
  if (!fight || fight.stopped) return;
  const { session, player } = fight;
  if (session.echoToken) {
    if (session.echoCompleted) return;
    session.echoCompleted = true;
    Common.api.emitCustomEvent("echo-boss:completed", { player, boss: "amoxliatl", token: session.echoToken, npcs: [event.npc], location: Common.core.Projectile.centreOf(event.npc) });
    fight.hideHud();
    fight.stop();
    // Keep the exit available, but never respawn a second boss in this session.
    return;
  }
  // The quest's guardian never dies (questEnd); nothing here is hers.
  if (session.quest) return;
  const ticks = fight.duration();
  const best = Number(player.getAttribute(Common.BEST_TICKS_ATTRIBUTE)) || 0;
  if (!best || ticks < best) player.setAttribute(Common.BEST_TICKS_ATTRIBUTE, ticks);
  if (!best || ticks < best) Common.api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
  const duration = !best || ticks < best
    ? `Fight duration: <col=ff0000>${Common.formatTicks(ticks)}</col> (new personal best)`
    : `Fight duration: <col=ff0000>${Common.formatTicks(ticks)}</col>. Personal best: ${Common.formatTicks(best)}`;
  const own = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
  // As captured, both lines come before any Combat Achievement the kill finishes.
  const total = CombatAchievements.killed(player, own, (kills) => {
    sendBossKillCount(player, `Your Amoxliatl kill count is: <col=ff0000>${kills}</col>.`);
    player.sendMessage(duration);
  });
  player.setAttribute(Common.KILLS_ATTRIBUTE, Math.max(own, total ?? 0));
  if (total == null) player.getPacketSender().sendConfig(Common.data.kill.killCountVarp, own);
  session.kills++;
  Scoreboard.won(ticks);
  CombatAchievements.judge(fight, ticks);

  Common.later(HUD_FADE_AFTER_REMOVAL_TICKS, () => {
    fight.hideHud();
    fight.stop();
  });
  session.boss = null;
  Common.later(Common.data.spawn.respawnTicks, () => session.spawnBoss());
}

/** The loot lands on her middle tile, as captured, not her south-west corner. */
function lootOnMiddle(where) {
  const fight = where.npc?.__amoxliatlFight;
  if (!fight) return;
  const { Projectile } = Common.core;
  where.location = Projectile.centreOf(where.npc);
}

function sendKillCount({ player }) {
  const kills = Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0;
  if (kills > 0) player.getPacketSender().sendConfig(Common.data.kill.killCountVarp, kills);
}

module.exports = function attachKills(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_TICKS_ATTRIBUTE, 0);
  api.onNpcBeforeDeath(bossBeforeDeath);
  api.onNpcDeath(bossDeath);
  api.onCustomEvent("npc-drops:location", lootOnMiddle);
  api.onPlayerLogin(sendKillCount);
};
