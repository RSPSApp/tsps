/**
 * Petrified Pete and the way in (recorded, rsprox 1854 and 1858): his Talk-to with every branch
 * as said, Pay (30 Numulites a trip, 3,000 for good), Retrieve, and the Volcano Entrance's
 * Climb-down and Pay. Trade is Petrified Pete's Ore Shop, which Shopkeepers opens.
 */
const Common = require("./Common.VolcanicMine");
const Game = require("./Game.VolcanicMine");

function paid(player) {
  const { attributes } = Common.data;
  return player.getAttribute(attributes.permanent) === true || player.getAttribute(attributes.paid) === true;
}

const name = (player) => player.getDisplayName();

/** Pay: the recorded menu; the 3,000 option shown struck through when it can't be afforded. */
function pay(player) {
  const { data } = Common;
  const numulite = player.getInventory().getAmount(data.items.numulite);
  if (numulite < data.entry.fee) {
    Common.chat(player, [["npc", Common.message("tooPoor")]]);
    return;
  }
  const permanent = numulite >= data.entry.permanentFee
    ? Common.message("payMenuPermanent")
    : `<str>${Common.message("payMenuPermanent")}</str>`;
  Common.menu(player, "Select an Option", [
    [Common.message("payMenuOne"), () => {
      Common.closeChat(player);
      if (player.getInventory().getAmount(data.items.numulite) < data.entry.fee) return;
      player.getInventory().delete(data.items.numulite, data.entry.fee);
      player.setAttribute(data.attributes.paid, true);
      player.sendMessage(Common.message("paidLine"));
      Common.itemBox(player, data.items.numulite, Common.message("paidBox"), () => {
        Common.chat(player, [["npc", Common.message("paidThanks", { name: name(player) })]]);
      });
    }],
    [permanent, () => {
      Common.closeChat(player);
      if (player.getInventory().getAmount(data.items.numulite) < data.entry.permanentFee) return;
      player.getInventory().delete(data.items.numulite, data.entry.permanentFee);
      player.setAttribute(data.attributes.permanent, true);
      Common.chat(player, [["npc", Common.message("permanentThanks", { name: name(player) })]]);
    }],
    [Common.message("payMenuKeep"), () => Common.closeChat(player)],
  ]);
}

/** Whether Pete would let the player in now: a session running, or no fee paid, says no. */
function refusal(player) {
  const game = Game.current;
  if (game && !game.ended && game.phase !== "lobby" && game.players.size > 0) {
    return [["npc", Common.message("midSession", { name: name(player) })]];
  }
  return null;
}

/** The Volcano Entrance's Climb-down: 50 Mining, the fee, no session running; then the lobby. */
function climbDown({ player }) {
  const { data } = Common;
  if (Game.gameOf(player)) return true;
  if (Common.level(player, "MINING") < data.entry.mining) {
    player.sendMessage(Common.message("level"));
    return true;
  }
  if (!paid(player)) {
    player.sendMessage(Common.message("mustPay"));
    return true;
  }
  const refused = refusal(player);
  if (refused) {
    Common.chat(player, refused);
    return true;
  }
  const game = Game.joinable();
  if (!game) {
    Common.chat(player, [["npc", Common.message("midSession", { name: name(player) })]]);
    return true;
  }
  Common.animate(player, "pickupFloor");
  if (player.getAttribute(data.attributes.permanent) !== true) player.setAttribute(data.attributes.paid, false);
  game.join(player);
  return true;
}

function payAtEntrance({ player }) {
  const refused = refusal(player);
  if (refused) Common.chat(player, refused);
  else pay(player);
  return true;
}

// ------------------------------------------------------------------ Pete's Talk-to

function talk({ player }) {
  const { dialogue } = Common.data;
  Common.chat(player, dialogue.opener, () => mainMenu(player));
  return true;
}

function mainMenu(player) {
  const { dialogue } = Common.data;
  const [cavern, inside, trade, picked, leave] = dialogue.menu;
  Common.menu(player, "Select an Option", [
    [cavern, () => Common.chat(player, dialogue.cavern, () => cavernMenu(player, dialogue.cavernMenu))],
    [inside, () => insideBranch(player)],
    [trade, () => {
      Common.closeChat(player);
      openShop(player);
    }],
    [picked, () => {
      Common.closeChat(player);
      require("./Retrieval.VolcanicMine").retrieve(player);
    }],
    [leave, () => Common.closeChat(player)],
  ]);
}

/** The cavern's sub-menu: the option chosen is gone from the next one (recorded). */
function cavernMenu(player, options) {
  const { dialogue } = Common.data;
  const branches = {
    "How do I traverse the mine?": dialogue.traverse,
    "How do I keep the mine stable?": dialogue.stable,
    "Explain the dangers for me.": dialogue.dangers,
  };
  Common.menu(player, "Select an Option", options.map((option) => [option, () => {
    if (branches[option]) {
      Common.chat(player, branches[option], () => cavernMenu(player, options.filter((o) => o !== option)));
    } else if (option === "Can I go inside?") {
      insideBranch(player);
    } else {
      Common.closeChat(player);
    }
  }]));
}

function insideBranch(player) {
  const { data } = Common;
  const { dialogue } = data;
  if (paid(player)) {
    Common.chat(player, dialogue.insidePaid);
    return;
  }
  const poor = player.getInventory().getAmount(data.items.numulite) < data.entry.fee;
  Common.chat(player, poor ? [...dialogue.inside, ...dialogue.insideTooPoor] : dialogue.inside, poor ? null : () => pay(player));
}

/** Petrified Pete's Ore Shop, as Trade (Shopkeepers wires shop 1457 to Pete's op 4). */
function openShop(player) {
  Common.core.ShopManager.open(player, Common.data.shop);
}

/** The shop currency (Shopkeepers' "Volcanic Mine points") and the visit flag, sent on login. */
function restoreVarbits({ player }) {
  if (player.getAttribute(Common.data.attributes.visited)) Common.varbit(player, "visited", 1);
}

function attachEntry(api) {
  const { data } = Common;
  api.persistAttribute(data.attributes.paid, false);
  api.persistAttribute(data.attributes.permanent, false);
  api.persistAttribute(data.attributes.visited, false);
  api.persistAttribute(data.attributes.return);
  api.onObjectClick(data.locs.entrance, 1, climbDown);
  api.onObjectClick(data.locs.entrance, 2, payAtEntrance);
  api.onNpcClick(data.npcs.pete, 1, talk);
  api.onNpcClick(data.npcs.pete, 3, payAtEntrance);
  api.onPlayerLogin(restoreVarbits);
}

module.exports = { attachEntry, paid, pay };
