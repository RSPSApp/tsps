/**
 * The Morytania diary tasks whose base gameplay was implemented alongside this file: Snelm
 * crafting, Trouble Brewing, the Swamp Boaty at the Hollows, Guthix balance mixing and barehand
 * shark fishing. Each handler awards `diary:task` only after the real action has succeeded and
 * the Wiki's place (and, for barehand shark, the method) matches. Catalogue keys are in
 * data/achievement-diaries.json.
 */
const DIARY = "morytania";
const TASKS = {
  snelm: "craft-any-snelm-from-scratch-in-morytania",
  troubleBrewing: "complete-a-game-of-trouble-brewing",
  swampBoaty: "board-the-swampy-boat-at-the-hollows",
  guthixBalance: "mix-a-guthix-balance-potion-while-in-morytania",
  barehandShark: "catch-a-shark-in-burgh-de-rott-with-your-bare-ha",
};

/** Morytania's mainland, Mos Le'Harmless, Harmony and Braindeath islands. */
const MORYTANIA = [
  { minX: 3350, maxX: 3760, minY: 3150, maxY: 3620, z: 0 },
  { minX: 3650, maxX: 3820, minY: 2930, maxY: 3080, z: 0 },
  { minX: 3780, maxX: 3840, minY: 2820, maxY: 2910, z: 0 },
  { minX: 2100, maxX: 2250, minY: 5050, maxY: 5150, z: 0 },
];
/** Burgh de Rott's shore and both harpoon spots (npc-spawns.json 4476/4477). */
const BURGH_DE_ROTT = { minX: 3460, maxX: 3550, minY: 3150, maxY: 3225, z: 0 };
/**
 * Mort Myre Swamp south of its gate fence (gate 3443-3444, 3457 in Doors.plugin.js) for the
 * Snelm task's exclusion; every ghast spawn (x 3401-3563, y 3328-3452) lies inside. Not the
 * Nature Spirit box, which reaches y 3480 and takes in southern Canifis and its bank.
 */
const MORT_MYRE = { minX: 3380, maxX: 3590, minY: 3310, maxY: 3457, z: 0 };
const GUTHIX_BALANCE = new Set([7660, 7662, 7664, 7666]); // finished 4/3/2/1-dose

let api = null;

const emit = (player, task) => api.emitCustomEvent("diary:task", { player, diary: DIARY, task });

function inBox(location, box) {
  if (!location) return false;
  const z = location.getZ?.() ?? location.z;
  if (box.z !== undefined && z !== box.z) return false;
  const x = location.getX?.() ?? location.x;
  const y = location.getY?.() ?? location.y;
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

const inMorytania = (location) => MORYTANIA.some((box) => inBox(location, box));
/** Same boxes on any floor (Wiki: the Guthix balance task counts anywhere in Morytania). */
const inMorytaniaAnyFloor = (location) => MORYTANIA.some(({ z, ...box }) => inBox(location, box));

function snelm({ player, skill, kind }) {
  if (skill !== api.core.Skill.CRAFTING || kind !== "snelms") return;
  const location = player.getLocation();
  // Wiki (Morytania Diary): "Must be done outside of Mort Myre Swamp".
  if (inMorytania(location) && !inBox(location, MORT_MYRE)) emit(player, TASKS.snelm);
}

function troubleBrewing({ player }) {
  if (player) emit(player, TASKS.troubleBrewing);
}

function swampBoaty({ player, from }) {
  if (from === "hollows") emit(player, TASKS.swampBoaty);
}

function guthixBalance({ player, itemId }) {
  if (!GUTHIX_BALANCE.has(itemId)) return;
  if (inMorytaniaAnyFloor(player.getLocation())) emit(player, TASKS.guthixBalance);
}

function barehandShark({ player, skill, itemId, barehand }) {
  if (skill !== api.core.Skill.FISHING || itemId !== api.core.ItemIdentifiers.RAW_SHARK) return;
  if (barehand !== true || !inBox(player.getLocation(), BURGH_DE_ROTT)) return;
  emit(player, TASKS.barehandShark);
}

module.exports = {
  name: "MorytaniaActivitiesDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    api.onCustomEvent("skills:produced", snelm);
    api.onCustomEvent("trouble-brewing:completed", troubleBrewing);
    api.onCustomEvent("transport:swamp-boaty", swampBoaty);
    api.onCustomEvent("herblore:made", guthixBalance);
    api.onCustomEvent("fishing:success", barehandShark);
  },
  _test: { TASKS, inMorytania, inBox, MORYTANIA, BURGH_DE_ROTT, GUTHIX_BALANCE, snelm, troubleBrewing, swampBoaty, guthixBalance, barehandShark },
};
