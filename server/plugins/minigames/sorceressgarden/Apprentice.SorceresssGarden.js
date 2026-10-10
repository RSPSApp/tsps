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
 * The gates (12617 winter, 12639 autumn, 12719 spring, 11987 summer) are already walkable
 * in the cache, so opening one only checks the level; a low-level player who walks through
 * anyway is turned back by the maze's Area.postEnter. Entry is checked against the current
 * (boosted) Thieving level, per the Wiki.
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

let api;
let core;

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
  event.player.sendMessage("You open the gate.");
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
  drinkFromFountain,
  _setApi(value) {
    api = value;
  },
};
