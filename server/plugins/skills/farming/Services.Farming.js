const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Model = require("./Model.Farming");
const Patches = require("./Patches.Farming");

const COMPOST_NAMES = ["", "Compost", "Supercompost", "Ultracompost", "Rotten tomato"];
const SUPER = new Set(["Pineapple", "Tenti pineapple", "Watermelon", "Coconut", "Coconut shell", "Papaya fruit", "Calquat fruit", "Poison ivy berries", "White berries", "Jangerberries", "Mushroom", "Dragonfruit", "Snape grass", "Celastrus bark", "White lily", "White tree fruit", "Oak roots", "Willow roots", "Maple roots", "Yew roots", "Magic roots"]);
const COMPOST = new Set(["Weeds", "Grain", "Kebab", "Varlamorian kebab", "Flax", "Redberries", "Cadava berries", "Dwellberries", "Potato", "Onion", "Cabbage", "Tomato", "Sweetcorn", "Strawberry", "Lemon", "Lime", "Cooking apple", "Banana", "Orange", "Curry leaf", "Peach", "Watermelon slice", "Barley malt", "Hammerstone hops", "Asgarnian hops", "Jute fibre", "Kelda hops", "Yanillian hops", "Krandorian hops", "Wildblood hops", "Marigolds", "Rosemary", "Nasturtiums", "Woad leaf", "Limpwurt root", "Willow branch", "Rotten apple", "Apple mush", "Seaweed", "Edible seaweed", "Giant seaweed", "Potato cactus", "Leaves", "Oak leaves", "Willow leaves", "Maple leaves", "Yew leaves", "Magic leaves"]);
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
    core.PluginManager.emitCustomEvent("farming:success", { player, skill: core.Skill.FARMING,
        petChance: (base - 25 * level) / (player.getSkillManager().getExperience(core.Skill.FARMING) >= 200000000 ? 15 : 1) });
    if (crop.type === "HESPORI" || Patches.farmFor(player).disableHesporiSeeds) return;
    const denominator = ["BARLEY", "HAMMERSTONE"].includes(crop.key) ? 244 : crop.key === "LIMPWURT" ? 449 : Math.floor(base / 500);
    if (Math.random() < 1 / denominator) {
        if (player.getInventory().getFreeSlots() || player.getInventory().contains(Data.itemId("Hespori seed"))) Patches.give(player, Data.itemId("Hespori seed"));
        else core.ItemOnGroundManager.registers(player, new core.Item(Data.itemId("Hespori seed")));
        player.sendMessage("You find a Hespori seed!");
    }
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
function binAction(player, patch, action, usedId) {
    const bin = binFor(Patches.stateFor(player, patch));
    const capacity = patch.type === "BIG_COMPOST" ? 30 : 15;
    const inventory = player.getInventory();
    if (action === "close") {
        if (bin.count !== capacity) { player.sendMessage(`The bin needs ${capacity} items before you can close it.`); return; }
        if (!bin.closedAt) bin.closedAt = Date.now();
        bin.open = false;
        return;
    }
    if (action === "open") {
        if (!bin.closedAt || Date.now() - bin.closedAt < (bin.tier === 2 ? 90 : 60) * Model.MINUTE) { player.sendMessage("The contents have not finished rotting."); return; }
        bin.open = true;
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
            if (bin.tier === 4 || !chargeBottomless(player, bin.tier)) return;
        } else {
            if (!inventory.contains(Data.itemId("Bucket"))) { player.sendMessage("You need an empty bucket."); return; }
            inventory.deleteNumber(Data.itemId("Bucket"), 1);
            inventory.addItem(new core.Item(Data.itemId(COMPOST_NAMES[bin.tier])));
        }
        Patches.award(player, [0, 4.5, 8.5, 10, 4.5][bin.tier]);
        if (--bin.count === 0) Patches.stateFor(player, patch).bin = undefined;
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
        inventory.deleteNumber(usedId, 1);
        bin.count++;
        if (superItem) bin.super++;
        if (name === "Tomato") bin.tomatoes++;
        bin.tier = bin.super === bin.count ? 2 : bin.tomatoes === bin.count ? 4 : 1;
        return;
    }
    player.sendMessage(`The compost bin contains ${bin.count}/${capacity} items${bin.closedAt && !bin.open ? ", rotting" : ""}.`);
}
function dose(player, id) {
    const name = core.CacheDefinitions.getItem(id).name;
    const count = Number(name.match(/\((\d)\)$/)[1]);
    player.getInventory().deleteNumber(id, 1);
    player.getInventory().addItem(new core.Item(Data.itemId(count > 1 ? `Compost potion(${count - 1})` : "Vial")));
}
function chargeBottomless(player, tier) {
    const bucket = player.getInventory().getItems().find(i => core.CacheDefinitions.getItem(i.getId()).name === "Bottomless compost bucket");
    if (!bucket) return false;
    const charges = Number(bucket.getMetaValue("farming:charges") ?? 0);
    if (charges > 0 && bucket.getMetaValue("farming:tier") !== tier) { player.sendMessage("Empty the bucket before changing compost type."); return false; }
    if (charges > 9998) { player.sendMessage("The bucket is full."); return false; }
    bucket.setMetaValue("farming:charges", charges + 2).setMetaValue("farming:tier", tier);
    bucket.setId(core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET_4);
    player.getInventory().refreshItems();
    return true;
}
function useBottomless(player, patch, id) {
    const bucket = player.getInventory().getItems().find(i => i.getId() === id);
    const charges = Number(bucket?.getMetaValue("farming:charges") ?? 0);
    if (!charges) { player.sendMessage("The bucket is empty."); return; }
    if (Patches.fertilize(player, patch, Number(bucket.getMetaValue("farming:tier")), false)) {
        bucket.setMetaValue("farming:charges", charges - 1);
        if (charges === 1) bucket.setId(core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET);
        player.getInventory().refreshItems();
    }
}
function farmingItemPair(event) {
    const { player, usedItemId: a, usedWithItemId: b } = event;
    const inventory = player.getInventory();
    if (!inventory.contains(a) || !inventory.contains(b)) return;
    const names = [core.CacheDefinitions.getItem(a).name, core.CacheDefinitions.getItem(b).name];
    if (([a, b].includes(core.ItemIdentifiers.HAY_SACK) && names.includes("Bronze spear")) || ([a, b].includes(core.ItemIdentifiers.HAY_SACK_2) && names.includes("Watermelon"))) {
        event.handled = true;
        if (player.getSkillManager().getCurrentLevel(core.Skill.FARMING) < 23) { player.sendMessage("You need level 23 Farming."); return; }
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
        if (player.getSkillManager().getCurrentLevel(core.Skill.FARMING) < crop.level) { player.sendMessage(`You need level ${crop.level} Farming.`); return; }
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
        if (!Patches.water(player, can)) return;
        const slot = a === seedling.seedling ? event.usedItemSlot : event.usedWithItemSlot;
        inventory.forSlot(slot).setId(seedling.wateredSeedling).setMetaValue("farming:sapling-at", Model.nextGrowth(Date.now(), 5, Patches.farmFor(player).offset));
        inventory.refreshItems();
        return;
    }
    const compostTier = COMPOST_NAMES.slice(1, 4).findIndex(name => Data.itemId(name) === a || Data.itemId(name) === b) + 1;
    if (compostTier && [a, b].some(id => core.CacheDefinitions.getItem(id).name === "Bottomless compost bucket")) {
        event.handled = true;
        if (chargeBottomless(player, compostTier)) {
            inventory.deleteNumber(Data.itemId(COMPOST_NAMES[compostTier]), 1);
            inventory.addItem(new core.Item(Data.itemId("Bucket")));
        }
        return;
    }
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
function growSeedlings(player, now) {
    for (const container of [player.getInventory(), ...player.getBanks()]) {
        if (!container) continue; // Bank tabs are created lazily, including for bots.
        let changed = false;
        for (const item of container.getItems()) {
            const crop = item && item.getAmount() > 0 && Data.WATERED_SEEDLINGS.get(item.getId());
            if (!crop) continue;
            const at = item.getMetaValue("farming:sapling-at");
            if (!at) item.setMetaValue("farming:sapling-at", Model.nextGrowth(now, 5, Patches.farmFor(player).offset));
            else if (now >= at) { item.setId(crop.sapling).setMetaValue("farming:sapling-at", undefined); changed = true; }
        }
        if (changed) container.refreshItems();
    }
}
function waterContainers({ containers }) {
    for (const crop of Data.CROPS.values()) if (crop.seedling) containers.set(crop.seedling, crop.wateredSeedling);
    for (let charges = 1; charges < 8; charges++) containers.set(Data.itemId(`Watering can(${charges})`), Data.itemId("Watering can(8)"));
}
function humidified({ player }) {
    // Assign the same persistent farming-clock deadline used for hand-watered seedlings.
    growSeedlings(player, Date.now());
}
function withdrawTools(player, npc) {
    const stored = Patches.farmFor(player).tools;
    const entries = Object.entries(stored).filter(([, count]) => count > 0).map(([id, count]) => [
        `${core.CacheDefinitions.getItem(+id).name} (${count})`, () => {
            if (!player.getLocation().isWithinDistance(npc.getLocation(), 5)) return;
            const amount = Math.min(stored[id], player.getInventory().getFreeSlots(), 28);
            if (!amount) return;
            const meta = Patches.farmFor(player).toolMeta?.[id];
            if (meta) {
                player.getInventory().addItem(new core.Item(+id, 1, core.Item.cloneMeta(meta)));
                stored[id]--; delete Patches.farmFor(player).toolMeta[id];
            } else if (Patches.give(player, +id, amount)) stored[id] -= amount;
        },
]);
    for (const [id, count] of Object.entries(stored)) {
        const definition = core.CacheDefinitions.getItem(+id);
        if (!count || definition.note < 0 || Patches.farmFor(player).toolMeta?.[id]) continue;
        entries.push([`Withdraw noted ${definition.name} (${count})`, () => {
            if (!player.getLocation().isWithinDistance(npc.getLocation(), 5)) return;
            const amount = stored[id];
            if (amount && Patches.give(player, definition.note, amount)) stored[id] -= amount;
        }]);
    }
    if (!entries.length) { player.sendMessage("Use farming tools or compost on me to store them."); return; }
    Patches.choose(player, entries);
}
function storeTool(player, slot) {
    const inventory = player.getInventory(), item = inventory.forSlot(slot);
    if (!item || item.getId() < 0) return false;
    const definition = core.CacheDefinitions.getItem(item.getId());
    const id = definition.noteTemplate >= 0 ? definition.note : item.getId();
    const name = core.CacheDefinitions.getItem(id).name;
    const watering = /^Watering can|^Gricoller's can$/.test(name);
    const capacity = TOOL_CAPACITY[name] ?? (watering ? 1 : 0);
    if (!capacity) return false;
    const farm = Patches.farmFor(player), tools = farm.tools;
    const used = Object.entries(tools).reduce((sum, [key, count]) => {
        const other = core.CacheDefinitions.getItem(+key).name;
        return sum + (watering ? /^Watering can|^Gricoller's can$/.test(other) ? count : 0
            : /secateurs/i.test(name) ? /secateurs/i.test(other) ? count : 0 : other === name ? count : 0);
    }, 0);
    const amount = Math.min(inventory.getAmount(item.getId()), capacity - used);
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
    if (!target.getDefinition()?.getName()?.toLowerCase().includes("leprechaun")) return;
    event.handled = true;
    if (!player.getInventory().contains(id)) return;
    const definition = core.CacheDefinitions.getItem(id);
    const unnoted = definition.noteTemplate >= 0 ? definition.note : id;
    const name = core.CacheDefinitions.getItem(unnoted).name;
    if (storeTool(player, event.slot)) return;
    const harvested = name === "Willow branch" || [...Data.CROPS.values()].some(c => c.sapling === id || (!Data.WOOD_TREES.has(c.type) && c.produce === id)
        || (c.type === "HERB" && core.CacheDefinitions.getItem(c.produce).name.replace(/^Grimy /, "").toLowerCase() === name.toLowerCase()));
    const loc = target.getLocation();
    if (name === "Cabbage" && loc.getX() > 3040 && loc.getX() < 3070 && loc.getY() > 3280 && loc.getY() < 3320) {
        player.sendMessage("I won't note cabbages here!"); return;
    }
    if (!harvested || definition.noteTemplate >= 0 || definition.note < 0) { player.sendMessage("I can note harvested produce and store farming tools."); return; }
    const amount = player.getInventory().getAmount(id);
    player.getInventory().deleteNumber(id, amount);
    player.getInventory().addItem(new core.Item(definition.note, amount));
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
        if (action === "deposit-all") {
            for (let slot = 0; slot < player.getInventory().capacity(); slot++) storeTool(player, slot);
            return;
        }
        withdrawTools(player, npc);
        return;
    }
    if (action !== "pay" && action !== "pay-fare" && action !== "talk-to") return;
    const pos = npc.getLocation();
    const patches = Data.CACHE.patches.filter(p => p.z === pos.getZ() && Math.abs(p.x - pos.getX()) <= 20 && Math.abs(p.y - pos.getY()) <= 20);
    const relevant = patches.filter(p => {
        const s = Patches.farmFor(player).patches[Data.patchKey(p)];
        const c = s?.crop && Data.CROPS.get(s.crop);
        return c && (c.payment.length || Data.WOOD_TREES.has(c.type) || c.type === "FRUIT_TREE");
    });
    // Gardener NPCs advertise Pay; never hijack unrelated NPC conversations near a patch.
    if (!definition?.getActions()?.some(option => option?.toLowerCase() === "pay")) return;
    event.handled = true;
    if (!relevant.length) { player.sendMessage("Plant a crop before asking me to look after it."); return; }
    Patches.choose(player, relevant.map(p => {
        const state = Patches.stateFor(player, p);
        const crop = Data.CROPS.get(state.crop);
        const remove = state.status === "grown" && (Data.WOOD_TREES.has(crop.type) || crop.type === "FRUIT_TREE");
        return [`${remove ? "Clear" : "Protect"} ${crop.name} (${p.x}, ${p.y})`, () => {
            if (!Patches.nearPatch(player, p) || Patches.stateFor(player, p) !== state) return;
            if (remove) {
                if (!state.checked) { player.sendMessage("Check the tree's health first."); return; }
                const price = crop.type === "REDWOOD" ? 2000 : 200;
                if (player.getInventory().getAmount(Data.itemId("Coins")) < price) { player.sendMessage(`You need ${price} coins.`); return; }
                player.getInventory().deleteNumber(Data.itemId("Coins"), price); Patches.clearPatch(player, p); return;
            }
            if (state.protected || state.status === "dead" || state.status === "grown" || !crop.payment.length) {
                player.sendMessage("That crop does not need my protection."); return;
            }
            if (!pay(player, crop.payment)) return;
            state.protected = true;
            if (state.status === "diseased") { state.status = "growing"; state.nextAt = Model.nextGrowth(Date.now(), crop.minutes, Patches.farmFor(player).offset); }
            player.sendMessage("I'll look after that patch for you.");
        }];
    }));
}
function pay(player, payment) {
    const inventory = player.getInventory();
    for (const [id, amount] of payment) {
        const note = core.CacheDefinitions.getItem(id).note;
        if (inventory.getAmount(id) + (note >= 0 ? inventory.getAmount(note) : 0) < amount) {
            player.sendMessage(`Payment: ${payment.map(([i, n]) => `${n} ${core.CacheDefinitions.getItem(i).name}`).join(", ")}.`); return false;
        }
    }
    for (const [id, amount] of payment) {
        const unnoted = Math.min(amount, inventory.getAmount(id));
        if (unnoted) inventory.deleteNumber(id, unnoted);
        if (amount > unnoted) inventory.deleteNumber(core.CacheDefinitions.getItem(id).note, amount - unnoted);
    }
    return true;
}
function farmingItemAction(event) {
    const { player, itemId: id } = event;
    const container = event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID ? player.getEquipment() : player.getInventory();
    const item = container.forSlot(event.slot);
    if (!item || item.getId() !== id) return;
    const name = core.CacheDefinitions.getItem(id).name;
    const action = (event.option ?? core.CacheDefinitions.getItem(id).inventoryActions?.[event.clickType - 1])?.toLowerCase();
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
    if (name === "Amulet of nature" && action === "rub") {
        event.handled = true;
        const bound = Patches.farmFor(player).boundPatch;
        const patch = Data.CACHE.patches.find(p => Data.patchKey(p) === bound);
        if (!patch) player.sendMessage("Use the amulet on a farming patch to bind it.");
        else {
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

Object.assign(module.exports, { cropRewards, binValue, binAction, useBottomless, farmingItemPair, growSeedlings, waterContainers, humidified, farmingItemOnNpc, farmingNpc, farmingItemAction });
