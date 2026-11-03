/**
 * Banknote exchange merchants (docs/note-exchange.md): use a banknote on Phials, Tiles, Aisles
 * and the rest from plugins/npcs/data/note-exchange.json to get the real items back for a fee
 * per note. Talk-to is their Wiki transcript (data/definitions/npc-dialogues.json).
 * The menu, sound and item box are as captured (rsprox, Virilis); refusals are Wiki lines.
 */
const fs = require("fs");
const path = require("path");

const EXCHANGE_FIVE = 5;
/** Ours (not captured). */
const AMOUNT_PROMPT = "Enter amount:";
const LAST_X_ATTRIBUTE = "note-exchange:last-x";

let core;
let DATA;
let COINS;
/** Merchants by NPC id. */
let MERCHANTS;

/** Reads the data file on first use. */
function loadData() {
  if (DATA) return;
  const { ItemIdentifiers, NpcIdentifiers } = core;
  DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "note-exchange.json"), "utf8"));
  COINS = ItemIdentifiers[DATA.coins];
  MERCHANTS = new Map();
  for (const merchant of DATA.merchants) {
    const id = NpcIdentifiers[merchant.npc];
    if (!Number.isInteger(id)) throw new Error(`note-exchange.json: unknown npc ${merchant.npc}`);
    const accepts = Array.isArray(merchant.accepts) ? new Set(merchant.accepts) : merchant.accepts;
    MERCHANTS.set(id, { ...merchant, id, accepts, lines: { ...DATA.lines, ...merchant.lines } });
  }
}

function merchantFor(npcId) {
  loadData();
  return MERCHANTS.get(npcId);
}

function line(merchant, key) {
  return merchant.lines[key].replace("{fee}", merchant.fee);
}

function accepts(merchant, itemId) {
  if (!merchant.accepts) return true;
  if (merchant.accepts === "bury") {
    return (core.CacheDefinitions.getItem(itemId).inventoryActions ?? []).includes("Bury");
  }
  return merchant.accepts.has(core.ItemDefinition.forId(itemId).getName());
}

function npcSays(player, merchant, text) {
  const { DialogueChainBuilder, NpcDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, merchant.id, text)));
}

/** How many of up to `requested` notes can be exchanged now: notes held, coins and room. */
function exchangeable(player, merchant, noteId, itemId, requested) {
  loadData();
  const inventory = player.getInventory();
  const notes = inventory.getAmount(noteId);
  const coins = inventory.getAmount(COINS);
  let count = Math.min(requested, notes, Math.floor(coins / merchant.fee));
  if (count <= 0 || core.ItemDefinition.forId(itemId).isStackable()) return Math.max(count, 0);
  // A stack used up in full frees its slot for the items.
  const room = (n) => inventory.getFreeSlots() + (n === notes ? 1 : 0) + (n * merchant.fee === coins ? 1 : 0);
  count = Math.min(count, inventory.getFreeSlots() + 2);
  while (count > 0 && count > room(count)) count--;
  return count;
}

function exchange(player, merchant, noteId, itemId, requested) {
  const count = exchangeable(player, merchant, noteId, itemId, requested);
  if (count <= 0) {
    player.getPacketSender().sendInterfaceRemoval();
    return;
  }
  const inventory = player.getInventory();
  inventory.deleteNumber(noteId, count);
  inventory.deleteNumber(COINS, count * merchant.fee);
  inventory.adds(itemId, count);
  core.Sounds.sendSound(player, new core.Sound(DATA.sound, 1, 0, 0));
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  const text = merchant.converts ?? `${merchant.name} converts your banknotes.`;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

function askAmount(player, merchant, noteId, itemId) {
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredAmountAction({
    execute: (amount) => {
      if (!Number.isSafeInteger(amount) || amount <= 0) return;
      if (merchant.rememberX) player.setAttribute(LAST_X_ATTRIBUTE, amount);
      exchange(player, merchant, noteId, itemId, amount);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(AMOUNT_PROMPT);
}

/** Captured: "Exchanging: <item>" with 1, 5, all, X and Cancel; all costs every note held. */
function openMenu(player, merchant, noteId, itemId) {
  const { DialogueChainBuilder, OptionDialogue } = core;
  const notes = player.getInventory().getAmount(noteId);
  const remembered = merchant.rememberX ? player.getAttribute(LAST_X_ATTRIBUTE) : 0;
  const shortcut = Number.isSafeInteger(remembered) && remembered > 0 ? remembered : EXCHANGE_FIVE;
  const choose = (option) => {
    switch (Number(option)) {
      case 1: return exchange(player, merchant, noteId, itemId, 1);
      case 2: return exchange(player, merchant, noteId, itemId, shortcut);
      case 3: return exchange(player, merchant, noteId, itemId, notes);
      case 4: return askAmount(player, merchant, noteId, itemId);
      default: return player.getPacketSender().sendInterfaceRemoval();
    }
  };
  const fee = merchant.fee;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, { executeOption: choose },
      `Exchange 1 (${fee} coins).`,
      `Exchange ${shortcut} (${shortcut * fee} coins).`,
      `Exchange all (${notes * fee} coins).`,
      "Exchange X.",
      "Cancel.",
    ).setTitle(`Exchanging: ${core.ItemDefinition.forId(itemId).getName()}`),
  ));
}

function useOnMerchant(event) {
  const merchant = merchantFor(event.npcId);
  if (!merchant || (merchant.members && !core.WorldDefinition.isMembersWorld())) return;
  event.handled = true;
  const { player, itemId: noteId } = event;
  const definition = core.ItemDefinition.forId(noteId);
  if (!definition.isNoted()) return npcSays(player, merchant, line(merchant, "notBanknote"));
  const itemId = definition.unNote();
  if (!accepts(merchant, itemId)) return npcSays(player, merchant, line(merchant, "notAccepted"));
  if (player.getInventory().getAmount(COINS) < merchant.fee) return npcSays(player, merchant, line(merchant, "noCoins"));
  if (exchangeable(player, merchant, noteId, itemId, 1) === 0) return npcSays(player, merchant, line(merchant, "noSpace"));
  openMenu(player, merchant, noteId, itemId);
}

module.exports = {
  name: "NoteExchange",
  _test: { exchangeable, accepts },
  register(api) {
    core = api.core;
    api.persistAttribute(LAST_X_ATTRIBUTE, 0);
    api.onItemOnNpc(useOnMerchant);
  },
};
