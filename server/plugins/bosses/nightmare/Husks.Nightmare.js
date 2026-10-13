/**
 * Husks, as captured: her trance animation, two ticks later a projectile at the player, and two
 * after that the trance message, the player held in place and two husks rising beside them - a
 * magic one and a ranged one. The magic husk first attacks three ticks after rising, the ranged
 * one five, then every 4 ticks. When the last of a player's husks dies they are free again.
 * The right protection stops their hits in full (Wiki, since November 2020).
 */
const Common = require("./Common.Nightmare");

const FREEZE_TICKS = 1000;

function targets(fight) {
  const players = Common.shuffled(fight.players().filter((player) => !fight.frozen.has(player)));
  return players.slice(0, Math.max(1, Math.floor(players.length / 5)));
}

/** Two free tiles beside the player, for the two husks. */
function besideTiles(fight, player) {
  const [px, py] = fight.dream.arenaTile(player.getLocation());
  const { minX, maxX, minY, maxY } = Common.data.arena;
  const Claws = require("./Claws.Nightmare");
  const around = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
    .map(([dx, dy]) => [px + dx, py + dy])
    .filter(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY && !Claws.isTotemTile(x, y));
  return Common.shuffled(around).slice(0, 2);
}

function start(fight) {
  const { husks } = Common.data;
  fight.boss.performAnimation(Common.animation(husks.anim));
  const players = fight.players();
  for (const player of players) Common.sounds(player, husks.sounds);
  const chosen = targets(fight);
  fight.at(husks.projectileTicks, () => {
    for (const player of chosen) if (player.isRegistered()) Common.projectile(fight.dream.area, fight.boss, player, husks.projectile);
  });
  fight.at(husks.spawnTicks, () => {
    for (const player of chosen) if (player.isRegistered() && fight.players().includes(player)) raise(fight, player);
  });
  return null;
}

function raise(fight, player) {
  const { husks } = Common.data;
  const ids = fight.phosani ? Common.data.npcs.phosani.husks : Common.data.npcs.husks;
  const tiles = besideTiles(fight, player);
  if (tiles.length === 0) return;
  player.sendMessage(husks.trance);
  Common.sounds(player, husks.spawnSounds);
  player.getMovementQueue().reset();
  player.getTimers().registers(Common.core.TimerKey.FREEZE, FREEZE_TICKS);
  const raised = [];
  ["magic", "ranged"].forEach((style, i) => {
    const tile = tiles[i] ?? tiles[0];
    const npc = fight.dream.spawn(ids[style], [...tile, Common.data.arena.plane]);
    if (!npc) return;
    npc.__nightmareFight = fight;
    npc.__nightmareHusk = { style, player, next: fight.tick + husks[style].firstTicks };
    npc.getMovementQueue().setBlockMovement(true).reset();
    npc.performAnimation(Common.animation(husks.spawnAnim));
    npc.setPositionToFace(player.getLocation());
    fight.minions.add(npc);
    raised.push(npc);
  });
  fight.frozen.set(player, raised);
}

/** Each husk attacks its player on its own timer. */
function process(fight) {
  const { husks } = Common.data;
  for (const [player, raised] of [...fight.frozen]) {
    if (raised.every((npc) => !npc.isRegistered() || npc.getHitpoints() <= 0)) {
      free(fight, player, true);
      continue;
    }
    for (const npc of raised) {
      const husk = npc.__nightmareHusk;
      if (!npc.isRegistered() || npc.getHitpoints() <= 0 || fight.tick < husk.next) continue;
      husk.next = fight.tick + husks.speed;
      const spec = husks[husk.style];
      npc.performAnimation(Common.animation(spec.anim));
      npc.setPositionToFace(player.getLocation());
      Common.areaSound(fight.players(), npc.getLocation(), [spec.sound, 0, 6]);
      Common.projectile(fight.dream.area, npc, player, spec.projectile);
      if (spec.impact) player.performGraphic(Common.graphic(spec.impact.id, { delay: spec.impact.delay, height: spec.impact.height }));
      Common.strike(npc, player, husk.style, husks.maxHit, 1, {
        prayed: (style, prayer) => (prayer && require("./Specials.Nightmare").blockedBy(fight, player, prayer) === style ? 0 : 1),
      });
    }
  }
}

/** A husk died: when a player's last one goes, they're free. */
function husksDied({ npc }) {
  const husk = npc?.__nightmareHusk;
  const fight = npc?.__nightmareFight;
  if (!husk || !fight) return;
  fight.minions.delete(npc);
  const raised = fight.frozen.get(husk.player);
  if (!raised) return;
  if (raised.some((other) => other !== npc && other.isRegistered() && other.getHitpoints() > 0)) return;
  free(fight, husk.player, true);
}

function free(fight, player, announce) {
  const raised = fight.frozen.get(player);
  if (!raised) return;
  fight.frozen.delete(player);
  player.getTimers().cancel(Common.core.TimerKey.FREEZE);
  if (announce && player.isRegistered()) player.sendMessage(Common.data.husks.free);
  for (const npc of raised) {
    if (npc.isRegistered() && npc.getHitpoints() > 0) {
      fight.minions.delete(npc);
      Common.api.removeNpc(npc);
    }
  }
}

function playerLeft(fight, player) {
  free(fight, player, false);
}

function clear(fight) {
  for (const player of [...fight.frozen.keys()]) free(fight, player, false);
}

function attachHusks(api) {
  api.onNpcDeath(husksDied);
}

module.exports = { start, process, clear, playerLeft, attachHusks };
