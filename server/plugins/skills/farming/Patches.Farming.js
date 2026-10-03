const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Model = require("./Model.Farming");
const Services = require("./Services.Farming");
const Spells = require("./Spells.Farming");
const Tithe = require("./Tithe.Farming");
const Guild = require("./Guild.Farming");
const Hespori = require("./Hespori.Farming");

const FARM_ATTRIBUTE = "farming:state";
const ANIM = { RAKE: 2273, PLANT: 2291, SAPLING: 2272, FILL_POT: 2287, WATER: 2293, DIG: 830, HARVEST: 2282, COMPOST: 2283, CURE: 2288, PRUNE: 2275 };
const WORK = new WeakMap();
const SYNC = new WeakMap();
const RENDERED = new WeakMap();
// A patch can be visible from its own 64-tile region or one of its neighbours.
const PATCHES_BY_REGION = new Map();
for (const patch of Data.CACHE.patches) {
    const rx = Math.floor((patch.x + patch.maxX) / 128), ry = Math.floor((patch.y + patch.maxY) / 128);
    for (let x = rx - 1; x <= rx + 1; x++) {
        for (let y = ry - 1; y <= ry + 1; y++) {
            const key = `${x}:${y}:${patch.z}`;
            if (!PATCHES_BY_REGION.has(key)) PATCHES_BY_REGION.set(key, []);
            PATCHES_BY_REGION.get(key).push(patch);
        }
    }
}

function farmFor(player) {
    let farm = player.getAttribute(FARM_ATTRIBUTE);
    if (!farm) {
        farm = { offset: Math.floor(Math.random() * 31) * Model.MINUTE, patches: {}, tools: {}, autoWeed: false };
        player.setAttribute(FARM_ATTRIBUTE, farm);
    }
    return farm;
}
function stateFor(player, patch) {
    const farm = farmFor(player);
    return farm.patches[Data.patchKey(patch)] ??= Model.emptyPatch(Date.now(), farm, ["GRAPES", "CORAL", "SEAWEED"].includes(patch.type) ? 0 : 3);
}
function hasTool(player, name) {
    const id = Data.itemId(name);
    return player.getInventory().contains(id) || player.getEquipment().contains(id);
}
function requireTool(player, name) {
    if (name === "Seed dibber" && farmFor(player).barbarian?.planting === 3) return true;
    if (hasTool(player, name)) return true;
    player.sendMessage(`You need a ${name.toLowerCase()} to do that.`);
    return false;
}
function award(player, xp) {
    // Keep the server's configured XP rate; the table contains unmultiplied OSRS XP.
    const worn = new Set(player.getEquipment().getItems().map(i => core.CacheDefinitions.getItem(i.getId()).name));
    const pieces = [[worn.has("Farmer's strawhat"), 0.004],
        [worn.has("Farmer's jacket") || worn.has("Farmer's shirt"), 0.008],
        [worn.has("Farmer's boro trousers"), 0.006], [worn.has("Farmer's boots"), 0.002]];
    const bonus = pieces.reduce((total, [equipped, boost]) => total + (equipped ? boost : 0), 0) + (pieces.every(([equipped]) => equipped) ? 0.005 : 0);
    player.getSkillManager().addExperiences(core.Skill.FARMING, xp * (1 + bonus));
}
function give(player, id, count = 1) {
    const inventory = player.getInventory();
    const stackable = core.CacheDefinitions.getItem(id).stackability !== 0;
    if ((!stackable && inventory.getFreeSlots() < count) || (stackable && (inventory.getAmount(id) + count > 2147483647 || inventory.isFull() && !inventory.contains(id)))) {
        inventory.full();
        return false;
    }
    inventory.addItem(new core.Item(id, count));
    return true;
}
function choose(player, entries, page = 0) {
    const shown = entries.slice(page * 4, page * 4 + 4);
    if (entries.length > 4) shown.push(["More options", () => choose(player, entries, (page + 1) * 4 >= entries.length ? 0 : page + 1)]);
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.OptionDialogue(0, {
        executeOption(option) {
            player.getPacketSender().sendInterfaceRemoval();
            shown[Number(option)]?.[1]();
        },
    }, ...shown.map(([text]) => text))));
}
function clearPatch(player, patch) {
    const farm = farmFor(player);
    farm.patches[Data.patchKey(patch)] = Model.emptyPatch(Date.now(), farm);
    syncPatch(player, patch);
}
function syncPatch(player, patch) {
    const state = stateFor(player, patch);
    const value = patch.type.includes("COMPOST") ? Services.binValue(patch, state) : Model.patchValue(patch, state);
    if (value === undefined) return;
    const sender = player.getPacketSender();
    let rendered = RENDERED.get(player);
    if (!rendered) RENDERED.set(player, rendered = new Map());
    if (rendered.get(Data.patchKey(patch)) === value && sender.getVarbit(patch.varbit) === value) return;
    sender.sendVarbit(patch.varbit, value);
    // The client rebuilds loc geometry on object updates, not varbit updates.
    // Use the actual map locs so multi-tile patches retain every shape/rotation.
    for (let x = patch.x; x <= patch.maxX; x++) {
        for (let y = patch.y; y <= patch.maxY; y++) {
            const object = core.MapObjects.get(patch.id, new core.Location(x, y, patch.z), player.getPrivateArea());
            if (!object) continue;
            sender.sendObjectRemoval(object);
            sender.sendObject(object);
        }
    }
    rendered.set(Data.patchKey(patch), value);
}
function findPatch(id, location) {
    return Data.CACHE.patches.find(p => p.id === id && p.z === location.z && location.x >= p.x && location.x <= p.maxX && location.y >= p.y && location.y <= p.maxY)
        ?? Data.CACHE.patches.find(p => p.type === "REDWOOD" && core.CacheDefinitions.getObject(id).transformVarbit === p.varbit
            && Math.abs(p.x - location.x) < 12 && Math.abs(p.y - location.y) < 12);
}
function requireAxe(player) {
    if ([...player.getInventory().getItems(), ...player.getEquipment().getItems()].some(i => / axe(?:\b|$)/i.test(core.CacheDefinitions.getItem(i.getId()).name))) return true;
    player.sendMessage("You need an axe to do that."); return false;
}
function animate(player, animation) { player.performAnimation(new core.Animation(animation)); }
function gate(player) {
    if (!player.getClickDelay().elapsedTime(600)) return false;
    player.getClickDelay().reset();
    return true;
}
function nearPatch(player, patch) {
    const loc = player.getLocation();
    return loc.getZ() === patch.z && loc.getX() >= patch.x - 16 && loc.getX() <= patch.maxX + 16 && loc.getY() >= patch.y - 16 && loc.getY() <= patch.maxY + 16;
}
function startWork(player, patch, action) {
    const work = { patch, action, nextAt: Date.now(), position: player.getLocation().clone() };
    WORK.set(player, work);
    workStep(player, work);
}
function workStep(player, work) {
    if (player.getHitpoints() <= 0 || player.busy() || !player.getLocation().equals(work.position) || player.getMovementQueue().isMovings()) {
        WORK.delete(player);
        return;
    }
    if (Date.now() < work.nextAt) return;
    const again = work.action === "rake" ? rake(player, work.patch) : harvest(player, work.patch);
    work.nextAt = Date.now() + 1800;
    if (!again) WORK.delete(player);
    syncPatch(player, work.patch);
}
function rake(player, patch) {
    const state = stateFor(player, patch);
    if (state.crop || state.scarecrow || !state.weeds || !requireTool(player, "Rake")) return false;
    if (!give(player, Data.itemId("Weeds"))) return false;
    state.weeds--;
    state.nextAt = Model.nextGrowth(Date.now(), 5, farmFor(player).offset);
    animate(player, ANIM.RAKE);
    award(player, 4);
    return state.weeds > 0;
}
function plant(player, patch, id) {
    const crop = Data.SEEDS.get(id);
    const state = stateFor(player, patch);
    if (state.crop || state.scarecrow) { player.sendMessage("There is already something growing here."); return; }
    if (state.weeds) { player.sendMessage("You need to rake the weeds out first."); return; }
    if (!crop || crop.type !== patch.type) { player.sendMessage("That cannot be planted in this patch."); return; }
    if (player.getSkillManager().getCurrentLevel(core.Skill.FARMING) < crop.level) { player.sendMessage(`You need level ${crop.level} Farming to plant that.`); return; }
    const barbarian = farmFor(player).barbarian;
    const bareHanded = !crop.sapling && crop.type !== "GRAPES" && barbarian?.planting > 0 && !hasTool(player, "Seed dibber");
    if (!bareHanded && !requireTool(player, crop.sapling ? "Spade" : "Seed dibber")) return;
    if (patch.type === "GRAPES" && !state.compost) { player.sendMessage("Treat the vine patch with saltpetre first."); return; }
    if (crop.type === "SPIRIT_TREE") {
        const level = player.getSkillManager().getMaxLevel(core.Skill.FARMING);
        const limit = level >= 99 ? Infinity : level >= 91 ? 2 : 1;
        if (Object.values(farmFor(player).patches).filter(s => s.crop === crop.key).length >= limit) {
            player.sendMessage("You cannot grow any more spirit trees at your Farming level."); return;
        }
    }
    if (player.getInventory().getAmount(id) < crop.seedCount) { player.sendMessage(`You need ${crop.seedCount} seeds to plant this crop.`); return; }
    // ponytail: the training failure rate is unpublished; use an even roll until measured.
    if (bareHanded && barbarian.planting === 1 && Math.random() < 0.5) {
        player.getInventory().deleteNumber(id, crop.seedCount);
        player.sendMessage("You crush the seeds while trying to plant them bare-handed."); return;
    }
    let seedCount = crop.seedCount;
    if (patch.type === "ALLOTMENT" && player.getEquipment().contains(Data.itemId("Amulet of bounty")) && Math.random() < 0.25) {
        seedCount = 1;
        const farm = farmFor(player);
        farm.bountyCharges = (farm.bountyCharges ?? 10) - 1;
        if (!farm.bountyCharges) {
            player.getEquipment().deleteNumber(Data.itemId("Amulet of bounty"), 1).refreshItems();
            player.getUpdateFlag().flag(core.Flag.APPEARANCE);
            farm.bountyCharges = 10;
            player.sendMessage("Your amulet of bounty crumbles to dust.");
        } else player.sendMessage("Your amulet of bounty saves two seeds.");
    }
    player.getInventory().deleteNumber(id, seedCount);
    if (crop.sapling) {
        if (barbarian?.smashing && barbarian.autoSmash) {
            player.sendMessage("You smash the empty plant pot to dust.");
            if (barbarian.smashing === 1 && crop.type !== "SPIRIT_TREE") barbarian.smashing = 2;
        } else player.getInventory().addItem(new core.Item(Data.itemId("Plant pot")));
    }
    if (bareHanded && barbarian.planting === 1) {
        barbarian.planting = 2;
        player.sendMessage("You feel you have learned more of barbarian ways. Otto might wish to talk to you more.");
    }
    Object.assign(state, { crop: crop.key, stage: 0, status: "growing", checked: false, protected: false, watered: false,
        lives: 0, plantedAt: Date.now(), nextAt: Model.nextGrowth(Date.now(), crop.minutes, farmFor(player).offset) });
    // Herbs award their planting XP only after the final herb is picked.
    if (crop.type !== "HERB") award(player, crop.plant);
    animate(player, crop.sapling ? ANIM.SAPLING : ANIM.PLANT);
    player.sendMessage(`You plant the ${crop.name.toLowerCase()}.`);
}
function water(player, id) {
    const inventory = player.getInventory();
    const can = inventory.getItems().find(i => (!id || i.getId() === id) && (core.CacheDefinitions.getItem(i.getId()).name?.match(/^Watering can\([1-8]\)$/)
        || i.getId() === Data.itemId("Magic watering can") || i.getId() === Data.itemId("Gricoller's can")));
    if (!can) { player.sendMessage("You need a watering can containing water."); return false; }
    const name = core.CacheDefinitions.getItem(can.getId()).name;
    if (name === "Gricoller's can") {
        const charges = Number(can.getMetaValue("farming:water") ?? 0);
        if (!charges) { player.sendMessage("Your can is empty."); return false; }
        can.setMetaValue("farming:water", charges - 1);
    }
    const charges = name.match(/^Watering can\(([1-8])\)$/);
    if (charges) can.setId(Data.itemId(+charges[1] === 1 ? "Watering can" : `Watering can(${+charges[1] - 1})`));
    inventory.refreshItems();
    animate(player, ANIM.WATER);
    return true;
}
function waterPatch(player, patch, id) {
    const state = stateFor(player, patch);
    if (!state.crop || state.status !== "growing" || !Data.WATERABLE.has(patch.type)) { player.sendMessage("This patch does not need watering."); return; }
    if (state.watered) { player.sendMessage("This crop is already watered."); return; }
    if (water(player, id)) state.watered = true;
}
function fertilize(player, patch, tier, consume = true) {
    const state = stateFor(player, patch);
    if (state.weeds || state.compost || state.status === "dead" || ["ANIMA", "GRAPES", "CORAL"].includes(patch.type)) {
        player.sendMessage(state.compost ? "This patch has already been treated." : "You cannot compost this patch now."); return false;
    }
    if (consume) {
        const id = Data.itemId(["", "Compost", "Supercompost", "Ultracompost"][tier]);
        if (!player.getInventory().contains(id)) return false;
        player.getInventory().deleteNumber(id, 1);
        player.getInventory().addItem(new core.Item(Data.itemId("Bucket")));
    }
    state.compost = tier;
    if (state.status === "grown" && Data.COMPOSTABLE_YIELD.has(patch.type)) state.lives += tier;
    award(player, [0, 18, 26, 36][tier]);
    animate(player, ANIM.COMPOST);
    syncPatch(player, patch);
    return true;
}
function cure(player, patch, useItem = true, usedId) {
    const state = stateFor(player, patch);
    if (useItem && usedId !== Data.itemId("Plant cure") && state.crop === "WILLOW" && state.status === "grown" && state.checked && !state.stump) {
        if (!hasTool(player, "Secateurs") && !requireTool(player, "Magic secateurs")) return false;
        const now = Date.now();
        const elapsed = Math.floor((now - (state.branchAt ?? now)) / (5 * Model.MINUTE));
        state.branches = Math.min(6, (state.branches ?? 6) + elapsed);
        state.branchAt = (state.branchAt ?? now) + elapsed * 5 * Model.MINUTE;
        if (!state.branches) { player.sendMessage("There are no branches ready to cut yet."); return false; }
        if (!give(player, Data.itemId("Willow branch"))) return false;
        state.branches--; animate(player, ANIM.PRUNE); return true;
    }
    if (state.status !== "diseased") { player.sendMessage("This plant is not diseased."); return false; }
    if (useItem) {
        const variant = core.CacheDefinitions.getObject(patch.id).transforms[Model.patchValue(patch, state)];
        const pruning = core.CacheDefinitions.getObject(variant).actions?.includes("Prune") ?? false;
        if (pruning && (usedId === Data.itemId("Plant cure") || !hasTool(player, "Secateurs") && !hasTool(player, "Magic secateurs"))) {
            player.sendMessage("Use secateurs to prune the diseased leaves."); return false;
        }
        if (!pruning && (usedId === Data.itemId("Secateurs") || usedId === Data.itemId("Magic secateurs"))) {
            player.sendMessage("This plant needs plant cure, not pruning."); return false;
        }
        if (!pruning) {
            if (!player.getInventory().contains(Data.itemId("Plant cure"))) { player.sendMessage("You need plant cure to cure this plant."); return false; }
            player.getInventory().deleteNumber(Data.itemId("Plant cure"), 1);
            player.getInventory().addItem(new core.Item(Data.itemId("Vial")));
        }
        animate(player, pruning ? ANIM.PRUNE : ANIM.CURE);
        if (pruning && Math.random() < 0.25) { player.sendMessage("There are still some diseased leaves left."); return false; }
    }
    state.status = "growing";
    state.nextAt = Model.nextGrowth(Date.now(), Data.CROPS.get(state.crop).minutes, farmFor(player).offset);
    syncPatch(player, patch);
    return true;
}
function healthCheck(player, patch) {
    const state = stateFor(player, patch);
    const crop = Data.CROPS.get(state.crop);
    if (!crop || state.status !== "grown" || state.checked) return;
    state.checked = true;
    award(player, crop.check);
    Services.cropRewards(player, crop);
    player.sendMessage(`The ${crop.name.toLowerCase()} is healthy.`);
    core.PluginManager.emitCustomEvent("farming:check-health", { player, crop: crop.key, patch });
}
function harvest(player, patch) {
    const state = stateFor(player, patch);
    const crop = Data.CROPS.get(state.crop);
    if (!crop || state.status !== "grown") return false;
    if (crop.check && !state.checked) { healthCheck(player, patch); return false; }
    if (crop.type === "HESPORI") { Hespori.harvestHespori(player, patch); return false; }
    if (crop.produce < 0 || Data.WOOD_TREES.has(crop.type) || state.lives <= 0) return false;
    if (["CRYSTAL_TREE", "CELASTRUS"].includes(crop.type) && !requireAxe(player)) return false;
    if (["ALLOTMENT", "HERB", "HOPS", "BELLADONNA"].includes(crop.type) && !requireTool(player, "Spade")) return false;
    const level = player.getSkillManager().getCurrentLevel(core.Skill.FARMING);
    if (crop.type === "BELLADONNA" && !player.getEquipment().getItems().some(i => /gloves|gauntlets|vambraces/i.test(core.CacheDefinitions.getItem(i.getId()).name))) {
        player.sendMessage("You need to wear gloves to pick poisonous nightshade."); return false;
    }
    const attas = Model.activeAnima(farmFor(player), Date.now()) === "ATTAS";
    let amount = crop.key === "WOAD" ? 3 : crop.key === "LIMPWURT" ? 3 + Math.floor(Math.floor(Math.random() * level) * (hasTool(player, "Magic secateurs") ? 1.1 : 1) * (attas ? 1.05 : 1) / 10)
        // ponytail: uniform belladonna roll matches published level bounds; refine its distribution when published.
        : crop.type === "BELLADONNA" ? 6 + Math.floor(Math.random() * (Math.floor(level / 8) + 1))
        : crop.type === "CRYSTAL_TREE" ? 16 + state.compost * 4 + Math.floor(Math.random() * 5) : 1;
    let produce = crop.produce;
    const blessing = crop.type === "GRAPES" && player.getInventory().contains(Data.itemId("Bologa's blessing"));
    if (blessing) produce = Data.itemId("Zamorak's grapes");
    const sack = crop.type === "HERB" && player.getInventory().getItems().find(i => i.getId() === Data.itemId("Open herb sack"));
    if (!(sack && Guild.storeCrop(player, sack, produce, amount)) && !give(player, produce, amount)) return false;
    if (blessing) player.getInventory().deleteNumber(Data.itemId("Bologa's blessing"), 1);
    animate(player, ANIM.HARVEST);
    award(player, crop.harvest * (["FLOWER", "BELLADONNA"].includes(crop.type) ? 1 : amount));
    const variable = Data.COMPOSTABLE_YIELD.has(crop.type) || ["BUSH", "CACTUS", "GRAPES", "CORAL"].includes(crop.type);
    const cape = player.getEquipment().contains(Data.itemId("Farming cape")) || player.getEquipment().contains(Data.itemId("Farming cape(t)"));
    const vars = player.getPacketSender();
    const diary = crop.type !== "HERB" ? 0 : patch.x === 2813 && patch.y === 3463
        ? vars.getVarbit(4478) ? 25 : vars.getVarbit(4477) ? 17 : vars.getVarbit(4476) ? 10 : 0
        : [1738, 1238].includes(patch.x) && vars.getVarbit(7927) ? 10 : 0;
    const chance = Model.saveLifeChance(crop, level, hasTool(player, "Magic secateurs"), cape, diary, attas);
    if (!variable || Math.random() >= chance) state.lives--;
    if (["FLOWER", "BELLADONNA", "CRYSTAL_TREE"].includes(crop.type)) state.lives = 0;
    if (state.lives === 0) {
        if (crop.type === "HERB") award(player, crop.plant);
        if (!crop.check) Services.cropRewards(player, crop);
        core.PluginManager.emitCustomEvent("farming:harvest", { player, crop: crop.key, patch });
        if (crop.type === "GRAPES") state.status = "dead";
        else if (!crop.regrow && crop.type !== "CELASTRUS") clearPatch(player, patch);
        return false;
    }
    return true;
}
function dig(player, patch) {
    const state = stateFor(player, patch);
    if (!requireTool(player, "Spade")) return;
    if (state.scarecrow) {
        if (give(player, Data.itemId("Scarecrow"))) { state.scarecrow = false; syncPatch(player, patch); }
        return;
    }
    if (!state.crop) return;
    const crop = Data.CROPS.get(state.crop);
    if (crop.type === "REDWOOD" && state.status === "grown") { player.sendMessage("Ask Alexandra to remove the redwood tree."); return; }
    if (state.status === "dead" || state.stump) {
        if (state.stump && crop.type === "TREE") {
            const roots = 1 + Math.min(3, Math.floor((player.getSkillManager().getCurrentLevel(core.Skill.FARMING) - crop.level) / 15));
            if (!give(player, Data.itemId(`${crop.name} roots`), Math.max(1, roots))) return;
        }
        clearPatch(player, patch); animate(player, ANIM.DIG); return;
    }
    if ((Data.WOOD_TREES.has(crop.type) || crop.type === "FRUIT_TREE") && state.status === "grown") {
        player.sendMessage("Chop the tree down before digging out the stump, or pay a gardener to remove it."); return;
    }
    choose(player, [["Yes, dig up this crop", () => {
        if (!nearPatch(player, patch) || stateFor(player, patch) !== state || !requireTool(player, "Spade")) return;
        clearPatch(player, patch);
        animate(player, ANIM.DIG);
    }], [`Leave the ${crop.name.toLowerCase()} growing`, () => {}]]);
}
function inspect(player, patch) {
    const state = stateFor(player, patch);
    const crop = Data.CROPS.get(state.crop);
    player.sendMessage(crop ? `${crop.name}: ${state.status}${state.protected ? ", protected by a gardener" : ""}.`
        : state.scarecrow ? "A scarecrow protects nearby sweetcorn." : state.weeds ? "This patch needs weeding." : "This patch is ready for planting.");
    player.sendMessage(`Soil: ${["untreated", "compost", "supercompost", "ultracompost"][state.compost]}.${state.watered ? " The crop is watered." : ""}`);
}
function objectInteraction(event) {
    const { player, object, location } = event;
    WORK.delete(player);
    Hespori.hesporiCave(event);
    if (!event.handled) Tithe.titheObject(event);
    if (!event.handled) Guild.guildObject(event);
    if (event.handled) return;
    if (location.x === 1224 && location.y === 3755 && event.definition?.getName() === "Rope ladder") {
        event.handled = true;
        const redwood = Data.CACHE.patches.find(p => p.type === "REDWOOD");
        if (location.z === 0 && !stateFor(player, redwood).checked) { player.sendMessage("The redwood tree must be fully grown and health-checked first."); return; }
        player.moveTo(new core.Location(1225, 3755, location.z === 0 ? 1 : 0)); return;
    }
    const patch = findPatch(object.getId(), location);
    if (!patch) return;
    event.handled = true;
    Model.advanceFarm(farmFor(player), Date.now());
    if (!gate(player)) return;
    const action = core.ObjectDefinition.forPlayer(object.getId(), player)?.getInteractions()?.[event.clickType - 1]?.toLowerCase() ?? "";
    if (patch.type.includes("COMPOST")) { Services.binAction(player, patch, action); syncPatch(player, patch); return; }
    const state = stateFor(player, patch);
    if (action === "rake") startWork(player, patch, "rake");
    else if (action === "inspect") inspect(player, patch);
    else if (action === "guide") player.sendMessage(`This patch grows: ${[...Data.CROPS.values()].filter(c => c.type === patch.type).map(c => `${c.name} (${c.level})`).join(", ")}.`);
    else if (action === "check-health") healthCheck(player, patch);
    else if (action === "water") waterPatch(player, patch);
    else if (action === "cure" || action === "prune") cure(player, patch);
    else if (action === "clear" && state.hesporiLoot) Hespori.harvestHespori(player, patch);
    else if (["clear", "dig-up", "dig", "remove"].includes(action)) dig(player, patch);
    else if (action === "travel" && state.checked) spiritTravel(player);
    else if (action === "chop-down" && patch.type === "CRYSTAL_TREE") startWork(player, patch, "harvest");
    else if (action === "chop" && patch.type === "CELASTRUS" && state.status === "grown" && !state.lives && requireAxe(player)) {
        state.stump = true; state.nextAt = Number.MAX_SAFE_INTEGER; animate(player, 879);
    }
    else if ((["chop-down", "chop down", "chop"].includes(action) || action === "cut" && patch.type === "REDWOOD") && state.status === "grown" && state.checked) {
        const crop = Data.CROPS.get(state.crop);
        core.PluginManager.emitCustomEvent("woodcutting:chop", { player, object, logId: Data.WOOD_TREES.has(patch.type) ? crop.produce : Data.itemId("Logs"), removeOnly: patch.type === "FRUIT_TREE", handled: false });
    }
    else if (["harvest", "pick", "pick-from", "collect", "pick-fruit", "pick-apple", "pick-banana", "pick-orange", "pick-leaf", "pick-pineapple", "pick-papaya", "pick-coconut", "pick-dragonfruit", "pick-spine", "pick-cactus", "take", "cut"].includes(action)) startWork(player, patch, "harvest");
    else inspect(player, patch);
    syncPatch(player, patch);
}
function itemOnObject(event) {
    const { player, itemId: id, object, location } = event;
    WORK.delete(player);
    Tithe.titheItem(event);
    if (event.handled) return;
    const patch = findPatch(object.getId(), location);
    if (!patch) {
        const name = core.ObjectDefinition.forPlayer(object.getId(), player)?.getName()?.toLowerCase() ?? "";
        if (/hay(?: bale|stack)?/.test(name) && id === Data.itemId("Empty sack")) {
            event.handled = true;
            player.getInventory().deleteAtSlot(event.itemSlot);
            player.getInventory().addItem(new core.Item(Data.itemId("Hay sack"))); return;
        }
        if (["fountain", "sink", "gold sink", "waterpump", "water pump", "pump and drain", "pump and tub", "water barrel", "well"].includes(name) && /^(?:Watering can(?:\([1-8]\))?|Gricoller's can)$/.test(core.CacheDefinitions.getItem(id).name)) {
            event.handled = true;
            if ([core.ObjectIdentifiers.WATER_PUMP_2, core.ObjectIdentifiers.WATER_PUMP_3].includes(object.getId())) {
                player.sendMessage("This water pump is damaged."); return;
            }
            if (player.getInventory().forSlot(event.itemSlot)?.getId() === id) {
                const can = player.getInventory().forSlot(event.itemSlot);
                if (core.CacheDefinitions.getItem(id).name === "Gricoller's can") can.setMetaValue("farming:water", 1000);
                else can.setId(Data.itemId("Watering can(8)"));
                player.getInventory().refreshItems();
            }
        }
        return;
    }
    event.handled = true;
    if (!gate(player) || !player.getInventory().contains(id)) return;
    Model.advanceFarm(farmFor(player), Date.now());
    const state = stateFor(player, patch);
    if (patch.type.includes("COMPOST")) { Services.binAction(player, patch, "", id); syncPatch(player, patch); return; }
    if (Data.SEEDS.has(id)) plant(player, patch, id);
    else if (id === Data.itemId("Rake")) startWork(player, patch, "rake");
    else if (id === Data.itemId("Spade") && patch.type === "HESPORI" && state.status === "grown") Hespori.harvestHespori(player, patch);
    else if (id === Data.itemId("Spade")) dig(player, patch);
    else if (id === Data.itemId("Plant cure") || id === Data.itemId("Secateurs") || id === Data.itemId("Magic secateurs")) cure(player, patch, true, id);
    else if (/^Watering can(?:\([1-8]\))?$|^Magic watering can$|^Gricoller's can$/.test(core.CacheDefinitions.getItem(id).name)) waterPatch(player, patch, id);
    else if (core.CacheDefinitions.getItem(id).name === "Bottomless compost bucket") Services.useBottomless(player, patch, id);
    else if (id === Data.itemId("Amulet of nature")) {
        farmFor(player).boundPatch = Data.patchKey(patch);
        farmFor(player).boundStatus = state.crop ? state.status : "empty";
        player.sendMessage("You bind the amulet to this patch.");
    }
    else if (["Compost", "Supercompost", "Ultracompost"].some((name, i) => id === Data.itemId(name) && fertilize(player, patch, i + 1))) { /* applied */ }
    else if (id === Data.itemId("Saltpetre") && patch.type === "GRAPES" && !state.crop && !state.compost && requireTool(player, "Gardening trowel")) {
        player.getInventory().deleteNumber(id, 1); state.compost = 1;
    } else if (id === Data.itemId("Scarecrow") && patch.type === "FLOWER" && !state.crop && !state.weeds && !state.scarecrow) {
        if (player.getSkillManager().getCurrentLevel(core.Skill.FARMING) < 23) { player.sendMessage("You need level 23 Farming."); return; }
        player.getInventory().deleteNumber(id, 1); state.scarecrow = true;
    } else if (id === Data.itemId("Plant pot") && !state.crop && !state.weeds && requireTool(player, "Gardening trowel")) {
        player.getInventory().deleteNumber(id, 1); player.getInventory().addItem(new core.Item(Data.itemId("Filled plant pot")));
        animate(player, ANIM.FILL_POT);
    } else player.sendMessage("Nothing interesting happens.");
    syncPatch(player, patch);
}
function itemOnItem(event) { WORK.delete(event.player); Guild.storagePair(event); if (!event.handled) Services.farmingItemPair(event); }
function npcInteraction(event) {
    WORK.delete(event.player);
    Hespori.hesporiNpc(event);
    if (!event.handled) Tithe.titheNpc(event);
    if (!event.handled) Guild.guildNpc(event);
    if (!event.handled) Services.farmingNpc(event);
}
function itemOnNpc(event) {
    WORK.delete(event.player);
    Tithe.titheItemOnNpc(event);
    if (!event.handled) Guild.guildItemOnNpc(event);
    if (!event.handled) Services.farmingItemOnNpc(event);
}
function spellOnObject(event) {
    WORK.delete(event.player);
    const patch = findPatch(event.object.getId(), event.location);
    if (patch) Spells.farmingSpell(event, patch);
}
function spiritTravel(player) {
    const farm = farmFor(player);
    choose(player, Data.CACHE.patches.filter(p => p.type === "SPIRIT_TREE" && farm.patches[Data.patchKey(p)]?.checked)
        .map(p => [`Spirit tree (${p.x}, ${p.y})`, () => player.moveTo(new core.Location(p.x - 1, p.y, p.z))]));
}
function validateTree(event) {
    const pos = event.object.getLocation();
    const patch = findPatch(event.object.getId(), { x: pos.getX(), y: pos.getY(), z: pos.getZ() });
    if (!patch) return;
    const state = stateFor(event.player, patch);
    event.allow = state.status === "grown" && state.checked && !state.stump;
}
function depleteTree(event) {
    const pos = event.object.getLocation();
    const patch = findPatch(event.object.getId(), { x: pos.getX(), y: pos.getY(), z: pos.getZ() });
    if (!patch) return;
    event.handled = true;
    const state = stateFor(event.player, patch);
    state.stump = true;
    state.nextAt = Date.now() + event.respawnTicks * 600;
    syncPatch(event.player, patch);
}
function playerProcess({ player }) {
    const previous = SYNC.get(player);
    const pos = player.getLocation();
    const now = Date.now();
    const grow = !previous || now - previous.at >= 5000;
    if (grow || previous.x !== pos.getX() || previous.y !== pos.getY() || previous.z !== pos.getZ()) {
        const farm = farmFor(player);
        if (grow) {
            if (player.getPacketSender().getVarbit(7925)) farm.hosidiusProtected = true;
            if (player.getPacketSender().getVarbit(4465)) farm.faladorProtected = true;
            if (player.getPacketSender().getVarp(4130) >= 16000) farm.fortisProtected = true;
            Model.advanceFarm(farm, now); Services.growSeedlings(player, now);
            const bound = farm.patches[farm.boundPatch];
            const status = bound?.crop ? bound.status : "empty";
            if (farm.boundStatus !== status && ["diseased", "dead", "grown"].includes(status) && hasTool(player, "Amulet of nature")) {
                player.sendMessage(`Your amulet of nature hums: the crop in your bound patch is ${status}.`);
            }
            farm.boundStatus = status;
        }
        const nearest = new Map();
        const nearby = PATCHES_BY_REGION.get(`${Math.floor(pos.getX() / 64)}:${Math.floor(pos.getY() / 64)}:${pos.getZ()}`) ?? [];
        for (const patch of nearby) {
            const distance = Math.max(Math.abs((patch.x + patch.maxX) / 2 - pos.getX()), Math.abs((patch.y + patch.maxY) / 2 - pos.getY()));
            if (distance <= 64 && (!nearest.has(patch.varbit) || nearest.get(patch.varbit).distance > distance)) nearest.set(patch.varbit, { patch, distance });
        }
        for (const { patch } of nearest.values()) syncPatch(player, patch);
        SYNC.set(player, { x: pos.getX(), y: pos.getY(), z: pos.getZ(), at: grow ? now : previous.at });
    }
    const work = WORK.get(player);
    if (work) workStep(player, work);
}
function login(event) {
    for (const state of Object.values(farmFor(event.player).patches)) state.hesporiFight = false;
    SYNC.delete(event.player); RENDERED.delete(event.player); playerProcess(event);
}
function logout({ player }) { WORK.delete(player); SYNC.delete(player); RENDERED.delete(player); Hespori.hesporiLogout({ player }); }
function cancelWork({ player }) { WORK.delete(player); }

/** Every hook the Farming plugin attaches. */
function attach(api) {
    api.persistAttribute(FARM_ATTRIBUTE);
    api.onServerStartup(Data.initializeFarmingData);
    api.onPlayerLogin(login);
    api.onPlayerLogin(Tithe.titheLogin);
    api.onPlayerProcess(playerProcess);
    api.onPlayerProcess(Hespori.hesporiProcess);
    api.onPlayerProcess(Tithe.titheProcess);
    api.onPlayerLogout(logout);
    api.onPlayerLogout(Tithe.titheLogout);
    api.onPlayerLevelUp(cancelWork);
    api.onObjectInteraction(objectInteraction);
    api.onItemOnObject(itemOnObject, { noted: false });
    api.onItemOnItem(itemOnItem, { noted: false });
    api.onNpcInteraction(npcInteraction);
    api.onItemOnNpc(itemOnNpc);
    api.onItemAction(Services.farmingItemAction);
    api.onItemAction(Guild.rewardItem);
    api.onItemAction(Guild.storageAction);
    api.onSpellOnObject(spellOnObject);
    api.onButtonClick(Spells.farmingButton);
    api.onCustomEvent("woodcutting:validate-tree", validateTree);
    api.onCustomEvent("farming:check-health", Guild.completeContract);
    api.onCustomEvent("farming:harvest", Guild.harvestContract);
    api.onCustomEvent("woodcutting:deplete-tree", depleteTree);
    api.onCustomEvent("magic:water-containers", Services.waterContainers);
    api.onCustomEvent("magic:humidified", Services.humidified);
    api.onCustomEvent("player:world-input", Hespori.hesporiInput);
    api.onCustomEvent("player:world-input", cancelWork);
    api.onCustomEvent("npc-drops:generated", Hespori.hesporiLoot);
    api.onCanAttack(Hespori.hesporiCanAttack);
    api.onCombatHitRoll(Hespori.hesporiHitRoll);
    api.onCombatHitResolved(Hespori.hesporiHit);
    api.onPlayerDealtDamage(Hespori.hesporiDamage);
    api.onPlayerDeathItemDrop(Hespori.hesporiDeathDrop);
    api.onPlayerDeath(Hespori.hesporiPlayerDeath);
    api.registerNpcCombatMethodProvider(core.NpcIdentifiers.HESPORI, Hespori.HesporiCombat, { singleton: false });
}

Object.assign(module.exports, { FARM_ATTRIBUTE, farmFor, stateFor, hasTool, requireTool, award, give, choose, clearPatch, syncPatch, nearPatch, water, fertilize, cure, attach });
