/**
 * Respawn points (https://oldschool.runescape.wiki/w/Spawning#Respawn_point): where a player who
 * died, or whose ring of life, escape crystal or ring of returning took them away, reappears.
 * Lumbridge (the world's spawn) unless an NPC changed it:
 * - Sir Tiffy Cashien: Falador, after Recruitment Drive;
 * - Krystilia: Edgeville, for a one-off 5 million coins;
 * - Crefydd: Prifddinas, after Song of the Elves;
 * - Ferox: Ferox Enclave, for a one-off 5 million coins;
 * - Asteros Arceuus: Kourend Castle, after A Kingdom Divided;
 * - Gloria: Civitas illa Fortis, at Challenger rank (5,000 Glory);
 * and each of them back to Lumbridge. Their generated transcripts carry the words: this plugin
 * answers their "If the player's respawn point is (not) ...:" conditions and makes the change
 * on their confirming line, action or menu option (plugins/world/data/respawn-points.json).
 * Gloria's is set as "Yes." is picked on "Respawn in Civitas illa Fortis?": live sets
 * civitas_spawn on that click, with "Thanks!" (rsprox_transcripts/237/04115.txt tick 2142).
 *
 * "respawn-point:location" { player, location } answers where the player's point is, for the
 * items that send them there; "player:respawn" puts a dying player there when nothing (a
 * minigame, a game mode) took the respawn first. A members point on a free-to-play world is
 * Lumbridge.
 *
 * Not here: Merlin's Camelot point (it needs the Knight Waves Training Grounds, which are not
 * built) and the Respawn Teleport spell.
 */
const fs = require("fs");
const path = require("path");

const POINT_ATTRIBUTE = "respawn-point:point";
const UNLOCKED_ATTRIBUTE = "respawn-point:unlocked";
const CONDITION = /^If (?:the )?player'?s (?:current )?respawn(?: point| location)? is (not )?(?:in )?(.+?):$/i;
const CHANGES_TO = /^If the respawn point changes to (.+?):$/i;

let api = null;
let data = null;

function init(pluginApi) {
  api = pluginApi;
  load();
}

function load() {
  data ??= JSON.parse(fs.readFileSync(path.join(__dirname, "data", "respawn-points.json"), "utf8"));
  return data;
}

function unlocked(player, key) {
  const value = player.getAttribute(UNLOCKED_ATTRIBUTE);
  return Array.isArray(value) && value.includes(key);
}

function questComplete(player, key) {
  const request = { player, key, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** A Fortis Colosseum Glory title (the Colosseum plugin answers). */
function colosseumRank(player, rank) {
  const request = { player, rank, reached: false };
  api.emitCustomEvent("colosseum:has-rank", request);
  return request.reached === true;
}

/** Whether the player may have `key` set (the Wiki's requirement for each point). */
function allowed(player, key) {
  const point = load().points[key];
  if (!point) return false;
  const requires = point.requires ?? {};
  if (requires.quest && !questComplete(player, requires.quest)) return false;
  if (requires.unlock && !unlocked(player, requires.unlock)) return false;
  if (requires.rank && !colosseumRank(player, requires.rank)) return false;
  return true;
}

/** The player's point, Lumbridge for none, an unknown one, or a members one on a free world. */
function pointOf(player) {
  const key = player.getAttribute(POINT_ATTRIBUTE);
  const point = typeof key === "string" ? load().points[key] : null;
  if (!point?.tile) return "lumbridge";
  if (point.members && !api.core.WorldDefinition.isMembersWorld()) return "lumbridge";
  return key;
}

function locationOf(player) {
  const tile = load().points[pointOf(player)]?.tile;
  return tile ? new api.core.Location(tile[0], tile[1], tile[2] ?? 0) : api.core.GameConstants.DEFAULT_LOCATION.clone();
}

function setPoint(player, key) {
  if (key !== "lumbridge" && !allowed(player, key)) return false;
  player.setAttribute(POINT_ATTRIBUTE, key === "lumbridge" ? null : key);
  return true;
}

/** The one-off fee (Krystilia, Ferox): 5 million coins from the inventory, then the point's unlocked. */
function payToUnlock(player, key) {
  if (unlocked(player, key)) return true;
  const inventory = player.getInventory();
  const { COINS } = api.core.ItemIdentifiers;
  const fee = load().unlockFee;
  if (inventory.getAmount(COINS) < fee) return false;
  inventory.delete(COINS, fee);
  inventory.refreshItems?.();
  const value = player.getAttribute(UNLOCKED_ATTRIBUTE);
  player.setAttribute(UNLOCKED_ATTRIBUTE, [...(Array.isArray(value) ? value : []), key]);
  return true;
}

const settersOf = (definition) => load().setters[definition?.getName?.()] ?? null;

function answerCondition({ player, definition, text }) {
  if (!settersOf(definition)) return null;
  const value = String(text ?? "").trim();
  const match = CONDITION.exec(value);
  if (match) {
    const key = load().places[match[2]];
    if (!key) return null;
    return match[1] ? pointOf(player) !== key : pointOf(player) === key;
  }
  // Asteros, after "Yes please.": which way the change goes.
  const change = CHANGES_TO.exec(value);
  if (change) {
    const key = load().places[change[1]];
    if (!key) return null;
    return key === "lumbridge" ? pointOf(player) !== "lumbridge" : pointOf(player) !== key;
  }
  if (/^If the player has unlocked the Edgeville spawn:$/i.test(value)) return unlocked(player, "edgeville");
  if (/^If the player has not unlocked the Edgeville spawn:$/i.test(value)) return !unlocked(player, "edgeville");
  const coins = player.getInventory().getAmount(api.core.ItemIdentifiers.COINS) >= load().unlockFee;
  if (/^If player has 5 million coins:$/i.test(value) || /^With at least five million coins in the inventory:$/i.test(value)) return coins;
  if (/^If player does not have 5 million coins:$/i.test(value) || /^Without at least five million coins in the inventory:$/i.test(value)) return !coins;
  if (/^If the player is on a Shattered Relics League world:$/i.test(value)) return false;
  return null;
}

/** Ferox's two conversations: before and after the player first paid him. */
function dialogueVariant({ player, definition }) {
  if (definition?.getName?.() !== "Ferox") return null;
  const variants = load().feroxVariants;
  return unlocked(player, "ferox") ? variants.paid : variants.unpaid;
}

/** A confirming line changes the point as it shows. */
function dialogueLine(request) {
  const setters = settersOf(request.definition);
  if (!setters) return;
  const text = request.step?.npc ?? request.step?.player ?? request.text;
  const setter = setters.find((entry) => entry.line === text);
  if (!setter || (setter.from && pointOf(request.player) !== setter.from)) return;
  const { player } = request;
  request.before = () => setPoint(player, setter.point);
}

/** A menu option that sets the point as it is picked (Gloria's "Yes."). */
function dialogueChoice(choice) {
  const setters = settersOf(choice.definition);
  if (!setters) return;
  const setter = setters.find((entry) => entry.choice && entry.choice === choice.option && entry.prompt === choice.prompt);
  if (setter) setPoint(choice.player, setter.point);
}

/** An action step ("Player's respawn point is set to Edgeville.", Ferox's "5 million coins"). */
function dialogueAction(action) {
  const setters = settersOf(action.definition);
  if (!setters) return;
  const setter = setters.find((entry) => entry.action && entry.action === (action.text ?? action.target));
  if (!setter) return;
  action.handled = true;
  const { player } = action;
  if (setter.pay && !payToUnlock(player, setter.pay)) {
    action.end = true;
    return;
  }
  setPoint(player, setter.point);
}

/** "respawn-point:location": where the player respawns. */
function location(request) {
  if (request?.player && !request.location) request.location = locationOf(request.player);
}

/** A death nothing else placed: the player's own point (bots keep their own respawn). */
function respawn(event) {
  const { player } = event;
  if (event.handled || !player || player.isPlayerBot?.() === true) return;
  if (pointOf(player) === "lumbridge") return;
  player.moveTo(locationOf(player));
  event.handled = true;
}

module.exports = {
  name: "RespawnPoints",
  description: "Respawn points: Lumbridge, or Falador, Edgeville, Prifddinas, Ferox Enclave, Kourend Castle or Civitas illa Fortis as their NPCs set them, for deaths and the items that send players to their respawn point.",
  _test: { pointOf, locationOf, setPoint, allowed, payToUnlock, answerCondition, dialogueLine, dialogueChoice, dialogueAction, dialogueVariant, respawn, location, POINT_ATTRIBUTE, UNLOCKED_ATTRIBUTE },
  register(pluginApi) {
    init(pluginApi);
    pluginApi.persistAttribute(POINT_ATTRIBUTE, null);
    pluginApi.persistAttribute(UNLOCKED_ATTRIBUTE, null);
    pluginApi.onNpcDialogueCondition(answerCondition);
    pluginApi.onNpcDialogueVariant(dialogueVariant);
    pluginApi.onCustomEvent("npc-dialogue:line", dialogueLine);
    pluginApi.onCustomEvent("npc-dialogue:action", dialogueAction);
    pluginApi.onCustomEvent("npc-dialogue:choice", dialogueChoice);
    pluginApi.onCustomEvent("respawn-point:location", location);
    pluginApi.onCustomEvent("player:respawn", respawn);
  },
};
