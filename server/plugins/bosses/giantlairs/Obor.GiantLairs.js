/**
 * Obor, the Hill Titan, as captured (stats from the Wiki):
 * - in reach he punches (4666), the hit landing a tick later, and now and then knocks the
 *   player back: a 5-tile slide away from him (12212, under `busy`), stopping at walls, the
 *   hit 2 ticks later;
 * - from further away the same swing throws a boulder: a tick later the earthstrike splash
 *   (98) and the player knocked down (7210);
 * - his stamp (7183) sends falling rocks from in front of him along the line to the player, a
 *   tile every 6 client cycles, with the camera shaking; the hit lands 2 ticks after the stamp;
 * - his ranged attacks do half damage through Protect from Missiles (Wiki).
 * The pit's rocks are climbed into and out of with a slide (1148).
 * How often he stamps or knocks back isn't on the Wiki; the odds in the data are estimates.
 */
const ObstacleRunner = require("../../skills/agility/ObstacleRunner");
const Common = require("./Common.GiantLairs");
const Lair = require("./Lair.GiantLairs");

let DATA = null;
const BUSY_VARBIT = 12393;
const CAMERA_SHAKE = [4, 4, 0, 1];
const CAMERA_STILL = [4, 0, 0, 0];
/** canMoveIsBlocked's directions for a straight step. */
const STEP_DIRECTION = { "0,1": 1, "-1,0": 3, "1,0": 4, "0,-1": 6 };
const KNOCKBACK_DIRECTION = { "0,1": "north", "-1,0": "west", "1,0": "east", "0,-1": "south" };

let core = null;

const roll = (oneIn) => Math.floor(Math.random() * oneIn) === 0;

function footprint(npc) {
  const at = npc.getLocation();
  const size = npc.getSize?.() ?? 2;
  return { minX: at.getX(), minY: at.getY(), maxX: at.getX() + size - 1, maxY: at.getY() + size - 1 };
}

/** Next to his footprint (diagonals don't count for melee). */
function inReach(npc, target) {
  const box = footprint(npc);
  const at = target.getLocation();
  const dx = at.getX() < box.minX ? box.minX - at.getX() : at.getX() > box.maxX ? at.getX() - box.maxX : 0;
  const dy = at.getY() < box.minY ? box.minY - at.getY() : at.getY() > box.maxY ? at.getY() - box.maxY : 0;
  return dx + dy === 1;
}

function shake(player, values) {
  player.getPacketSender().sendCameraShake(...values);
}

/**
 * The stamp's line: `origin`, Obor's own tile nearest the player, where the splash goes; then
 * every tile from beside him to the player's, where the rocks fall (as captured).
 */
function rockLine(npc, target) {
  const { Location } = core;
  const box = footprint(npc);
  const to = target.getLocation();
  const from = {
    x: Math.max(box.minX, Math.min(box.maxX, to.getX())),
    y: Math.max(box.minY, Math.min(box.maxY, to.getY())),
  };
  const steps = Math.max(Math.abs(to.getX() - from.x), Math.abs(to.getY() - from.y));
  const tiles = [];
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(from.x + ((to.getX() - from.x) * i) / steps);
    const y = Math.round(from.y + ((to.getY() - from.y) * i) / steps);
    tiles.push(new Location(x, y, to.getZ()));
  }
  return { origin: new Location(from.x, from.y, to.getZ()), tiles };
}

/** The stamp: the splash on his tile now; next tick the rocks fall, tile by tile, to the player. */
function stamp(npc, target) {
  const { Graphic } = core;
  const rocks = DATA.rockfall;
  const { origin, tiles } = rockLine(npc, target);
  if (tiles.length === 0) return;
  const sender = target.getPacketSender();
  sender.sendGlobalGraphic(new Graphic(rocks.origin, rocks.originDelay), origin);
  Common.later(1, () => {
    if (!target.isRegistered() || npc.getHitpoints() <= 0) return;
    tiles.forEach((tile, index) => {
      sender.sendGlobalGraphic(new Graphic(rocks.graphic, rocks.cyclesPerTile * (index + 1), rocks.height), tile);
    });
    const landing = rocks.cyclesPerTile * tiles.length;
    target.performAnimation(new core.Animation(rocks.playerAnim, landing));
    for (const sound of rocks.sounds) sender.sendSound(sound, 1, 0);
    shake(target, CAMERA_SHAKE);
    Common.later(1, () => target.isRegistered() && shake(target, CAMERA_STILL));
  });
}

/** How far the player slides: up to 5 tiles straight away from him, stopping at a wall. */
function knockbackPath(npc, target) {
  const { Location, RegionManager } = core;
  const box = footprint(npc);
  const at = target.getLocation();
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const horizontal = Math.abs(at.getX() - cx) >= Math.abs(at.getY() - cy);
  const dx = horizontal ? Math.sign(at.getX() - cx) || 1 : 0;
  const dy = horizontal ? 0 : Math.sign(at.getY() - cy) || 1;
  const direction = STEP_DIRECTION[`${dx},${dy}`];
  let tile = at.clone();
  let moved = 0;
  while (moved < DATA.knockback.tiles && RegionManager.canMoveIsBlocked(tile, direction, target.getPrivateArea())) {
    tile = new Location(tile.getX() + dx, tile.getY() + dy, tile.getZ());
    moved++;
  }
  return { tile, moved, facing: KNOCKBACK_DIRECTION[`${-dx},${-dy}`] };
}

function knockback(npc, target) {
  const { tile, moved, facing } = knockbackPath(npc, target);
  if (moved === 0) return false;
  const sender = target.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  const [start, end] = DATA.knockback.cycles;
  ObstacleRunner.run({ player: target }, [
    { move: [tile.getX(), tile.getY()], anim: DATA.knockback.anim, delay: start, speed: [start, end], dir: facing, ticks: 2 },
  ], { onFinish: () => target.isRegistered() && sender.sendVarbit(BUSY_VARBIT, 0) });
  return true;
}

function boulderLands(target) {
  const { Animation, Graphic } = core;
  const impact = DATA.rangedImpact;
  target.performGraphic(new Graphic(impact.graphic, impact.delay, impact.height));
  target.performAnimation(new Animation(impact.playerAnim, impact.delay));
  target.getPacketSender().sendSound(impact.sound, 1, impact.delay);
  shake(target, CAMERA_SHAKE);
  Common.later(1, () => target.isRegistered() && shake(target, CAMERA_STILL));
}

/** His ranged hit: rolled through prayer, then halved by Protect from Missiles (Wiki). */
function rangedDamage(hit, target) {
  const { CombatFactory, PrayerHandler } = core;
  CombatFactory.applyStyleDamage(hit, DATA.maxHit.ranged, { bypassProtectionPrayer: true });
  if (!target.isPlayer?.() || !PrayerHandler.isActivated(target, PrayerHandler.PROTECT_FROM_MISSILES)) return;
  const damage = hit.getHits()[0];
  if (damage) damage.setDamage(Math.floor(damage.getDamage() / 2));
  hit.updateTotalDamage();
}

function defineOborCombatMethod() {
  const { Animation, CombatMethod, CombatType, PendingHit, CombatFactory } = core;

  return class OborCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.MELEE;
      this.action = "melee";
      /** He sometimes attacks from where he stands rather than walking up (Wiki). */
      this.reach = 1;
    }

    type() {
      return this.stance;
    }

    attackDistance() {
      return this.reach;
    }

    /** The rocks, the boulder and the knockback have the player's own animation (as captured). */
    playsBlockAnimation() {
      return this.action === "melee" && !this.knocked;
    }

    start(character, target) {
      const adjacent = inReach(character, target);
      const stampOdds = adjacent ? DATA.stampChance.adjacent : DATA.stampChance.distant;
      this.action = roll(stampOdds) ? "stamp" : adjacent ? "melee" : "boulder";
      this.reach = roll(2) ? 1 : 8;
      if (this.action === "stamp") {
        this.stance = CombatType.RANGED;
        character.performAnimation(new Animation(DATA.anim.stamp));
        if (target.isPlayer?.()) stamp(character, target);
        return;
      }
      character.performAnimation(new Animation(DATA.anim.melee));
      this.stance = this.action === "melee" ? CombatType.MELEE : CombatType.RANGED;
      this.knocked = this.action === "melee" && target.isPlayer?.() && roll(DATA.knockback.chance) && knockback(character, target);
    }

    hits(character, target) {
      const delay = this.action === "stamp" || this.knocked ? 2 : 1;
      const hit = new PendingHit(character, target, this, delay);
      if (this.stance === CombatType.MELEE) {
        CombatFactory.applyStyleDamage(hit, DATA.maxHit.melee);
        return [hit];
      }
      rangedDamage(hit, target);
      return [hit];
    }

    handleAfterHitEffects(hit) {
      if (this.action === "boulder" && hit.getTarget()?.isPlayer?.()) boulderLands(hit.getTarget());
    }
  };
}

/** The pit's rocks: down into the pit from above, back up from inside it. */
function climbRocks(event) {
  if (event.objectId !== DATA.pitRocks) return false;
  const { player } = event;
  if (ObstacleRunner.isBusy(player)) return true;
  const down = player.getLocation().getY() >= DATA.pitTopY - 1;
  const x = event.location.x;
  const from = down ? DATA.pitTopY : DATA.pitBottomY;
  const to = down ? DATA.pitBottomY : DATA.pitTopY;
  const climb = DATA.climb;
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  sender.sendSoundEffect(climb.sound, 3, 0, 1);
  if (player.getLocation().getX() !== x || player.getLocation().getY() !== from) player.moveTo(new core.Location(x, from, 0));
  player.sendMessage(down ? climb.in : climb.out);
  // He goes for the player as they slide in: his first attack came the next tick, as captured.
  const boss = Lair.sessionOf(player)?.boss;
  if (down && boss && boss.getHitpoints() > 0) boss.getCombat().attack(player);
  ObstacleRunner.run({ player }, [
    { move: [x, to], anim: climb.anim, delay: climb.cycles[0], speed: climb.cycles, dir: "north", ticks: 3 },
  ], {
    onFinish: () => {
      if (!player.isRegistered()) return;
      sender.sendVarbit(BUSY_VARBIT, 0);
      if (down && boss && boss.getHitpoints() > 0 && boss.getCombat().getTarget?.() !== player) boss.getCombat().attack(player);
    },
  });
  return true;
}

/** Obor's own combat and his pit's rocks. */
function attach(pluginApi) {
  core = pluginApi.core;
  DATA = Common.data.obor;
  pluginApi.registerNpcCombatMethodProvider([Common.data.lairs.obor.boss], defineOborCombatMethod(), { singleton: false });
  pluginApi.onObjectInteraction("Rocks", { Climb: climbRocks });
}

module.exports = attach;
Object.assign(module.exports, { defineOborCombatMethod, climbRocks, knockbackPath, rockLine, inReach, rangedDamage });
