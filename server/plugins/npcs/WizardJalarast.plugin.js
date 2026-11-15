"use strict";

/**
 * Wizard Jalarast (NPC 3232, `armourmaking_wizard`), the Wizards' Tower armourer, makes splitbark
 * armour from bark, fine cloth and coins (https://oldschool.runescape.wiki/w/Wizard_Jalarast).
 * Facts in docs/splitbark-armour.md.
 *
 * - Trade opens skillmulti at once, "How many do you wish to buy?" with Helm, Body, Legs,
 *   Gauntlets and Boots, verb argument 20 and an amount of 1 (rsprox.net recording 3202, rev 232,
 *   tick 2370).
 * - Talk-to's "Can you make me some armour please?" ends in the transcript's "Continues with shop
 *   dialogue." (npc-dialogues.json "Wizard Jalarast"), which opens the same menu.
 * - A pick plays the transcript's shop-dialogue line for that piece: "There you go, enjoy your new
 *   armour!" when the bark, fine cloth and coins are carried (they go and the piece comes), else
 *   "You need ... for a splitbark helm." The amounts and prices are those lines' (Wiki, Wizard
 *   Jalarast's dialogue). Ours: only unnoted bark and cloth count, and the piece takes a slot the
 *   materials leave (no recording of a purchase).
 * - The transcript's "If the player is on a non-members world:" conditions are answered false
 *   here; this plugin is members-only, so on a free world they stay unanswered and the
 *   transcript's "I'm sorry, but I can't do that right now." plays.
 */

const NPC_NAME = "Wizard Jalarast";
const PAGE = "Wizard Jalarast";
const MENU_TITLE = "How many do you wish to buy?";
/** skillmulti_setup's first argument for this menu (rsprox.net recording 3202, tick 2370). */
const MENU_MODE = 20;
const SHOP_VARIANT = "shop-dialogue";
const SHOP_ACTION = "Continues with shop dialogue.";
const NON_MEMBERS = "If the player is on a non-members world:";
const HAS_SUPPLIES = "If the player has the supplies:";
const LACKS_SUPPLIES = "If the player does not have the supplies:";

/** The menu's pieces in its order, with the transcript's option and the bark/cloth and coins it takes. */
const PIECES = [
  { obj: "splitbark_helm", label: "Helm", option: "Buy Helm", pieces: 2, coins: 6000 },
  { obj: "splitbark_body", label: "Body", option: "Buy Body", pieces: 4, coins: 37000 },
  { obj: "splitbark_legs", label: "Legs", option: "Buy Legs", pieces: 3, coins: 32000 },
  { obj: "splitbark_gauntlets", label: "Gauntlets", option: "Buy Gauntlets", pieces: 1, coins: 1000 },
  { obj: "splitbark_greaves", label: "Boots", option: "Buy Boots", pieces: 1, coins: 1000 },
];

let api = null;
let core = null;
let ids = null;

function objId(name) {
  return core.CacheDefinitions.getObjId(name);
}

function itemIds() {
  if (ids) return ids;
  ids = {
    npc: core.CacheDefinitions.getNpcId?.("armourmaking_wizard") ?? 3232,
    bark: objId("hollow_bark"),
    cloth: objId("fine_cloth"),
    coins: objId("coins"),
    pieces: PIECES.map((piece) => ({ ...piece, id: objId(piece.obj) })),
  };
  return ids;
}

function isJalarast(npcId, npc) {
  if (npcId === itemIds().npc) return true;
  return npc?.getDefinition?.()?.getName?.() === NPC_NAME;
}

function hasSupplies(player, piece) {
  const { bark, cloth, coins } = itemIds();
  const inventory = player.getInventory();
  return inventory.getAmount(bark) >= piece.pieces
    && inventory.getAmount(cloth) >= piece.pieces
    && inventory.getAmount(coins) >= piece.coins;
}

/** The materials and coins go, then the piece comes into the room they leave. */
function make(player, piece) {
  const { bark, cloth, coins } = itemIds();
  const inventory = player.getInventory();
  inventory.deleteNumber(bark, piece.pieces);
  inventory.deleteNumber(cloth, piece.pieces);
  inventory.deleteNumber(coins, piece.coins);
  inventory.adds(piece.id, 1);
  inventory.refreshItems();
}

/** The shop-dialogue option's line for this outcome: the steps of its supplies condition. */
function outcomeSteps(piece, made) {
  return (steps) => {
    const menu = steps.find((step) => step?.type === "choice");
    const option = menu?.options?.find((entry) => entry.text === piece.option);
    const wanted = made ? HAS_SUPPLIES : LACKS_SUPPLIES;
    const condition = option?.steps?.find((step) => step?.type === "condition" && step.text === wanted);
    return condition?.steps ?? [];
  };
}

function choose(player, npc, itemId) {
  const piece = itemIds().pieces.find((entry) => entry.id === itemId);
  if (!piece) return;
  const made = hasSupplies(player, piece);
  if (made) make(player, piece);
  api.emitCustomEvent("npc-dialogue:start", {
    player, npc, npcId: itemIds().npc, variant: { page: PAGE, variant: SHOP_VARIANT }, select: outcomeSteps(piece, made),
  });
}

function openMenu(player, npc) {
  const pieces = itemIds().pieces;
  const items = pieces.map((piece) => piece.id);
  player.getPacketSender().sendCreationMenu(new core.CreationMenu(MENU_TITLE, items, {
    execute: (itemId) => choose(player, npc, itemId),
  }, { mode: MENU_MODE, labels: pieces.map((piece) => piece.label), maxAmount: 1, lastAmount: 1 }));
}

function trade({ player, npc }) {
  openMenu(player, npc);
  return true;
}

function dialogueCondition(event) {
  if (event.text !== NON_MEMBERS || !isJalarast(event.npcId, event.npc)) return null;
  return false;
}

/** Talk-to's "Can you make me some armour please?" carries on into the menu once the chatbox closes. */
function dialogueAction(event) {
  if (event.handled || event.text !== SHOP_ACTION || !isJalarast(event.npcId, event.npc)) return;
  event.handled = true;
  event.end = true;
  const { player, npc } = event;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player.getIndex(), false);
    }
    execute() {
      this.stop();
      if (player.isRegistered() && !player.getDialogueManager().isActive()) openMenu(player, npc);
    }
  })());
}

function start(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "WizardJalarast",
  description: "Wizard Jalarast at the Wizards' Tower makes splitbark armour: Trade or Talk-to opens the purchase menu, and each piece takes its bark, fine cloth and coins.",
  members: true,
  register(pluginApi) {
    start(pluginApi);
    pluginApi.onNpcInteraction(NPC_NAME, { Trade: trade });
    pluginApi.onNpcDialogueCondition(dialogueCondition);
    pluginApi.onCustomEvent("npc-dialogue:action", dialogueAction);
  },
  _test: { PIECES, MENU_TITLE, MENU_MODE, outcomeSteps, hasSupplies },
};
