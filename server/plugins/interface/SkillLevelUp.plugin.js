// Level-up feedback as live OSRS sends it (rsprox captures, docs/settings.md): the chat
// message, the level's unlock message(s) from the OSRS Wiki transcripts, graphic and sounds,
// then the chatbox pop-up (levelup_display, 233) unless the player turned it off in
// Settings > Interfaces > "Level-up pop-up notifications". A combat level gained with it
// follows a tick later; its pop-up waits until the skill's is continued.
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
// The message box that box is (StatementDialogue, core 229); its close ends the level-up.
const UNLOCK_BOX_GROUP = 229;
const INTERRUPT_ACTIONS_CONFIG = "SkillLevelUp:interruptActions";

const LEVELUP_ANIM = 199;
const LEVELUP_99_ANIM = 1388;
const GRAPHIC_HEIGHT = 124;
const MAX_LEVEL = 99;
// Two area sounds at the player, the second 25 client cycles later.
const LEVEL_UP_SOUNDS = [{ soundId: 2396, delay: 0 }, { soundId: 2384, delay: 25 }];
const SOUND_RADIUS = 1;
const TOTAL_LEVEL_STEP = 25;

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

/**
 * "You can now wear Rune Armour!": what the wiki records for every level crossed, so a lamp
 * taking a skill from 1 to 10 still says what 2 through 9 unlocked.
 */
function unlocksFor(player, skill, fromLevel, toLevel) {
  const lines = [];
  for (let level = fromLevel + 1; level <= toLevel; level++) {
    for (const entry of UNLOCK_MESSAGES[skill.getName()]?.[level] ?? []) {
      if (typeof entry === "string") lines.push(entry);
      else if (conditionHolds(player, entry.when)) lines.push(entry.text);
    }
  }
  return lines;
}

function announceUnlocks(player, skill, oldLevel, newLevel) {
  for (const line of unlocksFor(player, skill, oldLevel, newLevel)) player.sendMessage(line);
}

/** The box "Show level & unlocks" opens after Continue; false when those levels unlock nothing. */
function showUnlockBox(player, skill, fromLevel, toLevel) {
  const lines = unlocksFor(player, skill, fromLevel, toLevel);
  if (lines.length === 0) return false;
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = pluginApi.core;
  const chain = new DialogueChainBuilder();
  chain.add(new StatementDialogue(0, lines.join("<br>")));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
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

function openSkillPopup(player, skill, oldLevel, newLevel) {
  let state = pending.get(player);
  if (!state) {
    state = { actions: new Map(), queue: [], location: player.getLocation().clone(), replacing: false };
    pending.set(player, state);
  } else {
    state.queue.push({ skill, oldLevel, newLevel });
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
  showSkillPopup(player, skill, oldLevel, newLevel);
}

function showSkillPopup(player, skill, oldLevel, newLevel) {
  const state = pending.get(player);
  if (state) state.current = { skill, from: oldLevel, to: newLevel };
  const name = skill.getName();
  openPopup(player, SKILL_LAYERS[skill.getIndex()],
    `Congratulations, you just advanced a ${name} level.`, `Your ${name} level is now ${newLevel}.`);
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
    }
  })());
}

function trackCombatLevel({ player }) {
  player.setAttribute(COMBAT_LEVEL_ATTRIBUTE, player.getSkillManager().getCombatLevel());
}

function showLevelUp({ player, skill, oldLevel, newLevel }) {
  const skills = player.getSkillManager();
  const name = skill.getName();
  if (newLevel >= MAX_LEVEL) {
    celebrate(player, `Congratulations, you've reached the highest possible ${name} level of ${MAX_LEVEL}.`, LEVELUP_99_ANIM);
    pluginApi.core.World.sendMessage(`<shad=15536940>News: ${player.getDisplayName()} has just achieved the highest possible level in ${name}!`);
  } else {
    celebrate(player, `Congratulations, you've just advanced your ${name} level. You are now level ${newLevel}.`, LEVELUP_ANIM);
  }
  announceUnlocks(player, skill, oldLevel, newLevel);

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

  if (!popupsEnabled(player) || pluginApi.getPluginConfig(INTERRUPT_ACTIONS_CONFIG, true) === false) return;
  if (combatGained && player.getAttribute(COMBAT_POPUP_FROM_ATTRIBUTE) === undefined) {
    player.setAttribute(COMBAT_POPUP_FROM_ATTRIBUTE, previousCombat);
  }
  openSkillPopup(player, skill, oldLevel, newLevel);
}

/** Continue: a queued combat pop-up comes next, otherwise the pop-up closes. */
function continueLevelUp({ player }) {
  if (!player.getPacketSender().isChatboxInterface(GROUP)) return false;
  const state = pending.get(player);
  const next = state?.queue.shift();
  if (next) {
    showSkillPopup(player, next.skill, next.oldLevel, next.newLevel);
    return true;
  }
  const combatFrom = player.getAttribute(COMBAT_POPUP_FROM_ATTRIBUTE);
  if (combatFrom !== undefined) {
    player.setAttribute(COMBAT_POPUP_FROM_ATTRIBUTE, undefined);
    openCombatPopup(player, combatFrom);
    return true;
  }
  // "Show level & unlocks": the box that lists them comes before the skill resumes.
  const current = state?.current;
  if (current && player.getPacketSender().getVarbit(POPUP_LISTS_UNLOCKS_VARBIT) === 1 &&
      showUnlockBox(player, current.skill, current.from, current.to)) {
    state.awaitingUnlockBox = true;
    player.getPacketSender().closeInterface(GROUP);
    return true;
  }
  finishPending(player, state);
  return true;
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
  for (const action of state.actions.values()) action.cancel();
}

function interfaceClosed(event) {
  if (event.interfaceId === GROUP) { cancelPending(event); return; }
  if (event.interfaceId === UNLOCK_BOX_GROUP) {
    const state = pending.get(event.player);
    if (state?.awaitingUnlockBox) finishPending(event.player, state);
  }
}

function itemAction(event) {
  if (event.action !== "bonus") cancelPending(event);
}

module.exports = {
  name: "SkillLevelUp",
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
