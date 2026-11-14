/**
 * Between a Rock...: Dondakan's scenes, as the user's rsprox capture BetweenARock.bin (rev 242.1) plays them.
 * Ticks count from the click that continues the line before each scene.
 *
 * - The kick (ticks 1567-1586): the chatbox closes and the flying-cannonballs loc goes for the
 *   player; Dondakan walks up the passage, kicks the rock (dwarfrock_dwarf_kickrock, dwarf_kickrock)
 *   and walks back while the camera watches; then the loc is back and the talk carries on.
 * - The golden cannonball (2041-2050): the same loc goes, the camera looks down the passage, the
 *   golden flight plays (gold_cannonball) and the usual one comes back.
 * - The cannon (3209-3295): the screen fades, the player sits in the cannon in the cutscene area
 *   (2057,4978, plane 3) with Dondakan's stand-in, their lines held in the chatbox and said
 *   overhead, then the zoomed-in heads (dwarf_rock_cannon, 112), the cannon lights, the screen fades
 *   and the player lands in the rock (see `fly`).
 * - Landing (3282-3295, 3728-3738, 5276-5285): on one of the recorded spots, flying three tiles
 *   (dwarfrock_cannon_flying, fly_and_land) under the camera, then getting up.
 * - The first landing's thoughts (3295-3343): the player's held lines, two message boxes, the
 *   Being's line with the room shaking, and the helmet's warning, which has a continue.
 * The lines are the transcript's (Between a Rock..., read from npc-dialogues.json); the capture gives
 * when, where and how each shows.
 */
const DATA = require("../data/between-a-rock.json");

const CANNONBALLS_LOC = "dwarf_cannon_balls_flight_multi";
const GOLD_CANNONBALL_LOC = "dwarf_cannon_balls_flight_gold";
const CANNONBALLS_TILE = [2822, 10167, 0];
const KICK = { walkTo: [[2823, 10169], [2823, 10172]], back: [[2824, 10171], [2824, 10168]], kickFace: [2822, 10173], home: [2824, 10168] };
const CANNON_AREA = [[2048, 2066, 4966, 4990, 3]];
const CANNON_SEAT = [2057, 4978, 3];
const FAKE_DONDAKAN = "dwarfrock_fake_dondakan";
const CANNON_INTERFACE = "dwarf_rock_cannon";
const SOUNDS = { kick: 1406, goldCannonball: 1408, lightCannon: 1411, flyAndLand: 1409, shakeRoom: 1405 };
const JINGLE_ROCK_CUTSCENE = 167;
const MUSIC_SILENCE = 147;
const EXPRESSIONS = {
  chathap1: 567, chathap2: 568, chatscared1: 596, chatshifty1: 592, chatcon1: 575, chatcon2: 576, chatshock1: 571, chatang2: 615,
};
/** cam_shake axis 0, random 10 (ticks 3328, 3381). */
const SHAKE = [0, 10, 0, 0];

let api;
let core;
let ctx;
let Scenes;
let ids;

function resolve() {
  if (ids) return ids;
  const cache = core.CacheDefinitions;
  const need = (value, name) => {
    if (!Number.isInteger(value)) throw new Error(`[BetweenARock] unknown ${name}`);
    return value;
  };
  const seq = (name) => need(cache.getSeqId(name), name);
  const component = (name) => need(cache.getComponentId(name), name);
  ids = {
    cannonballs: need(cache.getLocId(CANNONBALLS_LOC), CANNONBALLS_LOC),
    goldCannonball: need(cache.getLocId(GOLD_CANNONBALL_LOC), GOLD_CANNONBALL_LOC),
    fakeDondakan: need(cache.getNpcId(FAKE_DONDAKAN), FAKE_DONDAKAN),
    kick: seq("dwarfrock_dwarf_kickrock"),
    inCannon: seq("dwarfrock_cannon_incannon"),
    flying: seq("dwarfrock_cannon_flying"),
    getUp: seq("dwarfrock_cannon_fly_getup"),
    headAnim: seq("dwarf_rock_interface_anim"),
    fadeModel: seq("dwarf_rock_fade_out"),
    cannon: {
      group: component(`${CANNON_INTERFACE}:dwarf_rock_head`) >>> 16,
      head: component(`${CANNON_INTERFACE}:dwarf_rock_head`),
      npcName: component(`${CANNON_INTERFACE}:dwarf_rock_zoom_npcname`),
      npcText: component(`${CANNON_INTERFACE}:dwarf_rock_zoom_npctxt`),
      npcHead: component(`${CANNON_INTERFACE}:dwarf_rock_zoom_npchead`),
      playerText: component(`${CANNON_INTERFACE}:dwarf_rock_zoom_playertxt`),
      npcLayer: component(`${CANNON_INTERFACE}:dwarf_rock_zoom_npclayer`),
      playerLayer: component(`${CANNON_INTERFACE}:dwarf_rock_zoom_playerlayer`),
      fadeModelComponent: component(`${CANNON_INTERFACE}:dwarf_rock_fade_model`),
    },
  };
  return ids;
}

function cannonballsLoc(id) {
  const [x, y, z] = CANNONBALLS_TILE;
  return new core.GameObject(id, new core.Location(x, y, z), 10, 0, null);
}

function online(player) {
  return player.isRegistered?.() !== false;
}

function later(player, ticks, action) {
  Scenes.later(player, ticks, () => { if (online(player)) action(); });
}

function camera(player, [mx, my, mh], [lx, ly, lh], rate) {
  const motion = { rate, rate2: rate };
  player.getPacketSender().sendCameraMoveTo(mx, my, mh, motion).sendCameraLookAt(lx, ly, lh, motion);
}

function moveCamera(player, [x, y, h], rate) {
  player.getPacketSender().sendCameraMoveTo(x, y, h, { rate, rate2: rate });
}

function lookCamera(player, [x, y, h], rate) {
  player.getPacketSender().sendCameraLookAt(x, y, h, { rate, rate2: rate });
}

function closeChat(player) {
  player.getDialogueManager().reset?.();
  player.getPacketSender().sendInterfaceRemoval();
}

function walkPath(npc, path) {
  for (const [x, y] of path) npc.getMovementQueue().addSteps(new core.Location(x, y, npc.getLocation().getZ()));
}

/** Dondakan's kick (ticks 1567-1586); `resume` carries the talk on with "Did you see? Did you?". */
function kick(player, dondakan, resume) {
  const found = resolve();
  closeChat(player);
  player.getPacketSender().sendObjectRemoval(cannonballsLoc(found.cannonballs));
  player.getMovementQueue().reset().setBlockMovement(true);
  ctx.scenePlaying.add(player);
  const npc = dondakan && dondakan.isRegistered?.() !== false ? dondakan : null;
  npc?.getMovementQueue?.().reset();
  npc?.setMobileInteraction?.(null);
  later(player, 1, () => npc && walkPath(npc, KICK.walkTo));
  later(player, 6, () => camera(player, [2817, 10170, 500], [2827, 10175, 500], 10));
  later(player, 10, () => {
    if (!npc) return;
    npc.setPositionToFace(new core.Location(KICK.kickFace[0], KICK.kickFace[1], 0));
    npc.performAnimation(new core.Animation(found.kick, 30));
    player.getPacketSender().sendSound(SOUNDS.kick, 0, 0);
  });
  later(player, 14, () => npc && walkPath(npc, KICK.back));
  later(player, 18, () => player.getPacketSender().sendCameraReset());
  later(player, 19, () => {
    if (npc) {
      npc.getMovementQueue().reset();
      if (npc.getLocation().getX() !== KICK.home[0] || npc.getLocation().getY() !== KICK.home[1]) npc.moveTo(new core.Location(KICK.home[0], KICK.home[1], 0));
      npc.setPositionToFace(player.getLocation());
    }
    player.getPacketSender().sendObject(cannonballsLoc(found.cannonballs));
    player.getMovementQueue().setBlockMovement(false);
    ctx.scenePlaying.delete(player);
    resume();
  });
}

/** The golden cannonball fired (ticks 2041-2050); `resume` carries on with "Did... did... did you see that?". */
function goldCannonball(player, resume) {
  const found = resolve();
  closeChat(player);
  player.getPacketSender().sendObjectRemoval(cannonballsLoc(found.cannonballs));
  camera(player, [2822, 10162, 600], [2822, 10173, 400], 10);
  player.getMovementQueue().reset().setBlockMovement(true);
  ctx.scenePlaying.add(player);
  later(player, 3, () => moveCamera(player, [2822, 10170, 550], 3));
  later(player, 4, () => {
    player.getPacketSender().sendObject(cannonballsLoc(found.goldCannonball));
    player.getPacketSender().sendSound(SOUNDS.goldCannonball, 0, 0);
  });
  later(player, 8, () => {
    player.getPacketSender().sendObject(cannonballsLoc(found.cannonballs));
    player.getPacketSender().sendCameraReset();
  });
  later(player, 9, () => {
    player.getMovementQueue().setBlockMovement(false);
    ctx.scenePlaying.delete(player);
    resume();
  });
}

// ----------------------------------------------------------------------------
// Held chat lines: shown without "Click here to continue", as the capture's scenes show them.
// ----------------------------------------------------------------------------

function holdLine(player, show) {
  const { ActionDialogue, DialogueChainBuilder } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ActionDialogue(0, { execute: show }, true)));
}

function heldNpcLine(player, npcId, name, text, expression) {
  holdLine(player, () => new core.NpcDialogue(0, npcId, text, name, expression).sendHeld(player));
}

function heldPlayerLine(player, text, expression) {
  holdLine(player, () => {
    core.PlayerDialogue.send(player, text, expression);
    const continueUid = (217 << 16) | 5;
    player.getPacketSender().sendString("", continueUid).sendInterfaceFlagsRange(continueUid, -1, -1, 0);
  });
}

function heldStatement(player, text) {
  holdLine(player, () => core.StatementDialogue.send(player, text, false));
}

// ----------------------------------------------------------------------------
// The cannon
// ----------------------------------------------------------------------------

/** The scene's lines: the transcript's, from "Right, sitting comfortably?" to "That's what I'm afraid of.". */
function cannonLines() {
  return ctx.transcriptSteps("between-a-rock-returning-to-dondakan", "UI8Zoa", "jbZ7gu")
    .filter((step) => typeof step.player === "string" || step.type === "line");
}

function openCannon(player) {
  const found = resolve();
  player.getPacketSender().sendInterface(found.cannon.group);
}

/** The zoomed head: the player's (`npc` false) or Dondakan's, with the line. */
function cannonHead(player, npc, text) {
  const { cannon, headAnim, fakeDondakan } = resolve();
  const out = player.getPacketSender();
  if (npc) {
    out.sendString("Dondakan the Dwarf", cannon.npcName).sendString(text, cannon.npcText)
      .sendInterfaceDisplayState(cannon.npcLayer, false).sendInterfaceDisplayState(cannon.playerLayer, true)
      .sendNpcHeadOnInterface(fakeDondakan, cannon.npcHead).sendInterfaceAnimation(cannon.npcHead, EXPRESSIONS.chathap1);
  } else {
    out.sendInterfaceDisplayState(cannon.npcLayer, true).sendInterfaceDisplayState(cannon.playerLayer, false)
      .sendInterfaceAnimation(cannon.head, headAnim).sendPlayerHeadOnInterface(cannon.head).sendString(text, cannon.playerText);
  }
}

/**
 * The cannon scene, from the click on "Okay, here we go, let me have a look at those schematics..."
 * (tick 3209) to the landing (3282); `landed(player)` runs as the player is on the rock's floor.
 */
function cannon(player, landed) {
  const found = resolve();
  const lines = cannonLines();
  const say = (index) => lines[index] ?? {};
  const text = (index) => ctx.format(player, say(index).player ?? say(index).text ?? "");
  closeChat(player);
  Scenes.fade(player, true);
  Scenes.controls(player, true);
  ctx.scenePlaying.add(player);
  let stand = null;
  later(player, 3, () => {
    const scene = Scenes.open(player, "cannon", CANNON_AREA, { canTeleport: () => false });
    Scenes.place(player, CANNON_SEAT);
    Scenes.controls(player, true);
    const at = (ticks, action) => Scenes.later(scene, ticks - 3, () => { if (online(player)) action(); });
    at(7, () => {
      stand = Scenes.actor(scene, found.fakeDondakan, [2059, 4980, 3], [2059, 4979]);
      player.getPacketSender().sendSong(MUSIC_SILENCE).sendJingle(JINGLE_ROCK_CUTSCENE);
    });
    at(8, () => {
      player.performAnimation(new core.Animation(found.inCannon));
      Scenes.fade(player, false);
      camera(player, [2057, 4968, 500], [2057, 4978, 0], 100);
    });
    at(9, () => stand && Scenes.walk(stand, [2057, 4980, 3]));
    at(11, () => moveCamera(player, [2065, 4979, 600], 2));
    at(12, () => stand && Scenes.face(stand, [2057, 4978]));
    const npcLine = (index, expression) => {
      heldNpcLine(player, found.fakeDondakan, "Dondakan the Dwarf", text(index), expression);
      stand?.forceChat?.(text(index));
      player.sendMessage(`Dondakan the Dwarf: ${text(index)}`);
    };
    const playerLine = (index, expression) => {
      heldPlayerLine(player, text(index), expression);
      player.forceChat?.(text(index));
    };
    at(14, () => npcLine(0, EXPRESSIONS.chathap1));
    at(16, () => stand && (Scenes.walk(stand, [2059, 4980, 3]), Scenes.walk(stand, [2059, 4978, 3])));
    at(19, () => playerLine(1, EXPRESSIONS.chatscared1));
    at(22, () => stand && Scenes.face(stand, [2057, 4980]));
    at(23, () => npcLine(2, EXPRESSIONS.chathap2));
    at(25, () => stand && (Scenes.walk(stand, [2059, 4976, 3]), Scenes.walk(stand, [2055, 4976, 3])));
    at(29, () => closeChat(player));
    at(31, () => {
      moveCamera(player, [2060, 4972, 900], 1);
      stand && Scenes.walk(stand, [2055, 4978, 3]);
    });
    at(32, () => playerLine(3, EXPRESSIONS.chatshifty1));
    at(34, () => stand && Scenes.face(stand, [2057, 4978]));
    at(37, () => npcLine(4, EXPRESSIONS.chathap1));
    at(44, () => {
      player.forceChat?.(text(5));
      closeChat(player);
      cannonHead(player, false, text(5));
      openCannon(player);
    });
    at(51, () => {
      player.sendMessage(`Dondakan the Dwarf: ${text(6)}`);
      cannonHead(player, true, text(6));
    });
    at(60, () => {
      player.forceChat?.(text(7));
      cannonHead(player, false, text(7));
    });
    at(66, () => {
      player.getPacketSender().sendInterfaceAnimation(found.cannon.fadeModelComponent, found.fadeModel);
      player.getPacketSender().sendSound(SOUNDS.lightCannon, 0, 0);
    });
    at(67, () => {
      ctx.unlockMusic?.(player);
      player.getPacketSender().sendInterfaceRemoval();
    });
    at(69, () => Scenes.fade(player, true));
    at(73, () => {
      Scenes.end(player, false);
      fly(player, { fadeIn: true, getUpThen: landed });
    });
  });
}

/** Fired straight in ("Okay, here we go, hold on to your helmet!", tick 3724): the fade, then the landing. */
function launch(player, landed) {
  closeChat(player);
  Scenes.fade(player, true);
  Scenes.controls(player, true);
  ctx.scenePlaying.add(player);
  later(player, 4, () => fly(player, { fadeIn: true, getUpThen: landed }));
}

/**
 * On a landing spot: the flight three ticks later, the screen back the tick after, getting up five
 * ticks on and `getUpThen(player)` the tick after that (3728-3738).
 */
function fly(player, { fadeIn, getUpThen }) {
  const found = resolve();
  const spots = DATA.landings.spots;
  const spot = spots[Math.floor(Math.random() * spots.length)];
  const [ax, ay] = spot.at;
  const [tx, ty] = spot.to;
  player.moveTo(new core.Location(ax, ay, 0));
  Scenes.controls(player, true);
  ctx.scenePlaying.add(player);
  later(player, 3, () => {
    const { ForceMovement, Location } = core;
    player.setForceMovement(new ForceMovement(new Location(ax, ay, 0), new Location(tx - ax, ty - ay), 30, 130, spot.angle, -1));
    player.performAnimation(new core.Animation(found.flying, 10));
    player.getPacketSender().sendSound(SOUNDS.flyAndLand, 0, 0);
    const [[mx, my, mh], [lx, ly, lh]] = spot.camera;
    camera(player, [mx, my, mh], [lx, ly, lh], 232);
  });
  if (fadeIn) later(player, 4, () => Scenes.fade(player, false));
  later(player, 6, () => {
    player.setForceMovement(null);
    player.moveTo(new core.Location(tx, ty, 0));
  });
  later(player, 9, () => player.performAnimation(new core.Animation(found.getUp)));
  later(player, 10, () => {
    player.getPacketSender().sendCameraReset();
    Scenes.controls(player, false);
    ctx.scenePlaying.delete(player);
    getUpThen?.(player);
  });
}

/**
 * The first landing's thoughts (ticks 3295-3343), from "Where... where am I?" to the helmet's
 * warning; `done(player)` runs as that box is continued.
 */
function firstThoughts(player, done) {
  const steps = ctx.transcriptSteps("between-a-rock-returning-to-dondakan", "jbZ7gu", null);
  const [where, what, muffled, river, claustrophobic, think, inside, being, wasThat, head, warning] = steps;
  const out = player.getPacketSender();
  const text = (step) => ctx.format(player, step?.player ?? step?.text ?? "");
  const beingId = ctx.ids.arzinianBeing;
  player.getMovementQueue().reset().setBlockMovement(true);
  ctx.scenePlaying.add(player);
  heldPlayerLine(player, text(where), EXPRESSIONS.chatcon1);
  later(player, 4, () => heldPlayerLine(player, text(what), EXPRESSIONS.chatcon1));
  later(player, 8, () => heldStatement(player, text(muffled)));
  later(player, 12, () => heldPlayerLine(player, text(river), EXPRESSIONS.chatcon2));
  later(player, 19, () => heldStatement(player, text(claustrophobic)));
  later(player, 23, () => heldPlayerLine(player, text(think), EXPRESSIONS.chatcon1));
  later(player, 28, () => heldPlayerLine(player, text(inside), EXPRESSIONS.chatshock1));
  later(player, 33, () => {
    out.sendCameraShake(...SHAKE);
    out.sendSound(SOUNDS.shakeRoom, 0, 0);
    heldNpcLine(player, beingId, "Arzinian Being of Bordanzan", text(being), EXPRESSIONS.chatang2);
  });
  later(player, 39, () => {
    out.sendCameraReset();
    heldPlayerLine(player, text(wasThat), EXPRESSIONS.chatcon1);
  });
  later(player, 43, () => heldPlayerLine(player, text(head), EXPRESSIONS.chatcon2));
  later(player, 48, () => {
    player.getMovementQueue().setBlockMovement(false);
    ctx.scenePlaying.delete(player);
    warningBox(player, text(warning), done);
  });
}

/** The helmet's warning box, with its continue; `done` runs as it is continued. */
function warningBox(player, text, done) {
  const { ActionDialogue, DialogueChainBuilder, StatementDialogue } = core;
  // Held until it is continued, as live keeps the player busy there (busy 1 until tick 3350).
  player.getMovementQueue().reset().setBlockMovement(true);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new StatementDialogue(0, text))
    .add(new ActionDialogue(1, { execute: () => {
      player.getPacketSender().sendInterfaceRemoval();
      player.getMovementQueue().setBlockMovement(false);
      done?.(player);
    } })));
}

/** The Being's shake: cam_shake and demon_shakeroom with its line, the camera reset as the line goes. */
function shake(player) {
  player.getPacketSender().sendCameraShake(...SHAKE).sendSound(SOUNDS.shakeRoom, 0, 0);
}

function attach(pluginApi, context) {
  api = pluginApi;
  core = api.core;
  ctx = context;
  Scenes = context.Scenes;
}

module.exports = { attach, kick, goldCannonball, cannon, launch, fly, firstThoughts, warningBox, shake, resolve, KICK, CANNONBALLS_TILE };
