
// https://oldschool.runescape.wiki/w/Farming_contracts — [minimum level, reward tier, eligible crops].
const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Patches = require("./Patches.Farming");
const Vault = require("./Vault.Farming");
// Native bank-side item op labelled by cache param 595, shared with StorageItems.
const BANK_STORAGE_OP = 9;
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
    if ((event.definition ?? event.target.getDefinition()).getName() !== "Guildmaster Jane" || !/^Spirit (seed|seedling(?: \(w\))?|sapling)$/.test(core.CacheDefinitions.getItem(event.itemId).name)) return;
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
    const initialCount = rewards.length;
    do {
        const reward = rewards[0];
        if (!reward) break;
        if (action === "bank-all") {
            const bank = event.player.getBank(0);
            const received = new core.Item(reward.id, reward.count);
            if (bank.getAddableAmount(received) < reward.count) { event.player.sendMessage("Your bank is full."); break; }
            bank.addItem(received);
        } else if (!Patches.give(event.player, reward.id, reward.count)) break;
        // No capture or Wiki quote of the live wording yet: one line per reward taken.
        const received = `${reward.count} x ${core.CacheDefinitions.getItem(reward.id).name.toLowerCase()}`;
        event.player.sendMessage(action === "bank-all" ? `You put ${received} into your bank.` : `You receive ${received}.`);
        rewards.shift();
    } while (rewards.length && ["take-all", "bank-all"].includes(action));
    if (!rewards.length) event.player.getInventory().deleteAtSlot(event.slot);
    else if (name === "Herb box" && rewards.length < initialCount) item.setId(Data.itemId("Open herb box"));
    event.player.getInventory().refreshItems();
}

const HERB_SACKS = ["herb sack", "open herb sack", "silklined herb sack", "open silklined herb sack"];
/** Wiki (Silklined herb sack): "up to 100 of each of the grimy normal herbs instead of 30". */
const HERB_SACK_CAPACITY = 30;
const SILKLINED_CAPACITY = 100;
const nameOf = (item) => core.CacheDefinitions.getItem(item.getId()).name.toLowerCase();
const isSilklined = (item) => nameOf(item).includes("silklined");
function containerKind(item) {
    const name = nameOf(item);
    return name === "seed box" || name === "open seed box" ? "seed" : HERB_SACKS.includes(name) ? "herb" : undefined;
}
function bankStorageOp(event) {
    const { player } = event;
    if (event.handled || event.op !== BANK_STORAGE_OP || !core.Bank.isOpen(player)) return;
    const inventory = player.getInventory(), container = inventory.forSlot(event.slot);
    if (container !== event.item || !containerKind(container)) return;
    event.handled = true;
    const stored = container.getMetaValue("farming:stored") ?? {};
    for (const [key, count] of Object.entries(stored)) {
        const id = Number(key);
        if (!Number.isInteger(id) || id <= 0 || id >= core.CacheDefinitions.getCounts().items || !Number.isSafeInteger(count) || count <= 0) continue;
        const bank = player.getBank(core.Bank.getTabForItem(player, id));
        const item = new core.Item(id, count), amount = bank.getAddableAmount(item);
        if (amount <= 0) continue;
        bank.add(item.setAmount(amount), false);
        stored[key] -= amount;
        if (!stored[key]) delete stored[key];
    }
    container.setMetaValue("farming:stored", stored);
    player.getBank(player.getCurrentBankTab()).refreshItems();
    inventory.refreshItems();
}
/** How many of `id` the container would take now: 0 if it refuses the item, the player, or is full of it. */
function storeRoom(player, container, id) {
    const kind = containerKind(container);
    if (!kind) return 0;
    if (kind === "herb" && player.getSkillManager().getCurrentLevel(core.Skill.HERBLORE) < 58) return 0;
    const crop = [...Data.CROPS.values()].find(c => kind === "seed" ? c.seed === id : c.type === "HERB" && c.produce === id);
    if (!crop || (kind === "seed" && !core.CacheDefinitions.getItem(id).stackability)) return 0;
    if (kind === "herb" && !core.CacheDefinitions.getItem(id).name?.startsWith("Grimy ")) return 0;
    const stored = (container.getMetaValue("farming:stored") ?? {});
    if (kind === "seed" && !stored[id] && Object.keys(stored).length >= 6) return 0;
    return Math.max(0, (kind === "herb" ? (isSilklined(container) ? SILKLINED_CAPACITY : HERB_SACK_CAPACITY) : 2147483647) - (stored[id] ?? 0));
}
function storeCrop(player, container, id, maximum) {
    const amount = Math.min(maximum, storeRoom(player, container, id));
    if (amount <= 0) return 0;
    const stored = container.getMetaValue("farming:stored") ?? {};
    stored[id] = (stored[id] ?? 0) + amount;
    container.setMetaValue("farming:stored", stored);
    return amount;
}
/** The first open herb sack the player carries, plain or silklined. */
const openHerbSack = player => player.getInventory().getItems().find(i => i && ["open herb sack", "open silklined herb sack"].includes(nameOf(i)));
/**
 * Wiki (Herb sack): an open sack stores grimy herbs picked up or harvested from patches and herbiboars, "provided there is
 * space for it". Splits [id, amount] pairs into what the open sack would take and the rest, without storing anything.
 */
function splitForOpenSack(player, items) {
    const sack = openHerbSack(player), stored = [], rest = [], taken = new Map();
    for (const [id, amount] of items) {
        const room = sack ? Math.max(0, storeRoom(player, sack, id) - (taken.get(id) ?? 0)) : 0, take = Math.min(room, amount);
        if (take) { stored.push([id, take]); taken.set(id, (taken.get(id) ?? 0) + take); }
        if (amount > take) rest.push([id, amount - take]);
    }
    return { sack, stored, rest };
}
const herbPickupItems = new WeakSet();
const herbPickupPlayers = new WeakSet();
/** A plain, single grimy herb picked up from the ground goes into an open sack that has room for it. */
function pickup(event) {
    if (event.handled) return;
    const { player, groundItem } = event, item = groundItem.getItem();
    if (herbPickupItems.has(groundItem) || herbPickupPlayers.has(player)) { event.handled = true; return; }
    // Stored by id: preserve metadata and use ordinary pickup for non-unit stacks.
    if (!item.isTradeable() || item.getMeta() != null || item.getAmount() !== 1) return;
    const { sack, stored } = splitForOpenSack(player, [[item.getId(), item.getAmount()]]);
    if (!sack || stored.length !== 1 || stored[0][1] !== 1) return;
    const manager = core.ItemOnGroundManager, itemId = item.getId();
    const position = groundItem.getPosition().clone(), owner = groundItem.getOwner();
    const area = groundItem.getPrivateArea(), state = groundItem.getState();
    const sackId = sack.getId(), sackContents = JSON.stringify(sack.getMetaValue("farming:stored") ?? {});
    herbPickupItems.add(groundItem);
    herbPickupPlayers.add(player);
    event.handled = true;
    try {
        const request = { player, groundItem, source: "pickup", itemId, amount: 1, discard: 0, allow: true, error: null };
        core.PluginManager.emitCustomEvent("ground-items:take", request);
        if (request.allow !== true || request.error != null || request.amount !== 1 || request.discard !== 0) return;
        if (!core.World.getItems().includes(groundItem) || !manager.canSee(player, groundItem)
            || groundItem.getItem() !== item || item.getId() !== itemId || item.getAmount() !== 1
            || !item.isTradeable() || item.getMeta() != null || !groundItem.getPosition().equals(position)
            || groundItem.getOwner() !== owner || groundItem.getPrivateArea() !== area || groundItem.getState() !== state
            || openHerbSack(player) !== sack || sack.getId() !== sackId
            || JSON.stringify(sack.getMetaValue("farming:stored") ?? {}) !== sackContents
            || storeRoom(player, sack, itemId) < 1) return;
        if (storeCrop(player, sack, itemId, 1) !== 1) return;
        manager.deregister(groundItem);
        core.PluginManager.emitCustomEvent("ground-items:taken", { player, groundItem, source: "pickup", itemId, amount: 1, discarded: 0 });
        // Mirror this server's ordinary ground pickup; live sack audio is not established.
        core.Sounds.sendSound(player, core.Sound.PICK_UP_ITEM);
        player.getLastItemPickup().reset();
        player.getInventory().refreshItems();
    } finally {
        herbPickupItems.delete(groundItem);
        herbPickupPlayers.delete(player);
    }
}
/**
 * Wiki (Silklined herb sack): "made by using a pristine spider silk" on a herb sack, in 1 tick, for no cost and with no level
 * requirement. The same sack becomes the silklined one (open stays open, its herbs stay: the Wiki says nothing of either), and
 * the silk is taken from the slot it was used from.
 */
function upgradeSack(event, silk, sack) {
    const name = nameOf(sack);
    if (name !== "herb sack" && name !== "open herb sack") return false;
    const inventory = event.player.getInventory();
    const slot = silk === inventory.forSlot(event.usedItemSlot) ? event.usedItemSlot : event.usedWithItemSlot;
    sack.setId(Data.itemId(name === "open herb sack" ? "Open silklined herb sack" : "Silklined herb sack"));
    inventory.deleteAtSlot(slot, 1, false);
    inventory.refreshItems();
    return true;
}
function storagePair(event) {
    const inventory = event.player.getInventory();
    const a = inventory.forSlot(event.usedItemSlot), b = inventory.forSlot(event.usedWithItemSlot);
    if (!a || !b || a.getId() !== event.usedItemId || b.getId() !== event.usedWithItemId) return;
    const silk = core.ItemIdentifiers.PRISTINE_SPIDER_SILK;
    if ((a.getId() === silk || b.getId() === silk) && upgradeSack(event, a.getId() === silk ? a : b, a.getId() === silk ? b : a)) {
        event.handled = true;
        return;
    }
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
        container.setId(Data.itemId((action === "open" ? "Open " : "") + (kind === "seed" ? "seed box" : isSilklined(container) ? "silklined herb sack" : "herb sack")));
    } else if (action === "fill") {
        for (const item of [...inventory.getValidItems()]) {
            const amount = storeCrop(event.player, container, item.getId(), item.getAmount());
            if (amount) inventory.deleteNumber(item.getId(), amount);
        }
    } else {
        const stored = (container.getMetaValue("farming:stored") ?? {});
        if (action === "check") event.player.sendMessage(Object.entries(stored).map(([id, amount]) => `${amount} ${core.CacheDefinitions.getItem(+id).name}`).join(", ") || "The container is empty.");
        else for (const [id, count] of withdrawalEntries(stored, kind)) {
            const amount = Math.min(count, kind === "seed" ? inventory.contains(+id) || !inventory.isFull() ? count : 0 : inventory.getFreeSlots());
            if (amount && Patches.give(event.player, +id, amount)) { stored[id] -= amount; if (!stored[id]) delete stored[id]; }
        }
    }
    inventory.refreshItems();
}
/**
 * https://oldschool.runescape.wiki/w/Seed_box: open, it takes "seeds that the player picks up", seeds pickpocketed from
 * Master Farmers, and "looting Sailing creatures". Only these: it names salvage as not, and is silent on stalls. So
 * those two sources emit "seed-box:gather" { player, itemId, amount, stored }, and not "storage:gather", which every
 * open container answers. Silent, as no capture read shows a line: ours.
 */
function openSeedBox(player) {
    const open = Data.itemId("Open seed box");
    return player.getInventory().getItems().find(item => item?.getId() === open) ?? null;
}
function seedBoxGather(event) {
    const box = openSeedBox(event.player), left = event.amount - event.stored;
    if (box && left > 0) event.stored += storeCrop(event.player, box, event.itemId, left);
}
const seedPickupItems = new WeakSet();
const seedPickupPlayers = new WeakSet();
function seedBoxPickup(event) {
    if (event.handled) return;
    const { player, groundItem } = event, item = groundItem.getItem();
    const box = openSeedBox(player), manager = core.ItemOnGroundManager;
    const amount = item.getAmount(), itemId = item.getId();
    if (seedPickupItems.has(groundItem) || seedPickupPlayers.has(player)) {
        event.handled = true;
        return;
    }
    if (!box || item.getMeta() != null || !Number.isSafeInteger(amount) || amount <= 0) return;
    const room = storeRoom(player, box, itemId);
    const proposed = Math.min(amount, room);
    if (proposed <= 0) return;
    const position = groundItem.getPosition().clone(), owner = groundItem.getOwner();
    const area = groundItem.getPrivateArea(), state = groundItem.getState();
    const boxContents = JSON.stringify(box.getMetaValue("farming:stored") ?? {});
    const request = { player, groundItem, source: "pickup", itemId, amount: proposed, discard: 0, allow: true, error: null };
    seedPickupItems.add(groundItem);
    seedPickupPlayers.add(player);
    event.handled = true;
    try {
        core.PluginManager.emitCustomEvent("ground-items:take", request);
        if (request.allow !== true || request.error != null || !Number.isSafeInteger(request.amount)
            || request.amount <= 0 || request.amount > proposed || !Number.isSafeInteger(request.discard)
            || request.discard < 0 || request.amount + request.discard > amount) return;
        if (!core.World.getItems().includes(groundItem) || !manager.canSee(player, groundItem)
            || groundItem.getItem() !== item || item.getId() !== itemId || item.getAmount() !== amount
            || item.getMeta() != null || !groundItem.getPosition().equals(position) || groundItem.getOwner() !== owner
            || groundItem.getPrivateArea() !== area || groundItem.getState() !== state || openSeedBox(player) !== box
            || JSON.stringify(box.getMetaValue("farming:stored") ?? {}) !== boxContents
            || storeRoom(player, box, itemId) < request.amount) return;
        const stored = storeCrop(player, box, itemId, request.amount);
        const removed = stored + request.discard;
        if (removed === amount) manager.deregister(groundItem);
        else {
            groundItem.setOldAmount(amount);
            item.decrementAmountBy(removed);
            manager.perform(groundItem, core.GroundItemOperationType.ALTER);
        }
        core.PluginManager.emitCustomEvent("ground-items:taken", { player, groundItem, source: "pickup", itemId, amount: stored, discarded: request.discard });
        if (removed === amount) player.getLastItemPickup().reset();
        else event.handled = false; // The remainder follows the ordinary pickup route.
    } finally {
        seedPickupItems.delete(groundItem);
        seedPickupPlayers.delete(player);
    }
}
// https://oldschool.runescape.wiki/w/Herb_sack: Empty starts with the lowest-level herb.
function withdrawalEntries(stored, kind) {
    const entries = Object.entries(stored);
    if (kind !== "herb") return entries;
    const levels = new Map(entries.map(([id]) => {
        const request = { grimyId: +id };
        core.PluginManager.emitCustomEvent("herblore:clean", request);
        return [id, request.level ?? Infinity];
    }));
    return entries.sort(([a], [b]) => levels.get(a) - levels.get(b) || +a - +b);
}
function guildObject(event) {
    if (event.definition?.getName()?.toLowerCase() !== "seed vault") return;
    event.handled = true;
    Vault.open(event);
}
/** "farming:open-seed-vault": the seed vault from anywhere (content that carries it, a league relic's vault). */
function openSeedVault(event) {
    if (!event?.player || event.opened) return;
    event.opened = true;
    Vault.open({ player: event.player, object: null, anywhere: true });
}

Object.assign(module.exports, { seedBoxGather, seedBoxPickup, openHerbSack, CONTRACTS, guildNpc, completeContract, harvestContract, giveSeedPack, guildItemOnNpc, rewardItem, storeCrop, splitForOpenSack, pickup, storagePair, storageAction, bankStorageOp, guildObject, openSeedVault });
