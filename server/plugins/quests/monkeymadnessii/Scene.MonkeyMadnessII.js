const Encounter = require("./Encounter.MonkeyMadnessII");

// Representative room centres from cache2757 map32_88 and the Wiki's ordered
// chambers, approached from the gorilla room to the east. These are not claimed
// to be a recording's exact NPC tiles. The canonical instance supplies clipping.
const ROOMS = [[2098, 5677], [2075, 5677], [2075, 5650]];
const ENTRY = [2107, 5677];
const RETURN = [2130, 5645, 0];
const FIGHTING_ATTRIBUTE = "monkey-madness-ii:glough-fighting";
const NO_REGEN_FLAG = "combat:no-regen";
const BLOCKED_TILE = 0x200100;

function attach(api, { stageOf }) {
  const { Location, NpcIdentifiers, PathFinder, TemplatedInstanceArea } = api.core;
  const scenes = new WeakMap();
  const knownBosses = new WeakSet();
  let lifecycle;

  class GloughScene extends TemplatedInstanceArea {
    constructor(player) {
      super(8, 8);
      this.owner = player;
      this.boss = null;
      this.closing = false;
      this.leaving = false;
      this.retreatTarget = null;
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
          this.setChunk(0, x, y, {
            sourceChunkX: 256 + x, sourceChunkY: 704 + y, sourcePlane: 0, rotation: 0,
          });
        }
      }
    }

    sourceTile(x, y) { return this.tile(x - 2048, y - 5632, 0); }

    landing(x, y, size) {
      // Prefer the representative centre. Nearby alternatives accommodate the
      // actual loc footprint; a centre's terrain flags alone are not collision.
      for (let radius = 0; radius <= 3; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            const tile = this.sourceTile(x + dx, y + dy);
            let open = true;
            for (let sx = 0; sx < size; sx++) {
              for (let sy = 0; sy < size; sy++) {
                const part = tile.transform(sx, sy);
                if (!this.contains(part) || (this.getClip(part) & BLOCKED_TILE) !== 0) open = false;
              }
            }
            if (open) return tile;
          }
        }
      }
      throw new Error("Glough room has no open encounter landing");
    }

    canAttack(attacker, target) {
      const state = lifecycle.forPlayer(this.owner);
      if (!state || state.boss !== this.boss || !state.active || state.deferredLethal) return false;
      // The first chamber's eastern hallway is a ranged/magic safespot. Use the
      // area permission, not canPursue's transient denial, to clear an old chase.
      if (attacker === this.boss && state.phase === 0
        && target.getLocation().getX() - this.getBaseX() + 2048 >= ENTRY[0]) return false;
      return (attacker === this.owner && target === this.boss)
        || (attacker === this.boss && target === this.owner && state.pendingPhase === null);
    }

    canNpcStep(npc, source, destination) {
      const state = lifecycle.forPlayer(this.owner);
      if (this.closing || this.leaving || npc !== this.boss || !state?.active
        || state.boss !== npc || !contains(state) || state.deferredLethal
        || state.pendingPhase !== null || npc.isScriptedMovement() || state.phase !== 0) return null;
      // ENTRY is the actual eastern hallway start in the copied map. This is
      // an anchor boundary for the size-two actor, not a terrain-width claim.
      return destination.getX() - this.getBaseX() + 2048 < ENTRY[0];
    }

    process(mobile) {
      if (mobile !== this.owner || this.closing) return;
      const sourceX = mobile.getLocation().getX() - this.getBaseX() + 2048;
      if (sourceX >= 2110) {
        lifecycle.leave(mobile, "exit");
        return;
      }
      const state = lifecycle.forPlayer(mobile);
      if (!state) return;
      lifecycle.process(state);
      if (state.active && state.phase === 2 && state.pendingPhase === null) {
        this.boss.getMovementQueue().setBlockMovement(true).reset();
      }
      if (state.active && state.pendingPhase !== null && this.retreatTarget
        && !this.boss.getLocation().equals(this.retreatTarget)
        && this.boss.getMovementQueue().size() === 0) {
        if (!queueRetreat(state, state.pendingPhase)) lifecycle.leave(mobile, "retreat-failed");
      }
    }

    postLeave(mobile, logout) {
      if (mobile === this.owner && !this.closing) {
        this.leaving = true;
        lifecycle.leave(mobile, logout ? "logout" : "left");
        this.leaving = false;
      }
      super.postLeave(mobile, logout);
    }
  }

  function removeScene(scene, reason) {
    if (!scene || scene.closing) return;
    scene.closing = true;
    scenes.delete(scene.owner);
    scene.owner.setAttribute(FIGHTING_ATTRIBUTE, false);
    const wasInside = scene.contains(scene.owner.getLocation());
    if (scene.boss) {
      scene.boss.getCombat().reset();
      scene.boss.getCombat().getHitQueue().clear();
      api.removeNpc(scene.boss);
    }
    scene.owner.getCombat().reset();
    scene.owner.getCombat().getHitQueue().clearIncoming();
    if (scene.owner.getPrivateArea() === scene && !scene.leaving) {
      scene.leave(scene.owner, reason === "logout");
    }
    // Preserve an actual teleport destination. Logout/death inside the copied
    // map must leave a real-world save/death location rather than an instance slot.
    if (wasInside || reason === "logout") scene.owner.moveTo(new Location(...RETURN));
    scene.destroy();
  }

  function contains(state) {
    const scene = scenes.get(state.player);
    return !!scene && !scene.closing && scene.boss === state.boss
      && state.player.getPrivateArea() === scene && state.boss.getPrivateArea() === scene
      && state.player.getLocation().getZ() === 0 && scene.contains(state.player.getLocation());
  }

  function queueRetreat(state, phase) {
    const scene = scenes.get(state.player);
    if (!scene || !contains(state)) return false;
    const destination = scene.landing(...ROOMS[phase], state.boss.getSize());
    scene.retreatTarget = destination;
    state.boss.getCombat().reset();
    state.boss.setScriptedMovement(true);
    state.boss.getMovementQueue().setBlockMovement(false).reset();
    return state.boss.getLocation().equals(destination)
      || PathFinder.calculateWalkRoute(state.boss, destination.getX(), destination.getY()) > 0;
  }

  lifecycle = Encounter.createEncounterLifecycle({
    stageOf, contains, retreat: queueRetreat,
    arrived(state) {
      const scene = scenes.get(state.player);
      if (!scene?.retreatTarget || !state.boss.getLocation().equals(scene.retreatTarget)) return false;
      state.boss.setSpawnPosition(state.boss.getLocation());
      state.boss.setScriptedMovement(false);
      if (!state.deferredLethal) state.boss.getCombat().attack(state.player);
      return true;
    },
    remove(state, reason) { removeScene(scenes.get(state.player), reason); },
  });

  function start(player) {
    if (stageOf(player) !== Encounter.FIGHT_STAGE || player.getHitpoints() <= 0 || !player.isRegistered()) return null;
    const active = scenes.get(player);
    if (active && lifecycle.forPlayer(player)) return active.boss;
    const scene = new GloughScene(player);
    scenes.set(player, scene);
    try {
      const entry = scene.landing(...ENTRY, 1);
      const bossTile = scene.landing(...ROOMS[0], 2);
      player.moveTo(entry);
      scene.enter(player);
      scene.boss = api.spawnNpc({
        id: NpcIdentifiers.GLOUGH_4, x: bossTile.getX(), y: bossTile.getY(), z: 0,
        wanderRadius: 0, owner: player, ownerOnly: true,
      });
      if (!scene.boss) {
        removeScene(scene, "spawn-failed");
        return null;
      }
      // Generic idle/retreat regeneration must not refill a scripted phase
      // retreat. This flag belongs to this owned attempt, not all Glough NPCs.
      scene.boss.setFlag(NO_REGEN_FLAG);
      knownBosses.add(scene.boss);
      scene.add(scene.boss);
      if (!lifecycle.begin(player, scene.boss)) {
        removeScene(scene, "start-failed");
        return null;
      }
      player.setAttribute(FIGHTING_ATTRIBUTE, true);
      return scene.boss;
    } catch (error) {
      removeScene(scene, "setup-failed");
      throw error;
    }
  }

  function beforeDeath(event) {
    const outcome = lifecycle.beforeDeath(event.npc);
    if (outcome === "deferred" || outcome === "cancelled") event.preventDeath = true;
  }

  function modifyBossHit({ npc, hit }) {
    const state = lifecycle.forBoss(npc);
    if (!state) return;
    if (state.deferredLethal || !contains(state) || hit.getAttacker() !== state.player) hit.setTotalDamage(0);
  }

  function finalDamage({ target, hit }) {
    const state = lifecycle.forBoss(target);
    // The final HP boundary also covers split splats, poison and recoil, which
    // need not pass through the PendingHit modifier above. The temporary HP is
    // only a movement carrier for the already-lethal hit, not fresh damage/XP.
    if (state && (state.deferredLethal || !contains(state))) hit.setDamage(0);
    const source = hit.getSource?.();
    if (source && knownBosses.has(source)) {
      const attack = lifecycle.forBoss(source);
      if (!attack || !contains(attack) || attack.deferredLethal || attack.finalDeath
        || target !== attack.player) hit.setDamage(0);
    }
  }

  function claimDeath({ killer, npc }) {
    if (!killer || !lifecycle.claimVictory(killer, npc)) return false;
    removeScene(scenes.get(killer), "victory");
    return true;
  }

  function playerDeath({ player }) { lifecycle.leave(player, "owner-death"); }
  function logout({ player }) { lifecycle.leave(player, "logout"); }
  function login({ player }) {
    if (player.getAttribute(FIGHTING_ATTRIBUTE) !== true) return;
    player.setAttribute(FIGHTING_ATTRIBUTE, false);
    player.moveTo(new Location(...RETURN));
  }

  api.persistAttribute(FIGHTING_ATTRIBUTE, false);
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcHitModify(modifyBossHit);
  api.onCustomEvent("combat:damage-apply", finalDamage);
  api.onPlayerBeforeDeath(playerDeath);
  api.onPlayerLogout(logout);
  api.onPlayerLogin(login);
  require("./Combat.MonkeyMadnessII").attach(api, { lifecycle, contains, sceneFor: player => scenes.get(player) ?? null });
  return { start, claimDeath, lifecycle, sceneFor: (player) => scenes.get(player) ?? null };
}

module.exports = { attach, ROOMS, ENTRY, RETURN, FIGHTING_ATTRIBUTE };
