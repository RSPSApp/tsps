const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { ItemIds, ObjectIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");

const SMELT_ANIMATION = new Animation(899);
const SMITH_ANIMATION = new Animation(898);
// Wiki: goldsmith gauntlets (or the Smithing cape) raise gold bar XP from 22.5 to 56.2.
const GOLDSMITH_GAUNTLETS_BONUS_XP = 33.7;

const SMELTING_SKILLMULTI_GROUP_ID = 270;
const SMELTING_SKILLMULTI_FIRST_ITEM_COMPONENT = 15;
const SMELTING_SKILLMULTI_MAX_QUANTITY = 28;
const SMELTING_SKILLMULTI_TARGET_UID = (162 << 16) | 568;
const SMELTING_CHATMODAL_UNCLAMP_VARBIT = 10670;
// OpenRune cache names: interface.smithing and varbit.smithing_bar_type.
const SMITHING_INTERFACE_ID = 312;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const SMITHING_BAR_TYPE_VARBIT = 3216;
// Keys of enum 1253 (varbit value -> bar obj), dumped from the cache. 1-based, not 0-based.
const SMITHING_BAR_TYPE_BY_ITEM_ID = new Map([
  [2349, 1], // Bronze
  [2351, 2], // Iron
  [2353, 3], // Steel
  [2359, 4], // Mithril
  [2361, 5], // Adamantite
  [2363, 6], // Runite
  [13354, 7], // Blurite
]);
const SMITHING_COMPONENT_BY_PRODUCT = new Map([
  ["Dagger", 9], ["Sword", 10], ["Scimitar", 11], ["Long sword", 12],
  ["2 hand sword", 13], ["Axe", 14], ["Mace", 15], ["Warhammer", 16],
  ["Battle axe", 17], ["Claws", 18], ["Chainbody", 19], ["Plate legs", 20],
  ["Plate skirt", 21], ["Plate body", 22], ["Nails", 23], ["Med helm", 24],
  ["Full helm", 25], ["Square shield", 26], ["Kite shield", 27],
  ["Dart tips", 29], ["Arrowtips", 30], ["Throwing knives", 31],
  ["Studs", 32], ["Bolts (unf)", 34],
]);
const SMITHING_PRODUCT_BY_COMPONENT = new Map(
  [...SMITHING_COMPONENT_BY_PRODUCT].map(([product, component]) => [component, product])
);
const SMITHING_BUTTON_IDS = new Set(
  [...SMITHING_PRODUCT_BY_COMPONENT.keys()].map(
    (component) => (SMITHING_INTERFACE_ID << 16) | component
  )
);
// Anvil quantity mode row (components 3-8, left of the product grid). Confirmed live:
// component 3="1", 4="5", 6="X", 7="all" (5="10" by position - unconfirmed but matches the
// standard 1/5/10/X/All ordering used everywhere else in this codebase). These are plain
// static widgets, not per-item right-click ops - clicking one just selects a mode; the
// selection is applied to whichever product is clicked next. Only the presets you can afford
// are shown/enabled (e.g. with 1-2 bronze bars, only "1" and "All" render) - matches every
// other OSRS production list, not a bug.
const SMITHING_QUANTITY_MODE_COMPONENTS = new Map([
  [3, 1],
  [4, 5],
  [5, 10],
  [6, "x"],
  [7, "all"],
]);
const SMITHING_QUANTITY_MODE_BUTTON_IDS = new Set(
  [...SMITHING_QUANTITY_MODE_COMPONENTS.keys()].map(
    (component) => (SMITHING_INTERFACE_ID << 16) | component
  )
);
const SMITHING_ALL_QUANTITY_CAP = 28;
// player -> selected quantity ("all" or a number); defaults to 1 when unset.
const ACTIVE_SMITHING_QUANTITY = new Map();
// Widget transmit flags: bit (opIndex+1) must be set for that right-click op to reach the
// server (see WidgetActionRouter.shouldTransmitAction on the client). The skillmulti list
// exposes 5 ops per item - Make 1/5/10/X/All - so ops 1-5 (bits 1-5) all need to be enabled;
// leaving only bit 1 set (as before) silently dropped every click except plain "Make 1".
const SMELTING_SKILLMULTI_OP_FLAGS = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);
// This list is routed through the mesLayer "continue" packet (cc_resume_pausebutton, per the
// cache's skillmulti_itembutton_triggered script). Disassembly shows that opcode's childIndex
// argument is `get_varc_int 200` - the client's own "currently selected quantity" var - sent
// as the literal number, not an op/menu index. The quantity-mode buttons (1/5/10/All) and the
// native X text box (if_setonkey) all just write that var client-side; by the time an item is
// clicked, `action` already is the exact quantity to make. A bare/no-mode click sends 0.
function quantityForSmeltAction(action) {
  return Number.isInteger(action) && action > 0
    ? Math.min(action, SMELTING_SKILLMULTI_MAX_QUANTITY)
    : 1;
}
const SMELTING_INTERVAL_TICKS = 5;
const SMITHING_INTERVAL_TICKS = 5;
const CANNONBALL_SMITHING_INTERVAL_TICKS = 8;
// Matches OpenRune's SmeltingScript/AnvilSmithingScript: the first item in a batch produces
// almost immediately (1 tick), only repeats wait the full interval. Using the full interval
// for the first one too made every batch open with what looked like a stalled/doubled pause.
const SMITHING_BATCH_INITIAL_DELAY_TICKS = 1;

const FURNACE_OBJECT_IDS = new Set(
  [
    ObjectIds.FURNACE,
    ObjectIds.FURNACE_2,
    ObjectIds.FURNACE_3,
    ObjectIds.FURNACE_4,
    ObjectIds.FURNACE_5,
    ObjectIds.FURNACE_6,
    ObjectIds.FURNACE_7,
    ObjectIds.FURNACE_8,
    ObjectIds.FURNACE_9,
    ObjectIds.FURNACE_10,
    ObjectIds.FURNACE_11,
    ObjectIds.FURNACE_12,
    ObjectIds.FURNACE_13,
    ObjectIds.FURNACE_14,
    ObjectIds.FURNACE_15,
    ObjectIds.FURNACE_16,
    ObjectIds.FURNACE_17,
    ObjectIds.FURNACE_18,
    ObjectIds.FURNACE_19,
    ObjectIds.FURNACE_20,
    ObjectIds.FURNACE_21,
    ObjectIds.FURNACE_22,
    ObjectIds.SMALL_FURNACE,
    ObjectIds.SMALL_FURNACE_2,
  ].filter(Number.isInteger)
);

const SMELTING_RECIPES = [
  {
    name: "Bronze bar",
    barId: ItemIds.BRONZE_BAR,
    level: 1,
    xp: 6.2,
    ingredients: [
      [ItemIds.COPPER_ORE, 1],
      [ItemIds.TIN_ORE, 1],
    ],
  },
  {
    name: "Iron bar",
    barId: ItemIds.IRON_BAR,
    level: 15,
    xp: 12.5,
    ingredients: [[ItemIds.IRON_ORE, 1]],
    successChance: 0.5,
  },
  {
    name: "Silver bar",
    barId: ItemIds.SILVER_BAR,
    level: 20,
    xp: 13.7,
    ingredients: [[ItemIds.SILVER_ORE, 1]],
  },
  {
    name: "Steel bar",
    barId: ItemIds.STEEL_BAR,
    level: 30,
    xp: 17.5,
    ingredients: [
      [ItemIds.IRON_ORE, 1],
      [ItemIds.COAL, 2],
    ],
  },
  {
    name: "Gold bar",
    barId: ItemIds.GOLD_BAR,
    level: 40,
    xp: 22.5,
    ingredients: [[ItemIds.GOLD_ORE, 1]],
  },
  {
    name: "Mithril bar",
    barId: ItemIds.MITHRIL_BAR,
    level: 50,
    xp: 30,
    ingredients: [
      [ItemIds.MITHRIL_ORE, 1],
      [ItemIds.COAL, 4],
    ],
  },
  {
    name: "Adamantite bar",
    barId: ItemIds.ADAMANTITE_BAR,
    level: 70,
    xp: 37.5,
    ingredients: [
      [ItemIds.ADAMANTITE_ORE, 1],
      [ItemIds.COAL, 6],
    ],
  },
  {
    name: "Runite bar",
    barId: ItemIds.RUNITE_BAR,
    level: 85,
    xp: 50,
    ingredients: [
      [ItemIds.RUNITE_ORE, 1],
      [ItemIds.COAL, 8],
    ],
  },
];

const SMITHABLE_EQUIPMENT_DATA = [
  ["Dagger", 2349, 1205, 1, 1119, 0, 1094, 1, 1, 1125],
  ["Axe", 2349, 1351, 1, 1120, 0, 1091, 1, 1, 1126],
  ["Mace", 2349, 1422, 1, 1120, 1, 1093, 2, 1, 1129],
  ["Med helm", 2349, 1139, 1, 1122, 0, 1102, 3, 1, 1127],
  ["Dart tips", 2349, 819, 10, 1123, 0, 1107, 4, 1, 1128],
  ["Sword", 2349, 1277, 1, 1119, 1, 1085, 4, 1, 1124],
  ["Arrowtips", 2349, 39, 15, 1123, 1, 1108, 5, 1, 1130],
  ["Scimitar", 2349, 1321, 1, 1119, 2, 1087, 5, 2, 1116],
  ["Long sword", 2349, 1291, 1, 1119, 3, 1086, 6, 2, 1089],
  ["Throwing knives", 2349, 864, 5, 1123, 2, 1106, 7, 1, 1131],
  ["Full helm", 2349, 1155, 1, 1122, 1, 1103, 7, 2, 1113],
  ["Square shield", 2349, 1173, 1, 1122, 2, 1104, 8, 2, 1114],
  ["Warhammer", 2349, 1337, 1, 1120, 2, 1083, 9, 3, 1118],
  ["Battle axe", 2349, 1375, 1, 1120, 3, 1092, 10, 3, 1095],
  ["Chainbody", 2349, 1103, 1, 1121, 0, 1098, 11, 3, 1109],
  ["Kite shield", 2349, 1189, 1, 1122, 3, 1105, 12, 3, 1115],
  ["Claws", 2349, 3095, 1, 1120, 4, 8429, 13, 2, 8428],
  ["2 hand sword", 2349, 1307, 1, 1119, 4, 1088, 14, 3, 1090],
  ["Plate skirt", 2349, 1087, 1, 1121, 2, 1100, 16, 3, 1111],
  ["Plate legs", 2349, 1075, 1, 1121, 1, 1099, 16, 3, 1110],
  ["Plate body", 2349, 1117, 1, 1121, 3, 1101, 18, 5, 1112],
  ["Nails", 2349, 4819, 15, 1122, 4, 13358, 4, 1, 13357],
  ["Bolts (unf)", 2349, 9375, 10, 1121, 4, 11461, 3, 1, 11459],
  ["Dagger", 2351, 1203, 1, 1119, 0, 1094, 15, 1, 1125],
  ["Axe", 2351, 1349, 1, 1120, 0, 1091, 16, 1, 1126],
  ["Mace", 2351, 1420, 1, 1120, 1, 1093, 17, 1, 1129],
  ["Med helm", 2351, 1137, 1, 1122, 0, 1102, 18, 1, 1127],
  ["Dart tips", 2351, 820, 10, 1123, 0, 1107, 19, 1, 1128],
  ["Sword", 2351, 1279, 1, 1119, 1, 1085, 19, 1, 1124],
  ["Arrowtips", 2351, 40, 15, 1123, 1, 1108, 20, 1, 1130],
  ["Scimitar", 2351, 1323, 1, 1119, 2, 1087, 20, 2, 1116],
  ["Long sword", 2351, 1293, 1, 1119, 3, 1086, 21, 2, 1089],
  ["Throwing knives", 2351, 863, 5, 1123, 2, 1106, 22, 1, 1131],
  ["Full helm", 2351, 1153, 1, 1122, 1, 1103, 22, 2, 1113],
  ["Square shield", 2351, 1175, 1, 1122, 2, 1104, 23, 2, 1114],
  ["Warhammer", 2351, 1335, 1, 1120, 2, 1083, 24, 3, 1118],
  ["Battle axe", 2351, 1363, 1, 1120, 3, 1092, 25, 3, 1095],
  ["Chainbody", 2351, 1101, 1, 1121, 0, 1098, 26, 3, 1109],
  ["Kite shield", 2351, 1191, 1, 1122, 3, 1105, 27, 3, 1115],
  ["Claws", 2351, 3096, 1, 1120, 4, 8429, 28, 2, 8428],
  ["2 hand sword", 2351, 1309, 1, 1119, 4, 1088, 29, 3, 1090],
  ["Plate skirt", 2351, 1081, 1, 1121, 2, 1100, 31, 3, 1111],
  ["Plate legs", 2351, 1067, 1, 1121, 1, 1099, 31, 3, 1110],
  ["Plate body", 2351, 1115, 1, 1121, 3, 1101, 33, 5, 1112],
  ["Nails", 2351, 4820, 15, 1122, 4, 13358, 19, 1, 13357],
  ["Bolts (unf)", 2351, 9377, 10, 1121, 4, 11461, 19, 1, 11459],
  ["Dagger", 2353, 1207, 1, 1119, 0, 1094, 30, 1, 1125],
  ["Axe", 2353, 1353, 1, 1120, 0, 1091, 31, 1, 1126],
  ["Mace", 2353, 1424, 1, 1120, 1, 1093, 32, 1, 1129],
  ["Med helm", 2353, 1141, 1, 1122, 0, 1102, 33, 1, 1127],
  ["Dart tips", 2353, 821, 10, 1123, 0, 1107, 34, 1, 1128],
  ["Sword", 2353, 1281, 1, 1119, 1, 1085, 34, 1, 1124],
  ["Arrowtips", 2353, 41, 15, 1123, 1, 1108, 35, 1, 1130],
  ["Scimitar", 2353, 1325, 1, 1119, 2, 1087, 35, 2, 1116],
  ["Long sword", 2353, 1295, 1, 1119, 3, 1086, 36, 2, 1089],
  ["Throwing knives", 2353, 865, 5, 1123, 2, 1106, 37, 1, 1131],
  ["Full helm", 2353, 1157, 1, 1122, 1, 1103, 37, 2, 1113],
  ["Square shield", 2353, 1177, 1, 1122, 2, 1104, 38, 2, 1114],
  ["Warhammer", 2353, 1339, 1, 1120, 2, 1083, 39, 3, 1118],
  ["Battle axe", 2353, 1365, 1, 1120, 3, 1092, 40, 3, 1095],
  ["Chainbody", 2353, 1105, 1, 1121, 0, 1098, 41, 3, 1109],
  ["Kite shield", 2353, 1193, 1, 1122, 3, 1105, 42, 3, 1115],
  ["Claws", 2353, 3097, 1, 1120, 4, 8429, 43, 2, 8428],
  ["2 hand sword", 2353, 1311, 1, 1119, 4, 1088, 44, 3, 1090],
  ["Plate skirt", 2353, 1083, 1, 1121, 2, 1100, 46, 3, 1111],
  ["Plate legs", 2353, 1069, 1, 1121, 1, 1099, 46, 3, 1110],
  ["Plate body", 2353, 1119, 1, 1121, 3, 1101, 48, 5, 1112],
  ["Nails", 2353, 1539, 15, 1122, 4, 13358, 34, 1, 13357],
  ["Bolts (unf)", 2353, 9378, 10, 1121, 4, 11461, 33, 1, 11459],
  ["Cannon ball", 2353, 2, 4, 1123, 3, 1096, 35, 1, 1132],
  ["Studs", 2353, 2370, 1, 1123, 4, 1134, 36, 1, 1135],
  ["Dagger", 2359, 1209, 1, 1119, 0, 1094, 50, 1, 1125],
  ["Axe", 2359, 1355, 1, 1120, 0, 1091, 51, 1, 1126],
  ["Mace", 2359, 1428, 1, 1120, 1, 1093, 52, 1, 1129],
  ["Med helm", 2359, 1143, 1, 1122, 0, 1102, 53, 1, 1127],
  ["Dart tips", 2359, 822, 10, 1123, 0, 1107, 54, 1, 1128],
  ["Sword", 2359, 1285, 1, 1119, 1, 1085, 54, 1, 1124],
  ["Arrowtips", 2359, 42, 15, 1123, 1, 1108, 55, 1, 1130],
  ["Scimitar", 2359, 1329, 1, 1119, 2, 1087, 55, 2, 1116],
  ["Long sword", 2359, 1299, 1, 1119, 3, 1086, 56, 2, 1089],
  ["Throwing knives", 2359, 866, 5, 1123, 2, 1106, 57, 1, 1131],
  ["Full helm", 2359, 1159, 1, 1122, 1, 1103, 57, 2, 1113],
  ["Square shield", 2359, 1181, 1, 1122, 2, 1104, 58, 2, 1114],
  ["Warhammer", 2359, 1343, 1, 1120, 2, 1083, 59, 3, 1118],
  ["Battle axe", 2359, 1369, 1, 1120, 3, 1092, 60, 3, 1095],
  ["Chainbody", 2359, 1109, 1, 1121, 0, 1098, 61, 3, 1109],
  ["Kite shield", 2359, 1197, 1, 1122, 3, 1105, 62, 3, 1115],
  ["Claws", 2359, 3099, 1, 1120, 4, 8429, 63, 2, 8428],
  ["2 hand sword", 2359, 1315, 1, 1119, 4, 1088, 64, 3, 1090],
  ["Plate skirt", 2359, 1085, 1, 1121, 2, 1100, 66, 3, 1111],
  ["Plate legs", 2359, 1071, 1, 1121, 1, 1099, 66, 3, 1110],
  ["Plate body", 2359, 1121, 1, 1121, 3, 1101, 68, 5, 1112],
  ["Nails", 2359, 4822, 15, 1122, 4, 13358, 54, 1, 13357],
  ["Bolts (unf)", 2359, 9379, 10, 1121, 4, 11461, 53, 1, 11459],
  ["Dagger", 2361, 1211, 1, 1119, 0, 1094, 70, 1, 1125],
  ["Axe", 2361, 1357, 1, 1120, 0, 1091, 71, 1, 1126],
  ["Mace", 2361, 1430, 1, 1120, 1, 1093, 72, 1, 1129],
  ["Med helm", 2361, 1145, 1, 1122, 0, 1102, 73, 1, 1127],
  ["Dart tips", 2361, 823, 10, 1123, 0, 1107, 74, 1, 1128],
  ["Sword", 2361, 1287, 1, 1119, 1, 1085, 74, 1, 1124],
  ["Arrowtips", 2361, 43, 15, 1123, 1, 1108, 75, 1, 1130],
  ["Scimitar", 2361, 1331, 1, 1119, 2, 1087, 75, 2, 1116],
  ["Long sword", 2361, 1301, 1, 1119, 3, 1086, 76, 2, 1089],
  ["Throwing knives", 2361, 867, 5, 1123, 2, 1106, 77, 1, 1131],
  ["Full helm", 2361, 1161, 1, 1122, 1, 1103, 77, 2, 1113],
  ["Square shield", 2361, 1183, 1, 1122, 2, 1104, 78, 2, 1114],
  ["Warhammer", 2361, 1345, 1, 1120, 2, 1083, 79, 3, 1118],
  ["Battle axe", 2361, 1371, 1, 1120, 3, 1092, 80, 3, 1095],
  ["Chainbody", 2361, 1111, 1, 1121, 0, 1098, 81, 3, 1109],
  ["Kite shield", 2361, 1199, 1, 1122, 3, 1105, 82, 3, 1115],
  ["Claws", 2361, 3100, 1, 1120, 4, 8429, 83, 2, 8428],
  ["2 hand sword", 2361, 1317, 1, 1119, 4, 1088, 84, 3, 1090],
  ["Plate skirt", 2361, 1091, 1, 1121, 2, 1100, 86, 3, 1111],
  ["Plate legs", 2361, 1073, 1, 1121, 1, 1099, 86, 3, 1110],
  ["Plate body", 2361, 1123, 1, 1121, 3, 1101, 88, 5, 1112],
  ["Nails", 2361, 4823, 15, 1122, 4, 13358, 74, 1, 13357],
  ["Bolts (unf)", 2361, 9380, 10, 1121, 4, 11461, 73, 1, 11459],
  ["Dagger", 2363, 1213, 1, 1119, 0, 1094, 85, 1, 1125],
  ["Axe", 2363, 1359, 1, 1120, 0, 1091, 86, 1, 1126],
  ["Mace", 2363, 1432, 1, 1120, 1, 1093, 87, 1, 1129],
  ["Med helm", 2363, 1147, 1, 1122, 0, 1102, 88, 1, 1127],
  ["Dart tips", 2363, 824, 10, 1123, 0, 1107, 89, 1, 1128],
  ["Sword", 2363, 1289, 1, 1119, 1, 1085, 89, 1, 1124],
  ["Arrowtips", 2363, 44, 15, 1123, 1, 1108, 90, 1, 1130],
  ["Scimitar", 2363, 1333, 1, 1119, 2, 1087, 90, 2, 1116],
  ["Long sword", 2363, 1303, 1, 1119, 3, 1086, 91, 2, 1089],
  ["Throwing knives", 2363, 868, 5, 1123, 2, 1106, 92, 1, 1131],
  ["Full helm", 2363, 1163, 1, 1122, 1, 1103, 92, 2, 1113],
  ["Square shield", 2363, 1185, 1, 1122, 2, 1104, 93, 2, 1114],
  ["Warhammer", 2363, 1347, 1, 1120, 2, 1083, 94, 3, 1118],
  ["Battle axe", 2363, 1373, 1, 1120, 3, 1092, 95, 3, 1095],
  ["Chainbody", 2363, 1113, 1, 1121, 0, 1098, 96, 3, 1109],
  ["Kite shield", 2363, 1201, 1, 1122, 3, 1105, 97, 3, 1115],
  ["Claws", 2363, 3101, 1, 1120, 4, 8429, 98, 2, 8428],
  ["2 hand sword", 2363, 1319, 1, 1119, 4, 1088, 99, 3, 1090],
  ["Plate skirt", 2363, 1093, 1, 1121, 2, 1100, 99, 3, 1111],
  ["Plate legs", 2363, 1079, 1, 1121, 1, 1099, 99, 3, 1110],
  ["Plate body", 2363, 1127, 1, 1121, 3, 1101, 99, 5, 1112],
  ["Nails", 2363, 4824, 15, 1122, 4, 13358, 89, 1, 13357],
  ["Bolts (unf)", 2363, 9381, 10, 1121, 4, 11461, 88, 1, 11459],
];

const SMITHABLE_EQUIPMENT = SMITHABLE_EQUIPMENT_DATA.map(
  ([
    name,
    barId,
    itemId,
    amount,
    itemFrame,
    itemSlot,
    nameFrame,
    requiredLevel,
    barsRequired,
    barFrame,
  ]) => ({
    name,
    barId,
    itemId,
    amount,
    itemFrame,
    itemSlot,
    nameFrame,
    requiredLevel,
    barsRequired,
    barFrame,
  })
);

const SMITHABLE_EQUIPMENT_BY_BAR = new Map();

for (const smithable of SMITHABLE_EQUIPMENT) {
  const existing = SMITHABLE_EQUIPMENT_BY_BAR.get(smithable.barId);
  if (existing) {
    existing.push(smithable);
  } else {
    SMITHABLE_EQUIPMENT_BY_BAR.set(smithable.barId, [smithable]);
  }
}

const SMELT_RECIPES_BY_INGREDIENT = new Map();

for (const recipe of SMELTING_RECIPES) {
  for (const [ingredientId] of recipe.ingredients) {
    SMELT_RECIPES_BY_INGREDIENT.set(ingredientId, recipe);
  }
}

const SMELTING_SKILLMULTI_BUTTON_IDS = SMELTING_RECIPES.map(
  (_, index) =>
    (SMELTING_SKILLMULTI_GROUP_ID << 16) |
    (SMELTING_SKILLMULTI_FIRST_ITEM_COMPONENT + index)
);

let smithingTick = 0;
const ACTIVE_SMITHING_SESSIONS = new Map();
const ACTIVE_SMELTERS = new Set();
const ACTIVE_SMELTING_MENUS = new Set();
const ACTIVE_SMITHING_MENUS = new Map();

function getSmithingLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.SMITHING);
}

function hasIngredients(inventory, recipe) {
  for (const [itemId, amount] of recipe.ingredients) {
    if (inventory.getAmount(itemId) < amount) {
      return false;
    }
  }
  return true;
}

function consumeIngredients(inventory, recipe) {
  for (const [itemId, amount] of recipe.ingredients) {
    inventory.deleteNumber(itemId, amount);
  }
}

function openSmeltingInterface(player) {
  const sender = player.getPacketSender();
  const itemIds = SMELTING_RECIPES.map((recipe) => recipe.barId);
  while (itemIds.length < 18) itemIds.push(-1);

  ACTIVE_SMELTING_MENUS.add(player);
  sender
    .sendInterfaceScript(2379)
    .sendVarbit(SMELTING_CHATMODAL_UNCLAMP_VARBIT, 1)
    .sendInterfaceDisplayState(SMELTING_SKILLMULTI_TARGET_UID, false)
    .sendSubInterface(
      SMELTING_SKILLMULTI_TARGET_UID,
      SMELTING_SKILLMULTI_GROUP_ID,
      0
  );
  for (const buttonId of SMELTING_SKILLMULTI_BUTTON_IDS) {
    sender.sendInterfaceFlagsRange(buttonId, 0, SMELTING_SKILLMULTI_MAX_QUANTITY, SMELTING_SKILLMULTI_OP_FLAGS);
  }
  sender.sendInterfaceScript(2046, [
    13,
    ["What would you like to smelt?", ...SMELTING_RECIPES.map((recipe) => recipe.name)].join("|"),
    SMELTING_SKILLMULTI_MAX_QUANTITY,
    ...itemIds,
    SMELTING_SKILLMULTI_MAX_QUANTITY,
  ]);
}

function closeSmeltingInterface(player) {
  if (!ACTIVE_SMELTING_MENUS.delete(player)) return;
  player
    .getPacketSender()
    .closeSubInterface(SMELTING_SKILLMULTI_TARGET_UID)
    .sendInterfaceDisplayState(SMELTING_SKILLMULTI_TARGET_UID, true);
}

function smeltingXp(player, recipe) {
  if (recipe.barId !== ItemIds.GOLD_BAR) return recipe.xp;
  const gloves = player.getEquipment().get(Equipment.HANDS_SLOT)?.getId?.();
  const cape = player.getEquipment().get(Equipment.CAPE_SLOT)?.getId?.();
  const boosted = gloves === ItemIds.GOLDSMITH_GAUNTLETS
    || cape === ItemIds.SMITHING_CAPE
    || cape === ItemIds.SMITHING_CAPE_T_;
  return boosted ? recipe.xp + GOLDSMITH_GAUNTLETS_BONUS_XP : recipe.xp;
}

function performSmeltAction(player, recipe) {
  const inventory = player.getInventory();
  const smithingLevel = getSmithingLevel(player);
  if (smithingLevel < recipe.level) {
    player.sendMessage(
      `You need a Smithing level of at least ${recipe.level} to smelt this bar.`
    );
    return false;
  }

  if (!hasIngredients(inventory, recipe)) {
    player.sendMessage("You don't have the required ores to smelt this bar.");
    return false;
  }

  consumeIngredients(inventory, recipe);

  Sounds.sendSound(player, Sound.SMELTING);
  player.performAnimation(SMELT_ANIMATION);

  const successChance = recipe.successChance ?? 1;
  if (Math.random() <= successChance) {
    inventory.addItem(new Item(recipe.barId, 1));
    player.getSkillManager().addExperiences(Skill.SMITHING, smeltingXp(player, recipe));
    player.sendMessage("You retrieve a bar of metal.");
    pluginApi?.emitCustomEvent("smelting:success", { player, skill: Skill.SMITHING, itemId: recipe.barId });
  } else {
    player.sendMessage("The ore is too impure and fails to become a bar.");
  }

  return true;
}

function performSmithAction(player, smithable) {
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIds.HAMMER)) {
    player.sendMessage("You need a hammer to work metal bars.");
    return false;
  }

  const smithingLevel = getSmithingLevel(player);
  if (smithingLevel < smithable.requiredLevel) {
    player.sendMessage(
      `You need a Smithing level of at least ${smithable.requiredLevel} to smith this item.`
    );
    return false;
  }

  if (inventory.getAmount(smithable.barId) < smithable.barsRequired) {
    player.sendMessage("You don't have enough bars to smith that item.");
    return false;
  }

  inventory.deleteNumber(smithable.barId, smithable.barsRequired);
  inventory.addItem(new Item(smithable.itemId, smithable.amount));
  player.performAnimation(SMITH_ANIMATION);
  player.getSkillManager().addExperiences(Skill.SMITHING, 10);

  player.sendMessage("You hammer the metal and shape an item.");
  pluginApi?.emitCustomEvent("smithing:success", {
    player,
    skill: Skill.SMITHING,
    itemId: smithable.itemId,
  });
  return true;
}

function stopSmithingSession(activeSessions, player, resetAnimation = true) {
  if (!activeSessions.has(player)) {
    return;
  }
  activeSessions.delete(player);
  ACTIVE_SMELTERS.delete(player);
  if (resetAnimation) {
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

class CloseSmithingInterfaceTask extends Task {
  constructor(player) {
    super(1);
    this.player = player;
  }

  execute() {
    closeSmithingInterface(this.player);
    this.stop();
  }
}

function closeSmithingInterfaceNextTick(player) {
  TaskManager.submit(new CloseSmithingInterfaceTask(player));
}

function closeSmithingInterface(player) {
  if (!player?.isRegistered?.() || player.getInterfaceId() !== SMITHING_INTERFACE_ID) {
    return;
  }
  ACTIVE_SMITHING_MENUS.delete(player);
  ACTIVE_SMITHING_QUANTITY.delete(player);
  player.setInterfaceId(-1);
  player.getPacketSender().closeSubInterface(MAIN_MODAL_TARGET_UID);
}

function startSmeltingSession(activeSessions, player, recipe, amount) {
  if (!recipe || !Number.isInteger(amount) || amount <= 0) {
    return false;
  }

  const smithingLevel = getSmithingLevel(player);
  if (smithingLevel < recipe.level) {
    player.sendMessage(
      `You need a Smithing level of at least ${recipe.level} to smelt this bar.`
    );
    return false;
  }

  if (!hasIngredients(player.getInventory(), recipe)) {
    player.sendMessage("You don't have the required ores to smelt this bar.");
    return false;
  }

  stopSmithingSession(activeSessions, player, false);
  activeSessions.set(player, {
    type: "smelt",
    recipe,
    remaining: amount,
    interval: SMELTING_INTERVAL_TICKS,
    nextActionTick: smithingTick + SMITHING_BATCH_INITIAL_DELAY_TICKS,
  });
  ACTIVE_SMELTERS.add(player);
  player.performAnimation(SMELT_ANIMATION);
  return true;
}

function startSmithingSession(activeSessions, player, smithable, amount) {
  if (!smithable || !Number.isInteger(amount) || amount <= 0) {
    return false;
  }

  const inventory = player.getInventory();
  if (!inventory.contains(ItemIds.HAMMER)) {
    player.sendMessage("You need a hammer to work metal bars.");
    return false;
  }

  const smithingLevel = getSmithingLevel(player);
  if (smithingLevel < smithable.requiredLevel) {
    player.sendMessage(
      `You need a Smithing level of at least ${smithable.requiredLevel} to smith this item.`
    );
    return false;
  }

  if (inventory.getAmount(smithable.barId) < smithable.barsRequired) {
    player.sendMessage("You don't have enough bars to smith that item.");
    return false;
  }

  stopSmithingSession(activeSessions, player, false);
  const smithingInterval =
    smithable.itemId === ItemIds.CANNONBALL
      ? CANNONBALL_SMITHING_INTERVAL_TICKS
      : SMITHING_INTERVAL_TICKS;
  activeSessions.set(player, {
    type: "smith",
    smithable,
    remaining: amount,
    interval: smithingInterval,
    nextActionTick: smithingTick + SMITHING_BATCH_INITIAL_DELAY_TICKS,
  });
  ACTIVE_SMELTERS.delete(player);

  player.performAnimation(SMITH_ANIMATION);
  return true;
}

function startBotSmelting(player, recipe, amount) {
  return startSmeltingSession(ACTIVE_SMITHING_SESSIONS, player, recipe, amount);
}

function isSmeltingActive(player) {
  return ACTIVE_SMELTERS.has(player);
}

function openEquipmentCreationInterface(player, preferredBarId = null) {
  const inventory = player.getInventory();
  const smithingLevel = getSmithingLevel(player);

  let selectedBar = null;
  if (Number.isInteger(preferredBarId)) {
    const preferredBar = SMELTING_RECIPES.find(
      (recipe) =>
        recipe.barId === preferredBarId &&
        SMITHABLE_EQUIPMENT_BY_BAR.has(recipe.barId)
    );
    if (preferredBar) {
      if (smithingLevel < preferredBar.level) {
        player.sendMessage(
          `You need a Smithing level of at least ${preferredBar.level} to smith this bar.`
        );
        return false;
      }
      if (inventory.contains(preferredBar.barId)) {
        selectedBar = preferredBar;
      }
    }
  }

  if (!selectedBar) {
    for (const barRecipe of SMELTING_RECIPES) {
      if (!SMITHABLE_EQUIPMENT_BY_BAR.has(barRecipe.barId)) {
        continue;
      }
      if (
        inventory.contains(barRecipe.barId) &&
        smithingLevel >= barRecipe.level
      ) {
        selectedBar = barRecipe;
      }
    }
  }

  if (!selectedBar) {
    player.sendMessage(
      "You don't have any bars in your inventory which can be used with your Smithing level."
    );
    return false;
  }

  const barType = SMITHING_BAR_TYPE_BY_ITEM_ID.get(selectedBar.barId);
  if (barType == null) {
    return false;
  }

  ACTIVE_SMITHING_MENUS.set(player, selectedBar.barId);
  ACTIVE_SMITHING_QUANTITY.delete(player);
  player.setInterfaceId(SMITHING_INTERFACE_ID);
  // Matches OpenRune's AnvilSmithingScript.openSmithingInterface: set the bar-type varbit,
  // then open the modal. Interface 312 populates its own product icons - its onLoad script
  // chain (415 -> 430) reads varbit 3216 itself, verified by disassembling the cache - so
  // pushing items per-component from here would just draw a second, overlapping set.
  player
    .getPacketSender()
    .sendVarbit(SMITHING_BAR_TYPE_VARBIT, barType)
    .sendSubInterface(MAIN_MODAL_TARGET_UID, SMITHING_INTERFACE_ID, 0);

  for (const buttonId of SMITHING_BUTTON_IDS) {
    player.getPacketSender().sendInterfaceFlags(buttonId, 2);
  }
  return true;
}

class SmithingTask extends Task {
  constructor(activeSessions) {
    super(1);
    this.activeSessions = activeSessions;
    this.cycle = 0;
  }

  execute() {
    this.cycle++;
    smithingTick = this.cycle;

    for (const player of ACTIVE_SMELTING_MENUS) {
      if (
        !player?.isRegistered?.() ||
        player.getMovementQueue().size() > 0 ||
        player.getForceMovement() != null
      ) {
        closeSmeltingInterface(player);
      }
    }

    for (const player of ACTIVE_SMITHING_MENUS.keys()) {
      if (
        !player?.isRegistered?.() ||
        player.getMovementQueue().size() > 0 ||
        player.getForceMovement() != null
      ) {
        closeSmithingInterface(player);
      }
    }

    for (const [player, session] of this.activeSessions) {
      if (!player || !player.isRegistered?.() || player.getHitpoints() <= 0) {
        stopSmithingSession(this.activeSessions, player, false);
        continue;
      }

      if (
        player.getMovementQueue().size() > 0 ||
        player.getForceMovement() != null
      ) {
        stopSmithingSession(this.activeSessions, player);
        continue;
      }

      if (!Number.isInteger(session.remaining) || session.remaining <= 0) {
        stopSmithingSession(this.activeSessions, player, false);
        continue;
      }

      if (this.cycle < session.nextActionTick) {
        continue;
      }

      session.nextActionTick = this.cycle + session.interval;

      let progressed = false;
      if (session.type === "smelt") {
        progressed = performSmeltAction(player, session.recipe);
      } else if (session.type === "smith") {
        progressed = performSmithAction(player, session.smithable);
      }

      if (!progressed) {
        stopSmithingSession(this.activeSessions, player);
        continue;
      }

      session.remaining--;
      if (session.remaining <= 0) {
        stopSmithingSession(this.activeSessions, player, false);
      }
    }
  }
}

function handleSmithingQuantityModeAction(player, buttonId) {
  const mode = SMITHING_QUANTITY_MODE_COMPONENTS.get(buttonId & 0xffff);
  if (mode === undefined) return false;

  if (mode === "x") {
    player.setEnteredAmountAction({
      execute: (amount) => {
        if (Number.isInteger(amount) && amount > 0) {
          ACTIVE_SMITHING_QUANTITY.set(player, amount);
        }
      },
    });
    player.getPacketSender().sendEnterAmountPrompt("How many would you like to make?");
    return true;
  }

  ACTIVE_SMITHING_QUANTITY.set(player, mode);
  return true;
}

function handleSmithingInterfaceAction(activeSessions, player, buttonId) {
  const barId = ACTIVE_SMITHING_MENUS.get(player);
  if (player.getInterfaceId() !== SMITHING_INTERFACE_ID || barId == null) {
    return false;
  }

  const product = SMITHING_PRODUCT_BY_COMPONENT.get(buttonId & 0xffff);
  const smithable = SMITHABLE_EQUIPMENT_BY_BAR
    .get(barId)
    ?.find((entry) => entry.name === product);
  if (!smithable) return false;

  const selected = ACTIVE_SMITHING_QUANTITY.get(player) ?? 1;
  const amount = selected === "all" ? SMITHING_ALL_QUANTITY_CAP : selected;

  ACTIVE_SMITHING_MENUS.delete(player);
  ACTIVE_SMITHING_QUANTITY.delete(player);
  const started = startSmithingSession(activeSessions, player, smithable, amount);
  if (started) {
    closeSmithingInterfaceNextTick(player);
  }
  return started;
}

let TaskManager;
let pluginApi;

function handleSmelt({ player }) {
  openSmeltingInterface(player);
}

function handleSmith({ player }) {
  openEquipmentCreationInterface(player);
}

function handleSmithingItemOnObject(event) {
  const { player, object, itemId } = event;
  const name = object.getDefinition().getName();

  if (name === "Furnace" || name === "Small furnace") {
    const recipe = SMELT_RECIPES_BY_INGREDIENT.get(itemId);
    if (!recipe) {
      return;
    }
    performSmeltAction(player, recipe);
    event.handled = true;
    return;
  }

  if (name === "Anvil" || name === "An experimental anvil") {
    if (SMITHABLE_EQUIPMENT_BY_BAR.has(itemId)) {
      openEquipmentCreationInterface(player, itemId);
      event.handled = true;
      return;
    }
  }
}

module.exports = {
  name: "Smithing",
  SMITHING_BAR_TYPE_BY_ITEM_ID,
  SMELTING_SKILLMULTI_OP_FLAGS,
  quantityForSmeltAction,
  FURNACE_OBJECT_IDS,
  SMELTING_RECIPES,
  startBotSmelting,
  isSmeltingActive,
  register(api) {
    pluginApi = api;
    TaskManager = api.getTaskManager();
    TaskManager.submit(new SmithingTask(ACTIVE_SMITHING_SESSIONS));

    api.onPlayerDisconnect(({ player }) => {
      stopSmithingSession(ACTIVE_SMITHING_SESSIONS, player, false);
      ACTIVE_SMELTING_MENUS.delete(player);
      ACTIVE_SMITHING_MENUS.delete(player);
      ACTIVE_SMITHING_QUANTITY.delete(player);
    });
    api.onPlayerLevelUp(({ player }) => {
      stopSmithingSession(ACTIVE_SMITHING_SESSIONS, player, false);
    });

    // Some furnaces (e.g. Tutorial Island 10082) only offer "Use".
    api.onObjectInteraction("Furnace", { Smelt: handleSmelt, Use: handleSmelt });
    api.onObjectInteraction("Small furnace", { Smelt: handleSmelt });
    api.onObjectInteraction("Anvil", { Smith: handleSmith });
    api.onObjectInteraction("An experimental anvil", { Use: handleSmith });

    api.onInterfaceActionButton(
      SMELTING_SKILLMULTI_BUTTON_IDS,
      ({ player, buttonId, action }) => {
        if (!ACTIVE_SMELTING_MENUS.has(player)) return false;
        const recipe =
          SMELTING_RECIPES[
            (buttonId & 0xffff) - SMELTING_SKILLMULTI_FIRST_ITEM_COMPONENT
          ];
        if (!recipe) return false;

        closeSmeltingInterface(player);
        return startSmeltingSession(
          ACTIVE_SMITHING_SESSIONS,
          player,
          recipe,
          quantityForSmeltAction(action)
        );
      }
    );

    api.onInterfaceActionButton(
      [...SMITHING_QUANTITY_MODE_BUTTON_IDS],
      ({ player, buttonId }) => handleSmithingQuantityModeAction(player, buttonId)
    );

    api.onInterfaceActionButton(
      [...SMITHING_BUTTON_IDS],
      ({ player, buttonId }) =>
        handleSmithingInterfaceAction(ACTIVE_SMITHING_SESSIONS, player, buttonId)
    );

    api.onItemOnObject(handleSmithingItemOnObject, { noted: false });

    api.log("registered", {
      smeltRecipes: SMELTING_RECIPES.length,
      smithables: SMITHABLE_EQUIPMENT.length,
    });
  },
};
