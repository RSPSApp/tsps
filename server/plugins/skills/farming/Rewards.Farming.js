const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Patches = require("./Patches.Farming");
const Guild = require("./Guild.Farming");
const Tithe = require("./Tithe.Farming");
const SHOP = "tithe_shop_data";
const WATER_ATTRIBUTE = "farming:water";
const SESSION = new WeakMap();
const descriptions = {
    tithe_shop_farmers_hat: "The farmer's strawhat grants 0.4% bonus Farming experience.",
    tithe_shop_farmers_torso: "The farmer's torso grants 0.8% bonus Farming experience.",
    tithe_shop_farmers_legs: "The farmer's boro trousers grant 0.6% bonus Farming experience.",
    tithe_shop_farmers_feet: "The farmer's boots grant 0.2% bonus Farming experience.",
    tithe_shop_compost: "A noted bucket of compost for one Tithe point.",
    tithe_shop_supercompost: "A noted bucket of supercompost for five Tithe points.",
    tithe_shop_grape_seed: "A grape seed for planting in the Hosidius Vinery.",
    tithe_shop_grape_blessing:
        "Twenty Bologa's blessings per Tithe point, after Bologa has agreed to bless your grapes.",
    tithe_shop_herb_box: "A herb box containing seven herbs.",
    tithe_shop_seed_pack: "A tier-three seed pack containing seeds from Tithe Farm's reward table.",
    tithe_shop_seed_box: "Stores up to six kinds of seed.",
    tithe_shop_herb_sack: "Stores grimy herbs. Requires a base Herblore level of 58.",
    tithe_shop_watering_can: "Gricoller's can holds 1,000 doses of water.",
    tithe_shop_watering_can_recharge: "Refill the Gricoller's can in your inventory.",
    tithe_shop_autoweed:
        "Unlock Auto-weed so raked patches will no longer regrow weeds. It does not remove existing weeds.",
    tithe_shop_autoweed_toggle: "Toggle your unlocked Auto-weed for free.",
};
function sync(player) {
    const farm = Patches.farmFor(player),
        score = Tithe.scoreFor(player);
    player
        .getPacketSender()
        .sendVarbit(core.CacheDefinitions.getVarbitId("hosidius_tithe_rewardpoints"), score.points);
    player
        .getPacketSender()
        .sendVarbit(
            core.CacheDefinitions.getVarbitId("farming_blockweeds"),
            score.autoWeedUnlocked ? (farm.autoWeed ? 2 : 1) : 0,
        );
}
function current(player) {
    const session = SESSION.get(player);
    return (
        session &&
        session.farm === Patches.farmFor(player) &&
        session.score === Tithe.scoreFor(player) &&
        player.getInterfaceId() === core.CacheDefinitions.getInterfaceId("omnishop_main") &&
        player.getStatus() === core.PlayerStatus.NONE &&
        player.getHitpoints() > 0 &&
        !player.isNeedsPlacement() &&
        !player.isTeleportingReturn() &&
        !player.getForceMovement() &&
        player.getLocation().isWithinDistance(session.npc.getLocation(), 5)
    );
}
function open(event) {
    const { player, npc } = event;
    if (player.busy() || !player.getLocation().isWithinDistance(npc.getLocation(), 5)) return;
    SESSION.set(player, { farm: Patches.farmFor(player), score: Tithe.scoreFor(player), npc });
    sync(player);
    core.PluginManager.emitCustomEvent("omnishop:open", { player, shop: SHOP, handled: false });
}
// Generated NPC shop bindings run before generic NPC hooks. Like Soul Wars, redirect
// only this canonical shop through the shared guard instead of modifying generated data.
function canShop(event) {
    if (core.ShopDefinition.forId(event.shopId)?.getName() !== "Farmer Gricoller's Rewards") return;
    event.allow = false;
    const player = event.player,
        id = core.CacheDefinitions.getNpcId("hosidius_tithe_farmer");
    for (const npc of core.World.getNpcs()) {
        if (
            !npc ||
            npc.getId() !== id ||
            npc.getHitpoints() <= 0 ||
            !player.getLocation().isWithinDistance(npc.getLocation(), 5)
        )
            continue;
        if (npc.getPrivateArea() && npc.getPrivateArea() !== player.getPrivateArea()) continue;
        if (npc.getOwner() && npc.getOwner() !== player) continue;
        open({ player, npc });
        return;
    }
}
function currency(request) {
    if (
        request.shop !== SHOP ||
        request.currency !== core.CacheDefinitions.getDbRowId("omnishop_currency_tithe_points")
    )
        return;
    const score = Tithe.scoreFor(request.player);
    request.balance = score.points;
    request.set = (value) => {
        score.points = Math.max(0, Math.min(16000, Math.floor(value)));
        sync(request.player);
    };
}
function describe(request) {
    if (request.shop === SHOP) request.description = descriptions[request.stock] ?? "";
}
function stockRow(name) {
    return core.CacheDefinitions.getDbRow(core.CacheDefinitions.getDbRowId(name));
}
function stockInt(row, name, fallback = -1) {
    return row.int(
        core.CacheDefinitions.getDbColumn(
            core.CacheDefinitions.getDbTableId("omnishop_stock_data"),
            name,
        ),
        fallback,
    );
}
function outfitRefund(itemId) {
    for (const part of ["hat", "torso", "legs", "feet"]) {
        const row = stockRow("tithe_shop_farmers_" + part);
        if (
            ![
                stockInt(row, "omnishop_stock_obj"),
                stockInt(row, "omnishop_stock_alternateobj"),
            ].includes(itemId)
        )
            continue;
        const costs = row.column(
            core.CacheDefinitions.getDbColumn(
                core.CacheDefinitions.getDbTableId("omnishop_stock_data"),
                "omnishop_stock_cost",
            ),
        );
        return { name: core.CacheDefinitions.getItem(itemId).name, cost: Number(costs[1]) };
    }
    return null;
}
function reward(player, stock) {
    const row = stockRow(stock);
    let id = stockInt(row, "omnishop_stock_obj");
    const alternate = stockInt(row, "omnishop_stock_alternateobj");
    if (
        alternate > 0 &&
        !player.getAppearance().isMale() &&
        stock.startsWith("tithe_shop_farmers_")
    )
        id = alternate;
    if (stockInt(row, "omnishop_stock_sold_noted", 0)) id = core.CacheDefinitions.getItem(id).note;
    return new core.Item(
        id,
        Math.max(1, stockInt(row, "omnishop_stock_transaction_multiplier", 1)),
    );
}
function ownedFamily(player, names) {
    const ids = new Set(names.map(Data.itemId));
    return [player.getInventory(), player.getEquipment(), ...player.getBanks()].some((container) =>
        container?.getValidItems().some((item) => ids.has(item.getId())),
    );
}
function canBuy(request) {
    if (request.shop !== SHOP) return;
    const { player, stock } = request;
    request.cancel = true;
    if (!current(player)) return;
    const score = Tithe.scoreFor(player);
    if (
        stock === "tithe_shop_herb_sack" &&
        player.getSkillManager().getMaxLevel(core.Skill.HERBLORE) < 58
    ) {
        player.sendMessage("You need a base Herblore level of 58.");
        return;
    }
    if (stock === "tithe_shop_grape_blessing" && !score.bologa) {
        player.sendMessage("First arrange for Bologa to bless your grapes.");
        return;
    }
    if (
        (stock === "tithe_shop_seed_box" && ownedFamily(player, ["Seed box", "Open seed box"])) ||
        (stock === "tithe_shop_herb_sack" && ownedFamily(player, ["Herb sack", "Open herb sack", "Silklined herb sack", "Open silklined herb sack"]))
    ) {
        player.sendMessage("You cannot buy any more of that item.");
        return;
    }
    if (stock === "tithe_shop_autoweed" && score.autoWeedUnlocked) {
        player.sendMessage("You have already unlocked Auto-weed.");
        return;
    }
    if (stock === "tithe_shop_autoweed_toggle" && !score.autoWeedUnlocked) {
        player.sendMessage("Unlock Auto-weed first.");
        return;
    }
    const unlock = [
        "tithe_shop_autoweed",
        "tithe_shop_autoweed_toggle",
        "tithe_shop_watering_can_recharge",
    ].includes(stock);
    if (
        stock === "tithe_shop_watering_can_recharge" &&
        !player.getInventory().contains(Data.itemId("Gricoller's can"))
    ) {
        player.sendMessage("Bring Gricoller's can in your inventory first.");
        return;
    }
    if (
        !unlock &&
        player.getInventory().getAddableAmount(reward(player, stock)) <
            reward(player, stock).getAmount()
    ) {
        player.sendMessage("You don't have enough inventory space.");
        return;
    }
    // Farming grants the canonical bulk reward/metadata after the shared shop takes one unit's points.
    request.unlock = true;
    request.cancel = false;
}
function purchase(request) {
    if (request.shop !== SHOP) return;
    request.handled = true;
    const { player, stock } = request,
        farm = Patches.farmFor(player),
        score = Tithe.scoreFor(player);
    if (stock === "tithe_shop_autoweed") {
        score.autoWeedUnlocked = true;
        farm.autoWeed = true;
    } else if (stock === "tithe_shop_autoweed_toggle") farm.autoWeed = !farm.autoWeed;
    else if (stock === "tithe_shop_watering_can_recharge") {
        for (const item of player.getInventory().getValidItems())
            if (item.getId() === Data.itemId("Gricoller's can"))
                item.setMetaValue(WATER_ATTRIBUTE, 1000);
    } else if (stock === "tithe_shop_seed_pack") {
        Guild.giveSeedPack(player, 3, true);
        core.PluginManager.emitCustomEvent("collection-log:obtain", {
            player,
            itemId: Data.itemId("Seed pack"),
            amount: 1,
        });
    } else {
        const item = reward(player, stock);
        if (stock === "tithe_shop_watering_can") item.setMetaValue(WATER_ATTRIBUTE, 1000);
        player.getInventory().addItem(item);
        core.PluginManager.emitCustomEvent("collection-log:obtain", {
            player,
            itemId: item.getId(),
            amount: item.getAmount(),
        });
    }
    player.getInventory().refreshItems();
    sync(player);
}
function login({ player }) {
    sync(player);
}
function logout({ player }) {
    SESSION.delete(player);
}
Object.assign(module.exports, {
    canShop,
    open,
    currency,
    describe,
    canBuy,
    purchase,
    login,
    logout,
    outfitRefund,
});
