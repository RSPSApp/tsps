// Shared player-inflicted burns (Wiki: Burn). Boss mechanics described as "burns" are separate.
const INTERVAL = 4;
const MAX_STACKS = 5;
const BURN_HITSPLAT = 74;
const STRONG_IMMUNE = new Set(["tzkal-zuk", "slug prince", "gemstone crab", "mad angel", "eclipse moon", "blue moon", "blood moon"]);
const activeBurns = new WeakMap();
let core;
let pluginApi;
let burnMethod;

function immune(target, severity) {
  if (!target.isNpc() || severity === "incendiary") return false;
  const npc = target.getAsNpc();
  const name = String(npc.getCurrentDefinition().getName()).toLowerCase();
  if (STRONG_IMMUNE.has(name)) return true;
  if (severity === "normal" && (name === "cerberus" || npc.getId() === core.NpcIdentifiers.ALCHEMICAL_HYDRA_6)) return true; // Red Alchemical Hydra.
  const query = { target: npc, severity, immune: false };
  pluginApi.emitCustomEvent("combat:burn-immune", query);
  return query.immune === true;
}

function clear(target) {
  const state = activeBurns.get(target);
  activeBurns.delete(target);
  state?.task.stop();
}

function dead(target) {
  return target.getHitpoints() <= 0 || target.isDyingReturn?.() === true || target.isDyingFunction?.() === true;
}

function applyBurn(event) {
  const { attacker, target, severity = "normal", damage = 10 } = event;
  if (!target || !attacker || !target.isRegistered() || dead(target) || immune(target, severity)) return;
  const now = core.World.getProcessCycle();
  let state = activeBurns.get(target);
  if (state) {
    state.stacks = state.stacks.filter((stack) => stack.expiresAt >= now);
    if (!state.stacks.length) {
      clear(target);
      state = null;
    }
  }
  if (!state) {
    state = { stacks: [], nextDamageCycle: now + INTERVAL, task: null };
    activeBurns.set(target, state);
    state.task = new (class extends core.Task {
      constructor() {
        super(INTERVAL);
      }

      execute() {
        if (activeBurns.get(target) !== state) {
          this.stop();
          return;
        }
        if (!target.isRegistered() || dead(target)) {
          clear(target);
          this.stop();
          return;
        }
        const cycle = core.World.getProcessCycle();
        state.stacks = state.stacks.filter((stack) => stack.expiresAt >= cycle);
        if (state.stacks.length) {
          const hit = new core.PendingHit(state.stacks[0].attacker, target, burnMethod, {
            damage: state.stacks.length, delay: 0, rollAccuracy: false, experience: false,
            statusDamage: true, handleAfterHitEffects: false,
          });
          // Keep NPC style reductions, without treating the burn as a fresh attack (Smite,
          // poison, recoil, retaliation, skulling, ammunition and XP must not trigger again).
          const resolved = target.isNpc() ? target.manipulateHit(hit) : hit;
          for (const damage of resolved?.getHits() ?? []) {
            if (damage.getDamage() <= 0) continue;
            damage.setSplatTypes(BURN_HITSPLAT, BURN_HITSPLAT);
            let credited = 0;
            for (const stack of state.stacks) {
              if (credited++ >= damage.getDamage()) break;
              target.getCombat().addDamage(stack.attacker, 1);
            }
            target.getCombat().getHitQueue().addPendingDamage([damage]);
          }
        }
        state.nextDamageCycle = cycle + INTERVAL;
        state.stacks = state.stacks.filter((stack) => stack.expiresAt > cycle);
        if (!state.stacks.length) clear(target);
      }
    })();
    core.TaskManager.submit(state.task);
  }
  if (state.stacks.length >= MAX_STACKS) return;
  state.stacks.push({ attacker, expiresAt: now + Math.max(1, Math.floor(damage)) * INTERVAL });
  event.applied = true;
}

function remainingBurn(event) {
  const state = activeBurns.get(event.target);
  event.remaining = state ? state.stacks.reduce((total, stack) =>
    total + Math.max(0, Math.floor((stack.expiresAt - state.nextDamageCycle) / INTERVAL) + 1), 0) : 0;
}

function consumeBurn(event) {
  remainingBurn(event);
  clear(event.target);
}

function clearEvent({ target }) {
  clear(target);
}

function playerDefeated({ victim }) {
  clear(victim);
}

function playerLogout({ player }) {
  clear(player);
}

function npcDeath({ npc }) {
  clear(npc);
}

function poolRestored({ player, tier }) {
  if (tier >= 4) clear(player);
}

function initializeBurnTracker(api) {
  core = api.core;
  pluginApi = api;
  burnMethod = new (class BurnCombatMethod extends core.CombatMethod {
    type() { return core.CombatType.RANGED; }
    hits() { return []; }
  })();
}

module.exports = {
  name: "Burns",
  members: true,
  register(api) {
    initializeBurnTracker(api);
    api.onCustomEvent("combat:burn", applyBurn);
    api.onCustomEvent("combat:burn-remaining", remainingBurn);
    api.onCustomEvent("combat:consume-burn", consumeBurn);
    api.onCustomEvent("combat:clear-burn", clearEvent);
    api.onCustomEvent("rejuvenation-pool:restored", poolRestored);
    api.onPlayerDefeated(playerDefeated);
    api.onPlayerLogout(playerLogout);
    api.onNpcDeath(npcDeath);
  },
};
