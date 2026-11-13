// Level-up feedback as live OSRS sends it (rsprox captures, docs/settings.md): the chat
// message, graphic and sounds, then the chatbox pop-up (levelup_display, 233) unless the player
// turned it off in Settings > Interfaces > "Level-up pop-up notifications". With "Show level &
// unlocks", Continue opens a box per level saying what it unlocked (the OSRS Wiki transcripts'
// text, beside the level's pictures); otherwise those lines go to the chat if the player turned
// on "Level-up chatbox list". A combat level gained with it follows a tick later; its pop-up
// waits until the skill's (and its box) is done.
//
// Opening a pop-up interrupts what the player is doing: it emits "level-up:popup-opened"
// { player, skill, pause }, which holds skilling until Continue. With pop-ups off, nothing stops.
// World owners can also disable the blocking pop-up with SkillLevelUp:interruptActions.
const GROUP = 233;
const TEXT1 = (GROUP << 16) | 1;
const TEXT2 = (GROUP << 16) | 2;
const CONTINUE = (GROUP << 16) | 3;
// RuneLite InterfaceID.LevelupDisplay, verified against cache group 233, in Skill.getIndex()
// order (Construction precedes Hunter in server arrays); then the combat icon.
const SKILL_LAYERS = [6, 17, 49, 30, 40, 38, 34, 12, 53, 25, 23, 21,
  14, 47, 36, 28, 4, 51, 45, 19, 43, 9, 32, 57];
const COMBAT_LAYER = 55;
const ICON_LAYERS = [...SKILL_LAYERS, COMBAT_LAYER];
const TOPLEVEL_CHATBOX_RESETBACKGROUND_SCRIPT = 2379;

// option_level_up_message_disabled: "Level-up pop-up notifications" set to Disabled.
const POPUP_DISABLED_VARBIT = 20157;
// option_level_up_popup_list: "Show level & unlocks". Continuing then opens a box listing them.
const POPUP_LISTS_UNLOCKS_VARBIT = 4371;
// The box that lists them: the level's picture beside its text (objectbox, 193), two
// pictures either side of it (objectbox_double, 11), or the text alone (messagebox, 229).
const UNLOCK_BOX_GROUPS = [193, 11, 229];
// Which picture(s) each level's box shows, as obj gamevals (see the file's _source); levels
// not listed there use the generated messages' items.
const UNLOCK_PICTURES = require("./data/level-up-pictures.json");
const INTERRUPT_ACTIONS_CONFIG = "SkillLevelUp:interruptActions";

const LEVELUP_ANIM = 199;
const LEVELUP_99_ANIM = 1388;
const GRAPHIC_HEIGHT = 124;
const MAX_LEVEL = 99;
// Two area sounds at the player, the second 25 client cycles later.
const LEVEL_UP_SOUNDS = [{ soundId: 2396, delay: 0 }, { soundId: 2384, delay: 25 }];
const SOUND_RADIUS = 1;
const TOTAL_LEVEL_STEP = 25;

// option_level_up_chatbox_list: "Level-up chatbox list". Only with it on do the unlock lines go
// to the chat when no unlock box shows them.
const CHATBOX_LIST_VARBIT = 20158;
// option_level_up_guide_list_disabled: with it set, only the plain jingle ever plays.
const GUIDE_LIST_DISABLED_VARBIT = 20159;
// midi_jingle ids (cache gamevals index 24 kind 18, "advance <skill>" and "advance <skill>2"),
// as the Wiki's Jingles page pairs them: [normal, unlocks]. Agility has one jingle, and the
// "special" skills pick by level (see jingleFor).
const COMBAT_JINGLE = 299;
const JINGLES = {
  Attack: [29, 30], Defence: [37, 38], Ranged: [57, 58], Prayer: [55, 56], Magic: [51, 52],
  Runecrafting: [59, 60], Crafting: [35, 36], Mining: [53, 54], Smithing: [63, 64],
  Fishing: [41, 42], Cooking: [33, 34], Firemaking: [39, 40], Woodcutting: [69, 70],
  Herblore: [45, 46], Thieving: [67, 68], Fletching: [43, 44], Slayer: [61, 62],
  Farming: [10, 11],
  Agility: [28, 28],
  // Hitpoints and Strength switch at 50, Construction's second is every 10th level, Hunter's
  // alternates (the Wiki lists Even first), Sailing's second is 99.
  Hitpoints: [47, 48], Strength: [65, 66], Construction: [31, 32], Hunter: [49, 50], Sailing: [831, 832],
};
const SECOND_JINGLE = {
  Hitpoints: (level) => level >= 50, Strength: (level) => level >= 50,
  Construction: (level) => level % 10 === 0, Hunter: (level) => level % 2 === 1,
  Sailing: (level) => level === MAX_LEVEL,
};

const COMBAT_LEVEL_ATTRIBUTE = "level-up:combat-level";
// The combat level the queued combat pop-up started from, or undefined when none is queued.
const COMBAT_POPUP_FROM_ATTRIBUTE = "level-up:combat-popup-from";
const POPUP_OPENED_EVENT = "level-up:popup-opened";

// What the game tells the player they just unlocked, per skill and level, as the OSRS Wiki
// records it (see the file's _source). A nested entry carries the transcript's own qualifier.
const UNLOCK_MESSAGES = require("./data/level-up-messages.json");

let pluginApi = null;
const pending = new WeakMap();
let statsByName = null;

function celebrate(player, message, graphicId) {
  const { Graphic, Sounds } = pluginApi.core;
  player.sendMessage(message);
  player.performGraphic(new Graphic(graphicId, 0, GRAPHIC_HEIGHT));
  const at = player.getLocation();
  for (const { soundId, delay } of LEVEL_UP_SOUNDS) {
    Sounds.playAreaSound({ soundId, delay, x: at.getX(), y: at.getY(), level: at.getZ(), radius: SOUND_RADIUS });
  }
}

function statNamed(name) {
  if (!statsByName) {
    statsByName = new Map(pluginApi.core.Skill.VALUES.map((stat) => [stat.getName(), stat]));
  }
  return statsByName.get(name);
}

/** An unlock's qualifier as the transcript words it: a stat, a quest, or all/any of those. */
function conditionHolds(player, condition) {
  if (condition.all) return condition.all.every((child) => conditionHolds(player, child));
  if (condition.any) return condition.any.some((child) => conditionHolds(player, child));
  if (condition.quest) {
    const request = { player, name: condition.quest, complete: null };
    pluginApi.emitCustomEvent("quest:is-complete", request);
    // An unknown quest answers null, which satisfies neither branch.
    return condition.not ? request.complete === false : request.complete === true;
  }
  const stat = statNamed(condition.skill);
  if (!stat) return false;
  const level = player.getSkillManager().getMaxLevel(stat);
  return condition.not ? level < condition.min : level >= condition.min;
}

/** The data's spellbook tag for the player's book (Transcript:Magic has a section per book). */
function spellbookKey(player) {
  const { MagicSpellbook } = pluginApi.core;
  const book = player.getSpellbook?.();
  if (book === MagicSpellbook.ANCIENT) return "ancient";
  if (book === MagicSpellbook.LUNAR) return "lunar";
  if (book === MagicSpellbook.ARCEUUS) return "arceuus";
  return "standard";
}

/**
 * "You can now wear Rune Armour!": what the wiki records for every level crossed, so a lamp
 * taking a skill from 1 to 10 still says what 2 through 9 unlocked. A Magic line tagged with a
 * spellbook is only the line of a player on that book (rsprox_transcripts/227/00073.txt: one box
 * at Magic 80, the standard book's).
 */
function unlockEntries(player, skill, fromLevel, toLevel) {
  const entries = [];
  let book = null;
  for (let level = fromLevel + 1; level <= toLevel; level++) {
    for (const entry of UNLOCK_MESSAGES[skill.getName()]?.[level] ?? []) {
      if (typeof entry === "string") { entries.push({ text: entry }); continue; }
      if (entry.spellbook && entry.spellbook !== (book ??= spellbookKey(player))) continue;
      if (!entry.when || conditionHolds(player, entry.when)) entries.push(entry);
    }
  }
  return entries;
}

const unlocksFor = (player, skill, fromLevel, toLevel) =>
  unlockEntries(player, skill, fromLevel, toLevel).map((entry) => entry.text);

/** Plays the skill's level-up jingle: the unlocks one when the level unlocks something and the guide list is on. */
function playJingle(player, skill, level) {
  const [plain, unlocks] = JINGLES[skill.getName()];
  const second = SECOND_JINGLE[skill.getName()];
  const unlocking = player.getPacketSender().getVarbit(GUIDE_LIST_DISABLED_VARBIT) !== 1 &&
    unlockEntries(player, skill, level - 1, level).length > 0;
  const useSecond = second ? second(level) : unlocking;
  player.getPacketSender().sendJingle(useSecond ? unlocks : plain, 0);
}

function announceUnlocks(player, skill, oldLevel, newLevel) {
  for (const line of unlocksFor(player, skill, oldLevel, newLevel)) player.sendMessage(line);
}

const listsUnlocks = (player) => player.getPacketSender().getVarbit(POPUP_LISTS_UNLOCKS_VARBIT) === 1;
const chatboxLists = (player) => player.getPacketSender().getVarbit(CHATBOX_LIST_VARBIT) === 1;

/** The level's pictures as item ids: none, one or two. */
function picturesFor(player, skill, level) {
  const names = UNLOCK_PICTURES[skill.getName()]?.[level];
  if (names) return names.map((name) => pluginApi.core.CacheDefinitions.getObjId(name)).filter(Number.isInteger).slice(0, 2);
  // A single unlock whose picture names a cache item.
  const entries = unlockEntries(player, skill, level - 1, level);
  return entries.length === 1 ? (entries[0].items ?? []).slice(0, 2) : [];
}

function unlockDialogue(index, items, text) {
  const { StatementDialogue, ItemStatementDialogue, DoubleItemStatementDialogue } = pluginApi.core;
  if (items.length === 2) return new DoubleItemStatementDialogue(index, items[0], items[1], text);
  if (items.length === 1) return new ItemStatementDialogue(index, items[0], text);
  return new StatementDialogue(index, text);
}

/**
 * The box "Show level & unlocks" opens after Continue, one per level that unlocked something
 * (Ours: a lamp's several levels each get theirs, in order). Its text also goes to the chat as
 * a message-box line. False when those levels unlock nothing.
 */
function showUnlockBox(player, state, skill, fromLevel, toLevel) {
  const { DialogueChainBuilder, EndDialogue, ChatType } = pluginApi.core;
  const chain = new DialogueChainBuilder();
  const texts = [];
  for (let level = fromLevel + 1; level <= toLevel; level++) {
    const lines = unlocksFor(player, skill, level - 1, level);
    if (lines.length === 0) continue;
    const text = lines.join("<br>");
    chain.add(unlockDialogue(texts.length, picturesFor(player, skill, level), text));
    texts.push(text);
  }
  if (texts.length === 0) return false;
  chain.add(new EndDialogue(texts.length));
  const sender = player.getPacketSender();
  for (const text of texts) sender.sendTypedMessage(ChatType.MESBOX, text.replace(/<br>/g, " "));
  // The box takes the pop-up's place in the chatbox; that is no reason to stop the level-up.
  if (state) state.replacing = true;
  try {
    sender.sendInterfaceDisplayState((GROUP << 16) | SKILL_LAYERS[skill.getIndex()], true);
    sender.sendClientScript(TOPLEVEL_CHATBOX_RESETBACKGROUND_SCRIPT);
    player.getDialogueManager().startDialogues(chain);
  } finally {
    if (state) state.replacing = false;
  }
  return true;
}

const popupsEnabled = (player) => player.getPacketSender().getVarbit(POPUP_DISABLED_VARBIT) !== 1;

function openPopup(player, layer, line1, line2) {
  const state = pending.get(player);
  if (state) state.replacing = true;
  const sender = player.getPacketSender();
  try {
    sender.sendInterfaceRemoval();
    sender.sendClientScript(TOPLEVEL_CHATBOX_RESETBACKGROUND_SCRIPT);
    sender.sendChatboxInterface(GROUP);
    sender.sendString(`<col=000080>${line1}`, TEXT1);
    sender.sendString(line2, TEXT2);
    sender.sendString("Click here to continue", CONTINUE);
    for (const icon of ICON_LAYERS) {
      sender.sendInterfaceDisplayState((GROUP << 16) | icon, icon !== layer);
    }
  } finally {
    if (state) state.replacing = false;
  }
}

function openSkillPopup(player, skill, oldLevel, newLevel, boxed) {
  let state = pending.get(player);
  if (!state) {
    state = { actions: new Map(), queue: [], location: player.getLocation().clone(), replacing: false };
    pending.set(player, state);
  } else {
    state.queue.push({ skill, oldLevel, newLevel, boxed });
    return;
  }
  pluginApi.emitCustomEvent(POPUP_OPENED_EVENT, {
    player, skill,
    pause: (action, resume, cancel) => state.actions.set(action, { resume, cancel }),
  });
  if (state.actions.size === 0) player.getSkillManager().stopSkillable();
  // Combat XP lands on the swing's tick; resetting here would wipe the attack (or block) animation.
  const combat = player.getCombat();
  if (!combat.getTarget() && !combat.getAttacker()) {
    player.performAnimation(pluginApi.core.Animation.DEFAULT_RESET_ANIMATION);
  }
  showSkillPopup(player, skill, oldLevel, newLevel, boxed);
}

function showSkillPopup(player, skill, oldLevel, newLevel, boxed) {
  const state = pending.get(player);
  if (state) state.current = { skill, from: oldLevel, to: newLevel, boxed };
  const name = skill.getName();
  // As recorded: "an Agility level" (10), "an Attack level" (3); "Your Hitpoints are now N." (18).
  const article = /^[AEIOU]/i.test(name) ? "an" : "a";
  const now = name === "Hitpoints" ? `Your Hitpoints are now ${newLevel}.` : `Your ${name} level is now ${newLevel}.`;
  openPopup(player, SKILL_LAYERS[skill.getIndex()], `Congratulations, you just advanced ${article} ${name} level.`, now);
}

function openCombatPopup(player, from) {
  const level = player.getSkillManager().getCombatLevel();
  const gained = level - from;
  openPopup(player, COMBAT_LAYER,
    `Congratulations, you just advanced ${gained === 1 ? "a combat level" : `${gained} combat levels`}.`,
    `Your combat level is now ${level}.`);
}

/** A tick after the skill's level-up, as live sends it. */
function announceCombatLevel(player) {
  const { Task, TaskManager } = pluginApi.core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player); }
    execute() {
      this.stop();
      if (!player.isRegistered()) return;
      const level = player.getSkillManager().getCombatLevel();
      celebrate(player, `Congratulations, you've just advanced your Combat level. You are now level ${level}.`, LEVELUP_ANIM);
      player.getPacketSender().sendJingle(COMBAT_JINGLE, 0);
    }
  })());
}

function trackCombatLevel({ player }) {
  player.setAttribute(COMBAT_LEVEL_ATTRIBUTE, player.getSkillManager().getCombatLevel());
}

/**
 * rsprox captures (Mahogany Homes, the user's rev 241/242 runs: 20261111T012755 t897-903,
 * 20261029T203602 t7336-7346): experience paid mid-conversation lands at once, but its level-up
 * (message, jingle, pop-up) waits until the conversation has closed, the tick after.
 */
function showLevelUp(event) {
  if (event.player.getDialogueManager?.()?.isActive?.()) return awaitDialogueEnd(event);
  announceLevelUp(event);
}

function awaitDialogueEnd(event) {
  const { Task, TaskManager } = pluginApi.core;
  const player = event.player;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player); }
    execute() {
      if (!player.isRegistered()) return this.stop();
      if (player.getDialogueManager().isActive()) return;
      this.stop();
      announceLevelUp(event);
    }
  })());
}

function announceLevelUp({ player, skill, oldLevel, newLevel }) {
  const skills = player.getSkillManager();
  const name = skill.getName();
  if (newLevel >= MAX_LEVEL) {
    celebrate(player, `Congratulations, you've reached the highest possible ${name} level of ${MAX_LEVEL}.`, LEVELUP_99_ANIM);
    pluginApi.core.World.sendMessage(`<shad=15536940>News: ${player.getDisplayName()} has just achieved the highest possible level in ${name}!`);
  } else {
    celebrate(player, `Congratulations, you've just advanced your ${name} level. You are now level ${newLevel}.`, LEVELUP_ANIM);
  }
  const popupOpens = popupsEnabled(player) && pluginApi.getPluginConfig(INTERRUPT_ACTIONS_CONFIG, true) !== false;
  // With "Show level & unlocks" the unlock box says it, and logs it in the chat as it opens.
  // The setting at level-up decides Continue and cancelling, even if it changes while the pop-up is open.
  const boxed = popupOpens && listsUnlocks(player);
  if (!boxed && chatboxLists(player)) announceUnlocks(player, skill, oldLevel, newLevel);
  playJingle(player, skill, newLevel);

  const total = skills.getTotalLevel();
  const reached = Math.floor(total / TOTAL_LEVEL_STEP) * TOTAL_LEVEL_STEP;
  if (reached > total - (newLevel - oldLevel)) {
    player.sendMessage(`Congratulations, you've reached a total level of ${reached}.`);
  }

  const previousCombat = player.getAttribute(COMBAT_LEVEL_ATTRIBUTE);
  const combat = skills.getCombatLevel();
  player.setAttribute(COMBAT_LEVEL_ATTRIBUTE, combat);
  const combatGained = Number.isInteger(previousCombat) && combat > previousCombat;
  if (combatGained) announceCombatLevel(player);

  if (!popupOpens) return;
  if (combatGained && player.getAttribute(COMBAT_POPUP_FROM_ATTRIBUTE) === undefined) {
    player.setAttribute(COMBAT_POPUP_FROM_ATTRIBUTE, previousCombat);
  }
  openSkillPopup(player, skill, oldLevel, newLevel, boxed);
}

/**
 * Continue: with "Show level & unlocks", the skill's unlock box comes straight after its own
 * pop-up; then a queued skill's pop-up, a combat level gained, or the end of the level-up.
 */
function continueLevelUp({ player }) {
  if (!player.getPacketSender().isChatboxInterface(GROUP)) return false;
  const state = pending.get(player);
  const current = state?.current;
  if (current) state.current = null;
  if (current?.boxed && showUnlockBox(player, state, current.skill, current.from, current.to)) {
    state.awaitingUnlockBox = true;
    return true;
  }
  showNext(player, state);
  return true;
}

function showNext(player, state) {
  const next = state?.queue.shift();
  if (next) {
    showSkillPopup(player, next.skill, next.oldLevel, next.newLevel, next.boxed);
    return;
  }
  const combatFrom = player.getAttribute(COMBAT_POPUP_FROM_ATTRIBUTE);
  if (combatFrom !== undefined) {
    player.setAttribute(COMBAT_POPUP_FROM_ATTRIBUTE, undefined);
    openCombatPopup(player, combatFrom);
    return;
  }
  finishPending(player, state);
}

/** The level-up is over: close its pop-up and let whatever it paused carry on. */
function finishPending(player, state) {
  pending.delete(player);
  player.getPacketSender().closeInterface(GROUP);
  if (state) {
    const resume = player.isRegistered() && player.getHitpoints() > 0 &&
      player.getLocation().equals(state.location) && player.getMovementQueue().size() === 0 && !player.getForceMovement();
    for (const action of state.actions.values()) (resume ? action.resume : action.cancel)();
  }
}

function cancelPending({ player }) {
  const state = pending.get(player);
  if (!state || state.replacing) return;
  pending.delete(player);
  player.setAttribute(COMBAT_POPUP_FROM_ATTRIBUTE, undefined);
  // With "Show level & unlocks" the unlock lines wait for the box; a level-up given up before
  // its box opens still puts them in the chat, for the open pop-up's skill and every queued one.
  if (state.current?.boxed) announceUnlocks(player, state.current.skill, state.current.from, state.current.to);
  for (const { skill, oldLevel, newLevel, boxed } of state.queue) if (boxed) announceUnlocks(player, skill, oldLevel, newLevel);
  for (const action of state.actions.values()) action.cancel();
}

function interfaceClosed(event) {
  if (event.interfaceId === GROUP) { cancelPending(event); return; }
  if (!UNLOCK_BOX_GROUPS.includes(event.interfaceId)) return;
  const state = pending.get(event.player);
  if (!state?.awaitingUnlockBox) return;
  // One level's box giving way to the next level's is not the end of them.
  const sender = event.player.getPacketSender();
  if (UNLOCK_BOX_GROUPS.some((group) => sender.isChatboxInterface(group))) return;
  state.awaitingUnlockBox = false;
  showNext(event.player, state);
}

function itemAction(event) {
  if (event.action !== "bonus") cancelPending(event);
}

module.exports = {
  name: "SkillLevelUp",
  description: "Level-up feedback: chat message, unlock messages, graphic, sound and the level-up pop-up, which pauses skilling until you press Continue.",
  config: {
    "SkillLevelUp:interruptActions": {
      type: "boolean", label: "Level-ups interrupt actions", default: true,
      help: "Follows each player's pop-up preference. Turn off to keep skilling and fighting through level-ups: the blocking pop-ups are skipped, chat messages, sounds and graphics stay.",
    },
  },
  register(api) {
    pluginApi = api;
    api.onPlayerLogin(trackCombatLevel);
    api.onPlayerLevelUp(showLevelUp);
    api.onInterfaceActionButton(CONTINUE, continueLevelUp);
    api.onCustomEvent("player:world-input", cancelPending);
    api.onCustomEvent("interface:closed", interfaceClosed);
    api.onCanUseItem(itemAction);
    api.onPlayerLogout(cancelPending);
    api.onPlayerDisconnect(cancelPending);
    api.onPlayerDeath(cancelPending);
  },
};
