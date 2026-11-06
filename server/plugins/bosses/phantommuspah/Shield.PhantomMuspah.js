/**
 * The shockwave and the prayer shield (docs/phantom-muspah.md), as captured:
 * - Below 127 hitpoints the Muspah teleports to the arena's centre (the purple message, seq 9928
 *   and spot 2332; three ticks later seq 9932 and spot 2334), winds up two ticks after (seq 9925,
 *   spot 2322, eight sounds) and five ticks after that lets the shockwave go (spot 2323, sound
 *   6817): map animations over the whole arena, three cycles further per tile, except on the tiles
 *   a spike shelters from the centre. Up to 80 typeless damage and corruption elsewhere (Wiki).
 * - Three ticks later its shielded form: a 75-point prayer shield on the HUD and head bar that
 *   regular hits don't touch. Each of its attacks drains 2; a hit with Smite on drains a quarter of
 *   the hit (the prayer-drain hitsplat). With Soul Split it heals half of the damage it deals. When
 *   the shield breaks it takes its post-shield form, with a wave of spikes.
 * - Shield skip (Wiki): hitpoints reaching 0 before the shield goes up leave it on 1 and skip the
 *   shield; any more damage before then fails the skip and the damage is undone (captured).
 */
const Common = require("./Common.PhantomMuspah");
const Corruption = require("./Corruption.PhantomMuspah");
const Hits = require("./Hits.PhantomMuspah");

const MESSAGE_GAP_TICKS = 8;

/** The shockwave, from the teleport to the shield going up (or being skipped). */
function shockwave(fight) {
  const { shockwave: wave, clouds, specials, overlay } = Common.data;
  const { muspah, player } = fight;
  fight.shockwaveStarted = true;
  fight.hold(true);
  player.sendMessage(specials.message);
  Common.animate(muspah, clouds.disappearAnim);
  muspah.performGraphic(Common.graphic(clouds.disappearSpot));
  Common.sounds(player, clouds.disappearSounds);
  Common.overlayFade(player, overlay.dark);
  let at = wave.teleportTicks;
  fight.at(at, () => {
    fight.moveMuspah(wave.tile);
    Common.animate(muspah, clouds.landAnim);
    muspah.performGraphic(Common.graphic(clouds.landSpot));
  });
  at += wave.windupTicks;
  fight.at(at, () => {
    Common.animate(muspah, wave.windupAnim);
    muspah.performGraphic(Common.graphic(wave.windupSpot));
    Common.sounds(player, wave.windupSounds);
  });
  at += wave.releaseTicks;
  fight.at(at, () => release(fight));
  at += wave.shieldTicks;
  fight.at(at, () => (fight.pendingSkip ? skip(fight) : raise(fight)));
}

/** The shockwave goes: every unsheltered tile, and the player if they stand on one. */
function release(fight) {
  const { shockwave: wave, boss } = Common.data;
  const { player, spikes } = fight;
  fight.muspah.performGraphic(Common.graphic(wave.releaseSpot));
  Common.sound(player, wave.releaseSound);
  const { tiles, kind } = Common.arena();
  for (const [dx, dy] of tiles) {
    const type = kind.get(`${dx},${dy}`);
    if (!type) continue;
    const tile = Common.fromCentre([dx, dy]);
    if (spikes.has(tile) || spikes.shelters(boss.centre, tile)) continue;
    const distance = Math.abs(dx) + Math.abs(dy);
    const bright = type === "bright";
    Common.tileGraphic(player, fight.session.tile([tile[0], tile[1], 0]), bright ? wave.brightSpot : wave.darkSpot,
      { delay: Math.max(0, distance * 3 - (bright ? 1 : 6)) });
  }
  const at = spikes.playerTile();
  if (!Common.onArena(at) || spikes.shelters(boss.centre, at)) return;
  fight.at(wave.hitTicks, () => {
    if (fight.stopped || !Common.alive(player)) return;
    Hits.damage(player, Common.randomInt(0, wave.maxHit));
    Corruption.corrupt(player, Common.data.corruption.shockwaveBase);
  });
}

/** The shielded form: the shield on the HUD and head bar, homing spikes hardened. */
function raise(fight) {
  const { shield, overlay } = Common.data;
  fight.shield = shield.points;
  fight.spikes.hardenAll();
  fight.setForm("shielded");
  const defence = Common.core.Skill.DEFENCE;
  fight.muspah.setCurrentLevels(defence, fight.muspah.getMaxLevel(defence));
  fight.muspah.setHealthBar(shield.healthBar);
  fight.showShield();
  Common.overlayFade(fight.player, overlay.clear);
  fight.hold(false);
}

/** The skip: no shield, straight to the post-shield form on 1 hitpoint (Wiki). */
function skip(fight) {
  fight.pendingSkip = null;
  fight.muspah.setHitpoints(1);
  fight.shieldDone = true;
  Common.overlayFade(fight.player, Common.data.overlay.clear);
  fight.spikes.hardenAll();
  fight.setForm("final");
  fight.spikes.growthWave();
  fight.hold(false);
}

/** A player's hit on the shield: nothing gets through; Smite drains a quarter of it. */
function hitShield(fight, hit) {
  const { shield } = Common.data;
  const attacker = hit.getAttacker?.();
  const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
  const total = hit.getTotalDamage();
  for (const part of hit.getHits()) part.setDamage(0);
  hit.updateTotalDamage();
  if (!player) return;
  const smite = Hits.prayerOn(player, "SMITE");
  if (smite && total > 0) {
    drain(fight, Math.floor(total * shield.smiteShare));
    return;
  }
  if (fight.tick - (fight.lastShieldMessage ?? -Infinity) >= MESSAGE_GAP_TICKS) {
    fight.lastShieldMessage = fight.tick;
    player.sendMessage(shield.message);
  }
}

/** Drains the shield (its own attacks, Smite), breaking it at 0. */
function drain(fight, amount) {
  if (fight.form !== "shielded" || amount <= 0) return;
  const { shield } = Common.data;
  const drained = Math.min(fight.shield, amount);
  fight.shield -= drained;
  fight.muspah.showHitsplat(drained, { mine: shield.drainSplat, others: shield.drainSplat });
  fight.showShield();
  if (fight.shield <= 0) fight.at(1, () => breakShield(fight));
}

/** The shield breaks: the post-shield form, the HUD back on its hitpoints, and spikes. */
function breakShield(fight) {
  if (fight.form !== "shielded" || fight.stopped) return;
  fight.shieldDone = true;
  fight.muspah.setHealthBar(Common.data.boss.healthBar);
  fight.setForm("final");
  fight.showHitpoints();
  fight.attacksSinceGrowth = 0;
  fight.spikes.growthWave();
}

/** Soul Split: the shielded Muspah heals half of what its hit deals. */
function soulSplit(fight, dealt) {
  if (fight.form !== "shielded") return;
  Hits.heal(fight.muspah, Math.floor(dealt * Common.data.shield.soulSplitHeal));
}

module.exports = { shockwave, hitShield, drain, soulSplit };
