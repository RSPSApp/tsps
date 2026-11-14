"use strict";

/**
 * The Thermonuclear boss room (see ../ThermonuclearSmokeDevil.plugin.js for behaviour
 * and sources).
 *
 * Wiki: the boss "can be fought with another player" (like the Kraken), so the room is
 * multicombat throughout the Slayer-area box. The boss walks through other
 * monsters/players (Wiki), so the flag is ensured for every boss in the room on every
 * tick - a fresh or respawned boss never gets stuck on the room's smoke devils.
 *
 * Wiki (Smoke Devil Dungeon, Smoke devil): the boss and every smoke devil in the dungeon
 * can only be attacked on a smoke devil task, so attacks in the room and in the dungeon
 * outside it are refused unless slayer:on-task covers the target. The boss alone also
 * allows one off-task kill for the Western Provinces Diary once that diary is started,
 * its Thermonuclear task is unfinished and the player has base 93 Slayer.
 *
 * Live (rsprox 1510, rev 224, tick 198): the refused attack sends Breive's game message
 * and his line over his chat head on the same tick (refuse below).
 */
const Common = require("./Common.ThermonuclearSmokeDevil");

/** [minX, minY, maxX, maxY] from the boss room polygon. */
const ROOM = [2351, 9438, 2378, 9461];

/** Wiki: the boss walks through other monsters/players, so it never sticks on them. */
function ensureWalkThrough(npc) {
  npc.setFlag(Common.core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
}

/** The dungeon outside the room: boxes x 2377-2431, y 9408-9471, padded around the cache map's walkable tiles (x 2377-2427, y 9415-9468). */
const DUNGEON = Common.DATA.dungeon;
const BREIVE = Common.DATA.breive;

/** Breive's refusal: the game message, then his line over his chat head (captured, one tick together). */
function refuse(player) {
  const { DialogueChainBuilder, NpcDialogue, CacheDefinitions } = Common.core;
  player.sendMessage(BREIVE.message);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, BREIVE.npc, BREIVE.line, "Breive", CacheDefinitions.getSeqId(BREIVE.expression))));
}

/**
 * The task gate both areas share. Only the player's own pending attack is refused aloud:
 * canAttack is also a permission probe (target scans, the dwarf cannon, the agent MCP), and
 * auto-retaliation against a smoke devil that attacks first must stay silent too.
 */
function taskGate(attacker, target, { diaryException }) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return null;
  const player = attacker.getAsPlayer();
  if (Common.onTask(player, target)) return null;
  if (diaryException && Common.isBoss(target) && Common.diaryOffTaskKillAllowed(player)) return null;
  const combat = player.getCombat?.();
  if (combat?.getTarget?.() === target && !combat.isAutoRetaliating?.()) refuse(player);
  return false;
}

let area = null;

function areaClass() {
  const { Area, Boundary } = Common.core;
  return class ThermonuclearSmokeDevilArea extends Area {
    constructor() {
      super([new Boundary(ROOM[0], ROOM[2], ROOM[1], ROOM[3], 0)]);
    }

    getName() {
      return "Thermonuclear Smoke Devil";
    }

    isMulti() {
      return true;
    }

    process(character) {
      if (character?.isNpc?.() && Common.isBoss(character)) ensureWalkThrough(character);
    }

    /** Only a player whose task covers the room's monsters may attack them (Wiki). */
    canAttack(attacker, target) {
      return taskGate(attacker, target, { diaryException: true });
    }
  };
}

function dungeonAreaClass() {
  const { Area, Boundary } = Common.core;
  return class SmokeDevilDungeonArea extends Area {
    constructor() {
      super(DUNGEON.map((box) => new Boundary(box.minX, box.maxX, box.minY, box.maxY, 0)));
    }

    getName() {
      return "Smoke Devil Dungeon";
    }

    /** Only a player whose task covers the dungeon's smoke devils may attack them (Wiki). */
    canAttack(attacker, target) {
      return taskGate(attacker, target, { diaryException: false });
    }
  };
}

/** Players currently inside the room and alive, for Peek. */
function playersInside() {
  return (area?.getPlayers?.() ?? []).filter((player) => {
    const at = player?.getLocation?.();
    return at && Common.inLair(at) && (player.getHitpoints?.() ?? 1) > 0;
  });
}

function attach(api) {
  area = new (areaClass())();
  api.registerArea(area);
  api.registerArea(new (dungeonAreaClass())());
}

module.exports = { attach, areaClass, dungeonAreaClass, ensureWalkThrough, playersInside, refuse, ROOM, DUNGEON, BREIVE };
