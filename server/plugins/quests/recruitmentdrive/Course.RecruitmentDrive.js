// Recruitment Drive's training grounds: the run of five rooms, Sir Tiffy's trip in, the exit doors
// between rooms, failing, quitting and the finish (docs/quests/recruitment-drive/README.md).
//
// rsprox capture RecruitmentDrive.bin (revision 242.1; the user's whole-quest run, eleven attempts):
//   - A run is five of the seven rooms in a random order; Sir Kuam's room (room 3, Sir Leye) is in
//     every five-room run (and the Wiki: "you must defeat Sir Leye in one of the five").
//   - Sir Tiffy's trip in: the "Jolly good show!" line is continued, the screen fades out (948
//     [0,255,0,0,50]) and three held lines follow 2, 5 and 8 ticks later; the player is moved to the
//     first room 11 ticks after the continue and the room's observer speaks 2 ticks after that,
//     with the fade in (ticks 335-350, 489-502).
//   - Passing a room's exit door: on the tick the player stands in the doorway the door becomes
//     inviswall 38848 with rd_door_inactive 7375 swung open on the far tile, door_open 62 plays with
//     the room's jingle after the silence track, and the player steps through; the door is put back
//     2 ticks later and the player is moved to the next room the tick after that, whose observer
//     speaks 2 ticks later (ticks 621-627, 959-966, 1971-1979).
//   - Failing: the observer's line is closed, the screen fades out, 3 ticks later every rd_ side
//     varbit is cleared, the room's items leave the inventory and worn slots, and the player is put
//     at 2996,3375 by Sir Tiffy, who says his two failure lines 5 ticks after that with the fade in
//     (ticks 452-468, 551-568, 898-916).
//   - Quitting through a room's entrance portal: "Quit the Training Grounds?" YES|NO; YES clears and
//     moves the player the tick after, without a fade, and Sir Tiffy's failure lines follow 5 ticks
//     later (ticks 1776-1789, 2945-2954).
//   - Passing the fifth room: its observer's "all five" line is closed, the screen fades out, 3
//     ticks later the player is by Sir Tiffy and 4 ticks after that the finishing conversation plays
//     with the fade in (ticks 3584-3600).
//   - Inside, minimap_state (6719) is 2; it goes back to 0 as the closing conversation by Sir Tiffy
//     ends (ticks 339, 468, 3593).
const { loadTranscripts, startTranscript } = require("../QuestRuntime");

const PAGE = "Recruitment Drive";
const ROOMS_PER_RUN = 5;
const KUAM_ROOM = 3;
const FALADOR_RETURN = { x: 2996, y: 3375, z: 0 };
const GROUNDS = { minX: 2430, maxX: 2500, minY: 4925, maxY: 4990 };

const FADE_UID = (161 << 16) | 1;
const FADE_INTERFACE = 174;
const FADE_SCRIPT = 948;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;
const SPOKE_TO_TIFFY_VARBIT = 692; // rd_spoke_to_tiffy, set with "Jolly good show!" (tick 335)
const INVISWALL = 38848;
const DOOR_INACTIVE = 7375; // rd_door_inactive
const DOOR_OPEN_SOUND = 62;
const SILENCE_TRACK = 147;

// Every side varbit of rd_main's three varps (657 rd_main and 692 rd_spoke_to_tiffy are kept).
// A room's exit door clears them all but the rooms passed (659-665) and the two talk flags,
// rd_room6_hint1 (690) and rd_room1_intro_chat (691), which last the run (ticks 2278, 3309).
const PASSED_VARBITS = [659, 660, 661, 662, 663, 664, 665];
const RUN_VARBITS = [...PASSED_VARBITS, 690, 691];
const SIDE_VARBITS = [658, 659, 660, 661, 662, 663, 664, 665, 666, 667, 670, 671, 672, 673, 674, 675,
  676, 677, 678, 679, 680, 681, 682, 683, 684, 685, 686, 687, 688, 689, 690, 691];

/**
 * The seven rooms, by the cache's room numbers (rd_roomN_complete 659-665): landing tile, the exit
 * door and its open state (loc_add_change in the capture), the entrance portal and the jingle the
 * door plays.
 */
const ROOMS = [
  { number: 1, key: "spishyus", npc: 4679, landing: [2490, 4972], door: { id: 7274, x: 2472, y: 4972, face: 0, open: [2471, 4972, 1] }, portal: 7272, jingle: 160 },
  { number: 2, key: "table", npc: 4680, landing: [2460, 4979], door: { id: 7302, x: 2447, y: 4979, face: 0, open: [2446, 4979, 1] }, portal: 7288, jingle: 155 },
  { number: 3, key: "kuam", npc: 4681, landing: [2455, 4964], door: { id: 7317, x: 2463, y: 4963, face: 2, open: [2464, 4963, 3] }, portal: 7315, jingle: 162 },
  { number: 4, key: "tinley", npc: 4683, landing: [2471, 4956], door: { id: 7320, x: 2480, y: 4956, face: 2, open: [2481, 4956, 3] }, portal: 7318, jingle: 161 },
  { number: 5, key: "ren", npc: 4684, landing: [2439, 4956], door: { id: 7323, x: 2446, y: 4956, face: 2, open: [2447, 4956, 3] }, portal: 7321, jingle: 159 },
  { number: 6, key: "cheevers", npc: 4685, landing: [2467, 4940], door: { id: 7326, x: 2478, y: 4940, face: 2, open: [2479, 4940, 3] }, portal: 7324, jingle: 131 },
  { number: 7, key: "hynn", npc: 4686, landing: [2451, 4935], door: { id: 7354, x: 2452, y: 4943, face: 1, open: [2452, 4944, 2] }, portal: 7352, jingle: 156 },
].map((room) => ({ ...room, completeVarbit: 658 + room.number }));

/** Five rooms in a random order, Sir Kuam's among them. `random` returns [0, 1). */
function pickRooms(random = Math.random) {
  const others = ROOMS.map((room) => room.number).filter((number) => number !== KUAM_ROOM);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const order = [KUAM_ROOM, ...others.slice(0, ROOMS_PER_RUN - 1)];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function inGrounds(location) {
  const x = location.getX(), y = location.getY();
  return location.getZ() === 0 && x >= GROUNDS.minX && x <= GROUNDS.maxX && y >= GROUNDS.minY && y <= GROUNDS.maxY;
}

module.exports = function createCourse(api, hooks) {
  const { ActionDialogue, CountdownTask, DialogueChainBuilder, GameObject, Location, NpcDialogue, PlayerDialogue,
    StatementDialogue, TaskManager } = api.core;
  const roomByNumber = new Map(ROOMS.map((room) => [room.number, room]));
  const roomByDoor = new Map(ROOMS.map((room) => [room.door.id, room]));
  const roomByPortal = new Map(ROOMS.map((room) => [room.portal, room]));
  /** Each room's unit: { enter(player), clear(player) }. */
  const units = new Map();
  /** Player -> { order, index, done, phase } while they are in the grounds. */
  const runs = new WeakMap();
  /** Players the course itself is moving, so leaving the grounds area does not abandon the run. */
  const moving = new WeakSet();
  /** The tick token of each player's latest course sequence; a newer one stops the older. */
  const sequences = new WeakMap();

  function variant(name) {
    return loadTranscripts(api)[PAGE].variants[name];
  }

  /** The text of a transcript step: a condition's lines are found by its id. */
  function findCondition(steps, id) {
    for (const step of steps ?? []) {
      if (step.type === "condition" && step.id === id) return step.steps ?? [];
      const nested = findCondition(step.steps, id) ?? (step.options ?? []).map((option) => findCondition(option.steps, id)).find(Boolean);
      if (nested) return nested;
    }
    return null;
  }

  function lines(steps) {
    return (steps ?? []).filter((step) => step.type === "line" || typeof step.player === "string")
      .map((step) => (typeof step.player === "string" ? { player: step.player } : { speaker: step.speaker, text: step.text }));
  }

  function named(player, text) {
    return String(text).replace(/\[player name\]/gi, player.getDisplayName?.() ?? player.getUsername());
  }

  function later(player, ticks, fn) {
    const token = sequences.get(player);
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() === false || sequences.get(player) !== token) return;
      fn();
    }));
  }

  /** Starts a new course sequence for the player, ending any older one still counting. */
  function sequence(player) {
    sequences.set(player, {});
  }

  /** Runs fn once the player's chatbox (a conversation or a menu) is clear. */
  /** Runs fn once the chatbox is clear, unless a newer course sequence started meanwhile. */
  function whenChatClear(player, fn) {
    const { MultiChatboxPrompt } = api.core;
    const token = sequences.get(player);
    const check = () => {
      if (player.isRegistered?.() === false || sequences.get(player) !== token) return;
      const prompt = MultiChatboxPrompt?.getPending?.(player) ?? null;
      if (player.getDialogueManager?.()?.isActive?.() === true || prompt !== null) {
        TaskManager.submit(new CountdownTask(player, 1, check));
        return;
      }
      fn();
    };
    TaskManager.submit(new CountdownTask(player, 1, check));
  }

  /**
   * Lines with a continue: [{ npc, text } | { player: text } | { statement: text }], then `then`
   * once the last is continued.
   */
  function say(player, entries, then) {
    const chain = new DialogueChainBuilder();
    let index = 0;
    for (const entry of entries) {
      // `onShow` runs as its line opens (a varbit live sets with the line).
      if (typeof entry.onShow === "function") {
        const onShow = entry.onShow;
        chain.add(new ActionDialogue(index++, { execute: () => {
          onShow();
          player.getDialogueManager().advance();
        } }));
      }
      if (entry.statement !== undefined) chain.add(new StatementDialogue(index++, named(player, entry.statement)));
      else if (entry.player !== undefined) chain.add(new PlayerDialogue(index++, named(player, entry.player)));
      else chain.add(new NpcDialogue(index++, entry.npc, named(player, entry.text)));
    }
    chain.add(new ActionDialogue(index++, { execute: () => {
      player.getDialogueManager().reset();
      player.getPacketSender().sendInterfaceRemoval();
      then?.();
    } }));
    player.getDialogueManager().startDialogues(chain);
  }

  /** One NPC line with its continue held back (live's timed lines), left showing until replaced. */
  function heldLine(player, npcId, text) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => new NpcDialogue(0, npcId, named(player, text)).sendHeld(player) }, true)));
  }

  function closeChat(player) {
    player.getDialogueManager().reset();
    player.getPacketSender().sendInterfaceRemoval();
  }

  function fade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, FADE_INTERFACE, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }

  function closeFade(player) {
    player.getPacketSender().closeSubInterface(FADE_UID);
  }

  function teleport(player, tile) {
    moving.add(player);
    try {
      player.moveTo(new Location(tile[0] ?? tile.x, tile[1] ?? tile.y, tile[2] ?? tile.z ?? 0));
    } finally {
      moving.delete(player);
    }
  }

  function run(player) {
    return runs.get(player) ?? null;
  }

  function currentRoom(player) {
    const state = run(player);
    return state ? roomByNumber.get(state.order[state.index]) : null;
  }

  /** Whether the player is doing this room of their run now (not failing out of it). */
  function inRoom(player, number) {
    const state = run(player);
    return !!state && state.phase === "room" && state.order[state.index] === number;
  }

  function isPassed(player, number) {
    return run(player)?.done.has(number) === true;
  }

  function passedCount(player) {
    return run(player)?.done.size ?? 0;
  }

  function isLastRoom(player) {
    const state = run(player);
    return !!state && state.index === state.order.length - 1;
  }

  function clearItems(player) {
    player.getInventory().resetItems().refreshItems();
    const equipment = player.getEquipment();
    if (equipment.getValidItems().length > 0) {
      equipment.resetItems().refreshItems();
      api.core.EquipPacketListener?.resetWeapon?.(player, true);
      player.getUpdateFlag?.().flag?.(api.core.Flag.APPEARANCE);
    }
  }

  function clearVarbits(player, ids = SIDE_VARBITS) {
    const sender = player.getPacketSender();
    for (const id of ids) if (sender.getVarbit(id) !== 0) sender.sendVarbit(id, 0);
  }

  function clearUnits(player) {
    for (const unit of units.values()) unit.clear?.(player);
  }

  /** Leaves the grounds' state behind without moving the player (logout, death, teleported away). */
  function abandon(player) {
    if (!runs.has(player)) return;
    runs.delete(player);
    sequence(player);
    clearUnits(player);
    clearVarbits(player);
    closeFade(player);
    player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, 0);
    player.getMovementQueue().setBlockMovement(false);
  }

  function enterRoom(player) {
    const room = currentRoom(player);
    const state = run(player);
    if (!room || !state) return;
    state.phase = "room";
    units.get(room.number)?.enter(player, room);
  }

  /**
   * Sir Tiffy's trip in, from the continue of "Jolly good show!" (live times the three lines
   * that follow; none has a continue).
   */
  function travel(player, order = pickRooms(hooks.random)) {
    const lines = travelLines();
    const state = { order: [...order], index: 0, done: new Set(), phase: "travel" };
    runs.set(player, state);
    sequence(player);
    clearUnits(player);
    clearVarbits(player);
    player.getMovementQueue().reset().setBlockMovement(true);
    closeChat(player);
    fade(player, true);
    later(player, 2, () => {
      player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF);
      heldLine(player, hooks.tiffyNpcId, lines[0]);
    });
    later(player, 5, () => heldLine(player, hooks.tiffyNpcId, lines[1]));
    later(player, 8, () => heldLine(player, hooks.tiffyNpcId, lines[2]));
    later(player, 11, () => {
      closeChat(player);
      teleport(player, currentRoom(player).landing);
    });
    later(player, 13, () => {
      player.getMovementQueue().setBlockMovement(false);
      fade(player, false);
      whenChatClear(player, () => closeFade(player));
      enterRoom(player);
    });
  }

  /** "Here we go! ...", "Oops, ...", "And... Here we are! ..." from the JI9IMB branch. */
  function travelLines() {
    const steps = findCondition(variant(hooks.tiffyStartVariant), hooks.travelConditionId) ?? [];
    return lines(steps).slice(1).map((line) => line.text);
  }

  /**
   * A room's puzzle is solved: its rd_roomN_complete varbit is set. Returns how many rooms of the
   * run are passed, this one included.
   */
  function passRoom(player, number) {
    const state = run(player);
    if (!state || state.done.has(number)) return state?.done.size ?? 0;
    state.done.add(number);
    player.getPacketSender().sendVarbit(roomByNumber.get(number).completeVarbit, 1);
    return state.done.size;
  }

  /**
   * The observer's lines for a solved room, by how many rooms of the run are passed (Sir Kuam's
   * three branches; Lady Table says the same at tick 2770/2772 and 3584).
   */
  function passLines(count) {
    const steps = variant(hooks.kuamDefeatVariant);
    const id = count >= ROOMS_PER_RUN ? hooks.passConditionIds[2] : count === ROOMS_PER_RUN - 1 ? hooks.passConditionIds[1] : hooks.passConditionIds[0];
    return lines(findCondition(steps, id)).map((line) => line.text);
  }

  /** The observer says the passed-room lines; the fifth room's lead straight to Falador. */
  function sayPassed(player, npcId, count) {
    const texts = passLines(count);
    say(player, texts.map((text) => ({ npc: npcId, text })), () => {
      if (count >= ROOMS_PER_RUN) finish(player);
    });
  }

  /** "No... I am very sorry. ..." (every observer's failure line, Lady Table's Hsk37b). */
  function failLine() {
    return lines(findCondition(variant(hooks.tableTouchVariant), hooks.tableFailConditionId))[0].text;
  }

  /**
   * The room is failed: `entries` (the observer's lines) show first, then the fade and the trip
   * back. With `heldTicks` the line has no continue and the fade follows that many ticks later
   * (Sir Ren's riddle, ticks 452-455).
   */
  function fail(player, entries = [], { heldTicks = 0 } = {}) {
    const state = run(player);
    if (!state || state.phase === "failing") return;
    state.phase = "failing";
    sequence(player);
    const out = () => {
      fade(player, true);
      later(player, 3, () => returnToTiffy(player, true));
    };
    if (entries.length === 0) {
      out();
    } else if (heldTicks > 0) {
      heldLine(player, entries[0].npc, entries[0].text);
      later(player, heldTicks, () => {
        closeChat(player);
        out();
      });
    } else {
      say(player, entries);
      whenChatClear(player, out);
    }
  }

  /** The tick the player is put back by Sir Tiffy after failing or quitting. */
  function returnToTiffy(player, faded) {
    runs.delete(player);
    clearUnits(player);
    clearVarbits(player);
    clearItems(player);
    teleport(player, [FALADOR_RETURN.x, FALADOR_RETURN.y, FALADOR_RETURN.z]);
    later(player, 5, () => {
      if (faded) fade(player, false);
      startTranscript(api, player, hooks.tiffyNpcId, PAGE, hooks.tiffyFailVariant);
      whenChatClear(player, () => {
        closeFade(player);
        player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, 0);
      });
    });
  }

  /** A room's entrance portal: quitting the training grounds. */
  /** Whether the player is in a room, not already on the way out (failing, finishing, a door). */
  function canLeave(player) {
    const phase = run(player)?.phase;
    return phase === "room" || phase === "arriving";
  }

  function quitPrompt(player) {
    if (!canLeave(player)) return;
    api.sendMultiChatboxPrompt(player, "Quit the Training Grounds?",
      "YES", () => quit(player),
      "NO", () => {});
  }

  function quit(player) {
    const state = run(player);
    if (!state || !canLeave(player)) return;
    state.phase = "failing";
    sequence(player);
    later(player, 1, () => returnToTiffy(player, false));
  }

  /** The fifth room's last line is closed: the fade, the trip back and Sir Tiffy's welcome. */
  function finish(player) {
    const state = run(player);
    if (!state) return;
    state.phase = "finishing";
    sequence(player);
    // Saved now: closing or leaving Sir Tiffy's welcome must not cost the five passes.
    hooks.onAllPassed?.(player);
    fade(player, true);
    later(player, 3, () => {
      // The run ends before the move, so leaving the grounds is not taken for abandoning it.
      runs.delete(player);
      clearUnits(player);
      clearItems(player);
      teleport(player, [FALADOR_RETURN.x, FALADOR_RETURN.y, FALADOR_RETURN.z]);
    });
    later(player, 7, () => {
      clearVarbits(player, SIDE_VARBITS.filter((id) => !PASSED_VARBITS.includes(id)));
      player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, 0);
      fade(player, false);
      hooks.onFinish(player);
      whenChatClear(player, () => closeFade(player));
    });
  }

  function doorObject(id, x, y, face) {
    return new GameObject(id, new Location(x, y, 0), 0, face, null);
  }

  /** The room's exit door, opened from the doorway once the room is solved. */
  function exitDoor(player, room) {
    const state = run(player);
    if (!state || state.phase !== "room") return;
    state.phase = "door";
    sequence(player);
    const { door } = room;
    const sender = player.getPacketSender();
    const [openX, openY, openFace] = door.open;
    sender.sendObject(doorObject(INVISWALL, door.x, door.y, door.face));
    sender.sendObject(doorObject(DOOR_INACTIVE, openX, openY, openFace));
    sender.sendSound(DOOR_OPEN_SOUND, 255, 0);
    sender.sendSong(SILENCE_TRACK).sendJingle(room.jingle, 0);
    hooks.ObstacleRunner.run({ player }, [{ walk: [[openX, openY]] }]);
    later(player, 1, () => {
      units.get(room.number)?.clear(player);
      clearItems(player);
      clearVarbits(player, SIDE_VARBITS.filter((id) => !RUN_VARBITS.includes(id)));
    });
    later(player, 2, () => {
      sender.sendObjectRemoval(doorObject(DOOR_INACTIVE, openX, openY, openFace));
      sender.sendObject(doorObject(door.id, door.x, door.y, door.face));
    });
    later(player, 3, () => {
      if (state.index >= state.order.length - 1) {
        // Ours: no capture ends a run in a room whose exit door closes it (Sir Ren's, Miss
        // Cheevers' or Sir Spishyus'); it ends as the observers' fifth-room line does.
        state.phase = "room";
        finish(player);
        return;
      }
      state.index++;
      teleport(player, currentRoom(player).landing);
      state.phase = "arriving";
      later(player, 2, () => enterRoom(player));
    });
  }

  function handleDoor({ player, objectId }) {
    const room = roomByDoor.get(objectId);
    if (!room || !run(player)) return false;
    if (!inRoom(player, room.number)) return true;
    if (!isPassed(player, room.number)) {
      if (units.get(room.number)?.lockedDoor?.(player) === true) return true;
      player.sendMessage("You have not completed this room's puzzle yet.");
      return true;
    }
    if (units.get(room.number)?.canOpen?.(player) === false) {
      player.sendMessage("You have not completed this room's puzzle yet.");
      return true;
    }
    units.get(room.number)?.openingDoor?.(player);
    exitDoor(player, room);
    return true;
  }

  function handlePortal({ player, objectId }) {
    if (!roomByPortal.has(objectId) || !run(player)) return false;
    quitPrompt(player);
    return true;
  }

  class Grounds extends api.core.Area {
    postLeave(mobile) {
      if (!mobile.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (moving.has(player) || !runs.has(player)) return;
      // Ours: a run left any other way (a home teleport) ends there, its items with it.
      clearItems(player);
      abandon(player);
    }
  }

  function register() {
    api.registerArea(new Grounds([new api.core.Boundary(GROUNDS.minX, GROUNDS.maxX, GROUNDS.minY, GROUNDS.maxY, 0)]));
    api.onObjectInteraction("Door", { Open: handleDoor });
    api.onObjectInteraction("Portal", { Use: handlePortal });
    api.onItemOnObject(handleKeyOnDoor);
  }

  /** Using an item on an exit door is opening it (Miss Cheevers' key, tick 2265). */
  function handleKeyOnDoor(event) {
    if (!roomByDoor.has(event.objectId) || !run(event.player)) return;
    event.handled = handleDoor(event);
  }

  return {
    PAGE, ROOMS, ROOMS_PER_RUN, FALADOR_RETURN, roomByNumber,
    variant, findCondition, lines, named, later, whenChatClear, say, heldLine, closeChat, fade, closeFade,
    run, currentRoom, inRoom, isPassed, passedCount, isLastRoom, passRoom, passLines, sayPassed, failLine, fail,
    travel, quit, abandon, finish, clearItems, inGrounds, teleport,
    defineRoom(number, unit) { units.set(number, unit); },
    register,
    SPOKE_TO_TIFFY_VARBIT, MINIMAP_STATE_VARBIT,
  };
};

module.exports.pickRooms = pickRooms;
module.exports.ROOMS = ROOMS;
module.exports.inGrounds = inGrounds;
