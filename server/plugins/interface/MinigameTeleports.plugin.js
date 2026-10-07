"use strict";

/**
 * Minigame Teleport (https://oldschool.runescape.wiki/w/Minigame_Teleport), as in OSRS captures
 * (docs/minigame-teleports.md). The spell opens the minigames interface (951), whose list the
 * client builds from the cache (enum 5924: list position -> component, enum 5923: list position ->
 * db row of table 214, which names the minigame). A choice plays the home teleport cast
 * (HomeTeleportSequence) to the minigame; Rat Pits first asks which pit. Destinations and
 * requirements are in data/definitions/minigame-teleports.json. The 20-minute cooldown is the
 * minute of the last one (varp 888).
 */

const fs = require("fs");
const path = require("path");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const QuestRuntime = require("../quests/QuestRuntime");
const { startHomeTeleport, dateMinutes, BUSY_VARBIT } = require("../combat/HomeTeleportSequence");

const SPELL_NAME = "minigame teleport";
const MINIGAMES_INTERFACE = 951;
const COMPONENT_BY_POSITION_ENUM = 5924;
const ROW_BY_POSITION_ENUM = 5923;
const NAME_COLUMN = 1;
const COOLDOWN_MINUTES = 20;
const LAST_MINIGAME_TELEPORT_VARP = 888;
const LAST_MINIGAME_TELEPORT_ATTRIBUTE = "minigame-teleport:last-minute";

let core;
let pluginApi;
let minigames = {};

function loadMinigames() {
  const file = path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "minigame-teleports.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).minigames ?? {};
}

function spellName(event) {
  const itemId = event.itemId ?? -1;
  const packed = Number.isInteger(event.groupId) && Number.isInteger(event.childId)
    ? (event.groupId << 16) | (event.childId & 0xffff)
    : -1;
  return (CacheDefinitions.getSpellName(event.buttonId, itemId)
    ?? CacheDefinitions.getSpellName(packed, itemId)
    ?? "").toLowerCase();
}

/** The minigame a component of interface 951 shows, by its cache name; undefined if none. */
function minigameAt(childId) {
  const component = (MINIGAMES_INTERFACE << 16) | (childId & 0xffff);
  for (const [position, value] of CacheDefinitions.getEnumValues(COMPONENT_BY_POSITION_ENUM)) {
    if (value !== component) continue;
    const rowId = CacheDefinitions.getEnumValues(ROW_BY_POSITION_ENUM).get(position);
    const name = typeof rowId === "number" ? CacheDefinitions.getDbRow(rowId)?.columns.get(NAME_COLUMN)?.[0] : undefined;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

function minutesLeft(lastMinute, now = dateMinutes()) {
  if (!Number.isFinite(lastMinute) || lastMinute <= 0) return 0;
  return Math.max(0, COOLDOWN_MINUTES - (now - lastMinute));
}

/** Why the player can't go to this minigame yet, or null. Unregistered quests don't block. */
function refusal(player, minigame) {
  if (minigame.members && !core.WorldDefinition.isMembersWorld()) {
    return "You need to be on a members' world to go there.";
  }
  for (const [skill, level] of Object.entries(minigame.skills ?? {})) {
    if (player.getSkillManager().getMaxLevel(core.Skill[skill]) < level) {
      const name = skill.charAt(0) + skill.slice(1).toLowerCase();
      return `You need a ${name} level of ${level} to go there.`;
    }
  }
  if (minigame.combat && player.getSkillManager().getCombatLevel() < minigame.combat) {
    return `You need a combat level of ${minigame.combat} to go there.`;
  }
  const quests = QuestRuntime.getRegisteredQuests();
  for (const questName of minigame.quests ?? []) {
    const quest = quests.find((entry) => entry.name === questName);
    if (quest && !quest.isComplete(player)) return `You need to complete ${questName} to go there.`;
  }
  return null;
}

function castMinigameTeleport(event) {
  if (spellName(event) !== SPELL_NAME) return;
  event.handled = true;
  const { player } = event;
  const left = minutesLeft(Number(player.getAttribute(LAST_MINIGAME_TELEPORT_ATTRIBUTE)));
  if (left > 0) {
    player.sendMessage(`You must wait another ${left} minutes before you can use the minigame teleports.`);
    return;
  }
  if (!core.TeleportHandler.checkReqs(player, player.getLocation())) return;
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1).sendInterface(MINIGAMES_INTERFACE);
}

function teleportTo(player, x, y) {
  const destination = new core.Location(x, y, 0);
  if (!core.TeleportHandler.checkReqs(player, destination)) {
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
    return;
  }
  startHomeTeleport(core, player, destination, () => {
    const minute = dateMinutes();
    player.setAttribute(LAST_MINIGAME_TELEPORT_ATTRIBUTE, minute);
    player.getPacketSender().sendConfig(LAST_MINIGAME_TELEPORT_VARP, minute);
  });
}

function chooseMinigame(event) {
  if (event.groupId !== MINIGAMES_INTERFACE) return;
  const name = minigameAt(event.childId);
  const minigame = name ? minigames[name] : undefined;
  if (!minigame) return;
  event.handled = true;
  const { player } = event;
  player.getPacketSender().sendInterfaceRemoval();
  const why = refusal(player, minigame);
  if (why) {
    player.sendMessage(why);
    return;
  }
  if (!minigame.choices) {
    teleportTo(player, minigame.x, minigame.y);
    return;
  }
  // Rat Pits: which pit, in the chatbox; busy stays set until the choice.
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  const options = minigame.choices.flatMap((choice) => [
    choice.option,
    () => teleportTo(player, choice.x, choice.y),
  ]);
  pluginApi.sendMultiChatboxPrompt(player, minigame.prompt, ...options, "Cancel", () =>
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0),
  );
}

/** Closing the list without a choice ends the cast. */
function minigamesClosed({ player, interfaceId }) {
  if (interfaceId === MINIGAMES_INTERFACE) player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

function sendLastMinigameTeleport({ player }) {
  const minute = Number(player.getAttribute(LAST_MINIGAME_TELEPORT_ATTRIBUTE) ?? 0);
  if (minute > 0) player.getPacketSender().sendConfig(LAST_MINIGAME_TELEPORT_VARP, minute);
}

function attach(api) {
  core = api.core;
  pluginApi = api;
  minigames = loadMinigames();
}

module.exports = {
  name: "MinigameTeleports",
  register(api) {
    attach(api);
    api.persistAttribute(LAST_MINIGAME_TELEPORT_ATTRIBUTE);
    api.onInterfaceActionClick(castMinigameTeleport);
    api.onInterfaceActionClick(chooseMinigame);
    api.onCustomEvent("interface:closed", minigamesClosed);
    api.onPlayerLogin(sendLastMinigameTeleport);
  },
};

module.exports._test = {
  castMinigameTeleport,
  chooseMinigame,
  minigameAt,
  minutesLeft,
  refusal,
  LAST_MINIGAME_TELEPORT_ATTRIBUTE,
};
