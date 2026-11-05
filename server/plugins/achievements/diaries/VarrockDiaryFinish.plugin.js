/**
 * The five Varrock Diary tasks whose normal gameplay was still absent: the Apothecary's
 * strength-potion service, Gertrude's colour choice for a kitten, picking a white tree fruit,
 * the Fancy Dress Seller's spottier cape, and the Varrock Palace yew roots.
 *
 * The catalogue and progress dispatch live in AchievementDiaries; the other Varrock producers
 * live in VarrockDiary and their own skills. This file only names these five tasks and supplies
 * the missing ordinary actions. OSRS Wiki: Varrock Diary, Apothecary, Kitten, White tree fruit,
 * Spottier cape.
 */
const DIARY = "varrock";

const TASK = {
  apothecary: "have-the-apothecary-in-varrock-make-you-a-streng",
  kittenColour: "select-a-colour-for-your-kitten",
  whiteTreeFruit: "pick-a-white-tree-fruit",
  spottierCape: "trade-furs-with-the-fancy-dress-seller-for-a-spo",
  yewRoots: "collect-at-least-2-yew-roots-from-the-tree-patch",
};

/** Apothecary's shop (data/definitions/shops.json) and the Wiki's strength-potion recipe. */
const APOTHECARY_SHOP_ID = 1423;
const STRENGTH_POTION_4 = 113;
const LIMPWURT_ROOT = 225;
const RED_SPIDERS_EGGS = 223;
const STRENGTH_POTION_COST = 5;

/** Gertrude: 100 coins for a kitten, colour chosen only with the activated ring equipped. */
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

/** Gertrude's post-quest dialogue already asks for these interface actions. */
const CAT_NPC_IDENTIFIERS = [
  "CAT", "CAT_2", "CAT_3", "CAT_4", "CAT_5", "CAT_6", "HELLCAT",
  "KITTEN_2", "KITTEN_3", "KITTEN_4", "KITTEN_5", "KITTEN_6", "KITTEN_7", "HELL_KITTEN",
  "OVERGROWN_CAT", "OVERGROWN_CAT_2", "OVERGROWN_CAT_3", "OVERGROWN_CAT_4",
  "OVERGROWN_CAT_5", "OVERGROWN_CAT_6", "OVERGROWN_HELLCAT",
];
let catNpcIds = null;

/** Asyff's Custom Fur Clothing trade: two dashing kebbit furs and 800 coins at 66 Hunter. */
const ASYFF_NPC_ID = 2887;
const CUSTOM_FUR_TARGET = "Custom Fur Clothing";
const DASHING_KEBBIT_FUR = 10127;
const SPOTTIER_CAPE = 10071;
const SPOTTIER_FURS = 2;
const SPOTTIER_COST = 800;
const SPOTTIER_HUNTER_LEVEL = 66;
const SPOTTIER_TRADED_ATTRIBUTE = "varrock-diary:spottier-cape-traded";

/** Varrock Palace yew tree patch (plugins/skills/data/farming-data.json patch 8390). */
const YEW_ROOTS = 6049;
const VARROCK_TREE_PATCH = { id: 8390, x: 3228, y: 3458, z: 0 };

function emit(registry, player, task) {
  if (!player) return;
  registry.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

// ---------------------------------------------------------------- Apothecary

function apothecaryBuyPrice(registry, event) {
  if (event?.shopId !== APOTHECARY_SHOP_ID || event?.itemId !== STRENGTH_POTION_4) return;
  event.price = STRENGTH_POTION_COST;
}

/**
 * The shop's own stock is infinite, but the service needs the Wiki's materials. cap the
 * quantity so the purchase cannot take more roots/eggs than the player has.
 */
function apothecaryBuyLimit(registry, event) {
  if (event?.shopId !== APOTHECARY_SHOP_ID || event?.itemId !== STRENGTH_POTION_4) return;
  const inventory = event.player?.getInventory?.();
  if (!inventory) return;
  const materials = Math.min(inventory.getAmount(LIMPWURT_ROOT), inventory.getAmount(RED_SPIDERS_EGGS));
  const affordable = Math.floor(inventory.getAmount(registry.core.ItemIdentifiers.COINS) / STRENGTH_POTION_COST);
  const limit = Math.max(0, Math.min(materials, affordable));
  event.limit = limit;
  if (limit > 0) return;
  event.message = materials <= 0
    ? "The Apothecary needs a limpwurt root and red spiders' eggs to make a strength potion."
    : "You need 5 coins for the strength potion.";
}

/** The shop has already taken 5 coins each; the service consumes one root and one egg each. */
function apothecaryPurchase(registry, event) {
  if (event?.shopId !== APOTHECARY_SHOP_ID || event?.itemId !== STRENGTH_POTION_4) return;
  const inventory = event.player?.getInventory?.();
  const amount = Number(event.amount) || 0;
  if (!inventory || amount <= 0) return;
  if (inventory.getAmount(LIMPWURT_ROOT) < amount || inventory.getAmount(RED_SPIDERS_EGGS) < amount) return;
  inventory.deleteNumber(LIMPWURT_ROOT, amount);
  inventory.deleteNumber(RED_SPIDERS_EGGS, amount);
  emit(registry, event.player, TASK.apothecary);
}

// ---------------------------------------------------------------- kitten colour

function hasCharosAEquipped(player, registry) {
  return player?.getEquipment?.().get(registry.core.Equipment.RING_SLOT)?.getId?.() === RING_OF_CHAROS_A;
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

function followingCat(player, registry) {
  if (!catNpcIds) {
    catNpcIds = new Set(CAT_NPC_IDENTIFIERS
      .map((name) => registry.core.NpcIdentifiers[name])
      .filter((id) => Number.isInteger(id)));
  }
  const request = { player, pet: null };
  registry.emitCustomEvent("pets:current", request);
  const id = request.pet?.getId?.();
  return Number.isInteger(id) && catNpcIds.has(id);
}

function kittenQuestComplete(player, registry) {
  const request = { player, key: GERTRUDES_CAT_QUEST, complete: false };
  registry.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function canChooseKitten(player, registry) {
  if (!kittenQuestComplete(player, registry)) {
    player.sendMessage("You need to complete Gertrude's Cat first.");
    return false;
  }
  if (!hasCharosAEquipped(player, registry)) {
    player.sendMessage("You need to wear the activated Ring of Charos to choose a colour.");
    return false;
  }
  if (holdsKittenItem(player) || followingCat(player, registry)) {
    player.sendMessage("You are already looking after a cat.");
    return false;
  }
  if (player.getInventory().getAmount(registry.core.ItemIdentifiers.COINS) < KITTEN_COST) {
    player.sendMessage(`You need ${KITTEN_COST} coins for another kitten.`);
    return false;
  }
  if (player.getInventory().isFull()) {
    player.sendMessage("You need a free inventory slot for a kitten.");
    return false;
  }
  return true;
}

function chooseKittenColour(registry, player, colour) {
  if (!Number.isInteger(colour) || colour < 0 || colour >= KITTEN_ITEM_IDS.length) return false;
  if (!canChooseKitten(player, registry)) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(registry.core.ItemIdentifiers.COINS, KITTEN_COST);
  inventory.adds(KITTEN_ITEM_IDS[colour], 1);
  player.sendMessage(`Gertrude gives you a ${KITTEN_COLOURS[colour].toLowerCase()} kitten.`);
  emit(registry, player, TASK.kittenColour);
  return true;
}

/** Gertrude's right-click "Kitten" option is the Wiki's colour-picking shortcut. */
function onGertrudeKitten(registry, event) {
  const { player } = event ?? {};
  if (!player || !canChooseKitten(player, registry)) return false;
  event.handled = true;
  openKittenColourMenu(registry, player);
  return true;
}

function openKittenColourMenu(registry, player, page = 0) {
  const first = page * COLOURS_PER_PAGE;
  const colours = KITTEN_COLOURS.slice(first, first + COLOURS_PER_PAGE);
  const labels = [...colours];
  const more = first + COLOURS_PER_PAGE < KITTEN_COLOURS.length;
  labels.push(more ? "More colours..." : "Cancel");
  const menu = new registry.core.OptionDialogue(0, {
    executeOption(option) {
      const pick = Number(option) - 1;
      if (pick >= 0 && pick < colours.length) {
        player.getPacketSender().sendInterfaceRemoval();
        chooseKittenColour(registry, player, first + pick);
      } else if (more && pick === colours.length) {
        player.getPacketSender().sendInterfaceRemoval();
        openKittenColourMenu(registry, player, page + 1);
      } else {
        player.getPacketSender().sendInterfaceRemoval();
      }
    },
  }, ...labels).setTitle("Select a colour for your kitten");
  player.getDialogueManager().startDialogues(new registry.core.DialogueChainBuilder().add(menu));
}

// ---------------------------------------------------------------- spottier cape

function tradeSpottierCape(player, registry) {
  const inventory = player.getInventory();
  if (player.getSkillManager().getCurrentLevel(registry.core.Skill.HUNTER) < SPOTTIER_HUNTER_LEVEL) {
    player.sendMessage(`You need ${SPOTTIER_HUNTER_LEVEL} Hunter to make a spottier cape.`);
    return false;
  }
  if (inventory.getAmount(DASHING_KEBBIT_FUR) < SPOTTIER_FURS) {
    player.sendMessage(`You need ${SPOTTIER_FURS} dashing kebbit furs.`);
    return false;
  }
  if (inventory.getAmount(registry.core.ItemIdentifiers.COINS) < SPOTTIER_COST) {
    player.sendMessage(`You need ${SPOTTIER_COST} coins.`);
    return false;
  }
  inventory.deleteNumber(DASHING_KEBBIT_FUR, SPOTTIER_FURS);
  inventory.deleteNumber(registry.core.ItemIdentifiers.COINS, SPOTTIER_COST);
  inventory.adds(SPOTTIER_CAPE, 1);
  player.setAttribute(SPOTTIER_TRADED_ATTRIBUTE, true);
  player.sendMessage("Asyff makes you a spottier cape.");
  return true;
}

/** Asyff's own "Fur Clothing" option opens the same made-to-order trade. */
function onAsyffFurClothing(registry, event) {
  const { player } = event ?? {};
  if (!player) return false;
  event.handled = true;
  openSpottierCapeMenu(registry, player);
  return true;
}

function openSpottierCapeMenu(registry, player) {
  const menu = new registry.core.OptionDialogue(0, {
    executeOption(option) {
      player.getPacketSender().sendInterfaceRemoval();
      if (Number(option) === 1) tradeSpottierCape(player, registry);
    },
  }, `Spottier cape (${SPOTTIER_FURS} dashing kebbit furs, ${SPOTTIER_COST} coins)`, "Cancel")
    .setTitle("Custom Fur Clothing");
  player.getDialogueManager().startDialogues(new registry.core.DialogueChainBuilder().add(menu));
}

function equippedSpottierCape(registry, event) {
  const { player } = event ?? {};
  if (!player?.isRegistered?.()) return;
  const cape = player.getEquipment?.().get(registry.core.Equipment.CAPE_SLOT);
  if (cape?.getId?.() !== SPOTTIER_CAPE) return;
  if (player.getAttribute(SPOTTIER_TRADED_ATTRIBUTE) !== true) return;
  emit(registry, player, TASK.spottierCape);
}

// ---------------------------------------------------------------- shared dialogue

function onDialogueAction(registry, event) {
  const { player } = event ?? {};
  if (!player || event.handled) return;
  if (KITTEN_COLOUR_ACTIONS.has(event.stepId)
    || (event.action === "open_interface" && KITTEN_INTERFACE_TARGET.test(String(event.target ?? "")))) {
    event.handled = true;
    if (canChooseKitten(player, registry)) openKittenColourMenu(registry, player);
    return;
  }
  if (event.npcId === ASYFF_NPC_ID && event.action === "open_interface" && event.target === CUSTOM_FUR_TARGET) {
    event.handled = true;
    openSpottierCapeMenu(registry, player);
  }
}

// ---------------------------------------------------------------- yew roots / white tree

function rootsCollected(registry, event) {
  if (!event?.player || event.crop !== "YEW" || event.itemId !== YEW_ROOTS) return;
  const patch = event.patch;
  if (!patch || patch.id !== VARROCK_TREE_PATCH.id || patch.x !== VARROCK_TREE_PATCH.x
    || patch.y !== VARROCK_TREE_PATCH.y || patch.z !== VARROCK_TREE_PATCH.z) return;
  if ((Number(event.amount) || 0) < 2) return;
  emit(registry, event.player, TASK.yewRoots);
}

function whiteTreeFruitPicked(registry, event) {
  if (!event?.player) return;
  emit(registry, event.player, TASK.whiteTreeFruit);
}

module.exports = {
  name: "VarrockDiaryFinish",
  members: true,
  dependsOn: ["AchievementDiaries", "Quests", "Pets"],
  register(registry) {
    registry.persistAttribute(SPOTTIER_TRADED_ATTRIBUTE, false);
    registry.onCustomEvent("shop:buy-price", apothecaryBuyPrice.bind(null, registry));
    registry.onCustomEvent("shop:buy-limit", apothecaryBuyLimit.bind(null, registry));
    registry.onCustomEvent("shop:purchase", apothecaryPurchase.bind(null, registry));
    registry.onCustomEvent("npc-dialogue:action", onDialogueAction.bind(null, registry));
    registry.onNpcInteraction("Gertrude", { Kitten: onGertrudeKitten.bind(null, registry) });
    registry.onNpcInteraction("Asyff", { "Fur Clothing": onAsyffFurClothing.bind(null, registry) });
    registry.onCustomEvent("equipment:changed", equippedSpottierCape.bind(null, registry));
    registry.onCustomEvent("farming:roots", rootsCollected.bind(null, registry));
    registry.onCustomEvent("garden-of-tranquillity:white-tree-fruit", whiteTreeFruitPicked.bind(null, registry));
  },
  _test: {
    TASK, APOTHECARY_SHOP_ID, STRENGTH_POTION_4, STRENGTH_POTION_COST, KITTEN_ITEM_IDS,
    KITTEN_COLOURS, KITTEN_COST, SPOTTIER_CAPE, DASHING_KEBBIT_FUR, SPOTTIER_COST,
    SPOTTIER_HUNTER_LEVEL, SPOTTIER_TRADED_ATTRIBUTE, YEW_ROOTS, VARROCK_TREE_PATCH,
    apothecaryBuyPrice, apothecaryBuyLimit, apothecaryPurchase, hasCharosAEquipped,
    holdsKittenItem, followingCat, kittenQuestComplete, canChooseKitten, chooseKittenColour,
    openKittenColourMenu, onGertrudeKitten, tradeSpottierCape, openSpottierCapeMenu,
    onAsyffFurClothing, equippedSpottierCape,
    onDialogueAction, rootsCollected, whiteTreeFruitPicked,
  },
};
