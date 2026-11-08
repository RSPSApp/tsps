/**
 * Diary rewards that note an NPC's drops, marked on "npc-drops:roll" the way
 * NotedDrops.FremennikDiary.js does (OSRS Wiki, each diary page and the NPC's own):
 * - Desert, easy: the goats and billy goats' horns (Goat, Billy Goat; Desert Diary).
 * - Falador, hard: the Giant Mole's skin and claw (Giant Mole; Falador Diary).
 * - Karamja, elite: red dragonhide from the red dragons, and the bars of the bronze, iron and
 *   steel dragons, in the Brimhaven Dungeon (Karamja Diary).
 * - Wilderness, elite: the dragon bones of dragons killed in the Wilderness, except the King
 *   Black Dragon's (Wilderness Diary; Dragon bones).
 * The Wiki also lets Pirate Jackie the Fruit switch the bars off and the Lesser Fanatic switch
 * the Wilderness bones (and the lava dragon bones) off or on; those toggles are not here (no
 * capture of their lines, and the dialogue is generated), so the rewards are always on.
 */
const BRIMHAVEN_DUNGEON = { minX: 2600, maxX: 2760, minY: 9400, maxY: 9600 };
const KING_BLACK_DRAGON = "King Black Dragon";

let api;

/** Each rule: the diary tier that earns it, the drops it notes, and where/for whom (all optional). Built on the first roll. */
let rules = null;

function buildRules() {
  const I = api.core.ItemIdentifiers;
  return [
    { diary: "desert", tier: "easy", npcs: ["Goat", "Billy Goat"], items: [I.GOAT_HORN] },
    { diary: "falador", tier: "hard", npcs: ["Giant Mole"], items: [I.MOLE_SKIN, I.MOLE_CLAW] },
    { diary: "karamja", tier: "elite", npcs: ["Red dragon"], items: [I.RED_DRAGONHIDE], area: BRIMHAVEN_DUNGEON },
    {
      diary: "karamja", tier: "elite", npcs: ["Bronze dragon", "Iron dragon", "Steel dragon"],
      items: [I.BRONZE_BAR, I.IRON_BAR, I.STEEL_BAR], area: BRIMHAVEN_DUNGEON,
    },
    { diary: "wilderness", tier: "elite", items: [I.DRAGON_BONES], wilderness: true, exceptNpcs: [KING_BLACK_DRAGON] },
  ];
}

function npcName(npc) {
  return (npc?.getCurrentDefinition?.() ?? npc?.getDefinition?.())?.getName?.() ?? "";
}

function inArea(location, box) {
  const x = location?.getX?.();
  const y = location?.getY?.();
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

function tierComplete(player, rule) {
  const request = { player, diary: rule.diary, tier: rule.tier, complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function applies(rule, player, npc, name, itemId) {
  if (!rule.items.includes(itemId)) return false;
  if (rule.npcs && !rule.npcs.includes(name)) return false;
  if (rule.exceptNpcs?.includes(name)) return false;
  const location = npc?.getLocation?.();
  if (rule.area && !inArea(location, rule.area)) return false;
  if (rule.wilderness && !api.core.Wilderness.isInLocation(location)) return false;
  return tierComplete(player, rule);
}

/** Marks the rolled drops a completed diary tier notes. */
function notedDrops({ player, npc, drops }) {
  if (player?.isPlayer?.() !== true) return;
  rules ??= buildRules();
  const name = npcName(npc);
  for (const drop of drops) {
    if (drop.noted !== true && rules.some((rule) => applies(rule, player, npc, name, drop.itemId))) drop.noted = true;
  }
}

module.exports = (pluginApi) => {
  api = pluginApi;
  rules = null;
  api.onCustomEvent("npc-drops:roll", notedDrops);
};
module.exports._test = { notedDrops };
