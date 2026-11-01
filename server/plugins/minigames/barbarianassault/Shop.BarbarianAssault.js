"use strict";

const data = require("./Data.BarbarianAssault");
const Points = require("./Points.BarbarianAssault");
const Lobby = require("./Lobby.BarbarianAssault");

const SHOP_ID = 1427;
const QUEEN_ITEMS = new Map(data.SHOP_STOCK.filter((entry) => entry.queen).map((entry) => [entry.id, entry]));

let api = null;

function pointsLine(player) {
  return data.ROLES
    .map((role) => `${data.ROLE_LABEL[role]} ${Points.points(player, role).toLocaleString()} (level ${Points.level(player, role)})`)
    .join(", ");
}

function checkPoints({ player }) {
  player.sendMessage(`Honour Points: ${pointsLine(player)}. Queen kills: ${Points.queenKills(player)}.`);
}

function levelPrompt(player) {
  const options = [];
  for (const role of data.ROLES) {
    const cost = Points.upgradeCost(player, role);
    const label = cost == null
      ? `${data.ROLE_LABEL[role]} level 5`
      : `${data.ROLE_LABEL[role]} level ${Points.level(player, role)} -> ${Points.level(player, role) + 1} (${cost})`;
    options.push(label, () => {
      if (Points.upgradeRole(player, role)) checkPoints({ player });
    });
  }
  options.push("Back", () => commanderTalk({ player }));
  api.sendMultiChatboxPrompt(player, `Commander Connad: ${pointsLine(player)}. Which role will you upgrade?`, ...options);
}

function commanderTalk({ player }) {
  if (Lobby.inQueue(player)) {
    Lobby.status(player);
  }
  api.sendMultiChatboxPrompt(
    player,
    "Commander Connad: what do you need, soldier?",
    "Choose a role", () => Lobby.rolePrompt(player),
    "Level up a role", () => levelPrompt(player),
    "Check Honour Points", () => {
      checkPoints({ player });
      commanderTalk({ player });
    },
    "High gamble", () => {
      Points.highGamble(player);
      commanderTalk({ player });
    },
    "Cancel", () => {},
  );
}

/** Queen-kill gate for the armour pieces the Wiki marks with a Queen requirement. */
function buyLimit(event) {
  if (!event || event.shopId !== SHOP_ID) return;
  const entry = QUEEN_ITEMS.get(event.itemId);
  if (!entry) return;
  if (Points.queenKilled(event.player)) return;
  event.limit = 0;
  event.message = `You need to defeat the Penance Queen before buying the ${event.itemId === 10551 ? "Fighter torso" : "Penance armour"}.`;
}

function purchase(event) {
  if (!event || event.shopId !== SHOP_ID) return;
  if (event.player && !event.player.isPlayerBot?.()) {
    event.player.sendMessage(`Honour Points: ${pointsLine(event.player)}.`);
  }
}

function attach(pluginApi) {
  api = pluginApi;
  Lobby.setLevelPromptHandler((player) => levelPrompt(player));
  pluginApi.onCustomEvent?.("shop:buy-limit", buyLimit);
  pluginApi.onCustomEvent?.("shop:purchase", purchase);
}

module.exports = {
  SHOP_ID, commanderTalk, levelPrompt, checkPoints, buyLimit, purchase, attach,
};
