/**
 * Gertrude's kitten colour choice (https://oldschool.runescape.wiki/w/Gertrude).
 *
 * After Gertrude's Cat, her right-click "Kitten" option and the post-quest colour interface
 * let the player buy another kitten for 100 coins and choose its colour, but only while
 * wearing the activated Ring of Charos with no cat already following or banked. A successful
 * choice emits the ordinary success event the Varrock diary listens for.
 */
const GERTRUDES_CAT_QUEST = "gertrudes_cat";
const KITTEN_COST = 100;
const RING_OF_CHAROS_A = 6465;
const KITTEN_ITEM_IDS = [1555, 1556, 1557, 1558, 1559, 1560];
const KITTEN_COLOURS = [
  "Grey and black", "White", "Brown", "Black", "Grey and brown", "Grey and blue",
];
const KITTEN_COLOUR_ACTIONS = new Set(["ft92fH", "xcCHN3"]);
const KITTEN_INTERFACE_TARGET = /kitten/i;
const COLOURS_PER_PAGE = 4;
const KITTEN_COLOUR_CHOSEN_EVENT = "gertrude:kitten-colour-chosen";

/** Gertrude's post-quest dialogue already asks for these interface actions. */
const CAT_NPC_IDENTIFIERS = [
  "CAT", "CAT_2", "CAT_3", "CAT_4", "CAT_5", "CAT_6", "HELLCAT",
  "KITTEN_2", "KITTEN_3", "KITTEN_4", "KITTEN_5", "KITTEN_6", "KITTEN_7", "HELL_KITTEN",
  "OVERGROWN_CAT", "OVERGROWN_CAT_2", "OVERGROWN_CAT_3", "OVERGROWN_CAT_4",
  "OVERGROWN_CAT_5", "OVERGROWN_CAT_6", "OVERGROWN_HELLCAT",
];
let catNpcIds = null;

function hasCharosAEquipped(player, api) {
  return player?.getEquipment?.().get(api.core.Equipment.RING_SLOT)?.getId?.() === RING_OF_CHAROS_A;
}

function holdsKittenItem(player) {
  const inventory = player?.getInventory?.();
  if (!inventory) return false;
  if (KITTEN_ITEM_IDS.some((id) => inventory.getAmount(id) > 0)) return true;
  const banks = player.getBanks?.() ?? [];
  for (const bank of banks) {
    if (!bank) continue;
    if (KITTEN_ITEM_IDS.some((id) => bank.contains?.(id))) return true;
  }
  return false;
}

function followingCat(player, api) {
  if (!catNpcIds) {
    catNpcIds = new Set(CAT_NPC_IDENTIFIERS
      .map((name) => api.core.NpcIdentifiers[name])
      .filter((id) => Number.isInteger(id)));
  }
  const request = { player, pet: null };
  api.emitCustomEvent("pets:current", request);
  const id = request.pet?.getId?.();
  return Number.isInteger(id) && catNpcIds.has(id);
}

function kittenQuestComplete(player, api) {
  const request = { player, key: GERTRUDES_CAT_QUEST, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function canChooseKitten(player, api) {
  if (!kittenQuestComplete(player, api)) {
    player.sendMessage("You need to complete Gertrude's Cat first.");
    return false;
  }
  if (!hasCharosAEquipped(player, api)) {
    player.sendMessage("You need to wear the activated Ring of Charos to choose a colour.");
    return false;
  }
  if (holdsKittenItem(player) || followingCat(player, api)) {
    player.sendMessage("You are already looking after a cat.");
    return false;
  }
  if (player.getInventory().getAmount(api.core.ItemIdentifiers.COINS) < KITTEN_COST) {
    player.sendMessage(`You need ${KITTEN_COST} coins for another kitten.`);
    return false;
  }
  if (player.getInventory().isFull()) {
    player.sendMessage("You need a free inventory slot for a kitten.");
    return false;
  }
  return true;
}

function chooseKittenColour(api, player, colour) {
  if (!Number.isInteger(colour) || colour < 0 || colour >= KITTEN_ITEM_IDS.length) return false;
  if (!canChooseKitten(player, api)) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(api.core.ItemIdentifiers.COINS, KITTEN_COST);
  inventory.adds(KITTEN_ITEM_IDS[colour], 1);
  player.sendMessage(`Gertrude gives you a ${KITTEN_COLOURS[colour].toLowerCase()} kitten.`);
  api.emitCustomEvent(KITTEN_COLOUR_CHOSEN_EVENT, { player, colour, itemId: KITTEN_ITEM_IDS[colour] });
  return true;
}

/** Gertrude's right-click "Kitten" option is the Wiki's colour-picking shortcut. */
function onGertrudeKitten(api, event) {
  const { player } = event ?? {};
  if (!player || !canChooseKitten(player, api)) return false;
  event.handled = true;
  openKittenColourMenu(api, player);
  return true;
}

function openKittenColourMenu(api, player, page = 0, onInitialChoice = null, onInitialCancel = null) {
  const first = page * COLOURS_PER_PAGE;
  const colours = KITTEN_COLOURS.slice(first, first + COLOURS_PER_PAGE);
  const labels = [...colours];
  const more = first + COLOURS_PER_PAGE < KITTEN_COLOURS.length;
  labels.push(more ? "More colours..." : "Cancel");
  const menu = new api.core.OptionDialogue(0, {
    executeOption(option) {
      const pick = Number(option) - 1;
      if (pick >= 0 && pick < colours.length) {
        player.getPacketSender().sendInterfaceRemoval();
        if (onInitialChoice) onInitialChoice(KITTEN_ITEM_IDS[first + pick]);
        else chooseKittenColour(api, player, first + pick);
      } else if (more && pick === colours.length) {
        player.getPacketSender().sendInterfaceRemoval();
        openKittenColourMenu(api, player, page + 1, onInitialChoice, onInitialCancel);
      } else {
        player.getPacketSender().sendInterfaceRemoval();
        if (onInitialCancel) onInitialCancel();
      }
    },
  }, ...labels).setTitle("Select a colour for your kitten");
  player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(menu));
}

/** The quest owns the free initial reward; share only this server's colour picker. */
function onInitialKittenMenu(api, request) {
  if (!request.player || typeof request.choose !== "function") return;
  request.opened = true;
  openKittenColourMenu(api, request.player, 0, request.choose, request.cancel);
}

function onDialogueAction(api, event) {
  const { player } = event ?? {};
  if (!player || event.handled) return;
  if (KITTEN_COLOUR_ACTIONS.has(event.stepId)
    || (event.action === "open_interface" && KITTEN_INTERFACE_TARGET.test(String(event.target ?? "")))) {
    event.handled = true;
    if (canChooseKitten(player, api)) openKittenColourMenu(api, player);
  }
}

module.exports = {
  name: "Gertrude",
  members: true,
  dependsOn: ["Quests", "Pets"],
  register(api) {
    api.onNpcInteraction("Gertrude", { Kitten: onGertrudeKitten.bind(null, api) });
    api.onCustomEvent("npc-dialogue:action", onDialogueAction.bind(null, api));
    api.onCustomEvent("gertrude:initial-kitten-menu", onInitialKittenMenu.bind(null, api));
  },
  _test: {
    GERTRUDES_CAT_QUEST, KITTEN_COST, RING_OF_CHAROS_A, KITTEN_ITEM_IDS, KITTEN_COLOURS,
    KITTEN_COLOUR_CHOSEN_EVENT, hasCharosAEquipped, holdsKittenItem, followingCat,
    kittenQuestComplete, canChooseKitten, chooseKittenColour, onGertrudeKitten,
    openKittenColourMenu, onDialogueAction,
  },
};
