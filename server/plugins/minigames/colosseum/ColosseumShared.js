"use strict";

/**
 * Fortis Colosseum: shared ids, tiles and small helpers every unit uses.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Fortis_Colosseum
 * docs/fortis-colosseum.md records the live capture these ids and tiles come from.
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

/** Where the entrance in the city puts you: the lobby under the Colosseum (capture). */
const LOBBY = { x: 1799, y: 9506, z: 0 };
/** The lobby's stairs back up lead here, where the capture stood to use the entrance (1796, 3106). */
const CITY = { x: 1795, y: 3106, z: 0 };
/** Death puts you back in the lobby beside Minimus (capture). */
const LOBBY_RESPAWN = { x: 1804, y: 9508, z: 0 };

/**
 * The arena floor in the city's map square. It is walled in (no city tile reaches it), so a
 * private area over it keeps every run apart without copying the map.
 */
const ARENA = { minX: 1806, maxX: 1842, minY: 3088, maxY: 3128 };
/** Where each run starts, and where Minimus and the seated Sol Heredit wait (capture). */
const ARENA_START = { x: 1824, y: 3094 };
const MINIMUS_START = { x: 1824, y: 3106 };
/** Where the player walks to on arrival: a tile short of Minimus (capture). */
const ARRIVAL_WALK = { x: 1824, y: 3104 };
const SOL_SEAT = { x: 1823, y: 3123 };

const NPC = {
  MINIMUS_LOBBY: 12807,
  MINIMUS_ARENA: 12808,
  SOL_SEATED: 12827,
  SOL_HEREDIT: 12821,
};

const OBJECT = {
  CITY_ENTRANCE: "Colosseum entrance",
  LOBBY_STAIRS: "Stairs",
  TUNNEL: "Entrance",
  BANK_CHEST: 50748,
  /** Blocks the tiles under the seated Sol Heredit (capture). */
  SOL_SEAT_BLOCKER: 50703,
};

const VARP = {
  WAVE_START_TIME: 4133,
  WAVE_DAMAGE_TAKEN: 4134,
  LAST_MODIFIER_GLORY: 4135,
};

const VARBIT = {
  /** Set once Minimus has given his introduction (capture). */
  INTRO: 9807,
  /** The modifier picked on the intermission screen, 1-3 (capture). */
  SELECTED_MODIFIER: 9788,
  HIGHEST_WAVE: 11410,
  MULTIWAY: 4605,
};

const INTERFACE = {
  INTERMISSION: 865,
};

const COMPONENT = {
  MOD_BUTTONS: [15, 16, 17],
  CONFIRM: 41,
};

const SCRIPT = {
  INTERMISSION_INIT: 4931,
  /** Redraws the three modifier buttons, highlighting varbit 9788's (args: the offer, waves done). */
  INTERMISSION_BUTTONS: 4934,
  /** Redraws the Continue button for the selection (arg: waves done). */
  INTERMISSION_CONTINUE: 4932,
  FADE: 948,
};

/** Glory titles (Wiki): the best Glory earned decides how Minimus greets you. */
const RANKS = [
  [20000, "Grand Champion"], [16000, "Champion"], [12000, "Hero"], [8000, "Gladiator"],
  [5000, "Challenger"], [2000, "Brawler"], [0, "Rookie"],
];
const BANK_GLORY = 2000;

const FINAL_WAVE = 12;
const WAVES_BEFORE_SOL = 11;

const ATTR = {
  INTRO: "colosseum:intro",
  GLORY: "colosseum:glory",
  NO_WARNING: "colosseum:skip-warning",
};

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_CYCLES = 50;

function loc({ x, y, z = 0 }) {
  const { Location } = core();
  return new Location(x, y, z);
}

function inArena(location) {
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === 0 && x >= ARENA.minX && x <= ARENA.maxX && y >= ARENA.minY && y <= ARENA.maxY;
}

function gloryOf(player) {
  return Math.max(0, Math.trunc(Number(player.getAttribute(ATTR.GLORY)) || 0));
}

function rankOf(player) {
  const glory = gloryOf(player);
  return RANKS.find(([required]) => glory >= required)[1];
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

/** A chatbox choice: options("Title?", "Yes.", onYes, "No.", onNo). */
function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

/** Plays one of Minimus's transcript variants (data/definitions/npc-dialogues.json). */
function minimusSays(player, variant, npc = null) {
  const request = { player, npc, npcId: NPC.MINIMUS_LOBBY, variant, handled: false };
  api().emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: SCRIPT.FADE, args }],
  });
}

/** Fades out, runs `action` two ticks later while the screen is black, then fades back in. */
function fadeMove(player, action) {
  fade(player, true);
  later(player, 2, () => {
    action();
    fade(player, false);
  });
}

module.exports = {
  bind, core, api,
  LOBBY, CITY, LOBBY_RESPAWN, ARENA, ARENA_START, MINIMUS_START, ARRIVAL_WALK, SOL_SEAT,
  NPC, OBJECT, VARP, VARBIT, INTERFACE, COMPONENT, SCRIPT, RANKS, BANK_GLORY,
  FINAL_WAVE, WAVES_BEFORE_SOL, ATTR,
  loc, inArena, gloryOf, rankOf, later, repeat, statement, options, minimusSays, fade, fadeMove,
};
