/**
 * Anvil smithing: the smithing interface (312) for the best bar the player can work, its
 * 1/5/10/X/All quantity row, and the smith loop. Interface 312 draws its own products from
 * varbit smithing_bar_type (client scripts 415 -> 430), so the server only sets the varbit.
 *
 * Captured (rsprox, docs/smithing.md): opening sets smithing_bar_type and varp makexcrafting
 * (the remembered quantity, All when none has been chosen yet); a click sets
 * smithing_bar_lasttype/smithing_item_lasttype, closes the interface and plays human_smithing
 * (898) on the same tick, then each item comes 3 ticks later and every 5 after, with "You hammer
 * the steel and make ten dart tips." on the spam channel and human_smithing again, 15 client
 * cycles late. Smith with no bar: a message box "You should select an item from your inventory
 * and use it on the anvil." A product above the player's level closes the interface with a
 * message box: "You need a Smithing level of 7 to make a Bronze Full Helm."
 *
 * The Smiths' uniform (Wiki): each piece is a 20% chance (the full set 100%) that an item takes
 * 4 ticks instead of 5.
 */
const Core = require("./Core.Smithing");
const Data = require("./Data.Smithing");
const Sessions = require("./Sessions.Smithing");
const Godswords = require("./Godswords.Smithing");
const DragonShields = require("./DragonShields.Smithing");
const Common = require("./Common.Smithing");
const { hasHammer, messageBox, spam, varbit, varp, hammering, smithsUniformChance } = Common;

const MAIN_MODAL = "toplevel_osrs_stretch:mainmodal";
const SMITHING_INTERVAL_TICKS = 5;
const UNIFORM_INTERVAL_TICKS = 4;
const FIRST_DELAY_TICKS = 3;
/** Each item's hammering starts this many client cycles into its tick. */
const ITEM_ANIMATION_DELAY = 15;
const NO_BAR_MESSAGE = "You should select an item from your inventory and use it on the anvil.";
const ALL_QUANTITY_CAP = 28;
/** The quantity row left of the products: components 3-7 select 1, 5, 10, X and All. */
const QUANTITY_MODE_COMPONENTS = new Map([[3, 1], [4, 5], [5, 10], [6, "x"], [7, "all"]]);
const FIRST_PRODUCT_COMPONENT = 9;
const LAST_PRODUCT_COMPONENT = 38;
// The rusted anvil in Lumbridge can only be used to smith bronze.
const RUSTED_ANVIL_BRONZE_ONLY_MESSAGE = "You can only use bronze bars to smith on this anvil.";
// Wiki (Rusted anvil): selecting Smith without any bronze bars.
const RUSTED_ANVIL_NO_BRONZE_MESSAGE = "You need a bronze bar to smith equipment on this anvil.";

/** player -> the bar the open interface shows. */
const OPEN_MENUS = new Map();
/** player -> the anvil selected when the interface opened. */
const OPEN_STATIONS = new Map();
/** player -> the selected quantity ("all", "x" amount or a number); kept until disconnect. */
const SELECTED_QUANTITY = new Map();

const buttonId = (component) => (Data.smithingInterface() << 16) | component;
const mainModal = () => Core.CacheDefinitions.getComponentId(MAIN_MODAL);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const selectedQuantity = (player) => SELECTED_QUANTITY.get(player) ?? "all";

function smithingLevel(player) {
  return Common.smithingLevel(player);
}

function locationSnapshot(location) {
  if (!location || !["getX", "getY", "getZ"].every((method) => typeof location[method] === "function")) return null;
  return { x: location.getX(), y: location.getY(), z: location.getZ() };
}

function stationSnapshot(player, object) {
  const stationObjectId = object?.getId?.();
  if (!Number.isInteger(stationObjectId)) return null;
  const location = locationSnapshot(object?.getLocation?.());
  const startLocation = locationSnapshot(player?.getLocation?.());
  const teleportSerial = player?.getTeleportSerial?.();
  return location && startLocation && Number.isInteger(teleportSerial)
    ? { stationObjectId, location, startLocation, teleportSerial, area: player.getArea?.() ?? null }
    : null;
}

function remainsAtStation(player, context) {
  if (!context) return true;
  const location = locationSnapshot(player?.getLocation?.());
  return location != null
    && player.getTeleportSerial?.() === context.teleportSerial
    && (player.getArea?.() ?? null) === context.area
    && location.x === context.startLocation.x
    && location.y === context.startLocation.y
    && location.z === context.startLocation.z;
}

function canGrantAfterConsumption(player, product) {
  const inventory = player.getInventory();
  if (typeof inventory.getCopiedItems !== "function" || typeof Core.Inventory !== "function") return true;
  const preview = new Core.Inventory(player).setItems(inventory.getCopiedItems());
  preview.deleted(product.barId, product.bars, false);
  const output = new Core.Item(product.itemId, product.amount);
  return preview.getAddableAmount(output) >= product.amount;
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
    closeInterface(player);
    messageBox(player, `You need a Smithing level of ${product.level} to make a ${titleCase(Core.ItemDefinition.forId(product.itemId).getName())}.`);
    return false;
  }
  if (inventory.getAmount(product.barId) < product.bars) {
    player.sendMessage("You don't have enough bars to smith that item.");
    return false;
  }
  return true;
}

/** "Bronze full helm" -> "Bronze Full Helm", as the level refusal names the product. */
function titleCase(name) {
  return name.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function smithOnce(player, product, provenance) {
  if (!remainsAtStation(player, provenance) || !canSmith(player, product) || !canGrantAfterConsumption(player, product)) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(product.barId, product.bars);
  inventory.addItem(new Core.Item(product.itemId, product.amount));
  player.performAnimation(hammering(ITEM_ANIMATION_DELAY));
  player.getSkillManager().addExperiences(Core.Skill.SMITHING, product.xp);
  spam(player, `You hammer the ${product.metal} and make ${product.phrase}.`);
  const action = {
    inputItemIds: [product.barId],
    inputs: [{ itemId: product.barId, amount: product.bars }],
    outputItemId: product.itemId,
    ...(provenance ? { stationObjectId: provenance.stationObjectId, location: provenance.location } : {}),
  };
  Core.api.emitCustomEvent("smithing:success", {
    player, skill: Core.Skill.SMITHING, itemId: product.itemId, amount: product.amount, ...action,
    ...(provenance ? { source: "anvil", objectId: provenance.stationObjectId } : {}),
  });
  Core.api.emitCustomEvent("skills:produced", { player, skill: Core.Skill.SMITHING, itemId: product.itemId, amount: product.amount, xp: product.xp, kind: "smith", ...action });
  return true;
}

/** The ticks to the next item: 4 on a Smiths' uniform roll, otherwise 5. */
function smithingInterval(player) {
  return Math.random() < smithsUniformChance(player) ? UNIFORM_INTERVAL_TICKS : SMITHING_INTERVAL_TICKS;
}

function startSmithing(player, product, amount, provenance = stationSnapshot(player, null)) {
  if (!product || !Number.isInteger(amount) || amount <= 0 || !remainsAtStation(player, provenance) || !unlocked(player, product) || !canSmith(player, product)) return false;
  // All and X stop at what the bars cover, without an out-of-bars message.
  const most = Math.floor(player.getInventory().getAmount(product.barId) / product.bars);
  Sessions.start(player, {
    type: "smith",
    remaining: Math.min(amount, most),
    interval: smithingInterval,
    firstDelay: FIRST_DELAY_TICKS,
    begin: (smith) => remainsAtStation(smith, provenance),
    step: (smith) => smithOnce(smith, product, provenance),
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
function openBluriteMenu(player, provenance) {
  const { CreationMenu } = Core;
  const products = Data.bluriteProducts();
  const bars = player.getInventory().getAmount(Core.ItemIdentifiers.BLURITE_BAR);
  player.getPacketSender().sendCreationMenu(
    new CreationMenu("What would you like to make?", products.map((product) => product.itemId), {
      execute: (itemId, amount) => startSmithing(player, products.find((product) => product.itemId === itemId), amount, provenance),
    }, { maxAmount: Math.max(1, bars) })
  );
}

function openInterface(player, preferredBarId = null, station = null) {
  const provenance = stationSnapshot(player, station);
  const blurite = Core.ItemIdentifiers.BLURITE_BAR;
  if (preferredBarId === blurite || preferredBarId == null && chooseBar(player, null) == null && player.getInventory().contains(blurite)) {
    openBluriteMenu(player, provenance);
    return true;
  }
  const bar = chooseBar(player, preferredBarId);
  if (bar == null) {
    messageBox(player, NO_BAR_MESSAGE);
    return false;
  }
  OPEN_MENUS.set(player, bar);
  OPEN_STATIONS.set(player, provenance);
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
  OPEN_STATIONS.delete(player);
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
  const provenance = OPEN_STATIONS.get(player) ?? stationSnapshot(player, null);
  const started = startSmithing(player, product, selected === "all" ? ALL_QUANTITY_CAP : selected, provenance);
  if (!started) return false;
  OPEN_STATIONS.delete(player);
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
/**
 * Smith on an anvil. Content that makes something of its own there takes the click first through
 * "smithing:anvil-smith" { player, object, handled, proceed } (Between a Rock's golden helmet, whose
 * live Smith click with gold bars asks "Would you like to make a golden helmet?"). A handler that
 * sets handled and then turns its own offer down calls proceed() for the usual Smith click.
 */
function smith(event) {
  if (!anvilAccess(event)) return;
  const { player } = event;
  const proceed = () => smithNormally(player, event.object);
  const request = { player, object: event.object, handled: false, proceed };
  Core.api.emitCustomEvent("smithing:anvil-smith", request);
  if (request.handled) return;
  proceed();
}

function smithNormally(player, object) {
  if (Godswords.smithAtAnvil(player) || DragonShields.smithAtAnvil(player)) return;
  openInterface(player, null, object);
}

function smithRustedAnvil(event) {
  if (!anvilAccess(event)) return;
  if (!event.player.getInventory().contains(Core.ItemIdentifiers.BRONZE_BAR)) {
    event.player.sendMessage(RUSTED_ANVIL_NO_BRONZE_MESSAGE);
    return;
  }
  openInterface(event.player, Core.ItemIdentifiers.BRONZE_BAR, event.object);
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
  openInterface(player, itemId, object);
}

function forget(player) {
  OPEN_MENUS.delete(player);
  OPEN_STATIONS.delete(player);
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

Object.assign(module.exports, { ANVIL_NAMES: ["Anvil", "An experimental anvil", "Rusted anvil"], useOnAnvil, forget, smithingInterval });
