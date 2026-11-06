"use strict";

/**
 * The skill guide (skill_guide_v2, interface 860), as live OSRS opens it (rsprox captures, see
 * docs/skill-guide.md): "View <skill> guide" on a Skills tab stat opens the guide in the
 * floater, makes its tabs clickable and runs skill_guide_v2_init with the guide's number for
 * that skill. The guide's own scripts draw it and switch its tabs; the server only opens,
 * re-opens (a link to another skill's guide) and closes it.
 *
 * Before opening, a click is offered to other plugins as `skills:stat-clicked` (payload
 * { player, childId, handled }): SetSkillLevel claims it on PvP worlds for its level prompt.
 */

const STATS = 320;
const GUIDE = 860;
const FLOATER_UID = (161 << 16) | 18;
const OVERLAY = 1;
const VIEW_GUIDE_OP = 2;

const GUIDE_CLOSE = 4;
const GUIDE_TABS = 7;
const GUIDE_SKILL_LINK = 18;
const GUIDE_LIST = 21;
const TAB_SLOTS = 200;
const OP1 = 1 << 1;

const SKILL_GUIDE_V2_INIT = 1902;

/** Skills tab component -> the guide's number for its skill: the fourth argument each
 * component gives script 393 in the cache. */
const GUIDE_SKILL_BY_STAT = new Map([
  [1, 1], [2, 2], [3, 5], [4, 3], [5, 7], [6, 4], [7, 12], [8, 22],
  [9, 6], [10, 8], [11, 9], [12, 10], [13, 11], [14, 19], [15, 20], [16, 23],
  [17, 13], [18, 14], [19, 15], [20, 16], [21, 17], [22, 18], [23, 21], [24, 24],
]);
const GUIDE_SKILLS = new Set(GUIDE_SKILL_BY_STAT.values());

let api;

const uid = (child) => (GUIDE << 16) | child;

function openGuide(player, guideSkill) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(FLOATER_UID, GUIDE, OVERLAY);
  sender.sendInterfaceFlagsRange(uid(GUIDE_LIST), -1, -1, 0);
  sender.sendInterfaceFlagsRange(uid(GUIDE_TABS), 0, TAB_SLOTS, OP1);
  sender.sendInterfaceScript(SKILL_GUIDE_V2_INIT, [guideSkill, 0, 0, 0]);
}

/** The stats' "View <skill> guide", unless another plugin claims the click first. */
function viewGuide(event) {
  const guideSkill = GUIDE_SKILL_BY_STAT.get(Number(event.childId));
  if (guideSkill === undefined || Number(event.opId ?? event.action) !== VIEW_GUIDE_OP) return;
  event.handled = true;
  const offer = { player: event.player, childId: Number(event.childId), handled: false };
  api.emitCustomEvent("skills:stat-clicked", offer);
  if (!offer.handled) openGuide(event.player, guideSkill);
}

/** A link inside the guide to another skill's guide: the skill comes as the trigger's one int. */
function followSkillLink(event) {
  if (!event.scriptTrigger) return;
  const guideSkill = readTriggerInt(event.argsData);
  if (!GUIDE_SKILLS.has(guideSkill)) return;
  event.handled = true;
  openGuide(event.player, guideSkill);
}

/** if_triggeroplocal arguments: ints as zigzag varints. */
function readTriggerInt(argsData) {
  if (!argsData?.length) return undefined;
  let value = 0;
  let shift = 0;
  for (const byte of argsData) {
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return (value >>> 1) ^ -(value & 1);
    shift += 7;
  }
  return undefined;
}

function closeGuide(event) {
  event.handled = true;
  event.player.getPacketSender().closeInterface(GUIDE);
}

function onInterfaceClick(event) {
  const groupId = Number(event.groupId);
  const childId = Number(event.childId);
  if (groupId === STATS) viewGuide(event);
  else if (groupId === GUIDE && childId === GUIDE_CLOSE) closeGuide(event);
  else if (groupId === GUIDE && childId === GUIDE_SKILL_LINK) followSkillLink(event);
}

module.exports = {
  name: "SkillGuide",
  register(pluginApi) {
    api = pluginApi;
    pluginApi.onInterfaceActionClick(onInterfaceClick);
  },
};

module.exports._test = { GUIDE_SKILL_BY_STAT, readTriggerInt, SKILL_GUIDE_V2_INIT };
