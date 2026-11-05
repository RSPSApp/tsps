/**
 * The Idle screen (`::idle`): a server-defined interface (docs/agents/interfaces.md), so it needs
 * no client change. Tabs across the top: Overview (below), Stats (the totals: XP by skill, items
 * by kind, time idle playing and away), Goals (today's goals), Feats (achievements) and Travel
 * (the travel screen). On the left, the account's status: Idle Mode and auto-resume (each with a
 * button to switch it), what the character is doing, the idle points and the next one, the offline
 * cap, and what the last time away paid, with the XP per hour; a third button opens the travel screen. On the right,
 * the upgrades: each one's level, what it
 * does, the next level's price and a Buy button. It redraws while open whenever any of that
 * changes (Common's `changed`), so points tick up as the character works.
 */
const Common = require("./Common.IdleMode");
const Auto = require("./Auto.IdleMode");
const Combat = require("./Combat.IdleMode");
const Production = require("./Production.IdleMode");
const Offline = require("./Offline.IdleMode");
const Progression = require("./Progression.IdleMode");
const TravelScreen = require("./TravelScreen.IdleMode");
const Goals = require("./Goals.IdleMode");
const Achievements = require("./Achievements.IdleMode");
const Hiscores = require("./Hiscores.IdleMode");

const { FLAG_OP1, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("../../interface/widgetGroup");

const GROUP_ID = 30020;
const MAIN_MODAL_UID = (161 << 16) | 16;
/** The frame's title bar (cache script 227 draws it). */
const FRAME_TITLE_SCRIPT = 227;
const TITLE = "Idle Mode";
const STATUS_LINES = 8;
/** At most this many upgrades fit; the data's own count sets the layout (Common.init runs first). */
const MAX_UPGRADE_SLOTS = 4;
const COMPONENT = {
  ROOT: 0, FRAME: 1, STATUS_BOX: 2, STATUS_TITLE: 3, STATUS_LINE_START: 4,
  // STATUS_LINE_START + STATUS_LINES (8) runs to 11: the buttons sit clear of the lines.
  IDLE_BUTTON: 12, IDLE_LABEL: 13, AUTO_BUTTON: 14, AUTO_LABEL: 15, TRAVEL_BUTTON: 50, TRAVEL_LABEL: 51,
  UPGRADES_BOX: 16, UPGRADES_TITLE: 17, POINTS: 18,
  // Each upgrade slot: its name, description, price, and Buy button and label.
  SLOT_START: 20, SLOT_STRIDE: 5,
  // The tabs across the top: Overview, Stats, Goals, Feats, Ranks, Travel (buttons, and their labels).
  TAB_START: 52, TAB_LABEL_START: 120,
  // The Stats tab: a panel of the totals, hidden until it is picked.
  STATS_BOX: 60, STATS_TITLE: 61, SKILLS_HEADER: 62, ITEMS_HEADER: 63, STATS_TIME: 64, SKILL_LINE_START: 65, ITEM_LINE_START: 75,
  // The Goals tab: a row per daily goal (its text and its progress), the bonus, the next day.
  GOALS_BOX: 86, GOALS_TITLE: 87, GOAL_START: 88, GOAL_STRIDE: 2, GOALS_BONUS: 98, GOALS_NEXT: 99,
  // The Feats tab: a row per achievement track (its tier, then the next tier's progress).
  FEATS_BOX: 100, FEATS_TITLE: 101, FEAT_START: 102, FEAT_STRIDE: 2,
  // The Ranks tab: the hiscores' categories as buttons, a row per place (name, score), your place.
  RANKS_BOX: 130, RANKS_TITLE: 131, RANK_BUTTON_START: 132, RANK_BUTTON_LABEL_START: 136,
  RANK_ROW_START: 140, RANK_ROW_STRIDE: 2, RANK_YOU: 162,
};
const TABS = ["Overview", "Stats", "Goals", "Feats", "Ranks", "Travel"];
const TAB = { OVERVIEW: 0, STATS: 1, GOALS: 2, FEATS: 3, RANKS: 4, TRAVEL: 5 };
/** Places the Ranks tab shows (RANK_ROW_START + 2 per place stays below RANK_YOU). */
const MAX_RANKS = 10;
/** Hiscores categories the Ranks tab has buttons for. */
const MAX_RANK_CATEGORIES = 4;
/** Achievement tracks the Feats tab has room for (FEAT_START + 2 per track stays below 120). */
const MAX_FEATS = 6;
/** Rows the Goals tab has room for (GOAL_START + 2 per goal stays below GOALS_BONUS). */
const MAX_GOALS = 5;
const STATS_LINES = 10;
const SLOT = { NAME: 0, DESCRIPTION: 1, PRICE: 2, BUY_BUTTON: 3, BUY_LABEL: 4 };
const LEFT = { x: 18, y: 58, width: 226, height: 242 };
const RIGHT = { x: 252, y: 58, width: 224, height: 242 };
const FULL = { x: 18, y: 58, width: 458, height: 242 };
const LINE_HEIGHT = 22;
const SLOTS_TOP = 46;
const MAX_SLOT_HEIGHT = 72;
const COLOUR = { ON: "00ff00", OFF: "ff5f5f", PAUSED: "ffb83f", VALUE: "ffffff", DIM: "8f7f66" };

const uid = (component) => (GROUP_ID << 16) | component;
const slotComponent = (slot, part) => COMPONENT.SLOT_START + slot * COMPONENT.SLOT_STRIDE + part;
const col = (colour, text) => `<col=${colour}>${text}</col>`;
const number = (value) => Math.floor(value).toLocaleString("en-US");

const text = (x, y, width, height, overrides = {}) => ({
  type: TYPE_TEXT, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
  text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true, ...overrides,
});
const box = (x, y, width, height, overrides = {}) => ({
  type: TYPE_RECTANGLE, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
  filled: true, color: 0x211b16, opacity: 32, ...overrides,
});
const button = (x, y, width, height, action) => box(x, y, width, height, {
  color: 0x3b2f20, mouseOverColor: 0x54432c, opacity: 0, actions: [action], flags: FLAG_OP1,
});
const buttonLabel = (x, y, width, height, label = "") => text(x, y, width, height, { text: label, textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1 });

function addStatus(add, root) {
  const { x, y, width, height } = LEFT;
  add(COMPONENT.STATUS_BOX, root, box(x, y, width, height));
  add(COMPONENT.STATUS_TITLE, root, text(x + 8, y + 4, width - 16, 20, { text: "Status", fontId: 496, textColor: 0xff981f, yTextAlignment: 1 }));
  for (let line = 0; line < STATUS_LINES; line++) {
    // The last line, the time away, has room to wrap above the buttons.
    const lineHeight = line === STATUS_LINES - 1 ? 34 : LINE_HEIGHT - 2;
    add(COMPONENT.STATUS_LINE_START + line, root, text(x + 8, y + 26 + line * LINE_HEIGHT, width - 16, lineHeight, {
      yTextAlignment: line === STATUS_LINES - 1 ? 0 : 1,
    }));
  }
  const buttonWidth = Math.floor((width - 32) / 3);
  const buttonY = y + height - 28;
  const buttonX = (index) => x + 8 + index * (buttonWidth + 8);
  add(COMPONENT.IDLE_BUTTON, root, button(buttonX(0), buttonY, buttonWidth, 24, "Switch"));
  add(COMPONENT.IDLE_LABEL, root, buttonLabel(buttonX(0), buttonY, buttonWidth, 24));
  add(COMPONENT.AUTO_BUTTON, root, button(buttonX(1), buttonY, buttonWidth, 24, "Switch"));
  add(COMPONENT.AUTO_LABEL, root, buttonLabel(buttonX(1), buttonY, buttonWidth, 24));
  add(COMPONENT.TRAVEL_BUTTON, root, button(buttonX(2), buttonY, buttonWidth, 24, "Travel"));
  add(COMPONENT.TRAVEL_LABEL, root, buttonLabel(buttonX(2), buttonY, buttonWidth, 24, "Travel"));
}

/** One slot per upgrade in the data, as tall as the panel allows. */
function slotLayout() {
  const slots = Math.min(MAX_UPGRADE_SLOTS, Object.keys(Common.data.progression.upgrades).length);
  return { slots, height: Math.min(MAX_SLOT_HEIGHT, Math.floor((RIGHT.height - SLOTS_TOP - 6) / Math.max(1, slots))) };
}

function addUpgrades(add, root) {
  const { x, y, width, height } = RIGHT;
  const layout = slotLayout();
  add(COMPONENT.UPGRADES_BOX, root, box(x, y, width, height));
  add(COMPONENT.UPGRADES_TITLE, root, text(x + 8, y + 4, width - 16, 20, { text: "Upgrades", fontId: 496, textColor: 0xff981f, yTextAlignment: 1 }));
  add(COMPONENT.POINTS, root, text(x + 8, y + 24, width - 16, 18, { textColor: 0xffd27f, yTextAlignment: 1 }));
  for (let slot = 0; slot < layout.slots; slot++) {
    const top = y + SLOTS_TOP + slot * layout.height;
    const bottom = top + layout.height - 24;
    add(slotComponent(slot, SLOT.NAME), root, text(x + 8, top, width - 16, 16, { yTextAlignment: 1 }));
    add(slotComponent(slot, SLOT.DESCRIPTION), root, text(x + 8, top + 17, width - 16, bottom - top - 17, { textColor: 0xb8ab94 }));
    add(slotComponent(slot, SLOT.PRICE), root, text(x + 8, bottom, width - 80, 20, { yTextAlignment: 1 }));
    add(slotComponent(slot, SLOT.BUY_BUTTON), root, button(x + width - 66, bottom, 58, 20, "Buy"));
    add(slotComponent(slot, SLOT.BUY_LABEL), root, buttonLabel(x + width - 66, bottom, 58, 20));
  }
}

function addTabs(add, root) {
  TABS.forEach((label, index) => {
    const x = 18 + index * 64;
    add(COMPONENT.TAB_START + index, root, box(x, 32, 60, 20, { color: 0x2b241b, mouseOverColor: 0x3a3125, actions: ["Open"], flags: FLAG_OP1 }));
    add(COMPONENT.TAB_LABEL_START + index, root, text(x, 32, 60, 20, { text: label, textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1 }));
  });
}

function addStats(add, root) {
  const { x, y, width, height } = FULL;
  const hidden = { hidden: true, isHidden: true };
  const column = (width - 24) / 2;
  add(COMPONENT.STATS_BOX, root, box(x, y, width, height, hidden));
  add(COMPONENT.STATS_TITLE, root, text(x + 8, y + 4, width - 16, 20, { text: "Statistics", fontId: 496, textColor: 0xff981f, yTextAlignment: 1, ...hidden }));
  add(COMPONENT.SKILLS_HEADER, root, text(x + 8, y + 26, column, 18, { text: "XP gained", textColor: 0xffd27f, yTextAlignment: 1, ...hidden }));
  add(COMPONENT.ITEMS_HEADER, root, text(x + 16 + column, y + 26, column, 18, { text: "Items gathered and made", textColor: 0xffd27f, yTextAlignment: 1, ...hidden }));
  for (let line = 0; line < STATS_LINES; line++) {
    const top = y + 46 + line * 17;
    add(COMPONENT.SKILL_LINE_START + line, root, text(x + 8, top, column, 16, { yTextAlignment: 1, ...hidden }));
    add(COMPONENT.ITEM_LINE_START + line, root, text(x + 16 + column, top, column, 16, { yTextAlignment: 1, ...hidden }));
  }
  add(COMPONENT.STATS_TIME, root, text(x + 8, y + height - 24, width - 16, 18, { yTextAlignment: 1, ...hidden }));
}

function addGoals(add, root) {
  const { x, y, width, height } = FULL;
  const hidden = { hidden: true, isHidden: true };
  add(COMPONENT.GOALS_BOX, root, box(x, y, width, height, hidden));
  add(COMPONENT.GOALS_TITLE, root, text(x + 8, y + 4, width - 16, 20, { text: "Today's goals", fontId: 496, textColor: 0xff981f, yTextAlignment: 1, ...hidden }));
  for (let goal = 0; goal < MAX_GOALS; goal++) {
    const top = y + 30 + goal * 36;
    add(COMPONENT.GOAL_START + goal * COMPONENT.GOAL_STRIDE, root, text(x + 8, top, width - 16, 16, { yTextAlignment: 1, ...hidden }));
    add(COMPONENT.GOAL_START + goal * COMPONENT.GOAL_STRIDE + 1, root, text(x + 20, top + 16, width - 28, 16, { textColor: 0xb8ab94, yTextAlignment: 1, ...hidden }));
  }
  add(COMPONENT.GOALS_BONUS, root, text(x + 8, y + height - 44, width - 16, 18, { yTextAlignment: 1, ...hidden }));
  add(COMPONENT.GOALS_NEXT, root, text(x + 8, y + height - 24, width - 16, 18, { textColor: 0xb8ab94, yTextAlignment: 1, ...hidden }));
}

function addFeats(add, root) {
  const { x, y, width, height } = FULL;
  const hidden = { hidden: true, isHidden: true };
  add(COMPONENT.FEATS_BOX, root, box(x, y, width, height, hidden));
  add(COMPONENT.FEATS_TITLE, root, text(x + 8, y + 4, width - 16, 20, { text: "Achievements", fontId: 496, textColor: 0xff981f, yTextAlignment: 1, ...hidden }));
  for (let feat = 0; feat < MAX_FEATS; feat++) {
    const top = y + 28 + feat * 35;
    add(COMPONENT.FEAT_START + feat * COMPONENT.FEAT_STRIDE, root, text(x + 8, top, width - 16, 16, { yTextAlignment: 1, ...hidden }));
    add(COMPONENT.FEAT_START + feat * COMPONENT.FEAT_STRIDE + 1, root, text(x + 20, top + 16, width - 28, 16, { textColor: 0xb8ab94, yTextAlignment: 1, ...hidden }));
  }
}

function addRanks(add, root) {
  const { x, y, width, height } = FULL;
  const hidden = { hidden: true, isHidden: true };
  add(COMPONENT.RANKS_BOX, root, box(x, y, width, height, hidden));
  add(COMPONENT.RANKS_TITLE, root, text(x + 8, y + 4, 200, 20, { fontId: 496, textColor: 0xff981f, yTextAlignment: 1, ...hidden }));
  const categories = Hiscores.categories().slice(0, MAX_RANK_CATEGORIES);
  categories.forEach((_, index) => {
    const bx = x + width - 8 - (categories.length - index) * 64;
    add(COMPONENT.RANK_BUTTON_START + index, root, { ...button(bx, y + 4, 60, 20, "Show"), ...hidden });
    add(COMPONENT.RANK_BUTTON_LABEL_START + index, root, { ...buttonLabel(bx, y + 4, 60, 20), ...hidden });
  });
  for (let place = 0; place < MAX_RANKS; place++) {
    const top = y + 30 + place * 18;
    add(COMPONENT.RANK_ROW_START + place * COMPONENT.RANK_ROW_STRIDE, root, text(x + 12, top, 280, 18, { yTextAlignment: 1, ...hidden }));
    add(COMPONENT.RANK_ROW_START + place * COMPONENT.RANK_ROW_STRIDE + 1, root, text(x + width - 172, top, 160, 18, { xTextAlignment: 2, yTextAlignment: 1, ...hidden }));
  }
  add(COMPONENT.RANK_YOU, root, text(x + 8, y + height - 24, width - 16, 18, { textColor: 0xffd27f, yTextAlignment: 1, ...hidden }));
}

/** The uids each content tab shows: filled as the interface is built. */
const TAB_UIDS = { [TAB.OVERVIEW]: [], [TAB.STATS]: [], [TAB.GOALS]: [], [TAB.FEATS]: [], [TAB.RANKS]: [] };

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const into = (list) => (component, parent, definition) => {
    const id = add(component, parent, definition);
    list.push(id);
    return id;
  };
  for (const uids of Object.values(TAB_UIDS)) uids.length = 0;
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: 494, height: 316, xPositionMode: 1, yPositionMode: 1,
  });
  add(COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 494, height: 316 });
  addTabs(add, root);
  addStatus(into(TAB_UIDS[TAB.OVERVIEW]), root);
  addUpgrades(into(TAB_UIDS[TAB.OVERVIEW]), root);
  addStats(into(TAB_UIDS[TAB.STATS]), root);
  addGoals(into(TAB_UIDS[TAB.GOALS]), root);
  addFeats(into(TAB_UIDS[TAB.FEATS]), root);
  addRanks(into(TAB_UIDS[TAB.RANKS]), root);
  return { groupId: GROUP_ID, widgets };
}

const isOpen = (player) => player.getInterfaceId?.() === GROUP_ID;

function autoLine(player) {
  if (player.getAttribute(Common.AUTO_ATTRIBUTE) === false) return col(COLOUR.OFF, "Off");
  const paused = player.getAttribute(Common.COMBAT_TARGET_ATTRIBUTE) ? Combat.pausedFor(player)
    : player.getAttribute(Common.PRODUCTION_TARGET_ATTRIBUTE) ? Production.pausedFor(player) : Auto.pausedFor(player);
  if (paused === "click") return col(COLOUR.PAUSED, "Paused (you're doing something else)");
  if (paused === "stuck") return col(COLOUR.PAUSED, "Paused (it couldn't carry on)");
  if (paused === "logout") return col(COLOUR.PAUSED, "Paused (logging out)");
  if (paused === "out") return col(COLOUR.PAUSED, "Paused (out of materials)");
  return col(COLOUR.ON, "On");
}

/** What the character is doing, as plain text, or null when nothing yet. */
function activityText(player) {
  const fight = player.getAttribute(Common.COMBAT_TARGET_ATTRIBUTE);
  if (fight) return `Fighting ${fight.name.toLowerCase()}s`;
  const gather = player.getAttribute(Common.GATHER_TARGET_ATTRIBUTE);
  if (gather) return `${gather.option} ${gather.name.toLowerCase()}`;
  const make = player.getAttribute(Common.PRODUCTION_TARGET_ATTRIBUTE);
  if (make) return Production.doing(make);
  return null;
}

function activityLine(player) {
  const activity = activityText(player);
  return activity ? col(COLOUR.VALUE, activity) : col(COLOUR.DIM, "None yet: press Travel");
}

/** XP per hour of the session being played, or "-" when none is long enough to tell. */
function rateText(player) {
  const rate = Offline.currentRate(player);
  return rate ? number(rate.xpPerHour) : "-";
}

/** What each status line says, top to bottom. */
function statusLines(player) {
  const idle = Common.isIdle(player);
  const { xpPerPoint } = Common.data.progression;
  const lastAway = player.getAttribute(Offline.LAST_AWAY_ATTRIBUTE);
  return [
    `Idle Mode: ${idle ? col(COLOUR.ON, "On") : col(COLOUR.OFF, "Off")}`,
    `Auto-resume: ${idle ? autoLine(player) : col(COLOUR.DIM, "needs Idle Mode")}`,
    `Activity: ${activityLine(player)}`,
    `XP per hour: ${col(COLOUR.VALUE, rateText(player))}`,
    `Idle points: ${col(COLOUR.VALUE, number(Progression.points(player)))}`,
    `Next point: ${col(COLOUR.VALUE, `${number(Progression.progress(player))} / ${number(xpPerPoint)} XP`)}`,
    `Offline: up to ${col(COLOUR.VALUE, `${Progression.capHours(player)}h`)} at ${col(COLOUR.VALUE, `${Math.round(Common.data.offline.efficiency * 100)}%`)}`,
    `Last time away: ${lastAway ? col(COLOUR.VALUE, lastAway) : col(COLOUR.DIM, "not yet")}`,
  ];
}

function sendStatus(player) {
  const sender = player.getPacketSender();
  statusLines(player).forEach((line, index) => sender.sendString(line, uid(COMPONENT.STATUS_LINE_START + index)));
  sender.sendString(Common.isIdle(player) ? "Stop idle" : "Start idle", uid(COMPONENT.IDLE_LABEL));
  sender.sendString(player.getAttribute(Common.AUTO_ATTRIBUTE) === false ? "Start auto" : "Stop auto", uid(COMPONENT.AUTO_LABEL));
  sender.sendString("Travel", uid(COMPONENT.TRAVEL_LABEL));
}

function priceLine(row, points) {
  if (row.cost === null) return col(COLOUR.ON, "Max level");
  return `Next: ${col(points >= row.cost ? COLOUR.VALUE : COLOUR.OFF, number(row.cost))} points`;
}

function sendUpgrades(player) {
  const sender = player.getPacketSender();
  const points = Progression.points(player);
  sender.sendString(`You have ${col(COLOUR.VALUE, number(points))} idle ${points === 1 ? "point" : "points"}`, uid(COMPONENT.POINTS));
  const rows = Progression.upgradeRows(player).slice(0, buyUids().length);
  rows.forEach((row, slot) => {
    sender.sendString(`${row.name} ${col(COLOUR.VALUE, `${row.level}/${row.maxLevel}`)}`, uid(slotComponent(slot, SLOT.NAME)));
    sender.sendString(row.description.charAt(0).toUpperCase() + row.description.slice(1), uid(slotComponent(slot, SLOT.DESCRIPTION)));
    sender.sendString(priceLine(row, points), uid(slotComponent(slot, SLOT.PRICE)));
    const maxed = row.cost === null;
    sender.sendInterfaceDisplayState(uid(slotComponent(slot, SLOT.BUY_BUTTON)), maxed);
    sender.sendInterfaceDisplayState(uid(slotComponent(slot, SLOT.BUY_LABEL)), maxed);
    sender.sendString(points >= (row.cost ?? Infinity) ? "Buy" : col(COLOUR.DIM, "Buy"), uid(slotComponent(slot, SLOT.BUY_LABEL)));
  });
}

/** A total's lines, biggest first: "Woodcutting: 12,345 XP". */
function topLines(values, label, suffix) {
  return Object.entries(values ?? {})
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, STATS_LINES)
    .map(([key, amount]) => `${label(key)}: ${col(COLOUR.VALUE, number(amount))}${suffix}`);
}

/** The Stats tab: XP by skill, items by kind, and time idle online and offline. */
function statsLines(player) {
  const totals = Offline.totals(player);
  return {
    skills: topLines(totals.bySkill, (key) => Common.skillName(key), " XP"),
    items: topLines(totals.byItem, (itemId) => Common.itemName(Number(itemId)), ""),
    time: `Time idle: ${col(COLOUR.VALUE, Offline.formatDuration(totals.workedMs))} playing, ${col(COLOUR.VALUE, Offline.formatDuration(totals.offlineMs))} away`,
  };
}

function sendStats(player) {
  const sender = player.getPacketSender();
  const { skills, items, time } = statsLines(player);
  for (let line = 0; line < STATS_LINES; line++) {
    sender.sendString(skills[line] ?? (line === 0 ? col(COLOUR.DIM, "Nothing yet") : ""), uid(COMPONENT.SKILL_LINE_START + line));
    sender.sendString(items[line] ?? (line === 0 ? col(COLOUR.DIM, "Nothing yet") : ""), uid(COMPONENT.ITEM_LINE_START + line));
  }
  sender.sendString(time, uid(COMPONENT.STATS_TIME));
}

/** The Goals tab's lines, top to bottom (each goal: its text, then its progress and reward). */
function goalLines(player, now = Date.now()) {
  const { goals, bonus, nextInMs } = Goals.lines(player, now);
  const rows = goals.slice(0, MAX_GOALS).map((goal) => [
    goal.done ? `${col(COLOUR.ON, "Done")} ${goal.text}` : goal.text,
    `${number(goal.progress)} / ${number(goal.target)} - reward ${goal.points} idle points`,
  ]);
  return {
    rows,
    bonus: bonus.done
      ? `${col(COLOUR.ON, "All done!")} The bonus of ${bonus.points} idle points is yours.`
      : `Do all ${bonus.of} for ${col(COLOUR.VALUE, `${bonus.points} more idle points`)} (${bonus.count}/${bonus.of} done).`,
    next: `New goals in ${Offline.formatDuration(nextInMs)}.`,
  };
}

function sendGoals(player) {
  const sender = player.getPacketSender();
  const { rows, bonus, next } = goalLines(player);
  for (let goal = 0; goal < MAX_GOALS; goal++) {
    const [first = "", second = ""] = rows[goal] ?? [];
    sender.sendString(first, uid(COMPONENT.GOAL_START + goal * COMPONENT.GOAL_STRIDE));
    sender.sendString(second, uid(COMPONENT.GOAL_START + goal * COMPONENT.GOAL_STRIDE + 1));
  }
  sender.sendString(bonus, uid(COMPONENT.GOALS_BONUS));
  sender.sendString(next, uid(COMPONENT.GOALS_NEXT));
}

function sendFeats(player) {
  const sender = player.getPacketSender();
  const rows = Achievements.lines(player).slice(0, MAX_FEATS);
  for (let feat = 0; feat < MAX_FEATS; feat++) {
    const row = rows[feat];
    const title = !row ? "" : row.done ? `${col(COLOUR.ON, "Done")} ${row.title}` : row.title;
    sender.sendString(title, uid(COMPONENT.FEAT_START + feat * COMPONENT.FEAT_STRIDE));
    sender.sendString(row?.progress ?? "", uid(COMPONENT.FEAT_START + feat * COMPONENT.FEAT_STRIDE + 1));
  }
}

/** player -> the hiscores category the Ranks tab shows. */
const rankCategories = new Map();

function sendRanks(player) {
  const sender = player.getPacketSender();
  const categories = Hiscores.categories().slice(0, MAX_RANK_CATEGORIES);
  const shown = rankCategories.get(player) ?? categories[0].id;
  const { title, rows, you } = Hiscores.lines(player, shown, MAX_RANKS);
  sender.sendString(title, uid(COMPONENT.RANKS_TITLE));
  categories.forEach((category, index) => {
    const label = category.unit.charAt(0).toUpperCase() + category.unit.slice(1);
    sender.sendString(category.id === shown ? col(COLOUR.VALUE, label) : label, uid(COMPONENT.RANK_BUTTON_LABEL_START + index));
  });
  for (let place = 0; place < MAX_RANKS; place++) {
    const row = rows[place];
    const name = row ? `${row.place}. ${row.name}` : place === 0 ? col(COLOUR.DIM, "Nobody yet") : "";
    sender.sendString(row?.you ? col(COLOUR.ON, name) : name, uid(COMPONENT.RANK_ROW_START + place * COMPONENT.RANK_ROW_STRIDE));
    sender.sendString(row ? (row.you ? col(COLOUR.ON, row.value) : row.value) : "", uid(COMPONENT.RANK_ROW_START + place * COMPONENT.RANK_ROW_STRIDE + 1));
  }
  sender.sendString(you, uid(COMPONENT.RANK_YOU));
}

/** A category button on the Ranks tab. */
function clickRankCategory({ player, buttonId }) {
  if (!isOpen(player)) return false;
  const categories = Hiscores.categories().slice(0, MAX_RANK_CATEGORIES);
  const index = categories.findIndex((_, i) => buttonId === uid(COMPONENT.RANK_BUTTON_START + i) || buttonId === uid(COMPONENT.RANK_BUTTON_LABEL_START + i));
  if (index < 0) return false;
  rankCategories.set(player, categories[index].id);
  if (tabs.get(player) === TAB.RANKS) sendRanks(player);
  return true;
}

/** player -> the content tab shown (Overview, Stats, Goals, Feats or Ranks). */
const tabs = new Map();

function redraw(player) {
  if (!isOpen(player)) return;
  if (tabs.get(player) === TAB.STATS) {
    sendStats(player);
    return;
  }
  if (tabs.get(player) === TAB.GOALS) {
    sendGoals(player);
    return;
  }
  if (tabs.get(player) === TAB.FEATS) {
    sendFeats(player);
    return;
  }
  if (tabs.get(player) === TAB.RANKS) {
    sendRanks(player);
    return;
  }
  sendStatus(player);
  sendUpgrades(player);
}

/** Shows one content tab's components and hides the other's, then fills it. */
function showTab(player, tab) {
  tabs.set(player, tab);
  const sender = player.getPacketSender();
  for (const [index, uids] of Object.entries(TAB_UIDS)) {
    for (const id of uids) sender.sendInterfaceDisplayState(id, Number(index) !== tab);
  }
  TABS.forEach((label, index) => sender.sendString(index === tab ? col(COLOUR.VALUE, label) : label, uid(COMPONENT.TAB_LABEL_START + index)));
  redraw(player);
}

/** Opens the Idle screen, on its Overview. */
function open(player) {
  player.setInterfaceId(GROUP_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: FRAME_TITLE_SCRIPT, args: [uid(COMPONENT.FRAME), TITLE] }],
  });
  showTab(player, TAB.OVERVIEW);
}

/** The tabs: Overview and Stats switch the content; Travel opens the travel screen. */
function clickTab({ player, buttonId }) {
  if (!isOpen(player)) return false;
  const index = TABS.findIndex((_, tab) => buttonId === uid(COMPONENT.TAB_START + tab) || buttonId === uid(COMPONENT.TAB_LABEL_START + tab));
  if (index === TAB.TRAVEL) TravelScreen.open(player);
  else if (index >= 0) showTab(player, index);
  return true;
}

function switchIdle({ player }) {
  if (!isOpen(player)) return false;
  Common.setIdle(player, !Common.isIdle(player));
  return true;
}

function switchAuto({ player }) {
  if (!isOpen(player)) return false;
  Auto.setAuto(player, player.getAttribute(Common.AUTO_ATTRIBUTE) === false);
  return true;
}

/** `idle:summary`: the journal tab's Idle Information rows (plain text: the journal escapes it). */
function journalSummary(request) {
  const { player } = request;
  const { workedMs, offlineMs } = Offline.totals(player);
  request.summary = {
    idleMode: Common.isIdle(player) ? "On" : "Off",
    idleActivity: activityText(player) ?? "None yet",
    idleXpRate: rateText(player),
    idlePoints: Progression.points(player),
    idleTime: Offline.formatDuration(workedMs + offlineMs),
  };
}

/** Players whose login paid time away, for the screen to open once they are in the game. */
const returning = new Set();
/** Of those, the ones the welcome screen holds until they press Play (`gameframe:ready`). */
const atWelcome = new Set();

/** A login paid time away: show it, once the game frame is up. */
function returned(player) {
  if (!Common.data.offline.openScreenOnReturn) return;
  returning.add(player);
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class OpenOnReturnTask extends Task {
    constructor() { super(Math.max(1, Common.data.offline.openScreenDelayTicks | 0), player, false); }
    execute() {
      this.stop();
      // Behind the welcome screen it waits for Play instead.
      if (!atWelcome.has(player)) openReturning(player);
    }
  })());
}

function openReturning(player) {
  if (!returning.delete(player)) return;
  atWelcome.delete(player);
  if (player.isRegistered?.() !== false) open(player);
}

function welcomeShown({ player }) {
  atWelcome.add(player);
}

function gameframeReady({ player }) {
  if (atWelcome.has(player)) openReturning(player);
}

function forgetReturn({ player }) {
  returning.delete(player);
  atWelcome.delete(player);
  tabs.delete(player);
  rankCategories.delete(player);
}

/** `idle:open`: the Idle button in the journal tab (SideJournalDefaults). */
function openFromJournal({ player }) {
  open(player);
}

function travelButton({ player }) {
  if (!isOpen(player)) return false;
  TravelScreen.open(player);
  return true;
}

function buyButton({ player, buttonId }) {
  if (!isOpen(player)) return false;
  const slot = buyUids().findIndex((uids) => uids.includes(buttonId));
  const row = Progression.upgradeRows(player)[slot];
  if (row) player.sendMessage(Progression.buy(player, row.id));
  redraw(player);
  return true;
}

let buySlotUids = null;

/** Each upgrade slot's Buy button and label uids (one slot per upgrade in the data). */
function buyUids() {
  buySlotUids ??= Array.from({ length: slotLayout().slots }, (_, slot) => [
    uid(slotComponent(slot, SLOT.BUY_BUTTON)), uid(slotComponent(slot, SLOT.BUY_LABEL)),
  ]);
  return buySlotUids;
}

module.exports = function attach(api) {
  buySlotUids = null;
  api.registerCustomInterface(buildInterface());
  Common.registerScreen(GROUP_ID);
  api.onInterfaceActionButton([uid(COMPONENT.IDLE_BUTTON), uid(COMPONENT.IDLE_LABEL)], switchIdle);
  api.onInterfaceActionButton([uid(COMPONENT.AUTO_BUTTON), uid(COMPONENT.AUTO_LABEL)], switchAuto);
  api.onInterfaceActionButton([uid(COMPONENT.TRAVEL_BUTTON), uid(COMPONENT.TRAVEL_LABEL)], travelButton);
  api.onInterfaceActionButton(TABS.flatMap((_, tab) => [uid(COMPONENT.TAB_START + tab), uid(COMPONENT.TAB_LABEL_START + tab)]), clickTab);
  api.onInterfaceActionButton(Hiscores.categories().slice(0, MAX_RANK_CATEGORIES).flatMap((_, index) => [
    uid(COMPONENT.RANK_BUTTON_START + index), uid(COMPONENT.RANK_BUTTON_LABEL_START + index),
  ]), clickRankCategory);
  api.onCustomEvent("idle:open", openFromJournal);
  api.onCustomEvent("idle:summary", journalSummary);
  api.onCustomEvent("welcome-screen:shown", welcomeShown);
  api.onCustomEvent("gameframe:ready", gameframeReady);
  api.onPlayerLogout(forgetReturn);
  Offline.onPaid(returned);
  api.onInterfaceActionButton(buyUids().flat(), buyButton);
  Common.onChange(redraw);
};

module.exports.GROUP_ID = GROUP_ID;
module.exports.COMPONENT = COMPONENT;
module.exports.SLOT = SLOT;
module.exports.uid = uid;
module.exports.slotComponent = slotComponent;
module.exports.open = open;
module.exports.statusLines = statusLines;
module.exports.statsLines = statsLines;
module.exports.goalLines = goalLines;
module.exports.TAB = TAB;
module.exports.buildInterface = buildInterface;
