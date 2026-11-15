/**
 * The Apothecary's Potions interface in Varrock (apothecary_potions, 556).
 *
 * rsprox captures (rec 3219 rev 232 ticks 5534-7171, local 1001334 rev 240 tick 2673):
 * - Potions (op3) and Talk-to's "Can you make potions for me?" open it as the main modal, with
 *   toplevel_sidebutton_switch [3] and toplevel_mainmodal_open [-1, -1] first. From the chat the
 *   modal opens as the player's line is continued.
 * - Each potion gets its title, a contents list and the potion's model (zoom 380). An ingredient
 *   the player hasn't got is wrapped in <str>: "<str>Red spiders' eggs</str><br><str>Limpwurt
 *   root</str><br>5 coins", "<str>Chocolate dust</str><br><str>2 limpwurt roots</str>",
 *   "Cadava berry<br><str>Limpwurt root</str><br>5 coins".
 * - Buy-1/5/X/All on a potion without its ingredients: "You haven't got the required items."
 *
 * OSRS Wiki (Apothecary): Strength potion(4) is 1 limpwurt root, 1 red spiders' eggs and 5 coins;
 * Energy potion(4) 2 limpwurt roots and 1 chocolate dust; Antipoison(4) 1 limpwurt root, 1 cadava
 * berries and 5 coins.
 *
 * A strength potion made here feeds the Varrock diary task through STRENGTH_POTION_MADE_EVENT.
 */
const INTERFACE = "apothecary_potions";
const SIDEBUTTON_SWITCH_SCRIPT = 915;
const INVENTORY_TAB = 3;
const MAINMODAL_OPEN_SCRIPT = 2524;
const MODEL_ZOOM = 380;
const COINS = 995;
const LIMPWURT_ROOT = 225;
const RED_SPIDERS_EGGS = 223;
const CHOCOLATE_DUST = 1975;
const CADAVA_BERRIES = 753;
const STRENGTH_POTION_4 = 113;
const ENERGY_POTION_4 = 3008;
const ANTIPOISON_4 = 2446;
const MISSING_MESSAGE = "You haven't got the required items.";
const STRENGTH_POTION_MADE_EVENT = "apothecary:strength-potion-made";
/** The conversations' action for "Can you make potions for me?" (a shop name in the export). */
const DIALOGUE_TARGET = "Apothecary's Potions";
const OP_AMOUNTS = { 1: 1, 2: 5 };
const OP_X = 3;
const OP_ALL = 4;

/** In the interface's order; `label` is the captured contents line for that ingredient. */
const POTIONS = [
  {
    key: "strength", product: STRENGTH_POTION_4, title: "Strength potion", event: STRENGTH_POTION_MADE_EVENT,
    ingredients: [
      { id: RED_SPIDERS_EGGS, amount: 1, label: "Red spiders' eggs" },
      { id: LIMPWURT_ROOT, amount: 1, label: "Limpwurt root" },
      { id: COINS, amount: 5, label: "5 coins" },
    ],
  },
  {
    key: "energy", product: ENERGY_POTION_4, title: "Energy potion",
    ingredients: [
      { id: CHOCOLATE_DUST, amount: 1, label: "Chocolate dust" },
      { id: LIMPWURT_ROOT, amount: 2, label: "2 limpwurt roots" },
    ],
  },
  {
    key: "antipoison", product: ANTIPOISON_4, title: "Antipoison potion",
    ingredients: [
      { id: CADAVA_BERRIES, amount: 1, label: "Cadava berry" },
      { id: LIMPWURT_ROOT, amount: 1, label: "Limpwurt root" },
      { id: COINS, amount: 5, label: "5 coins" },
    ],
  },
];

let core = null;
let api = null;

function cache() {
  return core.CacheDefinitions;
}

function required(value, what) {
  if (value === null || value === undefined || value < 0) throw new Error(`Apothecary: the cache has no ${what}`);
  return value;
}

function interfaceId() {
  return required(cache().getInterfaceId(INTERFACE), `${INTERFACE} interface`);
}

function component(name) {
  return required(cache().getComponentId(`${INTERFACE}:${name}`), `${INTERFACE}:${name} component`);
}

function isOpen(player) {
  return player.getInterfaceId() === interfaceId();
}

/** How many of a potion the inventory pays for. */
function affordable(player, potion) {
  const inventory = player.getInventory();
  return Math.min(...potion.ingredients.map((part) => Math.floor(inventory.getAmount(part.id) / part.amount)));
}

function contents(player, potion) {
  const inventory = player.getInventory();
  return potion.ingredients
    .map((part) => (inventory.getAmount(part.id) >= part.amount ? part.label : `<str>${part.label}</str>`))
    .join("<br>");
}

/** The titles, contents and models, in the captured order. */
function sendContents(player) {
  const sender = player.getPacketSender();
  for (const potion of POTIONS) {
    sender.sendString(potion.title, component(`${potion.key}_title`));
    sender.sendString(contents(player, potion), component(`${potion.key}_contents`));
    sender.sendItemOnInterface(component(`${potion.key}_pic`), potion.product, 0, MODEL_ZOOM);
  }
}

function openPotions(player) {
  const sender = player.getPacketSender();
  sender.sendClientScript(SIDEBUTTON_SWITCH_SCRIPT, INVENTORY_TAB);
  sender.sendClientScript(MAINMODAL_OPEN_SCRIPT, -1, -1);
  sender.sendInterface(interfaceId());
  sendContents(player);
}

/** Makes up to `wanted` of the potion; with nothing to pay for one, the captured refusal. */
function make(player, potion, wanted) {
  if (!isOpen(player)) return 0;
  const amount = Math.min(wanted, affordable(player, potion));
  if (amount <= 0) {
    player.sendMessage(MISSING_MESSAGE);
    return 0;
  }
  const inventory = player.getInventory();
  for (const part of potion.ingredients) inventory.deleteNumber(part.id, part.amount * amount);
  // Rec 3219 tick 7171 (Buy-X 5 with ingredients for 3): three potions, no message, no sound.
  inventory.adds(potion.product, amount);
  inventory.refreshItems();
  // The same tick live runs the whole open again (rec 3219 tick 7171, the one captured purchase).
  openPotions(player);
  if (potion.event) api.emitCustomEvent(potion.event, { player, amount });
  return amount;
}

function promptAmount(player, potion) {
  // A second Buy-X re-arms the prompt for the potion clicked last, as the core's shops do.
  player.setEnteredAmountAction({ execute: (amount) => make(player, potion, Math.max(0, Math.floor(Number(amount) || 0))) });
  // meslayer_mode7 "Enter amount:" (rec 3219 tick 7070).
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
}

function buy(potion, event) {
  const { player } = event;
  if (!isOpen(player)) return;
  event.handled = true;
  const op = Number(event.opId ?? event.action);
  if (OP_AMOUNTS[op] !== undefined) return void make(player, potion, OP_AMOUNTS[op]);
  // Buy-X and Buy-All refuse at once without the ingredients (rec 3219 ticks 5925-5929).
  if (affordable(player, potion) <= 0) return void player.sendMessage(MISSING_MESSAGE);
  if (op === OP_X) return void promptAmount(player, potion);
  if (op === OP_ALL) make(player, potion, affordable(player, potion));
}

function potionsOption({ player }) {
  openPotions(player);
  return true;
}

/**
 * "Can you make potions for me?" ends in an open_shop the dialogue runtime would answer with
 * shops.json's "Apothecary's Potions"; live opens this interface instead. The conversation
 * closes its chatbox as it ends, so the interface opens on the next tick.
 */
function dialogueOpen(event) {
  if (event.handled || event.action !== "open_shop" || event.target !== DIALOGUE_TARGET) return;
  event.handled = true;
  event.end = true;
  const { player } = event;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player.getIndex(), false);
    }
    execute() {
      this.stop();
      if (player.isRegistered() && !player.getDialogueManager().isActive()) openPotions(player);
    }
  })());
}

function start(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "Apothecary",
  description: "Gives the Varrock Apothecary's Potions interface: strength, energy and antipoison potions made from the player's own ingredients, feeding the Varrock diary.",
  register(pluginApi) {
    start(pluginApi);
    pluginApi.onNpcInteraction("Apothecary", { Potions: potionsOption });
    pluginApi.onCustomEvent("npc-dialogue:action", dialogueOpen);
    for (const potion of POTIONS) pluginApi.onInterfaceActionButton(component(potion.key), buy.bind(null, potion));
  },
  _test: {
    POTIONS, MISSING_MESSAGE, STRENGTH_POTION_MADE_EVENT, DIALOGUE_TARGET,
    start, openPotions, make, buy, potionsOption, dialogueOpen, contents, affordable,
  },
};
