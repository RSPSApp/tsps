// OSRS rsprox 3275: the coffin raises the Count; the stairs alone never start combat.
let pluginApi;
const encounters = new WeakMap();
const countStates = new WeakMap();
const ATTR_PENDING_INSTANCE = "count_draynor:pending_instance";
const REGEN_TICKS = 5;
const GARLIC_TICKS = 50;

function later(key, ticks, action) {
  const { TaskManager, CountdownTask } = pluginApi.core;
  TaskManager.submit(new CountdownTask(key, ticks, action));
}

function climbManorStairs(request) {
  if (request.handled) return;
  const { ObjectIdentifiers: O, Location } = pluginApi.core;
  if (request.objectId !== O.STAIRS_11 && request.objectId !== O.STAIRS_12) return;
  const entering = request.objectId === O.STAIRS_11;
  if (entering) request.player.setAttribute(ATTR_PENDING_INSTANCE, true);
  pluginApi.emitCustomEvent(entering ? "ladders:climbDown" : "ladders:climbUp", {
    player: request.player,
    destination: entering ? new Location(3077, 9772, 0) : new Location(3116, 3356, 0),
  });
  request.handled = true;
}

/** "count-draynor:arriving" { player }: a teleport into the crypt gets its own instance too. */
function arriving({ player }) {
  player.setAttribute(ATTR_PENDING_INSTANCE, true);
}

function createEncounter(player) {
  const { PrivateArea, Boundary } = pluginApi.core;
  return new (class CountDraynorArea extends PrivateArea {
    constructor() {
      super([new Boundary(3072, 3084, 9766, 9779, 0)]);
      this.owner = player;
      this.npc = null;
    }
    process(mobile) {
      if (mobile !== this.npc || mobile.getHitpoints() <= 0) return;
      const state = countStates.get(mobile);
      if (!state) return;
      const tick = pluginApi.core.World.getProcessCycle();
      if (tick >= state.nextRegen) {
        mobile.heal(1);
        state.nextRegen = tick + REGEN_TICKS;
      }
      if (state.weakUntil && tick >= state.weakUntil) {
        mobile.setCombatOverride(null);
        state.weakUntil = 0;
      }
    }
    canAttack(attacker, target) {
      return (attacker === this.owner && target === this.npc) ||
        (attacker === this.npc && target === this.owner) ? null : false;
    }
    postLeave(mobile, logout) {
      if (mobile === this.owner) encounters.delete(this.owner);
      super.postLeave(mobile, logout);
    }
    destroy() {
      if (this.isDestroyed() || this.destroying) return;
      this.destroying = true;
      for (const entity of [...this.entities]) {
        if (entity !== this.owner) pluginApi.removeNpc(entity);
      }
      super.destroy();
    }
  })();
}

function coffinObject(source, id) {
  return new pluginApi.core.GameObject(id, source.getLocation().clone(), source.getType(), source.getFace(), null);
}

function openCoffin({ player, object }) {
  if (encounters.has(player)) return true;
  const complete = { player, key: "vampyre_slayer", complete: null };
  const started = { player, key: "vampyre_slayer", started: null };
  pluginApi.emitCustomEvent("quest:is-complete", complete);
  pluginApi.emitCustomEvent("quest:is-started", started);
  if (complete.complete || !started.started) {
    player.sendMessage("The coffin is empty.");
    return true;
  }
  const { ObjectIdentifiers: O, NpcIdentifiers: N, Animation } = pluginApi.core;
  const area = createEncounter(player);
  encounters.set(player, area);
  area.enter(player);
  const display = (id) => player.getPacketSender().sendObject(coffinObject(object, id));
  display(O.COFFIN_9);
  later(area, 4, () => {
    if (area.isDestroyed()) return;
    area.npc = pluginApi.spawnNpc({ id: N.COUNT_DRAYNOR_2, x: 3077, y: 9775, z: 0, owner: player, ownerOnly: true });
    area.add(area.npc);
    area.npc.performAnimation(new Animation(3114));
  });
  later(area, 9, () => {
    if (area.isDestroyed()) return;
    if (area.npc) pluginApi.removeNpc(area.npc);
    area.npc = pluginApi.spawnNpc({ id: N.COUNT_DRAYNOR, x: 3078, y: 9774, z: 0, owner: player, ownerOnly: true });
    area.add(area.npc);
    area.npc.performAnimation(new Animation(3115));
    area.npc.setCombatXpMultiplier(0.025);
    countStates.set(area.npc, { weakUntil: 0, nextRegen: pluginApi.core.World.getProcessCycle() + REGEN_TICKS });
    display(O.COFFIN_6);
    area.npc.getCombat().attack(player);
  });
  later(area, 13, () => { if (!area.isDestroyed()) display(O.COFFIN_46); });
  return true;
}

function garlicWeakness({ attacker, target, combatType }) {
  const state = countStates.get(target);
  if (!state || state.weakUntil || target.getHitpoints() !== target.getMaxHitpoints()) return;
  const { ItemIdentifiers: I, CombatType, HitDamage, HitMask } = pluginApi.core;
  if (!attacker?.getInventory || attacker.getInventory().getAmount(I.GARLIC) <= 0) return;
  if (combatType === CombatType.MAGIC && !attacker.getCombat().getAutocastSpell()) return;
  const stats = [...target.getCurrentDefinition().getStats()];
  stats[0] = Math.max(0, stats[0] - 10);
  stats[1] = Math.max(0, stats[1] - 10);
  stats[2] = Math.max(0, stats[2] - 40);
  target.setCombatOverride({ stats, maxHit: 2 });
  target.getCombat().getHitQueue().addPendingDamage([new HitDamage(10, HitMask.RED)]);
  state.weakUntil = pluginApi.core.World.getProcessCycle() + GARLIC_TICKS;
  attacker.sendMessage("The vampyre seems to weaken.");
}

function garlicDamage(player, damage) {
  const target = player.getCombat?.().getTarget?.();
  if (!countStates.has(target)) return damage;
  return player.getInventory().getAmount(pluginApi.core.ItemIdentifiers.GARLIC) > 0 ? damage + 1 : damage;
}

function countDied({ npc }) {
  if (!countStates.has(npc)) return;
  npc.__skipDefaultRespawn = true;
  // The owner stays in the basement and can leave by its ordinary staircase.
}

module.exports = {
  name: "CountDraynor",
  register(api) {
    pluginApi = api;
    api.onCustomEvent("ladders:climb", climbManorStairs);
    api.onCustomEvent("count-draynor:arriving", arriving);
    api.onObjectFirstClick(api.core.ObjectIdentifiers.COFFIN_46, openCoffin);
    api.onCombatHitRoll(garlicWeakness);
    api.registerMeleeHitModifier(garlicDamage);
    api.registerRangedHitModifier(garlicDamage);
    api.registerMagicHitModifier(garlicDamage);
    api.onNpcDeath(countDied);
  },
  _test: { arriving, ATTR_PENDING_INSTANCE },
};
