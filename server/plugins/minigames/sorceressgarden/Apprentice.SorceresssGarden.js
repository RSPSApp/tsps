"use strict";

/**
 * Getting in and out of the Sorceress's Garden, and the gates into each maze.
 *
 * The Apprentice (cache NPC 1808, spawned at 3321,3139) teleports the player into the
 * central garden after Prince Ali Rescue is complete; below that she refuses with the
 * Wiki's line. The Wiki also requires having asked Osman about the garden first, which
 * this plugin folds into the quest requirement (noted in the PR).
 *
 * Talk-to plays her Wiki transcript (npc-dialogues.json): this unit picks the variant by
 * whether she has teleported the player before, answers its Osman and follower conditions
 * and casts after "Okay, here goes!..." (first visit) or for the "teleported" action. Her
 * right-click Teleport only works once she has (the transcript's right-click variant
 * refuses before that). A follower stops the teleport with the Wiki's pet line; the only
 * follower state readable from another plugin is the Pets plugin's `pets:current`
 * attribute. Drinking from the fountain (12941) sends the player back to her house.
 *
 * The cast is from rsprox captures (rev 227): she says "Senventior Disthinte Molesko!" (sic)
 * overhead at once; a tick later she casts Curse at the player (108 on her, projectile 109,
 * 110 on the player, area sounds 127 and 126), and three ticks after that the player lands
 * on (2912, 5474).
 *
 * The gates (12617 winter, 12639 autumn, 12719 spring, 11987 summer) are wall locs whose
 * clipping seals each maze, so opening one checks the level and then swings it open the
 * way Doors.plugin.js opens mapped doors: deregister the closed wall and register its
 * nameless open variant (closed id + 1) one quarter-turn on, with the same 500-tick
 * auto-close and region-load reapply. Entry is checked against the current (boosted)
 * Thieving level, per the Wiki; a low-level player who gets in anyway is turned back by
 * the maze's Area.postEnter.
 */

const Gardens = require("./Gardens.SorceresssGarden");

const {
  APPRENTICE_TILE,
  FOUNTAIN_ID,
  PLANE,
  SEASONS,
  meetsLevel,
  seasonForGate,
} = Gardens;

const APPRENTICE_NAME = "Apprentice";
/** The Pets plugin's follower attribute; the pet NPC is stored there while following. */
const PET_ATTRIBUTE = "pets:current";
/** Persisted flag: the Apprentice has cast the teleport at least once. */
const TELEPORTED_ATTRIBUTE = "sorceress-s-garden:teleported";
const PAR_QUEST_KEY = "prince_ali_rescue";

const REFUSAL_LINE = "I can't do that now, I'm far too busy sweeping.";
const PET_LINE =
  "Oh, I'm sorry, could you pick up your follower first? I'm really not sure that I could teleport the both of you.";
/** As OSRS says it overhead; the transcript's chat line spells it "Seventior". */
const SPELL_LINE = "Senventior Disthinte Molesko!";
const TRANSCRIPT_SPELL_LINE = "Seventior Disthinte Molesko!";
const FIRST_VISIT_LAST_LINE = "Okay, here goes! Remember, to return, just drink from the fountain.";
const APPRENTICE_ID = 1808;
const VARIANT = Object.freeze({
  FIRST: "standard-dialogue-if-the-player-has-not-been-teleported-to-the-sorceress-s-garden-before",
  AGAIN: "standard-dialogue-if-the-player-has-been-teleported-to-the-sorceress-s-garden-before",
});
const LANDING = Object.freeze({ x: 2912, y: 5474 });
const CURSE = Object.freeze({ CAST: 108, PROJECTILE: 109, IMPACT: 110, SOUND_CAST: 127, SOUND_IMPACT: 126 });
const GATE_IDS = Object.values(SEASONS).map((season) => season.gateId);

/**
 * Each closed gate's open variant is the next cache id (same model, rotated, unnamed and
 * optionless); verified for all four with scripts/dump-loc.ts. Doors.plugin.js's wall
 * transform opens a closed shape-0 wall by turning it one quarter and stepping it one
 * tile, and its gates swing shut again after 500 untouched ticks.
 */
const GATE_OPEN_ID_OFFSET = 1;
const COORD_OFFSETS = Object.freeze([[-1, 0], [0, 1], [1, 0], [0, -1]]);
const GATE_OPEN_TICKS = 500;

let api;
let core;

/** key -> { closed, open } for every gate this plugin has swung open. */
const openGates = new Map();

const apprenticeHouse = () => new core.Location(APPRENTICE_TILE.x, APPRENTICE_TILE.y, PLANE);
const thievingLevel = (player) => player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);

function questComplete(player, key) {
  const request = { player, key, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function isUnlocked(player) {
  return questComplete(player, PAR_QUEST_KEY);
}

/** Only the Pets plugin's following pet is visible from here; other followers are not. */
function hasFollower(player) {
  const pet = player.getAttribute?.(PET_ATTRIBUTE);
  return pet?.isRegistered?.() === true;
}

function conversation(player, npcId, lines, onDone) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue } = core;
  const builder = new DialogueChainBuilder();
  lines.forEach(([speaker, text], index) => {
    builder.add(
      speaker === "npc" ? new NpcDialogue(index, npcId, text) : new PlayerDialogue(index, text)
    );
  });
  if (onDone) builder.add(new ActionDialogue(lines.length, { execute: onDone }));
  player.getDialogueManager().startDialogues(builder);
}

/** Runs `action` after `ticks` game ticks. */
function later(ticks, action) {
  const { Task } = core;
  api.getTaskManager().submit(new (class extends Task {
    constructor() {
      super(ticks);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** The captured cast: overhead line now, Curse a tick later, the landing three after that. */
function teleportIn(player, npc) {
  player.getPacketSender().sendInterfaceRemoval();
  npc?.forceChat?.(SPELL_LINE);
  npc?.setPositionToFace?.(player.getLocation());
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement(true);
  later(1, () => {
    const at = player.getLocation();
    if (npc) {
      npc.performGraphic(new core.Graphic(CURSE.CAST, 0, 92));
      player.getPacketSender().sendProjectile(npc.getLocation(), at, 0, 100, CURSE.PROJECTILE, 31, 31, player, 61, 16, 128);
    }
    player.performGraphic(new core.Graphic(CURSE.IMPACT, 100, 124));
    player.getPacketSender()
      .sendAreaSound(CURSE.SOUND_CAST, at.getX(), at.getY(), at.getZ())
      .sendAreaSound(CURSE.SOUND_IMPACT, at.getX(), at.getY(), at.getZ());
    later(3, () => {
      player.getMovementQueue().setBlockMovement(false);
      player.moveTo(new core.Location(LANDING.x, LANDING.y, PLANE));
      player.setAttribute(TELEPORTED_ATTRIBUTE, true);
    });
  });
}

function isApprentice(event) {
  return event?.player != null && event.npcId === APPRENTICE_ID;
}

function selectVariant(event) {
  if (!isApprentice(event)) return null;
  return event.player.getAttribute(TELEPORTED_ATTRIBUTE) ? VARIANT.AGAIN : VARIANT.FIRST;
}

function answerCondition(event) {
  if (!isApprentice(event)) return null;
  const text = String(event.text ?? "");
  if (text.startsWith("If the player has not talked to Osman")) return !isUnlocked(event.player);
  if (text.startsWith("If the player has talked to Osman")) return isUnlocked(event.player);
  if (text.startsWith("If the player does not have a pet following")) return !hasFollower(event.player);
  if (text.startsWith("If the player has a pet following")) return hasFollower(event.player);
  return null;
}

/** The transcript's spell line is said overhead instead; the first visit casts after its last line. */
function handleLine(event) {
  if (!isApprentice(event)) return;
  if (event.text === TRANSCRIPT_SPELL_LINE) {
    event.skip = true;
  } else if (event.text === FIRST_VISIT_LAST_LINE) {
    event.after = () => teleportIn(event.player, event.npc);
  }
}

/** "The player is teleported to the Sorceress's Garden" (returning visits). */
function handleAction(event) {
  if (!isApprentice(event) || event.handled || event.action !== "teleport") return;
  event.handled = true;
  event.end = true;
  teleportIn(event.player, event.npc);
}

function teleportByApprentice(event) {
  const { player, npc, npcId } = event;
  if (!player.getAttribute(TELEPORTED_ATTRIBUTE) || !isUnlocked(player)) {
    conversation(player, npcId, [["npc", REFUSAL_LINE]]);
    return;
  }
  if (hasFollower(player)) {
    conversation(player, npcId, [["npc", PET_LINE]]);
    return;
  }
  teleportIn(player, npc);
}

function openGate(event) {
  const season = seasonForGate(event.objectId);
  if (!season) return false;
  if (!meetsLevel(season, thievingLevel(event.player))) {
    event.player.sendMessage(`You need a Thieving level of ${season.level} to enter this garden.`);
    return;
  }
  const location = event.object?.getLocation?.() ?? gateLocation(event.location);
  if (location && !openGates.has(gateKey(event.objectId, location))) {
    swingGateOpen(event.object, event.objectId, location);
  }
  event.player.sendMessage("You open the gate.");
}

function gateLocation(location) {
  if (!Number.isInteger(location?.x) || !Number.isInteger(location?.y)) return null;
  return new core.Location(location.x, location.y, location.z ?? PLANE);
}

function gateKey(objectId, location) {
  return `${objectId}:${location.getX()},${location.getY()},${location.getZ()}`;
}

function regionIdOf(location) {
  return ((location.getX() >> 6) << 8) | (location.getY() >> 6);
}

/** Deregisters the closed wall and registers the open variant, per Doors.plugin.js. */
function swingGateOpen(object, objectId, location) {
  if (!object) return;
  const type = Number(object.getType?.() ?? 0);
  const rotation = Number(object.getFace?.() ?? 0) & 0x3;
  const openRotation = (rotation + 1) & 0x3;
  const [dx, dy] = COORD_OFFSETS[type === 9 ? ((openRotation + 1) & 0x3) : openRotation];
  const open = new core.GameObject(
    objectId + GATE_OPEN_ID_OFFSET,
    new core.Location(location.getX() + dx, location.getY() + dy, location.getZ()),
    type,
    openRotation,
    null
  );
  core.ObjectManager.register(open, true);
  core.ObjectManager.deregister(object, true);
  openGates.set(gateKey(objectId, location), { closed: object, open });
  later(GATE_OPEN_TICKS, () => swingGateShut(gateKey(objectId, location)));
}

function swingGateShut(key) {
  const state = openGates.get(key);
  if (!state) return;
  openGates.delete(key);
  core.ObjectManager.deregister(state.open, true);
  core.ObjectManager.register(state.closed, true);
}

/** Scene reloads resend the map's closed gate, so put the open one back. */
function reapplyOpenGates({ regionId }) {
  for (const state of openGates.values()) {
    if (regionIdOf(state.open.getLocation()) !== regionId) continue;
    core.MapObjects.remove(state.closed);
    core.MapObjects.add(state.open);
  }
}

function drinkFromFountain(event) {
  if (event.objectId !== FOUNTAIN_ID) return false;
  event.player.moveTo(apprenticeHouse());
}

module.exports = function registerApprentice(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.persistAttribute(TELEPORTED_ATTRIBUTE);
  api.onNpcInteraction(APPRENTICE_NAME, { Teleport: teleportByApprentice });
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectClick(GATE_IDS, 1, openGate);
  api.onRegionLoaded(reapplyOpenGates);
  api.onObjectInteraction("Fountain", { "Drink-from": drinkFromFountain });
};

module.exports._test = {
  setCore(value) {
    core = value;
  },
  REFUSAL_LINE,
  PET_LINE,
  SPELL_LINE,
  TELEPORTED_ATTRIBUTE,
  PET_ATTRIBUTE,
  isUnlocked,
  hasFollower,
  LANDING,
  teleportIn,
  selectVariant,
  answerCondition,
  handleLine,
  handleAction,
  teleportByApprentice,
  openGate,
  swingGateOpen,
  swingGateShut,
  reapplyOpenGates,
  gateKey,
  openGates,
  drinkFromFountain,
  _setApi(value) {
    api = value;
  },
};
