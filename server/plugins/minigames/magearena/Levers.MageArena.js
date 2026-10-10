"use strict";

/**
 * The Mage Arena levers and sparkling pools. The bank pair (5959 outside, 5960 inside) is
 * already handled by plugins/areas/Wilderness.plugin.js, so only the arena pair and the pools
 * live here (https://oldschool.runescape.wiki/w/Lever_(Mage_Arena), /w/Sparkling_pool).
 * Every step, tile and id below is from rsprox captures (rev 235-238):
 *
 * - 9706, the broken-down house's lever, teleports into the arena corridor (3105, 3951);
 *   9707, the arena-side lever, back out to (3105, 3956). A tick after arrival the player
 *   pulls (2710, the lever 2711) with "You pull the lever...", casts the next tick (714 with
 *   graphic 111 at height 92, sound 200) and lands three ticks later with the second line.
 *   Teleblock still stops them, as it does every lever.
 * - 2878 (statue chamber) and 2879 (bank) first show a message box; only "Click here to
 *   continue" goes on (a box closed any other way does nothing). A tick later the player jumps
 *   onto the pool's centre (741, an exact move over cycles 20-35), splashes two ticks after
 *   that (graphic 68, 804, sound 1658) and lands beside the counterpart pool two ticks later.
 *   Pools are not a teleport, so teleblock does not bar them.
 */
const ObstacleRunner = require("../../skills/agility/ObstacleRunner");

const ARENA_LEVER_TO_INSIDE = 9706;
const ARENA_LEVER_TO_OUTSIDE = 9707;
const BANK_POOL = 2878;
const CHAMBER_POOL = 2879;

const LEVERS = Object.freeze({
  [ARENA_LEVER_TO_INSIDE]: Object.freeze({ to: [3105, 3951], landed: "... and get teleported into the arena!" }),
  [ARENA_LEVER_TO_OUTSIDE]: Object.freeze({ to: [3105, 3956], landed: "... and get teleported out of the arena!" }),
});
const POOL_DESTINATIONS = Object.freeze({
  [BANK_POOL]: Object.freeze([2509, 4689]),
  [CHAMBER_POOL]: Object.freeze([2542, 4718]),
});

const PULL_MESSAGE = "You pull the lever...";
const POOL_MESSAGE = "You step into the pool of sparkling water. You feel energy rush through your veins.";

const ANIM = Object.freeze({ PULL: 2710, LEVER: 2711, CAST: 714, JUMP: 741, VANISH: 804 });
const GFX = Object.freeze({ CAST: 111, SPLASH: 68 });
const SOUND = Object.freeze({ CAST: 200, SPLASH: 1658 });

let api;
let core;

function leverSteps(lever, objectTile) {
  return [
    { face: objectTile },
    { wait: 1 },
    { anim: ANIM.PULL },
    { objAnim: ANIM.LEVER },
    { msg: PULL_MESSAGE },
    { wait: 1 },
    { anim: ANIM.CAST },
    { gfx: GFX.CAST, height: 92 },
    { sound: SOUND.CAST },
    { wait: 3 },
    { tele: [lever.to[0], lever.to[1], 0] },
    { msg: lever.landed },
  ];
}

function pullLever(event) {
  const lever = LEVERS[event.objectId];
  if (!lever) return false;
  const { player, object } = event;
  if (ObstacleRunner.isBusy(player)) return true;
  if (!core.TeleportHandler.checkReqs(player, new core.Location(lever.to[0], lever.to[1], 0), Infinity)) return true;
  ObstacleRunner.run({ player, object }, leverSteps(lever, [event.location.x, event.location.y]));
  return true;
}

/** The pool's 3x3 footprint starts on its own tile; the jump lands on the centre. */
function poolSteps(objectId, poolTile) {
  const to = POOL_DESTINATIONS[objectId];
  return [
    { wait: 1 },
    { move: [poolTile[0] + 1, poolTile[1] + 1], anim: ANIM.JUMP, delay: 5, speed: [20, 35], ticks: 0 },
    { wait: 2 },
    { gfx: GFX.SPLASH, delay: 20 },
    { anim: ANIM.VANISH },
    { sound: SOUND.SPLASH },
    { wait: 2 },
    { tele: [to[0], to[1], 0] },
  ];
}

function stepIntoPool(event) {
  const { player, objectId, object } = event;
  if (!POOL_DESTINATIONS[objectId]) return false;
  if (ObstacleRunner.isBusy(player)) return true;
  const poolTile = [event.location.x, event.location.y];
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, POOL_MESSAGE),
    new ActionDialogue(1, { execute: () => {
      player.getPacketSender().sendInterfaceRemoval();
      ObstacleRunner.run({ player, object }, poolSteps(objectId, poolTile));
    } }),
  ));
  return true;
}

module.exports = function registerLevers(pluginApi) {
  api = pluginApi;
  core = api.core;
  ObstacleRunner.init(api);
  api.onObjectInteraction("Lever", { Pull: pullLever });
  api.onObjectInteraction("Sparkling pool", { "Step-into": stepIntoPool });
};

Object.assign(module.exports, {
  _test: {
    LEVERS,
    POOL_DESTINATIONS,
    PULL_MESSAGE,
    POOL_MESSAGE,
    leverSteps,
    poolSteps,
    pullLever,
    stepIntoPool,
    setApi(value) { api = value; },
    setCore(value) { core = value; },
  },
});
