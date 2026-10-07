const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { TYPE_MODEL, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("./widgetGroup");

const GROUP_ID = 30008;
const GAMEFRAME_OVERLAY_UID = (161 << 16) | 92;
const CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE = "interface:close-on-interface-close";
const COMPONENT = {
  ROOT: 0,
  FRAME: 1,
  DESCRIPTION: 3,
  PLAYER_PANEL: 4,
  PLAYER_MODEL: 5,
  PLAYER_TITLE: 6,
  MELEE_PANEL: 10,
  MELEE_NORMAL: 11,
  MELEE_SPECIAL: 12,
  RANGED_PANEL: 20,
  RANGED_NORMAL: 21,
  RANGED_SPECIAL: 22,
  MAGIC_PANEL: 30,
  MAGIC_LIST: 31,
  MAGIC_SCROLLBAR: 32,
  MAGIC_ROW_START: 100,
};
const MAGIC_ROW_HEIGHT = 18;
const MAGIC_ROW_COUNT = 80;
const MAGIC_VIEW_HEIGHT = 250;
const uid = (component) => (GROUP_ID << 16) | component;

function spellName(name) {
  return name
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function combatSpells() {
  const { CombatSpells } = require("../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
  const spells = new Map();
  for (const [name, value] of Object.entries(CombatSpells)) {
    const spell = typeof value?.maximumHit === "function"
      ? value
      : typeof value?.getSpell === "function"
        ? value.getSpell()
        : null;
    if (!spell || typeof spell.spellId !== "function" || spell.maximumHit() <= 0) continue;
    spells.set(spell.spellId(), { name: spellName(name), spell });
  }
  return [...spells.values()].sort((left, right) => left.name.localeCompare(right.name));
}

let SPELLS = null;
const MAGIC_LIST_HEIGHT = MAGIC_ROW_COUNT * MAGIC_ROW_HEIGHT;

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 836, rawHeight: 420, width: 836, height: 420,
    xPositionMode: 1, yPositionMode: 1,
  });
  add(COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 836, height: 420 });
  add(COMPONENT.DESCRIPTION, root, {
    type: TYPE_TEXT, rawX: 18, rawY: 52, rawWidth: 800, rawHeight: 18, width: 800, height: 18,
    text: "Live values use your current equipment, boosts, prayers, and combat style.", fontId: 494, textColor: 0xe8ded0, textShadowed: true, xTextAlignment: 1, yTextAlignment: 1,
  });

  add(COMPONENT.PLAYER_PANEL, root, {
    type: TYPE_RECTANGLE, rawX: 16, rawY: 86, rawWidth: 190, rawHeight: 308, width: 190, height: 308,
    filled: true, color: 0x211b16, opacity: 32,
  });
  add(COMPONENT.PLAYER_TITLE, root, {
    type: TYPE_TEXT, rawX: 16, rawY: 96, rawWidth: 190, rawHeight: 26, width: 190, height: 26,
    text: "Player", fontId: 496, textColor: 0xffd27f, textShadowed: true, xTextAlignment: 1, yTextAlignment: 1,
  });
  add(COMPONENT.PLAYER_MODEL, root, {
    type: TYPE_MODEL, contentType: 328, rawX: 20, rawY: 240, rawWidth: 182, rawHeight: 262, width: 182, height: 262, modelZoom: 500,
  });

  const panels = [
    [COMPONENT.MELEE_PANEL, COMPONENT.MELEE_NORMAL, COMPONENT.MELEE_SPECIAL, 222, "Melee"],
    [COMPONENT.RANGED_PANEL, COMPONENT.RANGED_NORMAL, COMPONENT.RANGED_SPECIAL, 428, "Ranged"],
  ];
  for (const [panel, normal, special, x, title] of panels) {
    add(panel, root, {
      type: TYPE_RECTANGLE, rawX: x, rawY: 86, rawWidth: 190, rawHeight: 308, width: 190, height: 308,
      filled: true, color: 0x211b16, opacity: 32,
    });
    add(panel + 3, root, {
      type: TYPE_TEXT, rawX: x, rawY: 96, rawWidth: 190, rawHeight: 26, width: 190, height: 26,
      text: title, fontId: 496, textColor: 0xffd27f, textShadowed: true, xTextAlignment: 1, yTextAlignment: 1,
    });
    add(normal, root, {
      type: TYPE_TEXT, rawX: x + 12, rawY: 134, rawWidth: 166, rawHeight: 38, width: 166, height: 38,
      text: "", fontId: 494, textColor: 0xffffff, textShadowed: true,
    });
    add(special, root, {
      type: TYPE_TEXT, rawX: x + 12, rawY: 190, rawWidth: 166, rawHeight: 50, width: 166, height: 50,
      text: "", fontId: 494, textColor: 0xffffff, textShadowed: true,
    });
  }

  add(COMPONENT.MAGIC_PANEL, root, {
    type: TYPE_RECTANGLE, rawX: 634, rawY: 86, rawWidth: 190, rawHeight: 308, width: 190, height: 308,
    filled: true, color: 0x211b16, opacity: 32,
  });
  add(COMPONENT.MAGIC_PANEL + 3, root, {
    type: TYPE_TEXT, rawX: 634, rawY: 96, rawWidth: 190, rawHeight: 26, width: 190, height: 26,
    text: "Magic", fontId: 496, textColor: 0xffd27f, textShadowed: true, xTextAlignment: 1, yTextAlignment: 1,
  });
  const list = add(COMPONENT.MAGIC_LIST, root, {
    rawX: 642, rawY: 124, rawWidth: 166, rawHeight: MAGIC_VIEW_HEIGHT, width: 166, height: MAGIC_VIEW_HEIGHT,
    scrollWidth: 166, scrollHeight: MAGIC_LIST_HEIGHT,
  });
  add(COMPONENT.MAGIC_SCROLLBAR, root, {
    rawX: 808, rawY: 124, rawWidth: 12, rawHeight: MAGIC_VIEW_HEIGHT, width: 12, height: MAGIC_VIEW_HEIGHT, noClickThrough: true,
  });
  for (let row = 0; row < MAGIC_ROW_COUNT; row++) {
    add(COMPONENT.MAGIC_ROW_START + row, list, {
      type: TYPE_TEXT, rawX: 0, rawY: row * MAGIC_ROW_HEIGHT, rawWidth: 162, rawHeight: MAGIC_ROW_HEIGHT, width: 162, height: MAGIC_ROW_HEIGHT,
      text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true, yTextAlignment: 1,
    });
  }

  return {
    groupId: GROUP_ID,
    widgets,
    scroll: [{ viewComponent: COMPONENT.MAGIC_LIST, scrollbarComponent: COMPONENT.MAGIC_SCROLLBAR, contentHeight: MAGIC_LIST_HEIGHT }],
  };
}

let INTERFACE_DEFINITION;
let DamageFormulas;
const lastRender = new WeakMap();

function getDamageFormulas() {
  if (!DamageFormulas) {
    ({ DamageFormulas } = require("../../src/main/typescript/elvarg/game/content/combat/formula/DamageFormulas"));
  }
  return DamageFormulas;
}

function getCombatSpells() {
  if (SPELLS === null) {
    SPELLS = combatSpells();
  }
  return SPELLS;
}

function getSpecial(player) {
  return player.getCombatSpecial?.() ?? player.combatSpecial ?? null;
}

function hasSpecialFor(player, type) {
  return getSpecial(player)?.getCombatMethod?.().type?.() === type;
}

function specialText(maxHit, available) {
  return available ? `Special attack\nmax hit: ${maxHit}` : "No special\nattack available";
}

function render(player, force = false) {
  const formulas = getDamageFormulas();
  const meleeSpecial = hasSpecialFor(player, CombatType.MELEE);
  const rangedSpecial = hasSpecialFor(player, CombatType.RANGED);
  const magicSpecial = hasSpecialFor(player, CombatType.MAGIC);
  const meleeMax = formulas.calculateMaxMeleeHit(player, false);
  const rangedMax = formulas.calculateMaxRangedHit(player, false);
  const meleeSpecialMax = meleeSpecial ? formulas.calculateMaxMeleeHit(player, true) : null;
  const rangedSpecialMax = rangedSpecial ? formulas.calculateMaxRangedHit(player, true) : null;
  const magicRows = [
    ...(magicSpecial ? [`Special attack: ${formulas.calculateMaxMagicHit(player, undefined, true)}`] : []),
    ...getCombatSpells().map(({ name, spell }) => `${name}: ${formulas.getMagicMaxhit(player, spell)}`),
  ];
  const signature = [meleeMax, rangedMax, meleeSpecialMax, rangedSpecialMax, ...magicRows].join("|");
  if (!force && lastRender.get(player) === signature) return;
  lastRender.set(player, signature);

  const sender = player.getPacketSender();
  sender
    .sendString(`Max hit: ${meleeMax}`, uid(COMPONENT.MELEE_NORMAL))
    .sendString(specialText(meleeSpecialMax, meleeSpecial), uid(COMPONENT.MELEE_SPECIAL))
    .sendString(`Max hit: ${rangedMax}`, uid(COMPONENT.RANGED_NORMAL))
    .sendString(specialText(rangedSpecialMax, rangedSpecial), uid(COMPONENT.RANGED_SPECIAL));
  for (let row = 0; row < MAGIC_ROW_COUNT; row++) {
    sender
      .sendString(magicRows[row] ?? "", uid(COMPONENT.MAGIC_ROW_START + row))
      .sendInterfaceDisplayState(uid(COMPONENT.MAGIC_ROW_START + row), row >= magicRows.length);
  }
}

function open(player) {
  player.setAttribute(CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE, GROUP_ID);
  player
    .getPacketSender()
    .sendSubInterface(GAMEFRAME_OVERLAY_UID, GROUP_ID, 1, {
      postScripts: [{ scriptId: 227, args: [uid(COMPONENT.FRAME), "Combat max hits"] }],
    });
  render(player, true);
}

module.exports = {
  name: "MaxHitsInterface",
  register(api) {
    INTERFACE_DEFINITION = buildInterface();
    api.registerCustomInterface(INTERFACE_DEFINITION);
    for (const command of ["maxhits", "maxhit", "mh", "maxrangehit", "mrh", "maxmagehit", "mmh"]) {
      api.registerCommand(command, ({ player }) => (open(player), true), undefined, "Show live combat max hits");
    }
    api.onPlayerProcess(({ player }) => {
      if (player.getAttribute(CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE) === GROUP_ID) {
        render(player);
      }
    });
  },
  _test: {
    GROUP_ID,
    COMPONENT,
    MAGIC_ROW_COUNT,
    getInterfaceDefinition: () => INTERFACE_DEFINITION,
    getSpells: getCombatSpells,
    open,
    render,
    uid,
  },
};
