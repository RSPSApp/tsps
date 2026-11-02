const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Model = require("./Model.Farming");
const Patches = require("./Patches.Farming");
const Tools = require("./Tools.Farming");

// Every gardener stands within 7 tiles of its patch; Ceto (drift nets, 20 tiles from the
// underwater seaweed) and Cap'n Izzy No-Beard (agility arena, 12) also advertise Pay.
const GARDENER_RANGE = 10;
// Cache OC_ITEM_OP1; equipment op1 removes, op2 starts the item's worn options.
const WORN_OPTION_PARAM = 451;
const COMPOST_NAMES = ["", "Compost", "Supercompost", "Ultracompost", "Rotten tomato"];
const ROTTEN_TOMATO_TIER = 4;
// Rev 241 gamevals human_push and human_pickuptable, with the sounds captured on the bin (recording 1858).
const BIN_LID_ANIMATION = 810;
const BIN_TAKE_ANIMATION = 832;
const BIN_CLOSE_SOUND = 2428;
const BIN_OPEN_SOUND = 2429;
const BIN_TAKE_SOUND = 2436;
const SUPER = new Set(["Pineapple", "Tenti pineapple", "Watermelon", "Coconut", "Half coconut", "Coconut shell", "Papaya fruit", "Calquat fruit", "Poison ivy berries", "White berries", "Jangerberries", "Mushroom", "Dragonfruit", "Snape grass", "Celastrus bark", "White lily", "White tree fruit", "Oak roots", "Willow roots", "Maple roots", "Yew roots", "Magic roots"]);
const COMPOST = new Set(["Weeds", "Grain", "Kebab", "Varlamorian kebab", "Flax", "Cotton boll", "Redberries", "Cadava berries", "Dwellberries", "Potato", "Onion", "Cabbage", "Tomato", "Sweetcorn", "Strawberry", "Lemon", "Lime", "Cooking apple", "Banana", "Orange", "Curry leaf", "Peach", "Watermelon slice", "Barley malt", "Hammerstone hops", "Asgarnian hops", "Jute fibre", "Kelda hops", "Yanillian hops", "Krandorian hops", "Wildblood hops", "Marigolds", "Rosemary", "Nasturtiums", "Woad leaf", "Limpwurt root", "Willow branch", "Rotten apple", "Apple mush", "Seaweed", "Edible seaweed", "Giant seaweed", "Potato cactus", "Leaves", "Oak leaves", "Willow leaves", "Maple leaves", "Yew leaves", "Magic leaves"]);
const SUPER_HERBS = new Set(["TOADFLAX", "AVANTOE", "KWUARM", "SNAPDRAGON", "HUASCA", "CADANTINE", "LANTADYME", "DWARF_WEED", "TORSTOL"]);
const TOOL_CAPACITY = { "Rake": 100, "Seed dibber": 100, "Spade": 100, "Secateurs": 100, "Magic secateurs": 100,
    "Gardening trowel": 100, "Plant cure": 1000, "Bucket": 1000, "Compost": 1000, "Supercompost": 1000, "Ultracompost": 1000,
    "Gricoller's can": 1, "Bottomless compost bucket": 1 };
const CONTAINERS = [["Potato", "Potatoes", 10], ["Onion", "Onions", 10], ["Cabbage", "Cabbages", 10],
    ["Cooking apple", "Apples", 5], ["Banana", "Bananas", 5], ["Orange", "Oranges", 5], ["Strawberry", "Strawberries", 5], ["Tomato", "Tomatoes", 5]];

function cropRewards(player, crop) {
    const base = Data.petRate(crop);
    if (!base) return;
    const level = Math.min(99, player.getSkillManager().getCurrentLevel(core.Skill.FARMING));
    if (crop.type !== "HESPORI" && !Patches.farmFor(player).disableHesporiSeeds) {
        const denominator = ["BARLEY", "HAMMERSTONE"].includes(crop.key) ? 244 : Math.floor(base / 500);
        if (Math.random() < 1 / denominator) {
            const seed = new core.Item(Data.itemId("Hespori seed"));
            if (player.getInventory().getAddableAmount(seed) >= 1 && Patches.give(player, seed.getId()))
                player.sendMessage("You find a Hespori seed!");
        }
    }
    // Farming resources have priority over a pet that would need the final backpack slot.
    core.PluginManager.emitCustomEvent("farming:success", { player, skill: core.Skill.FARMING,
        petChance: (base - 25 * level) / (player.getSkillManager().getExperience(core.Skill.FARMING) >= 200000000 ? 15 : 1) });

}

function binFor(state) {
    return state.bin ??= { count: 0, super: 0, tomatoes: 0, tier: 1, closedAt: 0, open: false };
}
function binValue(patch, state) {
    const bin = binFor(state);
    if (!bin.count) return 0;
    const prefix = patch.type === "BIG_COMPOST" ? "BIG_" : "";
    const key = prefix + ["", "COMPOST", "SUPERCOMPOST", "ULTRACOMPOST", "ROTTEN_TOMATO"][bin.tier];
    const states = Data.CACHE.states[patch.type][key];
    if (bin.open) return states.HARVESTABLE[bin.count - 1];
    if (bin.closedAt) return states.GROWING[Date.now() - bin.closedAt >= (bin.tier === 2 ? 90 : 60) * Model.MINUTE ? 2 : 0];
    return states.FILLING[bin.count - 1];
}
function binAction(player, patch, action, usedId, usedSlot) {
    const bin = binFor(Patches.stateFor(player, patch));
    const capacity = patch.type === "BIG_COMPOST" ? 30 : 15;
    const inventory = player.getInventory();
    if (usedId && core.CacheDefinitions.getItem(usedId).noteTemplate >= 0) {
        player.sendMessage("You cannot use noted items on a compost bin."); return;
    }
    if (action === "dump") {
        if (bin.count) confirmDump(player, patch, bin);
        return;
    }
    // Captures (recording 1858): the push and its sound with the spam line, the bin changing a tick later.
    if (action === "close") {
        if (bin.count !== capacity) { player.sendMessage(`The bin needs ${capacity} items before you can close it.`); return; }
        pushLid(player, BIN_CLOSE_SOUND, "You close the compost bin.");
        Patches.after(player, 1, () => {
            if (!bin.closedAt) bin.closedAt = Date.now();
            bin.open = false;
            player.sendMessage("The contents have begun to rot.");
            Patches.syncPatch(player, patch);
        });
        return;
    }
    if (action === "open") {
        if (!bin.closedAt || Date.now() - bin.closedAt < (bin.tier === 2 ? 90 : 60) * Model.MINUTE) { player.sendMessage("The contents have not finished rotting."); return; }
        pushLid(player, BIN_OPEN_SOUND, "You open the compost bin.");
        Patches.after(player, 1, () => { bin.open = true; Patches.syncPatch(player, patch); });
        return;
    }
    if (usedId === Data.itemId("Volcanic ash")) {
        const amount = capacity === 30 ? 50 : 25;
        if (bin.tier !== 2 || !bin.open || inventory.getAmount(usedId) < amount) {
            player.sendMessage(`Use ${amount} volcanic ash on an open bin of supercompost.`); return;
        }
        inventory.deleteNumber(usedId, amount); bin.tier = 3;
        return;
    }
    if (usedId && /^Compost potion\([1-4]\)$/.test(core.CacheDefinitions.getItem(usedId).name)) {
        if (!bin.open || bin.tier !== 1) { player.sendMessage("Use this on an open bin of compost."); return; }
        dose(player, usedId); bin.tier = 2;
        return;
    }
    const bottomless = usedId !== undefined && core.CacheDefinitions.getItem(usedId).name === "Bottomless compost bucket";
    if (usedId === Data.itemId("Bucket") || action === "empty" || action === "take" || bottomless) {
        if (!bin.open || !bin.count) { player.sendMessage("Open a finished compost bin first."); return; }
        if (bottomless) {
            const bucket = inventory.forSlot(usedSlot);
            if (bucket?.getId() !== usedId || bin.tier === 4 || !chargeBottomless(player, bin.tier, bucket)) return;
            takenFromBin(player, patch, bin);
            return;
        }
        if (!canTakeBinProduct(player, bin)) return;
        Patches.startBinWork(player, patch, { bin }, "take-bin");
        return;
    }
    if (usedId) {
        if (bin.closedAt || bin.open || bin.count >= capacity) { player.sendMessage("You cannot add anything else to this bin."); return; }
        const name = core.CacheDefinitions.getItem(usedId).name;
        const herb = [...Data.CROPS.values()].find(c => c.type === "HERB" && (c.produce === usedId || core.CacheDefinitions.getItem(c.produce).name.replace(/^Grimy /, "").toLowerCase() === name.toLowerCase()));
        const superItem = SUPER.has(name) || (herb && SUPER_HERBS.has(herb.key));
        if (!superItem && !COMPOST.has(name) && !herb) {
            player.sendMessage("That cannot be composted."); return;
        }
        const input = { id: usedId, superItem, tomato: name === "Tomato", bin };
        if (bin.count && (superItem ? bin.super < bin.count : bin.super > 0))
            confirmBinMix(player, patch, input, usedSlot);
        else Patches.startBinWork(player, patch, input);
        return;
    }
    player.sendMessage(`The compost bin contains ${bin.count}/${capacity} items${bin.closedAt && !bin.open ? ", rotting" : ""}.`);
}
// The Wiki specifies a mixing warning; no indexed capture establishes its exact wording.
function confirmBinMix(player, patch, input, slot) {
    const inventory = player.getInventory(), item = inventory.forSlot(slot);
    if (!item || item.getId() !== input.id || item.getAmount() <= 0) return;
    const position = player.getLocation().clone(), area = player.getArea();
    const contents = JSON.stringify(input.bin), stock = JSON.stringify(item);
    Patches.choose(player, [["Yes, mix the ingredients.", () => {
        if (!player.isRegistered() || player.getHitpoints() <= 0 || player.isNeedsPlacement()
            || player.getArea() !== area || !player.getLocation().equals(position)
            || Patches.stateFor(player, patch).bin !== input.bin || JSON.stringify(input.bin) !== contents
            || inventory.forSlot(slot) !== item || JSON.stringify(item) !== stock) return;
        Patches.startBinWork(player, patch, input);
    }], ["No, keep the ingredients.", () => {}]], 0, "Mixing these ingredients will produce normal compost. Continue?");
}
// The Wiki permits discarding contents; no indexed capture establishes the Dump prompt or timing.
function confirmDump(player, patch, bin) {
    const position = player.getLocation().clone(), area = player.getArea();
    const contents = JSON.stringify(bin);
    Patches.choose(player, [["Yes, discard the contents.", () => {
        if (!player.isRegistered() || player.getHitpoints() <= 0 || player.isNeedsPlacement()
            || player.getArea() !== area || !player.getLocation().equals(position)
            || Patches.stateFor(player, patch).bin !== bin || JSON.stringify(bin) !== contents) return;
        Patches.stateFor(player, patch).bin = undefined;
        Patches.syncPatch(player, patch);
        player.sendMessage("You empty the compost bin.");
    }], ["No, keep them.", () => {}]], 0, "Discard all contents of this compost bin?");
}
function pushLid(player, sound, line) {
    player.performAnimation(new core.Animation(BIN_LID_ANIMATION));
    Patches.sound(player, sound);
    Patches.spam(player, line);
}
function takenFromBin(player, patch, bin) {
    Patches.award(player, [0, 4.5, 8.5, 10, 4.5][bin.tier]);
    if (--bin.count === 0) Patches.stateFor(player, patch).bin = undefined;
    Patches.syncPatch(player, patch);
}
function binBottomless(player, bin) {
    return player.getInventory().getItems().find(item => {
        if (item.getAmount() !== 1 || ![core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET,
            core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET_4].includes(item.getId())) return false;
        const charges = Number(item.getMetaValue("farming:charges") ?? 0);
        return Number.isInteger(charges) && charges >= 0 && charges <= 9998
            && (!charges || item.getMetaValue("farming:tier") === bin.tier);
    });
}
function canTakeBinProduct(player, bin) {
    if (bin.tier === ROTTEN_TOMATO_TIER) {
        // Wiki Rotten tomato: no tools; unlike compost, collecting one does not consume a bucket.
        if (player.getInventory().getAddableAmount(new core.Item(Data.itemId("Rotten tomato"))) > 0) return true;
        player.sendMessage("You don't have space to hold a rotten tomato, squishy though it may be.");
        return false;
    }
    if (player.getInventory().contains(Data.itemId("Bucket")) || binBottomless(player, bin)) return true;
    player.sendMessage("You need an empty bucket or a suitable bottomless compost bucket with room.");
    return false;
}
/** Captures: buckets are filled one at a time, the scoop and its sound, the bucket a tick later, every four ticks. */
function takeBinStep(player, work) {
    const { bin } = work.input;
    const inventory = player.getInventory();
    if (Patches.stateFor(player, work.patch).bin !== bin || !bin.open || !bin.count || !canTakeBinProduct(player, bin)) return false;
    if (!work.depositing) {
        player.performAnimation(new core.Animation(BIN_TAKE_ANIMATION));
        Patches.sound(player, BIN_TAKE_SOUND);
        work.depositing = true;
        return 1;
    }
    // Capacity is rechecked above on the output tick, before any output, depletion or XP.
    if (bin.tier === ROTTEN_TOMATO_TIER || inventory.contains(Data.itemId("Bucket"))) {
        if (bin.tier !== ROTTEN_TOMATO_TIER) inventory.deleteNumber(Data.itemId("Bucket"), 1);
        inventory.addItem(new core.Item(Data.itemId(COMPOST_NAMES[bin.tier])));
        // "farming:bin-taken" { player, itemId }: a bucket filled from the bin (or a rotten tomato taken).
        core.PluginManager.emitCustomEvent("farming:bin-taken", { player, itemId: Data.itemId(COMPOST_NAMES[bin.tier]) });
    } else {
        // Choose from the live inventory at output time; ordinary buckets always have priority.
        const bucket = binBottomless(player, bin);
        if (!bucket || !chargeBottomless(player, bin.tier, bucket)) return false;
    }
    takenFromBin(player, work.patch, bin);
    work.depositing = false;
    return bin.count > 0 && (bin.tier === ROTTEN_TOMATO_TIER || inventory.contains(Data.itemId("Bucket"))
        || binBottomless(player, bin)) ? 3 : false;
}
function dose(player, id) {
    const name = core.CacheDefinitions.getItem(id).name;
    const count = Number(name.match(/\((\d)\)$/)[1]);
    player.getInventory().deleteNumber(id, 1);
    player.getInventory().addItem(new core.Item(Data.itemId(count > 1 ? `Compost potion(${count - 1})` : "Vial")));
}
function chargeBottomless(player, tier, bucket, amount = 1, refresh = true) {
    if (!bucket) return false;
    const charges = Number(bucket.getMetaValue("farming:charges") ?? 0);
    if (charges > 0 && bucket.getMetaValue("farming:tier") !== tier) { player.sendMessage("Empty the bucket before changing compost type."); return false; }
    if (charges + amount * 2 > 10000) { player.sendMessage("The bucket is full."); return false; }
    bucket.setMetaValue("farming:charges", charges + amount * 2).setMetaValue("farming:tier", tier);
    bucket.setId(core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET_4);
    if (refresh) player.getInventory().refreshItems();
    return true;
}
/** Plan the complete conversion before committing either charges or returned buckets. */
function fillBottomless(player, event, bucketFirst, tier, noted) {
    const inventory = player.getInventory();
    const bucketSlot = bucketFirst ? event.usedItemSlot : event.usedWithItemSlot;
    const inputSlot = bucketFirst ? event.usedWithItemSlot : event.usedItemSlot;
    const bucket = inventory.forSlot(bucketSlot), input = inventory.forSlot(inputSlot);
    if (!bucket || !input || bucketSlot === inputSlot
        || bucket.getId() !== (bucketFirst ? event.usedItemId : event.usedWithItemId)
        || input.getId() !== (bucketFirst ? event.usedWithItemId : event.usedItemId)
        || core.CacheDefinitions.getItem(bucket.getId()).noteTemplate >= 0) return;
    const charges = Number(bucket.getMetaValue("farming:charges") ?? 0);
    const amount = noted ? Math.min(input.getAmount(), Math.floor((10000 - charges) / 2)) : 1;
    if (amount <= 0) { player.sendMessage("The bucket is full."); return; }
    const planned = new inventory.constructor(player).setItems(inventory.getCopiedItems());
    planned.deleteAtSlot(inputSlot, amount, false);
    const emptyId = Data.itemId("Bucket");
    const output = new core.Item(noted ? core.CacheDefinitions.getItem(emptyId).note : emptyId, amount);
    if (planned.getAddableAmount(output) < amount) { inventory.full(); return; }
    if (!chargeBottomless(player, tier, planned.forSlot(bucketSlot), amount, false)) return;
    planned.add(output, false);
    inventory.setItems(planned.getItems()).refreshItems();
}

function useBottomless(player, patch, id, slot) {
    const bucket = player.getInventory().forSlot(slot);
    if (bucket?.getId() !== id) return;
    const charges = Number(bucket?.getMetaValue("farming:charges") ?? 0);
    if (!charges) { player.sendMessage("The bucket is empty."); return; }
    Patches.pourCompost(player, patch, Number(bucket.getMetaValue("farming:tier")), () => {
        const left = Number(bucket.getMetaValue("farming:charges") ?? 0);
        if (!player.getInventory().getItems().includes(bucket) || !left) return false;
        bucket.setMetaValue("farming:charges", left - 1);
        if (left === 1) bucket.setId(core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET);
        player.getInventory().refreshItems();
        return true;
    });
}
function farmingItemPair(event) {
    const { player, usedItemId: a, usedWithItemId: b } = event;
    const inventory = player.getInventory();
    if (!inventory.contains(a) || !inventory.contains(b)) return;
    const names = [core.CacheDefinitions.getItem(a).name, core.CacheDefinitions.getItem(b).name];
    if (([a, b].includes(core.ItemIdentifiers.HAY_SACK) && names.includes("Bronze spear")) || ([a, b].includes(core.ItemIdentifiers.HAY_SACK_2) && names.includes("Watermelon"))) {
        event.handled = true;
        if (!Patches.hasLevel(player, Patches.SCARECROW_LEVEL, "scarecrow")) return;
        inventory.deleteNumber(a, 1); inventory.deleteNumber(b, 1);
        const finished = names.includes("Watermelon");
        inventory.addItem(new core.Item(finished ? Data.itemId("Scarecrow") : core.ItemIdentifiers.HAY_SACK_2));
        if (finished) Patches.award(player, 25);
        return;
    }
    const crop = [...Data.CROPS.values()].find(c => c.sapling && (c.seed === a || c.seed === b));
    if (crop && (a === Data.itemId("Filled plant pot") || b === Data.itemId("Filled plant pot"))) {
        event.handled = true;
        if (!Patches.requireTool(player, "Gardening trowel")) return;
        if (!Patches.hasLevel(player, crop.level, "seedling")) return;
        inventory.deleteNumber(crop.seed, 1);
        inventory.deleteNumber(Data.itemId("Filled plant pot"), 1);
        inventory.addItem(new core.Item(crop.seedling));
        return;
    }
    const seedling = [...Data.CROPS.values()].find(c => c.seedling === a || c.seedling === b);
    if (seedling) {
        const can = a === seedling.seedling ? b : a;
        if (!/^Watering can(?:\([1-8]\))?$|^Magic watering can$|^Gricoller's can$/.test(core.CacheDefinitions.getItem(can).name)) return;
        event.handled = true;
        const canSlot = a === seedling.seedling ? event.usedWithItemSlot : event.usedItemSlot;
        if (!Patches.water(player, can, canSlot)) return;
        const slot = a === seedling.seedling ? event.usedItemSlot : event.usedWithItemSlot;
        const saplingAt = Model.nextGrowth(Date.now(), 5, Patches.farmFor(player).offset);
        inventory.forSlot(slot).setId(seedling.wateredSeedling).setMetaValue("farming:sapling-at", saplingAt);
        Patches.noteSeedling(player, saplingAt);
        inventory.refreshItems();
        return;
    }
    const bucketFirst = names[0] === "Bottomless compost bucket";
    if (bucketFirst || names[1] === "Bottomless compost bucket") {
        const inputId = bucketFirst ? b : a;
        const definition = core.CacheDefinitions.getItem(inputId);
        const noted = definition.noteTemplate >= 0;
        const baseId = noted ? definition.note : inputId;
        const tier = COMPOST_NAMES.slice(1, 4).findIndex(name => Data.itemId(name) === baseId) + 1;
        if (tier) {
            event.handled = true;
            fillBottomless(player, event, bucketFirst, tier, noted);
            return;
        }
    }
    const compostTier = COMPOST_NAMES.slice(1, 4).findIndex(name => Data.itemId(name) === a || Data.itemId(name) === b) + 1;
    if (compostTier === 2 && (a === Data.itemId("Volcanic ash") || b === Data.itemId("Volcanic ash"))) {
        event.handled = true;
        if (inventory.getAmount(Data.itemId("Volcanic ash")) < 2) { player.sendMessage("You need two volcanic ash."); return; }
        inventory.deleteNumber(Data.itemId("Volcanic ash"), 2);
        inventory.deleteNumber(Data.itemId("Supercompost"), 1);
        inventory.addItem(new core.Item(Data.itemId("Ultracompost")));
        return;
    }
    const potion = [a, b].find(id => /^Compost potion\([1-4]\)$/.test(core.CacheDefinitions.getItem(id).name));
    if (compostTier === 1 && potion) {
        event.handled = true;
        dose(player, potion);
        inventory.deleteNumber(Data.itemId("Compost"), 1);
        inventory.addItem(new core.Item(Data.itemId("Supercompost")));
        return;
    }
    for (const [produce, plural, capacity] of CONTAINERS) {
        if (a !== Data.itemId(produce) && b !== Data.itemId(produce)) continue;
        const container = a === Data.itemId(produce) ? b : a;
        const name = core.CacheDefinitions.getItem(container).name;
        const current = name === (capacity === 10 ? "Empty sack" : "Basket") ? 0 : name.startsWith(`${plural}(`) ? Number(name.match(/\((\d+)\)/)?.[1]) : -1;
        if (current < 0 || current >= capacity) continue;
        event.handled = true;
        const amount = Math.min(capacity - current, inventory.getAmount(Data.itemId(produce)));
        inventory.deleteNumber(Data.itemId(produce), amount);
        inventory.deleteNumber(container, 1);
        inventory.addItem(new core.Item(Data.itemId(`${plural}(${current + amount})`)));
        return;
    }
}
/** Turns due watered seedlings into saplings; returns when the next one is due, or Infinity. */
function growSeedlings(player, now) {
    let next = Infinity;
    for (const container of [player.getInventory(), ...player.getBanks()]) {
        if (!container) continue; // Bank tabs are created lazily, including for bots.
        let changed = false;
        for (const item of container.getItems()) {
            const crop = item && item.getAmount() > 0 && Data.WATERED_SEEDLINGS.get(item.getId());
            if (!crop) continue;
            const at = item.getMetaValue("farming:sapling-at");
            if (!at) {
                const due = Model.nextGrowth(now, Data.FORMULAS.growth.tickMinutes, Patches.farmFor(player).offset);
                item.setMetaValue("farming:sapling-at", due);
                next = Math.min(next, due);
            } else if (now >= at) { item.setId(crop.sapling).setMetaValue("farming:sapling-at", undefined); changed = true; }
            else next = Math.min(next, at);
        }
        if (changed) container.refreshItems();
    }
    return next;
}
function waterContainers({ containers }) {
    for (const crop of Data.CROPS.values()) if (crop.seedling) containers.set(crop.seedling, crop.wateredSeedling);
    for (let charges = 1; charges < 8; charges++) containers.set(Data.itemId(`Watering can(${charges})`), Data.itemId("Watering can(8)"));
}
function humidified({ player }) {
    // Assign the same persistent farming-clock deadline used for hand-watered seedlings.
    Patches.noteSeedling(player, growSeedlings(player, Date.now()));
}
function toolCapacity(name) {
    return TOOL_CAPACITY[name] ?? (/^Watering can|^Gricoller's can$/.test(name) ? 1 : 0);
}
function storeTool(player, slot, maximum = Infinity) {
    const inventory = player.getInventory(), item = inventory.forSlot(slot);
    if (!item || item.getId() < 0) return false;
    const definition = core.CacheDefinitions.getItem(item.getId());
    const id = definition.noteTemplate >= 0 ? definition.note : item.getId();
    const name = core.CacheDefinitions.getItem(id).name;
    const watering = /^Watering can|^Gricoller's can$/.test(name);
    const capacity = toolCapacity(name);
    if (!capacity) return false;
    const farm = Patches.farmFor(player), tools = farm.tools;
    if (/secateurs/i.test(name) && Object.entries(tools).some(([key, count]) => count > 0
        && +key !== id && /secateurs/i.test(core.CacheDefinitions.getItem(+key).name))) {
        player.sendMessage("Withdraw your stored secateurs before storing a different kind."); return true;
    }
    const used = Object.entries(tools).reduce((sum, [key, count]) => {
        const other = core.CacheDefinitions.getItem(+key).name;
        return sum + (watering ? /^Watering can|^Gricoller's can$/.test(other) ? count : 0
            : /secateurs/i.test(name) ? /secateurs/i.test(other) ? count : 0 : other === name ? count : 0);
    }, 0);
    const amount = Math.min(inventory.getAmount(item.getId()), capacity - used, maximum);
    if (amount <= 0) { player.sendMessage("I cannot store any more of those."); return true; }
    if (capacity === 1) {
        (farm.toolMeta ??= {})[id] = core.Item.cloneMeta(item.getMeta());
        inventory.deleteAtSlot(slot);
    } else inventory.deleteNumber(item.getId(), amount);
    tools[id] = (tools[id] ?? 0) + amount;
    return true;
}
function farmingItemOnNpc(event) {
    const { player, target, itemId: id } = event;
    if (!(event.definition ?? target.getDefinition())?.getName()?.toLowerCase().includes("leprechaun")) return;
    event.handled = true;
    if (!player.getInventory().contains(id)) return;
    const definition = core.CacheDefinitions.getItem(id);
    const unnoted = definition.noteTemplate >= 0 ? definition.note : id;
    const name = core.CacheDefinitions.getItem(unnoted).name;
    if (toolCapacity(name)) {
        if (!player.getLocation().isWithinDistance(target.getLocation(), 5)) return;
        const pin = { player, feature: "tool-leprechaun", resume: () => {
            // The player may rearrange inventory while the keypad is open.
            if (player.getInventory().forSlot(event.slot)?.getId() === id) farmingItemOnNpc(event);
        } };
        core.PluginManager.emitCustomEvent("bank-pin:guard", pin);
        if (pin.locked) return;
    }
    if (storeTool(player, event.slot)) return;
    const harvested = ["Weeds", "Willow branch"].includes(name) || [...Data.CROPS.values()].some(c => c.sapling === id || (!Data.WOOD_TREES.has(c.type) && c.produce === id)
        || (c.type === "HERB" && core.CacheDefinitions.getItem(c.produce).name.replace(/^Grimy /, "").toLowerCase() === name.toLowerCase()));
    const loc = target.getLocation();
    if (name === "Cabbage" && loc.getX() > 3040 && loc.getX() < 3070 && loc.getY() > 3280 && loc.getY() < 3320) {
        player.sendMessage("I won't note cabbages here!"); return;
    }
    if (!harvested || definition.noteTemplate >= 0 || definition.note < 0) { player.sendMessage("I can note harvested produce and store farming tools."); return; }
    const inventory = player.getInventory(), amount = inventory.getAmount(id);
    // Reserve the complete output after freeing the produce slots, including stack limits.
    const planned = new inventory.constructor(player);
    planned.setItems(inventory.getCopiedItems());
    for (let slot = 0; slot < planned.capacity(); slot++) {
        const item = planned.forSlot(slot);
        if (item.getId() === id) planned.deleteAtSlot(slot, item.getAmount(), false);
    }
    const noted = new core.Item(definition.note, amount);
    if (planned.getAddableAmount(noted) < amount) { inventory.full(); return; }
    inventory.deleteNumber(id, amount);
    inventory.addItem(noted);
}
function farmingNpc(event) {
    const { player, npc, definition } = event;
    const name = definition?.getName() ?? npc.getDefinition()?.getName() ?? "";
    const action = definition?.getActions()?.[event.clickType - 1]?.toLowerCase();
    if (name === "Otto Godblessed" && action === "talk-to") {
        event.handled = true;
        Patches.choose(player, [["Learn barbarian Farming", () => {
            if (!player.getLocation().isWithinDistance(npc.getLocation(), 5)) return;
            const training = Patches.farmFor(player).barbarian ??= { planting: 0, smashing: 0, autoSmash: false };
            if (!training.planting) { training.planting = 1; player.sendMessage("Plant a seed bare-handed, without carrying a seed dibber, then return to Otto."); }
            else if (training.planting === 1) player.sendMessage("First successfully plant a seed bare-handed. Grapes do not count.");
            else {
                training.planting = 3;
                player.getPacketSender().sendVarbit(9609, 3);
                if (player.getSkillManager().getMaxLevel(core.Skill.FARMING) < 15) { player.sendMessage("You need level 15 Farming to learn pot-smashing."); return; }
                if (!training.smashing) {
                    training.smashing = 1; training.autoSmash = true;
                    player.sendMessage("Plant a sapling and smash its empty pot, then return. Spirit trees do not count for training.");
                } else if (training.smashing === 1) player.sendMessage("Plant a sapling and smash its empty pot before returning.");
                else { training.smashing = 3; player.sendMessage("You have completed your barbarian Farming training."); }
                player.getPacketSender().sendVarbit(9610, training.smashing).sendVarbit(9614, training.autoSmash ? 1 : 0);
            }
        }], ["Toggle automatic pot-smashing", () => {
            if (!player.getLocation().isWithinDistance(npc.getLocation(), 5)) return;
            const training = Patches.farmFor(player).barbarian;
            if (!training?.smashing) { player.sendMessage("Learn pot-smashing first."); return; }
            training.autoSmash = !training.autoSmash;
            player.getPacketSender().sendVarbit(9614, training.autoSmash ? 1 : 0);
            player.sendMessage(`Automatic pot-smashing is ${training.autoSmash ? "enabled" : "disabled"}.`);
        }]]);
        return;
    }
    if (name === "Arno" && action === "talk-to") {
        event.handled = true;
        const farm = Patches.farmFor(player);
        Patches.choose(player, [[`${farm.disableHesporiSeeds ? "Enable" : "Disable"} Hespori seed drops`, () => {
            farm.disableHesporiSeeds = !farm.disableHesporiSeeds;
            player.sendMessage(`Hespori seed drops ${farm.disableHesporiSeeds ? "disabled" : "enabled"}.`);
        }]]);
        return;
    }
    if (/leprechaun/i.test(name)) {
        event.handled = true;
        if (!player.getLocation().isWithinDistance(npc.getLocation(), 5)) return;
        const pin = { player, feature: "tool-leprechaun", resume: () => farmingNpc(event) };
        core.PluginManager.emitCustomEvent("bank-pin:guard", pin);
        if (pin.locked) return;
        if (action === "deposit-all") {
            for (let slot = 0; slot < player.getInventory().capacity(); slot++) storeTool(player, slot);
            return;
        }
        Tools.open(player, npc);
        return;
    }
    if (action !== "pay" && action !== "pay-fare" && action !== "talk-to") return;
    const pos = npc.getLocation();
    const patches = Data.CACHE.patches.filter(p => p.z === pos.getZ() && Math.abs(p.x - pos.getX()) <= GARDENER_RANGE && Math.abs(p.y - pos.getY()) <= GARDENER_RANGE);
    // A "Pay" option alone does not make an NPC a gardener: Bonzo (contest fee), Saniboch
    // (Brimhaven entrance) and the Blast Furnace foreman all advertise Pay. A gardener only
    // exists where a patch does, so never claim an NPC with no patch nearby.
    if (!patches.length) return;
    const relevant = patches.filter(p => {
        const s = Patches.farmFor(player).patches[Data.patchKey(p)];
        const c = s?.crop && Data.CROPS.get(s.crop);
        return c && (c.payment.length || Data.WOOD_TREES.has(c.type) || c.type === "FRUIT_TREE");
    });
    // Gardener NPCs advertise Pay; never hijack unrelated NPC conversations near a patch.
    if (!definition?.getActions()?.some(option => option?.toLowerCase() === "pay")) return;
    event.handled = true;
    if (!relevant.length) {
        // Captured from the tree gardeners; the others keep the server's own line.
        if (patches.some(p => ["TREE", "FRUIT_TREE", "HARDWOOD_TREE", "SPIRIT_TREE", "CALQUAT"].includes(p.type)))
            gardenerSays(player, npc, "You don't have a sapling planted in that patch. Plant one and I might agree to look after it for you.");
        else player.sendMessage("Plant a crop before asking me to look after it.");
        return;
    }
    const entries = relevant.map(p => {
        const crop = Data.CROPS.get(Patches.stateFor(player, p).crop);
        return [`${Patches.stateFor(player, p).status === "grown" && (Data.WOOD_TREES.has(crop.type) || crop.type === "FRUIT_TREE") ? "Clear" : "Protect"} ${crop.name} (${p.x}, ${p.y})`,
            () => askGardener(player, npc, p)];
    });
    if (entries.length === 1) entries[0][1]();
    else Patches.choose(player, entries);
}
function gardenerSays(player, npc, text) {
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.NpcDialogue(0, npc.getId(), text)));
}
/** "25 coconuts", "3 baskets of strawberries", as the gardeners name a payment. */
function paymentText(payment) {
    return payment.map(([id, count]) => {
        const name = core.CacheDefinitions.getItem(id).name.toLowerCase();
        const filled = name.match(/^(.+)\((\d+)\)$/);
        if (filled) return `${count} ${+filled[2] === 10 ? "sack" : "basket"}${count === 1 ? "" : "s"} of ${filled[1]}`;
        return count === 1 || name.endsWith("s") ? `${count} ${name}` : `${count} ${name}s`;
    }).join(" and ");
}
/**
 * Captures (gardeners Fayeth, Treznor, the fruit and farming guild gardeners): a grown tree is chopped
 * for coins after "Pay 200 Coins to have your tree chopped down?"; protection asks "Pay <payment>?"
 * (Yes./No./Yes and don't ask again.), or the gardener says "I want <payment> for that." without it.
 */
function askGardener(player, npc, p) {
    if (!Patches.nearPatch(player, p)) return;
    const state = Patches.stateFor(player, p);
    const crop = Data.CROPS.get(state.crop);
    if (!crop) return;
    if (state.status === "grown" && (Data.WOOD_TREES.has(crop.type) || crop.type === "FRUIT_TREE")) {
        const price = crop.type === "REDWOOD" ? 2000 : 200;
        Patches.choose(player, [["Yes.", () => {
            if (!Patches.nearPatch(player, p) || Patches.stateFor(player, p) !== state) return;
            if (!state.checked) { player.sendMessage("Check the tree's health first."); return; }
            if (player.getInventory().getAmount(core.ItemIdentifiers.COINS) < price) { gardenerSays(player, npc, `I'll want ${price} Coins to chop down your tree.`); return; }
            player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, price); Patches.clearPatch(player, p);
        }], ["No.", () => {}]], 0, `Pay ${price} Coins to have your tree chopped down?`);
        return;
    }
    if (state.status === "grown") { gardenerSays(player, npc, "That patch is already fully grown! I don't know what you want me to do with it!"); return; }
    if (state.protected || state.status === "dead" || !crop.payment.length) { gardenerSays(player, npc, "That crop does not need my protection."); return; }
    if (!canPay(player, crop.payment)) { gardenerSays(player, npc, `I want ${paymentText(crop.payment)} for that.`); return; }
    const farm = Patches.farmFor(player);
    const accept = () => {
        if (!Patches.nearPatch(player, p) || Patches.stateFor(player, p) !== state || state.protected || !canPay(player, crop.payment)) return;
        pay(player, crop.payment);
        state.protected = true;
        if (state.status === "diseased") { state.status = "growing"; state.nextAt = Model.nextGrowth(Date.now(), Data.stageMinutes(crop, state.stage), farm.offset); }
        Patches.spam(player, `You pay the gardener ${paymentText(crop.payment)} to protect the patch.`);
        gardenerSays(player, npc, `That'll do nicely, ${player.getAppearance().isMale() ? "sir" : "madam"}. Leave it with me - I'll make sure that patch grows for you.`);
    };
    if (farm.gardenerNoAsk) { accept(); return; }
    Patches.choose(player, [["Yes.", accept], ["No.", () => {}], ["Yes and don't ask again.", () => { farm.gardenerNoAsk = true; accept(); }]],
        0, `Pay ${paymentText(crop.payment)}?`);
}
function canPay(player, payment) {
    const inventory = player.getInventory();
    return payment.every(([id, amount]) => {
        const note = core.CacheDefinitions.getItem(id).note;
        return inventory.getAmount(id) + (note >= 0 ? inventory.getAmount(note) : 0) >= amount;
    });
}
function pay(player, payment) {
    const inventory = player.getInventory();
    for (const [id, amount] of payment) {
        const unnoted = Math.min(amount, inventory.getAmount(id));
        if (unnoted) inventory.deleteNumber(id, unnoted);
        if (amount > unnoted) inventory.deleteNumber(core.CacheDefinitions.getItem(id).note, amount - unnoted);
    }
}
function farmingItemAction(event) {
    const { player, itemId: id } = event;
    const container = event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID ? player.getEquipment() : player.getInventory();
    const item = container.forSlot(event.slot);
    if (!item || item.getId() !== id) return;
    const name = core.CacheDefinitions.getItem(id).name;
    const definition = core.CacheDefinitions.getItem(id);
    const option = container === player.getEquipment()
        ? event.clickType >= 2 ? definition.params?.get?.(WORN_OPTION_PARAM + event.clickType - 2) : undefined
        : definition.inventoryActions?.[event.clickType - 1];
    const action = (event.option ?? option)?.toLowerCase();
    if (name === "Amulet of bounty" && ["check", "break"].includes(action)) {
        event.handled = true;
        if (action === "check") player.sendMessage(`Your amulet of bounty has ${Patches.farmFor(player).bountyCharges ?? 10} charges.`);
        else { player.getInventory().deleteAtSlot(event.slot); Patches.farmFor(player).bountyCharges = 10; }
        return;
    }
    if (name === "Ash covered tome" && action === "read") {
        event.handled = true;
        Patches.farmFor(player).ultraFertile = true;
        player.getPacketSender().sendVarbit(5960, 1);
        player.getInventory().deleteAtSlot(event.slot);
        player.sendMessage("You learn to use two volcanic ash with Fertile Soil to apply ultracompost.");
        return;
    }
    if (name === "Amulet of Nature" && action === "rub") {
        event.handled = true;
        const bound = Patches.farmFor(player).boundPatch;
        const patch = Data.CACHE.patches.find(p => Data.patchKey(p) === bound);
        if (!patch) player.sendMessage("Use the amulet on a farming patch to bind it.");
        else {
            // A growth boundary can pass after the scheduled refresh but before this input.
            Model.advanceFarm(Patches.farmFor(player), Date.now());
            const state = Patches.stateFor(player, patch);
            player.sendMessage(`Your bound patch: ${state.crop ? `${Data.CROPS.get(state.crop).name}, ${state.status}` : "empty"}.`);
        }
        return;
    }
    if (name === "Gricoller's can" && action === "check") {
        event.handled = true;
        player.sendMessage(`The can contains ${item.getMetaValue("farming:water") ?? 0} doses of water.`);
        return;
    }
    if (name === "Bottomless compost bucket" && action === "check") {
        event.handled = true;
        player.sendMessage(`The bucket contains ${item.getMetaValue("farming:charges") ?? 0} compost charges.`);
        return;
    }
    if (name === "Bottomless compost bucket" && action === "empty") {
        event.handled = true;
        Patches.choose(player, [["Discard all compost", () => {
            if (!player.getInventory().getItems().includes(item)) return;
            item.setMetaValue("farming:charges", 0).setMetaValue("farming:tier", 0);
            item.setId(core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET);
            player.getInventory().refreshItems();
        }], ["Keep the compost", () => {}]]);
        return;
    }
    for (const [produce, plural, capacity] of CONTAINERS) {
        if (!name.startsWith(`${plural}(`) || action !== "empty") continue;
        event.handled = true;
        const count = Number(name.match(/\((\d+)\)/)?.[1]);
        if (!Patches.give(player, Data.itemId(produce), count)) return;
        player.getInventory().deleteNumber(id, 1);
        player.getInventory().addItem(new core.Item(Data.itemId(capacity === 10 ? "Empty sack" : "Basket")));
        return;
    }
}

Object.assign(module.exports, { cropRewards, binValue, binAction, useBottomless, farmingItemPair, growSeedlings, waterContainers, humidified, farmingItemOnNpc, farmingNpc, farmingItemAction, storeTool, takeBinStep });
