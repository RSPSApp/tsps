/**
 * Tutorial Island — "Learning the Ropes".
 *
 * Ported from rsmod's content/areas/tutorial-island module, adapted to this
 * server's transcript-driven dialogue runtime.
 *
 * How it fits together:
 *  - Progress is a single numeric stage persisted on the player as the
 *    `tutorial.island.stage` attribute (registered with api.persistAttribute).
 *  - Words are NOT re-authored. Every instructor talk is played by the shared
 *    NpcDialogues runtime from data/definitions/npc-dialogues.json page
 *    "Learning the Ropes"; this plugin picks the variant for the player's stage
 *    (onNpcDialogueVariant), answers the wiki prose conditions
 *    (onNpcDialogueCondition) and runs the transcript's item grants
 *    (npc-dialogue:action / "receive").
 *  - Doors/gates/ladders gate progression and the ladder links teleport (the
 *    mine is a same-plane area, so the generic Ladder plugin cannot link it).
 *    Objects are matched by cache id and bounded to the island so mainland
 *    trees/rocks/anvils keep their normal handling.
 *  - The "Tutorial Island Progress" overlay (cache interface 649) is shown
 *    while the tutorial is active and driven by varp 2687.
 *
 * Enable/disable the plugin through world.json "disabledPlugins".
 */

const STAGE_ATTR = "tutorial.island.stage";

/** Sequential progress values. Mirrors rsmod's TutorialStep enum. */
const STAGE = Object.freeze({
  CHAR_CREATE: 0,
  EXP_SELECT: 1,
  GIELINOR_TALK: 2,
  GIELINOR_SETTINGS: 3,
  GIELINOR_DOOR: 4,
  SURVIVAL_TALK: 5,
  SURVIVAL_INV: 6,
  SURVIVAL_FISH: 7,
  SURVIVAL_SKILLS: 8,
  SURVIVAL_TOOLS: 9,
  SURVIVAL_WC: 10,
  SURVIVAL_FM: 11,
  SURVIVAL_COOK: 12,
  SURVIVAL_GATE: 13,
  CHEF_DOOR: 14,
  CHEF_TALK: 15,
  CHEF_DOUGH: 16,
  CHEF_BREAD: 17,
  CHEF_EXIT: 18,
  QUEST_DOOR: 19,
  QUEST_TALK: 20,
  QUEST_LIST: 21,
  QUEST_LADDER: 22,
  MINE_TALK: 23,
  MINE_ORES: 24,
  MINE_SMELT: 25,
  MINE_HAMMER: 26,
  MINE_DAGGER: 27,
  MINE_GATE: 28,
  COMBAT_TALK: 29,
  COMBAT_WORN: 30,
  COMBAT_STATS: 31,
  COMBAT_DAGGER: 32,
  COMBAT_GEAR: 33,
  COMBAT_STYLES: 34,
  COMBAT_MELEE: 35,
  COMBAT_RANGE: 36,
  COMBAT_LADDER: 37,
  BANK_OPEN: 38,
  POLL_VIEW: 39,
  ACCOUNT_TALK: 40,
  ACCOUNT_MGMT: 41,
  ACCOUNT_EXIT: 42,
  PRAYER_TALK: 43,
  PRAYER_TAB: 44,
  PRAYER_EXIT: 45,
  IRONMAN: 46,
  MAGIC_TALK: 47,
  MAGIC_TAB: 48,
  MAGIC_RUNES: 49,
  MAGIC_CAST: 50,
  LEAVE_TALK: 51,
  HOME_TELE: 52,
  COMPLETED: 53,
});
const MAX_PROGRESS = STAGE.HOME_TELE;

/** Tutorial Island start tile (Gielinor Guide room) and mainland destination. */
const TUTORIAL_SPAWN = Object.freeze({ x: 3094, y: 3104, z: 0 });

/** Cache "Tutorial Island Progress" overlay (group 649) and its progress varp. */
const OVERLAY_GROUP = 649;
const PROGRESS_VARP = 2687;
const OVERLAY_HINT_LAYER = (OVERLAY_GROUP << 16) | 4;
const OVERLAY_HINT_LINES = [8, 9, 10, 11].map((child) => (OVERLAY_GROUP << 16) | child);
const OVERLAY_TITLE = (OVERLAY_GROUP << 16) | 18;
/**
 * Clientscript 3389 sizes the fill from `scale(varp, 20, 16384)`, so the varp is
 * a 0..20 value; keep the divisor in sync with the script's constant.
 */
const PROGRESS_VARP_MAX = 20;

/** WelcomeScreen.plugin.js Play button; clicking it re-bootstraps the gameframe. */
const WELCOME_PLAY_BUTTON_UID = (378 << 16) | 72;

/** Gameframe toplevel (161) side-tab plumbing. */
const GAMEFRAME_ROOT = 161;
/**
 * Toplevel host for the progress overlay. 161:8 (OVERLAY_HUD) is the container
 * the minigame HUDs already mount persistent overlays into, so the client is
 * known to render sub-interfaces there.
 */
const OVERLAY_HOST_UID = (GAMEFRAME_ROOT << 16) | 8;
/** Tab index -> standard 161 content child/group, in the same order as the client gameframe. */
const TAB_CONTENT_CHILD = (tab) => (GAMEFRAME_ROOT << 16) | (76 + tab);
const TAB_GROUP = [593, 320, 629, 149, 387, 541, 218, 7, 109, 429, 182, 116, 216, 239];
const TAB_COUNT = 14;
const ALL_TABS = new Set(Array.from({ length: TAB_COUNT }, (_, i) => i));
/** Cache varbit read by `toplevel_flashicon` (script 913); tab+1, 0 = none. */
const VARBIT_FLASHSIDE = 3756;

/** Side tab each tutorial stage should flash, by the stage whose guidance asks for it. */
// rsmod's applyUiFlash pairs, limited to stages where unlockedTabs() already shows the tab.
const FLASH_TAB = Object.freeze({
  [STAGE.GIELINOR_SETTINGS]: 11,
  [STAGE.SURVIVAL_INV]: 3,
  [STAGE.SURVIVAL_SKILLS]: 1,
  [STAGE.QUEST_TALK]: 2,
  [STAGE.QUEST_LIST]: 2,
  [STAGE.COMBAT_TALK]: 4,
  [STAGE.COMBAT_WORN]: 4,
  [STAGE.COMBAT_STYLES]: 0,
  [STAGE.ACCOUNT_TALK]: 8,
  [STAGE.ACCOUNT_MGMT]: 8,
  [STAGE.PRAYER_TALK]: 5,
  [STAGE.PRAYER_TAB]: 5,
  [STAGE.MAGIC_TALK]: 6,
  [STAGE.MAGIC_TAB]: 6,
});

/**
 * Hint text shown on the overlay while each stage is active. Lifted from
 * rsmod's TutorialStep guide strings (title + body), not from the wiki
 * transcript, because the overlay needs them pre-split.
 */
const GUIDE = Object.freeze({
  [STAGE.GIELINOR_TALK]: {
    title: "Getting started",
    body: "When you're ready to get started, click on the Gielinor Guide. He is indicated by a flashing yellow arrow.",
  },
  [STAGE.GIELINOR_SETTINGS]: {
    title: "Settings menu",
    body: "Please click on the flashing spanner icon found on the bottom right of your screen. This will display your settings menu.",
  },
  [STAGE.GIELINOR_DOOR]: {
    title: "Moving on",
    body: "It's time to meet your first instructor. To continue, all you need to do is click on the door. It's indicated by a flashing yellow arrow.",
  },
  [STAGE.SURVIVAL_TALK]: {
    title: "You've been given an item",
    body: "To view the item you've been given, you'll need to open your inventory. To do so, click on the flashing backpack icon to the right hand side of your screen.",
  },
  [STAGE.SURVIVAL_INV]: {
    title: "Inventory",
    body: "This is your inventory. You can view all of your items here, including the net you've just been given. Let's use it to catch some shrimp.",
  },
  [STAGE.SURVIVAL_FISH]: {
    title: "Fishing",
    body: "There's some shrimp in this pond. Click on a fishing spot to catch some.",
  },
  [STAGE.SURVIVAL_SKILLS]: {
    title: "You've gained some experience",
    body: "Click on the flashing bar graph icon near the inventory button to see your skills menu.",
  },
  [STAGE.SURVIVAL_TOOLS]: {
    title: "Skills",
    body: "On this menu you can view your skills. Speak to the survival expert to continue.",
  },
  [STAGE.SURVIVAL_WC]: {
    title: "Woodcutting",
    body: "It's time to cook your shrimp. However, you require a fire to do that which means you need some logs. Give it a go by clicking on one of the trees in the area.",
  },
  [STAGE.SURVIVAL_FM]: {
    title: "Firemaking",
    body: "Now that you have some logs, it's time to light a fire. First, click on the tinderbox in your inventory. Then, with the tinderbox highlighted, click on the logs.",
  },
  [STAGE.SURVIVAL_COOK]: {
    title: "Cooking",
    body: "Now it's time to get cooking. To do so, click on the shrimp in your inventory. Then, with the shrimp highlighted, click on a fire to cook them.",
  },
  [STAGE.SURVIVAL_GATE]: {
    title: "Moving on",
    body: "Well done! Speak to the survival expert if you want a recap, otherwise you can move on. Click on the gate shown and follow the path.",
  },
  [STAGE.CHEF_DOOR]: {
    title: "Cooking",
    body: "Talk to learn the more advanced aspects of Cooking such as combining ingredients!",
  },
  [STAGE.CHEF_TALK]: {
    title: "Making dough",
    body: "To make dough you must mix flour with water. Click on the flour in your inventory, then click on the water to combine them into dough.",
  },
  [STAGE.CHEF_DOUGH]: {
    title: "Making dough",
    body: "To make dough you must mix flour with water. Click on the flour in your inventory, then click on the water to combine them into dough.",
  },
  [STAGE.CHEF_BREAD]: {
    title: "Cooking dough",
    body: "Now you have made the dough, you can bake it into some bread. To do so, just click on the indicated range.",
  },
  [STAGE.CHEF_EXIT]: {
    title: "Fancy a run?",
    body: "When navigating the world, you can either run or walk. You can use the flashing orb next to the minimap to toggle running.",
  },
  [STAGE.QUEST_DOOR]: {
    title: "Quests",
    body: "It's time to learn about quests! Just talk to the Quest Guide to get started.",
  },
  [STAGE.QUEST_TALK]: {
    title: "Quest journal",
    body: "Click on the flashing icon to the left of your inventory.",
  },
  [STAGE.QUEST_LIST]: {
    title: "Quest journal",
    body: "This is your quest journal. It lists every quest in the game. Talk to the Quest Guide when you are ready.",
  },
  [STAGE.QUEST_LADDER]: {
    title: "Moving on",
    body: "It's time to enter some caves. Click on the ladder to go down to the next area.",
  },
  [STAGE.MINE_TALK]: {
    title: "Mining and Smithing",
    body: "Let's get you a weapon. Speak to the mining instructor.",
  },
  [STAGE.MINE_ORES]: {
    title: "Mining",
    body: "To mine a rock, all you need to do is click on it. First up, try mining some tin.",
  },
  [STAGE.MINE_SMELT]: {
    title: "Smelting",
    body: "You now have some tin ore and some copper ore. You can smelt these into a bronze bar. Click on the indicated furnace.",
  },
  [STAGE.MINE_HAMMER]: {
    title: "Smithing a dagger",
    body: "You need a hammer to work the metal. Talk to the mining instructor.",
  },
  [STAGE.MINE_DAGGER]: {
    title: "Smithing a dagger",
    body: "To smith you'll need a hammer and enough metal bars. Click on the anvil, or alternatively use the bar on it.",
  },
  [STAGE.MINE_GATE]: {
    title: "Combat",
    body: "In this area you will find out about melee and ranged combat. Speak to the guide and he will tell you all about it.",
  },
  [STAGE.COMBAT_TALK]: {
    title: "Equipping items",
    body: "You now have access to a new interface. Click on the flashing icon of a man, the one to the right of your backpack icon.",
  },
  [STAGE.COMBAT_WORN]: {
    title: "Equipping items",
    body: "Click on the flashing icon of a man, the one to the right of your backpack icon.",
  },
  [STAGE.COMBAT_STATS]: {
    title: "Equipment stats",
    body: "In the bottom left corner, you will notice a flashing button. Click on it now.",
  },
  [STAGE.COMBAT_DAGGER]: {
    title: "Equipping items",
    body: "Let's add something. Click your bronze dagger to equip it.",
  },
  [STAGE.COMBAT_GEAR]: {
    title: "Equipping items",
    body: "Try swapping your dagger for the sword and shield that the combat instructor gave you.",
  },
  [STAGE.COMBAT_STYLES]: {
    title: "Combat interface",
    body: "Click on the flashing crossed swords icon to open the combat interface.",
  },
  [STAGE.COMBAT_MELEE]: {
    title: "Attacking",
    body: "It's time to slay some rats! To attack a rat, all you have to do is click on it.",
  },
  [STAGE.COMBAT_RANGE]: {
    title: "Rat ranging",
    body: "Equip the shortbow and arrows, then try killing another rat. You don't need to enter the pen this time.",
  },
  [STAGE.COMBAT_LADDER]: {
    title: "Moving on",
    body: "You have completed the tasks here. To move on, click on the indicated ladder.",
  },
  [STAGE.BANK_OPEN]: {
    title: "Banking",
    body: "This is the Bank of Gielinor. To open your bank, just click on the indicated booth.",
  },
  [STAGE.POLL_VIEW]: {
    title: "Moving on",
    body: "Close the bank, then head through the next door.",
  },
  [STAGE.ACCOUNT_TALK]: {
    title: "Account Management",
    body: "The guide here will tell you all about your account. Just click on him to talk.",
  },
  [STAGE.ACCOUNT_MGMT]: {
    title: "Account Management",
    body: "Click on the flashing icon to open your Account Management menu.",
  },
  [STAGE.ACCOUNT_EXIT]: {
    title: "Moving on",
    body: "Continue through the next door.",
  },
  [STAGE.PRAYER_TALK]: {
    title: "Prayer menu",
    body: "Click on the flashing icon to open the Prayer menu.",
  },
  [STAGE.PRAYER_TAB]: {
    title: "Prayer menu",
    body: "Click on the flashing icon to open the Prayer menu.",
  },
  [STAGE.PRAYER_EXIT]: {
    title: "Your final instructor!",
    body: "You're almost finished on tutorial island. Pass through the door to find the path leading to your final instructor.",
  },
  [STAGE.IRONMAN]: {
    title: "Your final instructor!",
    body: "Pass through the door to find the path leading to your final instructor.",
  },
  [STAGE.MAGIC_TALK]: {
    title: "Open up your final menu",
    body: "Open up the magic interface by clicking on the flashing icon.",
  },
  [STAGE.MAGIC_TAB]: {
    title: "Open up your final menu",
    body: "Open up the magic interface by clicking on the flashing icon.",
  },
  [STAGE.MAGIC_RUNES]: {
    title: "Magic casting",
    body: "Look for the Wind Strike spell in your magic interface. Click on this spell to select it and then click on a chicken to cast it.",
  },
  [STAGE.MAGIC_CAST]: {
    title: "Magic casting",
    body: "Look for the Wind Strike spell in your magic interface. Click on this spell to select it and then click on a chicken to cast it.",
  },
  [STAGE.LEAVE_TALK]: {
    title: "To the mainland!",
    body: "You're nearly finished with the tutorial. Speak with the magic instructor, then use your home teleport spell to teleport to Lumbridge!",
  },
  [STAGE.HOME_TELE]: {
    title: "To the mainland!",
    body: "Speak with the magic instructor to finish and travel to Lumbridge.",
  },
  [STAGE.COMPLETED]: {
    title: "Welcome to Lumbridge!",
    body: "If you need some help, simply talk to the Lumbridge Guide.",
  },
});

/** Tutorial NPC ids, including the island's duplicate secondary ids. */
const IDS = Object.freeze({
  GIELINOR_GUIDE: [3308, 9476],
  SURVIVAL_EXPERT: [8503, 9477],
  MASTER_CHEF: [3305],
  QUEST_GUIDE: [3312, 9480],
  MINING_INSTRUCTOR: [3311, 9481],
  COMBAT_INSTRUCTOR: [3307, 9482],
  MAGIC_INSTRUCTOR: [3309, 9487],
  ACCOUNT_GUIDE: [3310],
  BROTHER_BRACE: [3319, 9485],
  IRONMAN_TUTOR: [7942, 9486],
  RAT: 3313,
  CHICKEN: 3316,
  FISHING_SPOT: 3317,
});

/** Hint-arrow targets per stage (island tiles; see the cache loc placements). */
const HINTS = Object.freeze({
  [STAGE.GIELINOR_TALK]: { x: 3094, y: 3107 },
  [STAGE.GIELINOR_SETTINGS]: { x: 3094, y: 3107 },
  [STAGE.GIELINOR_DOOR]: { x: 3098, y: 3107 },
  [STAGE.SURVIVAL_TALK]: { x: 3103, y: 3095 },
  [STAGE.SURVIVAL_INV]: { x: 3103, y: 3095 },
  [STAGE.SURVIVAL_FISH]: { x: 3101, y: 3092 },
  [STAGE.SURVIVAL_SKILLS]: { x: 3103, y: 3095 },
  // Regular tree 9730 by the Survival Expert (3092,3096 is an oak: 15 Woodcutting).
  [STAGE.SURVIVAL_WC]: { x: 3099, y: 3095 },
  [STAGE.SURVIVAL_GATE]: { x: 3089, y: 3091 },
  [STAGE.CHEF_DOOR]: { x: 3079, y: 3084 },
  [STAGE.CHEF_TALK]: { x: 3075, y: 3085 },
  [STAGE.CHEF_BREAD]: { x: 3075, y: 3081 },
  [STAGE.CHEF_EXIT]: { x: 3072, y: 3090 },
  [STAGE.QUEST_DOOR]: { x: 3086, y: 3126 },
  [STAGE.QUEST_TALK]: { x: 3085, y: 3122 },
  [STAGE.QUEST_LADDER]: { x: 3088, y: 3119 },
  [STAGE.MINE_TALK]: { x: 3081, y: 9504 },
  [STAGE.MINE_ORES]: { x: 3077, y: 9500 },
  [STAGE.MINE_SMELT]: { x: 3078, y: 9495 },
  [STAGE.MINE_DAGGER]: { x: 3083, y: 9497 },
  [STAGE.MINE_GATE]: { x: 3094, y: 9502 },
  [STAGE.COMBAT_TALK]: { x: 3106, y: 9509 },
  [STAGE.COMBAT_DAGGER]: { x: 3106, y: 9509 },
  [STAGE.COMBAT_MELEE]: { x: 3103, y: 9518 },
  [STAGE.COMBAT_RANGE]: { x: 3103, y: 9518 },
  [STAGE.COMBAT_LADDER]: { x: 3111, y: 9526 },
  [STAGE.BANK_OPEN]: { x: 3122, y: 3124 }, // usable booth 10083; 3121,3124 is the closed booth
  [STAGE.POLL_VIEW]: { x: 3125, y: 3124 }, // door 9721 into the Account Guide's room
  [STAGE.ACCOUNT_TALK]: { x: 3127, y: 3124 },
  [STAGE.ACCOUNT_EXIT]: { x: 3130, y: 3124 }, // door 9722 out of the account guide's room
  [STAGE.PRAYER_TALK]: { x: 3125, y: 3106 },
  [STAGE.PRAYER_EXIT]: { x: 3122, y: 3102 },
  [STAGE.MAGIC_TALK]: { x: 3141, y: 3088 },
  [STAGE.MAGIC_RUNES]: { x: 3138, y: 3093 },
  [STAGE.LEAVE_TALK]: { x: 3141, y: 3088 },
});

/** Air and mind runes the Magic Instructor tops you up to (5 ran out before the chicken died). */
const TUTORIAL_RUNES = 25;

/** Tutorial mine rocks (cache loc placements) for the MINE_ORES arrow: tin first, then copper. */
const TIN_ROCK_TILES = [[3073, 9504], [3073, 9505], [3073, 9506], [3073, 9507], [3074, 9502], [3074, 9503], [3075, 9501], [3075, 9502], [3075, 9504], [3075, 9505], [3075, 9506], [3075, 9508], [3076, 9504], [3076, 9506], [3076, 9509], [3077, 9503], [3077, 9504], [3077, 9509]];
const COPPER_ROCK_TILES = [[3083, 9501], [3084, 9500], [3085, 9498], [3085, 9499], [3085, 9500], [3085, 9501], [3085, 9503], [3086, 9498], [3086, 9499], [3086, 9501], [3087, 9502], [3087, 9503], [3088, 9498], [3088, 9499], [3088, 9501], [3088, 9502], [3089, 9499], [3090, 9501], [3091, 9500], [3091, 9501]];

/**
 * Stages whose target is an NPC. NPC hints follow the actor (like the Kalphite
 * Queen head icon) instead of staying on a fixed tile.
 */
const HINT_NPC = Object.freeze({
  [STAGE.GIELINOR_TALK]: 3308,
  [STAGE.GIELINOR_SETTINGS]: 3308,
  [STAGE.SURVIVAL_TALK]: 8503,
  [STAGE.SURVIVAL_INV]: 8503,
  [STAGE.SURVIVAL_FISH]: 3317,
  [STAGE.SURVIVAL_SKILLS]: 8503,
  [STAGE.SURVIVAL_TOOLS]: 8503,
  [STAGE.CHEF_TALK]: 3305,
  [STAGE.CHEF_DOUGH]: 3305,
  [STAGE.QUEST_TALK]: 3312,
  [STAGE.QUEST_LIST]: 3312,
  [STAGE.MINE_TALK]: 3311,
  [STAGE.MINE_HAMMER]: 3311,
  [STAGE.COMBAT_TALK]: 3307,
  [STAGE.COMBAT_WORN]: 3307,
  [STAGE.COMBAT_DAGGER]: 3307,
  [STAGE.COMBAT_GEAR]: 3307,
  [STAGE.COMBAT_STYLES]: 3307,
  [STAGE.COMBAT_MELEE]: 3313,
  [STAGE.COMBAT_RANGE]: 3313,
  [STAGE.ACCOUNT_TALK]: 3310,
  [STAGE.ACCOUNT_MGMT]: 3310,
  [STAGE.PRAYER_TALK]: 3319,
  [STAGE.PRAYER_TAB]: 3319,
  [STAGE.IRONMAN]: 3309, // "Your final instructor!" - path to the magic instructor
  [STAGE.MAGIC_TALK]: 3309,
  [STAGE.MAGIC_TAB]: 3309,
  [STAGE.MAGIC_RUNES]: 3316, // "Magic casting": cast Wind Strike on a chicken
  [STAGE.MAGIC_CAST]: 3316,
  [STAGE.LEAVE_TALK]: 3309,
});

let pluginApi;
let Items, Objects, Location, World, PlayerRights, Server, PluginManager, GameConstants;
let npcSet, gielinor, survival, chef, quest, mining, combat, magic, account, prayer;
let treeIds, doorIds, cageIds, ladderIds;

function initialize(api) {
  pluginApi = api;
  ({
    ItemIdentifiers: Items,
    ObjectIdentifiers: Objects,
    Location,
    World,
    PlayerRights,
    Server,
    PluginManager,
    GameConstants,
  } = api.core);
  npcSet = new Set(
    Object.values(IDS).filter((value) => Array.isArray(value)).flat()
  );
  gielinor = new Set(IDS.GIELINOR_GUIDE);
  survival = new Set(IDS.SURVIVAL_EXPERT);
  chef = new Set(IDS.MASTER_CHEF);
  quest = new Set(IDS.QUEST_GUIDE);
  mining = new Set(IDS.MINING_INSTRUCTOR);
  combat = new Set(IDS.COMBAT_INSTRUCTOR);
  magic = new Set(IDS.MAGIC_INSTRUCTOR);
  account = new Set(IDS.ACCOUNT_GUIDE);
  prayer = new Set(IDS.BROTHER_BRACE);

  treeIds = new Set([Objects.TREE_46, Objects.TREE_47, Objects.TREE_49]);
  // Doors/gates the Doors plugin opens in place (stage advances on door:toggle below).
  doorIds = new Set([
    Objects.DOOR_223, // 9398 start house exit
    Objects.DOOR_225, // 9709 master chef door
    Objects.DOOR_226, // 9710 master chef exit
    Objects.DOOR_227, // 9716 quest guide door
    Objects.DOOR_228, // 9721
    Objects.DOOR_229, // 9722
    Objects.DOOR_230, // 9723
    Objects.DOOR_24, // 1535
    Objects.GATE_92, // 9717 mining exit (double gate)
    Objects.GATE_93, // 9718 mining exit (double gate)
    Objects.GATE_90, // 9470 survival gate (wooden gate)
    Objects.GATE_91, // 9708 survival gate (wooden gate)
  ]);
  cageIds = new Set([Objects.GATE_94, Objects.GATE_95]); // 9719, 9720
  ladderIds = new Set([
    Objects.LADDER_87, // 9725 mine up
    Objects.LADDER_88, // 9726 quest down
    Objects.LADDER_89, // 9727 combat up
    Objects.LADDER_90, // 9728 surface down
  ]);
}

const overlayShown = new WeakSet();
const openTabs = new WeakMap();

function stage(player) {
  const value = Number(player.getAttribute(STAGE_ATTR));
  return Number.isFinite(value) ? value | 0 : -1;
}

function isActive(player) {
  const value = stage(player);
  return value >= STAGE.GIELINOR_TALK && value < STAGE.COMPLETED;
}

function setStage(player, value) {
  player.setAttribute(STAGE_ATTR, value | 0);
  updateProgress(player, value | 0);
  applyHint(player, value | 0);
  // Mount newly unlocked tabs before flashing them (same order as applyTutorialUi).
  syncTabs(player, value | 0);
  applyFlash(player, value | 0);
}

function advance(player, value) {
  if (!isActive(player)) return;
  if (stage(player) >= value) {
    updateProgress(player, stage(player));
    return;
  }
  setStage(player, value);
}

function inTutorial(position) {
  if (!position) return false;
  const x = position.x ?? position.getX?.();
  const y = position.y ?? position.getY?.();
  const z = position.z ?? position.getZ?.() ?? 0;
  if ((z | 0) !== 0) return false;
  if (x < 3060 || x > 3165) return false;
  return (y >= 3060 && y <= 3165) || (y >= 9400 && y <= 9620);
}

function atTutorial(player) {
  return inTutorial(player.getLocation());
}

function progressFraction(value) {
  const ratio = Math.max(0, Math.min(1, value / MAX_PROGRESS));
  return Math.round(ratio * PROGRESS_VARP_MAX);
}

function updateProgress(player, value) {
  try {
    const sender = player.getPacketSender();
    sender.sendConfig(PROGRESS_VARP, progressFraction(value));
    const guide = GUIDE[value];
    if (guide) {
      // The four slots are single 30px lines (y 6/24/50/68, text centred). A wrapped
      // body in slot 2 spills over the title, so centre it in slot 3 (y=65) where
      // up to five lines fit below the title.
      const lines = [guide.title, "", guide.body, ""];
      for (let i = 0; i < OVERLAY_HINT_LINES.length; i++) {
        sender.sendString(lines[i], OVERLAY_HINT_LINES[i]);
      }
      sender.sendString("Tutorial Island Progress", OVERLAY_TITLE);
    }
  } catch {
    /* overlay is best-effort; never block progression on it */
  }
}

function showOverlay(player) {
  try {
    const sender = player.getPacketSender();
    // The reference client only mounts interfaces via the sub-interface packet,
    // so host the progress overlay in the toplevel HUD container.
    sender.sendSubInterface(OVERLAY_HOST_UID, OVERLAY_GROUP, 1);
    sender.sendInterfaceDisplayState(OVERLAY_HINT_LAYER, false);
    updateProgress(player, Math.max(STAGE.GIELINOR_TALK, stage(player)));
  } catch {
    /* ignore */
  }
}

function hideOverlay(player) {
  try {
    player.getPacketSender().closeSubInterface(OVERLAY_HOST_UID);
  } catch {
    /* ignore */
  }
}

/** Nearest living NPC of this id to `player` (any match when no player is given). */
function findNpc(npcId, player) {
  const from = player?.getLocation?.();
  let found = null;
  let best = Infinity;
  World.getNpcs().forEach((npc) => {
    if (!npc || npc.getId?.() !== npcId || npc.getHitpoints?.() <= 0) return;
    const at = npc.getLocation?.();
    const dist = from && at && at.getZ() === from.getZ()
      ? Math.max(Math.abs(at.getX() - from.getX()), Math.abs(at.getY() - from.getY()))
      : Infinity;
    if (!found || dist < best) {
      found = npc;
      best = dist;
    }
  });
  return found;
}

/** Native flashing yellow hint arrow above the stage's target. */
function applyHint(player, value) {
  try {
    const sender = player.getPacketSender();
    sender.sendEntityHintRemoval(false);
    // Mining: point at the nearest tin rock, then (with tin in hand) a copper rock.
    if (value === STAGE.MINE_ORES) {
      const rocks = !hasItem(player, Items.TIN_ORE)
        ? TIN_ROCK_TILES
        : !hasItem(player, Items.COPPER_ORE) ? COPPER_ROCK_TILES : null;
      if (rocks) {
        const at = player.getLocation();
        const [x, y] = rocks.reduce((best, tile) =>
          Math.hypot(tile[0] - at.getX(), tile[1] - at.getY()) <
          Math.hypot(best[0] - at.getX(), best[1] - at.getY()) ? tile : best);
        sender.sendPositionalHint(new Location(x, y, 0), 2);
        return;
      }
    }
    const npcId = hintNpcIdFor(player, value);
    if (npcId !== undefined) {
      const npc = findNpc(npcId, player);
      if (npc) {
        sendNpcHint(player, value, npc);
        return;
      }
    }
    const target = HINTS[value];
    if (target) {
      sender.sendPositionalHint(new Location(target.x, target.y, 0), 2, HINT_LIFT[value] ?? 0);
    }
  } catch {
    /* ignore */
  }
}

/**
 * A hint target farther than this is not in the client's local NPC list yet, so
 * an entity hint draws no arrow (and no minimap marker) until you can see the
 * NPC. Until then point at its tile; the minimap edge arrow works at any range.
 */
const HINT_FOLLOW_TILES = 14;
/** Lift (in tiles) for tile hints that sit on tall scenery, like the tutorial tree. */
const HINT_LIFT = Object.freeze({ [STAGE.SURVIVAL_WC]: 2 });
/** Player -> last NPC hint, for the per-tick close/far switch. */
const hintFollow = new WeakMap();

function hintNpcIdFor(player, value) {
  // Rat ranging needs the bow from the Combat Instructor first.
  if (value === STAGE.COMBAT_RANGE && !hasItem(player, Items.SHORTBOW)) return 3307;
  return HINT_NPC[value];
}

function isFarHint(player, npc) {
  const from = player.getLocation();
  const at = npc.getLocation();
  return from.getZ() !== at.getZ() ||
    Math.max(Math.abs(at.getX() - from.getX()), Math.abs(at.getY() - from.getY())) > HINT_FOLLOW_TILES;
}

function sendNpcHint(player, value, npc) {
  const far = isFarHint(player, npc);
  if (far) {
    player.getPacketSender().sendPositionalHint(npc.getLocation(), 2);
  } else {
    player.getPacketSender().sendEntityHint(npc);
  }
  const at = npc.getLocation();
  hintFollow.set(player, { value, far, x: at.getX(), y: at.getY(), index: npc.getIndex() });
}

/** Switch between the NPC-follow and tile hints as the player moves. */
function refreshNpcHint(player) {
  const value = stage(player);
  if (HINT_NPC[value] === undefined && value !== STAGE.COMBAT_RANGE) return;
  const state = hintFollow.get(player);
  const npc = state ? World.getNpcs().get(state.index) : null;
  if (!state || state.value !== value || !npc || npc.getHitpoints?.() <= 0) {
    applyHint(player, value);
    return;
  }
  const far = isFarHint(player, npc);
  const at = npc.getLocation();
  if (state.far !== far || (far && (state.x !== at.getX() || state.y !== at.getY()))) {
    player.getPacketSender().sendEntityHintRemoval(false);
    sendNpcHint(player, value, npc);
  }
}

/** Side tabs unlocked by the time the player reaches `value`. */
function unlockedTabs(value) {
  // Everything is blanked at the start; only logout stays reachable.
  const set = new Set([10]);
  if (value >= STAGE.GIELINOR_SETTINGS) set.add(11);
  if (value >= STAGE.SURVIVAL_INV) set.add(3);
  if (value >= STAGE.SURVIVAL_SKILLS) set.add(1);
  if (value >= STAGE.QUEST_TALK) set.add(2);
  if (value >= STAGE.COMBAT_TALK) set.add(4);
  if (value >= STAGE.COMBAT_STYLES) set.add(0);
  if (value >= STAGE.ACCOUNT_TALK) set.add(8);
  if (value >= STAGE.PRAYER_TALK) set.add(5);
  if (value >= STAGE.MAGIC_TALK) set.add(6);
  if (value >= STAGE.COMPLETED) for (const tab of ALL_TABS) set.add(tab);
  return set;
}

/**
 * Hide the side icons the player has not unlocked yet by unmounting their tab
 * content; the gameframe's own `toplevel_sidebuttons_enable` then hides the
 * icon. [openTabs] is seeded on the first world tick (after the gameframe
 * bootstrap mounted every tab).
 */
function syncTabs(player, value) {
  const tracked = openTabs.get(player);
  if (!tracked) return;
  const unlocked = unlockedTabs(value);
  const sender = player.getPacketSender();
  for (let tab = 0; tab < TAB_COUNT; tab++) {
    const uid = TAB_CONTENT_CHILD(tab);
    const desired = unlocked.has(tab);
    const current = tracked.has(tab);
    if (desired && !current) {
      sender.sendSubInterface(uid, TAB_GROUP[tab], 1);
      tracked.add(tab);
    } else if (!desired && current) {
      sender.closeSubInterface(uid);
      tracked.delete(tab);
    }
  }
}

function applyFlash(player, value) {
  const tab = FLASH_TAB[value];
  // varp 4922 gates the gameframe's onVarTransmit flash setup (script 902 -> 907).
  player
    .getPacketSender()
    .sendConfig(4922, 1)
    .sendVarbit(VARBIT_FLASHSIDE, tab === undefined ? 0 : tab + 1);
}

function hasItem(player, itemId) {
  return (
    player.getInventory().getAmount(itemId) > 0 ||
    player.getEquipment().getAmount(itemId) > 0
  );
}

function worn(player, itemId) {
  return player.getEquipment().getAmount(itemId) > 0;
}

function addArrows(inv, target) {
  const have = inv.getAmount(Items.BRONZE_ARROW);
  const amount = Math.max(0, Math.min(target, target - have));
  if (amount > 0) inv.adds(Items.BRONZE_ARROW, amount);
}

/** Grants the item(s) named by a transcript "receive" action. */
function grantNamed(player, text) {
  const value = String(text ?? "").toLowerCase();
  const inv = player.getInventory();
  if (!value) return;
  if (value.includes("small fishing net")) {
    inv.adds(Items.SMALL_FISHING_NET, 1);
  } else if (value.includes("pot of flour and a bucket of water")) {
    inv.adds(Items.POT_OF_FLOUR, 1);
    inv.adds(Items.BUCKET_OF_WATER, 1);
  } else if (value.includes("bucket of water")) {
    inv.adds(Items.BUCKET_OF_WATER, 1);
  } else if (value.includes("a pot of flour")) {
    inv.adds(Items.POT_OF_FLOUR, 1);
  } else if (value.includes("bronze pickaxe")) {
    inv.adds(Items.BRONZE_PICKAXE, 1);
  } else if (value.includes("hammer")) {
    if (inv.getAmount(Items.HAMMER) <= 0) inv.adds(Items.HAMMER, 1);
  } else if (value.includes("bronze sword and a wooden shield")) {
    inv.adds(Items.BRONZE_SWORD, 1);
    inv.adds(Items.WOODEN_SHIELD, 1);
  } else if (value.includes("wooden shield")) {
    inv.adds(Items.WOODEN_SHIELD, 1);
  } else if (value.includes("bronze sword")) {
    inv.adds(Items.BRONZE_SWORD, 1);
  } else if (value.includes("shortbow") && value.includes("arrows")) {
    if (inv.getAmount(Items.SHORTBOW) <= 0) inv.adds(Items.SHORTBOW, 1);
    if (stage(player) === STAGE.COMBAT_RANGE) applyHint(player, STAGE.COMBAT_RANGE);
    addArrows(inv, 50);
  } else if (value.includes("shortbow")) {
    if (inv.getAmount(Items.SHORTBOW) <= 0) inv.adds(Items.SHORTBOW, 1);
    if (stage(player) === STAGE.COMBAT_RANGE) applyHint(player, STAGE.COMBAT_RANGE);
  } else if (value.includes("arrows")) {
    addArrows(inv, 50);
  } else if (value.includes("air and mind runes") || value.includes("air runes and mind runes")) {
    // Top up rather than add: the first talk has both a receive step and the
    // "gives you some air runes and mind runes" message.
    for (const rune of [Items.AIR_RUNE, Items.MIND_RUNE]) {
      const missing = TUTORIAL_RUNES - inv.getAmount(rune);
      if (missing > 0) inv.adds(rune, missing);
    }
  } else if (value.includes("bronze axe") && value.includes("tinderbox")) {
    inv.adds(Items.BRONZE_AXE, 1);
    inv.adds(Items.TINDERBOX, 1);
  }
}

function variantFor(player, npcId) {
  if (!isActive(player)) return null;
  const current = stage(player);

  if (gielinor.has(npcId)) {
    if (current <= STAGE.GIELINOR_TALK) {
      setStage(player, STAGE.GIELINOR_SETTINGS);
      return "gielinor-guide";
    }
    if (current === STAGE.GIELINOR_SETTINGS) {
      setStage(player, STAGE.GIELINOR_DOOR);
      return "gielinor-guide-after-opening-settings-menu";
    }
    return "gielinor-guide-talking-to-the-gielinor-guide-again";
  }

  if (survival.has(npcId)) {
    if (current <= STAGE.SURVIVAL_TALK) {
      setStage(player, STAGE.SURVIVAL_INV);
      return "survival-expert-talking-to-the-survival-expert";
    }
    if (current <= STAGE.SURVIVAL_FISH) {
      setStage(player, STAGE.SURVIVAL_FISH);
      return "survival-expert-before-fishing";
    }
    if (current === STAGE.SURVIVAL_SKILLS) {
      setStage(player, STAGE.SURVIVAL_TOOLS);
      return "survival-expert-before-opening-skills-menu";
    }
    if (current === STAGE.SURVIVAL_TOOLS) {
      setStage(player, STAGE.SURVIVAL_WC);
      return "survival-expert-after-fishing";
    }
    if (current === STAGE.SURVIVAL_WC) {
      return "survival-expert-before-cutting-a-tree";
    }
    if (current === STAGE.SURVIVAL_FM) {
      return "survival-expert-before-lighting-a-fire";
    }
    if (current === STAGE.SURVIVAL_COOK) {
      return "survival-expert-before-cooking-the-shrimp";
    }
    return "survival-expert-speaking-to-the-survival-expert-again";
  }

  if (chef.has(npcId)) {
    if (current <= STAGE.CHEF_TALK) {
      setStage(player, STAGE.CHEF_DOUGH);
      return "master-chef-talking-to-the-master-chef";
    }
    if (current === STAGE.CHEF_DOUGH) {
      return "master-chef-talking-to-the-master-chef-before-cooking-the-dough";
    }
    return "master-chef-talking-to-the-master-chef-again";
  }

  if (quest.has(npcId)) {
    if (current <= STAGE.QUEST_TALK) {
      setStage(player, STAGE.QUEST_LIST);
      return "quest-guide-talking-to-the-quest-guide";
    }
    if (current === STAGE.QUEST_LIST) {
      setStage(player, STAGE.QUEST_LADDER);
      return "quest-guide-talking-to-the-quest-guide-after-viewing-the-quest-journal";
    }
    return "quest-guide-talking-to-the-quest-guide-again";
  }

  if (mining.has(npcId)) {
    if (current <= STAGE.MINE_TALK) {
      setStage(player, STAGE.MINE_ORES);
      return "mining-instructor-talking-to-the-mining-instructor";
    }
    if (current === STAGE.MINE_ORES) {
      return "mining-instructor-before-obtaining-both-ores";
    }
    if (current === STAGE.MINE_SMELT) {
      return "mining-instructor-after-obtaining-both-ores";
    }
    if (current === STAGE.MINE_HAMMER) {
      setStage(player, STAGE.MINE_DAGGER);
      return "mining-instructor-talking-to-the-mining-instructor-after-smelting-a-bronze-bar";
    }
    if (current === STAGE.MINE_DAGGER) {
      return "mining-instructor-before-making-the-dagger";
    }
    return "mining-instructor-talking-to-the-mining-instructor-again";
  }

  if (combat.has(npcId)) {
    if (current <= STAGE.COMBAT_TALK) {
      setStage(player, STAGE.COMBAT_WORN);
      return "combat-instructor-talking-to-the-combat-instructor";
    }
    if (current <= STAGE.COMBAT_DAGGER) {
      setStage(player, STAGE.COMBAT_DAGGER);
      return "combat-instructor-talking-to-the-combat-instructor-before-equipping-a-weapon";
    }
    if (current === STAGE.COMBAT_GEAR) {
      return "combat-instructor-talking-to-the-combat-instructor-after-equipping-a-bronze-dagger";
    }
    if (current === STAGE.COMBAT_STYLES) {
      setStage(player, STAGE.COMBAT_MELEE);
      return "combat-instructor-talking-to-the-combat-instructor-before-opening-the-combat-interface";
    }
    if (current === STAGE.COMBAT_MELEE) {
      return "combat-instructor-talking-to-the-combat-instructor-before-killing-a-giant-rat";
    }
    if (current === STAGE.COMBAT_RANGE) {
      if (!hasItem(player, Items.SHORTBOW)) {
        return "combat-instructor-talking-to-the-combat-instructor-after-killing-the-first-giant-rat";
      }
      return "combat-instructor-talking-to-the-combat-instructor-before-killing-the-second-giant-rat";
    }
    return "combat-instructor-talking-to-the-combat-instructor-again";
  }

  if (account.has(npcId)) {
    if (current <= STAGE.ACCOUNT_TALK) {
      setStage(player, STAGE.ACCOUNT_MGMT);
      return "banking-tutorial-talking-to-the-account-guide";
    }
    if (current === STAGE.ACCOUNT_MGMT) {
      setStage(player, STAGE.ACCOUNT_EXIT);
      return "banking-tutorial-talking-to-the-account-guide-after-opening-the-account-management-menu";
    }
    return "banking-tutorial-talking-to-the-account-guide-again";
  }

  if (prayer.has(npcId)) {
    if (current <= STAGE.PRAYER_TALK) {
      setStage(player, STAGE.PRAYER_TAB);
      return "prayer-tutorial-talking-to-brother-brace";
    }
    if (current === STAGE.PRAYER_TAB) {
      setStage(player, STAGE.PRAYER_EXIT);
      return "prayer-tutorial-talking-to-brother-brace-after-opening-the-prayer-menu";
    }
    return "prayer-tutorial-talking-to-brother-brace-again";
  }

  if (magic.has(npcId)) {
    if (current <= STAGE.MAGIC_TALK) {
      setStage(player, STAGE.MAGIC_TAB);
      return "magic-instructor-talking-to-the-magic-instructor";
    }
    if (current === STAGE.MAGIC_TAB) {
      setStage(player, STAGE.MAGIC_RUNES);
      return "magic-instructor-talking-to-the-magic-instructor-after-opening-the-magic-interface";
    }
    if (current < STAGE.LEAVE_TALK) {
      return "magic-instructor-talking-to-the-magic-instructor-before-casting-air-strike";
    }
    return "after-casting-wind-strike";
  }

  return null;
}

function hasFlour(player) {
  return player.getInventory().getAmount(Items.POT_OF_FLOUR) > 0;
}

function hasWater(player) {
  return player.getInventory().getAmount(Items.BUCKET_OF_WATER) > 0;
}

function freeSpace(player) {
  return player.getInventory().getFreeSlots();
}

function answerCondition(player, npcId, text) {
  if (!npcSet.has(npcId) || !isActive(player)) return null;
  const value = String(text ?? "").toLowerCase();

  if (value.includes("playing on desktop")) return true;
  if (value.includes("playing on mobile") || value.includes("plying on mobile")) return false;

  if (
    value.includes("successfully cooked") ||
    value.includes("successfully cooks") ||
    value.includes("player is successful")
  ) {
    return true;
  }
  if (value.includes("shrimp burned") || value.includes("burns the bread")) return false;

  if (value.includes("neither flour nor water")) return !hasFlour(player) && !hasWater(player);
  if (value.includes("only has flour")) return hasFlour(player) && !hasWater(player);
  if (value.includes("only has water")) return !hasFlour(player) && hasWater(player);

  if (value.includes("does not have enough inventory space")) return freeSpace(player) <= 0;
  if (value.includes("not have a hammer and has inventory space")) {
    return !hasItem(player, Items.HAMMER) && freeSpace(player) > 0;
  }
  if (value.includes("not have a hammer and has no inventory space")) {
    return !hasItem(player, Items.HAMMER) && freeSpace(player) <= 0;
  }
  if (value.includes("no free inventory spaces")) return freeSpace(player) <= 0;
  // Paired with a following "exactly one free inventory space" branch, so this
  // one means *zero* free spaces, not < 2.
  if (value.includes("does not have two free inventory spaces")) return freeSpace(player) === 0;
  if (value.includes("exactly one free inventory space")) return freeSpace(player) === 1;

  if (value.includes("missing a sword or shield")) {
    return !hasItem(player, Items.BRONZE_SWORD) || !hasItem(player, Items.WOODEN_SHIELD);
  }
  if (value.includes("one free inventory space and does not have a sword or shield")) {
    return (
      freeSpace(player) === 1 &&
      !hasItem(player, Items.BRONZE_SWORD) &&
      !hasItem(player, Items.WOODEN_SHIELD)
    );
  }
  if (value.includes("one free inventory space and has a sword but not a shield")) {
    return (
      freeSpace(player) === 1 &&
      hasItem(player, Items.BRONZE_SWORD) &&
      !hasItem(player, Items.WOODEN_SHIELD)
    );
  }
  if (value.includes("one free inventory space and has a shield but not a sword")) {
    return (
      freeSpace(player) === 1 &&
      hasItem(player, Items.WOODEN_SHIELD) &&
      !hasItem(player, Items.BRONZE_SWORD)
    );
  }
  if (value.includes("two free inventory space and does not have a sword or shield")) {
    return (
      freeSpace(player) >= 2 &&
      !hasItem(player, Items.BRONZE_SWORD) &&
      !hasItem(player, Items.WOODEN_SHIELD)
    );
  }

  if (value.includes("does not have a shortbow and has less than 50 arrows")) {
    const arrows = player.getInventory().getAmount(Items.BRONZE_ARROW);
    return !hasItem(player, Items.SHORTBOW) && arrows < 50;
  }
  if (value.includes("has a shortbow but less than 50 arrows")) {
    const arrows = player.getInventory().getAmount(Items.BRONZE_ARROW);
    return hasItem(player, Items.SHORTBOW) && arrows < 50;
  }
  if (value.includes("does not have a shortbow but has 50 arrows")) {
    const arrows = player.getInventory().getAmount(Items.BRONZE_ARROW);
    return !hasItem(player, Items.SHORTBOW) && arrows >= 50;
  }

  if (value.includes("enough runes")) {
    const air = player.getInventory().getAmount(Items.AIR_RUNE);
    const mind = player.getInventory().getAmount(Items.MIND_RUNE);
    if (value.includes("doesn't have enough runes")) return !(air >= 5 && mind >= 5);
    return air >= 5 && mind >= 5;
  }

  if (value.includes("regular account")) return true;
  // Leave-dialogue branches: brand new + not Ironman is the one we take.
  if (value.includes("has not chosen to be an ironman")) return true;
  if (value.includes("has chosen to be an ironman")) return false;
  if (value.includes("is an ironman")) return false;

  if (value.includes("world that does not allow polls")) return false;
  if (value.includes("free world")) return true;
  if (value.includes("members")) return false;
  if (value.includes("poll booth before talking to the banker")) return false;

  if (value.includes("brand new") && value.includes("first time here")) return true;
  if (value.includes("played in the past") || value.includes("experienced player")) return false;

  return null;
}

function onDialogueAction(event) {
  const step = event?.step;
  if (!step || !npcSet.has(event.npcId)) return;
  // The runtime emits action steps once, but message steps twice (once plain,
  // once tagged kind:"message"); only act on the plain emit so grants are once.
  if (event.kind !== undefined) return;
  if (step.action === "receive") {
    grantNamed(event.player, event.text ?? step.text);
  } else if (step.type === "message" && typeof step.text === "string") {
    const text = step.text.toLowerCase();
    // These hand-outs are only written as messages (no receive step), e.g. the
    // Magic Instructor's "doesn't have enough runes" top-up.
    if (text.includes("bronze axe and a tinderbox") || text.includes("air runes and mind runes")) {
      grantNamed(event.player, step.text);
    }
  }
}

function onDialogueChoice(event) {
  if (!npcSet.has(event.npcId) || !isActive(event.player)) return;
  if (!magic.has(event.npcId)) return;
  if (stage(event.player) !== STAGE.LEAVE_TALK) return;
  if (event.option === "Yes.") {
    setStage(event.player, STAGE.HOME_TELE);
  }
}

function clearInventory(player) {
  const inv = player.getInventory();
  for (let slot = 0; slot < inv.capacity(); slot++) {
    const item = inv.getItems()[slot];
    if (item && item.getId() > 0) inv.deleteAtSlot(slot, item.getAmount());
  }
}

function giveLeaveKit(player) {
  clearInventory(player);
  // Arrive on the mainland with only the starter kit, like death/preset resets.
  player.getEquipment().resetItems().refreshItems();
  const inv = player.getInventory();
  const kit = [
    Items.BRONZE_AXE,
    Items.BRONZE_PICKAXE,
    Items.TINDERBOX,
    Items.SMALL_FISHING_NET,
    Items.SHRIMPS,
    Items.BRONZE_DAGGER,
    Items.BRONZE_SWORD,
    Items.WOODEN_SHIELD,
    Items.SHORTBOW,
    Items.BREAD,
  ];
  for (const item of kit) inv.adds(item, 1);
  inv.adds(Items.BRONZE_ARROW, 25);
  inv.adds(Items.AIR_RUNE, 25);
  inv.adds(Items.MIND_RUNE, 15);
  inv.adds(Items.WATER_RUNE, 6);
  inv.adds(Items.EARTH_RUNE, 4);
  inv.adds(Items.BODY_RUNE, 2);
  inv.adds(Items.BUCKET, 1);
  inv.adds(Items.POT, 1);

  const bank = player.getBank(0);
  const coins = bank.getAmount(Items.COINS);
  if (coins < 25) bank.adds(Items.COINS, 25 - coins);

  // The world's home spawn (world.json), not Lumbridge: servers choose where new players land.
  player.moveTo(GameConstants.DEFAULT_LOCATION.clone());
  setStage(player, STAGE.COMPLETED);
  hideOverlay(player);
  player.sendMessage("Welcome to Gielinor!");
}

/** Gate the trees by stage; chopping itself runs through the Woodcutting skill loop. */
function chop(player, event) {
  const current = stage(player);
  if (current < STAGE.SURVIVAL_WC) {
    player.sendMessage("You cannot cut down this tree yet. You must progress further in the tutorial.");
    event.handled = true;
  } else if (current > STAGE.SURVIVAL_GATE) {
    // LostCity tut_woodcut: trees stay open until the survival section is done, so
    // lost logs (or a fire that burned out before the shrimp) can be replaced.
    player.sendMessage("Perhaps you've done enough woodcutting now.");
    event.handled = true;
  }
}

/** Gate the rocks by stage; mining itself runs through the Mining skill loop. */
function mine(player, event) {
  if (stage(player) < STAGE.MINE_ORES || !hasItem(player, Items.BRONZE_PICKAXE)) {
    player.sendMessage("You are not ready to mine yet. Please follow the tutorial and you'll be mining in no time.");
    event.handled = true;
  }
}

/** Gate the furnace by stage; smelting itself runs through the Smithing skill. */
function smelt(player, event) {
  if (stage(player) < STAGE.MINE_SMELT) {
    player.sendMessage("This is a furnace for smelting metal. You'll learn how to use it soon.");
    event.handled = true;
  }
}

/** Gate the anvil by stage; smithing itself runs through the Smithing skill (interface 312). */
function smith(player, event) {
  const current = stage(player);
  if (current < STAGE.MINE_DAGGER) {
    player.sendMessage(
      current < STAGE.MINE_HAMMER
        ? "This is an anvil used for smithing. You'll learn how to use it soon."
        : "You need a hammer to work the metal with. Talk to the mining instructor to get one."
    );
    event.handled = true;
    return true;
  }
  if (!hasItem(player, Items.HAMMER)) {
    player.sendMessage("You need a hammer to work the metal with. Talk to the mining instructor to get one.");
    event.handled = true;
    return true;
  }
  return false;
}

/** Gate the range by stage; baking itself runs through the Cooking skill loop. */
function cookBread(player, event) {
  if (stage(player) < STAGE.CHEF_BREAD || player.getInventory().getAmount(Items.BREAD_DOUGH) <= 0) {
    player.sendMessage("You haven't got anything suitable for cooking! The master chef can help you out with that.");
    event.handled = true;
    return true;
  }
  return false;
}

function openBank(player, event) {
  if (stage(player) < STAGE.BANK_OPEN) {
    player.sendMessage("You're not ready to continue yet. You need to know about combat before you go on.");
    event.handled = true;
    return;
  }
  const bank = player.getBank(0);
  const coins = bank.getAmount(Items.COINS);
  if (coins < 25) bank.adds(Items.COINS, 25 - coins);
  advance(player, STAGE.POLL_VIEW); // "Close the bank, then head through the next door."
  /* fall through: BankBooths opens the interface for us */
}

function ladder(player, event) {
  const current = stage(player);
  switch (event.objectId) {
    case Objects.LADDER_88: // quest ladder down
      if (current < STAGE.QUEST_LADDER) {
        player.sendMessage("I don't think you're ready to go down there yet.");
      } else {
        player.moveTo(new Location(3088, 9520, 0));
        advance(player, STAGE.MINE_TALK);
      }
      break;
    case Objects.LADDER_87: // mine ladder up
      player.moveTo(new Location(3088, 3120, 0));
      break;
    case Objects.LADDER_89: // combat ladder up
      if (current < STAGE.COMBAT_LADDER) {
        player.sendMessage("You're not ready to continue yet. You need to know about combat before you go on.");
      } else {
        player.moveTo(new Location(3111, 3127, 0));
        advance(player, STAGE.BANK_OPEN);
      }
      break;
    case Objects.LADDER_90: // surface ladder down
      player.moveTo(new Location(3111, 9527, 0));
      break;
    default:
      event.handled = false;
      return;
  }
  event.handled = true;
}

/** Advances the stage a door/gate transition completes. */
function passDoor(player, location) {
  const current = stage(player);
  // Only the door/gate this stage points at completes it: re-toggling a door already
  // passed would otherwise advance the next stage too. Gates have a leaf beside the arrow.
  const target = HINTS[current];
  const x = location?.getX?.() ?? location?.x;
  const y = location?.getY?.() ?? location?.y;
  if (!target || Math.abs(x - target.x) > 1 || Math.abs(y - target.y) > 1) return;
  switch (current) {
    case STAGE.GIELINOR_DOOR:
      setStage(player, STAGE.SURVIVAL_TALK);
      break;
    case STAGE.SURVIVAL_GATE:
      setStage(player, STAGE.CHEF_DOOR);
      break;
    case STAGE.CHEF_DOOR:
      setStage(player, STAGE.CHEF_TALK);
      break;
    case STAGE.CHEF_EXIT:
      setStage(player, STAGE.QUEST_DOOR);
      break;
    case STAGE.QUEST_DOOR:
      setStage(player, STAGE.QUEST_TALK);
      break;
    case STAGE.MINE_GATE:
      setStage(player, STAGE.COMBAT_TALK);
      break;
    case STAGE.POLL_VIEW:
      setStage(player, STAGE.ACCOUNT_TALK);
      break;
    case STAGE.ACCOUNT_EXIT:
      setStage(player, STAGE.PRAYER_TALK);
      break;
    case STAGE.PRAYER_EXIT:
      setStage(player, STAGE.IRONMAN);
      break;
    default:
      break;
  }
}

function applyCage(player, event) {
  const current = stage(player);
  if (current < STAGE.COMBAT_MELEE) {
    player.sendMessage("Oi! Get away from there. Only enter the rat cage when I say so.");
    event.handled = true;
  } else if (current >= STAGE.COMBAT_RANGE && current < STAGE.COMBAT_LADDER) {
    player.sendMessage("No, don't enter the pit. Range the rats from outside the cage.");
    event.handled = true;
  }
  // Otherwise the Doors plugin swings the cage gate open.
}

function handleObject(event) {
  const player = event.player;
  if (!player || !isActive(player)) return;
  const location = event.location;
  if (!inTutorial(location)) return;
  const id = event.objectId;

  if (treeIds.has(id)) return chop(player, event);
  if (id === Objects.OAK_TREE_9) {
    player.sendMessage(
      "You won't be able to chop oak trees until you have a Woodcutting level of 15."
    );
    event.handled = true;
    return;
  }
  if (id === Objects.COPPER_ROCKS || id === Objects.TIN_ROCKS) return mine(player, event);
  if (id === Objects.FURNACE_7) return smelt(player, event);
  if (id === Objects.ANVIL_2) return smith(player, event);
  if (id === Objects.RANGE_5) return cookBread(player, event);
  if (id === Objects.BANK_BOOTH_7) return openBank(player, event);
  if (ladderIds.has(id)) return ladder(player, event);
  if (cageIds.has(id)) return applyCage(player, event);
}

/** Gate the pond until the net stage; catching itself runs through the Fishing skill loop. */
function handleFishing(event) {
  const player = event.player;
  if (!player || !isActive(player) || !inTutorial(player.getLocation())) return false;
  if (stage(player) >= STAGE.SURVIVAL_INV) return false;
  player.sendMessage("You cannot fish here yet. You must progress further in the tutorial.");
  event.handled = true;
  return true;
}

function handleCanAttack(event) {
  const attacker = event.attacker;
  const target = event.target;
  if (!attacker || !attacker.isPlayer?.() || !isActive(attacker)) return;
  const targetId = target?.getId?.();
  if (targetId === IDS.RAT) {
    const current = stage(attacker);
    if (current < STAGE.COMBAT_MELEE) {
      event.allow = false;
      attacker.sendMessage("Oi! Get away from there. Only enter the rat cage when I say so.");
    } else if (current === STAGE.COMBAT_RANGE && !worn(attacker, Items.SHORTBOW)) {
      // One melee kill only: the second rat must fall to the shortbow.
      event.allow = false;
      attacker.sendMessage("Equip the shortbow and arrows to kill a rat from a distance.");
    }
  } else if (targetId === IDS.CHICKEN) {
    const current = stage(attacker);
    if (current < STAGE.MAGIC_RUNES) {
      event.allow = false;
      attacker.sendMessage("Cast the Wind Strike spell from your spellbook to fight the chicken.");
    } else if (current >= STAGE.LEAVE_TALK) {
      event.allow = false;
      attacker.sendMessage("You've already done that. Perhaps you should move on.");
    }
  }
}

function handleNpcDeath(event) {
  const killer = event.killer;
  if (!killer || !killer.isPlayer?.() || !isActive(killer)) return;
  if (event.npcId === IDS.RAT) {
    const current = stage(killer);
    if (current === STAGE.COMBAT_MELEE) {
      killer.sendMessage("You have defeated the giant rat!");
      advance(killer, STAGE.COMBAT_RANGE);
    } else if (current === STAGE.COMBAT_RANGE) {
      killer.sendMessage("You have defeated the giant rat!");
      advance(killer, STAGE.COMBAT_LADDER);
    }
  } else if (event.npcId === IDS.CHICKEN) {
    const current = stage(killer);
    if (current >= STAGE.MAGIC_RUNES && current < STAGE.LEAVE_TALK) {
      killer.sendMessage("The chicken is defeated by your Wind Strike!");
      killer.sendMessage("Congratulations, you've completed a quest: Learning the Ropes");
      advance(killer, STAGE.LEAVE_TALK);
    }
  }
}

/** Assumes a fresh gameframe bootstrap (every tab mounted) and re-applies the tutorial HUD on top. */
function applyTutorialUi(player) {
  openTabs.set(player, new Set(ALL_TABS));
  showOverlay(player);
  syncTabs(player, stage(player));
  applyFlash(player, stage(player));
  // Relogging mid-tutorial never passes through setStage, so restore the arrow too.
  applyHint(player, stage(player));
}

function handleProcess(event) {
  const player = event.player;
  if (!player || !isActive(player)) return;
  // The login event fires before the gameframe handshake, so the overlay and
  // tab state are opened on the first world tick instead.
  if (!overlayShown.has(player)) {
    overlayShown.add(player);
    applyTutorialUi(player);
  }
  refreshNpcHint(player);
  const current = stage(player);
  if (current === STAGE.COMBAT_DAGGER && worn(player, Items.BRONZE_DAGGER)) {
    advance(player, STAGE.COMBAT_GEAR);
    return;
  }
  if (
    current === STAGE.COMBAT_GEAR &&
    worn(player, Items.BRONZE_SWORD) &&
    worn(player, Items.WOODEN_SHIELD)
  ) {
    advance(player, STAGE.COMBAT_STYLES);
    return;
  }
  if (current === STAGE.HOME_TELE) {
    const manager = player.getDialogueManager?.();
    if (manager && manager.isActive?.()) return;
    overlayShown.delete(player);
    giveLeaveKit(player);
  }
}

function handleLogin(event) {
  const player = event.player;
  if (!player || player.isPlayerBot?.() === true) return;

  if (event.isNewAccount) {
    setStage(player, STAGE.GIELINOR_TALK);
    player.moveTo(new Location(TUTORIAL_SPAWN.x, TUTORIAL_SPAWN.y, TUTORIAL_SPAWN.z));
  }
}

const STAGE_NAMES = Object.fromEntries(Object.entries(STAGE).map(([name, value]) => [value, name]));

/** ::tutnext / ::tutlast - open in dev, administrators only in production. */
function stepStage(player, delta) {
  if (Server.PRODUCTION && player.getRights().getId() < PlayerRights.ADMINISTRATOR.getId()) return false;
  if (!isActive(player)) {
    player.sendMessage("You're not doing Tutorial Island.");
    return true;
  }
  const next = Math.max(STAGE.GIELINOR_TALK, Math.min(MAX_PROGRESS, stage(player) + delta));
  setStage(player, next);
  player.sendMessage(`Tutorial stage: ${STAGE_NAMES[next]} (${next})`);
  return true;
}

function onTutNext({ player }) {
  return stepStage(player, 1);
}

function onTutLast({ player }) {
  return stepStage(player, -1);
}

// First Talk-to with the Gielinor Guide offers to skip the island. His dialogue
// advances past GIELINOR_TALK, so the offer only ever shows on that first talk.
const passedSkipOffer = new WeakSet();

function talkToGielinorGuide(event) {
  const player = event.player;
  if (passedSkipOffer.delete(player)) return false;
  if (!isActive(player) || stage(player) !== STAGE.GIELINOR_TALK) return false;
  if (pluginApi.getPluginConfig("TutorialIsland:allowSkip", true) === false) return false;
  pluginApi.sendMultiChatboxPrompt(
    player,
    "Skip tutorial island?",
    "Yes, skip", () => giveLeaveKit(player),
    "No, continue", () => {
      passedSkipOffer.add(player);
      PluginManager.emitNpcInteraction({ ...event, handled: false });
    },
  );
  return true;
}

function onWoodcuttingSuccess({ player }) {
  if (isActive(player) && stage(player) >= STAGE.SURVIVAL_WC) advance(player, STAGE.SURVIVAL_FM);
}

function onCookingSuccess({ player, itemId }) {
  if (!isActive(player)) return;
  if (itemId === Items.SHRIMPS && stage(player) >= STAGE.SURVIVAL_COOK) advance(player, STAGE.SURVIVAL_GATE);
  if (itemId === Items.BREAD && stage(player) >= STAGE.CHEF_BREAD) advance(player, STAGE.CHEF_EXIT);
}

function onMiningSuccess({ player }) {
  if (!isActive(player) || stage(player) < STAGE.MINE_ORES) return;
  const inv = player.getInventory();
  if (inv.getAmount(Items.TIN_ORE) > 0 && inv.getAmount(Items.COPPER_ORE) > 0) advance(player, STAGE.MINE_SMELT);
  else if (stage(player) === STAGE.MINE_ORES) applyHint(player, STAGE.MINE_ORES); // tin done -> copper
}

// Doors.plugin.js emits this before opening/closing a door.
function onDoorToggle({ player, objectId, location }) {
  if (!doorIds.has(objectId) || !isActive(player) || !inTutorial(location)) return;
  passDoor(player, location);
}

function onSmeltingSuccess({ player, itemId }) {
  if (itemId !== Items.BRONZE_BAR || !isActive(player)) return;
  if (stage(player) >= STAGE.MINE_SMELT) advance(player, STAGE.MINE_HAMMER);
}

function onSmithingSuccess({ player, itemId }) {
  if (itemId !== Items.BRONZE_DAGGER || !isActive(player)) return;
  if (stage(player) >= STAGE.MINE_DAGGER) advance(player, STAGE.MINE_GATE);
}

function onFishingSuccess(event) {
  const player = event.player;
  if (!player || !isActive(player) || !atTutorial(player)) return;
  // One catch per click, like the tutorial's single shrimp.
  event.stop = true;
  if (stage(player) <= STAGE.SURVIVAL_FISH) advance(player, STAGE.SURVIVAL_SKILLS);
}

/** Tutorial food never burns: a burnt shrimp/bread leaves a dead end. */
function onCookingBurn(event) {
  const player = event.player;
  if (!player || !isActive(player) || !atTutorial(player)) return;
  if (event.rawId === Items.RAW_SHRIMPS || event.rawId === Items.BREAD_DOUGH) {
    event.burn = false;
  }
}

/** Home teleport (and any other teleport) must not skip the island. */
function blockTutorialTeleport(event) {
  const player = event.player;
  if (!player || !isActive(player)) return;
  event.allow = false;
  player.sendMessage("You can't leave Tutorial Island yet.");
}

// The welcome screen's Play button re-sends the gameframe bootstrap, which
// re-mounts every tab and the HUD; re-apply once that handler has run.
function onWelcomePlay({ player }) {
  queueMicrotask(() => {
    if (isActive(player) && overlayShown.has(player)) applyTutorialUi(player);
  });
  return false;
}

function onDialogueVariant({ player, npcId }) {
  return variantFor(player, npcId);
}

function onDialogueCondition({ player, npcId, text }) {
  return answerCondition(player, npcId, text);
}

function onTinderboxLogs({ player }) {
  if (!player || !isActive(player) || !atTutorial(player)) return false;
  if (stage(player) < STAGE.SURVIVAL_FM) return true;
  advance(player, STAGE.SURVIVAL_COOK);
  return false; // let Firemaking create the fire
}

function onFlourWater({ player }) {
  if (!player || !isActive(player) || !atTutorial(player)) return false;
  if (stage(player) < STAGE.CHEF_DOUGH) return false;
  const inv = player.getInventory();
  if (inv.getAmount(Items.POT_OF_FLOUR) <= 0 || inv.getAmount(Items.BUCKET_OF_WATER) <= 0) return false;
  inv.deleteNumber(Items.POT_OF_FLOUR, 1);
  inv.deleteNumber(Items.BUCKET_OF_WATER, 1);
  inv.adds(Items.POT, 1);
  inv.adds(Items.BUCKET, 1);
  inv.adds(Items.BREAD_DOUGH, 1);
  player.sendMessage("You make some dough.");
  advance(player, STAGE.CHEF_BREAD);
  return true;
}

function onBreadDoughRange(event) {
  const player = event.player;
  if (!player || !isActive(player) || !atTutorial(player)) return false;
  return cookBread(player, event);
}

module.exports = {
  name: "TutorialIsland",
  register(api) {
    initialize(api);
    api.persistAttribute(STAGE_ATTR);
    api.registerCommand("tutnext", onTutNext, PlayerRights.NONE, "Advance to the next tutorial step");
    api.registerCommand("tutlast", onTutLast, PlayerRights.NONE, "Return to the previous tutorial step");
    api.onNpcInteraction("Gielinor Guide", { "Talk-to": talkToGielinorGuide });
    api.onPlayerLogin(handleLogin);
    api.onPlayerProcess(handleProcess);
    api.onCustomEvent("woodcutting:success", onWoodcuttingSuccess);
    api.onCustomEvent("cooking:success", onCookingSuccess);
    api.onCustomEvent("cooking:burn", onCookingBurn);
    api.onCustomEvent("mining:success", onMiningSuccess);
    api.onCustomEvent("door:toggle", onDoorToggle);
    api.onCustomEvent("smelting:success", onSmeltingSuccess);
    api.onCustomEvent("smithing:success", onSmithingSuccess);
    api.onCustomEvent("fishing:success", onFishingSuccess);
    api.onInterfaceActionButton(WELCOME_PLAY_BUTTON_UID, onWelcomePlay);
    api.onNpcDialogueVariant(onDialogueVariant);
    api.onNpcDialogueCondition(onDialogueCondition);
    api.onCustomEvent("npc-dialogue:action", onDialogueAction);
    api.onCustomEvent("npc-dialogue:choice", onDialogueChoice);
    api.onObjectInteraction(handleObject);
    api.onNpcClick([IDS.FISHING_SPOT], 1, handleFishing);
    api.onNpcClick([IDS.FISHING_SPOT], 2, handleFishing);
    api.onCanAttack(handleCanAttack);
    api.onCanTeleport(blockTutorialTeleport);
    api.onNpcDeath(handleNpcDeath);
    api.onItemOnItem("Tinderbox", "Logs", onTinderboxLogs, { noted: false });
    api.onItemOnItem("Pot of flour", "Bucket of water", onFlourWater, { noted: false });
    api.onItemOnObject("Bread dough", "Range", onBreadDoughRange, { noted: false });
    api.log("registered", { stages: MAX_PROGRESS });
  },
};
