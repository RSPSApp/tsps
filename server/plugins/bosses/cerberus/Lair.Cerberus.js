/**
 * Cerberus' Lair (Wiki: Cerberus' Lair, Cerberus/Strategies), three arenas off the Key Master's
 * hall, each an Area with its own Cerberus (the world spawns in npc-spawns.json):
 * - an Iron Winch opens each arena; only a player on a hellhound or Cerberus Slayer task is let
 *   in, and Peek counts who is inside;
 * - the Portcullis inside leads back to the winch, and the hall's cave back to Taverley Dungeon;
 * - Cerberus sits, unattackable, while her arena is empty, stands when a player is in it, and
 *   when the last one leaves she sits again at full health with her summons gone;
 * - the arena is single combat; her fight lives in Fight.Cerberus.js.
 */
const Common = require("./Common.Cerberus");
const Fight = require("./Fight.Cerberus");

/** Every arena, in the data's order. */
const arenas = [];

class Arena {
  constructor(def) {
    this.def = def;
    this.name = def.name;
    const [minX, maxX, minY, maxY] = def.bounds;
    this.bounds = { minX, maxX, minY, maxY };
    this.cerberus = null;
    this.fight = null;
    this.area = null;
  }

  contains(location) {
    const { minX, maxX, minY, maxY } = this.bounds;
    const x = location.getX();
    const y = location.getY();
    return location.getZ() === 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  players() {
    return this.area ? this.area.getPlayers().filter((player) => player.isRegistered?.() !== false) : [];
  }

  /** Cerberus stands for the arena's players; her fight starts with the first. */
  wake() {
    const npc = this.cerberus;
    if (!npc || this.fight || npc.isDyingFunction?.() || npc.getHitpoints() <= 0) return;
    const { ids } = Common;
    npc.setNpcTransformationId(ids.npcs.attacking);
    npc.performAnimation(new Common.core.Animation(ids.seqs.stand));
    this.fight = Fight.begin(this, npc);
  }

  /** Nobody left: her summons go, she sits back down and heals fully. */
  reset() {
    const fight = this.fight;
    this.fight = null;
    fight?.stop();
    const npc = this.cerberus;
    if (!npc || npc.isDyingFunction?.() || npc.getHitpoints() <= 0) return;
    npc.getCombat().reset();
    npc.setNpcTransformationId(Common.ids.npcs.sitting);
    npc.performAnimation(new Common.core.Animation(Common.ids.seqs.sit));
    npc.setHitpoints(npc.getMaxHitpoints());
  }
}

function arenaAt(location) {
  return arenas.find((arena) => arena.contains(location)) ?? null;
}

function arenaOfWinch(location) {
  return arenas.find((arena) => arena.def.winch[0] === location.x && arena.def.winch[1] === location.y) ?? null;
}

function createArea(arena) {
  const { Area, Boundary } = Common.core;
  const { minX, maxX, minY, maxY } = arena.bounds;
  class CerberusArena extends Area {
    constructor() {
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
      this.arena = arena;
    }

    getName() {
      return `Cerberus (${arena.name})`;
    }

    isMulti() {
      return false;
    }

    postEnter(mobile) {
      if (mobile.isNpc?.() && Common.isCerberus(mobile)) {
        arena.cerberus = mobile;
        mobile.setFlag?.("combat:no-regen");
      }
    }

    postLeave(mobile) {
      if (mobile.isNpc?.() && mobile === arena.cerberus) {
        arena.fight?.stop();
        arena.fight = null;
        arena.cerberus = null;
        return;
      }
      if (!mobile.isPlayer?.()) return;
      arena.fight?.forget(mobile);
      if (arena.players().every((player) => player === mobile)) arena.reset();
    }

    process(mobile) {
      if (mobile !== arena.cerberus) return;
      const players = arena.players();
      if (players.length > 0 && !arena.fight) arena.wake();
      arena.fight?.tick(players);
    }

    canAttack(attacker, target) {
      if (Common.isSoul(target)) return false;
      if (!attacker?.isPlayer?.() || target !== arena.cerberus) return null;
      if (!arena.fight) return false;
      if (!Common.onTask(attacker.getAsPlayer(), target)) {
        attacker.sendMessage(Common.message("noTask"));
        return false;
      }
      return null;
    }
  }
  return new CerberusArena();
}

// --- The hall

/**
 * Turn: into the arena, for a player on task. A league character carrying the echo orb is asked
 * first ("echo-boss:entry", plugins/modes/league/EchoOrbs.LeagueMode.js); the task rule stays.
 */
function turnWinch({ player, location }) {
  const arena = arenaOfWinch(location);
  if (!arena) return false;
  if (!arena.cerberus || !Common.onTask(player, arena.cerberus)) {
    player.sendMessage(Common.message("noTask"));
    return true;
  }
  const entry = { player, boss: "cerberus", enter: () => player.moveTo(Common.toLocation(arena.def.entry)), handled: false };
  Common.api.emitCustomEvent("echo-boss:entry", entry);
  if (!entry.handled) entry.enter();
  return true;
}

function peekWinch({ player, location }) {
  const arena = arenaOfWinch(location);
  if (!arena) return false;
  const count = arena.players().length;
  player.sendMessage(count === 0 ? Common.message("peekEmpty") : count === 1 ? Common.message("peekOne") : Common.message("peekMany", { count }));
  return true;
}

/** The portcullis inside an arena leads back out beside its winch. */
function leaveArena({ player, objectId, location }) {
  if (objectId !== Common.ids.locs.portcullis) return false;
  const arena = arenaAt(new Common.core.Location(location.x, location.y, location.z));
  if (!arena) return false;
  player.moveTo(Common.toLocation(arena.def.outside));
  return true;
}

/** The hall's cave goes back to Taverley Dungeon's hellhounds. */
function leaveLair({ player, objectId }) {
  if (!Common.ids.locs.caves.includes(objectId)) return false;
  player.moveTo(Common.toLocation(Common.data.caveExit));
  return true;
}

/** The Key Master's transcript asks whether the player has a hellhound or Cerberus task. */
const KEY_MASTER_CONDITIONS = { "eLHU2R": false, "2429x7": true };

function keyMasterCondition(event) {
  if (!(event.stepId in KEY_MASTER_CONDITIONS)) return null;
  const arena = arenas.find((entry) => entry.cerberus);
  const onTask = Boolean(arena && Common.onTask(event.player, arena.cerberus));
  return onTask === KEY_MASTER_CONDITIONS[event.stepId];
}

/** A hit on Cerberus from a player off task does nothing (the arena refuses the attack too). */
function cerberusHit({ npc, hit }) {
  if (!Common.isCerberus(npc)) return;
  const attacker = hit.getAttacker?.();
  if (!attacker?.isPlayer?.() || Common.onTask(attacker.getAsPlayer(), npc)) return;
  for (const part of hit.getHits?.() ?? []) part.setDamage(0);
  hit.updateTotalDamage?.();
}

function attach(api) {
  for (const def of Common.data.arenas) arenas.push(new Arena(def));
  for (const arena of arenas) {
    arena.area = createArea(arena);
    api.registerArea(arena.area);
  }
  api.onObjectInteraction("Iron Winch", { Turn: turnWinch, Peek: peekWinch });
  api.onObjectInteraction("Portcullis", { Exit: leaveArena });
  api.onObjectInteraction("Cave", { Crawl: leaveLair });
  api.onNpcDialogueCondition(keyMasterCondition);
  api.onNpcHitModify(cerberusHit);
}

module.exports = { attach, arenas, arenaAt, Arena, KEY_MASTER_CONDITIONS, keyMasterCondition, turnWinch, peekWinch, leaveArena, leaveLair };
