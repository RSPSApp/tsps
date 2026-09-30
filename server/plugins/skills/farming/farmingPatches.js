/**
 * Farming patch catalog: which map object belongs to which physical patch.
 *
 * Object ids were scanned from the rev 237 cache maps (every loc whose transform
 * varbit is one of the farming transmit varbits 4771-4775) and classified by the
 * object's transform models. Base patch objects are unnamed ("null") in the cache,
 * so the ids are numeric with the variant names they render as.
 *
 * `bbox` is the tile area the patch occupies; clicks anywhere inside route to the
 * same patch. `varbit` is the transmit varbit the client reads to pick a model.
 */
const PATCH_TYPES = Object.freeze({
    ALLOTMENT: "ALLOTMENT",
    FLOWER: "FLOWER",
    HERB: "HERB",
    HOPS: "HOPS",
    BUSH: "BUSH",
    TREE: "TREE",
    FRUIT_TREE: "FRUIT_TREE",
    SPIRIT_TREE: "SPIRIT_TREE",
    CACTUS: "CACTUS",
    MUSHROOM: "MUSHROOM",
    BELLADONNA: "BELLADONNA",
    CALQUAT: "CALQUAT",
    COMPOST: "COMPOST",
});

const PLACEMENTS = require("./farmingPatchPlacements");

// [objectId, type, name, x, y, z, bbox[x0,y0,x1,y1], varbit]
const PATCH_ROWS = [
    // Allotments
    [8550, "ALLOTMENT", "Falador north-west allotment", 3052, 3310, 0, [3050, 3307, 3054, 3312], 4771],
    [8551, "ALLOTMENT", "Falador south-east allotment", 3057, 3306, 0, [3055, 3303, 3059, 3308], 4772],
    [8552, "ALLOTMENT", "Catherby northern allotment", 2810, 3467, 0, [2805, 3466, 2814, 3468], 4771],
    [8553, "ALLOTMENT", "Catherby southern allotment", 2810, 3460, 0, [2805, 3459, 2814, 3461], 4772],
    [8554, "ALLOTMENT", "Ardougne northern allotment", 2667, 3378, 0, [2662, 3377, 2671, 3379], 4771],
    [8555, "ALLOTMENT", "Ardougne southern allotment", 2667, 3371, 0, [2662, 3370, 2671, 3372], 4772],
    [8556, "ALLOTMENT", "Port Phasmatys north-west allotment", 3599, 3528, 0, [3597, 3525, 3601, 3530], 4771],
    [8557, "ALLOTMENT", "Port Phasmatys south-east allotment", 3604, 3524, 0, [3602, 3521, 3606, 3526], 4772],
    [21950, "ALLOTMENT", "Harmony allotment", 3794, 2836, 0, [3794, 2833, 3794, 2838], 4771],
    // Flower patches
    [7847, "FLOWER", "Falador flower patch", 3054, 3307, 0, [3054, 3307, 3054, 3307], 4773],
    [7848, "FLOWER", "Catherby flower patch", 2809, 3463, 0, [2809, 3463, 2809, 3463], 4773],
    [7849, "FLOWER", "Ardougne flower patch", 2666, 3374, 0, [2666, 3374, 2666, 3374], 4773],
    [7850, "FLOWER", "Port Phasmatys flower patch", 3601, 3525, 0, [3601, 3525, 3601, 3525], 4773],
    // Herb patches (renders as "Herb patch" / "Herbs")
    [8150, "HERB", "Falador herb patch", 3058, 3311, 0, [3058, 3311, 3058, 3311], 4774],
    [8151, "HERB", "Catherby herb patch", 2813, 3463, 0, [2813, 3463, 2813, 3463], 4774],
    [8152, "HERB", "Ardougne herb patch", 2670, 3374, 0, [2670, 3374, 2670, 3374], 4774],
    [8153, "HERB", "Port Phasmatys herb patch", 3605, 3529, 0, [3605, 3529, 3605, 3529], 4774],
    [18816, "HERB", "Troll Stronghold herb patch", 2826, 3694, 0, [2826, 3694, 2826, 3694], 4771],
    [9372, "HERB", "Harmony herb patch", 3789, 2837, 0, [3789, 2837, 3789, 2837], 4772],
    // Hops patches
    [8173, "HOPS", "Yanille hops patch", 2576, 3105, 0, [2574, 3103, 2577, 3106], 4771],
    [8174, "HOPS", "Entrana hops patch", 2811, 3337, 0, [2809, 3335, 2812, 3338], 4771],
    [8175, "HOPS", "Lumbridge hops patch", 3229, 3315, 0, [3227, 3313, 3231, 3317], 4771],
    [8176, "HOPS", "McGrubor's Wood hops patch", 2667, 3526, 0, [2664, 3523, 2669, 3528], 4771],
    // Bush patches
    [7577, "BUSH", "Champions' Guild bush patch", 3181, 3357, 0, [3181, 3357, 3181, 3357], 4771],
    [7578, "BUSH", "Rimmington bush patch", 2940, 3221, 0, [2940, 3221, 2940, 3221], 4771],
    [7579, "BUSH", "Etceteria bush patch", 2591, 3863, 0, [2591, 3863, 2591, 3863], 4771],
    [7580, "BUSH", "Ardougne bush patch", 2617, 3225, 0, [2617, 3225, 2617, 3225], 4771],
    // Tree patches (renders as "Tree patch" / "Oak tree" / stump)
    [8388, "TREE", "Taverley tree patch", 2935, 3437, 0, [2935, 3437, 2935, 3437], 4771],
    [8389, "TREE", "Falador tree patch", 3003, 3372, 0, [3003, 3372, 3003, 3372], 4771],
    [8390, "TREE", "Varrock tree patch", 3228, 3458, 0, [3228, 3458, 3228, 3458], 4771],
    [8391, "TREE", "Lumbridge tree patch", 3192, 3230, 0, [3192, 3230, 3192, 3230], 4771],
    [19147, "TREE", "Gnome Stronghold tree patch", 2435, 3414, 0, [2435, 3414, 2435, 3414], 4771],
    // Fruit tree patches
    [7962, "FRUIT_TREE", "Gnome Stronghold fruit tree patch", 2475, 3445, 0, [2475, 3445, 2475, 3445], 4772],
    [7963, "FRUIT_TREE", "Tree Gnome Village fruit tree patch", 2489, 3179, 0, [2489, 3179, 2489, 3179], 4771],
    [7964, "FRUIT_TREE", "Brimhaven fruit tree patch", 2764, 3212, 0, [2764, 3212, 2764, 3212], 4771],
    [7965, "FRUIT_TREE", "Catherby fruit tree patch", 2860, 3433, 0, [2860, 3433, 2860, 3433], 4771],
    [26579, "FRUIT_TREE", "Lletya fruit tree patch", 2346, 3161, 0, [2346, 3161, 2346, 3161], 4771],
    // Spirit tree patches
    [8338, "SPIRIT_TREE", "Port Sarim spirit tree patch", 3059, 3257, 0, [3059, 3257, 3059, 3257], 4771],
    [8382, "SPIRIT_TREE", "Etceteria spirit tree patch", 2612, 3857, 0, [2612, 3857, 2612, 3857], 4772],
    [8383, "SPIRIT_TREE", "Brimhaven spirit tree patch", 2801, 3202, 0, [2801, 3202, 2801, 3202], 4772],
    // Special patches
    [7771, "CACTUS", "Al Kharid cactus patch", 3315, 3202, 0, [3315, 3202, 3315, 3202], 4771],
    [8337, "MUSHROOM", "Canifis mushroom patch", 3451, 3472, 0, [3451, 3472, 3451, 3472], 4771],
    [7572, "BELLADONNA", "Draynor Manor belladonna patch", 3086, 3354, 0, [3086, 3354, 3086, 3354], 4771],
    [7807, "CALQUAT", "Tai Bwo Wannai calquat patch", 2795, 3100, 0, [2795, 3100, 2795, 3100], 4771],
    // Compost bins
    [7836, "COMPOST", "Falador compost bin", 3056, 3312, 0, [3056, 3312, 3056, 3312], 4775],
    [7837, "COMPOST", "Catherby compost bin", 2804, 3464, 0, [2804, 3464, 2804, 3464], 4775],
    [7838, "COMPOST", "Port Phasmatys compost bin", 3610, 3522, 0, [3610, 3522, 3610, 3522], 4775],
    [7839, "COMPOST", "Ardougne compost bin", 2661, 3375, 0, [2661, 3375, 2661, 3375], 4775],
];

const PATCHES = Object.freeze(
    PATCH_ROWS.map(([id, type, name, x, y, z, bbox, varbit]) =>
        Object.freeze({
            key: `${id}:${bbox[0]}:${bbox[1]}:${z}`,
            id,
            type,
            name,
            x,
            y,
            z,
            bbox,
            varbit,
            region: ((x >> 6) << 8) | (y >> 6),
            placements: PLACEMENTS[`${id}:${bbox[0]}:${bbox[1]}:${z}`] ?? [],
        }),
    ),
);

const BY_ID = new Map();
for (const patch of PATCHES) {
    const list = BY_ID.get(patch.id) ?? [];
    list.push(patch);
    BY_ID.set(patch.id, list);
}

const BY_KEY = new Map(PATCHES.map((patch) => [patch.key, patch]));

/** Resolve the physical patch an object click/item use targets. */
function findPatch(objectId, location) {
    if (!location) {
        return null;
    }
    const x = typeof location.getX === "function" ? location.getX() : location.x;
    const y = typeof location.getY === "function" ? location.getY() : location.y;
    const z = typeof location.getZ === "function" ? location.getZ() : location.z;
    const list = BY_ID.get(objectId);
    if (list) {
        for (const patch of list) {
            if (contains(patch, x, y, z)) {
                return patch;
            }
        }
    }
    // The client sends the transformed object id it renders (e.g. "Herbs",
    // "Diseased herbs"), which is not the base id in this catalog; patches do not
    // overlap, so the tile is enough to route those clicks.
    for (const patch of PATCHES) {
        if (contains(patch, x, y, z)) {
            return patch;
        }
    }
    return null;
}

function contains(patch, x, y, z) {
    if (patch.z !== z) {
        return false;
    }
    const [x0, y0, x1, y1] = patch.bbox;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function patchesInRegion(regionId) {
    return PATCHES.filter((patch) => patch.region === regionId);
}

module.exports = {
    PATCH_TYPES,
    PATCHES,
    BY_ID,
    BY_KEY,
    findPatch,
    patchesInRegion,
};
