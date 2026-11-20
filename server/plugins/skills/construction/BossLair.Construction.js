"use strict";

/**
 * The achievement gallery's boss lair display (docs/construction.md, "Boss lair display"):
 * Jars opens the costume-room storage on enum 3300 (Storage.Construction.js); Configure lists
 * the lairs and shows the one picked, if its jar is stored. Withdrawing the shown lair's last
 * jar empties the display. rsprox 2909 (rev 230), 3897 (rev 235), local 1001171 (guest).
 */
const { Animation, CacheDefinitions, Sounds, Task, TaskManager } = require("./Core.Construction");
const Data = require("./Data.Construction");
const Ids = require("./Ids.Construction");
const Instance = require("./Instance.Construction");
const Menu = require("./Menu.Construction");

const HOTSPOT = "BOSS_LAIR_DISPLAY";
/** The display's jars, one row per lair, in the Configure menu's order (index + 1). */
const JARS_ENUM = 3300;
const BLANK = Ids.loc("poh_display_blank");
/**
 * The lairs in enum 3300's order, each with its menu label (rsprox 2909 tick 2172 for the first
 * fourteen) and loc. Ours: the last two labels are the Wiki's names (Boss lair display); no
 * capture has them in the menu.
 */
const LAIRS = [
  ["Kraken", "poh_display_kraken"], ["Zulrah", "poh_display_zulrah"], ["Kalphite Queen", "poh_display_kq"],
  ["Cerberus", "poh_display_cerberus"], ["Abyssal Sire", "poh_display_sire"], ["Skotizo", "poh_display_skotizo"],
  ["Grotesque Guardians", "poh_display_gargoyle"], ["Vorkath", "poh_display_vorkath"], ["Alchemical Hydra", "poh_display_hydra"],
  ["Sarachnis", "poh_display_sarachnis"], ["The Nightmare", "poh_display_nightmare"], ["Corporeal Beast", "poh_display_corp"],
  ["Thermonuclear Smoke Devil", "poh_display_thermy"], ["Araxxor", "poh_display_araxyte"],
  ["Shellbane Gryphon", "poh_display_gryphon"], ["Mad Angel", "poh_display_angel"],
].map(([label, loc]) => ({ label, loc: Ids.loc(loc) }));
const TITLE = "Choose a lair";
const EMPTY = "Empty";
const NOT_OWNER = "You can only configure the display in your own house.";
const NO_JAR = "The display does not contain the jar of that creature.";
// Setting the display, and taking out the shown lair's jar: the player reaches into the display
// and the lair changes a tick later (rsprox 2909 ticks 2179-2180 and 2463-2464, 3897 tick 1092).
const REACH = Ids.seq("human_pickuptable");
const REACH_SOUND = 2942, REACH_SOUND_DELAY = 10, REACH_SOUND_RANGE = 7;
const CHANGE_TICKS = 1;

function jars() {
  return [...CacheDefinitions.getEnumValues(JARS_ENUM).values()];
}

function isLairDisplay(furniture) {
  return furniture?.hotspotKey === HOTSPOT;
}

/** The furniture clicked, if it is a boss lair display in the player's current house. */
function displayAt(event) {
  const house = event.player.getPrivateArea();
  if (!(house instanceof Instance.PlayerHouseInstance)) return null;
  const furniture = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  return isLairDisplay(furniture) ? { house, furniture } : null;
}

/** The lair index the display shows, or -1 when it is blank. */
function shownLair(furniture) {
  return LAIRS.findIndex(lair => lair.loc === furniture.displayObjectId);
}

function hasJar(furniture, jar) {
  return (furniture.storage?.[jar] ?? 0) > 0;
}

function stillThere(house, furniture, player) {
  return house.owner === player && player.getPrivateArea() === house && !house.isDestroyed()
    && house.furnitureEntries().some(entry => entry.furniture === furniture);
}

/** The reach, its sound and, a tick later, the lair (`index`, -1 for blank) on the display. */
function reachAndShow(player, house, furniture, index) {
  player.performAnimation(new Animation(REACH));
  const at = player.getLocation();
  Sounds.playAreaSound({ soundId: REACH_SOUND, x: at.getX(), y: at.getY(), level: at.getZ(), loops: 1,
    delay: REACH_SOUND_DELAY, radius: REACH_SOUND_RANGE, source: player });
  TaskManager.submit(new class extends Task {
    constructor() { super(CHANGE_TICKS, player, false); }
    execute() {
      this.stop();
      if (house.isDestroyed() || !house.furnitureEntries().some(entry => entry.furniture === furniture)) return;
      show(house, furniture, index);
    }
  }());
}

function show(house, furniture, index) {
  if (index >= 0) furniture.displayObjectId = LAIRS[index].loc;
  else delete furniture.displayObjectId;
  house.owner.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
  house.redrawFurniture();
}

function menuLabels(furniture) {
  const ids = jars();
  return [EMPTY, ...LAIRS.map((lair, index) => hasJar(furniture, ids[index]) ? lair.label : `<str>${lair.label}</str>`)];
}

/** Configure: the owner picks a lair whose jar is stored, or Empty; a missing jar is refused and the menu comes back. */
function configure(event) {
  const context = displayAt(event);
  if (!context) return false;
  const { player } = event, { house, furniture } = context;
  if (house.owner !== player) {
    player.sendMessage(NOT_OWNER);
    return true;
  }
  openLairMenu(player, house, furniture);
  return true;
}

function openLairMenu(player, house, furniture) {
  Menu.openMenu(player, TITLE, menuLabels(furniture), choice => {
    if (!stillThere(house, furniture, player)) return;
    const index = choice - 1;
    if (index >= 0 && !hasJar(furniture, jars()[index])) {
      Menu.warn(player, NO_JAR, () => {
        if (stillThere(house, furniture, player)) openLairMenu(player, house, furniture);
      });
      return;
    }
    reachAndShow(player, house, furniture, index);
  });
}

/**
 * After a withdrawal from the display's jars: once the shown lair's jar is gone the storage
 * closes and the display empties (rsprox 3897 tick 1092). True when it did.
 */
function afterWithdraw(player, house, furniture) {
  if (!isLairDisplay(furniture)) return false;
  const index = shownLair(furniture);
  if (index < 0 || hasJar(furniture, jars()[index])) return false;
  player.getPacketSender().sendInterfaceRemoval();
  reachAndShow(player, house, furniture, -1);
  return true;
}

/** Every display loc: the blank one and each lair (their names differ, so they are matched by id). */
const DISPLAY_LOCS = new Set([BLANK, ...LAIRS.map(lair => lair.loc)]);

function configureOption(event) {
  if (configure(event)) event.handled = true;
}

/** Configure on each display loc's own name (the blank one and every lair's differ). */
function attachBossLair(api) {
  const names = new Set([...DISPLAY_LOCS].map(id => CacheDefinitions.getObject(id)?.name).filter(Boolean));
  for (const name of names) api.onObjectInteraction(name, { Configure: configureOption });
}

Object.assign(module.exports, { attachBossLair, afterWithdraw, configure, LAIRS, JARS_ENUM, BLANK, NO_JAR, NOT_OWNER });
