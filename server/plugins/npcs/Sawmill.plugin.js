/**
 * Sawmill operators (https://oldschool.runescape.wiki/w/Sawmill), from
 * data/definitions/sawmill.json, as captured:
 * - Buy-plank (and Talk-to's "Yes, please make me some planks.") opens the skillmulti menu:
 *   "How many do you wish to make?", "Wood - 100gp" ... "Rosewood - 7,500gp", at most the logs
 *   carried, opening on the last amount chosen;
 * - the choice is made on the spot, plank by plank: the coins, a log, then the plank in the
 *   first free slot, until the amount, the logs or the coins run out. Without logs: "You'll
 *   need to bring me some more logs."; coins running short: "Those planks cost 1500 coins. You
 *   don't have enough money for all of them.";
 * - a sawmill voucher carried, with room for the extra plank, doubles one log's planks (Wiki);
 * - a log used on an operator makes one plank straight away.
 * Trade and Talk-to's housing supplies open the "Construction supplies" shop (shops.json).
 */
const fs = require("fs");
const path = require("path");

const LAST_AMOUNT_ATTRIBUTE = "sawmill:last-amount";

let api = null;
let core = null;
let DATA = null;

/** The data, read on first use through api.core's definitions path. */
function data() {
  if (!DATA) DATA = JSON.parse(fs.readFileSync(path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "sawmill.json"), "utf8"));
  return DATA;
}

const priceLabel = (plank) => `${plank.name} - ${plank.cost.toLocaleString("en-US")}gp`;

function logsHeld(player) {
  return data().planks.reduce((sum, plank) => sum + player.getInventory().getAmount(plank.log), 0);
}

function say(player, npcId, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, text),
    new EndDialogue(1),
  ));
}

/** Plank by plank until the amount, the logs or the coins run out; the vouchers double a log. */
function convert(player, npcId, plank, amount) {
  const { coins, voucher, messages, diary } = data();
  const inventory = player.getInventory();
  if (!inventory.contains(plank.log)) {
    say(player, npcId, messages.noLogs);
    return 0;
  }
  let made = 0;
  let shortOfCoins = false;
  for (let i = 0; i < amount && inventory.contains(plank.log); i++) {
    if (inventory.getAmount(coins) < plank.cost) {
      shortOfCoins = true;
      break;
    }
    inventory.delete(coins, plank.cost);
    inventory.delete(plank.log, 1);
    const doubled = inventory.contains(voucher) && inventory.getFreeSlots() >= 2;
    if (doubled) inventory.delete(voucher, 1);
    inventory.adds(plank.plank, 1);
    if (doubled) inventory.adds(plank.plank, 1);
    made += doubled ? 2 : 1;
  }
  if (shortOfCoins) say(player, npcId, messages.noCoins.replace("{cost}", String(plank.cost)));
  if (made > 0 && plank.plank === diary.anyPlank.plank) api.emitCustomEvent("diary:task", { player, diary: diary.anyPlank.diary, task: diary.anyPlank.task });
  if (plank.plank === diary.mahogany.plank && made >= diary.mahogany.count) {
    api.emitCustomEvent("diary:task", { player, diary: diary.mahogany.diary, task: diary.mahogany.task });
  }
  return made;
}

function openPlankMenu(player, npcId) {
  const { planks, title, menuMode } = data();
  const maxAmount = logsHeld(player);
  const remembered = Number(player.getAttribute(LAST_AMOUNT_ATTRIBUTE));
  const menu = new core.CreationMenu(title, planks.map((plank) => plank.log), {
    execute(logId, amount) {
      player.setAttribute(LAST_AMOUNT_ATTRIBUTE, amount);
      convert(player, npcId, planks.find((plank) => plank.log === logId), amount);
    },
  }, {
    labels: planks.map(priceLabel),
    maxAmount,
    lastAmount: Number.isInteger(remembered) && remembered > 0 ? remembered : maxAmount,
    mode: menuMode,
  });
  player.getPacketSender().sendCreationMenu(menu);
}

/** A log used on an operator becomes one plank on the spot, as captured (no menu). */
function useLogOnOperator(event) {
  const name = event.target?.getDefinition?.()?.getName?.();
  const plank = data().planks.find((entry) => entry.log === event.itemId);
  if (!plank || !data().operators.includes(name)) return;
  event.handled = true;
  convert(event.player, event.target.getId(), plank, 1);
}

function buyPlank({ player, npc }) {
  openPlankMenu(player, npc.getId());
  return true;
}

/**
 * Talk-to's "Yes, please make me some planks." ends in the transcript's Plank-making action. The
 * conversation closes the chatbox as it ends, so the menu opens the tick after.
 */
function plankMaking(event) {
  if (event.action !== "open_interface" || event.target !== "Plank-making") return;
  if (!data().operators.includes(event.npc?.getDefinition?.()?.getName?.() ?? event.definition?.getName?.())) return;
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
      if (player.isRegistered()) openPlankMenu(player, npcId);
    }
  })());
}

function start(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "Sawmill",
  members: true,
  register(pluginApi) {
    pluginApi.onServerStartup(() => start(pluginApi));
    pluginApi.onNpcInteraction("Sawmill operator", { "Buy-plank": buyPlank });
    pluginApi.onNpcInteraction("Sawmill Operator", { "Buy-plank": buyPlank });
    pluginApi.onCustomEvent("npc-dialogue:action", plankMaking);
    pluginApi.onItemOnNpc(useLogOnOperator, { noted: false });
  },
  _test: { start, convert, useLogOnOperator, openPlankMenu, plankMaking, priceLabel, data, LAST_AMOUNT_ATTRIBUTE },
};
