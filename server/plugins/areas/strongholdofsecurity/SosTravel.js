/**
 * Getting around the Stronghold, as captured:
 * - the Entrance in Barbarian Village drops the player onto floor 1 with a message box;
 * - a ladder (or vine) down shows the "Are you sure you want to climb down?" warning (579,
 *   cws_warning_4) - unless the player ticked "Don't ask me this again" - then the climb
 *   animation, and a tick later the next floor;
 * - the portal near each floor's start leads to its treasure room once the floor's reward is
 *   claimed, or (Wiki) from combat level 26, 51 and 76 on floors 1-3;
 * - the up-ladders climb as any ladder does, to where the map has the ladder above; floor 4's
 *   bone chain leads back to the surface.
 * Going down to floor 2 completes the Varrock diary task for it.
 */
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { StatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/StatementDialogue");
const { EndDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");
const Data = require("./SosData");

const WARNING = 579;
const WARNING_YES = 17;
const WARNING_NO = 18;
const WARNING_DONT_ASK = 20;
const WARNING_VARBIT = 3854;
const WARNING_VARBIT_MAX = 15;
const SCRIPT_MAINMODAL_OPEN = 2524;
const CLIMB = new Animation(828);
const BONE_CHAIN = 23732;
const PENDING_ATTRIBUTE = "sos.pending-descent";
const DONT_ASK_ATTRIBUTE = "sos.dont-ask-descent";
const WARNINGS_ATTRIBUTE = "sos.descent-warnings";
const DIARY_FLOOR_TWO = { diary: "varrock", task: "enter-the-second-level-of-the-stronghold-of-secu" };

let pluginApi;
let TaskManager;

function bind(api) {
  pluginApi = api;
  TaskManager = api.getTaskManager();
}

class LaterTask extends Task {
  constructor(ticks, action) {
    super(ticks);
    this.action = action;
  }

  execute() {
    this.stop();
    this.action();
  }
}

function statement(player, text) {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text), new EndDialogue(1)));
}

function enter(event) {
  if (event.object?.getId?.() !== Data.DATA.entrance.object) return false;
  event.player.moveTo(Data.toLocation(Data.DATA.entrance.to));
  statement(event.player, Data.DATA.entrance.message);
  return true;
}

function descend(player, floor) {
  player.setAttribute(PENDING_ATTRIBUTE, null);
  player.performAnimation(CLIMB);
  TaskManager.submit(new LaterTask(1, () => {
    const index = Data.FLOORS.indexOf(floor);
    player.sendMessage("You climb down the ladder to the next level.");
    player.moveTo(Data.toLocation(Data.FLOORS[index + 1].arrival));
    if (index === 0) pluginApi.emitCustomEvent("diary:task", { player, ...DIARY_FLOOR_TWO });
  }));
}

function climbDown(event) {
  const floor = Data.floorByObject("down", event.object?.getId?.());
  if (!floor) return false;
  const { player } = event;
  if (player.getAttribute(DONT_ASK_ATTRIBUTE) === true) {
    descend(player, floor);
    return true;
  }
  const sender = player.getPacketSender();
  player.setAttribute(PENDING_ATTRIBUTE, Data.FLOORS.indexOf(floor));
  // As captured, cws_warning_4 counts up each time the warning is shown.
  const shown = Math.min(WARNING_VARBIT_MAX, (Number(player.getAttribute(WARNINGS_ATTRIBUTE)) || 0) + 1);
  player.setAttribute(WARNINGS_ATTRIBUTE, shown);
  sender.sendVarbit(WARNING_VARBIT, shown);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(WARNING);
  return true;
}

function warningClick(event) {
  const buttonId = Number(event.buttonId ?? 0);
  if ((event.groupId ?? (buttonId >>> 16)) !== WARNING) return;
  const child = event.childId ?? (buttonId & 0xffff);
  const { player } = event;
  if (child === WARNING_DONT_ASK) {
    player.setAttribute(DONT_ASK_ATTRIBUTE, player.getAttribute(DONT_ASK_ATTRIBUTE) !== true);
    event.handled = true;
    return;
  }
  if (child !== WARNING_YES && child !== WARNING_NO) return;
  event.handled = true;
  const pending = Data.FLOORS[Number(player.getAttribute(PENDING_ATTRIBUTE))];
  player.getPacketSender().sendInterfaceRemoval();
  if (child === WARNING_YES && pending) descend(player, pending);
  else player.setAttribute(PENDING_ATTRIBUTE, null);
}

function climbUp(event) {
  const id = event.object?.getId?.();
  const floor = Data.floorByObject("up", id);
  if (!floor) return false;
  const { player } = event;
  if (id === BONE_CHAIN) {
    player.sendMessage("You shin up the rope, squeeze through a passage then climb a ladder.");
    player.sendMessage("You climb up the ladder which seems to twist and wind in all directions.");
    player.moveTo(Data.upDestination(floor));
    return true;
  }
  pluginApi.emitCustomEvent("ladders:climbUp", { player, destination: Data.upDestination(floor) });
  return true;
}

function usePortal(event) {
  const floor = Data.floorByObject("portal", event.object?.getId?.());
  if (!floor) return false;
  const { player } = event;
  const highEnough = floor.portalCombat != null && player.getSkillManager().getCombatLevel() >= floor.portalCombat;
  if (!Data.isClaimed(player, floor) && !highEnough) {
    player.sendMessage("You must have completed this level to take this shortcut.");
    return true;
  }
  player.sendMessage("You enter the portal to be whisked through to the treasure room.");
  player.moveTo(Data.toLocation(floor.treasure));
  return true;
}

module.exports = { PENDING_ATTRIBUTE, DONT_ASK_ATTRIBUTE, WARNINGS_ATTRIBUTE, bind, enter, climbDown, warningClick, climbUp, usePortal, descend };
