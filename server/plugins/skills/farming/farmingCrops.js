/**
 * Crop catalog: seed to level, experience, harvest and pot mappings.
 *
 * Levels, planting/harvest/check-health experience and disease chances are the
 * classic OSRS values (ported from Void's data files, GregHib/void BSD-3, and the
 * OSRS wiki). Growth times come from the patch type cycle (farmingPatches).
 */
module.exports = function buildCrops(core) {
    const { ItemIdentifiers } = core;

    const I = ItemIdentifiers;

    // kind: produce = single produce pick, bush/fruit/cactus regrow produce after a
    // pause; tree/spirit/calquat are check-health trees; belladonna and mushroom
    // are picked empty.
    const CROPS = [
        // Allotments
        { produce: "POTATO", patch: "ALLOTMENT", name: "potato", seed: I.POTATO_SEED, product: I.POTATO, level: 1, plantXp: 8, harvestXp: 9, disease: 30 },
        { produce: "ONION", patch: "ALLOTMENT", name: "onion", seed: I.ONION_SEED, product: I.ONION, level: 5, plantXp: 9.5, harvestXp: 10.5, disease: 30 },
        { produce: "CABBAGE", patch: "ALLOTMENT", name: "cabbage", seed: I.CABBAGE_SEED, product: I.CABBAGE, level: 7, plantXp: 10, harvestXp: 11.5, disease: 30 },
        { produce: "TOMATO", patch: "ALLOTMENT", name: "tomato", seed: I.TOMATO_SEED, product: I.TOMATO, level: 12, plantXp: 12.5, harvestXp: 14, disease: 30 },
        { produce: "SWEETCORN", patch: "ALLOTMENT", name: "sweetcorn", seed: I.SWEETCORN_SEED, product: I.SWEETCORN, level: 20, plantXp: 17, harvestXp: 19, disease: 30 },
        { produce: "STRAWBERRY", patch: "ALLOTMENT", name: "strawberry", seed: I.STRAWBERRY_SEED, product: I.STRAWBERRY, level: 31, plantXp: 26, harvestXp: 29, disease: 30 },
        { produce: "WATERMELON", patch: "ALLOTMENT", name: "watermelon", seed: I.WATERMELON_SEED, product: I.WATERMELON, level: 47, plantXp: 48.5, harvestXp: 54.4, disease: 30 },
        { produce: "SNAPE_GRASS", patch: "ALLOTMENT", name: "snape grass", seed: I.SNAPE_GRASS_SEED, product: I.SNAPE_GRASS, level: 61, plantXp: 82, harvestXp: 90.2, disease: 30 },
        // Flower patches
        { produce: "MARIGOLD", patch: "FLOWER", name: "marigold", seed: I.MARIGOLD_SEED, product: I.MARIGOLDS, level: 2, plantXp: 8.5, harvestXp: 47, disease: 30 },
        { produce: "ROSEMARY", patch: "FLOWER", name: "rosemary", seed: I.ROSEMARY_SEED, product: I.ROSEMARY, level: 11, plantXp: 12, harvestXp: 66.5, disease: 30 },
        { produce: "NASTURTIUM", patch: "FLOWER", name: "nasturtium", seed: I.NASTURTIUM_SEED, product: I.NASTURTIUMS, level: 24, plantXp: 19.5, harvestXp: 111, disease: 30 },
        { produce: "WOAD", patch: "FLOWER", name: "woad", seed: I.WOAD_SEED, product: I.WOAD_LEAF, level: 25, plantXp: 20.5, harvestXp: 115.5, disease: 30 },
        { produce: "LIMPWURT", patch: "FLOWER", name: "limpwurt", seed: I.LIMPWURT_SEED, product: I.LIMPWURT_ROOT, level: 26, plantXp: 21.5, harvestXp: 18.5, disease: 30 },
        { produce: "WHITE_LILY", patch: "FLOWER", name: "white lily", seed: I.WHITE_LILY_SEED, product: I.WHITE_LILY, level: 58, plantXp: 42, harvestXp: 250, disease: 30 },
        // Herbs
        { produce: "GUAM", patch: "HERB", name: "guam", seed: I.GUAM_SEED, product: I.GUAM_LEAF, level: 9, plantXp: 11, harvestXp: 12.5, disease: 27 },
        { produce: "MARRENTILL", patch: "HERB", name: "marrentill", seed: I.MARRENTILL_SEED, product: I.MARRENTILL, level: 14, plantXp: 13.5, harvestXp: 15, disease: 27 },
        { produce: "TARROMIN", patch: "HERB", name: "tarromin", seed: I.TARROMIN_SEED, product: I.TARROMIN, level: 19, plantXp: 16, harvestXp: 18, disease: 27 },
        { produce: "HARRALANDER", patch: "HERB", name: "harralander", seed: I.HARRALANDER_SEED, product: I.HARRALANDER, level: 26, plantXp: 21.5, harvestXp: 24, disease: 27 },
        { produce: "RANARR", patch: "HERB", name: "ranarr", seed: I.RANARR_SEED, product: I.RANARR_WEED, level: 32, plantXp: 27, harvestXp: 30.5, disease: 27 },
        { produce: "TOADFLAX", patch: "HERB", name: "toadflax", seed: I.TOADFLAX_SEED, product: I.TOADFLAX, level: 38, plantXp: 34, harvestXp: 38.5, disease: 27 },
        { produce: "IRIT", patch: "HERB", name: "irit", seed: I.IRIT_SEED, product: I.IRIT_LEAF, level: 44, plantXp: 43, harvestXp: 48.5, disease: 27 },
        { produce: "AVANTOE", patch: "HERB", name: "avantoe", seed: I.AVANTOE_SEED, product: I.AVANTOE, level: 50, plantXp: 54.5, harvestXp: 61.5, disease: 27 },
        { produce: "KWUARM", patch: "HERB", name: "kwuarm", seed: I.KWUARM_SEED, product: I.KWUARM, level: 56, plantXp: 69, harvestXp: 78, disease: 27 },
        { produce: "SNAPDRAGON", patch: "HERB", name: "snapdragon", seed: I.SNAPDRAGON_SEED, product: I.SNAPDRAGON, level: 62, plantXp: 87.5, harvestXp: 98.5, disease: 27 },
        { produce: "CADANTINE", patch: "HERB", name: "cadantine", seed: I.CADANTINE_SEED, product: I.CADANTINE, level: 67, plantXp: 106.5, harvestXp: 120, disease: 27 },
        { produce: "LANTADYME", patch: "HERB", name: "lantadyme", seed: I.LANTADYME_SEED, product: I.LANTADYME, level: 73, plantXp: 134.5, harvestXp: 151.5, disease: 27 },
        { produce: "DWARF_WEED", patch: "HERB", name: "dwarf weed", seed: I.DWARF_WEED_SEED, product: I.DWARF_WEED, level: 79, plantXp: 170.5, harvestXp: 192, disease: 27 },
        { produce: "TORSTOL", patch: "HERB", name: "torstol", seed: I.TORSTOL_SEED, product: I.TORSTOL, level: 85, plantXp: 199.5, harvestXp: 224.5, disease: 27 },
        // Hops
        { produce: "BARLEY", patch: "HOPS", name: "barley", seed: I.BARLEY_SEED, product: I.BARLEY, level: 3, plantXp: 8.5, harvestXp: 9.5, disease: 30 },
        { produce: "HAMMERSTONE", patch: "HOPS", name: "hammerstone", seed: I.HAMMERSTONE_SEED, product: I.HAMMERSTONE_HOPS, level: 4, plantXp: 9, harvestXp: 10, disease: 30 },
        { produce: "ASGARNIAN", patch: "HOPS", name: "asgarnian", seed: I.ASGARNIAN_SEED, product: I.ASGARNIAN_HOPS, level: 8, plantXp: 10.9, harvestXp: 12, disease: 30 },
        { produce: "JUTE", patch: "HOPS", name: "jute", seed: I.JUTE_SEED, product: I.JUTE_FIBRE, level: 13, plantXp: 13, harvestXp: 14.5, disease: 30 },
        { produce: "YANILLIAN", patch: "HOPS", name: "yanillian", seed: I.YANILLIAN_SEED, product: I.YANILLIAN_HOPS, level: 16, plantXp: 14.5, harvestXp: 16, disease: 30 },
        { produce: "KRANDORIAN", patch: "HOPS", name: "krandorian", seed: I.KRANDORIAN_SEED, product: I.KRANDORIAN_HOPS, level: 21, plantXp: 17.5, harvestXp: 19.5, disease: 30 },
        { produce: "WILDBLOOD", patch: "HOPS", name: "wildblood", seed: I.WILDBLOOD_SEED, product: I.WILDBLOOD_HOPS, level: 28, plantXp: 23, harvestXp: 26, disease: 30 },
        // Bushes (produce regrows; check-health first)
        { produce: "REDBERRIES", patch: "BUSH", kind: "bush", name: "redberry", seed: I.REDBERRY_SEED, product: I.REDBERRIES, level: 10, plantXp: 11.5, checkXp: 64, harvestXp: 4.5, disease: 20 },
        { produce: "CADAVABERRIES", patch: "BUSH", kind: "bush", name: "cadavaberry", seed: I.CADAVABERRY_SEED, product: I.CADAVABERRIES, level: 22, plantXp: 18, checkXp: 102.5, harvestXp: 7, disease: 20 },
        { produce: "DWELLBERRIES", patch: "BUSH", kind: "bush", name: "dwellberry", seed: I.DWELLBERRY_SEED, product: I.DWELLBERRIES, level: 36, plantXp: 31.5, checkXp: 177.5, harvestXp: 12, disease: 20 },
        { produce: "JANGERBERRIES", patch: "BUSH", kind: "bush", name: "jangerberry", seed: I.JANGERBERRY_SEED, product: I.JANGERBERRIES, level: 48, plantXp: 50.5, checkXp: 184.5, harvestXp: 19, disease: 20 },
        { produce: "WHITEBERRIES", patch: "BUSH", kind: "bush", name: "whiteberry", seed: I.WHITEBERRY_SEED, product: I.WHITE_BERRIES, level: 59, plantXp: 78, checkXp: 437.5, harvestXp: 29, disease: 20 },
        { produce: "POISON_IVY", patch: "BUSH", kind: "bush", name: "poison ivy", seed: I.POISON_IVY_SEED, product: I.POISON_IVY_BERRIES, level: 70, plantXp: 120, checkXp: 675, harvestXp: 45, disease: 0 },
        // Trees
        { produce: "OAK", patch: "TREE", kind: "tree", name: "oak", seed: I.ACORN, plant: I.OAK_SAPLING, roots: I.OAK_ROOTS, level: 15, plantXp: 14, checkXp: 467.3, disease: 17 },
        { produce: "WILLOW", patch: "TREE", kind: "tree", name: "willow", seed: I.WILLOW_SEED, plant: I.WILLOW_SAPLING, roots: I.WILLOW_ROOTS, level: 30, plantXp: 25, checkXp: 1456.5, disease: 15 },
        { produce: "MAPLE", patch: "TREE", kind: "tree", name: "maple", seed: I.MAPLE_SEED, plant: I.MAPLE_SAPLING, roots: I.MAPLE_ROOTS, level: 45, plantXp: 45, checkXp: 3403.4, disease: 13 },
        { produce: "YEW", patch: "TREE", kind: "tree", name: "yew", seed: I.YEW_SEED, plant: I.YEW_SAPLING, roots: I.YEW_ROOTS, level: 60, plantXp: 81, checkXp: 7069.9, disease: 11 },
        { produce: "MAGIC", patch: "TREE", kind: "tree", name: "magic", seed: I.MAGIC_SEED, plant: I.MAGIC_SAPLING, roots: I.MAGIC_ROOTS, level: 75, plantXp: 145.5, checkXp: 13768.3, disease: 9 },
        // Fruit trees (produce regrows)
        { produce: "APPLE", patch: "FRUIT_TREE", kind: "fruit", name: "apple", seed: I.APPLE_TREE_SEED, plant: I.APPLE_SAPLING, level: 27, plantXp: 22, checkXp: 1199.5, harvestXp: 8.5, disease: 18 },
        { produce: "BANANA", patch: "FRUIT_TREE", kind: "fruit", name: "banana", seed: I.BANANA_TREE_SEED, plant: I.BANANA_SAPLING, level: 33, plantXp: 28, checkXp: 1750.5, harvestXp: 10.5, disease: 18 },
        { produce: "ORANGE", patch: "FRUIT_TREE", kind: "fruit", name: "orange", seed: I.ORANGE_TREE_SEED, plant: I.ORANGE_SAPLING, level: 39, plantXp: 35.5, checkXp: 2470.2, harvestXp: 13.5, disease: 18 },
        { produce: "CURRY", patch: "FRUIT_TREE", kind: "fruit", name: "curry", seed: I.CURRY_TREE_SEED, plant: I.CURRY_SAPLING, level: 42, plantXp: 40, checkXp: 2906.9, harvestXp: 15, disease: 18 },
        { produce: "PINEAPPLE", patch: "FRUIT_TREE", kind: "fruit", name: "pineapple", seed: I.PINEAPPLE_SEED, plant: I.PINEAPPLE_SAPLING, level: 51, plantXp: 57, checkXp: 4605.7, harvestXp: 21.5, disease: 18 },
        { produce: "PAPAYA", patch: "FRUIT_TREE", kind: "fruit", name: "papaya", seed: I.PAPAYA_TREE_SEED, plant: I.PAPAYA_SAPLING, level: 57, plantXp: 72, checkXp: 6146.4, harvestXp: 27, disease: 18 },
        { produce: "PALM", patch: "FRUIT_TREE", kind: "fruit", name: "palm", seed: I.PALM_TREE_SEED, plant: I.PALM_SAPLING, level: 68, plantXp: 110.5, checkXp: 10150.1, harvestXp: 41.5, disease: 18 },
        // Spirit tree
        { produce: "SPIRIT_TREE", patch: "SPIRIT_TREE", kind: "spirit", name: "spirit tree", seed: I.SPIRIT_SEED, plant: I.SPIRIT_SAPLING, roots: I.SPIRIT_ROOTS, level: 83, plantXp: 199.5, checkXp: 19301, disease: 7 },
        // Special patches
        { produce: "CACTUS", patch: "CACTUS", kind: "cactus", name: "cactus", seed: I.CACTUS_SEED, product: I.CACTUS_SPINE, level: 55, plantXp: 66.5, checkXp: 374, harvestXp: 25, disease: 10 },
        { produce: "MUSHROOM", patch: "MUSHROOM", name: "bittercap mushroom", seed: I.MUSHROOM_SPORE, product: I.MUSHROOM, amount: 6, single: true, level: 53, plantXp: 61.5, harvestXp: 57.7, disease: 25 },
        { produce: "BELLADONNA", patch: "BELLADONNA", name: "belladonna", seed: I.BELLADONNA_SEED, product: I.CAVE_NIGHTSHADE, single: true, level: 63, plantXp: 91, harvestXp: 512, disease: 25 },
        { produce: "CALQUAT", patch: "CALQUAT", kind: "fruit", name: "calquat", seed: I.CALQUAT_TREE_SEED, plant: I.CALQUAT_SAPLING, amount: 6, level: 72, plantXp: 129.5, checkXp: 12096, harvestXp: 48.5, disease: 14 },
    ];

    const POTTED = [
        { seed: I.ACORN, seedling: I.OAK_SEEDLING, seedlingW: I.OAK_SEEDLING_W_, sapling: I.OAK_SAPLING },
        { seed: I.WILLOW_SEED, seedling: I.WILLOW_SEEDLING, seedlingW: I.WILLOW_SEEDLING_W_, sapling: I.WILLOW_SAPLING },
        { seed: I.MAPLE_SEED, seedling: I.MAPLE_SEEDLING, seedlingW: I.MAPLE_SEEDLING_W_, sapling: I.MAPLE_SAPLING },
        { seed: I.YEW_SEED, seedling: I.YEW_SEEDLING, seedlingW: I.YEW_SEEDLING_W_, sapling: I.YEW_SAPLING },
        { seed: I.MAGIC_SEED, seedling: I.MAGIC_SEEDLING, seedlingW: I.MAGIC_SEEDLING_W_, sapling: I.MAGIC_SAPLING },
        { seed: I.SPIRIT_SEED, seedling: I.SPIRIT_SEEDLING, seedlingW: I.SPIRIT_SEEDLING_W_, sapling: I.SPIRIT_SAPLING },
        { seed: I.APPLE_TREE_SEED, seedling: I.APPLE_SEEDLING, seedlingW: I.APPLE_SEEDLING_W_, sapling: I.APPLE_SAPLING },
        { seed: I.BANANA_TREE_SEED, seedling: I.BANANA_SEEDLING, seedlingW: I.BANANA_SEEDLING_W_, sapling: I.BANANA_SAPLING },
        { seed: I.ORANGE_TREE_SEED, seedling: I.ORANGE_SEEDLING, seedlingW: I.ORANGE_SEEDLING_W_, sapling: I.ORANGE_SAPLING },
        { seed: I.CURRY_TREE_SEED, seedling: I.CURRY_SEEDLING, seedlingW: I.CURRY_SEEDLING_W_, sapling: I.CURRY_SAPLING },
        { seed: I.PINEAPPLE_SEED, seedling: I.PINEAPPLE_SEEDLING, seedlingW: I.PINEAPPLE_SEEDLING_W_, sapling: I.PINEAPPLE_SAPLING },
        { seed: I.PAPAYA_TREE_SEED, seedling: I.PAPAYA_SEEDLING, seedlingW: I.PAPAYA_SEEDLING_W_, sapling: I.PAPAYA_SAPLING },
        { seed: I.PALM_TREE_SEED, seedling: I.PALM_SEEDLING, seedlingW: I.PALM_SEEDLING_W_, sapling: I.PALM_SAPLING },
        { seed: I.CALQUAT_TREE_SEED, seedling: I.CALQUAT_SEEDLING, seedlingW: I.CALQUAT_SEEDLING_W_, sapling: I.CALQUAT_SAPLING },
    ];

    const BY_PRODUCE = new Map(CROPS.map((crop) => [crop.produce, crop]));
    const BY_PLANT = new Map();
    const BY_SEED = new Map();
    for (const crop of CROPS) {
        BY_PLANT.set(crop.plant ?? crop.seed, crop);
        BY_SEED.set(crop.seed, crop);
    }

    const POTTED_BY_SEED = new Map(POTTED.map((entry) => [entry.seed, entry]));
    const SAPLING_BY_WATERED = new Map(POTTED.map((entry) => [entry.seedlingW, entry.sapling]));
    const WATERED_BY_SEEDLING = new Map(POTTED.map((entry) => [entry.seedling, entry.seedlingW]));

    // Supercompost comes from the "super" crops and tree roots.
    const SUPERCOMPOST_ITEMS = new Set([
        I.PINEAPPLE, I.WATERMELON, I.PALM_TREE_SEED, I.PAPAYA_FRUIT, I.COCONUT, I.MUSHROOM,
        I.POISON_IVY_BERRIES, I.JANGERBERRIES, I.WHITE_BERRIES, I.TOADFLAX, I.AVANTOE, I.KWUARM,
        I.SNAPDRAGON, I.CADANTINE, I.LANTADYME, I.DWARF_WEED, I.TORSTOL, I.OAK_ROOTS,
        I.WILLOW_ROOTS, I.MAPLE_ROOTS, I.YEW_ROOTS, I.MAGIC_ROOTS, I.CALQUAT_FRUIT,
    ]);

    // Items the leprechaun/bins accept for normal compost.
    const COMPOSTABLE_ITEMS = new Set([
        I.WEEDS, I.POTATO, I.ONION, I.CABBAGE, I.TOMATO, I.SWEETCORN, I.STRAWBERRY, I.WATERMELON,
        I.BARLEY, I.HAMMERSTONE_HOPS, I.ASGARNIAN_HOPS, I.JUTE_FIBRE, I.YANILLIAN_HOPS,
        I.KRANDORIAN_HOPS, I.WILDBLOOD_HOPS, I.MARIGOLDS, I.ROSEMARY, I.NASTURTIUMS, I.WOAD_LEAF,
        I.LIMPWURT_ROOT, I.REDBERRIES, I.CADAVABERRIES, I.DWELLBERRIES, I.JANGERBERRIES,
        I.WHITE_BERRIES, I.POISON_IVY_BERRIES, I.CACTUS_SPINE, I.GUAM_LEAF, I.MARRENTILL,
        I.TARROMIN, I.HARRALANDER, I.RANARR_WEED, I.IRIT_LEAF, I.AVANTOE, I.KWUARM, I.CADANTINE,
        I.DWARF_WEED, I.TORSTOL, I.TOADFLAX, I.SNAPDRAGON, I.LANTADYME,
    ]);

    return {
        CROPS,
        BY_PRODUCE,
        BY_PLANT,
        BY_SEED,
        POTTED,
        POTTED_BY_SEED,
        SAPLING_BY_WATERED,
        WATERED_BY_SEEDLING,
        SUPERCOMPOST_ITEMS,
        COMPOSTABLE_ITEMS,
    };
};
