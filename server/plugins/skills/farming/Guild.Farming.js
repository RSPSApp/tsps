
// https://oldschool.runescape.wiki/w/Farming_contracts — [minimum level, reward tier, eligible crops].
const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Patches = require("./Patches.Farming");
const CONTRACTS = [
    [[45, 1, "POTATO MARIGOLD ONION CABBAGE ROSEMARY TOMATO SWEETCORN NASTURTIUM WOAD LIMPWURT STRAWBERRY"],
        [45, 2, "REDBERRIES CADAVABERRIES DWELLBERRIES"], [48, 2, "JANGERBERRIES"], [55, 3, "CACTUS"],
        [65, 2, "GUAM MARRENTILL TARROMIN HARRALANDER RANARR TOADFLAX IRIT AVANTOE"], [65, 3, "OAK WILLOW MAPLE"], [85, 3, "APPLE BANANA ORANGE CURRY"]],
    [[65, 2, "STRAWBERRY WHITE_LILY SNAPE_GRASS POTATO_CACTUS"], [65, 3, "IRIT WATERMELON JANGERBERRIES AVANTOE KWUARM WHITEBERRIES SNAPDRAGON"],
        [65, 4, "MAPLE CACTUS YEW"], [67, 3, "CADANTINE"], [70, 3, "POISON_IVY"], [73, 3, "LANTADYME"], [75, 4, "MAGIC"], [85, 4, "CURRY PINEAPPLE PAPAYA PALM"]],
    [[85, 3, "WHITE_LILY SNAPE_GRASS POTATO_CACTUS"], [85, 4, "WATERMELON WHITEBERRIES SNAPDRAGON CADANTINE POISON_IVY LANTADYME DWARF_WEED TORSTOL"],
        [85, 5, "MAPLE YEW PALM MAGIC DRAGONFRUIT CELASTRUS"], [90, 5, "REDWOOD"]],
];
function assign(player, difficulty) {
    const farm = Patches.farmFor(player), level = player.getSkillManager().getCurrentLevel(core.Skill.FARMING);
    if (level < [45, 65, 85][difficulty]) { player.sendMessage(`You need level ${[45, 65, 85][difficulty]} Farming.`); return; }
    const previous = farm.contract?.crop ?? farm.lastContract;
    const options = CONTRACTS[difficulty].filter(([required]) => level >= required)
        .flatMap(([, tier, keys]) => keys.split(" ").filter(crop => crop !== previous).map(crop => ({ crop, tier })));
    const selected = options[Math.floor(Math.random() * options.length)];
    farm.contract = { ...selected, difficulty, complete: false };
    player.sendMessage(`Jane asks you to grow ${Data.CROPS.get(selected.crop).name.toLowerCase()} in the Farming Guild.`);
}
function guildNpc(event) {
    if (event.definition?.getName() !== "Guildmaster Jane") return;
    event.handled = true;
    const { player } = event, farm = Patches.farmFor(player), contract = farm.contract;
    if (contract) {
        if (contract.complete) {
            if (!giveSeedPack(player, contract.tier)) return;
            farm.contractsCompleted = (farm.contractsCompleted ?? 0) + 1;
            farm.lastContract = contract.crop;
            delete farm.contract;
            player.sendMessage(`Contract complete! You have completed ${farm.contractsCompleted} contracts.`);
        } else {
            player.sendMessage(`Your contract is to grow ${Data.CROPS.get(contract.crop).name.toLowerCase()} in this guild.`);
            if (contract.difficulty > 0) Patches.choose(player, [["Do you have anything easier?", () => {
                if (farm.contract === contract && player.getLocation().isWithinDistance(event.npc.getLocation(), 5)) assign(player, contract.difficulty - 1);
            }], ["Keep this contract", () => {}]]);
            return;
        }
    }
    Patches.choose(player, ["Easy", "Medium", "Hard"].map((name, difficulty) => [`${name} contract (level ${[45, 65, 85][difficulty]})`, () => {
        if (!farm.contract && player.getLocation().isWithinDistance(event.npc.getLocation(), 5)) assign(player, difficulty);
    }]));
}
function completeContract(event) {
    const contract = Patches.farmFor(event.player).contract;
    if (!contract || contract.complete || contract.crop !== event.crop) return;
    if (event.patch.x < 1216 || event.patch.x > 1279 || event.patch.y < 3712 || event.patch.y > 3775 || event.patch.z !== 0) return;
    contract.complete = true;
    event.player.sendMessage("You have completed your Farming contract. Speak to Guildmaster Jane for your reward.");
}
function harvestContract(event) { if (!Data.CROPS.get(event.crop)?.check) completeContract(event); }
// Seed pack drop tables: https://oldschool.runescape.wiki/w/Seed_pack
const LOW = [
    ...["Potato", "Onion", "Cabbage", "Tomato", "Sweetcorn", "Strawberry", "Jute", "Marigold", "Rosemary", "Nasturtium", "Woad"].map(n => [n + " seed", 8, 12, 2]),
    ["Barley seed", 8, 14, 2], ...["Hammerstone", "Asgarnian", "Yanillian", "Krandorian", "Redberry", "Cadavaberry", "Dwellberry", "Jangerberry"].map(n => [n + " seed", 6, 8, 2]),
    ...["Acorn", "Apple tree seed", "Banana tree seed", "Orange tree seed", "Curry tree seed", "Guam seed", "Marrentill seed", "Tarromin seed", "Harralander seed"].map(n => [n, 3, 5, 2]),
    ["Mushroom spore", 4, 6, 1], ["Belladonna seed", 4, 6, 1],
];
const MEDIUM = [["Irit seed", 2, 6, 3], ["Limpwurt seed", 4, 8, 3], ["Watermelon seed", 8, 12, 2], ["Snape grass seed", 6, 8, 2], ["Wildblood seed", 8, 12, 2],
    ["Whiteberry seed", 6, 8, 2], ["Poison ivy seed", 6, 8, 2], ["Cactus seed", 2, 6, 2], ["Potato cactus seed", 2, 6, 2], ["Willow seed", 2, 4, 1],
    ["Pineapple seed", 3, 5, 1], ...["Toadflax", "Avantoe", "Kwuarm", "Cadantine", "Lantadyme", "Dwarf weed", "Teak"].map(n => [n + " seed", 1, 3, 1]), ["Calquat tree seed", 3, 6, 1]];
const HIGH = [["Papaya tree seed", 1, 3, 5], ["Palm tree seed", 1, 2, 5], ["Hespori seed", 1, 1, 5], ["Ranarr seed", 1, 2, 4],
    ["Snapdragon seed", 1, 1, 4], ["Maple seed", 1, 2, 4], ["Mahogany seed", 1, 2, 4], ["Yew seed", 1, 1, 3], ["Dragonfruit tree seed", 1, 1, 3],
    ["Celastrus seed", 1, 1, 2], ["Torstol seed", 1, 1, 2], ["Magic seed", 1, 1, 1], ["Spirit seed", 1, 1, 1], ["Redwood tree seed", 1, 1, 1]];
const HERBS = [["Grimy guam leaf", 1, 1, 32], ["Grimy marrentill", 1, 1, 24], ["Grimy tarromin", 1, 1, 18], ["Grimy harralander", 1, 1, 14],
    ["Grimy ranarr weed", 1, 1, 11], ["Grimy irit leaf", 1, 1, 8], ["Grimy avantoe", 1, 1, 6], ["Grimy kwuarm", 1, 1, 5],
    ["Grimy cadantine", 1, 1, 4], ["Grimy lantadyme", 1, 1, 3], ["Grimy dwarf weed", 1, 1, 3]];
function roll(table) {
    let chance = Math.random() * table.reduce((sum, r) => sum + r[3], 0);
    const row = table.find(r => (chance -= r[3]) < 0);
    return { id: Data.itemId(row[0]), count: row[1] + Math.floor(Math.random() * (row[2] - row[1] + 1)) };
}
function contents(tier, tithe) {
    const medium = tier === 1 ? 1 + Math.floor(Math.random() * 3) : tier === 2 ? 2 + Math.floor(Math.random() * 2) : tier - 1 + Math.floor(Math.random() * 3);
    const high = tier === 1 ? 0 : tier === 2 ? (Math.random() < 1 / 11 ? 1 : 0) : tier === 3 ? Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * (tier - 2));
    return Array.from({ length: tier + 5 }, (_, i) => i < high ? roll(HIGH) : i < high + medium
        ? tithe && Math.random() < 1 / 90 ? { id: Data.itemId("White lily seed"), count: 1 } : roll(MEDIUM) : roll(LOW));
}
function giveSeedPack(player, tier = 3, tithe = false) {
    if (player.getInventory().isFull()) { player.getInventory().full(); return false; }
    const pack = new core.Item(Data.itemId("Seed pack"));
    pack.setMetaValue("farming:rewards", contents(tier, tithe));
    player.getInventory().addItem(pack);
    return true;
}
function guildItemOnNpc(event) {
    if (event.target.getDefinition().getName() !== "Guildmaster Jane" || !/^Spirit (seed|seedling(?: \(w\))?|sapling)$/.test(core.CacheDefinitions.getItem(event.itemId).name)) return;
    event.handled = true;
    if (!event.player.getInventory().contains(event.itemId)) return;
    if (event.player.getInventory().isFull() && core.CacheDefinitions.getItem(event.itemId).stackability && event.player.getInventory().getAmount(event.itemId) > 1) { event.player.getInventory().full(); return; }
    event.player.getInventory().deleteNumber(event.itemId, 1);
    giveSeedPack(event.player, 5);
}
function rewardItem(event) {
    const item = event.player.getInventory().forSlot(event.slot);
    if (!item || item.getId() !== event.itemId) return;
    const name = core.CacheDefinitions.getItem(event.itemId).name;
    if (!["Seed pack", "Herb box", "Open herb box"].includes(name)) return;
    const action = (event.option ?? core.CacheDefinitions.getItem(event.itemId).inventoryActions[event.clickType - 1])?.toLowerCase();
    if (!["take", "take-all", "take-one", "bank-all", "check"].includes(action)) return;
    event.handled = true;
    let rewards = item.getMetaValue("farming:rewards");
    if (!rewards) { rewards = name === "Seed pack" ? contents(3, false) : Array.from({ length: 7 }, () => roll(HERBS)); item.setMetaValue("farming:rewards", rewards); }
    if (action === "check") { event.player.sendMessage(`There are ${rewards.length} rewards remaining.`); return; }
    do {
        const reward = rewards[0];
        if (!reward) break;
        if (action === "bank-all") {
            const bank = event.player.getBank(0);
            if (bank.isFull() && !bank.contains(reward.id)) { event.player.sendMessage("Your bank is full."); return; }
            bank.addItem(new core.Item(reward.id, reward.count));
        } else if (!Patches.give(event.player, reward.id, reward.count)) return;
        rewards.shift();
    } while (rewards.length && ["take-all", "bank-all"].includes(action));
    if (!rewards.length) event.player.getInventory().deleteAtSlot(event.slot);
    else if (name === "Herb box") item.setId(Data.itemId("Open herb box"));
    event.player.getInventory().refreshItems();
}

function containerKind(item) {
    const name = core.CacheDefinitions.getItem(item.getId()).name.toLowerCase();
    return name === "seed box" || name === "open seed box" ? "seed" : name === "herb sack" || name === "open herb sack" ? "herb" : undefined;
}
function storeCrop(player, container, id, maximum) {
    const kind = containerKind(container);
    if (!kind) return 0;
    if (kind === "herb" && player.getSkillManager().getCurrentLevel(core.Skill.HERBLORE) < 58) return 0;
    const crop = [...Data.CROPS.values()].find(c => kind === "seed" ? c.seed === id : c.type === "HERB" && c.produce === id);
    if (!crop || (kind === "seed" && !core.CacheDefinitions.getItem(id).stackability)) return 0;
    const stored = (container.getMetaValue("farming:stored") ?? {});
    if (kind === "seed" && !stored[id] && Object.keys(stored).length >= 6) return 0;
    const amount = Math.min(maximum, (kind === "herb" ? 30 : 2147483647) - (stored[id] ?? 0));
    if (amount <= 0) return 0;
    stored[id] = (stored[id] ?? 0) + amount;
    container.setMetaValue("farming:stored", stored);
    return amount;
}
function storagePair(event) {
    const inventory = event.player.getInventory();
    const a = inventory.forSlot(event.usedItemSlot), b = inventory.forSlot(event.usedWithItemSlot);
    if (!a || !b || a.getId() !== event.usedItemId || b.getId() !== event.usedWithItemId) return;
    const container = containerKind(a) ? a : containerKind(b) ? b : undefined;
    if (!container) return;
    event.handled = true;
    const id = (container === a ? b : a).getId();
    const stored = storeCrop(event.player, container, id, inventory.getAmount(id));
    if (stored) inventory.deleteNumber(id, stored);
    else event.player.sendMessage("There is no room for that in this container.");
}
function storageAction(event) {
    const inventory = event.player.getInventory(), container = inventory.forSlot(event.slot);
    if (!container || container.getId() !== event.itemId || !containerKind(container)) return;
    const action = (event.option ?? core.CacheDefinitions.getItem(event.itemId).inventoryActions[event.clickType - 1])?.toLowerCase();
    if (!["open", "close", "fill", "empty", "check"].includes(action)) return;
    event.handled = true;
    const kind = containerKind(container);
    if (action === "open" || action === "close") {
        container.setId(Data.itemId((action === "open" ? "Open " : "") + (kind === "seed" ? "seed box" : "herb sack")));
    } else if (action === "fill") {
        for (const item of [...inventory.getValidItems()]) {
            const amount = storeCrop(event.player, container, item.getId(), item.getAmount());
            if (amount) inventory.deleteNumber(item.getId(), amount);
        }
    } else {
        const stored = (container.getMetaValue("farming:stored") ?? {});
        if (action === "check") event.player.sendMessage(Object.entries(stored).map(([id, amount]) => `${amount} ${core.CacheDefinitions.getItem(+id).name}`).join(", ") || "The container is empty.");
        else for (const [id, count] of Object.entries(stored)) {
            const amount = Math.min(count, kind === "seed" ? inventory.contains(+id) || !inventory.isFull() ? count : 0 : inventory.getFreeSlots());
            if (amount && Patches.give(event.player, +id, amount)) { stored[id] -= amount; if (!stored[id]) delete stored[id]; }
        }
    }
    inventory.refreshItems();
}
function guildObject(event) {
    if (event.definition?.getName()?.toLowerCase() !== "seed vault") return;
    event.handled = true;
    const { player, object } = event, farm = Patches.farmFor(player), vault = farm.vault ??= {};
    const near = () => player.getLocation().isWithinDistance(object.getLocation(), 5);
    const entries = [["Deposit all seeds and saplings", () => {
        if (!near()) return;
        for (const item of [...player.getInventory().getValidItems()]) {
            const def = core.CacheDefinitions.getItem(item.getId()), id = def.noteTemplate >= 0 ? def.note : item.getId();
            if (![...Data.CROPS.values()].some(c => c.seed === id || c.sapling === id)) continue;
            const amount = Math.min(item.getAmount(), 2147483647 - (vault[id] ?? 0));
            if (amount > 0) { player.getInventory().deleteNumber(item.getId(), amount); vault[id] = (vault[id] ?? 0) + amount; }
        }
    }]];
    for (const [id, count] of Object.entries(vault)) if (count > 0) entries.push([`${core.CacheDefinitions.getItem(+id).name} (${count})`, () => {
        if (!near()) return;
        Patches.choose(player, [1, 5, 10, 2147483647].map(requested => [`Withdraw ${requested === 2147483647 ? "all" : requested}`, () => {
            if (!near()) return;
            const amount = Math.min(vault[id] ?? 0, requested, core.CacheDefinitions.getItem(+id).stackability ? 2147483647 : player.getInventory().getFreeSlots());
            if (amount && Patches.give(player, +id, amount)) vault[id] -= amount;
        }]));
    }]);
    Patches.choose(player, entries);
}

Object.assign(module.exports, { CONTRACTS, guildNpc, completeContract, harvestContract, giveSeedPack, guildItemOnNpc, rewardItem, storeCrop, storagePair, storageAction, guildObject });
