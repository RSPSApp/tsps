const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Model = require("./Model.Farming");
const Patches = require("./Patches.Farming");
const COORDINATES = require("./data/geomancy-panels.json");
// Cache241: farming_view_setpanel takes (patch index, crop obj, packed progress, flags, noun).
// RSProx238/01221,04128 supply this signature; normal-world225/01583 supplies the packet order.
const PANEL_SCRIPT = 1119;
const PANEL_ENUM = 1235;
const OPEN = new Map();
const SPECIAL_OBJECTS = {
    BELLADONNA: "nightshade",
    SPIRIT_TREE: "vodka",
    HESPORI: "hespori",
    REDWOOD: "redwood_logs",
    ATTAS: "anima_attas",
    IASOR: "anima_iasor",
    KRONOS: "anima_kronos",
};
let panels;
function layout() {
    if (panels) return panels;
    const rows = core.CacheDefinitions.getEnumValues(PANEL_ENUM);
    panels = Object.entries(COORDINATES).map(([name, [x, y, z = 0]]) => {
        const back = core.CacheDefinitions.getComponentId("farming_view:" + name + "_back");
        const index = [...rows].find(([, uid]) => uid === back)?.[0];
        // Some patch types share an origin tile (Fortis flower/allotment/herb). Match the family too.
        const family = name.split("_")[0];
        const type = {
            allotment: "ALLOTMENT",
            flower: "FLOWER",
            herb: "HERB",
            compost: name === "compost_guild" ? "BIG_COMPOST" : "COMPOST",
            hops: "HOPS",
            bush: "BUSH",
            fruittree: "FRUIT_TREE",
            tree: "TREE",
            spirittree: "SPIRIT_TREE",
            grapevine: "GRAPES",
            seaweed: "SEAWEED",
            hardwood: "HARDWOOD_TREE",
            hespori: "HESPORI",
            celastrus: "CELASTRUS",
            anima: "ANIMA",
            crystal: "CRYSTAL_TREE",
            coral: "CORAL",
            mushroom: "MUSHROOM",
            calquat: "CALQUAT",
            cactus: "CACTUS",
            belladonna: "BELLADONNA",
            redwood: "REDWOOD",
        }[family];
        const exact = Data.CACHE.patches.find(
            (p) => p.x === x && p.y === y && p.z === z && p.type === type,
        );
        if (index === undefined || !exact)
            throw new Error("Farming: unmapped Geomancy panel " + name);
        return {
            index,
            patch: exact,
            picture: core.CacheDefinitions.getComponentId("farming_view:" + name + "_pic"),
        };
    });
    return panels;
}
function cropObject(crop) {
    if (SPECIAL_OBJECTS[crop.key]) return core.CacheDefinitions.getObjId(SPECIAL_OBJECTS[crop.key]);
    const name = core.CacheDefinitions.getItem(crop.produce).name;
    return name?.startsWith("Grimy ") ? Data.itemId(name.slice(6)) : crop.produce;
}
function binPanel(patch, state, now) {
    const bin = state?.bin;
    const empty = core.CacheDefinitions.getItem(Data.itemId("Bucket")).note; // cache's noted empty bucket is the renderer's empty-bin key.
    if (!bin?.count)
        return {
            item: empty,
            picture: core.CacheDefinitions.getObjId("eadgar_fade_to_black_inv"),
            progress: 0,
            flags: 0,
            noun: "bin",
        };
    const minutes = bin.tier === 2 ? 90 : 60;
    const stage = bin.open
        ? 3
        : bin.closedAt
          ? now - bin.closedAt >= minutes * Model.MINUTE
              ? 3
              : 2
          : 0;
    const names = ["", "Compost", "Supercompost", "Ultracompost", "Rotten tomato"];
    let item = Data.itemId(names[bin.tier]);
    // Noted compost keys describe unrotted inputs in the cache's enum1238.
    if (!bin.open && !bin.closedAt) item = core.CacheDefinitions.getItem(item).note;
    return {
        item,
        picture: Data.itemId(names[bin.tier]),
        progress: ((bin.count * 64 + stage) << 14) | 3,
        flags: 0,
        noun: "bin",
    };
}
function snapshot(farm, patch, now) {
    const state = farm.patches[Data.patchKey(patch)];
    if (patch.type.includes("COMPOST")) return binPanel(patch, state, now);
    let flags = state?.status === "dead" ? 2 : state?.status === "diseased" ? 1 : 0;
    if (state?.protected) flags |= 4;
    // RSProx238/01221: Troll/Weiss use the gardener icon even when empty; Harmony uses undead.
    if (patch.type === "HERB" && [2826, 2848].includes(patch.x)) flags |= 4;
    if (patch.type === "HERB" && patch.x === 3789 && patch.y === 2837) flags |= 512;
    if (
        farm.hosidiusProtected &&
        patch.x >= 1720 &&
        patch.x <= 1760 &&
        patch.y >= 3540 &&
        patch.y <= 3565
    )
        flags |= 256;
    if (state?.compost > 0) flags |= 1 << (state.compost + 4);
    const crop = Data.CROPS.get(state?.crop);
    if (!crop) {
        const item = state?.scarecrow
            ? Data.itemId("Scarecrow")
            : (state?.weeds ?? (["GRAPES", "CORAL", "SEAWEED"].includes(patch.type) ? 0 : 3))
              ? Data.itemId("Weeds")
              : Data.itemId("Bucket");
        return {
            item,
            picture:
                item === Data.itemId("Bucket")
                    ? core.CacheDefinitions.getObjId("blankobject")
                    : item,
            progress: 0,
            flags,
            noun: "patch",
        };
    }
    if (
        crop.type === "ALLOTMENT" &&
        !(flags & (4 | 256)) &&
        Model.diseaseFree(farm, patch, state, now)
    )
        flags |= 8;
    if (Data.WATERABLE.has(crop.type) && state.status === "growing") flags |= 16;
    const yieldCount =
        state.status === "dead" || state.status === "diseased"
            ? 0
            : state.status === "grown"
              ? Math.max(0, state.lives)
              : crop.lives > 0
                ? Model.startingLives(crop, state.compost)
                : 0;
    const stage = Math.min(crop.stages, Math.max(0, state.stage));
    const progress =
        ((state.watered ? 1 : 0) << 28) |
        ((stage + Math.min(255, yieldCount) * 64) << 14) |
        crop.stages;
    const item = cropObject(crop);
    return {
        item,
        picture:
            crop.key === "SPIRIT_TREE" ? core.CacheDefinitions.getObjId("spirit_tree_dummy") : item,
        progress,
        flags,
        noun:
            crop.type.includes("TREE") || ["CELASTRUS", "REDWOOD", "CALQUAT"].includes(crop.type)
                ? "tree"
                : "patch",
    };
}
function render(player, seen) {
    const farm = Patches.farmFor(player),
        now = Date.now(),
        sender = player.getPacketSender();
    Patches.advanceFarm(player, now);
    for (const panel of layout()) {
        const row = snapshot(farm, panel.patch, now),
            key = JSON.stringify(row);
        if (seen.get(panel.index) === key) continue;
        sender.sendInterfaceModel(panel.picture, row.picture, 400);
        sender.sendClientScript(
            PANEL_SCRIPT,
            panel.index,
            row.item,
            row.progress,
            row.flags,
            row.noun,
        );
        seen.set(panel.index, key);
    }
}
function open(player) {
    const sender = player.getPacketSender(),
        seen = new Map();
    sender.sendInterface(core.CacheDefinitions.getInterfaceId("farming_view"));
    sender.sendInterfaceFlagsRange(
        core.CacheDefinitions.getComponentId("farming_view:tabs"),
        0,
        5,
        1 << 1,
    );
    sender.sendVarbit(
        core.CacheDefinitions.getVarbitId("farming_view_tab"),
        Math.max(0, Math.min(5, Patches.farmFor(player).geomancyTab ?? 0)),
    );
    render(player, seen);
    OPEN.set(player, seen);
}
function tab(event) {
    if (event.buttonId !== core.CacheDefinitions.getComponentId("farming_view:tabs")) return;
    event.handled = true;
    const { player, slot, action } = event;
    if (
        action !== 1 ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot > 5 ||
        !OPEN.has(player) ||
        player.getInterfaceId() !== core.CacheDefinitions.getInterfaceId("farming_view") ||
        player.getHitpoints() <= 0
    )
        return;
    Patches.farmFor(player).geomancyTab = slot;
    player
        .getPacketSender()
        .sendVarbit(core.CacheDefinitions.getVarbitId("farming_view_tab"), slot);
}
function tick() {
    for (const [player, seen] of OPEN) {
        if (
            !player.isRegistered() ||
            player.getHitpoints() <= 0 ||
            player.getInterfaceId() !== core.CacheDefinitions.getInterfaceId("farming_view")
        )
            OPEN.delete(player);
        else render(player, seen);
    }
}
function logout({ player }) {
    OPEN.delete(player);
}
Object.assign(module.exports, { open, tab, tick, logout });
