/**
 * The "Choose the stat you wish to be advanced!" interface (xpreward, 240), for experience
 * rewards such as lamps. As captured rubbing a genie's lamp: the server sets busy, opens it as
 * the main modal with its 24 skill slots (240:0) as pause buttons and writes the title. Picking a
 * skill and pressing Confirm are the cache's own scripts (3804/3806); only the confirmed slot
 * reaches the server, as a resume on 240:0 whose sub is the slot (enum 681, key = slot + 1, gives the stat). The
 * reward's message box follows, the interface closes, and busy clears when the box is dismissed.
 *
 * Varp 261 is the lowest base level the cache lets a skill be chosen at, and varp 262 the skills
 * it offers, one bit each (enum 81 gives a stat's bit; script 3809 refuses a skill whose bit is
 * clear: "This skill is not available."). The server checks the level again.
 *
 *   api.emitCustomEvent("xpreward:open", {
 *     player, minLevel?, title?,
 *     onConfirm(skill, statName) -> the message box text, or null when refused,
 *   })
 */
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { DialogueChainBuilder } = require("../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { StatementDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/StatementDialogue");
const { ActionDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ActionDialogue");

const XPREWARD = 240;
const UNIVERSE = 0;
const TITLE = 26;
const SLOTS = 24;
const PAUSE_BUTTON = 1;
const MIN_LEVEL_VARP = 261;
const AVAILABLE_VARP = 262;
const BUSY_VARBIT = 12393;
const SLOT_TO_STAT_ENUM = 681;
const STAT_NAME_ENUM = 680;
const STAT_BIT_ENUM = 81;
const DEFAULT_TITLE = "Choose the stat you wish to be advanced!";

const pending = new WeakMap();

function statName(skill) {
  return String(CacheDefinitions.getEnumValues(STAT_NAME_ENUM).get(skill.getClientId()) ?? skill.getName());
}

/** The confirmed slot (0-23, one per child of 240:0) is enum 681's key less one. */
/** Every skill offered: each stat's bit from enum 81. */
function availableMask() {
  let mask = 0;
  for (const bit of CacheDefinitions.getEnumValues(STAT_BIT_ENUM).values()) mask |= 1 << Number(bit);
  return mask;
}

function skillForSlot(slot) {
  const stat = CacheDefinitions.getEnumValues(SLOT_TO_STAT_ENUM).get(slot + 1);
  return stat === undefined ? null : Skill.values().find((skill) => skill.getClientId() === stat) ?? null;
}

function open(request) {
  const { player } = request;
  if (!player || typeof request.onConfirm !== "function") return;
  pending.set(player, request);
  const sender = player.getPacketSender();
  sender.sendConfig(MIN_LEVEL_VARP, request.minLevel ?? 0);
  sender.sendConfig(AVAILABLE_VARP, availableMask());
  sender.sendVarbit(BUSY_VARBIT, 1);
  sender.sendInterface(XPREWARD);
  sender.sendInterfaceFlagsRange((XPREWARD << 16) | UNIVERSE, 0, SLOTS - 1, PAUSE_BUTTON);
  sender.sendString(request.title ?? DEFAULT_TITLE, (XPREWARD << 16) | TITLE);
  request.opened = true;
}

function confirm(event) {
  const buttonId = Number(event.buttonId ?? 0);
  if ((event.groupId ?? (buttonId >>> 16)) !== XPREWARD || (event.childId ?? (buttonId & 0xffff)) !== UNIVERSE) return;
  event.handled = true;
  const { player } = event;
  const request = pending.get(player);
  const skill = skillForSlot(Number(event.action));
  if (!request || !skill) return;
  if (player.getSkillManager().getMaxLevel(skill) < (request.minLevel ?? 0)) return;
  pending.delete(player);
  const sender = player.getPacketSender();
  const text = request.onConfirm(skill, statName(skill));
  sender.sendInterfaceRemoval();
  if (!text) {
    sender.sendVarbit(BUSY_VARBIT, 0);
    return;
  }
  Sounds.sendSound(player, Sound.XP_REWARD);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    new ActionDialogue(1, { execute: () => {
      sender.sendVarbit(BUSY_VARBIT, 0);
      sender.sendInterfaceRemoval();
    } }),
  ));
}

/** Closed without confirming (Close, walking away). */
function closed({ player, interfaceId }) {
  if (interfaceId !== XPREWARD || !pending.has(player)) return;
  pending.delete(player);
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

module.exports = {
  name: "XpReward",
  register(api) {
    api.onCustomEvent("xpreward:open", open);
    api.onInterfaceActionClick(confirm);
    api.onCustomEvent("interface:closed", closed);
  },
  _test: { open, confirm, closed, skillForSlot, statName, availableMask },
};
