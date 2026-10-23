/**
 * The max cape (https://oldschool.runescape.wiki/w/Max_cape; rsprox captures for the menus,
 * combining and disassembling).
 *
 * - Mac sells it with its hood for 2,376,000 coins to a player with every skill at 99, through
 *   his Wiki transcript, and buys any max cape back for 80% ("Sell your max cape and hood
 *   back?"), returning the item a combined cape was made from. He hands out spare hoods.
 * - Its options: Teleports (the menu interface "Select a destination", or a submenu entry),
 *   Spellbook, Features ("Select an option": Search, Ring of Life settings, Commune, Stamina
 *   Boost), and worn Home, Crafting Guild, Guild Teleports, Skilling Areas and POH Portals.
 * - Combining: one of the listed capes used on it, with the max hood carried ("You need your max
 *   cape hood to be able to combine those."), makes the combined cape and hood. A knife takes a
 *   combined cape apart again into the max cape and the original item.
 */
const Capes = require("./Common.SkillCapes");
const Teleports = require("./Teleports.SkillCapes");
const Options = require("./Options.SkillCapes");

const MAC = "Mac";
const MAC_HAS_CAPE_VARIANT = "standard-dialogue-if-the-player-has-a-max-cape-in-their-inventory";
const MAC_NO_CAPE_VARIANT = "standard-dialogue-if-the-player-does-not-have-a-max-cape-in-their-bank-or-inventory";
const MAC_HOOD_VARIANT = "using-items-on-mac-using-any-max-hood-variant-on-mac";
const WGS = "while_guthix_sleeps";
const DS2 = "dragon_slayer_ii";
const NAVY = "<col=000080>";
const BLACK = "<col=000000>";
const TELEPORTS_TITLE = "Select a destination";
const TELEPORT_CHOICES = [
  "Warrior's Guild", "Fishing Guild", "Crafting Guild", "Farming Guild", "Otto's Grotto",
  "Carnivorous chinchompas (Feldip Hills)", "Black Chinchompas (Wilderness)", "Hunter Guild", "The Pandemonium",
  ...Teleports.HOUSE_CHOICES,
];
const FEATURE_CHOICES = ["Search", "Ring of Life settings", "Commune", "Stamina Boost"];
const SAILING_FEATURES = ["Teleport Boat (Pandemonium)", "Rename Boat"];

let api;

function coins(player) {
  return player.getInventory().getAmount(Capes.core.ItemIdentifiers.COINS);
}

function isAnyMaxCape(id) {
  return Capes.isMaxCape(id) || Capes.COMBINED_BY_CAPE.has(id);
}

function hoodFor(capeId) {
  return Capes.isMaxCape(capeId) ? Capes.MAX.hood : Capes.COMBINED_BY_CAPE.get(capeId)?.hood ?? null;
}

function maxCapeInInventory(player) {
  return player.getInventory().getItems().map((item) => item?.getId?.() ?? -1).find(isAnyMaxCape) ?? null;
}

function questComplete(player, key) {
  const request = { player, key, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function wearingCatspeak(player) {
  const amulet = player.getEquipment().getItems()[Capes.core.Equipment.AMULET_SLOT];
  return /^catspeak amulet/i.test(Capes.itemName(amulet?.getId?.() ?? -1));
}

// --- Mac ------------------------------------------------------------------------------------

function isMac(event) {
  return (event.definition?.getName?.() ?? Capes.core.CacheDefinitions.getNpc(event.npcId)?.name) === MAC;
}

function macVariant(event) {
  if (!isMac(event)) return null;
  return maxCapeInInventory(event.player) !== null ? MAC_HAS_CAPE_VARIANT : MAC_NO_CAPE_VARIANT;
}

const MAC_CONDITIONS = [
  [/does not have a total level of 2376/i, (player) => !Capes.maxed(player)],
  [/has a total level of 2376/i, (player) => Capes.maxed(player)],
  [/While Guthix Sleeps hasn't been completed/i, (player) => !questComplete(player, WGS)],
  [/While Guthix Sleeps has been completed/i, (player) => questComplete(player, WGS)],
  [/does not have at least two free inventory spaces/i, (player) => player.getInventory().getFreeSlots() < 2],
  [/has at least two free inventory spaces/i, (player) => player.getInventory().getFreeSlots() >= 2],
  [/less than 2,376,000 coins/i, (player) => coins(player) < Capes.MAX.price],
  [/at least 2,376,000 coins/i, (player) => coins(player) >= Capes.MAX.price],
  [/has not completed Dragon Slayer II and does not have a catspeak/i, (player) => !questComplete(player, DS2) && !wearingCatspeak(player)],
  [/has not completed Dragon Slayer II and has a catspeak/i, (player) => !questComplete(player, DS2) && wearingCatspeak(player)],
  [/completed Dragon Slayer II/i, (player) => questComplete(player, DS2)],
  [/only has the cape in their inventory/i, (player) => !hasMatchingHood(player)],
  [/has the matching hood in their inventory/i, (player) => hasMatchingHood(player)],
  [/does not have any free inventory space/i, (player) => player.getInventory().getFreeSlots() === 0],
  [/has at least one free inventory space/i, (player) => player.getInventory().getFreeSlots() > 0],
];

function hasMatchingHood(player) {
  const cape = maxCapeInInventory(player);
  return cape !== null && player.getInventory().contains(hoodFor(cape));
}

function macCondition(event) {
  if (!isMac(event) || typeof event.text !== "string") return null;
  for (const [pattern, answer] of MAC_CONDITIONS) if (pattern.test(event.text)) return answer(event.player);
  return null;
}

/** "How about [amount of coins in inventory] gold?" */
function macLine(request) {
  if (!isMac(request) || typeof request.text !== "string") return;
  request.text = request.text.replace("[amount of coins in inventory]", String(coins(request.player)));
}

function buyMaxCape(player) {
  if (!Capes.maxed(player) || coins(player) < Capes.MAX.price || player.getInventory().getFreeSlots() < 2) return false;
  player.getInventory().deleteNumber(Capes.core.ItemIdentifiers.COINS, Capes.MAX.price);
  player.getInventory().adds(Capes.MAX.cape, 1);
  player.getInventory().adds(Capes.MAX.hood, 1);
  return true;
}

/** Sells the first max cape carried (and its hood, if carried) back for 80%. */
function sellBack(player) {
  const cape = maxCapeInInventory(player);
  if (cape === null) return false;
  const inventory = player.getInventory();
  const hood = hoodFor(cape);
  const combined = Capes.COMBINED_BY_CAPE.get(cape);
  inventory.deleteNumber(cape, 1);
  if (inventory.contains(hood)) inventory.deleteNumber(hood, 1);
  inventory.adds(Capes.core.ItemIdentifiers.COINS, Capes.MAX.sellBack);
  if (combined) inventory.adds(combined.item, 1);
  return true;
}

function ownedMaxCapes(player) {
  const owned = new Set();
  const collect = (container) => {
    for (const item of container.getItems()) {
      const id = item?.getId?.() ?? -1;
      if (isAnyMaxCape(id)) owned.add(id === Capes.MAX.worn ? Capes.MAX.cape : id);
    }
  };
  collect(player.getInventory());
  collect(player.getEquipment());
  for (const bank of player.getBanks()) if (bank) collect(bank);
  return [...owned];
}

/** "Yip. No cost. What cape do you want a hood for?" - one hood per cape the player owns. */
function chooseHood(player) {
  const capes = ownedMaxCapes(player);
  const give = (cape) => {
    if (player.getInventory().getFreeSlots() === 0) return;
    player.getInventory().adds(hoodFor(cape), 1);
    Capes.messageBox(player, "Mac hands you another hood for your cape.");
  };
  if (capes.length === 0) {
    player.sendMessage("You don't have a max cape.");
    return;
  }
  if (capes.length === 1) {
    give(capes[0]);
    return;
  }
  api.sendMultiChatboxPrompt(player, "Select an option",
    ...capes.slice(0, 5).flatMap((cape) => [Capes.itemName(cape), () => give(cape)]));
}

function macAction(event) {
  if (!isMac(event) || typeof event.text !== "string") return;
  const { player, text } = event;
  if (/hands over his cape/i.test(text)) {
    if (!buyMaxCape(player)) {
      player.sendMessage("You don't have enough coins or inventory space.");
      event.handled = true;
      event.end = true;
    }
  } else if (/You sell your cape (?:and hood )?back to Mac/i.test(text)) {
    sellBack(player);
    event.handled = true;
  } else if (/which max hood variant/i.test(text)) {
    event.handled = true;
    event.end = true;
    chooseHood(player);
  }
}

function sellPrompt(player) {
  const price = Capes.core.Misc.insertCommasToNumber(String(Capes.MAX.sellBack));
  api.sendMultiChatboxPrompt(player, "Sell your max cape and hood back?",
    `Yes - receive ${price} coins.`, () => {
      if (sellBack(player)) Capes.messageBox(player, "You sell your cape and hood back to Mac.");
    },
    "No, I've changed my mind.", () => {});
}

function itemOnMac(event) {
  if (Capes.core.CacheDefinitions.getNpc(event.npcId)?.name !== MAC) return;
  if (isAnyMaxCape(event.itemId)) {
    event.handled = true;
    sellPrompt(event.player);
  } else if (event.itemId === Capes.MAX.hood || [...Capes.COMBINED_BY_CAPE.values()].some((c) => c.hood === event.itemId)) {
    event.handled = true;
    Capes.playTranscript(event.player, event.target, MAC_HOOD_VARIANT);
  }
}

// --- The cape's options ---------------------------------------------------------------------

function features(player, sub) {
  const choice = sub ?? null;
  const run = (label) => {
    if (label === "Search") Options.searchMenu(player);
    else if (/^Ring of Life/i.test(label)) Options.ringOfLifeMenu(player);
    else if (label === "Commune") Options.commune(player);
    else if (label === "Stamina Boost") Options.staminaBoost(player);
    else if (/Teleport Boat/i.test(label)) Teleports.goTo(player, "Teleport boat to the Pandemonium");
    else if (/Rename Boat/i.test(label)) Teleports.goTo(player, "Rename boat");
    else Teleports.goTo(player, label);
  };
  if (choice) run(choice);
  else api.sendMultiChatboxPrompt(player, "Select an option",
    ...FEATURE_CHOICES.flatMap((label) => [label, () => run(label)]),
    "More...", () => api.sendMultiChatboxPrompt(player, "Select an option",
      ...SAILING_FEATURES.flatMap((label) => [label, () => run(label)]),
      "Cancel", () => {}));
}

function spellbook(player, sub) {
  if (sub === "Check") Options.checkSpellbook(player);
  else if (sub) Options.changeSpellbook(player, sub);
  else Options.spellbookMenu(player);
}

/** A worn option whose submenu wasn't used: its entries as a chat menu (the house portals as the menu interface). */
function submenu(player, event, option) {
  const definition = Capes.core.CacheDefinitions.getItem(event.itemId);
  const op = event.clickType - 2;
  const labels = Capes.wornSubOptions(definition, op);
  if (option === "POH Portals") Teleports.openMenu(player, Teleports.HOUSE_MENU_TITLE, labels.length ? labels : Teleports.HOUSE_CHOICES);
  else Teleports.chooseFrom(player, "Select an option", labels.slice(0, 5));
}

function maxCapeOption(event) {
  if (!Capes.isMaxCape(event.itemId) && !Capes.COMBINED_BY_CAPE.has(event.itemId)) return;
  const { option, sub } = Capes.itemOption(event);
  const player = event.player;
  switch (option) {
    case "Teleports":
      if (sub) Teleports.goTo(player, sub);
      else Teleports.openMenu(player, TELEPORTS_TITLE, TELEPORT_CHOICES);
      break;
    case "Spellbook":
      spellbook(player, sub);
      break;
    case "Features":
      features(player, sub);
      break;
    case "Home":
    case "Crafting Guild":
      Teleports.goTo(player, option);
      break;
    case "Guild Teleports":
    case "Skilling Areas":
    case "POH Portals":
      if (sub) Teleports.goTo(player, sub);
      else submenu(player, event, option);
      break;
    case "Commune":
      Options.commune(player);
      break;
    default:
      return;
  }
  event.handled = true;
}

// --- Combining and disassembling ------------------------------------------------------------

function combine(player, combined) {
  const inventory = player.getInventory();
  if (!inventory.contains(Capes.MAX.cape) || !inventory.contains(combined.item) || !inventory.contains(Capes.MAX.hood)) return;
  inventory.deleteNumber(Capes.MAX.cape, 1);
  inventory.deleteNumber(Capes.MAX.hood, 1);
  inventory.deleteNumber(combined.item, 1);
  inventory.adds(combined.cape, 1);
  inventory.adds(combined.hood, 1);
  const chain = new Capes.core.DialogueChainBuilder();
  chain.add(new Capes.core.ItemStatementDialogue(0, combined.cape, `You combine your ${combined.label} and max cape as one.`));
  player.getDialogueManager().startDialogues(chain);
}

function combineOnUse(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const other = usedItemId === Capes.MAX.cape ? usedWithItemId : usedWithItemId === Capes.MAX.cape ? usedItemId : null;
  if (other === null) return;
  if (other === Capes.objId(Capes.DATA.combinedNotBlessed)) {
    event.handled = true;
    player.sendMessage("You can only combine a Blessed dizana's quiver with a max cape.");
    return;
  }
  const combined = Capes.COMBINED_BY_ITEM.get(other);
  if (!combined) return;
  event.handled = true;
  if (!player.getInventory().contains(Capes.MAX.hood)) {
    player.sendMessage("You need your max cape hood to be able to combine those.");
    return;
  }
  const name = Capes.itemName(other);
  if (combined.locked) {
    api.sendMultiChatboxPrompt(player, `Combine your ${name} with your max cape?`,
      "Yes - combine this item with your max cape.", () => combine(player, combined),
      "No! I don't want to lose my item.", () => {});
  } else {
    api.sendMultiChatboxPrompt(player, `You will lose your ${combined.label} if you proceed!`,
      "Yes - combine this item with your max cape and lose it.", () => combine(player, combined),
      "No! I don't want to lose my item.", () => {});
  }
}

function disassemble(player, combined) {
  const inventory = player.getInventory();
  if (!inventory.contains(combined.cape)) return;
  const name = Capes.itemName(combined.cape);
  inventory.deleteNumber(combined.cape, 1);
  inventory.adds(Capes.MAX.cape, 1);
  inventory.adds(combined.item, 1);
  // Not captured (the recorded player's hoods were banked): a carried matching hood turns back
  // into a max hood too, so the pair can be combined again.
  if (inventory.contains(combined.hood)) {
    inventory.deleteNumber(combined.hood, 1);
    inventory.adds(Capes.MAX.hood, 1);
  }
  const chain = new Capes.core.DialogueChainBuilder();
  chain.add(new Capes.core.DoubleItemStatementDialogue(0, Capes.MAX.cape, combined.item,
    `You disassemble your ${NAVY}${name}${BLACK} back into its original form.`));
  player.getDialogueManager().startDialogues(chain);
}

function disassembleOnUse(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const knife = Capes.core.ItemIdentifiers.KNIFE;
  const capeId = usedItemId === knife ? usedWithItemId : usedWithItemId === knife ? usedItemId : null;
  const combined = capeId === null ? null : Capes.COMBINED_BY_CAPE.get(capeId);
  if (!combined) return;
  event.handled = true;
  const name = Capes.itemName(combined.cape);
  Capes.talk(player, [
    { statement: `Are you sure you wish to disassemble your ${name}? You'll receive ${NAVY}1x Max cape${BLACK} and ${NAVY}1x ${Capes.itemName(combined.item)}${BLACK}.` },
    { statement: `If you proceed you'll need both a ${NAVY}Max cape${BLACK} and a ${NAVY}Max hood${BLACK} to make it again.` },
    () => api.sendMultiChatboxPrompt(player, `Disassemble the ${NAVY}${name}${BLACK}?`,
      "Yes, disassemble it.", () => disassemble(player, combined),
      "No, leave it as is.", () => {}),
  ]);
}

module.exports = function attachMaxCape(pluginApi) {
  api = pluginApi;
  api.onNpcDialogueVariant(macVariant);
  api.onNpcDialogueCondition(macCondition);
  api.onCustomEvent("npc-dialogue:line", macLine);
  api.onCustomEvent("npc-dialogue:action", macAction);
  api.onItemOnNpc(itemOnMac);
  api.onItemAction(maxCapeOption);
  // A mounted cape (house cape hanger) runs its option as the item would: { player, itemId, option }.
  api.onCustomEvent("skillcape:operate", (request) => { if (!request.handled) maxCapeOption(request); });
  api.onItemOnItem(combineOnUse);
  api.onItemOnItem(disassembleOnUse);
};

module.exports._test = { macVariant, macCondition, macAction, buyMaxCape, sellBack, combineOnUse, combine, disassemble, maxCapeOption, TELEPORT_CHOICES };
