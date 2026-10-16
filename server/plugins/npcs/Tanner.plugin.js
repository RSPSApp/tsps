/**
 * Tanners (https://runescape.wiki), from
 * plugins/npcs/data/tanner.json, as captured:
 * - Tan hides (and Talk-to's tanning dialogue options) opens the skillmulti menu:
 *   "How many do you wish to make?", "Soft leather - 1gp" ... "Black dragonhide - 45gp", at most the hides
 *   carried, opening on the last amount chosen;
 * - the choice is made on the spot, hide by hide: the coins, a hide, then the leather in the
 *   first free slot, until the amount, the hides or the coins run out. Without hides: "You'll
 *   need to bring me some more hides."; coins running short: "You don't have enough money for all of them.";
 * - a hide used on a tanner makes one leather straight away.
 */
const fs = require("fs");
const path = require("path");

const LAST_AMOUNT_ATTRIBUTE = "tanner:last-amount";

let api = null;
let core = null;
let DATA = null;

/** The data, read on first use through api.core's definitions path. */
function data() {
  if (!DATA) DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "tanner.json"), "utf8"));
  return DATA;
}

const priceLabel = (leather) => `${leather.name} - ${leather.cost.toLocaleString("en-US")}gp`;

function hidesHeld(player) {
  return data().leathers.reduce((sum, leather) => sum + player.getInventory().getAmount(leather.hide), 0);
}

function say(player, npcId, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, text),
    new EndDialogue(1),
  ));
}

/** Hide by hide until the amount, the hides or the coins run out. */
function convert(player, npcId, leather, amount) {
  const { coins, messages, diary } = data();
  const inventory = player.getInventory();
  if (!inventory.contains(leather.hide)) {
    say(player, npcId, messages.noHides);
    return 0;
  }
  let made = 0;
  let shortOfCoins = false;
  for (let i = 0; i < amount && inventory.contains(leather.hide); i++) {
    if (inventory.getAmount(coins) < leather.cost) {
      shortOfCoins = true;
      break;
    }
    inventory.delete(coins, leather.cost);
    inventory.delete(leather.hide, 1);
    inventory.adds(leather.leather, 1);
    made += 1;
  }
  if (shortOfCoins) say(player, npcId, messages.noCoins.replace("{cost}", String(leather.cost)));
  
  // Diary achievements mapping if applicable to tanners
  if (diary && made > 0 && leather.leather === diary.anyLeather?.leather) {
    api.emitCustomEvent("diary:task", { player, diary: diary.anyLeather.diary, task: diary.anyLeather.task });
  }
  return made;
}

function openTanMenu(player, npcId) {
  const { leathers, title, menuMode } = data();
  const maxAmount = hidesHeld(player);
  const remembered = Number(player.getAttribute(LAST_AMOUNT_ATTRIBUTE));
  const menu = new core.CreationMenu(title, leathers.map((leather) => leather.hide), {
    execute(hideId, amount) {
      player.setAttribute(LAST_AMOUNT_ATTRIBUTE, amount);
      convert(player, npcId, leathers.find((leather) => leather.hide === hideId), amount);
    },
  }, {
    labels: leathers.map(priceLabel),
    maxAmount,
    lastAmount: Number.isInteger(remembered) && remembered > 0 ? remembered : maxAmount,
    mode: menuMode,
  });
  player.getPacketSender().sendCreationMenu(menu);
}

/** A hide used on a tanner becomes one leather on the spot (no menu). */
function useHideOnTanner(event) {
  const name = event.target?.getDefinition?.()?.getName?.();
  const leather = data().leathers.find((entry) => entry.hide === event.itemId);
  if (!leather || !data().tanners.includes(name)) return;
  event.handled = true;
  convert(event.player, event.npcId ?? event.target.getId(), leather, 1);
}

function tanHides({ player, npc }) {
  openTanMenu(player, npc.getId());
  return true;
}

/**
 * Dialogue actions that result in the chatbox closing and opening the interface
 * on the subsequent tick.
 */
function tanningDialogueAction(event) {
  if (event.action !== "open_interface" || event.target !== "Tanning") return;
  if (!data().tanners.includes(event.npc?.getDefinition?.()?.getName?.() ?? event.definition?.getName?.())) return;
  event.handled = true;
  event.end = true;
  const { player } = event;
  const npcId = event.npc?.getId?.() ?? event.npcId;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      this.stop();
      if (player.isRegistered()) openTanMenu(player, npcId);
    }
  })());
}

function start(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "Tanner",
  members: false,
  register(pluginApi) {
    pluginApi.onServerStartup(() => start(pluginApi));
    
    // Bind the tanHides action to "Tan-hide", "Tan hides", AND "Trade"
    pluginApi.onNpcInteraction("Tanner", { 
      "Tan-hide": tanHides, 
      "Tan hides": tanHides,
      "Trade": tanHides 
    });
    
    pluginApi.onCustomEvent("npc-dialogue:action", tanningDialogueAction);
    pluginApi.onItemOnNpc(useHideOnTanner, { noted: false });
  },
  _test: { start, convert, useHideOnTanner, openTanMenu, tanningDialogueAction, priceLabel, data, LAST_AMOUNT_ATTRIBUTE },
};
