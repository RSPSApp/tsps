"use strict";

/**
 * Zulrah: shared state, ids, tiles and small helpers every unit uses.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Zulrah and /w/Zulrah/Strategies
 */

const state = { api: null, core: null };

function bind(api) {
  state.api = api;
  state.core = api.core;
}

function core() {
  return state.core;
}

function api() {
  return state.api;
}

const NPC = {
  /** Zulrah's three forms (Wiki): green ranged, red tail, blue magic. */
  GREEN: 2042,
  RED: 2043,
  BLUE: 2044,
  SNAKELING_MELEE: 2045,
  SNAKELING_MAGIC: 2046,
  PRIESTESS: 2033,
};
const FORM_IDS = new Set([NPC.GREEN, NPC.RED, NPC.BLUE]);

const OBJECT = {
  /** Multiloc 10068 at the pier: varbit 4391 above 2 shows 46242 (Board, Quick-Board). */
  BOAT: "Sacrificial boat",
  VENOM_CLOUD: 11700,
  TELEPORT: 11701,
};

/**
 * Varbit 4391 drives the boat multiloc (10068) and the priestess multinpc (2124): 3 is the
 * state after the High Priestess lets you be the sacrifice (boat 46242, priestess 2033 with
 * Collect). Access is open here, so everyone has it.
 */
const ACCESS_VARBIT = 4391;
const ACCESS_VALUE = 3;

/** Wiki ("Zul-andra teleport" destination). */
const ZUL_ANDRA = { x: 2196, y: 3056, z: 0 };
/** Near-Reality: where a player who logs in at the shrine (with no fight left) is put, by the boat. */
const PIER = { x: 2213, y: 3056, z: 0 };
/** The shrine island is real map; a private area over it holds each fight (as the Inferno). */
const SHRINE = { minX: 2250, maxX: 2285, minY: 3055, maxY: 3085 };
/** Near-Reality: where the boat leaves the player, and where Zulrah first rises. */
const PLAYER_START = { x: 2268, y: 3068, z: 0 };

/** Zulrah's four places (Near-Reality): its south-west tile. */
const POSITION = {
  middle: { spawn: { x: 2266, y: 3073 } },
  south: { spawn: { x: 2266, y: 3062 } },
  west: { spawn: { x: 2257, y: 3071 } },
  east: { spawn: { x: 2276, y: 3072 } },
};

const ATTR = {
  /** Items Zul-Gwenwynig holds after a death at the shrine: [[id, amount], ...]. */
  RETRIEVAL: "zulrah:retrieval",
  KILLS: "zulrah:kills",
  BEST_TIME: "zulrah:best-ticks",
};

function loc(tile) {
  const { Location } = core();
  return new Location(tile.x, tile.y, tile.z ?? 0);
}

function inShrine(location) {
  return location.getZ() === 0
    && location.getX() >= SHRINE.minX && location.getX() <= SHRINE.maxX
    && location.getY() >= SHRINE.minY && location.getY() <= SHRINE.maxY;
}

function isZulrah(npc) {
  return npc?.isNpc?.() === true && FORM_IDS.has(npc.getId());
}

function later(key, ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(0, ticks), key, ticks <= 0);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  TaskManager.submit(task);
  return task;
}

/** Runs `action` every `ticks` ticks until it returns false, keyed to `key`. */
function repeat(key, ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), key, false);
    }
    execute() {
      if (action() === false) this.stop();
    }
  })();
  TaskManager.submit(task);
  return task;
}

/**
 * Near-Reality's sound effects. Delays are client cycles (20 ms), so an impact sound can wait
 * for its projectile.
 */
const SOUND = {
  RANGED: 213, RANGED_IMPACT: 224, MAGIC: 162, MAGIC_IMPACT: 163,
  CLOUD_SPIT: 796, CLOUD_LAND: 790, CLOUD_GONE: [795, 796],
  SNAKELING_SPIT: 788, SNAKELING_LAND: 1930, SNAKELING_MELEE: 794, SNAKELING_MAGIC: 224, SNAKELING_MAGIC_IMPACT: 794,
};

function sound(player, id, delay = 0) {
  player?.getPacketSender?.()?.sendSound?.(id, 1, delay);
}

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    new EndDialogue(1),
  ));
}

function npcSay(player, npcId, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, text),
    new EndDialogue(1),
  ));
}

/** A chatbox choice: options("Title?", "Yes.", onYes, "No.", onNo). */
function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY_GROUP = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 15;

/** Fades the screen out (or back in) with interface 174 and its fade script. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY_GROUP, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

module.exports = {
  bind, core, api,
  NPC, FORM_IDS, OBJECT, ACCESS_VARBIT, ACCESS_VALUE,
  ZUL_ANDRA, PIER, SHRINE, PLAYER_START, POSITION, ATTR, SOUND,
  loc, inShrine, isZulrah, later, repeat, sound, randomInt, statement, npcSay, options, fade,
};
