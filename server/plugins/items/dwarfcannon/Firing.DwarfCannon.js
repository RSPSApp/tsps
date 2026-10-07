/**
 * The cannon turning and firing, as captured (docs/dwarf-cannon.md): the tick after "Fire" the
 * firing flag goes out, and from the tick after that the barrel turns one step a tick. On a tick
 * when something is in the direction it faces, it fires first, then turns, in the same tick. The
 * hit lands the next tick, as the owner's, for 2 Ranged XP per damage and no Hitpoints XP (Wiki).
 */
const Cannon = require("./Common.DwarfCannon");
const Data = require("./Data.DwarfCannon");
const Ammo = require("./Ammo.DwarfCannon");
const Decay = require("./Decay.DwarfCannon");

/** Ours (not captured). */
const OUT_OF_AMMO = "Your cannon is out of ammo!";
const SEARCH_RANGE = 20;

let cannonballMethod = null;

/** The hit's combat method: Ranged, with nothing of its own to do. */
function method() {
  if (cannonballMethod) return cannonballMethod;
  const { CombatMethod, CombatType } = Cannon.core;
  cannonballMethod = new (class CannonballMethod extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    hits() {
      return [];
    }
  })();
  return cannonballMethod;
}

/** The cannon's own task, for as long as it stands: decay, then turning and firing. */
function start(cannon) {
  const { core } = Cannon;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, null, true);
    }

    execute() {
      if (cannon.gone) {
        this.stop();
        return;
      }
      Decay.tick(cannon);
      if (!cannon.gone && !cannon.broken) tick(cannon);
    }
  })());
}

function tick(cannon) {
  if (!cannon.firing) return;
  const owner = cannon.player;
  if (!owner || owner.isRegistered?.() === false) {
    Ammo.stopFiring(cannon);
    return;
  }
  const since = Cannon.core.World.getProcessCycle() - cannon.firedAt;
  if (since < 1) return;
  if (since === 1) {
    owner.getPacketSender().sendConfig(Data.VARP.FIRING, Data.FIRING_FLAG);
    return;
  }
  const kind = Cannon.KINDS[cannon.kind];
  const target = targetFor(cannon, owner);
  if (target) {
    Cannon.animate(cannon, kind.fire + cannon.direction);
    Cannon.areaSound(cannon.centre, Data.SOUND.FIRE);
    shoot(cannon, owner, target);
  }
  cannon.direction = (cannon.direction + 1) % Data.DIRECTIONS.length;
  Cannon.areaSound(cannon.centre, Data.SOUND.TURN);
  Cannon.animate(cannon, kind.turn + cannon.direction);
  if (target && Cannon.balls(cannon) === 0) {
    Ammo.stopFiring(cannon);
    owner.sendMessage(OUT_OF_AMMO);
  }
}

/** Whether the cannon may shoot `npc` for `owner` (Wiki: singles only at what attacks you). */
function canTarget(owner, npc) {
  const { CombatFactory, CanAttackResponse, TimerKey } = Cannon.core;
  if (!npc.isRegistered() || npc.getHitpoints() <= 0 || npc.isUntargetable() || npc.isDyingFunction?.()) return false;
  if (npc.getOwner?.() != null && npc.getOwner() !== owner) return false;
  if (npc.getPrivateArea() !== owner.getPrivateArea()) return false;
  const definition = npc.getDefinition();
  if (!definition?.getActions?.()?.includes("Attack")) return false;
  if (Data.NO_CANNON_NPCS.includes(definition.getName())) return false;
  if (npc.getTimers().has(TimerKey.ATTACK_IMMUNITY)) return false;
  if (!CombatFactory.multiCombatBetween(owner, npc)) {
    const ownerFoe = owner.getCombat().getAttacker();
    if (ownerFoe && ownerFoe !== npc && ownerFoe.getHitpoints() > 0) return false;
    const npcFoe = npc.getCombat().getAttacker();
    if (npcFoe && npcFoe !== owner) return false;
  }
  return CombatFactory.canAttackByPolicy(owner, npc) === CanAttackResponse.CAN_ATTACK;
}

/** In the facing direction's zone, in sight of the cannon, and a fair target; what attacks the owner first. */
function targetFor(cannon, owner) {
  const { RegionManager } = Cannon.core;
  const centre = cannon.centre;
  let best = null;
  for (const npc of Cannon.core.World.getNpcs()) {
    if (!npc) continue;
    const at = npc.getLocation();
    if (at.getZ() !== centre.getZ() || !at.isWithinDistance(centre, SEARCH_RANGE)) continue;
    if (!Data.inZone(cannon.direction, at.getX() - centre.getX(), at.getY() - centre.getY())) continue;
    if (!canTarget(owner, npc)) continue;
    const size = npc.getSize();
    if (!RegionManager.canProjectileAttackBounds(cannon.sw, at, 3, 3, size, size, null)) continue;
    if (owner.getCombat().getAttacker() === npc) return npc;
    if (!best || at.getDistance(centre) < best.getLocation().getDistance(centre)) best = npc;
  }
  return best;
}

/** One ball (granite first): projectile now, the hit next tick, Ranged XP for its damage. */
function shoot(cannon, owner, npc) {
  const { Projectile, PendingHit, CombatFactory, CombatType, AccuracyFormulasDpsCalc, Skill } = Cannon.core;
  const granite = cannon.granite > 0;
  if (granite) cannon.granite--;
  else cannon.steel--;
  Cannon.sendVars(cannon);
  Cannon.save(cannon);

  const cycles = cannon.direction % 2 === 0 ? Data.PROJECTILE.straightCycles : Data.PROJECTILE.diagonalCycles;
  new Projectile(cannon.centre, Projectile.centreOf(npc), npc, granite ? Data.PROJECTILE.granite : Data.PROJECTILE.steel,
    0, cycles, Data.PROJECTILE.startHeight, Data.PROJECTILE.endHeight, null)
    .withAngle(Data.PROJECTILE.angle).withProgress(Data.PROJECTILE.progress).sendProjectile();

  // The owner's Ranged accuracy with a ranged weapon, otherwise their melee, against Ranged defence (Wiki).
  const style = CombatFactory.getMethod(owner).type() === CombatType.RANGED ? CombatType.RANGED : CombatType.MELEE;
  const accurate = AccuracyFormulasDpsCalc.rollAccuracy(owner, npc, style, CombatType.RANGED);
  const max = granite ? Data.MAX_HIT.granite : Data.MAX_HIT.steel;
  const damage = accurate ? Math.min(npc.getHitpoints(), Math.floor(Math.random() * (max + 1))) : 0;
  const hit = new PendingHit(owner, npc, method(), { delay: 0, rollAccuracy: false, experience: false, handleAfterHitEffects: false });
  hit.setTotalDamage(damage);
  CombatFactory.addPendingHit(hit);
  if (damage > 0) owner.getSkillManager().addExperience(Skill.RANGED, damage * Data.RANGED_XP_PER_DAMAGE, true);
}

module.exports = { start, tick, canTarget, targetFor, shoot, OUT_OF_AMMO };
