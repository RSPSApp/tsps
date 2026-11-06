/**
 * Shantay (NPC 4642): his transcript (npc-dialogues.json "Shantay") is played by NpcDialogues;
 * this unit answers its conditions and carries out its actions, as rsprox captures show them:
 *
 * - "Buy-pass" and "I want to buy a Shantay pass..." take 5 coins and show the pass in an item
 *   box: "You purchase a Shantay Pass." Free-to-play worlds can't buy one.
 * - "I am definitely an outlaw" has the guards jail the player (Jail.ShantayPass.js); paying the
 *   fine takes 5 coins ("You hand over five gold pieces to Shantay.") and unlocks the cell.
 * - Without the coins, Shantay offers the bank, or sends the player to the Port Sarim jail.
 */
const Common = require("./Common.ShantayPass");
const Jail = require("./Jail.ShantayPass");

const NAME = "Shantay";
const TOURIST_TRAP = "the_tourist_trap";
const INTRODUCTION = "Hello effendi, I am Shantay.";
const HIM_OR_HER = "[him/her]";

const PURCHASE_MESSAGE = "You purchase a Shantay Pass.";
const HAND_OVER_MESSAGE = "You hand over five gold pieces to Shantay.";
const UNLOCK_MESSAGE = "Shantay unlocks the door to the cell.";
const JAIL_ACTION = "The player is put in the Shantay Pass jail.";

function isShantay(definition) {
  return definition?.getName?.() === NAME;
}

/** The transcript's prose conditions, answered from the player's state. */
function conditions(player) {
  const { WorldDefinition } = Common.getCore();
  const coins = Common.coins(player);
  const banked = Common.bankedCoins(player);
  const ultimate = Common.isUltimateIronman(player);
  const freeToPlay = !WorldDefinition.isMembersWorld();
  const space = player.getInventory().getFreeSlots() > 0;
  const met = player.getAttribute(Common.MET_ATTRIBUTE) === true;
  const escaped = player.getAttribute(Common.ESCAPED_ATTRIBUTE) === true;
  return {
    "The first time talking to Shantay:": !met,
    "Subsequent times talking to Shantay:": met,
    "If the player has not completed The Tourist Trap:": !Common.questComplete(player, TOURIST_TRAP),
    "If the player has not started The Tourist Trap:": !Common.questStarted(player, TOURIST_TRAP),
    "If the player is not in trouble with Shantay:": !escaped,
    "If the player has escaped from the \"Maximum security prison\" or from the Shantay Pass jail:": escaped,
    "If the player has 5 coins:": coins >= Common.FINE,
    "If the player does not have 5 coins in their inventory:": coins < Common.FINE,
    "If the player does not have 5 coins in their bank, or they are an Ultimate Ironman:": banked < Common.FINE || ultimate,
    "In Leagues without access to the Asgarnia region:": false,
    "If the player has 5 coins in their bank:": banked >= Common.FINE && !ultimate,
    "If the player is on a Free-to-play world:": freeToPlay,
    "If the player does not have 5 coins:": coins < Common.FINE,
    "If the player does not have inventory space:": !space,
    "If the player is not on a Free-to-play world, has 5 coins and has inventory space:": !freeToPlay && coins >= Common.FINE && space,
  };
}

function answerCondition({ player, definition, text }) {
  if (!isShantay(definition)) return null;
  const answers = conditions(player);
  return Object.hasOwn(answers, text) ? answers[text] : null;
}

/**
 * Shantay has introduced himself once his first line has been read. "Guards arrest [him/her]!"
 * names the player as live does ("Guards arrest him!").
 */
function dialogueLine(request) {
  if (!isShantay(request.definition)) return;
  if (request.step?.npc === INTRODUCTION) request.player.setAttribute(Common.MET_ATTRIBUTE, true);
  if (typeof request.text === "string" && request.text.includes(HIM_OR_HER)) {
    request.text = request.text.replace(HIM_OR_HER, request.player.getAppearance().isMale() ? "him" : "her");
  }
}

function takeFine(player) {
  const { ItemIdentifiers } = Common.getCore();
  player.getInventory().deleteNumber(ItemIdentifiers.COINS, Common.FINE);
  player.getInventory().refreshItems();
}

function dialogueAction(action) {
  if (!isShantay(action.definition)) return;
  const { player } = action;
  const { Item, ItemIdentifiers } = Common.getCore();
  if (action.kind === "message") {
    if (action.text === PURCHASE_MESSAGE) {
      if (player.getInventory().getAddableAmount(new Item(ItemIdentifiers.SHANTAY_PASS, 1)) < 1) {
        player.sendMessage("You cannot hold any more Shantay passes.");
        action.end = true;
        return;
      }
      takeFine(player);
      player.getInventory().adds(ItemIdentifiers.SHANTAY_PASS, 1);
      action.box = { items: [ItemIdentifiers.SHANTAY_PASS] };
    } else if (action.text === HAND_OVER_MESSAGE) {
      takeFine(player);
    } else if (action.text === UNLOCK_MESSAGE) {
      Jail.release(player);
    }
    return;
  }
  if (action.text === JAIL_ACTION) {
    Jail.lockUp(player);
    action.handled = true;
  } else if (action.action === "open_interface" && action.target === "Bank") {
    // As captured, the bank opens the tick after Shantay's line, once the chat has closed.
    Common.later(player, 1, () => player.getBank(player.getCurrentBankTab()).open());
    action.handled = true;
    action.end = true;
  } else if (action.action === "teleport" && action.target === "Port Sarim jail") {
    Jail.sendToPortSarim(player);
    action.handled = true;
  }
}

function buyPass({ player, npc }) {
  Common.shantaySays(player, "buy-pass-dialogue", npc);
  return true;
}

function attach(api) {
  api.onNpcInteraction(NAME, { "Buy-pass": buyPass });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", dialogueLine);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
}

module.exports = attach;
module.exports.conditions = conditions;
