/**
 * One Araxxor lair per player. The lair is a registered Area: a player who walks (or
 * teleports) into it is moved, from its process(), into their own private instance with
 * Araxxor, the nine eggs and the fight. The instance is an Area too, so the fight only costs
 * anything for players in it: its process() keeps the encounter going, and leaving it
 * (walking out, teleporting, logging out or disconnecting) destroys it, with its NPCs, acid
 * pools and drops. After a kill the corpse lingers for its harvest, then the encounter resets
 * on the lair's timer.
 *
 * As captured: the lair is empty when the player arrives; boss and all nine eggs spawn
 * together five ticks after the tunnel's "You crawl through the webbed tunnel." box closes
 * (so a player who leaves a dialogue open keeps her waiting). The boss holds for 6 ticks after
 * its spawn animation (11482) before its first attack, and the egg pattern is one of the three
 * fixed layouts (the first egg's colour picks the fight's special). After a kill the next
 * one appears on the lair's respawn timer.
 */
const Shared = require("./Shared.Araxxor");
const Hud = require("./Hud.Araxxor");
const Minions = require("./Minions.Araxxor");
const Specials = require("./Specials.Araxxor");
const CombatAchievements = require("./CombatAchievements.Araxxor");

const ATTR_AREA = "araxxor:instance-area";

let api = null;
let core = null;
let AraxxorPrivateArea = null;
let LairArea = null;
/** player -> session for the player's live lair. */
const sessions = new Map();

function lairBoundary() {
  return new core.Boundary(Shared.LAIR.minX, Shared.LAIR.maxX, Shared.LAIR.minY, Shared.LAIR.maxY, 0);
}

function insideLair(location) {
  if (!location || location.getZ?.() !== 0) return false;
  const x = location.getX();
  const y = location.getY();
  return x >= Shared.LAIR.minX && x <= Shared.LAIR.maxX && y >= Shared.LAIR.minY && y <= Shared.LAIR.maxY;
}

/** The spiders of the fight: only the instance they belong to may attack them. */
function isLairNpc(target) {
  if (!target?.isNpc?.()) return false;
  const id = target.getId?.();
  return [Shared.BOSS_ID, Shared.CORPSE_ID, Shared.BALL_ID, Shared.MINION_ID.mirrorback, Shared.MINION_ID.ruptura,
    Shared.MINION_ID.acidic, Shared.EGG_ID.mirrorback, Shared.EGG_ID.ruptura, Shared.EGG_ID.acidic].includes(id);
}

function defineAreaClasses() {
  /** The lair as the map knows it: it only hands each player their own instance. */
  class AraxxorLair extends core.Area {
    constructor() {
      super([lairBoundary()]);
    }

    process(mobile) {
      if (mobile?.isPlayer?.()) enterInstance(mobile.getAsPlayer());
    }

    isMulti() {
      return true;
    }
  }
  LairArea = AraxxorLair;

  class AraxxorArea extends core.PrivateArea {
    constructor(ownerName) {
      super([lairBoundary()]);
      this.ownerName = ownerName ?? "unknown";
    }

    destroy() {
      if (this.isDestroyed?.() === true) {
        return;
      }
      const addQueue = core.World.getAddNPCQueue();
      const removeQueue = core.World.getRemoveNPCQueue();
      for (const entity of this.entities) {
        if (!entity?.isNpc?.() || !entity?.getAsNpc) {
          continue;
        }
        const npc = entity.getAsNpc();
        for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) {
          addQueue.splice(index, 1);
        }
        if (npc.isRegistered?.() && !removeQueue.includes(npc)) {
          removeQueue.push(npc);
        }
      }
      super.destroy();
    }

    /** Per tick, players in this instance only: spawn (and respawn) the encounter. */
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      ensureEncounter(player, this);
      CombatAchievements.tick(player, sessions.get(player)?.npc ?? null);
    }

    postLeave(mobile, logout) {
      if (mobile?.isPlayer?.()) {
        CombatAchievements.left(mobile.getAsPlayer());
        destroyArea(mobile.getAsPlayer(), this);
      }
      super.postLeave(mobile, logout);
    }

    /** Players fight only their own instance's spiders. */
    canAttack(attacker, target) {
      if (!attacker?.isPlayer?.() || !isLairNpc(target)) return null;
      return attacker.getPrivateArea?.() === target.getPrivateArea?.() ? null : false;
    }

    /** The whole lair is one fight. */
    isMulti() {
      return true;
    }
  }
  AraxxorPrivateArea = AraxxorArea;
}

function areaOf(player) {
  const area = player.getAttribute?.(ATTR_AREA);
  return area instanceof AraxxorPrivateArea && area.isDestroyed?.() !== true ? area : null;
}

function clearSession(player, sourceArea) {
  if (!player) return;
  const session = sessions.get(player);
  if (session && (sourceArea == null || session.area === sourceArea || session.area?.isDestroyed?.() === true)) {
    Specials.endFight(session.npc ?? {});
    sessions.delete(player);
  }
  const assigned = player.getAttribute?.(ATTR_AREA);
  if (sourceArea == null || assigned === sourceArea || assigned?.isDestroyed?.() === true) {
    player.setAttribute?.(ATTR_AREA, null);
  }
}

function destroyArea(player, area = player.getAttribute?.(ATTR_AREA)) {
  Hud.dropFor(player);
  clearSession(player, area);
  if (area instanceof AraxxorPrivateArea && area.isDestroyed?.() !== true) {
    area.destroy();
  }
  // Shots already in flight die with the instance: nothing follows the player out.
  player.getCombat?.().getHitQueue?.().clear?.();
}

function createSession(player, area) {
  const pattern = Shared.PATTERNS[Math.floor(Math.random() * Shared.PATTERNS.length)];
  const session = {
    player,
    area,
    npc: null,
    eggs: [],
    minions: [],
    pattern,
    fighter: player,
    stash: [],
    pendingPet: [],
    corpse: null,
    respawnAt: 0,
    /** When the boss appears: null until the player is in the lair with nothing open. */
    spawnAt: null,
  };
  sessions.set(player, session);
  return session;
}

function spawnEncounter(session) {
  const area = session.area;
  if (area?.isDestroyed?.() === true) return;
  const boss = core.NPC.create(Shared.BOSS_ID, new core.Location(Shared.SPAWN_TILE[0], Shared.SPAWN_TILE[1], Shared.SPAWN_TILE[2]));
  boss.__skipDefaultRespawn = true;
  boss.setHitpoints?.(Shared.MAX_HITPOINTS);
  // Roams the lair to melee; without a radius she holds position and never closes.
  boss.getMovementCoordinator?.().setRadius?.(30);
  // Wiki: out of melee range he closes the distance, attacking with magic/ranged on the
  // way. The engine otherwise stands its ground once in range (Combat.ts); this is the
  // same combat:close-in flag ToA's Akkha uses to keep walking in while attacking.
  boss.setFlag?.("combat:close-in");
  // The lair is multiway: the boss and her brood may attack together.
  boss.setMultiCombat?.(true);
  boss.performAnimation(new core.Animation(11482));
  boss.setAttribute?.(Shared.ATTR_ENCOUNTER, session);
  boss.setAttribute?.(Shared.ATTR_ARMED_AT, core.World.getProcessCycle() + Shared.ARM_TICKS);
  boss.setAttribute?.(Shared.ATTR_SPECIAL, Shared.SPECIAL_FOR_PRIMARY[session.pattern[0]] ?? "ball");
  area.add(boss);
  core.World.getAddNPCQueue().push(boss);
  session.npc = boss;
  session.respawnAt = 0;
  session.corpse = null;
  session.spawnedAt = core.World.getProcessCycle();
  Specials.initFight(boss);
  Minions.spawnEggs(session);
  Hud.show(boss, session.player);
  CombatAchievements.spawned(session.player, boss);
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(Math.max(1, Shared.ARM_TICKS), null, false);
    }
    execute() {
      this.stop();
      if (!boss.isRegistered?.() || (boss.getHitpoints?.() ?? 1) <= 0) return;
      if (!session.player?.isRegistered?.()) return;
      boss.getCombat?.().attack?.(session.player);
    }
  })());
}

/**
 * Keeps the player's fight going: the first boss five ticks after they are through the tunnel
 * with no dialogue open (captured), and after a kill the next one once the corpse is gone and the
 * respawn timer has run.
 */
function ensureEncounter(player, area) {
  let session = sessions.get(player);
  const now = core.World.getProcessCycle();
  if (session?.npc) {
    // A dying boss stays registered through its corpse (remains), so only removal counts.
    if (session.npc.isRegistered?.() || core.World.getAddNPCQueue().includes(session.npc)) return;
    if (session.respawnAt && now < session.respawnAt) return;
    sessions.delete(player);
    spawnEncounter(createSession(player, area));
    return;
  }
  if (!session) session = createSession(player, area);
  // The timer starts once the player is through: not mid-crawl (movement locked by the
  // tunnel) and not reading a dialogue.
  if (player.getDialogueManager?.()?.isActive?.() === true || player.getMovementQueue?.()?.isMovementBlocked?.() === true) {
    session.spawnAt = null;
    return;
  }
  if (session.spawnAt == null) session.spawnAt = now + Shared.SPAWN_DELAY_TICKS;
  if (now >= session.spawnAt) spawnEncounter(session);
}

/**
 * Moves a player standing in the lair into their own instance. Area.enter leaves the lair
 * first, and AreaManager sees the move because it happens inside the lair's process().
 */
function enterInstance(player) {
  if (!insideLair(player.getLocation?.())) return;
  let area = areaOf(player);
  if (!area) {
    area = new AraxxorPrivateArea(player.getUsername?.());
    player.setAttribute?.(ATTR_AREA, area);
  }
  if (player.getArea?.() !== area) area.enter(player);
  ensureEncounter(player, area);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  defineAreaClasses();
  pluginApi.registerArea(new LairArea());
}

module.exports = {
  attach,
  insideLair,
  areaOf,
  sessions,
  spawnEncounter,
  ensureEncounter,
  destroyArea,
  enterInstance,
  isLairNpc,
  _test: { insideLair },
};
