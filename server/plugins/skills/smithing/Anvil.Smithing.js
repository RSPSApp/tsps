/**
 * Anvil smithing: the smithing interface (312) for the best bar the player can work, its
 * 1/5/10/X/All quantity row, and the smith loop. Interface 312 draws its own products from
 * varbit smithing_bar_type (client scripts 415 -> 430), so the server only sets the varbit.
 *
 * Captured (rsprox, docs/smithing.md): opening sets smithing_bar_type and varp makexcrafting
 * (the remembered quantity, All when none has been chosen yet); a click sets
 * smithing_bar_lasttype/smithing_item_lasttype, closes the interface and plays human_smithing
 * (898) on the same tick, then each item comes 3 ticks later and every 5 after, with "You hammer
 * the steel and make ten dart tips." Smith with no bar: a message box "You should select an item
 * from your inventory and use it on the anvil."
 */
const Core = require("./Core.Smithing");
const Data = require("./Data.Smithing");
const Sessions = require("./Sessions.Smithing");
const Godswords = require("./Godswords.Smithing");
const DragonShields = require("./DragonShields.Smithing");
const { hasHammer, messageBox, varbit, varp, hammering } = require("./Common.Smithing");

const MAIN_MODAL = "toplevel_osrs_stretch:mainmodal";
const SMITHING_INTERVAL_TICKS = 5;
const FIRST_DELAY_TICKS = 3;
const NO_BAR_MESSAGE = "You should select an item from your inventory and use it on the anvil.";
const ALL_QUANTITY_CAP = 28;
/** The quantity row left of the products: components 3-7 select 1, 5, 10, X and All. */
const QUANTITY_MODE_COMPONENTS = new Map([[3, 1], [4, 5], [5, 10], [6, "x"], [7, "all"]]);
const FIRST_PRODUCT_COMPONENT = 9;
const LAST_PRODUCT_COMPONENT = 38;
// The rusted anvil in Lumbridge can only be used to smith bronze.
const RUSTED_ANVIL_BRONZE_ONLY_MESSAGE = "You can only use bronze bars to smith on this anvil.";

/** player -> the bar the open interface shows. */
const OPEN_MENUS = new Map();
/** player -> the selected quantity ("all", "x" amount or a number); kept until disconnect. */
const SELECTED_QUANTITY = new Map();

const buttonId = (component) => (Data.smithingInterface() << 16) | component;
const mainModal = () => Core.CacheDefinitions.getComponentId(MAIN_MODAL);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const selectedQuantity = (player) => SELECTED_QUANTITY.get(player) ?? "all";

function smithingLevel(player) {
  return player.getSkillManager().getCurrentLevel(Core.Skill.SMITHING);
}

/** Members products on a free world, and products behind a quest the client greys out. */
function unlocked(player, product) {
  if (product.members && !Core.WorldDefinition.isMembersWorld()) {
    player.sendMessage("You need to be on a members' world to make that.");
    return false;
  }
  if (product.quest && !Core.questComplete(player, product.quest)) {
    player.sendMessage(`You need to complete ${Data.questName(product.quest)} to make that.`);
    return false;
  }
  return true;
}

function canSmith(player, product) {
  const inventory = player.getInventory();
  if (!hasHammer(player)) {
    player.sendMessage("You need a hammer to work metal bars.");
    return false;
  }
  if (smithingLevel(player) < product.level) {
    player.sendMessage(`You need a Smithing level of at least ${product.level} to smith this item.`);
    return false;
  }
  if (inventory.getAmount(product.barId) < product.bars) {
    player.sendMessage("You don't have enough bars to smith that item.");
    return false;
  }
  return true;
}

function smithOnce(player, product) {
  if (!canSmith(player, product)) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(product.barId, product.bars);
  inventory.addItem(new Core.Item(product.itemId, product.amount));
  player.performAnimation(hammering());
  player.getSkillManager().addExperiences(Core.Skill.SMITHING, product.xp);
  player.sendMessage(`You hammer the ${product.metal} and make ${product.phrase}.`);
  Core.api.emitCustomEvent("smithing:success", { player, skill: Core.Skill.SMITHING, itemId: product.itemId });
  return true;
}

function startSmithing(player, product, amount) {
  if (!product || !Number.isInteger(amount) || amount <= 0 || !unlocked(player, product) || !canSmith(player, product)) return false;
  // All and X stop at what the bars cover, without an out-of-bars message.
  const most = Math.floor(player.getInventory().getAmount(product.barId) / product.bars);
  Sessions.start(player, {
    type: "smith",
    remaining: Math.min(amount, most),
    interval: SMITHING_INTERVAL_TICKS,
    firstDelay: FIRST_DELAY_TICKS,
    step: (smith) => smithOnce(smith, product),
  });
  player.performAnimation(hammering());
  return true;
}

/**
 * The bar to show: the one used on the anvil, else the best carried bar the player can work
 * something from, else the lowest carried bar (the interface reds out what they can't make).
 */
function chooseBar(player, preferredBarId) {
  const inventory = player.getInventory();
  if (Number.isInteger(preferredBarId) && inventory.contains(preferredBarId) && Data.BAR_TYPE_BY_BAR.has(preferredBarId)) {
    return preferredBarId;
  }
  const level = smithingLevel(player);
  const carried = Data.anvilBars().filter((bar) => inventory.contains(bar));
  const workable = carried.filter((bar) => Data.productsFor(bar).some((product) => level >= product.level));
  return workable.at(-1) ?? carried[0] ?? null;
}

/** Blurite isn't on the smithing interface: its bolts and limbs come from a make-X menu. */
function openBluriteMenu(player) {
  const { CreationMenu } = Core;
  const products = Data.bluriteProducts();
  const bars = player.getInventory().getAmount(Core.ItemIdentifiers.BLURITE_BAR);
  player.getPacketSender().sendCreationMenu(
    new CreationMenu("What would you like to make?", products.map((product) => product.itemId), {
      execute: (itemId, amount) => startSmithing(player, products.find((product) => product.itemId === itemId), amount),
    }, { maxAmount: Math.max(1, bars) })
  );
}

function openInterface(player, preferredBarId = null) {
  const blurite = Core.ItemIdentifiers.BLURITE_BAR;
  if (preferredBarId === blurite || preferredBarId == null && chooseBar(player, null) == null && player.getInventory().contains(blurite)) {
    openBluriteMenu(player);
    return true;
  }
  const bar = chooseBar(player, preferredBarId);
  if (bar == null) {
    messageBox(player, NO_BAR_MESSAGE);
    return false;
  }
  OPEN_MENUS.set(player, bar);
  const selected = selectedQuantity(player);
  const highlight = selected === "all"
    ? Math.min(ALL_QUANTITY_CAP, player.getInventory().getAmount(bar))
    : selected;
  player.setInterfaceId(Data.smithingInterface());
  player
    .getPacketSender()
    .sendVarbit(varbit("smithing_bar_type"), Data.BAR_TYPE_BY_BAR.get(bar))
    .sendConfig(varp("makexcrafting"), highlight)
    .sendSubInterface(mainModal(), Data.smithingInterface(), 0);
  for (const component of range(FIRST_PRODUCT_COMPONENT, LAST_PRODUCT_COMPONENT)) {
    player.getPacketSender().sendInterfaceFlags(buttonId(component), 2);
  }
  return true;
}

function closeInterface(player) {
  OPEN_MENUS.delete(player);
  if (!player?.isRegistered?.() || player.getInterfaceId() !== Data.smithingInterface()) return;
  player.setInterfaceId(-1);
  player.getPacketSender().closeSubInterface(mainModal());
}

/** Closes the interface of a player who walked off, died or logged out. */
function closeAbandonedMenus() {
  for (const player of OPEN_MENUS.keys()) {
    if (!player?.isRegistered?.() || player.getMovementQueue().size() > 0 || player.getForceMovement() != null) {
      closeInterface(player);
    }
  }
}

function selectQuantity({ player, buttonId: id }) {
  const mode = QUANTITY_MODE_COMPONENTS.get(id & 0xffff);
  if (mode === undefined) return false;
  if (mode !== "x") {
    SELECTED_QUANTITY.set(player, mode);
    return true;
  }
  player.setEnteredAmountAction({
    execute: (amount) => {
      if (Number.isInteger(amount) && amount > 0) SELECTED_QUANTITY.set(player, amount);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt("How many would you like to make?");
  return true;
}

function chooseProduct({ player, buttonId: id }) {
  const bar = OPEN_MENUS.get(player);
  if (player.getInterfaceId() !== Data.smithingInterface() || bar == null) return false;
  const product = Data.productsFor(bar).find((candidate) => candidate.component === (id & 0xffff));
  if (!product) return false;

  const selected = selectedQuantity(player);
  const started = startSmithing(player, product, selected === "all" ? ALL_QUANTITY_CAP : selected);
  if (!started) return false;
  player
    .getPacketSender()
    .sendVarbit(varbit("smithing_bar_lasttype"), Data.BAR_TYPE_BY_BAR.get(bar))
    .sendVarbit(varbit("smithing_item_lasttype"), product.slotIndex);
  closeInterface(player);
  return true;
}

function anvilAccess(event) {
  const request = { player: event.player, object: event.object, denied: false };
  Core.api.emitCustomEvent("smithing:anvil-access", request);
  return !request.denied;
}

/** Smith: godsword pieces or a visage and anti-dragon shield go first, then the interface. */
function smith(event) {
  if (!anvilAccess(event)) return;
  const { player } = event;
  if (Godswords.smithAtAnvil(player) || DragonShields.smithAtAnvil(player)) return;
  openInterface(player);
}

function smithRustedAnvil(event) {
  if (!anvilAccess(event)) return;
  if (!event.player.getInventory().contains(Core.ItemIdentifiers.BRONZE_BAR)) {
    event.player.sendMessage(RUSTED_ANVIL_BRONZE_ONLY_MESSAGE);
    return;
  }
  openInterface(event.player, Core.ItemIdentifiers.BRONZE_BAR);
}

/** A bar used on an anvil opens the interface on that bar. */
function useOnAnvil(event) {
  const { player, object, itemId } = event;
  if (!Data.BAR_TYPE_BY_BAR.has(itemId) && itemId !== Core.ItemIdentifiers.BLURITE_BAR) return;
  event.handled = true;
  if (!anvilAccess(event)) return;
  if (object.getDefinition().getName() === "Rusted anvil" && itemId !== Core.ItemIdentifiers.BRONZE_BAR) {
    player.sendMessage(RUSTED_ANVIL_BRONZE_ONLY_MESSAGE);
    return;
  }
  openInterface(player, itemId);
}

function forget(player) {
  OPEN_MENUS.delete(player);
  SELECTED_QUANTITY.delete(player);
}

function watchMenus() {
  Sessions.everyTick(closeAbandonedMenus);
}

module.exports = function attach(api) {
  api.onServerStartup(watchMenus);
  api.onObjectInteraction("Anvil", { Smith: smith });
  api.onObjectInteraction("An experimental anvil", { Use: smith });
  api.onObjectInteraction("Rusted anvil", { Smith: smithRustedAnvil });
  api.onInterfaceActionButton([...QUANTITY_MODE_COMPONENTS.keys()].map(buttonId), selectQuantity);
  api.onInterfaceActionButton(range(FIRST_PRODUCT_COMPONENT, LAST_PRODUCT_COMPONENT).map(buttonId), chooseProduct);
};

Object.assign(module.exports, { ANVIL_NAMES: ["Anvil", "An experimental anvil", "Rusted anvil"], useOnAnvil, forget });
