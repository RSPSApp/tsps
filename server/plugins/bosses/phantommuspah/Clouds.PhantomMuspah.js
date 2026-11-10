/**
 * Lightning clouds, the Phantom Muspah's teleport special (docs/phantom-muspah.md), as captured:
 * the purple message, seq 9928 with spot 2332, the overlay darkened; three ticks later the
 * teleporting form, and from the next tick a jump every tick through the same eight tiles, twenty
 * in all, each with seq 9930, spot 2333 and sound 6820, facing the arena's centre. It lands on
 * the last with seq 9932 and spot 2334, back in the form it left.
 *
 * Each jump sends up to four clouds (NPC 12083) from tiles between it and the centre, heading away
 * from it a tile a tick until the arena's edge stops them (seq 9948, then gone). A cloud on the
 * player hits for up to 20 (Wiki) and goes. Where they start and their damage: estimate.
 */
const Common = require("./Common.PhantomMuspah");
const Hits = require("./Hits.PhantomMuspah");

/** Runs the special; `done` is called as the Muspah lands. */
function teleport(fight, done) {
  const { clouds, specials } = Common.data;
  const { muspah, player } = fight;
  Common.animate(muspah, clouds.disappearAnim);
  muspah.performGraphic(Common.graphic(clouds.disappearSpot));
  Common.sounds(player, clouds.disappearSounds);
  Common.fightMessage(player, specials.message);
  Common.overlayFade(player, Common.data.overlay.dark);
  fight.hold(true);
  const returnForm = fight.form;
  fight.at(clouds.transformTicks, () => fight.setForm("teleport"));
  for (let jump = 0; jump < clouds.jumps; jump++) {
    const tile = clouds.loop[jump % clouds.loop.length];
    const last = jump === clouds.jumps - 1;
    fight.at(clouds.transformTicks + 1 + jump, () => {
      fight.moveMuspah(tile);
      if (last) {
        Common.animate(muspah, clouds.landAnim);
        muspah.performGraphic(Common.graphic(clouds.landSpot));
        fight.setForm(returnForm);
        Common.overlayFade(player, Common.data.overlay.clear);
        fight.hold(false);
        done?.();
        return;
      }
      Common.animate(muspah, clouds.jumpAnim);
      muspah.performGraphic(Common.graphic(clouds.jumpSpot));
      Common.sound(player, clouds.jumpSound);
      sendClouds(fight, tile);
    });
  }
}

/** Up to four clouds from between the Muspah's tile and the centre, heading away from it. */
function sendClouds(fight, bossTile) {
  const { clouds } = Common.data;
  const [cx, cy] = Common.data.boss.centre;
  // The Muspah's own centre, from its south-west tile.
  const bx = bossTile[0] + 2;
  const by = bossTile[1] + 2;
  const count = Common.randomInt(0, clouds.perJumpMax);
  for (let i = 0; i < count; i++) {
    const share = 0.2 + Math.random() * 0.6;
    const x = Math.round(bx + (cx - bx) * share) + Common.randomInt(-2, 2);
    const y = Math.round(by + (cy - by) * share) + Common.randomInt(-2, 2);
    const away = [Math.sign(x - bx), Math.sign(y - by)];
    // Straight away along its longer axis, or diagonally.
    const dir = Math.random() < 0.5
      ? (Math.abs(x - bx) >= Math.abs(y - by) ? [away[0], 0] : [0, away[1]])
      : away;
    if ((dir[0] === 0 && dir[1] === 0) || !Common.onArena([x, y])) continue;
    spawnCloud(fight, [x, y], dir);
  }
}

function spawnCloud(fight, tile, dir) {
  const { npcs } = Common.data;
  const at = fight.session.tile([tile[0], tile[1], 0]);
  const npc = Common.api.spawnNpc({ id: npcs.cloud, x: at.getX(), y: at.getY(), z: at.getZ(), owner: fight.player, wanderRadius: 0 });
  if (!npc) return;
  npc.__skipDefaultRespawn = true;
  npc.setUntargetable(true);
  npc.getMovementQueue().setBlockMovement(true);
  fight.session.area.add(npc);
  npc.setPositionToFace(at.clone().add(dir[0], dir[1]));
  fight.clouds.push({ npc, tile, dir, gone: false });
}

/** Every tick: each cloud steps on, hits the player it reaches, or breaks up at the edge. */
function process(fight) {
  if (fight.clouds.length === 0) return;
  const { clouds } = Common.data;
  const player = fight.session.lairTile(fight.player.getLocation());
  for (const cloud of [...fight.clouds]) {
    if (cloud.gone) continue;
    const next = [cloud.tile[0] + cloud.dir[0], cloud.tile[1] + cloud.dir[1]];
    if (!Common.onArena(next)) {
      dissipate(fight, cloud);
      continue;
    }
    cloud.tile = next;
    cloud.npc.moveTo(fight.session.tile([next[0], next[1], 0]));
    if (next[0] === player[0] && next[1] === player[1] && Common.alive(fight.player)) {
      Hits.damage(fight.player, Common.randomInt(1, clouds.maxHit));
      dissipate(fight, cloud);
    }
  }
}

function dissipate(fight, cloud) {
  cloud.gone = true;
  Common.animate(cloud.npc, Common.data.clouds.smokeAnim);
  fight.at(1, () => {
    Common.api.removeNpc(cloud.npc);
    const index = fight.clouds.indexOf(cloud);
    if (index >= 0) fight.clouds.splice(index, 1);
  });
}

function clear(fight) {
  for (const cloud of fight.clouds) Common.api.removeNpc(cloud.npc);
  fight.clouds = [];
}

module.exports = { teleport, process, clear };
