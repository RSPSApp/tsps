// Wiki + RSProx235/948 establish styles/visuals/knockback. Unknown server rules below
// are labelled estimates; see docs/sea-charting.md. No generated stats changed.
const common = require("./Common.Charting");
const ROCKS = "sailing_charting_drink_troll_ice";
const DADDY = "sailing_charting_drink_troll_dad";
const MELEE_MAX = 23; // Wiki.
const MAGIC_MAX = 23; // Estimate: known melee ceiling until magic is measured.
const FREEZE_TICKS = 3; // Estimate consistent with observed release boundary, not proven by it.
const MAGIC_DELAY = 1; // Estimate; adjacent mixed capture cannot establish exact hit delay.
const ADJACENT_MELEE_CHANCE = 3; // Estimated one-in-three.
const TELEPORT_CHANCE = 4; // Estimated one-in-four per distant attack.
const DADDY_SPECIAL_CHANCE = 3; // Normal Dad's one-in-three, estimated for this variant.
const STUN_TICKS = 3; // Estimate; captured attack cooldown confounds stun duration.
const KNOCKBACK_TILES = 5; // Captured full displacement; terrain clips shorter moves.
const knockbacks = new WeakMap();

function arenaFor(npc, target) {
  const scene = require("./FishierStout.Charting").scenes.get(target);
  return target?.isPlayer?.() && target.isRegistered() && target.getHitpoints() > 0
    && npc.isRegistered() && npc.getHitpoints() > 0 && npc.getOwner() === target
    && scene?.area && npc.getArea() === scene.area && target.getArea() === scene.area
    && scene.npcs.includes(npc) ? scene.area : null;
}
function isRocks(npc) {
  return npc?.isNpc?.() && npc.getId() === common.core().CacheDefinitions.getNpcId(ROCKS);
}
function damageRoll(event) {
  if (!isRocks(event.attacker) || !arenaFor(event.attacker, event.target)) return;
  const { CombatType, Misc } = common.core();
  if (event.combatType === CombatType.MELEE || event.combatType === CombatType.MAGIC) {
    // Unmitigated roll only: shared PendingHit owns accuracy, protection and caps.
    event.damage = Misc.randomInclusive(0, event.combatType === CombatType.MELEE ? MELEE_MAX : MAGIC_MAX);
  }
}
function occupied(area, location, except) {
  return [...area.getNpcs(), ...area.getPlayers()].some(actor => {
    if (actor === except || !actor.isRegistered() || actor.getHitpoints() <= 0) return false;
    const at = actor.getLocation();
    return at.getZ() === location.getZ() && location.getX() >= at.getX() && location.getX() < at.getX() + actor.getSize()
      && location.getY() >= at.getY() && location.getY() < at.getY() + actor.getSize();
  });
}
function legalTile(area, mobile, location) {
  return area.contains(location) && !common.core().RegionManager.blocked(location, mobile.getPrivateArea())
    && !occupied(area, location, mobile);
}
function teleportBeside(npc, target) {
  const area = arenaFor(npc, target);
  if (!area || npc.getLocation().getDistance(target.getLocation()) <= 1) return;
  const { Misc, Graphic, CacheDefinitions } = common.core();
  if (Misc.randomInclusive(1, TELEPORT_CHANCE) !== 1) return;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const destination = target.getLocation().transform(dx, dy);
    if (!legalTile(area, npc, destination)) continue;
    npc.performGraphic(new Graphic(CacheDefinitions.getSpotanimId("legends_lightbeam")));
    npc.moveTo(destination);
    npc.setMobileInteraction(target);
    return;
  }
}
function cleanup({ player }) {
  knockbacks.get(player)?.stop();
  knockbacks.delete(player);
}
function knockBack(npc, target) {
  const area = arenaFor(npc, target);
  if (!area || target.getForceMovement()) return;
  const { Animation, CacheDefinitions, CombatFactory, CountdownTask, ForceMovement, ForceMovementTask, Location, RegionManager, TaskManager } = common.core();
  const start = target.getLocation().clone(), center = npc.getLocation();
  const dx = Math.sign(start.getX() - center.getX() - Math.floor(npc.getSize() / 2));
  const dy = Math.sign(start.getY() - center.getY() - Math.floor(npc.getSize() / 2));
  if (dx === 0 && dy === 0) return;
  let end = start;
  for (let step = 1; step <= KNOCKBACK_TILES; step++) {
    const candidate = start.transform(dx * step, dy * step);
    if (!legalTile(area, target, candidate) || !RegionManager.canMovestart(end, candidate, 1, 1, target.getPrivateArea())) break;
    end = candidate;
  }
  target.clearPendingAction();
  CombatFactory.stunTicks(target, STUN_TICKS, false, { graphic: null, message: false });
  target.performAnimation(new Animation(CacheDefinitions.getSeqId("human_troll_flyback"), 20));
  if (end.equals(start)) return;
  // ForceMovement uses legacy cardinal0=N,1=E,2=S,3=W, not MovementQueue's
  // eight-way Direction IDs. Fly backwards while facing the attacker (capture angle1536).
  const faceX = center.getX() + Math.floor(npc.getSize() / 2) - start.getX();
  const faceY = center.getY() + Math.floor(npc.getSize() / 2) - start.getY();
  const facing = Math.abs(faceX) >= Math.abs(faceY) ? (faceX > 0 ? 1 : 3) : (faceY > 0 ? 0 : 2);
  const movement = new ForceMovement(start, new Location(end.getX() - start.getX(), end.getY() - start.getY(), 0),
    20, 40, facing, CacheDefinitions.getSeqId("human_troll_flyback"));
  const destination = end.clone();
  const task = new (class extends ForceMovementTask {
    constructor() { super(target, 2, movement); }
    valid() {
      return arenaFor(npc, target) === area && target.getLocation().equals(start)
        && legalTile(area, target, destination)
        && RegionManager.canMovestart(start, destination, 1, 1, target.getPrivateArea());
    }
    execute() {
      if (!this.valid()) return this.stop();
      super.execute();
      // moveTo marks placement for this world cycle, cancelling NPC combat.
      // Resume after placement clears, without restoring the player's interrupted action.
      const scene = require("./FishierStout.Charting").scenes.get(target);
      TaskManager.submit(new CountdownTask(scene, 1, () => {
        if (arenaFor(npc, target) === area && target.getLocation().equals(destination)
          && !target.isNeedsPlacement() && npc.getCombat().getTarget() === null) {
          npc.getCombat().attack(target);
        }
      }));
    }
    onTick() { if (!this.valid()) this.stop(); }
    stop() {
      super.stop();
      if (knockbacks.get(target) === this) knockbacks.delete(target);
    }
  })();
  knockbacks.set(target, task);
  TaskManager.submit(task);
}
function afterApplied(hit, effect) {
  if (!hit.isAccurate()) return;
  // Combat's after-hit callback precedes HP application. Observe actual damage so
  // lethal hits and removed owners cannot schedule post-death movement/freeze.
  hit.getHits()[0]?.onApplied(() => {
    if (arenaFor(hit.getAttacker(), hit.getTarget())) effect();
  });
}
function rocksClass() {
  const { Animation, CombatMethod, CombatFactory, CombatType, Graphic, PendingHit, PrayerHandler, CacheDefinitions, Misc } = common.core();
  return class RocksCombat extends CombatMethod {
    constructor(npc) {
      super(); this.npc = npc;
      const target = npc.getCombat().getTarget(), active = arenaFor(npc, target);
      const at = npc.getLocation(), to = target?.getLocation();
      const cardinal = to && Math.abs(at.getX() - to.getX()) + Math.abs(at.getY() - to.getY()) === 1;
      this.attackType = active && (PrayerHandler.isActivated(target, PrayerHandler.PROTECT_FROM_MAGIC)
        || (cardinal && Misc.randomInclusive(1, ADJACENT_MELEE_CHANCE) === 1)) ? CombatType.MELEE : CombatType.MAGIC;
    }
    type() { return this.attackType; }
    attackDistance(character) {
      return this.attackType === CombatType.MELEE
        ? CombatFactory.MELEE_COMBAT.attackDistance(character) : CombatFactory.MAGIC_COMBAT.attackDistance(character);
    }
    start(character, target) {
      teleportBeside(character, target);
      const animation = character.getAttackAnim(target);
      if (animation !== -1) character.performAnimation(new Animation(animation));
    }
    hits(character, target) { return [new PendingHit(character, target, this, this.attackType === CombatType.MAGIC ? MAGIC_DELAY : 0)]; }
    handleAfterHitEffects(hit) {
      if (this.attackType !== CombatType.MAGIC) return;
      afterApplied(hit, () => {
        const target = hit.getTarget();
        target.clearPendingAction(); target.getCombat().reset();
        target.performGraphic(Graphic.delayed(CacheDefinitions.getSpotanimId("ice_barrage_impact"), 10));
        CombatFactory.freezeTicks(target, FREEZE_TICKS, null, this.npc, "ice");
      });
    }
  };
}
function daddyClass() {
  const { Animation, CacheDefinitions, CombatFactory, CombatMethod, CombatType, Misc, PendingHit } = common.core();
  return class DaddyCombat extends CombatMethod {
    constructor(npc) {
      super(); this.npc = npc;
      this.special = !!arenaFor(npc, npc.getCombat().getTarget()) && Misc.randomInclusive(1, DADDY_SPECIAL_CHANCE) === 1;
    }
    type() { return CombatType.MELEE; }
    attackDistance(character) { return CombatFactory.MELEE_COMBAT.attackDistance(character); }
    playsBlockAnimation() { return !this.special; }
    start(character, target) {
      if (this.special) character.performAnimation(new Animation(CacheDefinitions.getSeqId("troll_treetrunk_attack")));
      else CombatFactory.MELEE_COMBAT.start(character, target);
    }
    hits(character, target) { return [new PendingHit(character, target, this)]; }
    handleAfterHitEffects(hit) { if (this.special) afterApplied(hit, () => knockBack(this.npc, hit.getTarget())); }
  };
}
function attach(api) {
  common.init(api);
  api.registerNpcCombatMethodProvider([api.core.CacheDefinitions.getNpcId(ROCKS)], rocksClass(), { singleton: false });
  api.registerNpcCombatMethodProvider([api.core.CacheDefinitions.getNpcId(DADDY)], daddyClass(), { singleton: false });
  api.onCustomEvent("combat:hit-rolled", damageRoll);
  api.onPlayerLogout(cleanup);
}
module.exports = attach;
