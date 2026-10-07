"use strict";

/**
 * The way in: the ruins' entrance, the lobby and the gap into the arena.
 *
 * Capture: the entrance (56613, (1310, 9533, 1)) fades out (script 948), puts the player in
 * the lobby at (1311, 9540) and fades back in. Jump-over on the gap (57289, (1310, 9557)) says
 * "You jump the gap..." as the arena loads (DoomRun).
 * Wiki: the Doom needs The Final Dawn; here it is open to everyone, as Zulrah is, so the
 * entrance gets the quest's completed value (varbit 16663 = 68, which turns it into 56616,
 * Pass-through) in the ruins.
 * Guesses: the lobby's exit (56618, Pass-through) putting the player outside the entrance
 * with the same fade.
 */

const Shared = require("./DoomShared");
const Run = require("./DoomRun");

const { OBJECT, TILES } = Shared;
const JUMP_ANIM = 12196;

/** In the ruins, the entrance shows as The Final Dawn left it. */
function openEntrance({ player }) {
  player.getPacketSender().sendVarbit(Shared.VARBIT.FINAL_DAWN, Shared.FINAL_DAWN_COMPLETE);
}

function passThroughEntrance({ player }) {
  Shared.fadeMove(player, () => player.moveTo(Shared.loc(TILES.LOBBY)));
  return true;
}

function leaveLobby({ player }) {
  Shared.fadeMove(player, () => player.moveTo(Shared.loc(TILES.RUINS)));
  return true;
}

/** From the lobby, over the gap; inside, the gap's cache id is the way back out. */
function jumpGap({ player }) {
  const run = Run.runOf(player);
  if (run) {
    run.askToExit();
    return true;
  }
  // Capture: the jump (12196) and "You jump the gap..." as the screen fades.
  player.performAnimation(new (Shared.core().Animation)(JUMP_ANIM));
  Shared.statement(player, "You jump the gap...");
  Shared.fadeMove(player, () => Run.start(player));
  return true;
}

/** One hook per id, so the multiloc entrance answers whatever it shows as. */
function onObject(api, ids, handler) {
  const wanted = new Set([].concat(ids));
  api.onObjectInteraction((event) => {
    if (event.handled || !Number.isInteger(event.clickType)) return;
    const id = event.objectId ?? event.object?.getId?.();
    if (!wanted.has(id)) return;
    event.option = event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "";
    if (handler(event) !== false) event.handled = true;
  });
}

module.exports = function registerDoomLobby(api) {
  Shared.bind(api);
  api.onZoneEnter({ ...Shared.RUINS, levels: [0, 1] }, openEntrance);
  api.onPlayerLogin(openEntrance);
  onObject(api, [OBJECT.ENTRANCE, OBJECT.ENTRANCE_OPEN], passThroughEntrance);
  onObject(api, OBJECT.EXIT, leaveLobby);
  onObject(api, OBJECT.GAP, jumpGap);
};

Object.assign(module.exports, { onObject, openEntrance, passThroughEntrance, leaveLobby, jumpGap });
