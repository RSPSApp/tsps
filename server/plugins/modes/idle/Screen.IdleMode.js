/**
 * The Idle screen (`::idle`): a server-defined interface (docs/agents/interfaces.md), so it needs
 * no client change, only a server restart.
 *
 * Six tabs: Overview (the hero strip, the idle points and the upgrades), Stats (the totals),
 * Goals (today's goals), Feats (achievements), Ranks (the hiscores) and Travel (the travel
 * screen, which is its own interface).
 *
 * The medium is bare rectangles and text at absolute coordinates, so the layout follows four
 * rules:
 *
 * - One thing leads each tab. On the Overview that is the hero strip: what the character is
 *   doing now, with auto-resume and the XP rate beside it. What you read once and forget (the
 *   offline cap, the last time away) is a dim footnote, not a line of equal weight.
 * - A number that is really a fraction is drawn as a bar. No packet resizes a component
 *   (sendInterfacePosition only moves one), so a bar is a dark track under a row of pips, each
 *   shown or hidden: `addBar` builds one, `bar` fills it. Granularity is one pip.
 * - A rectangle's colour cannot change either, so anything that switches colour is two or three
 *   rectangles stacked with one shown at a time (`swatch`): the hero's edge, a goal's marker.
 * - Redraws are diffed per component (`drawTo`). Common's `changed` fires every tick a character
 *   works, and re-sending every string each tick is what makes the screen feel heavy.
 *
 * A component whose visibility depends on live state is "managed": `showTab` only ever hides it,
 * and the tab's own draw decides when it is shown. Otherwise switching tabs would light every
 * pip for a frame.
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

/**
 * The cache's fonts: 494 is plain 11, 496 bold 12. There is nothing larger, so emphasis here is
 * weight, colour and space rather than size.
 */
const FONT = { BODY: 494, STRONG: 496 };
const ALIGN = { LEFT: 0, CENTRE: 1, RIGHT: 2 };

const INK = {
  TITLE: 0xff981f, TEXT: 0xe8ded0, DIM: 0xb8ab94, FAINT: 0x8f7f66,
  VALUE: 0xffffff, LABEL: 0xffd27f,
};
const FILL = {
  PANEL: 0x211b16, HERO: 0x2a221a, TRACK: 0x120e0b, RULE: 0x3b2f20,
  BUTTON: 0x3b2f20, BUTTON_OVER: 0x54432c,
  GOOD: 0x7ac943, WARN: 0xffb83f, BAD: 0xc4453a, GOLD: 0xffb02e, MINE: 0x33402a,
};
/** The same few colours as `<col=...>` tags, for text. */
const COLOUR = {
  ON: "00ff00", OFF: "ff5f5f", PAUSED: "ffb83f", VALUE: "ffffff",
  DIM: "8f7f66", LABEL: "ffd27f", GOOD: "7ac943",
};

const TABS = ["Overview", "Stats", "Goals", "Feats", "Ranks", "Travel"];
const TAB = { OVERVIEW: 0, STATS: 1, GOALS: 2, FEATS: 3, RANKS: 4, TRAVEL: 5 };

const TAB_ROW = { x: 18, y: 32, width: 72, step: 76, height: 20 };
const HERO = { x: 18, y: 58, width: 458, height: 48 };
const LEFT = { x: 18, y: 112, width: 226, height: 184 };
const RIGHT = { x: 252, y: 112, width: 224, height: 184 };
const FULL = { x: 18, y: 58, width: 458, height: 238 };

/** Pips in each bar: the next idle point reads finely, a goal or a tier coarsely. */
const NEXT_PIPS = 20;
const GOAL_PIPS = 10;
const FEAT_PIPS = 10;
/** Level pips an upgrade slot has room for; each slot only builds as many as it has levels. */
const MAX_UPGRADE_PIPS = 6;
/** Ids are reserved for four upgrade slots; `slotLayout` fits as many as the panel holds. */
const MAX_UPGRADE_SLOTS = 4;
/** The shortest an upgrade slot can be and still hold its name, its description and its price. */
const MIN_SLOT_HEIGHT = 44;
/** Ids are reserved for five goal rows; the data's goalsPerDay says how many are built. */
const MAX_GOAL_SLOTS = 5;
const MAX_FEATS = 6;
const MAX_RANKS = 10;
const MAX_RANK_CATEGORIES = 4;
const STATS_LINES = 8;
const FEAT_TIERS = 3;

const COMPONENT = {
  ROOT: 0, FRAME: 1,

  // The tabs: a button, its label, and the accent rule under the one you are on.
  TAB_START: 4, TAB_LABEL_START: 12, TAB_RULE_START: 20,

  // Overview, the hero strip: what the character is doing, right now.
  HERO_BOX: 30, HERO_EDGE_GOOD: 31, HERO_EDGE_WARN: 32, HERO_EDGE_BAD: 33,
  HERO_EYEBROW: 34, HERO_ACTIVITY: 35, HERO_AUTO: 36, HERO_RATE: 37,

  // Overview, left: the idle points, the next one, and the three buttons.
  PROGRESS_BOX: 40, PROGRESS_TITLE: 41, PROGRESS_POINTS: 42,
  NEXT_LABEL: 43, NEXT_VALUE: 44, NEXT_TRACK: 45, NEXT_PIP_START: 46, // 46..65
  PROGRESS_OFFLINE: 66, PROGRESS_AWAY: 67,
  IDLE_BUTTON: 68, IDLE_LABEL: 69, AUTO_BUTTON: 70, AUTO_LABEL: 71,
  TRAVEL_BUTTON: 72, TRAVEL_LABEL: 73,

  // Overview, right: the upgrades, one slot each.
  UPGRADES_BOX: 80, UPGRADES_TITLE: 81, UPGRADES_POINTS: 82,
  SLOT_START: 90, SLOT_STRIDE: 16, // 90..153

  // Stats: three tiles of time and XP, then XP by skill and items by kind.
  STATS_BOX: 160, STATS_TITLE: 161,
  STATS_TILE_START: 162, STATS_TILE_STRIDE: 3, // 162..170
  STATS_RULE: 172, STATS_SKILLS_HEADER: 173, STATS_ITEMS_HEADER: 174,
  STATS_SKILL_START: 176, STATS_ITEM_START: 192, STATS_ROW_STRIDE: 2, // 176..191, 192..207

  // Goals: a row per goal, each with a bar, then the all-done bonus.
  GOALS_BOX: 210, GOALS_TITLE: 211, GOALS_NEXT: 212,
  GOAL_START: 220, GOAL_STRIDE: 20, // 220..319
  BONUS_BOX: 320, BONUS_TEXT: 321, BONUS_TRACK: 322, BONUS_PIP_START: 323, // 323..327

  // Feats: a row per track, its tier chips and a bar to the next tier.
  FEATS_BOX: 330, FEATS_TITLE: 331, FEATS_SUB: 332,
  FEAT_START: 340, FEAT_STRIDE: 20, // 340..459

  // Ranks: the category buttons, a row per place, and where you stand.
  RANKS_BOX: 470, RANKS_TITLE: 471,
  RANK_BUTTON_START: 474, RANK_BUTTON_LABEL_START: 478, RANK_BUTTON_RULE_START: 482,
  RANK_HEAD_PLACE: 486, RANK_HEAD_NAME: 487, RANK_HEAD_VALUE: 488, RANK_RULE: 489,
  RANK_ROW_START: 490, RANK_ROW_STRIDE: 4, // 490..529
  RANK_YOU_BOX: 530, RANK_YOU: 531,
};

/** An upgrade slot's parts (PIP_START runs to PIP_START + MAX_UPGRADE_PIPS - 1). */
const SLOT = { NAME: 0, DESCRIPTION: 1, PRICE: 2, BUY_BUTTON: 3, BUY_LABEL: 4, PIP_TRACK: 5, PIP_START: 6, RULE: 12 };
/** A goal row's parts. */
const GOAL = { EDGE_DONE: 0, EDGE_OPEN: 1, TEXT: 2, REWARD: 3, VALUE: 4, TRACK: 5, PIP_START: 6 };
/** A feat row's parts (CHIP_START runs to CHIP_START + FEAT_TIERS - 1). */
const FEAT = { CHIP_TRACK: 0, CHIP_START: 1, TITLE: 4, NEXT: 5, VALUE: 6, TRACK: 7, PIP_START: 8 };
/** A rank row's parts. */
const RANK = { MINE: 0, PLACE: 1, NAME: 2, VALUE: 3 };
/** A stats row's parts, and a stats tile's. */
const ROW = { NAME: 0, VALUE: 1 };
const TILE = { BOX: 0, VALUE: 1, LABEL: 2 };

const uid = (component) => (GROUP_ID << 16) | component;
const slotComponent = (slot, part) => COMPONENT.SLOT_START + slot * COMPONENT.SLOT_STRIDE + part;
const goalComponent = (goal, part) => COMPONENT.GOAL_START + goal * COMPONENT.GOAL_STRIDE + part;
const featComponent = (feat, part) => COMPONENT.FEAT_START + feat * COMPONENT.FEAT_STRIDE + part;
const rankComponent = (place, part) => COMPONENT.RANK_ROW_START + place * COMPONENT.RANK_ROW_STRIDE + part;
const rowComponent = (start, line, part) => start + line * COMPONENT.STATS_ROW_STRIDE + part;
const tileComponent = (tile, part) => COMPONENT.STATS_TILE_START + tile * COMPONENT.STATS_TILE_STRIDE + part;

const col = (colour, value) => `<col=${colour}>${value}</col>`;
const number = (value) => Math.floor(value).toLocaleString("en-US");
const capitalise = (value) => value.charAt(0).toUpperCase() + value.slice(1);

const HIDDEN = { hidden: true, isHidden: true };

const text = (x, y, width, height, overrides = {}) => ({
  type: TYPE_TEXT, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
  text: "", fontId: FONT.BODY, textColor: INK.TEXT, textShadowed: true, yTextAlignment: 1, ...overrides,
});
const box = (x, y, width, height, overrides = {}) => ({
  type: TYPE_RECTANGLE, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
  filled: true, color: FILL.PANEL, opacity: 32, ...overrides,
});
/** An opaque rectangle: a bar's track, a pip, a rule, a tile. */
const solid = (x, y, width, height, colour, overrides = {}) =>
  box(x, y, width, height, { color: colour, opacity: 0, ...overrides });
const button = (x, y, width, height, action, overrides = {}) => box(x, y, width, height, {
  color: FILL.BUTTON, mouseOverColor: FILL.BUTTON_OVER, opacity: 0, actions: [action], flags: FLAG_OP1, ...overrides,
});
const buttonLabel = (x, y, width, height, value = "", overrides = {}) => text(x, y, width, height, {
  text: value, fontId: FONT.STRONG, textColor: INK.LABEL, xTextAlignment: ALIGN.CENTRE, ...overrides,
});
const panelTitle = (x, y, width, value, overrides = {}) => text(x, y, width, 18, {
  text: value, fontId: FONT.STRONG, textColor: INK.TITLE, ...overrides,
});

/** Components `showTab` may only hide: their own tab's draw decides when each is shown. */
const MANAGED = new Set();
const manage = (...components) => {
  for (const component of components) MANAGED.add(component);
};

/**
 * A dark track with `count` pips over it, all hidden until a draw fills them. The track is
 * managed too, so a row with nothing to show shows nothing at all rather than an empty bar.
 */
function addBar(add, root, trackComponent, pipStart, count, x, y, width, height, colour, extra = {}, track = FILL.TRACK) {
  manage(trackComponent);
  add(trackComponent, root, solid(x, y, width, height, track, { ...extra, ...HIDDEN }));
  const inner = width - 2;
  const gap = count > 12 ? 1 : 2;
  const pipWidth = Math.max(1, Math.floor((inner - (count - 1) * gap) / count));
  const step = pipWidth + gap;
  const left = x + 1 + Math.max(0, Math.floor((inner - (count * pipWidth + (count - 1) * gap)) / 2));
  for (let pip = 0; pip < count; pip++) {
    manage(pipStart + pip);
    add(pipStart + pip, root, solid(left + pip * step, y + 1, pipWidth, height - 2, colour, { ...extra, ...HIDDEN }));
  }
}

function addTabs(add, root) {
  TABS.forEach((label, index) => {
    const x = TAB_ROW.x + index * TAB_ROW.step;
    add(COMPONENT.TAB_START + index, root, box(x, TAB_ROW.y, TAB_ROW.width, TAB_ROW.height, {
      color: 0x2b241b, mouseOverColor: 0x3a3125, actions: ["Open"], flags: FLAG_OP1,
    }));
    add(COMPONENT.TAB_LABEL_START + index, root, text(x, TAB_ROW.y, TAB_ROW.width, TAB_ROW.height, {
      text: label, fontId: FONT.STRONG, textColor: INK.LABEL, xTextAlignment: ALIGN.CENTRE,
    }));
    add(COMPONENT.TAB_RULE_START + index, root, solid(x, TAB_ROW.y + TAB_ROW.height, TAB_ROW.width, 2, FILL.GOLD, HIDDEN));
  });
}

/** The hero strip: the one line that answers "is it working, and on what?". */
function addHero(add, root) {
  const { x, y, width, height } = HERO;
  add(COMPONENT.HERO_BOX, root, solid(x, y, width, height, FILL.HERO));
  manage(COMPONENT.HERO_EDGE_GOOD, COMPONENT.HERO_EDGE_WARN, COMPONENT.HERO_EDGE_BAD);
  add(COMPONENT.HERO_EDGE_GOOD, root, solid(x, y, 3, height, FILL.GOOD, HIDDEN));
  add(COMPONENT.HERO_EDGE_WARN, root, solid(x, y, 3, height, FILL.WARN, HIDDEN));
  add(COMPONENT.HERO_EDGE_BAD, root, solid(x, y, 3, height, FILL.BAD, HIDDEN));
  add(COMPONENT.HERO_EYEBROW, root, text(x + 11, y + 6, 240, 13, { textColor: INK.FAINT }));
  add(COMPONENT.HERO_ACTIVITY, root, text(x + 11, y + 21, 290, 20, { fontId: FONT.STRONG, textColor: INK.VALUE }));
  add(COMPONENT.HERO_AUTO, root, text(x + 282, y + 6, 168, 13, { xTextAlignment: ALIGN.RIGHT }));
  add(COMPONENT.HERO_RATE, root, text(x + 282, y + 21, 168, 20, {
    fontId: FONT.STRONG, textColor: INK.LABEL, xTextAlignment: ALIGN.RIGHT,
  }));
}

/** The left panel: the idle points, a bar to the next one, the offline terms, and the buttons. */
function addProgress(add, root) {
  const { x, y, width, height } = LEFT;
  const inner = width - 16;
  add(COMPONENT.PROGRESS_BOX, root, box(x, y, width, height));
  add(COMPONENT.PROGRESS_TITLE, root, panelTitle(x + 8, y + 4, inner, "Progress"));
  add(COMPONENT.PROGRESS_POINTS, root, text(x + 8, y + 26, inner, 20, { fontId: FONT.STRONG }));
  add(COMPONENT.NEXT_LABEL, root, text(x + 8, y + 54, 100, 14, { text: "Next point", textColor: INK.FAINT }));
  add(COMPONENT.NEXT_VALUE, root, text(x + 108, y + 54, inner - 100, 14, { xTextAlignment: ALIGN.RIGHT }));
  addBar(add, root, COMPONENT.NEXT_TRACK, COMPONENT.NEXT_PIP_START, NEXT_PIPS, x + 8, y + 72, inner, 10, FILL.GOOD);
  add(COMPONENT.PROGRESS_OFFLINE, root, text(x + 8, y + 88, inner, 14, { textColor: INK.DIM }));
  add(COMPONENT.PROGRESS_AWAY, root, text(x + 8, y + 104, inner, 14, { textColor: INK.FAINT }));

  // Two buttons that switch something, then the one that opens the travel screen, full width.
  const half = Math.floor((inner - 6) / 2);
  add(COMPONENT.IDLE_BUTTON, root, button(x + 8, y + 128, half, 24, "Switch"));
  add(COMPONENT.IDLE_LABEL, root, buttonLabel(x + 8, y + 128, half, 24));
  add(COMPONENT.AUTO_BUTTON, root, button(x + 14 + half, y + 128, half, 24, "Switch"));
  add(COMPONENT.AUTO_LABEL, root, buttonLabel(x + 14 + half, y + 128, half, 24));
  add(COMPONENT.TRAVEL_BUTTON, root, button(x + 8, y + 156, inner, 24, "Travel"));
  add(COMPONENT.TRAVEL_LABEL, root, buttonLabel(x + 8, y + 156, inner, 24, "Change activity"));
}

/**
 * One slot per upgrade the panel has room for. A slot needs MIN_SLOT_HEIGHT for its three lines,
 * so a fifth upgrade in the data would need a taller panel rather than a thinner slot.
 */
function slotLayout() {
  const upgrades = Object.values(Common.data.progression.upgrades);
  const available = RIGHT.height - 30 - 8;
  const slots = Math.min(MAX_UPGRADE_SLOTS, upgrades.length, Math.floor(available / MIN_SLOT_HEIGHT));
  return { slots, height: slots > 0 ? Math.floor(available / slots) : 0, upgrades };
}

function addUpgrades(add, root) {
  const { x, y, width, height } = RIGHT;
  const layout = slotLayout();
  add(COMPONENT.UPGRADES_BOX, root, box(x, y, width, height));
  add(COMPONENT.UPGRADES_TITLE, root, panelTitle(x + 8, y + 4, 100, "Upgrades"));
  add(COMPONENT.UPGRADES_POINTS, root, text(x + 108, y + 4, width - 116, 18, {
    textColor: INK.LABEL, xTextAlignment: ALIGN.RIGHT,
  }));
  for (let slot = 0; slot < layout.slots; slot++) {
    const top = y + 30 + slot * layout.height;
    // A hairline between slots, so three upgrades read as three things rather than six lines.
    if (slot > 0) add(slotComponent(slot, SLOT.RULE), root, solid(x + 8, top - 7, width - 16, 1, FILL.RULE));
    add(slotComponent(slot, SLOT.NAME), root, text(x + 8, top, 142, 14));
    // One pip per level the upgrade has, sized to fill the same track whatever that count is.
    const levels = Math.min(MAX_UPGRADE_PIPS, layout.upgrades[slot].costs.length);
    addBar(add, root, slotComponent(slot, SLOT.PIP_TRACK), slotComponent(slot, SLOT.PIP_START),
      levels, x + 158, top + 1, 58, 12, FILL.GOLD);
    add(slotComponent(slot, SLOT.DESCRIPTION), root, text(x + 8, top + 16, width - 16, 14, { textColor: INK.DIM }));
    add(slotComponent(slot, SLOT.PRICE), root, text(x + 8, top + 32, 142, 16));
    manage(slotComponent(slot, SLOT.BUY_BUTTON), slotComponent(slot, SLOT.BUY_LABEL));
    add(slotComponent(slot, SLOT.BUY_BUTTON), root, button(x + 158, top + 31, 58, 17, "Buy", HIDDEN));
    add(slotComponent(slot, SLOT.BUY_LABEL), root, buttonLabel(x + 158, top + 31, 58, 17, "", HIDDEN));
  }
}

function addStats(add, root) {
  const { x, y, width, height } = FULL;
  add(COMPONENT.STATS_BOX, root, box(x, y, width, height, HIDDEN));
  add(COMPONENT.STATS_TITLE, root, panelTitle(x + 8, y + 4, 200, "Statistics", HIDDEN));
  // Three tiles: the two times, and the XP they bought.
  const tileWidth = Math.floor((width - 16 - 16) / 3);
  for (let tile = 0; tile < 3; tile++) {
    const left = x + 8 + tile * (tileWidth + 8);
    add(tileComponent(tile, TILE.BOX), root, solid(left, y + 28, tileWidth, 42, FILL.TRACK, HIDDEN));
    add(tileComponent(tile, TILE.VALUE), root, text(left + 6, y + 32, tileWidth - 12, 18, {
      fontId: FONT.STRONG, textColor: INK.VALUE, xTextAlignment: ALIGN.CENTRE, ...HIDDEN,
    }));
    add(tileComponent(tile, TILE.LABEL), root, text(left + 6, y + 50, tileWidth - 12, 14, {
      textColor: INK.FAINT, xTextAlignment: ALIGN.CENTRE, ...HIDDEN,
    }));
  }
  add(COMPONENT.STATS_RULE, root, solid(x + 8, y + 78, width - 16, 1, FILL.RULE, HIDDEN));
  add(COMPONENT.STATS_SKILLS_HEADER, root, text(x + 8, y + 84, 200, 16, {
    text: "XP gained", textColor: INK.LABEL, ...HIDDEN,
  }));
  add(COMPONENT.STATS_ITEMS_HEADER, root, text(x + 232, y + 84, width - 240, 16, {
    text: "Items gathered and made", textColor: INK.LABEL, ...HIDDEN,
  }));
  for (let line = 0; line < STATS_LINES; line++) {
    const top = y + 104 + line * 16;
    add(rowComponent(COMPONENT.STATS_SKILL_START, line, ROW.NAME), root, text(x + 8, top, 118, 16, HIDDEN));
    add(rowComponent(COMPONENT.STATS_SKILL_START, line, ROW.VALUE), root, text(x + 130, top, 78, 16, {
      textColor: INK.VALUE, xTextAlignment: ALIGN.RIGHT, ...HIDDEN,
    }));
    add(rowComponent(COMPONENT.STATS_ITEM_START, line, ROW.NAME), root, text(x + 232, top, 140, 16, HIDDEN));
    add(rowComponent(COMPONENT.STATS_ITEM_START, line, ROW.VALUE), root, text(x + 376, top, 74, 16, {
      textColor: INK.VALUE, xTextAlignment: ALIGN.RIGHT, ...HIDDEN,
    }));
  }
}

/**
 * A row per goal the data gives a day, spread over the space above the bonus strip, so three
 * goals fill the tab rather than huddling under a gap.
 */
function goalLayout() {
  const top = 32;
  const bonusTop = 204;
  const slots = Math.max(1, Math.min(MAX_GOAL_SLOTS, Common.data.goals.goalsPerDay | 0));
  return { slots, top, bonusTop, height: Math.floor((bonusTop - top - 6) / slots) };
}

function addGoals(add, root) {
  const { x, y, width, height } = FULL;
  add(COMPONENT.GOALS_BOX, root, box(x, y, width, height, HIDDEN));
  add(COMPONENT.GOALS_TITLE, root, panelTitle(x + 8, y + 4, 260, "Today's goals", HIDDEN));
  add(COMPONENT.GOALS_NEXT, root, text(x + 282, y + 4, 168, 18, {
    textColor: INK.DIM, xTextAlignment: ALIGN.RIGHT, ...HIDDEN,
  }));
  const layout = goalLayout();
  for (let goal = 0; goal < layout.slots; goal++) {
    const top = y + layout.top + goal * layout.height;
    manage(goalComponent(goal, GOAL.EDGE_DONE), goalComponent(goal, GOAL.EDGE_OPEN));
    add(goalComponent(goal, GOAL.EDGE_DONE), root, solid(x + 8, top, 3, 28, FILL.GOOD, HIDDEN));
    add(goalComponent(goal, GOAL.EDGE_OPEN), root, solid(x + 8, top, 3, 28, FILL.RULE, HIDDEN));
    add(goalComponent(goal, GOAL.TEXT), root, text(x + 18, top, 300, 16, HIDDEN));
    add(goalComponent(goal, GOAL.REWARD), root, text(x + 328, top, 122, 16, {
      textColor: INK.LABEL, xTextAlignment: ALIGN.RIGHT, ...HIDDEN,
    }));
    addBar(add, root, goalComponent(goal, GOAL.TRACK), goalComponent(goal, GOAL.PIP_START),
      GOAL_PIPS, x + 18, top + 19, 300, 8, FILL.GOOD, HIDDEN);
    add(goalComponent(goal, GOAL.VALUE), root, text(x + 328, top + 17, 122, 12, {
      textColor: INK.FAINT, xTextAlignment: ALIGN.RIGHT, ...HIDDEN,
    }));
  }
  add(COMPONENT.BONUS_BOX, root, solid(x + 8, y + layout.bonusTop, width - 16, 28, FILL.TRACK, HIDDEN));
  add(COMPONENT.BONUS_TEXT, root, text(x + 16, y + layout.bonusTop + 4, 300, 20, HIDDEN));
  // One pip per goal of the day, so the bonus bar counts the same things the rows do.
  // The strip is already the track's colour, so this bar needs a lighter one to read at all.
  addBar(add, root, COMPONENT.BONUS_TRACK, COMPONENT.BONUS_PIP_START, layout.slots,
    x + 354, y + layout.bonusTop + 10, 96, 10, FILL.GOLD, HIDDEN, FILL.RULE);
}

function addFeats(add, root) {
  const { x, y, width, height } = FULL;
  add(COMPONENT.FEATS_BOX, root, box(x, y, width, height, HIDDEN));
  add(COMPONENT.FEATS_TITLE, root, panelTitle(x + 8, y + 4, 260, "Achievements", HIDDEN));
  add(COMPONENT.FEATS_SUB, root, text(x + 282, y + 4, 168, 18, {
    textColor: INK.DIM, xTextAlignment: ALIGN.RIGHT, ...HIDDEN,
  }));
  for (let feat = 0; feat < MAX_FEATS; feat++) {
    const top = y + 32 + feat * 34;
    // The tier chips: one lit square per tier earned, on their own little track.
    addBar(add, root, featComponent(feat, FEAT.CHIP_TRACK), featComponent(feat, FEAT.CHIP_START),
      FEAT_TIERS, x + 8, top + 2, 28, 12, FILL.GOLD, HIDDEN);
    add(featComponent(feat, FEAT.TITLE), root, text(x + 44, top, 270, 16, HIDDEN));
    add(featComponent(feat, FEAT.NEXT), root, text(x + 322, top, 128, 16, {
      textColor: INK.FAINT, xTextAlignment: ALIGN.RIGHT, ...HIDDEN,
    }));
    addBar(add, root, featComponent(feat, FEAT.TRACK), featComponent(feat, FEAT.PIP_START),
      FEAT_PIPS, x + 44, top + 19, 270, 8, FILL.GOOD, HIDDEN);
    add(featComponent(feat, FEAT.VALUE), root, text(x + 322, top + 17, 128, 12, {
      textColor: INK.VALUE, xTextAlignment: ALIGN.RIGHT, ...HIDDEN,
    }));
  }
}

function addRanks(add, root) {
  const { x, y, width, height } = FULL;
  add(COMPONENT.RANKS_BOX, root, box(x, y, width, height, HIDDEN));
  add(COMPONENT.RANKS_TITLE, root, panelTitle(x + 8, y + 4, width - 16, "", HIDDEN));
  const categories = Hiscores.categories().slice(0, MAX_RANK_CATEGORIES);
  // Wide enough for the longest category the data has ("Boss kills") at the label's bold font.
  const buttonWidth = 76;
  categories.forEach((_, index) => {
    const left = x + 8 + index * (buttonWidth + 4);
    add(COMPONENT.RANK_BUTTON_START + index, root, button(left, y + 30, buttonWidth, 20, "Show", HIDDEN));
    add(COMPONENT.RANK_BUTTON_LABEL_START + index, root, buttonLabel(left, y + 30, buttonWidth, 20, "", HIDDEN));
    manage(COMPONENT.RANK_BUTTON_RULE_START + index);
    add(COMPONENT.RANK_BUTTON_RULE_START + index, root, solid(left, y + 50, buttonWidth, 2, FILL.GOLD, HIDDEN));
  });
  add(COMPONENT.RANK_HEAD_PLACE, root, text(x + 12, y + 58, 30, 14, { text: "#", textColor: INK.FAINT, ...HIDDEN }));
  add(COMPONENT.RANK_HEAD_NAME, root, text(x + 46, y + 58, 200, 14, { text: "Player", textColor: INK.FAINT, ...HIDDEN }));
  add(COMPONENT.RANK_HEAD_VALUE, root, text(x + 322, y + 58, 128, 14, {
    textColor: INK.FAINT, xTextAlignment: ALIGN.RIGHT, ...HIDDEN,
  }));
  add(COMPONENT.RANK_RULE, root, solid(x + 8, y + 74, width - 16, 1, FILL.RULE, HIDDEN));
  for (let place = 0; place < MAX_RANKS; place++) {
    const top = y + 78 + place * 14;
    manage(rankComponent(place, RANK.MINE));
    add(rankComponent(place, RANK.MINE), root, solid(x + 6, top - 1, width - 12, 15, FILL.MINE, HIDDEN));
    add(rankComponent(place, RANK.PLACE), root, text(x + 12, top, 30, 14, { textColor: INK.FAINT, ...HIDDEN }));
    add(rankComponent(place, RANK.NAME), root, text(x + 46, top, 200, 14, HIDDEN));
    add(rankComponent(place, RANK.VALUE), root, text(x + 322, top, 128, 14, {
      textColor: INK.VALUE, xTextAlignment: ALIGN.RIGHT, ...HIDDEN,
    }));
  }
  add(COMPONENT.RANK_YOU_BOX, root, solid(x + 8, y + 220, width - 16, 18, FILL.TRACK, HIDDEN));
  add(COMPONENT.RANK_YOU, root, text(x + 16, y + 221, width - 32, 16, { textColor: INK.LABEL, ...HIDDEN }));
}

/** The components each content tab owns: filled as the interface is built. */
const TAB_COMPONENTS = { [TAB.OVERVIEW]: [], [TAB.STATS]: [], [TAB.GOALS]: [], [TAB.FEATS]: [], [TAB.RANKS]: [] };

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const into = (list) => (component, parent, definition) => {
    const id = add(component, parent, definition);
    list.push(component);
    return id;
  };
  for (const components of Object.values(TAB_COMPONENTS)) components.length = 0;
  MANAGED.clear();
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: 494, height: 316, xPositionMode: 1, yPositionMode: 1,
  });
  add(COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 494, height: 316 });
  addTabs(add, root);
  addHero(into(TAB_COMPONENTS[TAB.OVERVIEW]), root);
  addProgress(into(TAB_COMPONENTS[TAB.OVERVIEW]), root);
  addUpgrades(into(TAB_COMPONENTS[TAB.OVERVIEW]), root);
  addStats(into(TAB_COMPONENTS[TAB.STATS]), root);
  addGoals(into(TAB_COMPONENTS[TAB.GOALS]), root);
  addFeats(into(TAB_COMPONENTS[TAB.FEATS]), root);
  addRanks(into(TAB_COMPONENTS[TAB.RANKS]), root);
  return { groupId: GROUP_ID, widgets };
}

const isOpen = (player) => player.getInterfaceId?.() === GROUP_ID;

/**
 * What each player's client has already been shown, so a redraw sends only what changed. Reset
 * whenever the client is served the group again (`open`) or the player goes (`forgetReturn`).
 */
const drawn = new Map();

function drawTo(player) {
  let last = drawn.get(player);
  if (!last) drawn.set(player, (last = new Map()));
  const sender = player.getPacketSender();
  return {
    say(component, value) {
      const key = `t${component}`;
      if (last.get(key) === value) return;
      last.set(key, value);
      sender.sendString(value, uid(component));
    },
    show(component, visible) {
      const key = `h${component}`;
      if (last.get(key) === visible) return;
      last.set(key, visible);
      sender.sendInterfaceDisplayState(uid(component), !visible);
    },
  };
}

/** Lights a bar's first pips: none at all without progress, and every one only at full. */
function bar(draw, pipStart, count, fraction) {
  const lit = fraction >= 1 ? count : fraction <= 0 ? 0 : Math.max(1, Math.floor(fraction * count));
  for (let pip = 0; pip < count; pip++) draw.show(pipStart + pip, pip < lit);
}

/** Shows whichever of several stacked rectangles `chosen` names, and hides the rest. */
function swatch(draw, options, chosen) {
  for (const [key, component] of Object.entries(options)) draw.show(component, key === chosen);
}

/** Why auto-resume has stopped, or null when it is running or switched off. */
function autoPausedFor(player) {
  if (player.getAttribute(Common.AUTO_ATTRIBUTE) === false) return null;
  if (player.getAttribute(Common.COMBAT_TARGET_ATTRIBUTE)) return Combat.pausedFor(player);
  if (player.getAttribute(Common.PRODUCTION_TARGET_ATTRIBUTE)) return Production.pausedFor(player);
  return Auto.pausedFor(player);
}

const PAUSED_REASON = {
  click: "Paused (you're doing something else)",
  stuck: "Paused (it couldn't carry on)",
  logout: "Paused (logging out)",
  out: "Paused (out of materials)",
  retreat: "Paused (fled: out of food)",
};

function autoLine(player) {
  if (player.getAttribute(Common.AUTO_ATTRIBUTE) === false) return col(COLOUR.OFF, "Off");
  const paused = autoPausedFor(player);
  if (paused && PAUSED_REASON[paused]) return col(COLOUR.PAUSED, PAUSED_REASON[paused]);
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

/** XP per hour of the session being played, or "-" when none is long enough to tell. */
function rateText(player) {
  const rate = Offline.currentRate(player);
  return rate ? number(rate.xpPerHour) : "-";
}

/**
 * The hero strip: the state lives in the eyebrow and the edge's colour, so the one big line is
 * only ever the work itself.
 */
function heroLines(player) {
  const rate = `${rateText(player)} XP/h`;
  if (!Common.isIdle(player)) {
    return {
      edge: "bad", eyebrow: "IDLE MODE OFF", activity: "Press Start idle to begin",
      auto: col(COLOUR.DIM, "Auto-resume needs Idle Mode"), rate,
    };
  }
  const auto = `Auto-resume: ${autoLine(player)}`;
  const activity = activityText(player);
  if (!activity) return { edge: "warn", eyebrow: "IDLE MODE ON", activity: "Nothing chosen yet", auto, rate };
  const stopped = Boolean(autoPausedFor(player)) || player.getAttribute(Common.AUTO_ATTRIBUTE) === false;
  return { edge: stopped ? "warn" : "good", eyebrow: stopped ? "STOPPED ON" : "WORKING ON", activity, auto, rate };
}

/** The left panel: the points, the next one, and the offline terms as footnotes. */
function progressLines(player) {
  const { xpPerPoint } = Common.data.progression;
  const points = Progression.points(player);
  const progress = Progression.progress(player);
  const lastAway = player.getAttribute(Offline.LAST_AWAY_ATTRIBUTE);
  return {
    points: `${col(COLOUR.VALUE, number(points))} ${points === 1 ? "idle point" : "idle points"}`,
    next: `${col(COLOUR.VALUE, number(progress))} / ${number(xpPerPoint)} XP`,
    fraction: xpPerPoint > 0 ? progress / xpPerPoint : 0,
    offline: `Offline pays ${Math.round(Common.data.offline.efficiency * 100)}% for up to ${Progression.capHours(player)}h`,
    away: lastAway ? `Last time away: ${lastAway}` : "No time away paid yet",
  };
}

function drawHero(draw, player) {
  const { edge, eyebrow, activity, auto, rate } = heroLines(player);
  swatch(draw, {
    good: COMPONENT.HERO_EDGE_GOOD, warn: COMPONENT.HERO_EDGE_WARN, bad: COMPONENT.HERO_EDGE_BAD,
  }, edge);
  draw.say(COMPONENT.HERO_EYEBROW, eyebrow);
  draw.say(COMPONENT.HERO_ACTIVITY, activity);
  draw.say(COMPONENT.HERO_AUTO, auto);
  draw.say(COMPONENT.HERO_RATE, rate);
}

function drawProgress(draw, player) {
  const { points, next, fraction, offline, away } = progressLines(player);
  draw.say(COMPONENT.PROGRESS_POINTS, points);
  draw.say(COMPONENT.NEXT_VALUE, next);
  draw.show(COMPONENT.NEXT_TRACK, true);
  bar(draw, COMPONENT.NEXT_PIP_START, NEXT_PIPS, fraction);
  draw.say(COMPONENT.PROGRESS_OFFLINE, offline);
  draw.say(COMPONENT.PROGRESS_AWAY, away);
  draw.say(COMPONENT.IDLE_LABEL, Common.isIdle(player) ? "Stop idle" : "Start idle");
  draw.say(COMPONENT.AUTO_LABEL, player.getAttribute(Common.AUTO_ATTRIBUTE) === false ? "Start auto" : "Stop auto");
}

/** A slot's price line: what the next level costs, and how far off you are. */
function priceLine(row, points) {
  if (row.cost === null) return col(COLOUR.GOOD, "Every level bought");
  if (points >= row.cost) return `${col(COLOUR.VALUE, number(row.cost))} points`;
  return `${col(COLOUR.VALUE, number(row.cost))} points ${col(COLOUR.DIM, `- ${number(row.cost - points)} to go`)}`;
}

function drawUpgrades(draw, player) {
  const points = Progression.points(player);
  draw.say(COMPONENT.UPGRADES_POINTS, `${col(COLOUR.VALUE, number(points))} to spend`);
  const layout = slotLayout();
  const rows = Progression.upgradeRows(player).slice(0, layout.slots);
  rows.forEach((row, slot) => {
    draw.say(slotComponent(slot, SLOT.NAME), `${row.name} ${col(COLOUR.DIM, `${row.level}/${row.maxLevel}`)}`);
    draw.show(slotComponent(slot, SLOT.PIP_TRACK), true);
    bar(draw, slotComponent(slot, SLOT.PIP_START), Math.min(MAX_UPGRADE_PIPS, row.maxLevel),
      row.maxLevel > 0 ? row.level / row.maxLevel : 0);
    // The short form: the long one is a sentence per slot, and three of them do not fit the panel.
    draw.say(slotComponent(slot, SLOT.DESCRIPTION), capitalise(row.short.replace(/^each level:\s*/i, "")));
    draw.say(slotComponent(slot, SLOT.PRICE), priceLine(row, points));
    const affordable = row.cost !== null && points >= row.cost;
    draw.show(slotComponent(slot, SLOT.BUY_BUTTON), affordable);
    draw.show(slotComponent(slot, SLOT.BUY_LABEL), affordable);
    draw.say(slotComponent(slot, SLOT.BUY_LABEL), "Buy");
  });
}

/** A total's rows, biggest first: ["Woodcutting", "12,345"]. */
function topRows(values, label) {
  return Object.entries(values ?? {})
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, STATS_LINES)
    .map(([key, amount]) => [label(key), number(amount)]);
}

/** The Stats tab: the three tiles, then XP by skill and items by kind. */
function statsLines(player) {
  const totals = Offline.totals(player);
  const xp = Object.values(totals.bySkill ?? {}).reduce((sum, amount) => sum + amount, 0);
  return {
    tiles: [
      [Offline.formatDuration(totals.workedMs), "idle playing"],
      [Offline.formatDuration(totals.offlineMs), "away"],
      [number(xp), "XP gained"],
    ],
    skills: topRows(totals.bySkill, (key) => Common.skillName(key)),
    items: topRows(totals.byItem, (itemId) => Common.itemName(Number(itemId))),
  };
}

function drawStats(draw, player) {
  const { tiles, skills, items } = statsLines(player);
  tiles.forEach(([value, label], tile) => {
    draw.say(tileComponent(tile, TILE.VALUE), value);
    draw.say(tileComponent(tile, TILE.LABEL), label);
  });
  for (let line = 0; line < STATS_LINES; line++) {
    const [skill = "", skillValue = ""] = skills[line] ?? [];
    const [item = "", itemValue = ""] = items[line] ?? [];
    draw.say(rowComponent(COMPONENT.STATS_SKILL_START, line, ROW.NAME),
      skill || (line === 0 ? col(COLOUR.DIM, "Nothing yet") : ""));
    draw.say(rowComponent(COMPONENT.STATS_SKILL_START, line, ROW.VALUE), skillValue);
    draw.say(rowComponent(COMPONENT.STATS_ITEM_START, line, ROW.NAME),
      item || (line === 0 ? col(COLOUR.DIM, "Nothing yet") : ""));
    draw.say(rowComponent(COMPONENT.STATS_ITEM_START, line, ROW.VALUE), itemValue);
  }
}

/** The Goals tab's rows and its bonus strip. */
function goalLines(player, now = Date.now()) {
  const { goals, bonus, nextInMs } = Goals.lines(player, now);
  return {
    rows: goals.slice(0, goalLayout().slots).map((goal) => ({
      done: goal.done,
      text: goal.done ? col(COLOUR.GOOD, goal.text) : goal.text,
      reward: `+${goal.points} points`,
      value: `${number(goal.progress)} / ${number(goal.target)}`,
      fraction: goal.target > 0 ? goal.progress / goal.target : 0,
    })),
    bonus: bonus.done
      ? `${col(COLOUR.GOOD, "Bonus paid")}: ${bonus.points} extra idle points`
      : `All ${bonus.of} done pays ${col(COLOUR.VALUE, `${bonus.points} extra points`)}`,
    bonusFraction: bonus.of > 0 ? bonus.count / bonus.of : 0,
    next: `New goals in ${Offline.formatDuration(nextInMs)}`,
  };
}

function drawGoals(draw, player) {
  const { rows, bonus, bonusFraction, next } = goalLines(player);
  const { slots } = goalLayout();
  draw.say(COMPONENT.GOALS_NEXT, next);
  for (let goal = 0; goal < slots; goal++) {
    const row = rows[goal];
    swatch(draw, {
      done: goalComponent(goal, GOAL.EDGE_DONE), open: goalComponent(goal, GOAL.EDGE_OPEN),
    }, !row ? "none" : row.done ? "done" : "open");
    draw.say(goalComponent(goal, GOAL.TEXT), row?.text ?? "");
    draw.say(goalComponent(goal, GOAL.REWARD), row?.reward ?? "");
    draw.say(goalComponent(goal, GOAL.VALUE), row?.value ?? "");
    draw.show(goalComponent(goal, GOAL.TRACK), Boolean(row));
    bar(draw, goalComponent(goal, GOAL.PIP_START), GOAL_PIPS, row?.fraction ?? 0);
  }
  draw.say(COMPONENT.BONUS_TEXT, bonus);
  draw.show(COMPONENT.BONUS_TRACK, true);
  bar(draw, COMPONENT.BONUS_PIP_START, slots, bonusFraction);
}

/** The Feats tab's rows: the tiers earned, the next one, and how far along it is. */
function featLines(player) {
  const tracks = Achievements.lines(player).slice(0, MAX_FEATS);
  const earned = tracks.reduce((sum, track) => sum + track.tier, 0);
  const total = tracks.reduce((sum, track) => sum + track.tiers, 0);
  return {
    sub: `${earned} of ${total} tiers earned`,
    rows: tracks.map((track) => ({
      tier: track.tier,
      tiers: track.tiers,
      title: track.done ? col(COLOUR.GOOD, track.name) : track.tier > 0 ? col(COLOUR.VALUE, track.name) : track.name,
      next: track.done ? col(COLOUR.GOOD, "Every tier done") : `Next: ${track.nextName}`,
      value: track.done
        ? `${number(track.count)} ${track.unit}`
        : `${number(Math.min(track.count, track.next))} / ${number(track.next)}`,
      fraction: track.done ? 1 : track.next > 0 ? Math.min(track.count, track.next) / track.next : 0,
    })),
  };
}

function drawFeats(draw, player) {
  const { sub, rows } = featLines(player);
  draw.say(COMPONENT.FEATS_SUB, sub);
  for (let feat = 0; feat < MAX_FEATS; feat++) {
    const row = rows[feat];
    draw.show(featComponent(feat, FEAT.CHIP_TRACK), Boolean(row));
    bar(draw, featComponent(feat, FEAT.CHIP_START), FEAT_TIERS, row && row.tiers > 0 ? row.tier / row.tiers : 0);
    draw.say(featComponent(feat, FEAT.TITLE), row?.title ?? "");
    draw.say(featComponent(feat, FEAT.NEXT), row?.next ?? "");
    draw.say(featComponent(feat, FEAT.VALUE), row?.value ?? "");
    draw.show(featComponent(feat, FEAT.TRACK), Boolean(row));
    bar(draw, featComponent(feat, FEAT.PIP_START), FEAT_PIPS, row?.fraction ?? 0);
  }
}

/** player -> the hiscores category the Ranks tab shows. */
const rankCategories = new Map();

function drawRanks(draw, player) {
  const categories = Hiscores.categories().slice(0, MAX_RANK_CATEGORIES);
  const shown = rankCategories.get(player) ?? categories[0].id;
  const { title, rows, you } = Hiscores.lines(player, shown, MAX_RANKS);
  draw.say(COMPONENT.RANKS_TITLE, title);
  const category = categories.find((entry) => entry.id === shown) ?? categories[0];
  draw.say(COMPONENT.RANK_HEAD_VALUE, capitalise(category.unit));
  categories.forEach((entry, index) => {
    const label = capitalise(entry.unit);
    draw.say(COMPONENT.RANK_BUTTON_LABEL_START + index, entry.id === shown ? col(COLOUR.VALUE, label) : label);
    draw.show(COMPONENT.RANK_BUTTON_RULE_START + index, entry.id === shown);
  });
  for (let place = 0; place < MAX_RANKS; place++) {
    const row = rows[place];
    draw.show(rankComponent(place, RANK.MINE), Boolean(row?.you));
    draw.say(rankComponent(place, RANK.PLACE), row ? String(row.place) : "");
    draw.say(rankComponent(place, RANK.NAME),
      row ? (row.you ? col(COLOUR.GOOD, row.name) : row.name) : place === 0 ? col(COLOUR.DIM, "Nobody yet") : "");
    draw.say(rankComponent(place, RANK.VALUE), row?.value ?? "");
  }
  draw.say(COMPONENT.RANK_YOU, you);
}

/** A category button on the Ranks tab. */
function clickRankCategory({ player, buttonId }) {
  if (!isOpen(player)) return false;
  const categories = Hiscores.categories().slice(0, MAX_RANK_CATEGORIES);
  const index = categories.findIndex((_, i) => buttonId === uid(COMPONENT.RANK_BUTTON_START + i) || buttonId === uid(COMPONENT.RANK_BUTTON_LABEL_START + i));
  if (index < 0) return false;
  rankCategories.set(player, categories[index].id);
  if (tabs.get(player) === TAB.RANKS) drawRanks(drawTo(player), player);
  return true;
}

/** player -> the content tab shown. */
const tabs = new Map();

function redraw(player) {
  if (!isOpen(player)) return;
  const draw = drawTo(player);
  const tab = tabs.get(player);
  if (tab === TAB.STATS) {
    drawStats(draw, player);
    return;
  }
  if (tab === TAB.GOALS) {
    drawGoals(draw, player);
    return;
  }
  if (tab === TAB.FEATS) {
    drawFeats(draw, player);
    return;
  }
  if (tab === TAB.RANKS) {
    drawRanks(draw, player);
    return;
  }
  drawHero(draw, player);
  drawProgress(draw, player);
  drawUpgrades(draw, player);
}

/** Shows one tab's components and hides the others', then fills it. */
function showTab(player, tab) {
  tabs.set(player, tab);
  const draw = drawTo(player);
  for (const [index, components] of Object.entries(TAB_COMPONENTS)) {
    const active = Number(index) === tab;
    // A managed component is only ever hidden here: the tab's own draw, below, shows it.
    for (const component of components) draw.show(component, active && !MANAGED.has(component));
  }
  TABS.forEach((label, index) => {
    draw.say(COMPONENT.TAB_LABEL_START + index, index === tab ? col(COLOUR.VALUE, label) : label);
    draw.show(COMPONENT.TAB_RULE_START + index, index === tab);
  });
  redraw(player);
}

/** Opens the Idle screen, on its Overview. */
function open(player) {
  player.setInterfaceId(GROUP_ID);
  // The client is served the whole group again, so nothing it was shown before still holds.
  drawn.delete(player);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: FRAME_TITLE_SCRIPT, args: [uid(COMPONENT.FRAME), TITLE] }],
  });
  showTab(player, TAB.OVERVIEW);
}

/** The tabs: five switch the content; Travel opens the travel screen. */
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
  drawn.delete(player);
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

/** Each upgrade slot's Buy button and label uids (one slot per upgrade the panel fits). */
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
module.exports.GOAL = GOAL;
module.exports.FEAT = FEAT;
module.exports.RANK = RANK;
module.exports.ROW = ROW;
module.exports.TILE = TILE;
module.exports.uid = uid;
module.exports.slotComponent = slotComponent;
module.exports.goalComponent = goalComponent;
module.exports.featComponent = featComponent;
module.exports.rankComponent = rankComponent;
module.exports.rowComponent = rowComponent;
module.exports.tileComponent = tileComponent;
module.exports.open = open;
module.exports.heroLines = heroLines;
module.exports.progressLines = progressLines;
module.exports.statsLines = statsLines;
module.exports.goalLines = goalLines;
module.exports.featLines = featLines;
module.exports.TAB = TAB;
module.exports.TABS = TABS;
module.exports.TAB_COMPONENTS = TAB_COMPONENTS;
module.exports.MANAGED = MANAGED;
module.exports.STATS_LINES = STATS_LINES;
module.exports.NEXT_PIPS = NEXT_PIPS;
module.exports.GOAL_PIPS = GOAL_PIPS;
module.exports.FEAT_PIPS = FEAT_PIPS;
module.exports.FEAT_TIERS = FEAT_TIERS;
module.exports.goalLayout = goalLayout;
module.exports.MAX_FEATS = MAX_FEATS;
module.exports.MAX_RANKS = MAX_RANKS;
module.exports.buildInterface = buildInterface;
