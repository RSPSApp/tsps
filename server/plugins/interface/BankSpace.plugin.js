/**
 * Bank space (https://oldschool.runescape.wiki/w/Bank), from plugins/interface/data/bank-space.json:
 * - capacity: 900 slots for members (400 free-to-play), +20 with a Bank PIN, +40 as a Jagex
 *   Account (every account here counts as one, Authenticator included: neither exists on this
 *   server), +50 per block bought from a Banker. Core asks it through "bank:capacity".
 * - the bank shows it: the capacity text and its tooltip (script 1495), as captured.
 * - a full bank without a PIN says "Set a Bank PIN to unlock more bank space.".
 * - a Banker's "I'd like to buy more bank slots." (the transcript plays up to the purchase list,
 *   on every NPC whose transcript has it: Bankers, Jade, Jumaane, ...): the menu_new list of up
 *   to nine blocks at their running cost, paid from inventory coins only (as captured, coins in
 *   the bank don't count), and "Do I have any other options for extra bank space?". Ultimate
 *   Ironmen are turned away by the transcript. A banker whose transcript lacks the choice gets
 *   it in its menu, as live bankers have it.
 */
const DATA = require("./data/bank-space.json");

/** bank_extra_blocks_purchased: blocks of 50 slots bought, 0-9. */
const BLOCKS_VARBIT = 13119;
const BLOCKS_ATTRIBUTE = "bank-space:blocks";

const PURCHASE_TARGET = "Bank space purchase";
const ULTIMATE_IRONMAN_CONDITION = "If the player is an Ultimate Ironman:";

/** toplevel mainmodal and the chatbox, where menu_new and the conversation sit. */
const MAIN_MODAL = (161 << 16) | 16;
const CHATBOX_MODAL = (162 << 16) | 568;
/**
 * menu_new: a scrolling list of options; script 9142 fills it, each pick resumes text (947:9) with
 * its index. Blank lines are spacers the client doesn't number (script 9143).
 */
const MENU_GROUP = 947;
const MENU_TEXT_CHILD = 9;
const MENU_SCRIPT = 9142;
const MENU_LAST_INDEX = 512;
const PAUSE_BUTTON = 1;
/** toplevel_mainmodal_open and chatdefault_restoreinput, sent around menu_new as captured. */
const MAINMODAL_OPEN_SCRIPT = 2524;
const RESTORE_INPUT_SCRIPT = 2158;
/** bankmain:capacity_layer / capacity / tooltip, and the script that sets the layer's tooltip. */
const BANK_GROUP = 12;
const CAPACITY_LAYER = (BANK_GROUP << 16) | 7;
const CAPACITY_TEXT = (BANK_GROUP << 16) | 8;
const BANK_TOOLTIP = (BANK_GROUP << 16) | 111;
const CAPACITY_TOOLTIP_SCRIPT = 1495;

let api;
let core;
/** The purchase list a player has open: what each line does. */
const menus = new WeakMap();

const coins = (amount) => amount.toLocaleString("en-US");

function fill(text, values) {
  return text.replace(/\[(\w+)\]/g, (whole, key) => (values[key] !== undefined ? String(values[key]) : whole));
}

function blocks(player) {
  const bought = Math.floor(Number(player.getAttribute(BLOCKS_ATTRIBUTE)) || 0);
  return Math.max(0, Math.min(DATA.blockCosts.length, bought));
}

function hasPin(player) {
  const query = { player, set: false };
  api.emitCustomEvent("bank-pin:status", query);
  return query.set === true;
}

function baseCapacity() {
  return core.WorldDefinition.isMembersWorld() ? DATA.capacity.members : DATA.capacity.freeToPlay;
}

function capacityOf(player) {
  return baseCapacity() + blocks(player) * DATA.slotsPerBlock
    + (hasPin(player) ? DATA.capacity.pin : 0) + DATA.capacity.jagexAccount;
}

/** The cost of buying `count` more blocks, from the next one on. */
function costOf(player, count) {
  const next = blocks(player);
  return DATA.blockCosts.slice(next, next + count).reduce((sum, cost) => sum + cost, 0);
}

const slotsForSale = (player) => (DATA.blockCosts.length - blocks(player)) * DATA.slotsPerBlock;

/** bank:capacity: the player's bank space. */
function capacity(event) {
  event.capacity = capacityOf(event.player);
}

/** bank:full: without a PIN, the bank points at the 20 slots one unlocks. */
function full(event) {
  if (!hasPin(event.player)) event.message = DATA.messages.fullWithoutPin;
}

function tooltip(player) {
  const { tooltip: lines, capacity: bonus } = DATA;
  const members = core.WorldDefinition.isMembersWorld();
  const parts = [fill(members ? lines.members : lines.freeToPlay, { slots: baseCapacity() })];
  const bought = blocks(player) * DATA.slotsPerBlock;
  if (bought > 0) parts.push(fill(lines.purchased, { slots: bought }));
  if (slotsForSale(player) > 0) parts.push(fill(lines.forSale, { slots: slotsForSale(player) }));
  parts.push(fill(hasPin(player) ? lines.pinSet : lines.pinMissing, { slots: bonus.pin }));
  parts.push(fill(lines.jagexAccount, { slots: bonus.jagexAccount }));
  return parts.join("<br>");
}

/** bank:opened: the capacity and what makes it up, as the bank shows them on opening. */
function opened({ player }) {
  player.getPacketSender()
    .sendString(String(core.Bank.getCapacity(player)), CAPACITY_TEXT)
    .sendClientScript(CAPACITY_TOOLTIP_SCRIPT, tooltip(player), CAPACITY_LAYER, BANK_TOOLTIP);
}

function login({ player }) {
  player.getPacketSender().sendVarbit(BLOCKS_VARBIT, blocks(player));
}

function answerCondition(event) {
  if (event.text !== ULTIMATE_IRONMAN_CONDITION) return null;
  const query = { player: event.player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  return query.mode === "ultimate";
}

/**
 * "I can sell you up to [number] additional bank slots...": the slots still for sale. Older
 * transcripts say "in sets of 40"; live sells sets of 50, as the capture shows.
 */
function dialogueLine(request) {
  if (typeof request.text !== "string" || !request.text.startsWith(DATA.dialogue.offerLine)) return;
  request.text = fill(DATA.dialogue.offer, { slots: slotsForSale(request.player) });
}

/** The transcript's "(Bank space purchase interface opens.)": the list replaces the rest of it. */
function dialogueAction(action) {
  if (action.action !== "open_interface" || action.target !== PURCHASE_TARGET) return;
  action.handled = true;
  // A new current dialogue (none) tells transcript playback to stop here.
  action.player.getDialogueManager().reset();
  openMenu(action.player, { id: action.npcId, name: action.definition?.getName?.() });
}

/** The Banker transcript's "I'd like to buy more bank slots." up to the purchase list. */
function bankSlotsChoice() {
  const { choice, ultimate, ultimateReply, offer } = DATA.bankerMenu;
  return {
    text: choice,
    steps: [
      { player: choice },
      { type: "condition", text: ULTIMATE_IRONMAN_CONDITION, steps: [{ npc: ultimate }, { player: ultimateReply }, { type: "end" }] },
      { npc: offer },
      { type: "action", action: "open_interface", target: PURCHASE_TARGET },
    ],
  };
}

/**
 * A banker's menu (access, PIN settings, collect) without the bank-slots choice gets it after
 * "I'd like to collect items.", as live bankers have it, while the menu still fits five choices.
 */
function bankerMenu(notice) {
  const options = Array.isArray(notice.options) ? notice.options : [];
  const texts = options.map((option) => option?.text);
  const { after, choice } = DATA.bankerMenu;
  if (texts.includes(choice) || options.length >= 5) return;
  const start = texts.indexOf(after[0]);
  if (start < 0 || after.some((text, offset) => texts[start + offset] !== text)) return;
  const at = start + after.length;
  notice.options = [...options.slice(0, at), bankSlotsChoice(), ...options.slice(at)];
}

/** `npc` is the one selling: `{ id, name }`, for the chat head and name. */
function openMenu(player, npc) {
  const { dialogue } = DATA;
  const lines = [];
  const remaining = DATA.blockCosts.length - blocks(player);
  for (let count = 1; count <= remaining; count++) {
    const slots = count * DATA.slotsPerBlock;
    const cost = costOf(player, count);
    lines.push([fill(dialogue.option, { slots, coins: coins(cost) }), () => choose(player, npc, slots, cost)]);
  }
  if (lines.length) lines.push(["", null]);
  lines.push([dialogue.otherOptions, () => otherOptions(player, npc)]);
  lines.push([dialogue.cancel, () => say(player, npc, [player, dialogue.changedMind, DATA.expressions.changedMind])]);
  // Live numbers the spacer too, so its "other options" and "(Cancel)" answer each other's pick.
  menus.set(player, { actions: lines.filter(([text]) => text).map(([, act]) => act) });
  player.setInterfaceId(MENU_GROUP);
  player.getPacketSender()
    .sendInterfaceScript(MAINMODAL_OPEN_SCRIPT, [-1, -1])
    .sendSubInterface(MAIN_MODAL, MENU_GROUP, 0)
    .sendClientScript(MENU_SCRIPT, dialogue.menuTitle, lines.map(([text]) => text).join("|"), 0, -1, 0, 0)
    .sendInterfaceFlagsRange((MENU_GROUP << 16) | MENU_TEXT_CHILD, 0, MENU_LAST_INDEX, PAUSE_BUTTON)
    .closeSubInterface(CHATBOX_MODAL);
}

/** A pick from the list: it closes once the answer is in the chatbox, as captured. */
function pick(event) {
  const { player } = event;
  if (event.groupId !== MENU_GROUP || event.childId !== MENU_TEXT_CHILD) return;
  const menu = menus.get(player);
  if (!menu) return;
  event.handled = true;
  const act = menu.actions[event.action];
  if (!act) return;
  menus.delete(player);
  player.getPacketSender().sendInterfaceScript(RESTORE_INPUT_SCRIPT, []);
  act();
  player.getPacketSender().closeSubInterface(MAIN_MODAL);
  if (player.getInterfaceId() === MENU_GROUP) player.setInterfaceId(-1);
}

function closed({ player, interfaceId }) {
  if (interfaceId === MENU_GROUP) menus.delete(player);
}

/**
 * Plays `lines` ([speaker, text, expression?], speaker being the player or the npc), then
 * `then` once the last is continued past, or the end of the conversation.
 */
function say(player, npc, ...lines) {
  return chain(player, npc, lines, null);
}

function chain(player, npc, lines, then) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue, EndDialogue } = core;
  const builder = new DialogueChainBuilder();
  lines.forEach(([speaker, text, expression], index) => {
    builder.add(speaker === player
      ? new PlayerDialogue(index, text, expression)
      : new NpcDialogue(index, npc.id, text, npc.name, expression));
  });
  builder.add(then ? new ActionDialogue(lines.length, { execute: then }) : new EndDialogue(lines.length));
  player.getDialogueManager().startDialogues(builder);
}

/** Every bank tab but the search tab, which only shows copies of the others' items. */
function bankTabs(player) {
  return Array.from({ length: core.Bank.TOTAL_BANK_TABS }, (_, tab) => player.getBank(tab))
    .filter((_bank, tab) => tab !== core.Bank.BANK_SEARCH_TAB_INDEX);
}

/** The bank's coins in every tab: a coins placeholder holds none, and coins can sit in more than one tab. */
function bankCoins(player) {
  return bankTabs(player).reduce((sum, bank) => sum + bank.getAmount(core.ItemIdentifiers.COINS), 0);
}

/**
 * The coins that pay: the inventory's and the bank's. Wiki (Transcript:Banker): the Banker only refuses when the coins
 * are in neither. (The recording behind docs/bank.md showed 10M banked coins refused; the Wiki is followed.)
 */
function availableCoins(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS) + bankCoins(player);
}

function choose(player, npc, slots, cost) {
  const { dialogue, expressions } = DATA;
  const values = { slots, coins: coins(cost) };
  chain(player, npc, [
    [player, fill(dialogue.choose, values), expressions.choose],
    [npc, fill(dialogue.cost, values), expressions.cost],
  ], () => {
    if (availableCoins(player) < cost) {
      say(player, npc, [player, dialogue.tooPoor, expressions.tooPoor]);
      return;
    }
    const { DialogueChainBuilder, OptionDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new OptionDialogue(0, {
        executeOption(option) {
          if (Number(option) === 1) accept(player, npc, slots, cost);
          else say(player, npc, [player, dialogue.changedMind, DATA.expressions.changedMind]);
        },
      }, dialogue.yes, dialogue.no).setTitle(fill(dialogue.confirmTitle, values)),
    ));
  });
}

function accept(player, npc, slots, cost) {
  const { dialogue, expressions } = DATA;
  chain(player, npc, [[player, dialogue.accept, expressions.accept]], () => {
    // The coins are checked again: the purchase happens on continuing past the answer.
    if (availableCoins(player) < cost || costOf(player, slots / DATA.slotsPerBlock) !== cost) {
      say(player, npc, [player, dialogue.tooPoor, expressions.tooPoor]);
      return;
    }
    purchase(player, slots / DATA.slotsPerBlock, cost);
    say(player, npc, [npc, dialogue.added, expressions.added]);
  });
}

function purchase(player, count, cost) {
  // The inventory's coins first, then the bank's.
  const COINS = core.ItemIdentifiers.COINS;
  const fromInventory = Math.min(cost, player.getInventory().getAmount(COINS));
  if (fromInventory > 0) player.getInventory().deleteNumber(COINS, fromInventory);
  player.getInventory().refreshItems();
  let fromBank = cost - fromInventory;
  if (fromBank > 0) {
    for (const bank of bankTabs(player)) {
      const take = Math.min(fromBank, bank.getAmount(COINS));
      if (take > 0) bank.deleteNumber(COINS, take);
      fromBank -= take;
    }
    if (core.Bank.isOpen?.(player)) player.getBank(player.getCurrentBankTab?.() ?? 0).refreshItems();
  }
  const bought = blocks(player) + count;
  player.setAttribute(BLOCKS_ATTRIBUTE, bought);
  player.getPacketSender().sendVarbit(BLOCKS_VARBIT, bought).sendSound(DATA.purchaseSound, 0, 0);
  core.GameConstants.PLAYER_PERSISTENCE.requestSave(player, "bank-space-purchase");
}

/** "Do I have any other options for extra bank space?": the PIN, if not set; then the list again. */
function otherOptions(player, npc) {
  const { dialogue, expressions } = DATA;
  chain(player, npc, [
    [player, dialogue.otherOptions, expressions.otherOptions],
    hasPin(player) ? [npc, dialogue.allFree] : [npc, dialogue.pinHint, expressions.pinHint],
    [npc, fill(dialogue.offer, { slots: slotsForSale(player) }), expressions.offer],
  ], () => openMenu(player, npc));
}

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.persistAttribute(BLOCKS_ATTRIBUTE, 0);
}

module.exports = {
  name: "BankSpace",
  description: "Bank capacity: 900 slots for members, bonuses from a PIN, and extra slots bought from a Banker with coins.",
  register(pluginApi) {
    init(pluginApi);
    pluginApi.onCustomEvent("bank:capacity", capacity);
    pluginApi.onCustomEvent("bank:full", full);
    pluginApi.onCustomEvent("bank:opened", opened);
    pluginApi.onPlayerLogin(login);
    pluginApi.onNpcDialogueCondition(answerCondition);
    pluginApi.onCustomEvent("npc-dialogue:line", dialogueLine);
    pluginApi.onCustomEvent("npc-dialogue:action", dialogueAction);
    pluginApi.onCustomEvent("npc-dialogue:menu", bankerMenu);
    pluginApi.onInterfaceActionClick(pick);
    pluginApi.onCustomEvent("interface:closed", closed);
  },
};
