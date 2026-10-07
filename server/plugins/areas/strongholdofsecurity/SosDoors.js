/**
 * The Stronghold's doors, as captured. Doors come in pairs with a gap between them; entering the
 * gap is free, leaving it asks a security question - unless that door is the one the player last
 * answered, or the whole Stronghold is done (Wiki). Any answer lets the player through: the
 * door gives its response, then opens.
 *
 * Passing a door: busy, the drag animation (4282) and sound 2858; a tick later the player is on
 * the other side; a tick after that busy clears and the door's appear animation (4283) plays.
 * After a question the door opens on the response's continue, the move landing that same tick.
 */
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { Sound } = require("../../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../../src/main/typescript/elvarg/game/Sounds");
const { MapObjects } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { ObjectDefinition } = require("../../../src/main/typescript/elvarg/game/definition/ObjectDefinition");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { ActionDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ActionDialogue");
const { DoorChatDialogue } = require("./SosDialogues");
const Data = require("./SosData");

const BUSY_VARBIT = 12393;
const DRAG = new Animation(4282);
const APPEAR = new Animation(4283);
const DOOR_SOUND = new Sound(2858, 1, 0, 0);
/** A wall door's side by its rotation: west, north, east, south. */
const SIDE = [[-1, 0], [0, 1], [1, 0], [0, -1]];
/** How far a door's partner can be. */
const PAIR_RANGE = 4;
const LAST_ANSWERED_ATTRIBUTE = "sos.last-answered-door";
const ASK = "To pass you must answer me this: ";

let pluginApi;
let TaskManager;

function bind(api) {
  pluginApi = api;
  TaskManager = api.getTaskManager();
}

const doorKey = (location) => `${location.getX()},${location.getY()},${location.getZ()}`;
const distance = (a, b) => Math.abs(a.getX() - b.getX()) + Math.abs(a.getY() - b.getY());

/** The tile on the far side of a door's wall. */
function across(door) {
  const at = door.getLocation();
  const [dx, dy] = SIDE[door.getFace() & 3];
  return new Location(at.getX() + dx, at.getY() + dy, at.getZ());
}

/**
 * The other door of the pair: the nearest door of the same name on the same axis along the passage
 * (some doors are double, two leaves side by side - those are not the pair).
 */
function partnerOf(door, name) {
  const at = door.getLocation();
  const [sx, sy] = SIDE[door.getFace() & 3];
  let best = null;
  for (let step = -PAIR_RANGE; step <= PAIR_RANGE; step++) {
    if (step === 0) continue;
    for (const object of MapObjects.mapObjects.get(MapObjects.getHash(at.getX() + sx * step, at.getY() + sy * step, at.getZ())) ?? []) {
      // Same axis: the pair may face the same way or be mirrored (a door and its _mirr).
      if (object.getType() !== 0 || (object.getFace() & 1) !== (door.getFace() & 1)) continue;
      if (ObjectDefinition.forId(object.getId())?.getName?.() !== name) continue;
      if (!best || distance(object.getLocation(), at) < distance(best.getLocation(), at)) best = object;
    }
  }
  return best;
}

/** Where passing `door` takes a player standing at `from`. */
function passage(door, from) {
  const doorTile = door.getLocation();
  return from.getX() === doorTile.getX() && from.getY() === doorTile.getY() ? across(door) : doorTile.clone();
}

/** Leaving the gap: the move takes the player away from the door's partner. */
function leavesGap(door, name, from, to) {
  const partner = partnerOf(door, name);
  return partner != null && distance(to, partner.getLocation()) > distance(from, partner.getLocation());
}

class PassTask extends Task {
  constructor(player, to, immediate) {
    super(1);
    this.player = player;
    this.to = to;
    this.step = immediate ? 1 : 0;
  }

  execute() {
    this.step++;
    if (this.step === 1) {
      this.player.moveTo(this.to);
    } else {
      this.stop();
      this.player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
      this.player.performAnimation(APPEAR);
      this.player.getMovementQueue().setBlockMovement(false);
    }
  }
}

/** Opens the door: the captured animations, sound and one-tile move. */
function pass(player, to, { immediate = false } = {}) {
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement(true);
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  player.performAnimation(DRAG);
  Sounds.sendSound(player, DOOR_SOUND);
  if (immediate) player.moveTo(to);
  TaskManager.submit(new PassTask(player, to, immediate));
}

function randomQuestion(random = Math.random) {
  const questions = Data.DATA.questions;
  return questions[Math.floor(random() * questions.length)];
}

/** A security question; whatever the answer, its response, then through the door. */
function ask(player, name, door, to, random = Math.random) {
  const question = randomQuestion(random);
  const floor = Data.FLOORS.find((entry) => entry.door === name);
  const say = (index, text) => new DoorChatDialogue(index, floor.doorHead, floor.doorSpeaker, text);
  const chain = new DialogueChainBuilder();
  chain.add(say(0, `${ASK}${question.question}`));
  chain.add(new ActionDialogue(1, { execute: () => {
    pluginApi.sendMultiChatboxPrompt(player, "Select an option", ...question.options.flatMap((option) => [option.text, () => {
      player.setAttribute(LAST_ANSWERED_ATTRIBUTE, doorKey(door.getLocation()));
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
        say(0, option.response),
        new ActionDialogue(1, { execute: () => {
          player.getPacketSender().sendInterfaceRemoval();
          pass(player, to, { immediate: true });
        } }),
      ));
    }]));
  } }));
  player.getDialogueManager().startDialogues(chain);
}

function open(event) {
  const { player, object } = event;
  const name = event.definition?.getName?.() ?? ObjectDefinition.forId(object.getId())?.getName?.();
  const from = player.getLocation();
  const to = passage(object, from);
  const answered = player.getAttribute(LAST_ANSWERED_ATTRIBUTE) === doorKey(object.getLocation());
  if (!answered && !Data.isComplete(player) && leavesGap(object, name, from, to)) {
    ask(player, name, object, to);
  } else {
    pass(player, to);
  }
  return true;
}

module.exports = { LAST_ANSWERED_ATTRIBUTE, bind, open, pass, ask, passage, partnerOf, leavesGap, across };
