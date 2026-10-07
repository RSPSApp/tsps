"use strict";

// OSRS requirements/rewards; the identifiers describe this server's rev237 cache.
// https://oldschool.runescape.wiki/w/Hunter
function build(core) {
  const { ItemIdentifiers: I, NpcIdentifiers: N, ObjectIdentifiers: O } = core;
  const traps = {
    bird: { level: 1, item: I.BIRD_SNARE, idle: O.BIRD_SNARE_2, fail: O.BIRD_SNARE, animation: 5208 },
    box: { level: 27, item: I.BOX_TRAP, idle: O.BOX_TRAP_5, fail: O.BOX_TRAP_7, animation: 5208 },
    magic: { level: 71, item: I.MAGIC_BOX, idle: O.MAGIC_BOX, fail: O.MAGIC_BOX_FAILED, animation: 5212 },
    deadfall: { level: 23, idle: O.DEADFALL, fail: O.BOULDER_14, animation: 5212, knife: true, logs: true, max: 2 },
    pit: { level: 31, idle: O.SPIKED_PIT, fail: O.COLLAPSED_TRAP, animation: 5212, knife: true, logs: true },
    orange: { level: 47, tree: O.YOUNG_TREE_2, idleTree: O.YOUNG_TREE, idle: O.NET_TRAP, fail: O.NET_TRAP_4, bait: I.MARRENTILL_TAR, animation: 5215 },
    red: { level: 59, tree: O.YOUNG_TREE_5, idleTree: O.YOUNG_TREE_4, idle: O.NET_TRAP_10, fail: O.NET_TRAP_9, bait: I.TARROMIN_TAR, animation: 5215 },
    black: { level: 67, tree: O.YOUNG_TREE_11, idleTree: O.YOUNG_TREE_10, idle: O.NET_TRAP_20, fail: O.NET_TRAP_14, bait: I.HARRALANDER_TAR, animation: 5215 },
    swamp: { level: 29, tree: O.YOUNG_TREE_8, idleTree: O.YOUNG_TREE_7, idle: O.NET_TRAP_15, fail: O.NET_TRAP_19, bait: I.GUAM_TAR, animation: 5215 },
    tecu: { level: 79, tree: O.YOUNG_TREE_14, idleTree: O.YOUNG_TREE_13, idle: O.NET_TRAP_25, fail: O.NET_TRAP_24, bait: I.IRIT_TAR, animation: 5215 },
    monkey: { level: 60, idle: O.LARGE_BOULDER_2, fail: O.LARGE_BOULDER, animation: 7259, max: 1, inputs: [[I.BANANA, 1]] },
    rabbit: { level: 27, item: I.RABBIT_SNARE, idle: O.RABBIT_SNARE, fail: O.RABBIT_SNARE, animation: 5208 },
  };
  const creatures = [
    // npc, trap, level, xp, caught loc, level-one / level-99 success thresholds, rewards
    [N.CRIMSON_SWIFT, "bird", 1, 34, O.BIRD_SNARE_7, 100, 420, [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1], [I.RED_FEATHER, 5, 10]]],
    [N.GOLDEN_WARBLER, "bird", 5, 47, O.BIRD_SNARE_11, 92, 400, [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1], [I.YELLOW_FEATHER, 5, 10]]],
    [N.COPPER_LONGTAIL, "bird", 9, 61.2, O.BIRD_SNARE_13, 85, 390, [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1], [I.ORANGE_FEATHER, 5, 10]]],
    [N.CERULEAN_TWITCH, "bird", 11, 64.5, O.BIRD_SNARE_9, 82, 380, [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1], [I.BLUE_FEATHER, 5, 10]]],
    [N.TROPICAL_WAGTAIL, "bird", 19, 95.2, O.BIRD_SNARE_5, 75, 370, [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1], [I.STRIPY_FEATHER, 5, 10]]],
    [N.FERRET, "box", 27, 115.2, O.SHAKING_BOX_4, 100, 420, [[I.FERRET, 1]]],
    [N.CHINCHOMPA, "box", 53, 198.4, O.SHAKING_BOX_2, 6, 268, [[I.CHINCHOMPA_2, 1]]],
    [N.CARNIVOROUS_CHINCHOMPA, "box", 63, 265, O.SHAKING_BOX_3, -78, 228, [[I.RED_CHINCHOMPA_2, 1]]],
    [N.BLACK_CHINCHOMPA, "box", 73, 315, O.SHAKING_BOX, -78, 228, [[I.BLACK_CHINCHOMPA, 1]]],
    [N.WILD_KEBBIT, "deadfall", 23, 102.4, O.BOULDER_19, 29, 385, [[I.BONES, 1], [I.KEBBIT_CLAWS, 1]]],
    [N.BARB_TAILED_KEBBIT, "deadfall", 33, 134.4, O.BOULDER_18, -220, 1037, [[I.BONES, 1], [I.BARB_TAIL_HARPOON, 1]]],
    [N.PRICKLY_KEBBIT, "deadfall", 37, 147.2, O.BOULDER_16, -70, 331, [[I.BONES, 1], [I.KEBBIT_SPIKE, 1]]],
    [N.SABRE_TOOTHED_KEBBIT, "deadfall", 51, 160, O.BOULDER_17, -434, 820, [[I.BONES, 1], [I.KEBBIT_TEETH, 1]]],
    [N.SWAMP_LIZARD, "swamp", 29, 152, O.NET_TRAP_17, 52, 360, [[I.SWAMP_LIZARD, 1]]],
    [N.ORANGE_SALAMANDER, "orange", 47, 224, O.NET_TRAP_2, 16, 288, [[I.ORANGE_SALAMANDER, 1]]],
    [N.RED_SALAMANDER, "red", 59, 272, O.NET_TRAP_7, 0, 240, [[I.RED_SALAMANDER, 1]]],
    [N.BLACK_SALAMANDER, "black", 67, 319.2, O.NET_TRAP_12, 0, 212, [[I.BLACK_SALAMANDER, 1]]],
    [N.SPINED_LARUPIA, "pit", 31, 180, O.COLLAPSED_TRAP_4, 40, 256, [[I.BIG_BONES, 1], [I.LARUPIA_FUR, 1]]],
    [N.HORNED_GRAAHK, "pit", 41, 240, O.COLLAPSED_TRAP_3, 0, 256, [[I.BIG_BONES, 1], [I.GRAAHK_FUR, 1]]],
    [N.SABRE_TOOTHED_KYATT, "pit", 55, 300, O.COLLAPSED_TRAP_5, -40, 256, [[I.BIG_BONES, 1], [I.KYATT_FUR, 1]]],
    [N.IMP, "magic", 71, 450, O.MAGIC_BOX_3, 0, 197, [[I.IMP_IN_A_BOX_2_, 1]]],
    [N.EMBERTAILED_JERBOA, "box", 39, 137, O.SHAKING_BOX_5, 6, 268, [[I.JERBOA_TAIL, 1]]],
    [N.PYRE_FOX, "deadfall", 57, 177.6, O.BOULDER_36, -475, 750, [[I.BONES, 1], [I.RAW_PYRE_FOX, 1], [I.FOX_FUR, 1]]],
    [N.TECU_SALAMANDER, "tecu", 79, 344, O.NET_TRAP_22, 1, 212, [[I.IMMATURE_TECU_SALAMANDER, 1]]],
    [N.SUNLIGHT_ANTELOPE, "pit", 72, 380, O.COLLAPSED_TRAP_9, 255, 255,
      [[I.BIG_BONES, 1], [I.SUNLIGHT_ANTELOPE_ANTLER, 1], [I.SUNLIGHT_ANTELOPE_FUR, 1], [I.RAW_SUNLIGHT_ANTELOPE, 1], [I.SUNFIRE_SPLINTERS, 2, 6]]],
    [N.MOONLIGHT_ANTELOPE, "pit", 91, 450, O.COLLAPSED_TRAP_9, 255, 255,
      [[I.BIG_BONES, 1], [I.MOONLIGHT_ANTELOPE_ANTLER, 1], [I.MOONLIGHT_ANTELOPE_FUR, 1], [I.RAW_MOONLIGHT_ANTELOPE, 1]]],
    [N.MANIACAL_MONKEY_3, "monkey", 60, 1000, O.LARGE_BOULDER_4, -79, 227, [[I.DAMAGED_MONKEY_TAIL, 1]]],
  ].map(([npc, trap, level, xp, caught, low, high, loot]) => ({ npc, trap, level, xp, caught, low, high, loot }));
  const butterflies = [
    [N.RUBY_HARVEST, I.RUBY_HARVEST, 15, 24, 25, 44, core.Skill.ATTACK],
    [N.SAPPHIRE_GLACIALIS, I.SAPPHIRE_GLACIALIS, 25, 34, 35, 54, core.Skill.DEFENCE],
    [N.SNOWY_KNIGHT, I.SNOWY_KNIGHT, 35, 44, 45, 64, core.Skill.HITPOINTS],
    [N.BLACK_WARLOCK, I.BLACK_WARLOCK, 45, 54, 55, 74, core.Skill.STRENGTH],
  ].map(([npc, jar, level, xp, hands, handsXp, boost]) => ({ npc, jar, level, xp, hands, handsXp, boost, low: 20, high: 296 }));
  butterflies.push(
    { npc: N.SUNLIGHT_MOTH, jar: I.SUNLIGHT_MOTH_2, level: 65, hands: 75, xp: 74, handsXp: 94, boost: "restore", low: 20, high: 296, handsLow: 20, handsHigh: 296 },
    { npc: N.MOONLIGHT_MOTH, jar: I.MOONLIGHT_MOTH_2, level: 75, hands: 85, xp: 84, handsXp: 104, boost: core.Skill.PRAYER, low: 0, high: 276, handsLow: 20, handsHigh: 286 });
  const implings = [
    ["BABY", 17, 27, 20, 18, 79, 402], ["YOUNG", 22, 32, 22, 20, 69, 351],
    ["GOURMET", 28, 38, 24, 22, 61, 325], ["EARTH", 36, 46, 27, 25, 51, 302],
    ["ESSENCE", 42, 52, 29, 27, 40, 275], ["ECLECTIC", 50, 60, 32, 30, 30, 250],
    ["NATURE", 58, 68, 36, 34, 20, 200], ["MAGPIE", 65, 75, 216, 44, 15, 177],
    ["NINJA", 74, 84, 240, 50, 10, 151], ["DRAGON", 83, 93, 300, 65, 5, 125],
    ["CRYSTAL", 80, 90, 280, 280, 8, 141], ["LUCKY", 89, 99, 380, 80, 3, 100],
  ].map(([key, level, hands, xp, puroXp, low, high]) => ({ key, level, hands, xp, puroXp, low, high, jar: I[`${key}_IMPLING_JAR`],
    npcs: Object.entries(N).filter(([name]) => new RegExp(`^${key}_IMPLING(?:_\\d+)?$`).test(name)).map(([, id]) => id) }));
  const falconry = [
    [N.SPOTTED_KEBBIT, 43, 104, I.SPOTTED_KEBBIT_FUR, N.GYR_FALCON],
    [N.DARK_KEBBIT, 57, 132, I.DARK_KEBBIT_FUR, N.GYR_FALCON_2],
    [N.DASHING_KEBBIT, 69, 156, I.DASHING_KEBBIT_FUR, N.GYR_FALCON_3],
  ].map(([npc, level, xp, fur, falcon]) => ({ npc, level, xp, fur, falcon, low: npc === N.SPOTTED_KEBBIT ? 26 : 0, high: npc === N.SPOTTED_KEBBIT ? 310 : npc === N.DARK_KEBBIT ? 253 : 205 }));
  const birdhouses = [
    [I.BIRD_HOUSE, I.LOGS, 5, 5, 15, 112], [I.OAK_BIRD_HOUSE, I.OAK_LOGS, 15, 14, 20, 168],
    [I.WILLOW_BIRD_HOUSE, I.WILLOW_LOGS, 25, 24, 25, 224], [I.TEAK_BIRD_HOUSE, I.TEAK_LOGS, 35, 34, 30, 280],
    [I.MAPLE_BIRD_HOUSE, I.MAPLE_LOGS, 45, 44, 35, 369], [I.MAHOGANY_BIRD_HOUSE, I.MAHOGANY_LOGS, 50, 49, 40, 480],
    [I.YEW_BIRD_HOUSE, I.YEW_LOGS, 60, 59, 45, 612], [I.MAGIC_BIRD_HOUSE, I.MAGIC_LOGS, 75, 74, 50, 969],
    [I.REDWOOD_BIRD_HOUSE, I.REDWOOD_LOGS, 90, 89, 55, 1200],
  ].map(([item, logs, crafting, level, craftXp, xp], index) => ({ item, logs, crafting, level, craftXp, xp, index }));
  const aerialFish = [
    [I.BLUEGILL, 35, 43, 16.5, 11.5, 3.5], [I.COMMON_TENCH, 51, 56, 45, 40, 10],
    [I.MOTTLED_EEL, 68, 73, 90, 65, 20], [I.GREATER_SIREN, 87, 91, 130, 100, 25],
  ].map(([item, hunter, fishing, hunterXp, fishingXp, cookingXp]) => ({ item, hunter, fishing, hunterXp, fishingXp, cookingXp }));
  const data = { traps, creatures, butterflies, implings, falconry, birdhouses, aerialFish };
  // Fail on a stale enum at startup instead of creating invalid items/objects in-game.
  for (const value of [...creatures.map(c => [c.npc, c.caught, ...c.loot.map(l => l[0])]),
    ...butterflies.map(c => [c.npc, c.jar]), ...implings.map(c => [c.jar, ...c.npcs]),
    ...falconry.map(c => [c.npc, c.fur, c.falcon]), ...birdhouses.map(c => [c.item, c.logs]), ...aerialFish.map(c => [c.item])].flat()) {
    if (!Number.isInteger(value)) throw new Error("Hunter data references an unavailable cache identifier");
  }
  return data;
}

module.exports = { build };
