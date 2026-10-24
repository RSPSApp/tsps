/**
 * The entrance hall (Wiki: Mage_Training_Arena, Enchanters_Teleport, Exit_Teleport):
 * - the hall shows the four Pizazz Point totals while the player is in it;
 * - the Enchanters Teleport takes a player with Magic 7 to the Enchanting Chamber (the
 *   Alchemists and Graveyard Teleports are their rooms' units; the Telekinetic Teleport is left
 *   until its room exists);
 * - every room's Exit Teleport brings the player back to the hall.
 */
const Common = require("./Common.MageTrainingArena");

function sendLobbyOverlay(player) {
  const { interfaces, components } = Common.ids;
  Common.sendOverlay(player, interfaces.lobby);
  const sender = player.getPacketSender();
  const keys = { telekinetic: "lobbyTelekinetic", alchemist: "lobbyAlchemist", enchantment: "lobbyEnchantment", graveyard: "lobbyGraveyard" };
  for (const type of Common.POINT_TYPES) sender.sendString(Common.points(player, type).toLocaleString("en-GB"), components[keys[type]]);
}

function magicLevel(player) {
  return player.getSkillManager().getCurrentLevel(Common.core.Skill.MAGIC);
}

/** The Enchanters Teleport: Magic 7 (boostable, Wiki). */
function enterEnchanting({ player, objectId }) {
  if (objectId !== Common.ids.locs.enchantPortal) return false;
  const { level, arrive } = Common.data.enchanting;
  if (magicLevel(player) < level) {
    player.sendMessage(Common.message("level", { level, room: "Enchanting Chamber" }));
    return true;
  }
  player.moveTo(Common.toLocation(arrive));
  return true;
}

function exit({ player, objectId }) {
  if (objectId !== Common.ids.locs.exit) return false;
  player.moveTo(Common.toLocation(Common.data.lobby.arrive));
  return true;
}

function defineArea() {
  const { Area, Boundary } = Common.core;
  const [minX, maxX, minY, maxY] = Common.data.lobby.bounds;
  return class MageTrainingArenaHall extends Area {
    constructor() {
      super(Common.data.lobby.levels.map((z) => new Boundary(minX, maxX, minY, maxY, z)));
    }

    getName() {
      return "Mage Training Arena";
    }

    postEnter(mobile) {
      if (mobile?.isPlayer?.()) sendLobbyOverlay(mobile.getAsPlayer());
    }

    postLeave(mobile) {
      if (mobile?.isPlayer?.()) Common.closeOverlay(mobile.getAsPlayer());
    }
  };
}

function attach(api) {
  api.registerArea(new (defineArea())());
  api.onObjectInteraction("Enchanters Teleport", { Enter: enterEnchanting });
  api.onObjectInteraction("Exit Teleport", { Enter: exit });
}

module.exports = { attach, sendLobbyOverlay, enterEnchanting, exit };
