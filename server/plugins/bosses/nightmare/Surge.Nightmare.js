/**
 * Surge, as captured: she leaves (the animation her flowers start with), two ticks later stands at
 * the start of one of twelve lanes - three across the arena each way, either direction - and four
 * ticks after that crosses it in one tick with the message to everyone. Anyone in her path is hit
 * for up to 60 (about 85 by Phosani's, Wiki).
 */
const Common = require("./Common.Nightmare");

const SIZE = 5;

function start(fight) {
  const { surge, flowers } = Common.data;
  const boss = fight.boss;
  const [from, to] = Common.shuffled(Common.pick(surge.lanes));
  fight.surging = true;
  boss.performAnimation(Common.animation(flowers.leaveAnim));
  boss.getMovementQueue().setBlockMovement(true).reset();
  for (const player of fight.players()) Common.sounds(player, flowers.leaveSounds);
  fight.at(surge.jumpTicks, () => {
    if (!fight.surging) return;
    boss.moveTo(fight.dream.tile([...from, Common.data.arena.plane]));
    boss.performAnimation(Common.animation(flowers.returnAnim));
    boss.faceTile?.(fight.dream.tile([...to, Common.data.arena.plane]));
    for (const player of fight.players()) Common.sounds(player, [flowers.returnSound]);
  });
  fight.at(surge.surgeTicks, () => {
    if (!fight.surging) return;
    fight.surging = false;
    const end = fight.dream.tile([...to, Common.data.arena.plane]);
    boss.exactMove(end, { startCycles: 0, endCycles: 30 });
    boss.performAnimation(Common.animation(surge.anim));
    boss.getMovementQueue().setBlockMovement(false);
    const minX = Math.min(from[0], to[0]);
    const maxX = Math.max(from[0], to[0]) + SIZE - 1;
    const minY = Math.min(from[1], to[1]);
    const maxY = Math.max(from[1], to[1]) + SIZE - 1;
    const max = fight.phosani ? surge.phosaniMaxHit : surge.maxHit;
    for (const player of fight.players()) {
      player.sendMessage(surge.message);
      Common.sounds(player, surge.sounds);
      const [x, y] = fight.dream.arenaTile(player.getLocation());
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) Common.damage(player, Common.randomInt(Math.ceil(max / 2), max));
    }
  });
  return surge.surgeTicks + Common.data.specials.after.surge;
}

function clear(fight) {
  fight.surging = false;
}

module.exports = { start, clear };
