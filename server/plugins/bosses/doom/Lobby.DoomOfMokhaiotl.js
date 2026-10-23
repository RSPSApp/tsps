"use strict";

/**
 * The way in: the ruins' entrance, the lobby and the gap into the arena.
 *
 * Capture: the entrance (56613, (1310, 9533, 1)) fades out (script 948), puts the player in
 * the lobby at (1311, 9540) and fades back in. Jump-over on the gap (57289, (1310, 9557)) says
 * "You jump the gap..." as the arena loads (DoomRun).
 * Wiki: the Doom needs The Final Dawn. Its QuestRuntime completion state is the source of
 * truth; this plugin never writes 16663. 56616 (Pass-through) is accepted only when the real
 * quest answers quest:is-complete for the_final_dawn. Unfinished quest clicks (including the
 * ruins Inspect) fall through to the quest handler.
 * Guesses: the lobby's exit (56618, Pass-through) putting the player outside the entrance
 * with the same fade.
 */

const Shared = require("./Shared.DoomOfMokhaiotl");
const Run = require("./Run.DoomOfMokhaiotl");

const { OBJECT, TILES } = Shared;
const JUMP_ANIM = 12196;

function passThroughEntrance({ player, option }) {
  if (option !== "Pass-through") return false;
  const request = { player, key: "the_final_dawn", complete: false };
  Shared.api().emitCustomEvent("quest:is-complete", request);
  if (request.complete !== true) return false;
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
  onObject(api, [OBJECT.ENTRANCE, OBJECT.ENTRANCE_OPEN], passThroughEntrance);
  onObject(api, OBJECT.EXIT, leaveLobby);
  onObject(api, OBJECT.GAP, jumpGap);
};

Object.assign(module.exports, { onObject, passThroughEntrance, leaveLobby, jumpGap });
