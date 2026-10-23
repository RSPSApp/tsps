"use strict";

/**
 * The way in: the Chasm of Tears shortcut to the Archive's lobby, and the miniquest's opening
 * cutscene on the first visit.
 *
 * Captured (docs/fractured-archive.md):
 * - Reaching the Chasm of Tears after While Guthix Sleeps sets wgs_tfa_shortcut_unlocked
 *   (varbit 16354), which turns the Blocked cavity (multiloc 62542) into the Opening.
 * - Crawl-through: human_longcrawl and synth 2454 (four loops), a fade, and the lobby two ticks
 *   later.
 * - The first time, a cutscene instead: at the lobby's south end the camera sweeps the lobby,
 *   the player walks up to Armacus Selles, Eva Cashien and Ivy Sophista, and they talk (two
 *   lines are cut off and move on by themselves). It ends with a fade, the player in the lobby
 *   proper and tfa_miniquest (16426) at 2. "Into the Archive" is unlocked as it starts.
 * Estimates: the lobby's exit (the Opening at its south end) back to the Chasm, and where it
 * puts you.
 */

const path = require("path");
const fs = require("fs");
const Shared = require("./Shared.FracturedArchive");
const { createQuestScenes } = require("../../quests/QuestScenes");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "fractured-archive.json"), "utf8")).intro;

/** Saved: the shortcut, and the miniquest's stage as tfa_miniquest shows it (2 after the cutscene, 4 once in). */
const ATTR = {
  SHORTCUT: "fractured-archive:shortcut-unlocked",
  MINIQUEST: "fractured-archive:miniquest",
};
const STAGE = { NOT_STARTED: 0, INTRO_SEEN: 2, ENTERED: 4 };
/** Captured: the move two ticks after the crawl starts, and the fade back the tick after. */
const CRAWL_MOVE_TICKS = 2;
const CRAWL_LOOPS = 4;
const CRAWL_SOUND_DELAY = 4;
const CAMERA_RATES = { rate: 232, rate2: 100 };
/** The cutscene's last fade: the lobby two ticks after the end, the overlay three after that. */
const END_FADE_IN_TICKS = 1;

let Scenes = null;

function sendVarbits({ player }) {
  const sender = player.getPacketSender();
  sender.sendVarbit(Shared.id("varbit", "SHORTCUT"), player.getAttribute(ATTR.SHORTCUT) === true ? 1 : 0);
  sender.sendVarbit(Shared.id("varbit", "MINIQUEST"), Number(player.getAttribute(ATTR.MINIQUEST)) || 0);
}

/** The first post-quest arrival in the Chasm of Tears opens the shortcut. */
function unlockShortcut({ player }) {
  if (player.getAttribute(ATTR.SHORTCUT) === true) return;
  if (!Shared.inBox(player.getLocation(), Shared.CHASM) || !Shared.questComplete(player)) return;
  player.setAttribute(ATTR.SHORTCUT, true);
  player.getPacketSender().sendVarbit(Shared.id("varbit", "SHORTCUT"), 1);
}

/** The miniquest moves forward only ("fractured-archive:miniquest-stage" { player, stage }). */
function advanceMiniquest({ player, stage }) {
  if ((Number(player.getAttribute(ATTR.MINIQUEST)) || 0) >= stage) return;
  player.setAttribute(ATTR.MINIQUEST, stage);
  player.getPacketSender().sendVarbit(Shared.id("varbit", "MINIQUEST"), stage);
}

// ---------------------------------------------------------------- the shortcut

function crawlThrough(event) {
  const { player } = event;
  if (event.objectId !== Shared.id("loc", "CHASM_ENTRY")) return false;
  if (!Shared.questComplete(player)) return true;
  const { Animation } = Shared.core();
  player.getMovementQueue().reset().setBlockMovement(true);
  player.performAnimation(new Animation(Shared.id("seq", "LONGCRAWL")));
  player.getPacketSender().sendSoundEffect(Shared.SOUND.CRAWL, CRAWL_LOOPS, CRAWL_SOUND_DELAY);
  Shared.fade(player, true);
  Shared.later(player, CRAWL_MOVE_TICKS, () => {
    player.getMovementQueue().setBlockMovement(false);
    if ((Number(player.getAttribute(ATTR.MINIQUEST)) || 0) < STAGE.INTRO_SEEN) {
      playIntro(player);
      return;
    }
    player.moveTo(Shared.loc(Shared.TILE.LOBBY_ARRIVAL));
    Shared.later(player, 1, () => Shared.fade(player, false));
  });
  return true;
}

/** The lobby's Opening (Enter) back to the Chasm, through the quest's own way in (estimate). */
function leaveToChasm(event) {
  const { player } = event;
  if (event.objectId !== Shared.id("loc", "LOBBY_EXIT")) return false;
  const { Animation } = Shared.core();
  player.getMovementQueue().reset().setBlockMovement(true);
  player.performAnimation(new Animation(Shared.id("seq", "LONGCRAWL")));
  player.getPacketSender().sendSoundEffect(Shared.SOUND.CRAWL, CRAWL_LOOPS, CRAWL_SOUND_DELAY);
  Shared.fade(player, true);
  Shared.later(player, CRAWL_MOVE_TICKS, () => {
    player.getMovementQueue().setBlockMovement(false);
    Shared.api().emitCustomEvent("wgs:enter-chasm", { player, tile: Shared.loc(Shared.TILE.CHASM_EXIT) });
    Shared.later(player, 1, () => Shared.fade(player, false));
  });
  return true;
}

// ---------------------------------------------------------------- the opening cutscene

function camera(player, shot) {
  const sender = player.getPacketSender();
  if (shot.move) sender.sendCameraMoveTo(shot.move[0], shot.move[1], shot.move[2], CAMERA_RATES);
  if (shot.look) sender.sendCameraLookAt(shot.look[0], shot.look[1], shot.look[2], CAMERA_RATES);
  if (shot.glide) {
    sender.sendCameraMoveTo(shot.glide[0], shot.glide[1], shot.glide[2], { cycles: shot.cycles, easing: shot.easing, ignoreTerrain: true });
  }
}

/** Walks along captured waypoints (the movement queue's own steps, no pathfinding). */
function walkTo(mobile, ...waypoints) {
  const movement = mobile.getMovementQueue();
  movement.setBlockMovement(false).reset();
  for (const [x, y] of waypoints) movement.addSteps(Shared.loc({ x, y, z: 0 }));
}

function playIntro(player) {
  const { LOBBY, TILE } = Shared;
  const scene = Scenes.open(player, "fractured-archive-intro", [[LOBBY.minX, LOBBY.maxX, LOBBY.minY, LOBBY.maxY, LOBBY.z]]);
  scene.cast = {};
  player.moveTo(Shared.loc(TILE.INTRO_START));
  for (const actor of DATA.actors) {
    scene.cast[actor.npc] = Scenes.actor(scene, Shared.id("npc", actor.npc), [...actor.tile, 0], actor.face);
  }
  Scenes.controls(player, true, true);
  Shared.api().emitCustomEvent("music:unlock-track", { player, trackId: Shared.MUSIC.INTO_THE_ARCHIVE });
  player.getPacketSender().sendSong(Shared.MUSIC.INTO_THE_ARCHIVE);
  for (const shot of DATA.shots) Scenes.later(scene, shot.tick, () => camera(player, shot));
  Scenes.later(scene, 2, () => Shared.fade(player, false));
  Scenes.later(scene, 4, () => Shared.closeFade(player));
  Scenes.later(scene, DATA.walkTick, () => {
    walkTo(player, ...DATA.walk);
  });
  Scenes.later(scene, DATA.linesTick, () => {
    player.getMovementQueue().setBlockMovement(true);
    say(player, scene, 0);
  });
}

/** One line of the conversation, then the next once continued (or by itself when cut off). */
function say(player, scene, index) {
  if (Scenes.get(player) !== scene) return;
  const line = DATA.lines[index];
  if (!line) {
    leaveIntro(player, scene);
    return;
  }
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue, Animation } = Shared.core();
  const text = line.text.replace(/<player>/g, Shared.displayName(player));
  const next = () => say(player, scene, index + 1);
  const entry = line.player
    ? new PlayerDialogue(0, text, line.anim)
    : new NpcDialogue(0, Shared.id("npc", line.speaker), text, line.name, line.anim);
  if (line.actorAnim) scene.cast[line.actorAnim.npc]?.performAnimation(new Animation(Shared.id("seq", line.actorAnim.seq)));
  const chain = new DialogueChainBuilder().add(entry);
  if (!line.cutOffAfter) chain.add(new ActionDialogue(1, { execute: next }));
  player.getDialogueManager().startDialogues(chain);
  if (line.cutOffAfter) Scenes.later(scene, line.cutOffAfter, next);
}

/** Ivy bows, the three walk off, and the screen fades to the lobby (captured). */
function leaveIntro(player, scene) {
  const { Animation } = Shared.core();
  const exit = DATA.exit;
  player.getPacketSender().sendInterfaceRemoval();
  Scenes.later(scene, exit.bow.afterTicks, () => scene.cast[exit.bow.npc]?.performAnimation(new Animation(Shared.id("seq", "BOW"))));
  for (const walk of exit.walks) {
    const npc = scene.cast[walk.npc];
    if (npc) walkTo(npc, walk.to);
  }
  Scenes.later(scene, exit.fadeAfterTicks, () => Shared.fade(player, true));
  Scenes.later(scene, exit.endAfterTicks, () => Scenes.end(player, false));
}

/** The scene's end (or a logout during it): the lobby, the miniquest at 2. */
function endIntro(player, scene, logout) {
  if (scene?.name !== "fractured-archive-intro") return;
  advanceMiniquest({ player, stage: STAGE.INTRO_SEEN });
  player.getMovementQueue().setBlockMovement(false);
  player.moveTo(Shared.loc(Shared.TILE.INTRO_END));
  if (logout) return;
  Shared.later(player, END_FADE_IN_TICKS, () => Shared.fade(player, false));
  Shared.later(player, END_FADE_IN_TICKS + 2, () => Shared.closeFade(player));
}

module.exports = function registerEntry(api) {
  Shared.bind(api);
  Scenes = createQuestScenes(api, { onEnd: endIntro });
  api.persistAttribute(ATTR.SHORTCUT, false);
  api.persistAttribute(ATTR.MINIQUEST, 0);
  api.onPlayerLogin(sendVarbits);
  api.onPlayerMapSquareChange(unlockShortcut);
  api.onObjectInteraction("Opening", { "Crawl-through": crawlThrough, Enter: leaveToChasm });
  api.onCustomEvent("fractured-archive:miniquest-stage", advanceMiniquest);
};

Object.assign(module.exports, { ATTR, STAGE, crawlThrough, playIntro, unlockShortcut, advanceMiniquest, sendVarbits });
