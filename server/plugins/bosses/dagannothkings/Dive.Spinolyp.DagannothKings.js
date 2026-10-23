"use strict";

/**
 * Spinolyps diving (see ../DagannothKings.plugin.js for behaviour and sources).
 *
 * Wiki (Spinolyp): they turn into level-34 suspicious water, becoming non-attackable
 * ("You can't attack this npc."), and emerge again after a while; the Wiki pairs the
 * surfaced and submerged forms in order (5947/5961/5963 with 5946/5948/5962).
 * Trigger chances, style odds, wait lengths and the dive/emerge anims have no Wiki or
 * capture source: they follow the only available implementation (ReasonPS) as
 * behavior-oracle estimates, stated as such in the PR.
 */
const Common = require("./Common.DagannothKings");

const DIVE_DELAY_TICKS = 1;
const SUBMERGED_TICKS = 5;

/** npc -> submerged water id, while under. */
const submerged = new WeakMap();

let core = null;

function dive(npc) {
  if (!npc?.isRegistered?.() || (npc.getHitpoints?.() ?? 1) <= 0 || submerged.has(npc)) return;
  const waterId = Common.DIVE_PAIRS.get(npc.getId?.());
  if (!Number.isInteger(waterId)) return;
  submerged.set(npc, waterId);
  try {
    npc.getMovementQueue?.()?.reset?.();
    npc.getCombat?.()?.reset?.();
    npc.performAnimation?.(new core.Animation(Common.ANIM.spinolypDeath));
  } catch {
    // Garrison the visuals: the transform below is the behaviour.
  }
  later(DIVE_DELAY_TICKS, () => submerge(npc));
}

function submerge(npc) {
  const waterId = submerged.get(npc);
  if (waterId === undefined || !npc.isRegistered?.()) {
    submerged.delete(npc);
    return;
  }
  try {
    npc.setNpcTransformationId?.(waterId);
  } catch {
    submerged.delete(npc);
    return;
  }
  later(SUBMERGED_TICKS, () => emerge(npc));
}

function emerge(npc) {
  const waterId = submerged.get(npc);
  if (waterId === undefined) return;
  submerged.delete(npc);
  // Restore the surfaced form even for a corpse: the engine clears transformations on
  // death anyway (NPCDeathTask), and this keeps a poisoned water death from respawning
  // stuck as water.
  const homeId = Common.EMERGE_PAIRS.get(waterId) ?? npc.getId?.();
  try {
    if (Number.isInteger(homeId)) npc.setNpcTransformationId?.(homeId);
  } catch {
    // Best-effort; the engine's death cleanup is the backstop.
  }
  if (!npc.isRegistered?.() || (npc.getHitpoints?.() ?? 1) <= 0) return;
  try {
    const at = npc.getLocation();
    const dx = core.Misc.randomInclusive(-2, 2);
    const dy = core.Misc.randomInclusive(-2, 2);
    npc.moveTo?.(new core.Location(at.getX() + dx, at.getY() + dy, at.getZ()));
    npc.performAnimation?.(new core.Animation(Common.ANIM.spinolypEmerge));
  } catch {
    // Garrison the visuals: the transform above is the behaviour.
  }
}

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      try {
        action();
      } catch {
        // A dead or logged-out room must not break the task queue.
      }
    }
  })());
}

/** A submerged spinolyp cannot be attacked (Wiki). */
function denyWater(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return;
  if (!Common.isSubmerged(target)) return;
  attacker.sendMessage("You can't attack this npc.");
  event.allow = false;
}

/** ReasonPS: dive on unblocked damage taken (1/3). */
function damaged({ attacker, target, hit }) {
  void attacker;
  if (!target?.isNpc?.() || !Common.isSpinolyp(target)) return;
  if ((hit?.getDamage?.() ?? hit?.getTotalDamage?.() ?? 0) <= 0) return;
  if (core.Misc.randomInclusive(1, 3) === 1) dive(target);
}

/** ReasonPS: dive after its own attacks (1/7); called from the spinolyp fight. */
function afterOwnAttack(attacker) {
  if (!attacker?.isNpc?.() || !Common.isSpinolyp(attacker)) return;
  if (core.Misc.randomInclusive(1, 7) === 1) dive(attacker);
}

/** Water forms never start fights of their own. */
function waterStaysDown(event) {
  const { attacker } = event;
  if (attacker?.isNpc?.() && Common.isSubmerged(attacker)) {
    event.allow = false;
  }
}

function attach(api) {
  core = api.core;
  api.onCanAttack(denyWater);
  api.onCanAttack(waterStaysDown);
  api.onCombatHitResolved(damaged);
}

module.exports = { attach, dive, emerge, damaged, afterOwnAttack, submerged };
