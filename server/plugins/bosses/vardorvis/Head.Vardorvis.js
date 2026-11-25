/**
 * Vardorvis' head (rsprox 3285, 1156): with one of his slashes a head rises on a tile near him, screams
 * and spits a projectile at the player ("Vardorvis' head gazes upon you..."). It does no damage;
 * three ticks later, as it lands, the head goes and - unless the player was praying against it and
 * he still lives - their protection prayers switch off: "You've been injured and can't use
 * protection prayers!", 10 Prayer drained (Wiki), and for 3 ticks they can't be turned back on
 * ("You've been injured and can't use that prayer!").
 * The head screams as it rises (sound 3539; 277 for a magic one) and its projectile lands with
 * sound 4015, blocked or not (captured).
 * The head is ranged (Protect from Missiles). Awakened it can be magic (Protect from Magic), and
 * below half his hitpoints two heads come, one of each, a tick apart in either order (Wiki; both
 * captured).
 */
const Common = require("./Common.Vardorvis");
const Barrier = require("./Barrier.Vardorvis");

const PROTECTION_VARBITS = [4116, 4117, 4118];

/** Per player: the tick their protection prayers come back. */
const lockedUntil = new WeakMap();

function styles(fight) {
  const { head } = Common.data;
  if (!fight.awakened) return ["ranged"];
  if (fight.boss.getHitpoints() > fight.boss.getMaxHitpoints() * head.pairBelowShare) return [Common.pick(["ranged", "magic"])];
  return Common.shuffle(["ranged", "magic"]);
}

/** A tile within reach of him for a head: on the arena floor, clear of him and the player. */
function headTile(fight) {
  const { head, boss } = Common.data;
  const { session } = fight;
  const [bx, by] = Common.siteTile(session.area, fight.boss.getLocation());
  const [px, py] = Common.siteTile(session.area, fight.player.getLocation());
  const options = [];
  for (let dx = -head.spread; dx <= head.spread + boss.size - 1; dx++) {
    for (let dy = -head.spread; dy <= head.spread + boss.size - 1; dy++) {
      const x = bx + dx;
      const y = by + dy;
      const underBoss = x >= bx && x < bx + boss.size && y >= by && y < by + boss.size;
      if (underBoss || (x === px && y === py) || !Barrier.inArena(x, y)) continue;
      options.push([x, y]);
    }
  }
  return options.length > 0 ? Common.pick(options) : [bx, by - 1];
}

function gaze(fight) {
  const { head } = Common.data;
  fight.player.sendMessage(head.message);
  styles(fight).forEach((style, index) => {
    if (index === 0) launch(fight, style);
    else fight.at(head.pairGapTicks * index, () => fight.alive() && launch(fight, style));
  });
}

function launch(fight, style) {
  const { head, npcs } = Common.data;
  const spec = head.styles[style];
  const { session, player } = fight;
  const [x, y] = headTile(fight);
  const npc = session.spawn(npcs.head, [x, y, 0], null);
  if (!npc) return;
  npc.setScriptedMovement?.(true);
  npc.setPositionToFace(player.getLocation());
  npc.performGraphic(Common.graphic(spec.scream));
  Common.sound(player, spec.sound);
  const { Projectile } = Common.core;
  const shot = head.projectile;
  new Projectile(npc.getLocation(), Projectile.centreOf(player), player, spec.projectile, shot.start, shot.end, shot.startHeight, shot.endHeight, session.area)
    .withAngle(shot.angle)
    .withProgress(shot.progress)
    .sendProjectile();
  player.performGraphicInSlot(2, Common.graphic(spec.impact, head.impact));
  fight.heads ??= [];
  fight.heads.push(npc);
  fight.at(head.flightTicks, () => {
    if (npc.isRegistered()) Common.api.removeNpc(npc);
    fight.heads = fight.heads.filter((other) => other !== npc);
    if (!fight.alive() || !player.isRegistered() || player.getHitpoints() <= 0) return;
    Common.sound(player, head.landSound);
    if (Common.protectedFrom(player, spec.prayer)) return;
    lockOut(fight);
  });
}

function lockOut(fight) {
  const { head } = Common.data;
  const { player } = fight;
  const { PrayerHandler, Skill, World } = Common.core;
  for (const prayer of PrayerHandler.PROTECTION_PRAYERS) PrayerHandler.deactivatePrayer(player, prayer);
  player.sendMessage(head.lockMessage);
  const skills = player.getSkillManager();
  skills.setCurrentLevel(Skill.PRAYER, Math.max(0, skills.getCurrentLevel(Skill.PRAYER) - head.prayerDrain), true);
  lockedUntil.set(player, World.getProcessCycle() + head.lockTicks);
}

/** The heads go with him. */
function clear(fight) {
  for (const npc of fight.heads ?? []) if (npc.isRegistered()) Common.api.removeNpc(npc);
  fight.heads = [];
}

function prayerLocked(event) {
  const until = lockedUntil.get(event.player);
  if (until == null) return;
  if (Common.core.World.getProcessCycle() >= until) {
    lockedUntil.delete(event.player);
    return;
  }
  if (!PROTECTION_VARBITS.includes(event.prayer?.configId)) return;
  event.disabled = true;
  event.message = Common.data.head.refusedMessage;
}

function attachHead(api) {
  api.onPrayerDisabled(prayerLocked);
}

module.exports = { attachHead, gaze, clear };
