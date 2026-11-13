"use strict";

/**
 * The tree west of Draynor Village bank (wom_tree), with a guard hiding in it to watch the bank
 * robbery suspect. https://oldschool.runescape.wiki/w/Tree_(Draynor_guard)
 *
 * - Chop down: the player swings their axe, and two ticks later stops as the guard complains
 *   with one of his lines. The tree is never felled and gives no logs.
 * - Talk to: "Hello?", then the guard's lines. A player who has not heard about the robbery from
 *   the bank guard is sent to him; one who has gets three questions, one of which asks for stew.
 * - With a stew (Talk to, or the stew used on the tree): the guard takes it for 30 coins and,
 *   25 ticks later, drops the empty bowl out of the tree. Talking to him while he eats gets only
 *   the player's own line.
 * - Any other item used on the tree: the guard waves it away.
 */

const Woodcutting = require("../skills/Woodcutting.plugin");

const TREE_LOC = "wom_tree";
const GUARD_NPC = "wom_bankguard";
const GUARD_NAME = "Guard";
const STEW = "stew";
const BOWL = "bowl_empty";
const COINS = "coins";
const STEW_REWARD = 30;
/** Ticks from the hand-over to the empty bowl landing. */
const EATING_TICKS = 25;
/** Ticks the axe swings before the guard speaks. */
const CHOP_TICKS = 2;
/** Where the bowl lands, beside the tree. */
const BOWL_TILE = { x: 3084, y: 3245, z: 0 };
const OPTIONS_TITLE = "What would you like to say?";
const BOWL_DROPPED = "The guard drops the empty bowl out of the tree!";
/** The guard's lines when someone takes an axe to his tree; one is picked at random. */
const CHOP_LINES = [
  "Ooooch!",
  "Oi!",
  "Watch what you're doing with that axe, you nit!",
  "You'll blow my cover! I'm meant to be hidden!",
  "Will you stop that?",
  "Don't draw attention to me!",
  "Hey - gerroff me!",
  "Ow! That really hurt!",
];

/** Set when the Draynor bank guard tells the player the bank was robbed. */
const HEARD_ROBBERY_ATTRIBUTE = "draynor-bank-robbery:heard";
/** Cache varbit wom_bankjob: 1 once the bank guard has told the player about the robbery. */
const BANK_JOB_VARBIT = "wom_bankjob";
const BANK_GUARD_ROBBERY_LINE = "Someone smashed the wall when they were robbing the bank.";
/** Non-saved: the guard is eating the player's stew until the bowl drops. */
const EATING_ATTRIBUTE = "draynor-guard-tree:eating";
/** Non-saved: the swing in progress, so a second click doesn't queue a second complaint. */
const CHOPPING_ATTRIBUTE = "draynor-guard-tree:chopping";

let api = null;
let core = null;

const treeId = () => core.CacheDefinitions.getLocId(TREE_LOC);
const guardId = () => core.CacheDefinitions.getNpcId(GUARD_NPC);
const seq = (name) => core.CacheDefinitions.getSeqId(name) ?? undefined;

function later(player, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, player, false); }
    execute() { this.stop(); action(); }
  })());
}

/** One line of a conversation: [speaker, text, chathead animation], speaker "player" or "guard". */
function lineDialogue(index, [speaker, text, anim]) {
  const { NpcDialogue, PlayerDialogue } = core;
  return speaker === "player"
    ? new PlayerDialogue(index, text, seq(anim))
    : new NpcDialogue(index, guardId(), text, GUARD_NAME, seq(anim));
}

/** Plays the lines in order, then `after` (another dialogue entry) if given. */
function say(player, lines, after = null) {
  const { DialogueChainBuilder } = core;
  const chain = new DialogueChainBuilder();
  lines.forEach((line, index) => chain.add(lineDialogue(index, line)));
  if (after) chain.add(after(lines.length));
  player.getDialogueManager().startDialogues(chain);
}

function choose(player, options) {
  return (index) => new core.OptionDialogue(index, {
    executeOption(option) {
      const chosen = options[Number(option) - 1];
      if (!chosen) return player.getPacketSender().sendInterfaceRemoval();
      chosen.run(player);
    },
  }, ...options.map((o) => o.text)).setTitle(OPTIONS_TITLE);
}

/** A dialogue entry that runs `run` when the chain reaches it (after the previous Continue). */
const action = (run) => (index) => new core.ActionDialogue(index, { execute: run });

function heardAboutRobbery(player) {
  return player.getAttribute(HEARD_ROBBERY_ATTRIBUTE) === true;
}

function hasStew(player) {
  return player.getInventory().contains(core.CacheDefinitions.getObjId(STEW));
}

function isEating(player) {
  return player.getAttribute(EATING_ATTRIBUTE) === true;
}

const ROBBERY_QUESTIONS = [
  {
    text: "This is about the bank robbery, right?",
    run: (player) => say(player, [
      ["player", "This is about the bank robbery, right?", "chatneu1"],
      ["guard", "Yes, that's right. We're keeping the suspect under tight observation for the moment.", "chatneu2"],
      ["player", "Can't you just... I dunno... arrest him?", "chatcon1"],
      ["guard", "I'm not meant to discuss the case. You know what confidentiality rules are like.", "chatneu2"],
      ["player", "Fair enough.", "chatneu1"],
    ]),
  },
  {
    text: "You're not being very subtle up there.",
    run: (player) => say(player, [
      ["player", "You're not being very subtle up there.", "chatlaugh1"],
      ["guard", "I'd be doing a lot better if nits like you didn't come crowding around me all day!", "chatang2"],
      ["player", "But your legs are hanging down!", "chatlaugh1"],
      ["guard", "Go away!", "chatang1"],
      ["player", "Please yourself!", "chatsad1"],
    ]),
  },
  {
    text: "Can I do anything to help?",
    run: (player) => say(player, [
      ["player", "Can I do anything to help?", "chatquiz1"],
      ["guard", "That's very kind of you. I'd rather like a nice bowl of stew, if you could fetch me one. I don't get many meal breaks.", "chatquiz3"],
      ["player", "You want a bowl of stew?", "chatcon1"],
      ["guard", "If you wouldn't mind...", "chathap1"],
      ["player", "I'll think about it!", "chatshifty1"],
    ]),
  },
];

/** Ours: the chathead animations of the not-yet-heard branch are not recorded. */
const NOT_HEARD_LINES = [
  ["player", "What's this all about?", "chatquiz1"],
  ["guard", "Hadn't you heard? You'd better go and talk to the other guard, the one by the bank door. He'll tell you all about it.", "chatneu1"],
  ["guard", "Go on, ask him what's wrong with the bank wall. He loves when people ask him that.", "chatneu1"],
  ["player", "Ok, if you say so..", "chatneu1"],
];

const STEW_OPTIONS = [
  {
    text: "Ok, take the stew!",
    run: (player) => startThanks(player, [["player", "Ok, take the stew!", "chathap1"]]),
  },
  {
    text: "No, I want to keep this stew!",
    run: (player) => say(player, [
      ["player", "No, I want to keep this stew!", "chatneu1"],
      ["guard", "Fair enough. But if you change your mind, I'll probably still be here.", "chatsad2"],
    ]),
  },
];

/** The player's lines, the guard's thanks, then the stew for coins on Continue. */
function startThanks(player, lines) {
  say(player, [
    ...lines,
    ["guard", "Gosh, that's very kind of you! Here, have a few coins for your trouble...", "chathap2"],
  ], action(() => takeStew(player)));
}

function takeStew(player) {
  const { CacheDefinitions, Sounds, Sound } = core;
  player.getPacketSender().sendInterfaceRemoval();
  const inventory = player.getInventory();
  const stew = CacheDefinitions.getObjId(STEW);
  if (isEating(player) || !inventory.contains(stew)) return;
  inventory.deleteNumber(stew, 1);
  inventory.adds(CacheDefinitions.getObjId(COINS), STEW_REWARD);
  Sounds.sendSound(player, Sound.FOOD_EAT);
  player.setAttribute(EATING_ATTRIBUTE, true);
  later(player, EATING_TICKS, () => dropBowl(player));
}

function dropBowl(player) {
  const { CacheDefinitions, Item, Location, ItemOnGroundManager, Sounds, Sound } = core;
  player.setAttribute(EATING_ATTRIBUTE, false);
  if (!player.isRegistered()) return;
  player.sendMessage(BOWL_DROPPED);
  ItemOnGroundManager.registerLocation(player, new Item(CacheDefinitions.getObjId(BOWL), 1),
    new Location(BOWL_TILE.x, BOWL_TILE.y, BOWL_TILE.z));
  Sounds.sendSound(player, Sound.DROP_ITEM);
}

function talkTo({ player }) {
  player.setAttribute(CHOPPING_ATTRIBUTE, null);
  if (isEating(player)) {
    say(player, [["player", "I think I should leave him in peace to finish his stew!", "chatneu1"]]);
    return true;
  }
  if (hasStew(player)) {
    say(player, [
      ["player", "Hello?", "chatquiz1"],
      ["guard", "Yes, what do you... I say, is that stew for me?", "chatneu1"],
    ], choose(player, STEW_OPTIONS));
    return true;
  }
  const opening = [
    ["player", "Hello?", "chatquiz1"],
    ["guard", "Ssshhh! What do you want?", "chatang1"],
    ["player", "Well, it's not every day you see a man up a tree.", "chatquiz1"],
    ["guard", "I'm trying to observe a suspect. Leave me alone!", "chatang1"],
  ];
  if (heardAboutRobbery(player)) say(player, opening, choose(player, ROBBERY_QUESTIONS));
  else say(player, [...opening, ...NOT_HEARD_LINES]);
  return true;
}

/** The axe swings for two ticks, then stops as the guard complains. No logs, no felling. */
function chopDown({ player, object }) {
  const { Animation, Sounds, Sound } = core;
  const request = { player, itemId: null, axe: null };
  api.emitCustomEvent("woodcutting:axe", request);
  if (!request.axe) {
    player.sendMessage(Woodcutting.NO_AXE_MESSAGE);
    return true;
  }
  if (player.getAttribute(CHOPPING_ATTRIBUTE)) return true;
  const swing = {};
  player.setAttribute(CHOPPING_ATTRIBUTE, swing);
  const at = player.getLocation().clone();
  player.setPositionToFace(object.getLocation());
  player.performAnimation(new Animation(request.axe.animationId));
  later(player, CHOP_TICKS, () => {
    // Talking to him or using an item on the tree mid-swing takes over from the complaint.
    if (player.getAttribute(CHOPPING_ATTRIBUTE) !== swing) return;
    player.setAttribute(CHOPPING_ATTRIBUTE, null);
    if (!player.isRegistered() || !player.getLocation().equals(at)) return;
    player.performAnimation(new Animation(-1));
    Sounds.sendSound(player, Sound.PLAYER_GETTING_HIT);
    const line = CHOP_LINES[Math.floor(Math.random() * CHOP_LINES.length)];
    say(player, [["guard", line, "chatshock1"]]);
  });
  return true;
}

/** The stew handed over directly; anything else is waved away. */
function useItemOnTree(event) {
  if (event.objectId !== treeId()) return;
  event.handled = true;
  const { player, itemId } = event;
  player.setAttribute(CHOPPING_ATTRIBUTE, null);
  if (isEating(player)) {
    say(player, [["player", "I think I should leave him in peace to finish his stew!", "chatneu1"]]);
    return;
  }
  if (itemId === core.CacheDefinitions.getObjId(STEW)) {
    startThanks(player, [["player", "Here's some stew.", "chathap1"]]);
    return;
  }
  // Ours: the chathead animations of this exchange are not recorded.
  say(player, [
    ["guard", "Why the demoninikin are you waving THAT at me?", "chatang1"],
    ["player", "Sorry, I thought you'd like it.", "chatneu1"],
    ["guard", "Erm... No thanks! Now, if you don't mind, I'm trying to observe this suspect!", "chatang1"],
    ["player", "Sorry!", "chatneu1"],
  ]);
}

/** The bank guard's robbery story marks the player as having heard about it. */
function bankGuardLine(request) {
  if (request.npcId !== guardId() || request.text !== BANK_GUARD_ROBBERY_LINE) return;
  if (heardAboutRobbery(request.player)) return;
  request.player.setAttribute(HEARD_ROBBERY_ATTRIBUTE, true);
  sendBankJob({ player: request.player });
}

function sendBankJob({ player }) {
  if (!heardAboutRobbery(player)) return;
  const varbit = core.CacheDefinitions.getVarbitId(BANK_JOB_VARBIT);
  if (varbit != null && player.getPacketSender().getVarbit(varbit) < 1) player.getPacketSender().sendVarbit(varbit, 1);
}

function initialize(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "DraynorGuardTree",
  description: "The Draynor Village tree with a guard hiding in it: Chop down gets a complaint instead of logs, Talk to and the stew he asks for.",
  register(pluginApi) {
    initialize(pluginApi);
    pluginApi.persistAttribute(HEARD_ROBBERY_ATTRIBUTE, false);
    pluginApi.onObjectFirstClick(treeId(), chopDown);
    pluginApi.onObjectSecondClick(treeId(), talkTo);
    pluginApi.onItemOnObject(useItemOnTree);
    pluginApi.onCustomEvent("npc-dialogue:line", bankGuardLine);
    pluginApi.onPlayerLogin(sendBankJob);
  },
  _test: { CHOP_LINES, HEARD_ROBBERY_ATTRIBUTE, EATING_ATTRIBUTE, EATING_TICKS, CHOP_TICKS, BOWL_TILE, STEW_REWARD },
};
