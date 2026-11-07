"use strict";

/**
 * Rogue Trader (Wiki: Rogue Trader; issue #2623): after The Feud, Ali Morrisane (3533, Al Kharid) sends the player on
 * three errands that unlock his stock: runes (Aubury), blackjacks (the Pollnivneach seller) and clothes (Siamun), and
 * the first of them pays with cheaper magic carpets.
 *
 * Evidence: rsprox 3169 (rev 232) and 1756 (rev 227) for Ali's start, 3170 (rev 232) and 549 (rev 227) for the errands
 * (found by the varbits 911-922 and NPC 3533). Varbits: 911 blackjacks, 912 clothes, 913 runes, 914 cheapflights,
 * 915 justchanged_garments, 916 justchanged_weapons, 917 justobt_runes, 919 bj_urchingloat, 920 bjtold_ali, 922 stallvar.
 * The generated npc-dialogues.json has Ali Morrisane's variant standard-dialogue-after-completing-rogue-trader (the blackjack,
 * clothes and runes/casket menus and the expand-your-business answers), which Ali's later visits use, cut to what the player has
 * unlocked; it has no page for the miniquest's own conversations (Ali's introduction, reminders, reports and thanks, Aubury's
 * proposal, Siamun, the blackjack seller, the street urchin) and must not be edited, so that wording is held in
 * plugins/npcs/data/rogue-trader.json: scenes copied from the captures, and "wikiScenes" from Transcript:Rogue Trader
 * for the branches no capture has. The player's progress is one saved attribute, resent as varbits at login.
 *
 * The start, as captured: the introduction, then the first errand (Siamun's if Icthlarin's Little Helper is done, which
 * sets 912), then a menu. "So what's in this for me?" gives the carpet discount (914) the first time, then goes on to
 * the next errand; "Ok I'll get on to it." goes straight on (blackjacks, 911; then runes, 913). The last menu's "Ok"
 * ends with the junk line (ten coins) and the shop.
 *
 * The runes errand (3170): once Ali has asked (913 = 1) Aubury's menu gains "Actually, I'm here with a business proposal
 * from Ali Morrisane." (913 = 2, 917 = 1; injected into the generated Aubury dialogue, which is not edited). Ali then
 * takes the runes from the player's request on: "Hang on a second." (922 = 1), the small and large caskets (Force,
 * Pick, Examine lock; plugins/npcs/rogue-trader/Runedoku.RogueTrader.js is the sudoku), 913 = 3 once the small one is
 * open and 5 once the large one is, and the per-player rune shops (Shops.RogueTrader.js). Wiki rates for the rolls,
 * drains and XP; the messages that are not in a capture are marked "ours" where they are sent.
 *
 * The blackjack errand (3170): the seller (6135) takes the proposal (911 = 2), the street urchin (3539) charges 100 gold, the
 * seller is robbed (916 = 2, 919 = 1) and shows the defensive blackjacks (911 = 4); on Ali's request (920) the player lets
 * the seller hit twice for the offensive ones (911 = 3). 922 follows the stock last viewed: 1 runes, 2 blackjacks, 5 the
 * Menaphite clothes, 3 the desert outfits.
 *
 * The clothes errand (3170, 549): Siamun (4205) takes three dyes (912 = 3, the Menaphite clothing) or three pelts of a kind (912 = 4,
 * the desert outfits) and switches between them when Ali has reported (915); Ali's menus list the unlocked stocks and, with
 * all three errands done, the expand-your-business option (Wiki).
 *
 * The finish (549): the first talk with all three done thanks the player and sets 914, and 914 makes the magic carpets cheaper
 * (MagicCarpets asks "rogue-trader:cheap-flights"). The shop owners' generated remarks require those three errands and Prince Ali Rescue
 * (Wiki, Post-errand task). Not done: the four Alis (6552-6555), whose generated pages are empty.
 */

const QuestRuntime = require("../quests/QuestRuntime");
const DATA = require("./data/rogue-trader.json");
const Runedoku = require("./rogue-trader/Runedoku.RogueTrader");
const Shops = require("./rogue-trader/Shops.RogueTrader");

const ALI = 3533;
const SELLER = 6135, URCHIN = 3539, AUBURY = 2886, SIAMUN = 4205;
const SPEAKERS = { ali: ALI, seller: SELLER, urchin: URCHIN, aubury: AUBURY, siamun: SIAMUN };
const ALIS_DISCOUNT_WARES = 1008; // shops.json "Ali's Discount Wares."
const STATE = "rogue-trader:state";
/** state key -> varbit (names from the decode). */
const VARBITS = {
  blackjacks: 911, clothes: 912, runes: 913, cheapflights: 914, garments: 915, weapons: 916,
  obtRunes: 917, urchinGlove: 919, toldAli: 920, stallvar: 922,
};
const JUNK_PRICE = 10;
const MESBOX_CHAT = 115;
const MAIN_MODAL = (161 << 16) | 16;
/** Wiki (Ali's Discount Wares., Junk): one of these, 1/5 each; rsprox 3169 t8287 gave a raw chicken for 10 coins. */
const JUNK_ITEMS = [1265, 1925, 946, 2138, 590]; // bronze pickaxe, bucket, knife, raw chicken, tinderbox
const LOCKPICK = 1523;
const URCHIN_PRICE = 100; // 3170 t724; the Wiki says 300 for a player who did not pay him in The Feud (not implemented)
const OPEN_SOUND = 1227, PICK_FAIL_SOUND = 1228, IMPOSSIBLE_SOUND = 2402;
let shops, runedoku;
const talkingTo = new WeakMap(); // the Ali the player is talking to, for the generated page's conversation

let api;
const core = () => api.core;
const done = (name, player) => QuestRuntime.questNamed(name)?.isComplete(player) === true;
const icthlarin = (player) => done("Icthlarin's Little Helper", player);

// --------------------------------------------------------------- state

function state(player) {
  const saved = player.getAttribute(STATE);
  return saved && typeof saved === "object" ? saved : {};
}
const get = (player, key) => Number(state(player)[key]) || 0;
function set(player, key, value) {
  if (get(player, key) === value) return;
  player.setAttribute(STATE, { ...state(player), [key]: value });
  if (VARBITS[key] !== undefined) player.getPacketSender().sendVarbit(VARBITS[key], value);
}
function syncVarbits({ player }) {
  for (const [key, id] of Object.entries(VARBITS)) {
    const value = get(player, key);
    if (value) player.getPacketSender().sendVarbit(id, value);
  }
}

// --------------------------------------------------------------- dialogue

/**
 * Plays scene lines ([who, text] pairs, with ["set", key, value] marks that change the state, and ["sound", id] marks,
 * where the capture does, between two lines) and then `then`. An action only ends a chain, so a mark splits it in two.
 */
function play(player, items, then = null) {
  if (items.length === 0) { if (then) then(); return; }
  const marker = items.findIndex((item) => item[0] === "set" || item[0] === "sound" || item[0] === "do");
  if (marker < 0) return say(player, items, then);
  const [kind, key, value] = items[marker];
  const after = () => {
    if (kind === "set") set(player, key, value);
    else if (kind === "do") key();
    else player.getPacketSender().sendSound(key, 1, 0);
    play(player, items.slice(marker + 1), then);
  };
  if (marker === 0) return after();
  say(player, items.slice(0, marker), after);
}

/** A message box (interface 229) that also reaches the chat as a mesbox message, as in the captures (3170 t247). */
function messageBox(index, text) {
  const box = new (core().StatementDialogue)(index, text);
  const send = box.send.bind(box);
  box.send = (player) => { player.getPacketSender().sendTypedMessage(MESBOX_CHAT, text); send(player); };
  return box;
}

function say(player, lines, then) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue } = core();
  const builder = new DialogueChainBuilder();
  const name = player.getDisplayName?.() ?? player.getUsername();
  let index = 0;
  for (const [who, text] of lines) {
    const line = text.replace("[player name]", name);
    if (who === "box") builder.add(messageBox(index++, line));
    else builder.add(who === "player" ? new PlayerDialogue(index++, line) : new NpcDialogue(index++, SPEAKERS[who] ?? ALI, line));
  }
  if (then) builder.add(new ActionDialogue(index, { execute: () => then() }));
  player.getDialogueManager().startDialogues(builder);
}

function choose(player, ...options) {
  api.sendMultiChatboxPrompt(player, "Select an option", ...options.flatMap(([label, action]) => [label, () => action()]));
}

/**
 * Runs `action` once, `ticks` game ticks from now, unless the player has gone by then (a shop opened from the generated page's
 * action step must come after the page closes, as the page closes after the step: NpcDialogues closes first only for open_shop).
 */
function later(ticks, player, action) {
  const { Task, TaskManager } = core();
  TaskManager.submit(new (class extends Task {
    constructor() { super(Math.max(1, ticks), null, false); }
    execute() {
      this.stop();
      // A newer main interface owns this target; leave it in place.
      if (player.isRegistered?.() === true && !player.getPacketSender().getSubInterfaceAt(MAIN_MODAL)) action();
    }
  })());
}

const scene = (name) => DATA.scenes[name];
const wiki = (name) => DATA.wikiScenes[name];

// --------------------------------------------------------------- the start

/** "Despite your best efforts...": ten coins and a junk item (Wiki: only with the coins and a free slot), then the shop or not. */
function junkSale(player) {
  const inventory = player.getInventory();
  const { ItemIdentifiers, Item } = core();
  if (inventory.getAmount(ItemIdentifiers.COINS) >= JUNK_PRICE && inventory.getFreeSlots() > 0) {
    inventory.deleteNumber(ItemIdentifiers.COINS, JUNK_PRICE);
    inventory.addItem(new Item(JUNK_ITEMS[Math.floor(Math.random() * JUNK_ITEMS.length)], 1));
    player.sendMessage(DATA.scenes.junk);
  }
}

function junk(player, labels = ["No I'm really too busy.", "Ok"]) {
  junkSale(player);
  choose(player,
    [labels[0], () => say(player, [["player", "No, I'm really too busy."]], null)],
    [labels[1], () => core().ShopManager.open(player, ALIS_DISCOUNT_WARES)]);
}

function finish(player) {
  say(player, scene("getGoing"), () => junk(player));
}

/** The errand after the one just given: blackjacks (when Siamun's came first), then runes, then the goodbye. */
function nextErrand(player) {
  if (icthlarin(player) && !get(player, "blackjacks")) {
    play(player, [...scene("blackjackErrand"), ["set", "blackjacks", 1]], () => askAgain(player, "okLater"));
  } else if (!get(player, "runes")) {
    runesBriefing(player);
  } else {
    finish(player);
  }
}

/** The runes briefing: Ali's idea, the Rune Mysteries answer, Aubury (913 = 1 at "Oh yes, the rune seller from Varrock."). */
function runesLines(player) {
  return [...scene("runesBriefing"), ...(done("Rune Mysteries", player) ? scene("runesRuneMysteries") : []), ...scene("runesMarket")];
}

function runesBriefing(player) {
  play(player, runesLines(player), () => askAgain(player, "okLater"));
}

function whatsInIt(player) {
  const reward = get(player, "cheapflights") ? scene("discountReminder") : scene("discountOffer");
  play(player, [...scene("whatsInIt"), ...reward], () => nextErrand(player));
}

/** The menu after an errand: "So what's in this for me?" or the Ok that moves on. */
function askAgain(player, ok) {
  choose(player,
    ["So what's in this for me?", () => whatsInIt(player)],
    [ok === "okFirst" ? "Ok I'll get on to it." : "Ok I'll see what I can do.", () => say(player, scene(ok), () => nextErrand(player))]);
}

function introduction(player) {
  const first = icthlarin(player)
    ? [...scene("siamunErrand"), ["set", "clothes", 1]]
    : [...wiki("blackjackErrandNoIcthlarin"), ["set", "blackjacks", 1]];
  play(player, [...scene("hello"), ...scene("introduction"), ...first], () => askAgain(player, "okFirst"));
}

// --------------------------------------------------------------- later visits

function reminderMenu(player) {
  choose(player,
    ["Who did you want me to talk to again?", () => {
      const who = icthlarin(player) ? wiki("reminderSiamun") : wiki("reminderWho");
      say(player, [...who, ...wiki("reminders"), ...wiki("lookUp")], () => reminderMenu(player));
    }],
    ["Ya, I'll get to it soon.", () => say(player, [...wiki("yaSoon"), ...scene("getGoing")], () => junk(player))]);
}

/**
 * The errands are given by the introduction's chain, and each one's state is set just before a menu the player can leave (1756 shows a
 * player doing so), or before Icthlarin's Little Helper was done: such a player would never be given the rest and could never finish
 * (the seller, Aubury and allDone all wait for their state). A later visit gives every errand still at 0, in the introduction's order:
 * Siamun's if Icthlarin's Little Helper is done (912 = 1, 3169 t8233-8238), the blackjack seller's (911 = 1), then the runes (913 = 1).
 * Ours: the wording on a later visit is the introduction's, the blackjack errand without its first line when Siamun's was not given.
 */
function catchUp(player) {
  if (!started(player)) return [];
  const lines = [];
  const ilh = icthlarin(player);
  if (ilh && !get(player, "clothes")) lines.push(...scene("siamunErrand"), ["set", "clothes", 1]);
  if (!get(player, "blackjacks")) lines.push(...(ilh ? scene("blackjackErrand") : wiki("blackjackErrandNoIcthlarin")), ["set", "blackjacks", 1]);
  if (!get(player, "runes")) lines.push(...runesLines(player));
  return lines;
}

function again(player) {
  play(player, [...scene("hello"), ...(icthlarin(player) ? [] : wiki("sigh")), ...catchUp(player), ...wiki("lookUp")], () => reminderMenu(player));
}

function started(player) {
  return get(player, "blackjacks") || get(player, "clothes") || get(player, "runes");
}

// --------------------------------------------------------------- the runes errand (rsprox 3170)

/**
 * Aubury's menu gains the proposal while Ali's request is open (913 = 1); his other lines stay the generated dialogue's.
 * "npc-dialogue:start" resolves the variant a normal Talk-to would and hands its steps to `select`, which gets a copy: the
 * option goes into the choice that holds "Yes please!" (the shop menu), never into another choice. Rune Mysteries is
 * required (the Wiki) and its own conversation is left alone: a player in the middle of it is not touched here.
 */
function auburyTalk(event) {
  if (get(event.player, "runes") !== 1 || !done("Rune Mysteries", event.player)) return false;
  const request = {
    player: event.player, npc: event.npc, npcId: event.npcId,
    select: (steps) => {
      const copy = JSON.parse(JSON.stringify(steps));
      const choice = copy.find((step) => step.type === "choice" && step.options?.some((option) => option.text === "Yes please!"));
      if (!choice) return copy;
      const lines = scene("auburyProposal");
      choice.options.push({
        text: lines[0][1],
        steps: lines.map(([who, text]) => (who === "hook" ? { type: "action", hook: text } : { [who === "player" ? "player" : "npc"]: text })),
      });
      return copy;
    },
  };
  api.emitCustomEvent("npc-dialogue:start", request);
  if (request.handled) event.handled = true;
  return request.handled === true;
}

/** Wiki: stat_random for the rolls; `low` and `high` are the success chart's values out of 256 at levels 1 and 99. */
function roll(player, skill, low, high) {
  const level = player.getSkillManager().getCurrentLevel(skill);
  const chance = Math.floor((low * (99 - level)) / 98 + (high * (level - 1)) / 98) + 1;
  return Math.random() * 256 < chance;
}
/** Wiki: a failed attempt drains 0-3 levels (a quarter each), the same from both skills. */
function drain(player, ...skills) {
  const amount = Math.floor(Math.random() * 4);
  if (!amount) return;
  const manager = player.getSkillManager();
  for (const skill of skills) manager.setCurrentLevel(skill, Math.max(1, manager.getCurrentLevel(skill) - amount));
}

function advance(player, kind) {
  const target = kind === "small" ? 3 : 5;
  if (get(player, "runes") < target) set(player, "runes", target);
  const items = shops.contents(kind);
  const rate = shops.discount();
  const price = shops.offer(items, rate);
  choose(player,
    [`Buy all the runes for ${price}`, () => buyAll(player, items, price)],
    ["Find out what the runes are.", () => { shops.addSurplus(player, items); shops.openDump(player, items, rate); }]);
}

function buyAll(player, items, price) {
  const { ItemIdentifiers, Item } = core();
  const inventory = player.getInventory();
  if (inventory.getAmount(ItemIdentifiers.COINS) < price) {
    player.sendMessage("You don't have enough coins to buy all the runes."); // ours
    return;
  }
  // Room first, on a copy with the coins already gone (they may free their slot): nothing is paid for runes that do not fit.
  const preview = new (core().Inventory)(player).setItems(inventory.getCopiedItems());
  preview.deleted(ItemIdentifiers.COINS, price, false);
  for (const [id, count] of items) {
    const rune = new Item(id, count);
    if (preview.getAddableAmount(rune) < count) {
      inventory.full();
      return;
    }
    preview.add(rune, false);
  }
  inventory.deleteNumber(ItemIdentifiers.COINS, price);
  for (const [id, count] of items) inventory.addItem(new Item(id, count));
  player.sendMessage("You buy all the runes."); // ours
}

function opened(player, kind) {
  player.sendMessage(DATA.scenes.messages.click);
  player.getPacketSender().sendSound(OPEN_SOUND, 1, 0);
  advance(player, kind);
}

function force(player, kind) {
  const { Skill } = core();
  const messages = DATA.scenes.messages;
  if (kind === "large") {
    drain(player, Skill.STRENGTH, Skill.AGILITY);
    say(player, [["box", messages.armsTire], ...scene("largeForceFail")]);
    return;
  }
  if (!roll(player, Skill.STRENGTH, 70, 170)) {
    drain(player, Skill.STRENGTH, Skill.AGILITY);
    say(player, [["box", messages.armsTire], ["box", messages.failChest]]);
  } else if (!roll(player, Skill.AGILITY, 120, 255)) {
    drain(player, Skill.STRENGTH, Skill.AGILITY);
    say(player, [["box", messages.failChest]]);
  } else {
    player.getPacketSender().sendSound(OPEN_SOUND, 1, 0);
    say(player, [["box", messages.forceOpen]], () => {
      player.getSkillManager().addExperiences(Skill.STRENGTH, 2.5);
      player.getSkillManager().addExperiences(Skill.AGILITY, 2.5);
      advance(player, "small");
    });
  }
}

function pick(player, kind) {
  const { Skill } = core();
  const messages = DATA.scenes.messages;
  const lockpick = player.getInventory().contains(LOCKPICK);
  player.getPacketSender().sendSound(PICK_FAIL_SOUND, 1, 0);
  if (kind === "small" && roll(player, Skill.THIEVING, 70, lockpick ? 240 : 170)) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 5);
    say(player, [["box", "You pick the lock."]], () => advance(player, "small")); // ours: the success line is not captured
    return;
  }
  drain(player, Skill.THIEVING);
  if (lockpick && Math.random() < 0.2) {
    player.getInventory().deleteNumber(LOCKPICK, 1);
    player.getSkillManager().addExperiences(Skill.THIEVING, 0.5);
    player.sendMessage("Your lockpick snaps."); // ours
  }
  say(player, [["box", messages.pickFail], ...(kind === "large" ? scene("largePickFail") : [])]);
  if (kind === "large") player.getPacketSender().sendSound(IMPOSSIBLE_SOUND, 1, 0);
}

function methodMenu(player, kind) {
  choose(player,
    ["Force box.", () => force(player, kind)],
    ["Pick lock.", () => pick(player, kind)],
    ["Examine lock.", () => runedoku.open(player, kind)]);
}

function casketMenu(player) {
  const runes = get(player, "runes");
  const small = () => say(player, scene("smallCasketPick"), () => methodMenu(player, "small"));
  const large = () => say(player, scene("largeCasketPick"), () => methodMenu(player, "large"));
  const leave = ["On second thoughts I don't really need any runes.", () => say(player, [["player", "On second thoughts I don't really need any runes."]])];
  if (runes < 3) {
    choose(player, ["Try opening a small casket of runes", small], ["Try opening a large casket of runes", large], leave);
    return;
  }
  const options = [["Try to open a small casket of runes", small], ["Try to open a large casket of runes", large],
    ["Buy elemental runes.", () => { set(player, "stallvar", 1); shops.openRetail(player); }]];
  if (runes >= 5) options.push(["Buy other runes.", () => { set(player, "stallvar", 1); shops.openWholesale(player); }]);
  choose(player, ...options, leave);
}

/** "I would like to have a look at your selection of runes." */
function runesStock(player) {
  const first = [...scene("hangOn"), ...(get(player, "stallvar") ? [] : [["set", "stallvar", 1]])];
  const lines = get(player, "runes") === 2 ? [...first, ...scene("runesNoStock")] : first;
  play(player, lines, () => casketMenu(player));
}

// Ali's conversation after Rogue Trader: this plugin plays the greeting, the reports and the thanks (captured, one page a line: the
// generated page's engine would split a line of about 200 characters into two pages, which 3170 does not), then the menu and what
// follows are the generated page's variant "standard-dialogue-after-completing-rogue-trader" (the blackjack, clothes, runes and
// general stock menu, the expand-your-business answers, the junk sale), started with "npc-dialogue:start" and cut to what the player
// has unlocked, with a "Who did you want me to talk to again?" added while an errand is open and the runes option left to this
// plugin's casket conversation (3170).
const ALI_VARIANT = "standard-dialogue-after-completing-rogue-trader";
const ACTION = "rogue-trader";
const unlocked = {
  blackjacks: (player) => get(player, "blackjacks") >= 3,
  clothes: (player) => get(player, "clothes") >= 3,
  runes: (player) => get(player, "runes") >= 2,
};

function aliVariantSteps(player, steps) {
  const copy = JSON.parse(JSON.stringify(steps));
  const at = copy.findIndex((step) => step.type === "choice");
  if (at < 0) return copy;
  const choice = copy[at];
  choice.options = choice.options.filter((option) => {
    if (option.text.includes("selection of blackjacks")) return unlocked.blackjacks(player);
    if (option.text.includes("selection of clothes")) return unlocked.clothes(player);
    if (option.text.includes("selection of runes")) return unlocked.runes(player);
    if (option.text.includes("expand your business")) return allDone(player);
    return true;
  });
  for (const option of choice.options) {
    if (option.text.includes("selection of runes")) option.steps = [{ type: "action", action: ACTION, target: "runes" }];
  }
  if (!allDone(player)) {
    choice.options.push({ text: "Who did you want me to talk to again?", steps: [{ type: "action", action: ACTION, target: "who" }] });
  }
  return [choice, ...copy.slice(at + 1)]; // the page's greeting is left out: the plugin has played it
}

function aliMenu(player) {
  const request = {
    player, npc: talkingTo.get(player), npcId: ALI, exact: true,
    variant: { page: "Ali Morrisane", variant: ALI_VARIANT },
    select: (steps) => aliVariantSteps(player, steps),
  };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

function viewBlackjacks(player) {
  set(player, "stallvar", 2);
  shops.openBlackjacks(player, get(player, "blackjacks") === 3 ? "offensive" : "defensive");
}

function allDone(player) {
  return get(player, "blackjacks") >= 3 && get(player, "clothes") >= 3 && get(player, "runes") >= 2;
}

function viewClothes(player) {
  const menaphite = get(player, "clothes") === 3;
  set(player, "stallvar", menaphite ? 5 : 3);
  shops.openClothes(player, menaphite ? "menaphite" : "desert");
}

/** The generated page's action steps, for Ali: the stocks, the junk sale, and this plugin's own conversations. */
function aliAction(request) {
  if (request.npcId !== ALI) return;
  const { player, action, target } = request;
  if (action === ACTION && target === "runes") { request.handled = true; runesStock(player); return; }
  if (action === ACTION && target === "who") {
    request.handled = true;
    const who = icthlarin(player) ? wiki("reminderSiamun") : wiki("reminderWho");
    say(player, [...who, ...wiki("reminders"), ...wiki("lookUp")], () => aliMenu(player));
    return;
  }
  // The page closes after an action it did not take; the shop opens once it has.
  if (action === "open_interface" && String(target).startsWith("Ali's Discount Wares.#Blackjacks")) {
    request.handled = true; request.end = true; later(1, player, () => viewBlackjacks(player)); return;
  }
  if (action === "open_interface" && String(target).startsWith("Ali's Discount Wares.#Clothing")) {
    request.handled = true; request.end = true; later(1, player, () => viewClothes(player)); return;
  }
  if (action === "receive" && String(request.text).includes("Ali's Discount Wares")) { request.handled = true; junkSale(player); }
}

/** The exact generated shopkeeper conditions, scoped to their Al Kharid NPCs. */
const DOMMIK = 2879, ELLIS = 3231, KARIM = 2877, ZEKE = 2875;
const AL_KHARID_SHOP_ASSISTANT = 2818, AL_KHARID_SHOP_KEEPER = 2817;
const SHOPKEEPER_CONDITIONS = new Map([
  [DOMMIK, "After Rogue Trader:"],
  [ELLIS, "With Rogue Trader completed?"],
  [AL_KHARID_SHOP_ASSISTANT, "After Rogue Trader:"],
  [AL_KHARID_SHOP_KEEPER, "After Rogue Trader:"],
  [KARIM, "After Rogue Trader"],
  [ZEKE, "After Rogue Trader"],
]);

/** Preserve Ali's Captain Dalbur guard; other conditions belong to their own providers. */
function aliCondition(request) {
  if (request.npcId === ALI && /Captain Dalbur/.test(String(request.text))) return false;
  if (SHOPKEEPER_CONDITIONS.has(request.npcId) && SHOPKEEPER_CONDITIONS.get(request.npcId) === request.text) {
    return allDone(request.player) && done("Prince Ali Rescue", request.player);
  }
  return null;
}

function onHook(event) {
  if (event.hook === "rogue-trader:aubury") {
    set(event.player, "runes", 2);
    set(event.player, "obtRunes", 1);
  }
}

/** Ali's reports of finished errands come once, after the greeting (3170 t1105-1124). */
function reports(player) {
  const lines = [];
  if (get(player, "blackjacks") >= 3 && !get(player, "toldAli")) lines.push(...scene("aliBlackjackReport"));
  if (get(player, "clothes") >= 3 && !get(player, "garments")) lines.push(...scene("aliClothesReport"));
  // 549 t3727: the first talk with all three done thanks the player and gives the carpet discount, unless it was asked for early.
  if (allDone(player) && !get(player, "cheapflights")) lines.push(...scene("aliFinish"));
  return lines;
}

function returnVisit(player) {
  const lines = [
    ...scene("hello"),
    ...(get(player, "obtRunes") ? [...scene("goodJob"), ["set", "obtRunes", 0]] : []),
    ...catchUp(player),
    ...reports(player),
  ];
  play(player, lines, () => aliMenu(player));
}

/** The Trade option once something is Ali's business: each unlocked stock, then the general one (3170 t496, t809). */
function trade(event) {
  const { player, npcId } = event;
  if (npcId !== ALI || !done("The Feud", player) || get(player, "runes") < 2 && get(player, "blackjacks") < 3 && get(player, "clothes") < 3) return false;
  event.handled = true;
  talkingTo.set(player, event.npc);
  const options = [];
  if (get(player, "blackjacks") >= 3) options.push(["View blackjacks.", () => viewBlackjacks(player)]);
  if (get(player, "clothes") >= 3) options.push(["View clothes.", () => viewClothes(player)]);
  if (get(player, "runes") >= 2) options.push(["View runes.", () => casketMenu(player)]);
  options.push(["View general stock.", () => core().ShopManager.open(player, ALIS_DISCOUNT_WARES)]);
  choose(player, ...options);
  return true;
}

// --------------------------------------------------------------- the blackjack errand (rsprox 3170)

/** Wiki success chart "Taking a hit": Defence 100 at level 1 to 255 at 99, out of 256. */
const hitHolds = (player) => roll(player, core().Skill.DEFENCE, 100, 255);
const KNOCKED_OUT_DAMAGE = 3;

function knockedOut(player) {
  player.setHitpoints(Math.max(1, player.getHitpoints() - KNOCKED_OUT_DAMAGE));
  say(player, DATA.oursScenes.bjKnockedOut);
}

function chickenOut(player) {
  say(player, wiki("bjSkip"));
}

/** The seller hits twice (3170 t1197-1257); a hit that gets through knocks the player out. */
function offensive(player) {
  play(player, scene("bjOffensiveAsk"), () => choose(player,
    ["Umm... on second thoughts I might give it a skip.", () => chickenOut(player)],
    ["I'm sure. No pain no gain. Grrr!", () => {
      play(player, [...scene("bjOffensiveSure"), ["sound", 2508]], () => {
        if (!hitHolds(player)) return knockedOut(player);
        play(player, [["sound", 2727], ...scene("bjHit1")], () => choose(player,
          ["Go again.", () => {
            play(player, [...scene("bjOffensiveAgain"), ["sound", 2508]], () => {
              if (!hitHolds(player)) return knockedOut(player);
              play(player, [["sound", 2727], ...scene("bjHit2"), ["set", "weapons", 1], ...scene("bjOffensiveEnd")]);
            });
          }],
          ["Chicken out.", () => chickenOut(player)]));
      });
    }]));
}

function cunningMenu(player) {
  choose(player,
    ["Hmm... I'll have to think of a cunning plan.", () => say(player, scene("bjCunning"))],
    ["I bet you couldn't knock me out with your blackjack.", () => offensive(player)]);
}

function sellerTalk(event) {
  const { player } = event; // found by the "Blackjack seller" hook: a multi-NPC, its event id is the resolved form
  if (!done("The Feud", player) || !get(player, "blackjacks")) return false;
  event.handled = true;
  const blackjacks = get(player, "blackjacks");
  if (blackjacks === 1) {
    play(player, scene("bjProposal"), () => cunningMenu(player));
  } else if (blackjacks === 2 && get(player, "weapons") === 2) {
    play(player, scene("bjFinishDefensive"));
  } else if (blackjacks === 2 && get(player, "urchinPaid")) {
    set(player, "urchinPaid", 0);
    const lines = scene("bjTheft");
    const last = lines.findIndex((line) => line[0] === "set");
    play(player, [...lines.slice(0, last - 1), ["sound", 2508], lines[last - 1], ...lines.slice(last), ["box", scene("bjTheftBox")]]);
  } else if (blackjacks === 2) {
    play(player, wiki("bjSellerHello"), () => cunningMenu(player));
  } else if (get(player, "toldAli")) {
    // Ali has asked for a different variety: 4 -> 3 is the captured knock-out; 3 -> 4 goes round the cunning plan again (ours).
    play(player, scene("bjAgain"), () => choose(player,
      ["I bet you couldn't knock me out with your blackjack.", () => (blackjacks === 4 ? offensive(player) : say(player, scene("bjCunning"), () => set(player, "blackjacks", 2)))],
      ["Hmmm... I'll get back to you on this.", () => say(player, [["player", "Hmmm... I'll get back to you on this."]])]));
  } else {
    say(player, wiki("bjSellerAfter"));
  }
  return true;
}

function urchinTalk(event) {
  const { player } = event;
  if (!done("The Feud", player) || get(player, "blackjacks") < 2) return false;
  const blackjacks = get(player, "blackjacks");
  if (blackjacks === 2 && get(player, "weapons") !== 2) {
    event.handled = true;
    const { ItemIdentifiers } = core();
    // Paid once: he only repeats the plan (the captured line after the payment, ours here).
    if (get(player, "urchinPaid")) return say(player, scene("bjUrchinPaid").slice(1)), true;
    play(player, scene("bjUrchin"), () => {
      if (player.getInventory().getAmount(ItemIdentifiers.COINS) < URCHIN_PRICE) return say(player, wiki("bjUrchinBroke"));
      choose(player,
        ["Woah! That's far too much.", () => say(player, [["player", "Woah! That's far too much."]])],
        ["Fair enough, here you go.", () => {
          player.getInventory().deleteNumber(ItemIdentifiers.COINS, URCHIN_PRICE);
          set(player, "urchinPaid", 1);
          say(player, scene("bjUrchinPaid"));
        }]);
    });
    return true;
  }
  event.handled = true;
  say(player, wiki("bjUrchinAfter"));
  return true;
}

// --------------------------------------------------------------- the clothes errand (rsprox 3170, 549)

/** Slots of real (not preset) items of this id: [[slot, amount]]. */
function realSlots(player, id) {
  const slots = [];
  player.getInventory().getItems().forEach((item, slot) => {
    if (item && item.getId() === id && item.isPresetItem?.() !== true) slots.push([slot, item.getAmount()]);
  });
  return slots;
}
const sum = (slots) => slots.reduce((total, [, amount]) => total + amount, 0);

/** Wiki: three pots of dye of any colour, or three pelts of one kind (cowhide, grey wolf fur, snakeskin, bear fur, wool). */
function materials(player, kind) {
  const { ItemIdentifiers: I } = core();
  const taken = [];
  if (kind !== "pelts") {
    const dyes = [I.RED_DYE, I.YELLOW_DYE, I.BLUE_DYE, I.ORANGE_DYE, I.GREEN_DYE, I.PURPLE_DYE, I.BLACK_DYE, I.PINK_DYE];
    let need = 3;
    for (const id of dyes) for (const [slot, amount] of realSlots(player, id)) if (need > 0) { const use = Math.min(amount, need); taken.push([slot, use]); need -= use; }
    if (need === 0) return { kind: "dye", taken };
    taken.length = 0;
  }
  if (kind !== "dye") {
    for (const id of [I.COWHIDE, I.GREY_WOLF_FUR, I.SNAKESKIN, I.SNAKESKIN_2, I.BEAR_FUR, I.WOOL]) {
      const slots = realSlots(player, id);
      if (sum(slots) >= 3) {
        let need = 3;
        for (const [slot, amount] of slots) if (need > 0) { const use = Math.min(amount, need); taken.push([slot, use]); need -= use; }
        return { kind: "pelts", taken };
      }
    }
  }
  return null;
}

/** Sends the player away from Siamun with no materials. */
function noMaterials(player) {
  play(player, wiki("siaNo"), () => choose(player,
    ["Umm... What do you need again?", () => say(player, wiki("siaWhatAgain"))],
    ["Ok.", () => say(player, wiki("siaOkOnly"))]));
}

/**
 * After "Unless you've got the materials on you?": the player's "Yup", and only when that line is continued are the materials looked
 * at again, taken from where they are then, and the outfit set (3170 t1063: the varbit comes with the line after "Yup"). Items
 * dropped or moved while the lines play are therefore never paid for twice or taken from a slot that now holds something else.
 * `kind` limits what he asks for.
 */
function checkMaterials(player, kind, yup, thanks) {
  if (!materials(player, kind)) return noMaterials(player);
  play(player, yup, () => {
    const found = materials(player, kind);
    if (!found) return noMaterials(player);
    for (const [slot, amount] of found.taken) player.getInventory().deleteAtSlot(slot, amount);
    const outfit = found.kind === "dye" ? 3 : 4;
    set(player, "clothes", outfit);
    set(player, "garments", 0); // either way: Ali has to report on the new outfit before Siamun offers the next switch
    play(player, [["box", found.kind === "dye" ? scene("messages").giveDye : scene("messages").givePelts], ...thanks]);
  });
}

/** The "What do you mean by animal pelt?" / "Ok, I'll get you the materials." menu. */
function materialsMenu(player, kind, ok, yup, thanks) {
  choose(player,
    ["What do you mean by animal pelt?", () => play(player, [wiki("siaWhatPelt")[0], wiki("siaWhatPelt")[1], ["set", "clothes", Math.max(2, get(player, "clothes"))], ...wiki("siaWhatPelt").slice(2)], () => checkMaterials(player, kind, yup, thanks))],
    ["Ok, I'll get you the materials.", () => play(player, [["set", "clothes", Math.max(2, get(player, "clothes"))], ...ok], () => checkMaterials(player, kind, yup, thanks))]);
}

function siamunTalk(event) {
  const { player, npcId } = event;
  if (npcId !== SIAMUN || !done("The Feud", player) || !get(player, "clothes")) return false;
  event.handled = true;
  const clothes = get(player, "clothes");
  if (clothes === 1) {
    play(player, scene("siaFirst"), () => materialsMenu(player, "any", scene("siaOkMaterials"), scene("siaYup"), scene("siaThanks")));
  } else if (clothes === 2) {
    play(player, wiki("siaTwo"), () => checkMaterials(player, "any", scene("siaYup"), scene("siaThanks")));
  } else if (!get(player, "garments")) {
    say(player, wiki("siaAfter"));
  } else if (clothes === 3) {
    play(player, scene("siaDesertAsk"), () => materialsMenu(player, "pelts", scene("siaDesertOk"), scene("siaYupDesert"), scene("siaThanksDesert")));
  } else {
    play(player, wiki("siaDyeAsk"), () => materialsMenu(player, "dye", scene("siaDesertOk"), scene("siaYupDesert"), scene("siaThanksDesert")));
  }
  return true;
}

function talkTo(event) {
  const { player, npcId } = event;
  if (npcId !== ALI || !done("The Feud", player)) return false;
  event.handled = true;
  talkingTo.set(player, event.npc);
  if (get(player, "runes") >= 2 || get(player, "blackjacks") >= 3 || get(player, "clothes") >= 3) returnVisit(player);
  else if (started(player)) again(player);
  else introduction(player);
  return true;
}

module.exports = {
  name: "RogueTrader",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(STATE, {});
    shops = Shops.attach(api);
    runedoku = Runedoku.attach(api, { opened });
    api.onNpcInteraction("Ali Morrisane", { "Talk-to": talkTo, Trade: trade });
    api.onNpcInteraction("Aubury", { "Talk-to": auburyTalk });
    api.onNpcInteraction("Blackjack seller", { "Talk-to": sellerTalk });
    api.onNpcInteraction("Street urchin", { "Talk-to": urchinTalk });
    api.onNpcInteraction("Siamun", { "Talk-to": siamunTalk });
    api.onCustomEvent("npc-dialogue:hook", onHook);
    api.onCustomEvent("npc-dialogue:action", aliAction);
    api.onNpcDialogueCondition(aliCondition);
    api.onPlayerLogin(syncVarbits);
    api.onCustomEvent("shop:sell-price", (request) => {
      // Ali pays half the value for runes, in his casket, elemental and other-runes shops (Wiki: buymultiplier=500).
      if (!shops.isRuneShop(request.shopId)) return;
      const price = shops.sellPrice(request.itemId);
      if (price !== null) request.price = price;
    });
    api.onCustomEvent("rogue-trader:cheap-flights", (query) => { if (get(query.player, "cheapflights")) query.cheap = true; });
  },
};
