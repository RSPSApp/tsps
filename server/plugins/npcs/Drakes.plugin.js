"use strict";

/**
 * Drakes in combat, from plugins/npcs/data/drakes.json (docs/drakes.md).
 *
 * Wiki (Drake): a drake attacks with "Ranged" and "Ranged melee", both up to 15 and both blocked by
 * Protect from Missiles, and "can perform melee attacks when players stand diagonally from them".
 * So both styles are ranged attacks: the melee one only changes the animation and the hit's timing.
 * The rsprox capture of recording 3014 gives the animations, the projectile, the sounds and the hit
 * delays: from range only the shot, beside the player either (ticks 221 and 225).
 */
const fs = require("fs");
const path = require("path");

let api = null;
let DATA = null;
let MethodClass = null;

function core() {
  return api.core;
}

function data() {
  DATA ??= JSON.parse(fs.readFileSync(path.join(__dirname, "data", "drakes.json"), "utf8"));
  return DATA;
}

/** The tiles a mobile covers: [minX, minY, maxX, maxY]. */
function footprint(mobile) {
  const at = mobile.getLocation();
  const size = Math.max(1, mobile.getSize?.() ?? 1);
  return [at.getX(), at.getY(), at.getX() + size - 1, at.getY() + size - 1];
}

/** Melee reach: the target touches the drake's footprint along an edge or at a corner (Wiki), on its floor. */
function adjacent(npc, target) {
  if (npc.getLocation().getZ() !== target.getLocation().getZ()) return false;
  const [ax, ay, bx, by] = footprint(npc);
  const [cx, cy, dx, dy] = footprint(target);
  const gapX = Math.max(0, cx - bx, ax - dx);
  const gapY = Math.max(0, cy - by, ay - dy);
  return Math.max(gapX, gapY) === 1;
}

/**
 * Where the shot starts: rec 3014 sends it one tile from the drake's centre toward the target (its
 * head), 1311,10236 for a drake at 1308,10235 with the player to the south-east and south.
 */
function launchTile(npc, target) {
  const centre = core().Projectile.centreOf(npc);
  const to = target.getLocation();
  return centre.transform(Math.sign(to.getX() - centre.getX()), Math.sign(to.getY() - centre.getY()));
}

/** When the shot lands, in client cycles: 57 + 3 a tile from where it starts (rec 3014: 63 at 2, 75 at 6, 78 at 7). */
function landingCycle(from, target) {
  const { base, perTile } = data().ranged.projectile;
  const to = target.getLocation();
  const tiles = Math.max(Math.abs(from.getX() - to.getX()), Math.abs(from.getY() - to.getY()));
  return base + tiles * perTile;
}

function sendSounds(target, sounds) {
  if (!target.isPlayer?.()) return;
  const { Sound, Sounds } = core();
  for (const [id, delay] of sounds) Sounds.sendSound(target, new Sound(id, 1, delay, 0));
}

function shoot(npc, target) {
  const { Projectile } = core();
  const { id, start, startHeight, endHeight, angle, progress } = data().ranged.projectile;
  const from = launchTile(npc, target);
  // Heights are sent four times over (PacketSender.sendProjectile).
  new Projectile(from, target.getLocation(), target, id, start, landingCycle(from, target),
    startHeight / 4, endHeight / 4, npc.getPrivateArea?.() ?? null)
    .withSource(npc).withAngle(angle).withProgress(progress).sendProjectile();
}

/** The combat method; the provider makes one per attack, so the style lives only for that attack. */
function method() {
  if (MethodClass) return MethodClass;
  const { CombatMethod, CombatType, PendingHit, Animation } = core();
  MethodClass = class DrakeCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.melee = false;
    }

    /** Both styles are ranged attacks (Wiki: Protect from Missiles blocks both). */
    type() {
      return CombatType.RANGED;
    }

    /** Ours: no source gives the reach of the shot; core's NPC ranged reach. */
    attackDistance() {
      return data().range;
    }

    attackSpeed(character) {
      return character.getCurrentDefinition?.()?.getAttackSpeed?.() || 4;
    }

    start(character, target) {
      // Beside the player either style (rec 3014: a shot at tick 221, a swing at 225); the split is ours.
      this.melee = adjacent(character, target) && Math.random() < data().meleeChance;
      const style = this.melee ? data().melee : data().ranged;
      character.performAnimation(new Animation(style.anim));
      if (!this.melee) shoot(character, target);
      sendSounds(target, style.sounds);
    }

    hits(character, target) {
      return [new PendingHit(character, target, this, (this.melee ? data().melee : data().ranged).hitDelay)];
    }
  };
  return MethodClass;
}

module.exports = {
  name: "Drakes",
  description: "Drake combat: a ranged shot from range, a ranged shot or a 'ranged melee' swing beside the player (diagonals too), both blocked by Protect from Missiles, with the captured animations, projectile and sounds.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    pluginApi.registerNpcCombatMethodProvider(data().ids, method(), { singleton: false });
  },
  _test: { adjacent, launchTile, landingCycle, method, data },
};
