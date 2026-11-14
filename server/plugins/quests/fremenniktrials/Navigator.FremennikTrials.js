/**
 * The Fremennik Trials: Navigator unit, Swensen the Navigator's maze (see State.FremennikTrials.js
 * for the shared context).
 *
 * The maze under Swensen's house is a 4x4 grid of rooms. Each room has four portals: the seven
 * correct ones (vt_mazeportal_1..7, 4150-4156, S-W-E-N-S-E-N) lead to the next lit room, every
 * other one (vt_mazeportal_wrong, 4157) to a random dark dead-end room, whose portals only lead to
 * more dead ends; the escape rope (4161) in each room takes the player back up.
 *
 * Live (rsprox 1002236 rev 242, 1001646 rev 241, 1002250):
 * - The entrance ladder (4158): seq 828 on arrival, the next tick down to 2631,10004 (1002236 t6717-6718).
 * - Portals: no seq, sound or message; the teleport one tick after the player reaches it (1002236
 *   t6720-6723). Correct portals land on the captured tiles; wrong ones on a random dead-end
 *   room's portal tile, which can be the room the player is in (1001646 t2792-2804).
 * - The escape rope: seq 828, the next tick up to 2647,3658, then Swensen's "Decided you could not
 *   solve my labyrinth..." lines start on their own (1001646 t2807-2811, data branch N8Oic4).
 * - The exit ladder (4160): seq 828, the next tick up to 2649,3661, then "Outerlander! You have
 *   finished my maze!" starts on its own and the trial passes on the final "Thanks!" continue,
 *   with no game message (1002236 t6761-6779, 1001646 t2860-2866, data branch TyXhH2).
 *
 * Ours: the start room's up-ladder (4159) has no capture and is treated like an escape rope.
 * Wiki only: the entrance ladder before accepting / after finishing plays the data's lines; the
 * house's two trapdoors (maze exits) say the data's "won't budge" messages.
 */
module.exports = function attachFremennikTrialsNavigator(api, ctx) {
  const { ObjectIdentifiers: O, Location, Animation } = api.core;
  const { T, FLAG, NPC } = ctx;

  const OFFER = "the-council-members-swensen-s-trial-talking-to-swensen";
  const AGAIN = "the-council-members-swensen-s-trial-talking-to-swensen-again";
  const DONE = "the-council-members-swensen-s-trial-talking-to-swensen-again-2";
  const INSIDE = "the-council-members-swensen-s-trial-whilst-inside-the-maze";
  const NO_MANNERS = "the-council-members-swensen-s-trial-attempting-to-climb-down-the-ladder-or-trapdoor-before-accepting-the-challenge";
  /** Transcript branches: the rope's lines, the finish, and "No way am I doing that maze again!". */
  const ROPE_BRANCH = "N8Oic4";
  const FINISH_BRANCH = "TyXhH2";
  const AGAIN_BRANCH = "kPL39A";
  const FINAL_LINE = "Thanks!";

  const SEQ_LADDER = 828; // human_reachforladder
  /** Ticks from the climb/portal to the teleport, and from the landing to Swensen's lines. */
  const TELEPORT_DELAY = 1;
  const DIALOGUE_DELAY = 1;

  const SWENSEN = [...NPC.SWENSEN][0];
  const MAZE_ENTRANCE = O.LADDER_32; // vt_mazeladdertopentrance, 2644,3657
  const START_LADDER = O.LADDER_33; // vt_mazeladderentrance, start room
  const EXIT_LADDER = O.LADDER_34; // vt_mazeladderexit, exit room
  const ESCAPE_ROPE = O.ESCAPE_ROPE; // vt_mazeladderescapeladder
  const WRONG_PORTAL = O.PORTAL_7; // vt_mazeportal_wrong
  const HOUSE_TRAPDOOR = O.TRAPDOOR;
  /** The house's maze-exit trapdoors (cache, loc 100). */
  const HOUSE_TRAPDOOR_TILES = [[2647, 3657], [2650, 3661]];

  const MAZE_START = new Location(2631, 10004, 0); // rsprox 1002236 t6718
  const ROPE_LANDING = new Location(2647, 3658, 0); // rsprox 1001646 t2810
  const EXIT_LANDING = new Location(2649, 3661, 0); // rsprox 1002236 t6762
  const MAZE_BOX = [2625, 2671, 9999, 10044, 0];

  /** Correct portal -> where it lands (rsprox 1002236, 1002250, 1001646: identical). */
  const CORRECT_PORTALS = new Map([
    [O.PORTAL, [2642, 10018]],
    [O.PORTAL_29, [2650, 10004]],
    [O.PORTAL_2, [2668, 10015]],
    [O.PORTAL_3, [2630, 10029]],
    [O.PORTAL_4, [2653, 10034]],
    [O.PORTAL_5, [2669, 10026]],
    [O.PORTAL_6, [2665, 10038]],
  ]);

  /**
   * The dark dead-end rooms' portal tiles (S, W, E, N; cache placements). A wrong portal lands on
   * one at random, which can be in the room the player is already in (rsprox 1001646 t2800).
   */
  const DEAD_END_TILES = [
    [2642, 10002], [2639, 10005], [2645, 10005], [2642, 10008], // B1
    [2664, 10001], [2661, 10004], [2667, 10004], [2664, 10007], // D1
    [2631, 10012], [2628, 10015], [2634, 10015], [2631, 10018], // A2
    [2653, 10012], [2650, 10015], [2656, 10015], [2653, 10018], // C2
    [2642, 10023], [2639, 10026], [2645, 10026], [2642, 10029], // B3
    [2654, 10023], [2651, 10026], [2657, 10026], [2654, 10029], // C3
    [2630, 10034], [2627, 10037], [2633, 10037], [2630, 10040], // A4
    [2642, 10036], [2639, 10039], [2645, 10039], [2642, 10042], // B4
  ];

  const MAZE_OBJECTS = new Set([MAZE_ENTRANCE, START_LADDER, EXIT_LADDER, ESCAPE_ROPE, WRONG_PORTAL, ...CORRECT_PORTALS.keys()]);

  /** Players between a climb/portal and its teleport (a second click then does nothing). */
  const moving = new WeakSet();

  const branch = (id) => (steps) => ctx.stepsById(id)(steps)[0]?.steps ?? [];
  const dropHello = (steps) => (steps[0]?.player === "Hello!" ? steps.slice(1) : steps);
  const state = (player) => ctx.trialState(player, T.NAVIGATOR);
  /** Finished the maze but not yet heard Swensen's "Of course outerlander!" (also old saves). */
  const finished = (player) => state(player) === 1 && ctx.flag(player, FLAG.NAVIGATOR);
  const inMaze = (player) => ctx.inBox(player, ...MAZE_BOX);

  function swensenVariant(player, stage) {
    if (state(player) === 2) return DONE;
    if (stage < ctx.STAGE_STARTED) return null;
    return state(player) === 1 ? AGAIN : OFFER;
  }

  /** "Ask about becoming a Fremennik" follows the player's "Hello!": the replay drops its own. */
  function swensenOffer(player) {
    const s = state(player);
    if (s === 2) return DONE;
    return { variant: s === 1 ? AGAIN : OFFER, select: dropHello };
  }

  function acceptChallenge(event, text) {
    const { player, npcId, pages } = event;
    if (!NPC.SWENSEN.has(npcId) || (text !== "yes" && text !== "yes.")) return;
    if (Array.isArray(pages) && !pages.some((entry) => entry.variants?.includes(OFFER))) return;
    if (state(player) === 0) ctx.setTrialState(player, T.NAVIGATOR, 1);
  }

  /** The maze branches only play when their climb happens. */
  function mazeCondition({ npcId, value }) {
    if (!NPC.SWENSEN.has(npcId)) return null;
    if (/trapdoor|escape rope|climbs (up|down) the (stairs|ladder)|climb down into the maze/.test(value)) return false;
    return null;
  }

  /** The trial passes as the player continues past "Thanks!" (rsprox 1002236 t6779). */
  function finishOnThanks(event) {
    const { player, npcId, step } = event;
    if (!player || !NPC.SWENSEN.has(npcId) || step?.player !== FINAL_LINE || !finished(player)) return;
    const previous = event.after;
    event.after = () => {
      if (typeof previous === "function") previous();
      if (!finished(player)) return;
      ctx.setFlag(player, FLAG.NAVIGATOR, false);
      ctx.completeTrial(player, T.NAVIGATOR);
    };
  }

  /** A player who finished but never heard Swensen out (relog, or an old save) hears it on a talk. */
  function talkAfterFinishing(event) {
    const { player, npcId, npc } = event;
    if (!NPC.SWENSEN.has(npcId) || event.clickType !== 1 || !finished(player)) return;
    event.handled = true;
    api.emitCustomEvent("npc-dialogue:start", { player, npcId, npc, variant: INSIDE, select: branch(FINISH_BRANCH) });
  }

  function climb(player, landing, then) {
    moving.add(player);
    player.performAnimation(new Animation(SEQ_LADDER));
    ctx.later(player, TELEPORT_DELAY, () => {
      moving.delete(player);
      player.moveTo(landing);
      if (then) ctx.later(player, DIALOGUE_DELAY, then);
    });
  }

  function enterMaze(player) {
    const s = state(player);
    if (s === 0) {
      ctx.play(player, SWENSEN, NO_MANNERS); // Wiki only
      return;
    }
    if (s === 2) {
      ctx.play(player, SWENSEN, DONE, branch(AGAIN_BRANCH)); // Wiki only
      return;
    }
    climb(player, MAZE_START);
  }

  function leaveByRope(player) {
    const lines = state(player) === 1 ? () => ctx.play(player, SWENSEN, INSIDE, branch(ROPE_BRANCH)) : null;
    climb(player, ROPE_LANDING, lines);
  }

  function leaveByExit(player) {
    if (state(player) !== 1) {
      climb(player, EXIT_LANDING);
      return;
    }
    // Saved at once, so a relog before "Thanks!" still lets Swensen finish it on a talk.
    ctx.setFlag(player, FLAG.NAVIGATOR, true);
    climb(player, EXIT_LANDING, () => ctx.play(player, SWENSEN, INSIDE, branch(FINISH_BRANCH)));
  }

  function usePortal(player, objectId) {
    const tile = CORRECT_PORTALS.get(objectId) ?? DEAD_END_TILES[Math.floor(Math.random() * DEAD_END_TILES.length)];
    moving.add(player);
    ctx.later(player, TELEPORT_DELAY, () => {
      moving.delete(player);
      player.moveTo(new Location(tile[0], tile[1], 0));
    });
  }

  function handleMazeObject(event) {
    const { player, objectId } = event;
    if (!MAZE_OBJECTS.has(objectId) || event.clickType !== 1) return;
    if (objectId !== MAZE_ENTRANCE && !inMaze(player)) return;
    event.handled = true;
    if (moving.has(player)) return;
    if (objectId === MAZE_ENTRANCE) enterMaze(player);
    else if (objectId === EXIT_LADDER) leaveByExit(player);
    else if (objectId === ESCAPE_ROPE || objectId === START_LADDER) leaveByRope(player);
    else usePortal(player, objectId);
  }

  /** The maze's exits only open from below (data "entering the maze", Wiki only). */
  function handleHouseTrapdoor(event) {
    const { player, objectId, location } = event;
    if (objectId !== HOUSE_TRAPDOOR || event.clickType !== 1 || (location?.z ?? 0) !== 0) return;
    if (!HOUSE_TRAPDOOR_TILES.some(([x, y]) => location?.x === x && location?.y === y)) return;
    event.handled = true;
    player.sendMessage("You try to open the trapdoor but it won't budge!");
    player.sendMessage("It looks like the trapdoor can only be opened from the other side.");
  }

  function forgetMoving({ player }) {
    if (player) moving.delete(player);
  }

  ctx.variant(NPC.SWENSEN, swensenVariant);
  ctx.offer(NPC.SWENSEN, swensenOffer);
  ctx.choice(acceptChallenge);
  ctx.condition(mazeCondition);
  ctx.line(finishOnThanks);
  api.onBeforeNpcInteraction(talkAfterFinishing);
  api.onBeforeObjectInteraction(handleMazeObject);
  api.onBeforeObjectInteraction(handleHouseTrapdoor);
  api.onPlayerLogout(forgetMoving);
};
