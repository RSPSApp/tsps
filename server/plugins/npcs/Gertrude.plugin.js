/**
 * Gertrude's kittens after her quest (https://oldschool.runescape.wiki/w/Gertrude).
 *
 * Another kitten costs 100 coins, through her talk ("Do you have any more kittens?" > "Yes please.")
 * or her right-click "Kitten" option, the Wiki's quick buy. Its colour is random unless the player
 * wears the activated Ring of Charos, which opens the colour choice instead. She won't sell one
 * while the player still raises a kitten or a normal cat: following, in the backpack or in a bank
 * ("When you have a normal cat in your inventory or in your bank, she won't give you a kitten."); a
 * bank placeholder is not a cat, and an overgrown cat or one in the menagerie doesn't count. A
 * colour choice emits the event the Varrock diary listens for.
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
/** "Gertrude gives you another kitten.": "Yes please." (Gertrude and Ratcatchers pages) and the quick buy. */
const SOLD_KITTEN_STEP_IDS = new Set(["Q44J0B", "meKySR"]);
const SOLD_KITTEN_TEXT = "Gertrude gives you another kitten.";
/** Transcript:Gertrude, right-click "Kitten" option. */
const STILL_RAISING_TEXT = "Aren't you still raising that other kitten? Only once it's fully grown and it no longer needs your attention will I let you have another kitten.";
const NO_COINS_TEXT = "I'll want 100 coins for a kitten.";
/** Transcript:Kitten, "Kitten is bought from Gertrude": its overheads as it appears. */
const SOLD_KITTEN_LINES = ["Meeooow!", "Miaow!"];

/** The kittens and normal cats she counts as still being raised (items and followers). */
const YOUNG_CAT_ITEMS = [
  "PET_KITTEN", "PET_KITTEN_2", "PET_KITTEN_3", "PET_KITTEN_4", "PET_KITTEN_5", "PET_KITTEN_6",
  "PET_CAT", "PET_CAT_2", "PET_CAT_3", "PET_CAT_4", "PET_CAT_5", "PET_CAT_6", "HELL_KITTEN", "HELL_CAT",
];
const YOUNG_CAT_NPCS = [
  "KITTEN_2", "KITTEN_3", "KITTEN_4", "KITTEN_5", "KITTEN_6", "KITTEN_7", "HELL_KITTEN",
  "CAT", "CAT_2", "CAT_3", "CAT_4", "CAT_5", "CAT_6", "HELLCAT",
];
let youngCatItemIds = null;
let youngCatNpcIds = null;

const RING_CONDITION = /ring of charos\s*\(a\)/i;
const RAISING_A_KITTEN = /already owning a kitten/i;

function identifierSet(names, identifiers) {
  return new Set(names.map((name) => identifiers[name]).filter((id) => Number.isInteger(id)));
}

function hasCharosAEquipped(player, api) {
  return player?.getEquipment?.().get(api.core.Equipment.RING_SLOT)?.getId?.() === RING_OF_CHAROS_A;
}

/** A kitten or normal cat in the backpack or a bank tab; a placeholder (amount 0) is no cat. */
function holdsYoungCatItem(player, api) {
  youngCatItemIds ??= identifierSet(YOUNG_CAT_ITEMS, api.core.ItemIdentifiers);
  const inventory = player?.getInventory?.();
  if (!inventory) return false;
  const ids = [...youngCatItemIds];
  if (ids.some((id) => inventory.getAmount(id) > 0)) return true;
  return (player.getBanks?.() ?? []).some((bank) => bank && ids.some((id) => bank.getAmount?.(id) > 0));
}

function followingYoungCat(player, api) {
  youngCatNpcIds ??= identifierSet(YOUNG_CAT_NPCS, api.core.NpcIdentifiers);
  const request = { player, pet: null };
  api.emitCustomEvent("pets:current", request);
  const id = request.pet?.getId?.();
  return Number.isInteger(id) && youngCatNpcIds.has(id);
}

/** Still raising a kitten or normal cat from her: carried, banked or following. */
function raisingKitten(player, api) {
  return holdsYoungCatItem(player, api) || followingYoungCat(player, api);
}

function kittenQuestComplete(player, api) {
  const request = { player, key: GERTRUDES_CAT_QUEST, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** The colour choice's own checks (the ring may come off, or coins go, while it is open). */
function canChooseKitten(player, api) {
  if (!kittenQuestComplete(player, api)) {
    player.sendMessage("You need to complete Gertrude's Cat first.");
    return false;
  }
  if (!hasCharosAEquipped(player, api)) {
    player.sendMessage("You need to wear the activated Ring of Charos to choose a colour.");
    return false;
  }
  if (raisingKitten(player, api)) {
    player.sendMessage("You are already looking after a cat.");
    return false;
  }
  if (player.getInventory().getAmount(api.core.ItemIdentifiers.COINS) < KITTEN_COST) {
    player.sendMessage(`You need ${KITTEN_COST} coins for another kitten.`);
    return false;
  }
  return true;
}

/**
 * Takes the coins and hands the kitten over as the quest's reward does: it follows the player
 * (with its overheads), or goes into the backpack with a follower already out, or under the player
 * when that is full (the Pets plugin's `pets:summon`).
 */
function sellKitten(api, player, itemId) {
  const inventory = player.getInventory();
  if (inventory.getAmount(api.core.ItemIdentifiers.COINS) < KITTEN_COST) return false;
  inventory.deleteNumber(api.core.ItemIdentifiers.COINS, KITTEN_COST);
  const summon = { player, itemId, following: false, pet: null, summoned: false };
  api.emitCustomEvent("pets:summon", summon);
  if (!summon.summoned) {
    // No pet system answered: the kitten still has to reach the player.
    if (inventory.isFull()) api.core.ItemOnGroundManager?.registerNonGlobal?.(player, new api.core.Item(itemId));
    else inventory.adds(itemId, 1);
  } else if (summon.following && summon.pet) {
    const pet = summon.pet;
    SOLD_KITTEN_LINES.forEach((line, index) => {
      const say = () => { if (pet.isRegistered?.() !== false) pet.forceChat?.(line); };
      // Ours: the Wiki lists the two lines, no capture shows their ticks; one a tick, as the quest's reward.
      api.core.TaskManager.submit(new api.core.CountdownTask(player, index + 1, say));
    });
  }
  return true;
}

const randomKitten = () => KITTEN_ITEM_IDS[Math.floor(Math.random() * KITTEN_ITEM_IDS.length)];

function chooseKittenColour(api, player, colour) {
  if (!Number.isInteger(colour) || colour < 0 || colour >= KITTEN_ITEM_IDS.length) return false;
  if (!canChooseKitten(player, api)) return false;
  if (!sellKitten(api, player, KITTEN_ITEM_IDS[colour])) return false;
  player.sendMessage(`Gertrude gives you a ${KITTEN_COLOURS[colour].toLowerCase()} kitten.`);
  api.emitCustomEvent(KITTEN_COLOUR_CHOSEN_EVENT, { player, colour, itemId: KITTEN_ITEM_IDS[colour] });
  return true;
}

/** Her line with her head: the world's Gertrude is a multinpc whose base has no name; her page's lines name 7284. */
function gertrudeSays(api, player, text) {
  const { DialogueChainBuilder, NpcDialogue, NpcIdentifiers } = api.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, NpcIdentifiers.GERTRUDE, text)));
}

/**
 * Her right-click "Kitten" option, the Wiki's quick buy (Transcript:Gertrude): still raising one, or
 * short of coins, she says so; with the ring worn the colour choice opens; otherwise a kitten of a
 * random colour for 100 coins, in a message box.
 */
function onGertrudeKitten(api, event) {
  const { player } = event ?? {};
  if (!player) return false;
  event.handled = true;
  if (!kittenQuestComplete(player, api)) {
    player.sendMessage("You need to complete Gertrude's Cat first.");
    return true;
  }
  if (raisingKitten(player, api)) return gertrudeSays(api, player, STILL_RAISING_TEXT), true;
  if (player.getInventory().getAmount(api.core.ItemIdentifiers.COINS) < KITTEN_COST) {
    return gertrudeSays(api, player, NO_COINS_TEXT), true;
  }
  if (hasCharosAEquipped(player, api)) {
    openKittenColourMenu(api, player);
    return true;
  }
  sellKitten(api, player, randomKitten());
  const { DialogueChainBuilder, StatementDialogue } = api.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, SOLD_KITTEN_TEXT)));
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

/** "Gertrude gives you another kitten." after "Yes please.": the coins go and the kitten comes, in a message box. */
function onSoldKitten(api, event) {
  const { player } = event;
  event.handled = true;
  if (raisingKitten(player, api) || !sellKitten(api, player, randomKitten())) {
    // The coins or the cat changed since her conditions were asked: nothing is sold.
    event.end = true;
    return;
  }
  event.box = { statement: true };
}

function onDialogueAction(api, event) {
  const { player } = event ?? {};
  if (!player || event.handled) return;
  if (SOLD_KITTEN_STEP_IDS.has(event.stepId)) return onSoldKitten(api, event);
  if (KITTEN_COLOUR_ACTIONS.has(event.stepId)
    || (event.action === "open_interface" && KITTEN_INTERFACE_TARGET.test(String(event.target ?? "")))) {
    event.handled = true;
    if (canChooseKitten(player, api)) openKittenColourMenu(api, player);
  }
}

/** Her page's "While already owning a kitten:" and the [Charm] option's "With the Ring of Charos(a) equipped:". */
function answerCondition(api, { player, npcId, text }) {
  if (api.core.NpcDefinition?.forId?.(npcId)?.getName?.() !== "Gertrude") return null;
  const value = String(text ?? "");
  if (RAISING_A_KITTEN.test(value)) return raisingKitten(player, api);
  if (RING_CONDITION.test(value)) return hasCharosAEquipped(player, api);
  return null;
}

module.exports = {
  name: "Gertrude",
  description: "Lets players buy another kitten from Gertrude after her quest for 100 coins, of a random colour, or of their choice while wearing an activated Ring of Charos.",
  members: true,
  dependsOn: ["Quests", "Pets"],
  register(api) {
    api.onNpcInteraction("Gertrude", { Kitten: onGertrudeKitten.bind(null, api) });
    api.onCustomEvent("npc-dialogue:action", onDialogueAction.bind(null, api));
    api.onCustomEvent("gertrude:initial-kitten-menu", onInitialKittenMenu.bind(null, api));
    api.onNpcDialogueCondition(answerCondition.bind(null, api));
  },
  _test: {
    GERTRUDES_CAT_QUEST, KITTEN_COST, RING_OF_CHAROS_A, KITTEN_ITEM_IDS, KITTEN_COLOURS,
    KITTEN_COLOUR_CHOSEN_EVENT, SOLD_KITTEN_TEXT, STILL_RAISING_TEXT, NO_COINS_TEXT,
    hasCharosAEquipped, holdsYoungCatItem, followingYoungCat, raisingKitten,
    kittenQuestComplete, canChooseKitten, chooseKittenColour, sellKitten, onGertrudeKitten,
    openKittenColourMenu, onDialogueAction, answerCondition,
  },
};
