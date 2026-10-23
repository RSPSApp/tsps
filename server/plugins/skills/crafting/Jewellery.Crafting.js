/**
 * Gold and silver jewellery at a furnace, Family Crest's 'perfect' jewellery, and stringing
 * amulets.
 *
 * Wiki (Crafting#Jewellery): a gold bar used on a furnace with a ring, necklace, amulet or
 * bracelet mould makes the plain gold piece, or the gem-set one when the matching cut gem
 * is carried too. The bar and the gem are used up; the mould is a tool and is kept.
 * Amulets are made unstrung, (u).
 *
 * rsprox captures (recordings 102, 1102, 1105 and 35 more): the furnace's Smelt option opens
 * crafting_gold (446) or silver_crafting (6) instead of the bars menu when the player carries
 * the bar and a mould for it; using the bar on the furnace does the same. silver_crafting opens in
 * the main modal. Choosing an item closes it, plays human_furnace and sound 2725, and makes the
 * first item 2 ticks later, then one every 3 ticks with the animation and sound replayed; no
 * message. The gold menu (446) works the same way; both read the make-quantity from varp 2224
 * (cache scripts 429, 2928 and 3599). Silver products, levels and moulds are cache script
 * 1596's; XP is the Wiki's (Crafting#Silver jewellery, Crafting#Silver, Silvthrill rod,
 * Demonic sigil, Conductor, Silver bolts (unf)). Recipes are in data/crafting.json.
 */
const Shared = require("./Shared.Crafting");

const FURNACE_NAMES = new Set(["Furnace", "Small furnace"]);
/** human_furnace and the smelting sound, as captured for silver. */
const FURNACE_ANIMATION_ID = 899;
const FURNACE_SOUND = 2725;

const GOLD_CRAFTING_INTERFACE = 446;
const SILVER_CRAFTING_INTERFACE = 6;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const MAKE_QUANTITY_VARP = 2224;
const JEWELLERY_MENU_ATTRIBUTE = "crafting:jewellery-menu";


let tables = null;

/** Quantity button component -> amount ("x" asks), from a crafting.json `quantities` object. */
function quantities(entries) {
  return new Map(Object.entries(entries).filter(([key]) => key !== "$comment")
    .map(([component, amount]) => [Number(component), amount]));
}

/** The gold, silver, 'perfect' and stringing recipes from crafting.json, with cache ids, built on first use. */
function data() {
  if (tables) return tables;
  const { Animation, Sound } = Shared.getCore();
  const { gold, silver, perfect, strungAmulets } = Shared.DATA;
  return tables = {
    goldGems: gold.gems.map((name) => (name === null ? null : Shared.itemId(name))),
    goldTypes: gold.types.map((type) => ({
      ...type,
      mouldId: Shared.itemId(type.mould),
      products: type.products.map(([item, level, xp]) => [Shared.itemId(item), level, xp]),
    })),
    goldQuantities: quantities(gold.quantities),
    silver: new Map(silver.products.map((product) => [product.component, {
      ...product,
      itemId: Shared.itemId(product.item),
      mouldId: Shared.itemId(product.mould),
      extra: (product.extra ?? []).map(Shared.itemId),
      amount: product.amount ?? 1,
    }])),
    silverQuantities: quantities(silver.quantities),
    perfect: perfect.recipes.map((recipe) => ({
      ...recipe, itemId: Shared.itemId(recipe.item), mouldId: Shared.itemId(recipe.mould),
    })),
    strung: new Map(strungAmulets.pairs.map(([unstrung, strung]) => [Shared.itemId(unstrung), Shared.itemId(strung)])),
    stringXp: strungAmulets.xp,
    animation: new Animation(FURNACE_ANIMATION_ID),
    sound: new Sound(FURNACE_SOUND, 1, 0, 0),
  };
}

function isFurnace(object) {
  return FURNACE_NAMES.has(object?.getDefinition?.()?.getName?.());
}

/** One furnace product: `bar` plus `extra` used up, `mouldId` kept, `amount` made. */
function hasFurnaceMaterials(player, product) {
  const inventory = player.getInventory();
  return inventory.contains(product.bar) && inventory.contains(product.mouldId) &&
    product.extra.every((id) => inventory.contains(id));
}

function craftFurnaceProduct(player, product) {
  const { PluginManager, Item } = Shared.getCore();
  if (Shared.craftingLevel(player) < product.level) {
    player.sendMessage(`You need a Crafting level of at least ${product.level} to craft this.`);
    return false;
  }
  if (!hasFurnaceMaterials(player, product) ||
      PluginManager.emitCanUseItem(player, product.itemId, "craft") === false) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(product.bar, 1);
  for (const id of product.extra) inventory.deleteNumber(id, 1);
  inventory.addItem(new Item(product.itemId, product.amount));
  Shared.addCraftingXp(player, product.xp);
  return true;
}

/**
 * The cache's menu (script 2940) only gives a product its Craft option when the player has the
 * level and materials, so this is a guard: refuse before the menu closes or anything animates.
 */
function startFurnaceProduct(player, menu, product) {
  if (Shared.craftingLevel(player) < product.level) {
    player.sendMessage(`You need a Crafting level of at least ${product.level} to craft this.`);
    return;
  }
  if (!hasFurnaceMaterials(player, product)) return;
  player.setAttribute(JEWELLERY_MENU_ATTRIBUTE, null);
  player.setInterfaceId(-1);
  player.getPacketSender().closeSubInterface(MAIN_MODAL_TARGET_UID);
  const { animation, sound } = data();
  Shared.startMaking(player, {
    amount: menu.amount, startTick: 0, firstTick: 2, interval: 3, animation, sound,
    anchor: menu.location, resetAnimation: true,
    has: () => hasFurnaceMaterials(player, product),
    make: () => craftFurnaceProduct(player, product),
  });
}

function goldProduct(component) {
  const { ItemIds: I } = Shared.getCore();
  const { goldTypes, goldGems } = data();
  const type = goldTypes.find(({ firstComponent }) => component >= firstComponent && component < firstComponent + goldGems.length);
  if (!type) return null;
  const gemIndex = component - type.firstComponent;
  const [itemId, level, xp] = type.products[gemIndex];
  const gemId = goldGems[gemIndex];
  return { itemId, level, xp, bar: I.GOLD_BAR, mouldId: type.mouldId,
    extra: gemId === null ? [] : [gemId], amount: 1 };
}

function silverProduct(component) {
  const product = data().silver.get(component);
  if (!product || (product.members && !Shared.isMembersWorld())) return null;
  return { ...product, bar: Shared.getCore().ItemIds.SILVER_BAR };
}

/** A quantity or product click on the open gold or silver menu. */
function handleJewelleryButton(event) {
  const { player, buttonId } = event;
  const group = buttonId >>> 16;
  if ((group !== GOLD_CRAFTING_INTERFACE && group !== SILVER_CRAFTING_INTERFACE) || player.getInterfaceId() !== group) return;
  const menu = player.getAttribute(JEWELLERY_MENU_ATTRIBUTE);
  if (!menu || player.getLocation().getDistance(menu.location) > 2) return;
  const component = buttonId & 0xffff;
  const amount = (group === GOLD_CRAFTING_INTERFACE ? data().goldQuantities : data().silverQuantities).get(component);
  event.handled = true;
  if (amount === "x") {
    player.setEnteredAmountAction({ execute: (value) => {
      if (!Number.isInteger(value) || value <= 0 || player.getAttribute(JEWELLERY_MENU_ATTRIBUTE) !== menu) return;
      menu.amount = Math.min(value, 28);
      player.getPacketSender().sendConfig(MAKE_QUANTITY_VARP, menu.amount);
    } });
    player.getPacketSender().sendEnterAmountPrompt("How many would you like to make?");
  } else if (amount !== undefined) {
    menu.amount = amount;
    player.getPacketSender().sendConfig(MAKE_QUANTITY_VARP, amount === 28 ? 0 : amount);
  } else {
    const product = group === GOLD_CRAFTING_INTERFACE ? goldProduct(component) : silverProduct(component);
    if (product) startFurnaceProduct(player, menu, product);
  }
}

function openFurnaceMenu(player, group) {
  Shared.stopCrafting(player);
  player.setAttribute(JEWELLERY_MENU_ATTRIBUTE, { amount: 1, location: player.getLocation().clone() });
  player.setInterfaceId(group);
  player.getPacketSender().sendConfig(MAKE_QUANTITY_VARP, 1).sendSubInterface(MAIN_MODAL_TARGET_UID, group, 0);
}

/** The jewellery menu a furnace opens for what the player carries: gold first, else silver, else none. */
function furnaceMenuFor(player) {
  const I = Shared.getCore().ItemIds;
  const inventory = player.getInventory();
  const { goldTypes, silver } = data();
  if (inventory.contains(I.GOLD_BAR) && goldTypes.some(({ mouldId }) => inventory.contains(mouldId))) {
    return GOLD_CRAFTING_INTERFACE;
  }
  if (inventory.contains(I.SILVER_BAR) && [...silver.values()].some(({ mouldId }) => inventory.contains(mouldId))) {
    return SILVER_CRAFTING_INTERFACE;
  }
  return null;
}

/** Smelt on a furnace: the jewellery menu when a bar and its mould are carried, else Smithing's bars menu. */
function smeltAtFurnace(event) {
  const group = furnaceMenuFor(event.player);
  if (group === null) return false;
  openFurnaceMenu(event.player, group);
}

/** A gold or silver bar on a furnace opens the cache's jewellery menu for it. */
function handleBarOnFurnace(event) {
  const { player, object, itemId } = event;
  const I = Shared.getCore().ItemIds;
  if (!isFurnace(object)) return;
  if (itemId === I.GOLD_BAR) {
    event.handled = true;
    openFurnaceMenu(player, GOLD_CRAFTING_INTERFACE);
  } else if (itemId === I.SILVER_BAR) {
    event.handled = true;
    openFurnaceMenu(player, SILVER_CRAFTING_INTERFACE);
  }
}

function craftPerfectJewellery(player, recipe) {
  const { ItemIds: I, Item } = Shared.getCore();
  const inventory = player.getInventory();
  if (Shared.craftingLevel(player) < recipe.level) {
    player.sendMessage(`You need a Crafting level of at least ${recipe.level} to craft this.`);
    return;
  }
  if (!inventory.contains(I.PERFECT_GOLD_BAR) || !inventory.contains(I.RUBY) || !inventory.contains(recipe.mouldId)) {
    return;
  }
  inventory.deleteNumber(I.PERFECT_GOLD_BAR, 1);
  inventory.deleteNumber(I.RUBY, 1);
  inventory.addItem(new Item(recipe.itemId, 1));
  Shared.addCraftingXp(player, recipe.xp);
  player.sendMessage(`You craft a ${recipe.name}.`);
}

/** Using a 'perfect' gold bar on a furnace, with a ruby and a mould, makes the jewellery. */
function handlePerfectJewellery(event) {
  const { player, object, itemId } = event;
  const I = Shared.getCore().ItemIds;
  if (itemId !== I.PERFECT_GOLD_BAR || !isFurnace(object)) return;

  const inventory = player.getInventory();
  const recipes = data().perfect.filter(
    (recipe) => inventory.contains(recipe.mouldId) && inventory.contains(I.RUBY)
  );
  if (recipes.length === 0) return;

  event.handled = true;
  if (recipes.length === 1) {
    craftPerfectJewellery(player, recipes[0]);
    return;
  }
  // Both moulds carried: let the player choose, as the OSRS jewellery interface does.
  Shared.getApi().sendMultiChatboxPrompt(
    player,
    "What would you like to make?",
    recipes[0].name,
    () => craftPerfectJewellery(player, recipes[0]),
    recipes[1].name,
    () => craftPerfectJewellery(player, recipes[1])
  );
}

/** A ball of wool used on an unstrung amulet, in either order. */
function stringAmulet(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const { ItemIds: I, Item } = Shared.getCore();
  const unstrungId = usedItemId === I.BALL_OF_WOOL ? usedWithItemId : usedItemId;
  const woolId = usedItemId === I.BALL_OF_WOOL ? usedItemId : usedWithItemId;
  const strungId = data().strung.get(unstrungId);
  if (woolId !== I.BALL_OF_WOOL || strungId === undefined) return;

  event.handled = true;
  const inventory = player.getInventory();
  if (!inventory.contains(I.BALL_OF_WOOL) || !inventory.contains(unstrungId)) return;
  inventory.deleteNumber(I.BALL_OF_WOOL, 1);
  inventory.deleteNumber(unstrungId, 1);
  inventory.addItem(new Item(strungId, 1));
  Shared.addCraftingXp(player, data().stringXp);
  player.sendMessage("You put some string on your amulet.");
}

module.exports = function attach(api) {
  api.onObjectInteraction("Furnace", { Smelt: smeltAtFurnace });
  api.onObjectInteraction("Small furnace", { Smelt: smeltAtFurnace });
  api.onItemOnObject(handlePerfectJewellery, { noted: false });
  api.onItemOnObject(handleBarOnFurnace, { noted: false });
  api.onInterfaceActionClick(handleJewelleryButton);
  api.onItemOnItem(stringAmulet, { noted: false });
};
