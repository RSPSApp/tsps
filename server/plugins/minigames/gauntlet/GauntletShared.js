"use strict";

/**
 * The Gauntlet: shared state, ids and small helpers every unit uses.
 *
 * Wiki: https://oldschool.runescape.wiki/w/The_Gauntlet
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

// The lobby beneath Prifddinas, where runs start and end, and the way up to the city.
const LOBBY = { x: 3032, y: 6127, z: 1 };
const LOBBY_ZONE = { minX: 3016, maxX: 3047, minY: 6112, maxY: 6143, levels: [1] };
// Beside the Gauntlet Portal (36081) in Prifddinas.
const PRIFDDINAS = { x: 3227, y: 6114, z: 0 };
// Every Gauntlet room is played on this plane.
const PLANE = 1;

/** Ticks to prepare before the Hunllef (Wiki: 10 minutes, Corrupted 7 minutes 30). */
const PREP_TICKS = { regular: 1000, corrupted: 750 };

const NPC = { BRYN: 9020 };

const OBJECT = {
  ENTRANCE: "The Gauntlet",
  PORTAL: "Gauntlet Portal",
  TELEPORT_PLATFORM: "Teleport Platform",
  BARRIER: "Barrier",
  // The in-maze exit platforms; the lobby's one (36082) only channels you up to the city.
  EXIT_PLATFORMS: [36062, 35965],
  LOBBY_PLATFORM: 36082,
};

const VARP = {
  // Shows "Enter-corrupted" on the entrance once a Gauntlet has been completed.
  COMPLETED: 2353,
};

const VARBIT = {
  // Turns the barrier from Pass to Escape and the timer into "Final Encounter".
  BOSS_PHASE: 9177,
  // Swaps the world map for the maze map.
  MAZE_MAP: 9178,
  // The reward chest is waiting.
  REWARD: 9179,
  // Lit rooms, one bit each: 9240 + gridY * 7 + gridX.
  ROOM_LIT_FIRST: 9240,
  CURRENT_ROOM_X: 9289,
  CURRENT_ROOM_Y: 9290,
  START_ROOM: 9291,
  CORRUPTED: 9292,
};

const INTERFACE = {
  TIMER: 637,
};

const SCRIPT = {
  // timer_start(ticks): counts down on the overlay.
  TIMER_START: 2914,
  // "Final Encounter" on the overlay.
  TIMER_BOSS: 2916,
  FADE: 948,
};

const OVERLAY_HUD_UID = (161 << 16) | 8;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY_GROUP = 174;
const FADE_CYCLES = 15;

function loc(tile) {
  const { Location } = core();
  return new Location(tile.x, tile.y, tile.z);
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

/** Fades the screen out (or back in) with interface 174 and its fade script. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY_GROUP, 1, {
    postScripts: [{ scriptId: SCRIPT.FADE, args }],
  });
}

/** Fades out, runs `action` while the screen is black, then fades back in. */
function fadeMove(player, action) {
  fade(player, true);
  later(player, 2, () => {
    action();
    fade(player, false);
  });
}

function isEmptyHanded(player) {
  return player.getInventory().getValidItems().length === 0
    && player.getEquipment().getValidItems().length === 0;
}

/** Everything carried goes: nothing made in the Gauntlet leaves it. */
function clearItems(player) {
  player.getInventory().resetItems().refreshItems();
  player.getEquipment().resetItems().refreshItems();
}

module.exports = {
  bind, core, api,
  LOBBY, LOBBY_ZONE, PRIFDDINAS, PLANE, PREP_TICKS, NPC, OBJECT, VARP, VARBIT, INTERFACE, SCRIPT,
  OVERLAY_HUD_UID,
  loc, later, repeat, statement, npcSay, options, fade, fadeMove, isEmptyHanded, clearItems,
};
