const core = require("./Core.Farming");
const fs = require("fs");
const path = require("path");

const CACHE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "farming-data.json"), "utf8"));

// Gameplay tables: https://oldschool.runescape.wiki/w/Seeds and each linked crop.
// Names resolve against this server's cache, excluding notes and placeholders.
const ROWS = [
    ["POTATO", "Potato seed", "Potato", 1, 8, 9, 0, [["Compost", 2]], 3],
    ["ONION", "Onion seed", "Onion", 5, 9.5, 10.5, 0, [["Potatoes(10)", 1]], 3],
    ["CABBAGE", "Cabbage seed", "Cabbage", 7, 10, 11.5, 0, [["Onions(10)", 1]], 3],
    ["TOMATO", "Tomato seed", "Tomato", 12, 12.5, 14, 0, [["Cabbages(10)", 2]], 3],
    ["SWEETCORN", "Sweetcorn seed", "Sweetcorn", 20, 17, 19, 0, [["Jute fibre", 10]], 3],
    ["STRAWBERRY", "Strawberry seed", "Strawberry", 31, 26, 29, 0, [["Apples(5)", 1]], 3],
    ["WATERMELON", "Watermelon seed", "Watermelon", 47, 48.5, 54.5, 0, [["Curry leaf", 10]], 3],
    ["SNAPE_GRASS", "Snape grass seed", "Snape grass", 61, 82, 82, 0, [["Jangerberries", 5]], 3],
    ["MARIGOLD", "Marigold seed", "Marigolds", 2, 8.5, 47],
    ["ROSEMARY", "Rosemary seed", "Rosemary", 11, 12, 66.5],
    ["NASTURTIUM", "Nasturtium seed", "Nasturtiums", 24, 19.5, 111],
    ["WOAD", "Woad seed", "Woad leaf", 25, 20.5, 115.5],
    ["LIMPWURT", "Limpwurt seed", "Limpwurt root", 26, 21.5, 120],
    ["WHITE_LILY", "White lily seed", "White lily", 58, 42, 250],
    ["BARLEY", "Barley seed", "Barley", 3, 8.5, 9.5, 0, [["Compost", 3]], 4],
    ["HAMMERSTONE", "Hammerstone seed", "Hammerstone hops", 4, 9, 10, 0, [["Marigolds", 1]], 4],
    ["ASGARNIAN", "Asgarnian seed", "Asgarnian hops", 8, 10.9, 12, 0, [["Onions(10)", 1]], 4],
    ["JUTE", "Jute seed", "Jute fibre", 13, 13, 14.5, 0, [["Barley malt", 6]], 3],
    ["YANILLIAN", "Yanillian seed", "Yanillian hops", 16, 14.5, 16, 0, [["Tomatoes(5)", 1]], 4],
    ["FLAX", "Flax seed", "Flax", 18, 16, 17.5, 0, [["Grain", 6]], 3],
    ["KRANDORIAN", "Krandorian seed", "Krandorian hops", 21, 17.5, 19.5, 0, [["Cabbages(10)", 3]], 4],
    ["WILDBLOOD", "Wildblood seed", "Wildblood hops", 28, 23, 26, 0, [["Nasturtiums", 1]], 4],
    ["HEMP", "Hemp seed", "Hemp", 37, 33, 37, 0, [["Flax", 6]], 3],
    ["COTTON", "Cotton seed", "Cotton boll", 71, 72, 82, 0, [["Hemp", 6]], 3],
    ["GUAM", "Guam seed", "Grimy guam leaf", 9, 11, 12.5],
    ["MARRENTILL", "Marrentill seed", "Grimy marrentill", 14, 13.5, 15],
    ["TARROMIN", "Tarromin seed", "Grimy tarromin", 19, 16, 18],
    ["HARRALANDER", "Harralander seed", "Grimy harralander", 26, 21.5, 24],
    ["RANARR", "Ranarr seed", "Grimy ranarr weed", 32, 27, 30.5],
    ["TOADFLAX", "Toadflax seed", "Grimy toadflax", 38, 34, 38.5],
    ["IRIT", "Irit seed", "Grimy irit leaf", 44, 43, 48.5],
    ["AVANTOE", "Avantoe seed", "Grimy avantoe", 50, 54.5, 61.5],
    ["KWUARM", "Kwuarm seed", "Grimy kwuarm", 56, 69, 78],
    ["SNAPDRAGON", "Snapdragon seed", "Grimy snapdragon", 62, 87.5, 98.5],
    ["HUASCA", "Huasca seed", "Grimy huasca", 65, 86.5, 110],
    ["CADANTINE", "Cadantine seed", "Grimy cadantine", 67, 106.5, 120],
    ["LANTADYME", "Lantadyme seed", "Grimy lantadyme", 73, 134.5, 151.5],
    ["DWARF_WEED", "Dwarf weed seed", "Grimy dwarf weed", 79, 170.5, 192],
    ["TORSTOL", "Torstol seed", "Grimy torstol", 85, 199.5, 224.5],
    ["GOUTWEED", "Gout tuber", "Goutweed", 29, 105, 45],
    ["REDBERRIES", "Redberry seed", "Redberries", 10, 11.5, 4.5, 64, [["Cabbages(10)", 4]]],
    ["CADAVABERRIES", "Cadavaberry seed", "Cadava berries", 22, 18, 7, 102.5, [["Tomatoes(5)", 3]]],
    ["DWELLBERRIES", "Dwellberry seed", "Dwellberries", 36, 31.5, 12, 177.5, [["Strawberries(5)", 3]]],
    ["JANGERBERRIES", "Jangerberry seed", "Jangerberries", 48, 50.5, 19, 284.5, [["Watermelon", 6]]],
    ["WHITEBERRIES", "Whiteberry seed", "White berries", 59, 78, 29, 437.5, [["Mushroom", 8]]],
    ["POISON_IVY", "Poison ivy seed", "Poison ivy berries", 70, 120, 45, 675],
    ["OAK", "Acorn", "Oak logs", 15, 14, 0, 467.3, [["Tomatoes(5)", 1]]],
    ["WILLOW", "Willow seed", "Willow logs", 30, 25, 0, 1456.5, [["Apples(5)", 1]]],
    ["MAPLE", "Maple seed", "Maple logs", 45, 45, 0, 3403.4, [["Oranges(5)", 1]]],
    ["YEW", "Yew seed", "Yew logs", 60, 81, 0, 7069.9, [["Cactus spine", 10]]],
    ["MAGIC", "Magic seed", "Magic logs", 75, 145.5, 0, 13768.3, [["Coconut", 25]]],
    ["APPLE", "Apple tree seed", "Cooking apple", 27, 22, 8.5, 1199.5, [["Sweetcorn", 9]]],
    ["BANANA", "Banana tree seed", "Banana", 33, 28, 10.5, 1750.5, [["Apples(5)", 4]]],
    ["ORANGE", "Orange tree seed", "Orange", 39, 35.5, 13.5, 2470.2, [["Strawberries(5)", 3]]],
    ["CURRY", "Curry tree seed", "Curry leaf", 42, 40, 15, 2906.9, [["Bananas(5)", 5]]],
    ["PINEAPPLE", "Pineapple seed", "Pineapple", 51, 57, 21.5, 4605.7, [["Watermelon", 10]]],
    ["PAPAYA", "Papaya tree seed", "Papaya fruit", 57, 72, 27, 6146.4, [["Pineapple", 10]]],
    ["PALM", "Palm tree seed", "Coconut", 68, 110.5, 41.5, 10150.1, [["Papaya fruit", 15]]],
    ["DRAGONFRUIT", "Dragonfruit tree seed", "Dragonfruit", 81, 140, 70, 17335, [["Coconut", 15]]],
    ["TEAK", "Teak seed", "Teak logs", 35, 35, 0, 7290, [["Limpwurt root", 15]]],
    ["MAHOGANY", "Mahogany seed", "Mahogany logs", 55, 63, 0, 15720, [["Yanillian hops", 25]]],
    ["CAMPHOR", "Camphor seed", "Camphor logs", 66, 88, 0, 17840, [["White berries", 10]]],
    ["IRONWOOD", "Ironwood seed", "Ironwood logs", 80, 145, 0, 20380, [["Curry leaf", 10]]],
    ["ROSEWOOD", "Rosewood seed", "Rosewood logs", 92, 252, 0, 23100, [["Dragonfruit", 8]]],
    ["CACTUS", "Cactus seed", "Cactus spine", 55, 66.5, 25, 374, [["Cadava berries", 6]]],
    ["POTATO_CACTUS", "Potato cactus seed", "Potato cactus", 64, 68, 68, 230, [["Snape grass", 8]]],
    ["SEAWEED", "Seaweed spore", "Giant seaweed", 23, 19, 21, 0, [["Numulite", 200]]],
    ["MUSHROOM", "Mushroom spore", "Mushroom", 53, 61.5, 57.7],
    ["BELLADONNA", "Belladonna seed", "Nightshade", 63, 91, 512],
    ["GRAPE", "Grape seed", "Grapes", 36, 31.5, 40, 625],
    ["CALQUAT", "Calquat tree seed", "Calquat fruit", 72, 129.5, 48.5, 12096, [["Poison ivy berries", 8]]],
    ["SPIRIT_TREE", "Spirit seed", "", 83, 199.5, 0, 19301.8, [["Monkey nuts", 5], ["Monkey bar", 1], ["Ground tooth", 1]]],
    ["CELASTRUS", "Celastrus seed", "Celastrus bark", 85, 204, 23.5, 14130, [["Potato cactus", 8]]],
    ["REDWOOD", "Redwood tree seed", "Redwood logs", 90, 230, 0, 22450, [["Dragonfruit", 6]]],
    ["CRYSTAL_TREE", "Crystal acorn", "Crystal shard", 74, 126, 0, 13240],
    ["ATTAS", "Attas seed", "", 76, 100, 0],
    ["IASOR", "Iasor seed", "", 76, 100, 0],
    ["KRONOS", "Kronos seed", "", 76, 100, 0],
    ["HESPORI", "Hespori seed", "", 65, 62, 12600],
    ["ELKHORN_CORAL", "Elkhorn frag", "Elkhorn coral", 28, 20.5, 24, 0, [["Giant seaweed", 5]]],
    ["PILLAR_CORAL", "Pillar frag", "Pillar coral", 52, 52.5, 60, 0, [["Elkhorn coral", 5]]],
    ["UMBRAL_CORAL", "Umbral frag", "Umbral coral", 77, 136, 159, 0, [["Pillar coral", 5]]],
];

const CROPS = new Map();
const SEEDS = new Map();
const WATERED_SEEDLINGS = new Map();
const ITEMS = new Map();
// Published protective families, not a name/armour-stat heuristic. Matching cache variants
// (for example Graceful recolours) are resolved below; decorative gloves are not implied safe.
// https://oldschool.runescape.wiki/w/Belladonna#Gloves
const BELLADONNA_HANDWEAR_NAMES = new Set([
    "Grey gloves", "Purple gloves", "Red gloves", "Teal gloves", "Yellow gloves",
    "Hardleather gloves", "Bronze gloves", "Iron gloves", "Steel gloves", "Black gloves",
    "Mithril gloves", "Adamant gloves", "Rune gloves", "Dragon gloves", "Barrows gloves",
    "Steel gauntlets", "Chaos gauntlets", "Cooking gauntlets", "Goldsmith gauntlets",
    "Fremennik gloves", "Rock-shell gloves", "Skeletal gloves", "Spined gloves",
    "Karamja gloves 1", "Karamja gloves 2", "Karamja gloves 3", "Karamja gloves 4",
    "Moonclan gloves", "Ghostly gloves", "Mystic gloves", "Mystic gloves (dark)",
    "Mystic gloves (dusk)", "Mystic gloves (light)", "Mystic gloves (or)", "Gloves of darkness",
    "Splitbark gauntlets", "Infinity gloves", "Swampbark gauntlets", "Bloodbark gauntlets", "Lunar gloves",
    "Shayzien gloves (1)", "Shayzien gloves (2)", "Shayzien gloves (3)", "Shayzien gloves (4)", "Shayzien gloves (5)",
    "Expert mining gloves", "Gloves of silence", "Graceful gloves", "Mining gloves", "Rogue gloves",
    "Slayer gloves", "Smiths gloves", "Superior mining gloves",
    "Leather vambraces", "Group ironman bracers", "Group ironman bracers (unranked)",
    "Hardcore group ironman bracers", "Spiky vambraces", "Snakeskin vambraces",
    "Green d'hide vambraces", "Green spiky vambraces", "Blue d'hide vambraces", "Blue spiky vambraces",
    "Gilded d'hide vambraces", "Red d'hide vambraces", "Red spiky vambraces", "3rd age vambraces",
    "Black d'hide vambraces", "Black spiky vambraces", "Ancient bracers", "Armadyl bracers", "Bandos bracers",
    "Guthix bracers", "Saradomin bracers", "Zamorak bracers", "Hueycoatl hide vambraces", "Zaryte vambraces",
    "Clue hunter gloves", "Crab claw", "Crabclaw hook", "Dragonstone gauntlets", "Ferocious gloves",
    "Granite gloves", "Ham gloves", "Ice gloves", "Klank's gauntlets", "Leather gloves", "Mourner gloves",
    "Mummy's hands", "Ornate gloves", "Penance gloves", "Pirate's hook", "Ranger gloves", "Regen bracelet",
    "Samurai gloves", "Twitcher's gloves", "Void knight gloves", "Void knight gloves (or)", "White gloves",
].map(name => name.toLowerCase()));
const BELLADONNA_HANDWEAR = new Set();
function itemId(name) {
    if (!name) return -1;
    const id = ITEMS.get(name.toLowerCase());
    if (id === undefined) throw new Error(`Farming: missing cache item ${name}`);
    return id;
}
function initializeFarmingData() {
    if (CROPS.size) return;
    for (let id = 0; id < core.CacheDefinitions.getCounts().items; id++) {
        const item = core.CacheDefinitions.getItem(id);
        if (item.noteTemplate >= 0 || item.placeholderTemplate >= 0 || !item.name || item.name === "null") continue;
        if (item.wearPos === core.Equipment.HANDS_SLOT && BELLADONNA_HANDWEAR_NAMES.has(item.name.toLowerCase())) BELLADONNA_HANDWEAR.add(id);
        if (!ITEMS.has(item.name.toLowerCase())) ITEMS.set(item.name.toLowerCase(), id);
    }
    for (const [key, seed, produce, level, plant, harvest, check = 0, payment = [], seedCount = 1] of ROWS) {
        const timing = CACHE.timing[key];
        if (!timing) throw new Error(`Farming: missing timing ${key}`);
        const crop = { ...timing, key, seed: itemId(seed), produce: itemId(produce), level, plant, harvest, check,
            payment: payment.map(([name, count]) => [itemId(name), count]), seedCount };
        if (["TREE", "FRUIT_TREE", "HARDWOOD_TREE", "CALQUAT", "SPIRIT_TREE", "CELASTRUS", "REDWOOD", "CRYSTAL_TREE"].includes(crop.type)) {
            const prefix = ({ SPIRIT_TREE: "Spirit", CRYSTAL_TREE: "Crystal" })[key] ?? timing.name;
            crop.sapling = itemId(`${prefix} sapling`);
            crop.seedling = itemId(`${prefix} seedling`);
            crop.wateredSeedling = itemId(`${prefix} seedling (w)`);
            SEEDS.set(crop.sapling, crop);
            WATERED_SEEDLINGS.set(crop.wateredSeedling, crop);
        } else SEEDS.set(crop.seed, crop);
        CROPS.set(key, crop);
    }
    // Wiki (Auguste's sapling): Enlightened Journey's sapling goes in a tree patch and grows into a willow tree, with
    // the willow's level, payment, times and experience; the quest words its planting ("farming:plant-rules").
    SEEDS.set(itemId("Auguste's sapling"), CROPS.get("WILLOW"));
}

const patchKey = (patch) => `${patch.id}:${patch.x}:${patch.y}:${patch.z}`;
// A patch's x/y is its first loc and the key its saved state lives under, so they never move. An
// L-shaped patch (Hosidius's north allotment) can have locs below or left of that one: the data
// then carries `minX`/`minY`, the real corner. Every bounds check goes through these two.
const patchMinX = (patch) => patch.minX ?? patch.x;
const patchMinY = (patch) => patch.minY ?? patch.y;
const WATERABLE = new Set(["ALLOTMENT", "FLOWER", "HOPS"]);
const COMPOSTABLE_YIELD = new Set(["ALLOTMENT", "HOPS", "HERB", "SEAWEED", "CELASTRUS"]);
const WOOD_TREES = new Set(["TREE", "HARDWOOD_TREE", "REDWOOD"]);

/**
 * The Farming model's rates and timings. Published values cite the OSRS Wiki;
 * `unpublished` entries are this server's explicit estimates, never claimed as OSRS-exact.
 * Keeping them here stops the growth/disease/yield formulas from carrying bare numbers.
 */
const FORMULAS = {
    disease: {
        // https://oldschool.runescape.wiki/w/Disease_(Farming): chance per growth cycle.
        // The numerator includes the roll of zero (herbs are 27/128, not 26/128).
        perCrop: { HERB: 27, FRUIT_TREE: 18, MAPLE: 13, MAGIC: 9, CORAL: 8 },
        // ponytail: the Wiki publishes no rate for other crops; replace when one is measured.
        unpublished: 16,
        denominator: 128,
        // Compost 50%, supercompost 80%, ultracompost 90% (rounded down to 1/128).
        compostMultipliers: [1, 0.5, 0.2, 0.1],
        // Mod Ash: Iasor reduces the chance to 20% of what it would have been.
        iasorMultiplier: 0.2,
        // ponytail: watering is documented as a per-crop reduction with no published formula.
        wateredMultiplier: 0.5,
    },
    yield: {
        // https://oldschool.runescape.wiki/w/Farming#Variable_crop_yield
        denominator: 256,
        secateursMultiplier: 0.10,
        farmingCapeMultiplier: 0.05,
        attasMultiplier: 0.05,
    },
    // ponytail: the Kronos page documents the shared skip but not its probability.
    kronosStageSkipChance: 0.1,
    kronosMaxStageSkips: 12,
    // ponytail: only the training failure is documented; its probability is not.
    barbarianPlantFailureChance: 0.5,
    // https://oldschool.runescape.wiki/w/Disease_(Farming): pruning succeeds 75% of the time.
    pruneFailureChance: 0.25,
    // https://oldschool.runescape.wiki/w/Amulet_of_bounty: 25% chance to use one seed.
    amuletOfBountySaveChance: 0.25,
    // https://oldschool.runescape.wiki/w/Belladonna: 6 plus a level-scaled roll.
    // ponytail: the individual roll's distribution is unpublished.
    belladonna: { base: 6, levelStep: 8 },
    growth: {
        // https://oldschool.runescape.wiki/w/Farming#Growth_timing
        tickMinutes: 5,
        // A yew's first stage lasts five minutes; every later stage uses its normal cycle.
        firstStageMinutes: { YEW: 5 },
        // The growth-cycle tiers, slowest last. A diseased crop uses the next tier.
        cycleMinutes: [5, 10, 20, 40, 80, 160, 320, 640],
    },
};

/** Published per-cycle disease numerator for a crop, or the explicit unpublished estimate. */
function diseaseNumerator(crop) {
    return FORMULAS.disease.perCrop[crop.key] ?? FORMULAS.disease.perCrop[crop.type] ?? FORMULAS.disease.unpublished;
}
/** How long the current growth stage lasts. `stage` is the stage the crop is in now. */
function stageMinutes(crop, stage = 0) {
    return stage === 0 ? FORMULAS.growth.firstStageMinutes[crop.key] ?? crop.minutes : crop.minutes;
}
/** A diseased crop pauses for the next slowest growth cycle (`Farming#Growth_timing`). */
function diseasedMinutes(crop) {
    return FORMULAS.growth.cycleMinutes.find(minutes => minutes > crop.minutes) ?? crop.minutes;
}

// https://oldschool.runescape.wiki/w/Tangleroot (base denominators, before level adjustment).
const PET_RATES = {
    HERB: 98364, CORAL: 98364, FLOWER: 281040, ALLOTMENT: 281040, FRUIT_TREE: 9000, HARDWOOD_TREE: 5000,
    SWEETCORN: 224832, STRAWBERRY: 187360, WATERMELON: 160594, SNAPE_GRASS: 173977,
    BARLEY: 112416, HAMMERSTONE: 112416, ASGARNIAN: 89933, JUTE: 89933, YANILLIAN: 74944,
    FLAX: 89933, KRANDORIAN: 64238, WILDBLOOD: 56208, HEMP: 56208, COTTON: 56208,
    REDBERRIES: 44966, CADAVABERRIES: 37472, DWELLBERRIES: 32119, JANGERBERRIES: 28104, WHITEBERRIES: 28104, POISON_IVY: 28104,
    OAK: 22483, WILLOW: 16059, MAPLE: 14052, YEW: 11242, MAGIC: 9368,
    SEAWEED: 7500, MUSHROOM: 7500, BELLADONNA: 8000, CACTUS: 7000, POTATO_CACTUS: 160594,
    GRAPE: 385426, CALQUAT: 6000, SPIRIT_TREE: 5000, REDWOOD: 5000, CELASTRUS: 9000, CRYSTAL_TREE: 9000, HESPORI: 7000,
};
const petRate = (crop) => PET_RATES[crop.key] ?? PET_RATES[crop.type];

Object.assign(module.exports, { CACHE, CROPS, SEEDS, WATERED_SEEDLINGS, BELLADONNA_HANDWEAR, itemId, initializeFarmingData, patchKey, patchMinX, patchMinY, WATERABLE, COMPOSTABLE_YIELD, WOOD_TREES, petRate, FORMULAS, diseaseNumerator, stageMinutes, diseasedMinutes });
