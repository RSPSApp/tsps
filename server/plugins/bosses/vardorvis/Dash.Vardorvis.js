/**
 * The darting spikes (rsprox 3285): in place of an attack Vardorvis darts round the player, one
 * dart a tick - one above 500 hitpoints, two above 130, three below (Wiki; awakened 1,000 and 260, as
 * rsprox 1156's awakened kill darts) - landing beside them,
 * on the opposite side each time, gliding there with his dash. Each dart cracks the ground round
 * the player (warning graphics on 3 to 5 tiles in a 5x5 round them, the player's own tile among
 * them on the first), and three ticks later spikes erupt from those cracks: up to 25 (40 awakened,
 * Wiki) to a player standing on one, healing him half of it. He slashes the tick after his last
 * dart.
 */
const Common = require("./Common.Vardorvis");
const Barrier = require("./Barrier.Vardorvis");

const OPPOSITE = [1, 0, 3, 2];

function dartCount(fight) {
  const hp = fight.boss.getHitpoints();
  const rules = Common.data.dash.darts[fight.awakened ? "awakened" : "normal"];
  return (rules.find(([above]) => hp > above) ?? rules[rules.length - 1])[1];
}

function start(fight) {
  const darts = dartCount(fight);
  fight.dashing = true;
  fight.boss.getMovementQueue().reset();
  let side = Math.floor(Math.random() * 4);
  for (let i = 0; i < darts; i++) {
    const thisSide = side;
    const first = i === 0;
    const go = () => {
      if (fight.alive()) dart(fight, thisSide, first);
    };
    if (i === 0) go();
    else fight.at(i, go);
    side = OPPOSITE[side];
  }
  fight.nextAttack = fight.tick + darts;
  fight.at(darts, () => {
    fight.dashing = false;
  });
}

/** Where he can land on a side: his whole 2x2 on the arena floor. */
function landing(fight, side, [px, py]) {
  const { dash, boss } = Common.data;
  const fits = ([dx, dy]) => {
    for (let x = 0; x < boss.size; x++) {
      for (let y = 0; y < boss.size; y++) if (!Barrier.inArena(px + dx + x, py + dy + y)) return false;
    }
    return true;
  };
  for (const s of [side, OPPOSITE[side], (side + 2) % 4, OPPOSITE[(side + 2) % 4]]) {
    const options = dash.sides[s].filter(fits);
    if (options.length > 0) return Common.pick(options);
  }
  return null;
}

function dart(fight, side, first) {
  const { dash } = Common.data;
  const { session, player, boss } = fight;
  const playerTile = Common.siteTile(session.area, player.getLocation());
  const offset = landing(fight, side, playerTile);
  if (offset) {
    const destination = session.tile([playerTile[0] + offset[0], playerTile[1] + offset[1], 0]);
    boss.exactMove(destination);
  }
  boss.performAnimation(new Common.core.Animation(dash.anim));
  boss.setPositionToFace(player.getLocation());
  Common.areaSound(player, dash.sound, boss.getLocation());
  const cracks = crackTiles(playerTile, first);
  for (const crack of cracks) {
    player.getPacketSender().sendGraphic(Common.graphic(dash.warningSpot, { delay: crack.delay }), session.tile([crack.x, crack.y, 0]));
  }
  fight.at(dash.eruptTicks, () => erupt(fight, cracks));
}

/** The cracks round the player: 3 to 5 tiles of the 5x5, their own among them on the first dart. */
function crackTiles([px, py], first) {
  const { dash } = Common.data;
  const [min, max] = dash.tiles;
  const around = [];
  for (let dx = -dash.reach; dx <= dash.reach; dx++) {
    for (let dy = -dash.reach; dy <= dash.reach; dy++) if (dx !== 0 || dy !== 0) around.push([dx, dy]);
  }
  const picked = Common.shuffle(around).slice(0, Common.randomInt(min, max) - (first ? 1 : 0));
  if (first) picked.unshift([0, 0]);
  return picked
    .map(([dx, dy]) => ({ x: px + dx, y: py + dy, delay: dx === 0 && dy === 0 ? dash.centreDelay : Common.pick(dash.delays) }))
    .filter(({ x, y }) => Barrier.inArena(x, y));
}

function erupt(fight, cracks) {
  const { dash } = Common.data;
  const { session, player } = fight;
  if (session.ended) return;
  for (const crack of cracks) {
    player.getPacketSender().sendGraphic(Common.graphic(dash.eruptSpot, { delay: crack.delay }), session.tile([crack.x, crack.y, 0]));
  }
  Common.sound(player, dash.eruptSound);
  if (cracks.length > 0) {
    const { id, delay } = dash.eruptAreaSound;
    Common.areaSound(player, id, session.tile([cracks[0].x, cracks[0].y, 0]), delay);
  }
  if (!fight.alive() || player.getHitpoints() <= 0) return;
  const [px, py] = Common.siteTile(session.area, player.getLocation());
  if (!cracks.some(({ x, y }) => x === px && y === py)) return;
  const dealt = Common.damage(player, Common.randomInt(0, dash.maxHit[fight.awakened ? "awakened" : "normal"]),
    null, (amount) => fight.recordDamage(amount));
  Common.lifesteal(fight.boss, dealt);
}

module.exports = { start };
