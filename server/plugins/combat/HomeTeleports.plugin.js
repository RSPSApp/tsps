"use strict";

/**
 * Home teleports (https://oldschool.runescape.wiki/w/Home_Teleport): the standard, Ancient, Lunar
 * and Arceuus spellbooks' free teleport home. It plays the long home teleport cast
 * (HomeTeleportSequence) and has one 30-minute cooldown shared by all four, kept as the minute
 * of the last one (varp 892, as OSRS sends varp 888 for the minigame teleports).
 */

const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { startHomeTeleport, dateMinutes } = require("./HomeTeleportSequence");

const COOLDOWN_MINUTES = 30;
const LAST_HOME_TELEPORT_VARP = 892;
const LAST_HOME_TELEPORT_ATTRIBUTE = "home-teleport:last-minute";

/** Destinations (Wiki): a tile, or a random tile in an area. */
const HOMES = new Map([
  ["lumbridge home teleport", { x: 3222, y: 3218, members: false }],
  ["edgeville home teleport", { x: 3087, y: 3501, width: 4, height: 4 }],
  ["lunar home teleport", { x: 2094, y: 3913 }],
  ["arceuus home teleport", { x: 1698, y: 3880, width: 5, height: 5 }],
]);

let core;

function spellName(event) {
  const itemId = event.itemId ?? -1;
  const packed = Number.isInteger(event.groupId) && Number.isInteger(event.childId)
    ? (event.groupId << 16) | (event.childId & 0xffff)
    : -1;
  return (CacheDefinitions.getSpellName(event.buttonId, itemId)
    ?? CacheDefinitions.getSpellName(packed, itemId)
    ?? "").toLowerCase();
}

function destinationFor(home) {
  const dx = home.width ? Math.floor(Math.random() * home.width) : 0;
  const dy = home.height ? Math.floor(Math.random() * home.height) : 0;
  return new core.Location(home.x + dx, home.y + dy, 0);
}

/** Minutes left of the cooldown that started at `lastMinute`; 0 when it has passed. */
function minutesLeft(lastMinute, cooldown, now = dateMinutes()) {
  if (!Number.isFinite(lastMinute) || lastMinute <= 0) return 0;
  return Math.max(0, cooldown - (now - lastMinute));
}

function castHomeTeleport(event) {
  const home = HOMES.get(spellName(event));
  if (!home) return;
  event.handled = true;
  const { player } = event;
  const left = minutesLeft(Number(player.getAttribute(LAST_HOME_TELEPORT_ATTRIBUTE)), COOLDOWN_MINUTES);
  if (left > 0) {
    player.sendMessage(`You need to wait another ${left} minutes to cast this spell.`);
    return;
  }
  if (home.members !== false && !core.WorldDefinition.isMembersWorld()) {
    player.sendMessage("You need to be on a members' world to use this spell.");
    return;
  }
  const destination = destinationFor(home);
  if (!core.TeleportHandler.checkReqs(player, destination)) return;
  if (core.CombatFactory.inCombat(player)) {
    player.sendMessage("You can't use this spell during combat.");
    return;
  }
  startHomeTeleport(core, player, destination, () => {
    const minute = dateMinutes();
    player.setAttribute(LAST_HOME_TELEPORT_ATTRIBUTE, minute);
    player.getPacketSender().sendConfig(LAST_HOME_TELEPORT_VARP, minute);
  });
}

function sendLastHomeTeleport({ player }) {
  const minute = Number(player.getAttribute(LAST_HOME_TELEPORT_ATTRIBUTE) ?? 0);
  if (minute > 0) player.getPacketSender().sendConfig(LAST_HOME_TELEPORT_VARP, minute);
}

module.exports = {
  name: "HomeTeleports",
  register(api) {
    core = api.core;
    api.persistAttribute(LAST_HOME_TELEPORT_ATTRIBUTE);
    api.onInterfaceActionClick(castHomeTeleport);
    api.onPlayerLogin(sendLastHomeTeleport);
  },
};

module.exports._test = { castHomeTeleport, minutesLeft, HOMES, LAST_HOME_TELEPORT_ATTRIBUTE };
