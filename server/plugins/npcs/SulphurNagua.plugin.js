"use strict";

/**
 * Sulphur Nagua (Wiki: Sulphur Nagua): "their attacks are unique in that they hit twice per
 * attack, rolling damage normally and splitting it in two hitsplats" - 11 maximum, 6+5.
 * The ordinary melee swing, but with two splats on the same tick that share the maximum
 * (the same PendingHit split the twin weapons use, see MultiHitWeapons).
 *
 * Its special (Wiki): "After five attacks they will use a special attack in which they raise
 * their weapon", and "if the player remains within their melee range (including diagonal spaces)
 * after three ticks, they will have 5 prayer points drained". It hits nothing itself. As recorded
 * (rsprox_transcripts/237/01137.txt ticks 737, 950, 1482): the raise is npc_djinn_01_magic with
 * lizardshaman_spawn_explode (delay 75, height 150) on the nagua, and its next swing comes 6 ticks
 * later. Those recordings show six ordinary swings before each special; the Wiki's five is used.
 */
const SULPHUR_NAGUA = 13033;
const ATTACKS_BEFORE_SPECIAL = 5;
const DRAIN_AFTER_TICKS = 3;
const PRAYER_DRAIN = 5;
const NEXT_ATTACK_AFTER_SPECIAL = 6;
const SPECIAL_GRAPHIC = { delay: 75, height: 150 };

/** npc -> ordinary attacks since its last special, this life. */
const attacks = new WeakMap();

/** Within melee range of its footprint, diagonals included, but not under it. */
function inMeleeRange(npc, target) {
  const base = npc.getLocation();
  const at = target.getLocation();
  if (base.getZ() !== at.getZ()) return false;
  const size = Math.max(1, npc.getSize?.() ?? 1);
  const dx = at.getX() < base.getX() ? base.getX() - at.getX() : Math.max(0, at.getX() - (base.getX() + size - 1));
  const dy = at.getY() < base.getY() ? base.getY() - at.getY() : Math.max(0, at.getY() - (base.getY() + size - 1));
  return Math.max(dx, dy) === 1;
}

module.exports = {
  name: "SulphurNagua",
  description: "Sulphur Nagua melee: each attack lands as two hitsplats on the same tick that share one damage roll; every sixth attack raises its weapon to drain 5 prayer from a player still beside it 3 ticks later.",
  members: true,
  register(api) {
    const { MeleeCombatMethod, PendingHit, Animation, Graphic, Skill, Task, TaskManager, CacheDefinitions } = api.core;
    const specialSeq = CacheDefinitions.getSeqId("npc_djinn_01_magic");
    const specialSpotanim = CacheDefinitions.getSpotanimId("lizardshaman_spawn_explode");

    function drainLater(npc, target) {
      TaskManager.submit(new (class extends Task {
        constructor() {
          super(DRAIN_AFTER_TICKS, npc, false);
        }
        execute() {
          this.stop();
          if (!npc.isRegistered?.() || npc.getHitpoints() <= 0 || npc.isDyingFunction?.()) return;
          if (!target.isRegistered?.() || target.getHitpoints?.() <= 0 || !inMeleeRange(npc, target)) return;
          target.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, PRAYER_DRAIN, 0);
        }
      })());
    }

    class SulphurNaguaMelee extends MeleeCombatMethod {
      start(npc, target) {
        const count = attacks.get(npc) ?? 0;
        this.special = count >= ATTACKS_BEFORE_SPECIAL;
        if (!this.special) {
          attacks.set(npc, count + 1);
          super.start(npc, target);
          return;
        }
        attacks.set(npc, 0);
        npc.performAnimation(new Animation(specialSeq));
        npc.performGraphic(new Graphic(specialSpotanim, SPECIAL_GRAPHIC.delay, SPECIAL_GRAPHIC.height));
        npc.getCombat().setAttackDelay(NEXT_ATTACK_AFTER_SPECIAL);
        if (target?.isPlayer?.()) drainLater(npc, target);
      }

      hits(npc, target) {
        if (this.special) return [];
        return [new PendingHit(npc, target, this, { hitAmount: 2, hitMaximumSplitCount: 2 })];
      }
    }
    api.registerNpcCombatMethodProvider(SULPHUR_NAGUA, SulphurNaguaMelee);
    api.onNpcDeath(({ npc }) => {
      if (npc?.getId?.() === SULPHUR_NAGUA) attacks.delete(npc);
    });
  },
  _test: { inMeleeRange, attacks, ATTACKS_BEFORE_SPECIAL, PRAYER_DRAIN, NEXT_ATTACK_AFTER_SPECIAL },
};
