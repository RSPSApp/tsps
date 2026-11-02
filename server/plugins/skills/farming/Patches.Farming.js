const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Model = require("./Model.Farming");
const Services = require("./Services.Farming");
const Spells = require("./Spells.Farming");
const Geomancy = require("./Geomancy.Farming");
const Tithe = require("./Tithe.Farming");
const Rewards = require("./Rewards.Farming");
const Guild = require("./Guild.Farming");
const Vault = require("./Vault.Farming");
const Hespori = require("./Hespori.Farming");
const Redwood = require("./Redwood.Farming");
const Tools = require("./Tools.Farming");
const { pauseForLevelUp, actionInterval } = require("../SkillActions");

const FARM_ATTRIBUTE = "farming:state";
/** Making and placing a scarecrow (Wiki, Scarecrow). */
const SCARECROW_LEVEL = 23;
const TROLL_HERB_PATCH = Data.CACHE.patches.find(p => p.type === "HERB" && p.x === 2826 && p.y === 3694 && p.z === 0);
const FALADOR_FARM_PATCHES = new Set(Data.CACHE.patches.filter(p => p.z === 0
    && ["ALLOTMENT", "FLOWER", "HERB"].includes(p.type)
    && p.x >= 3050 && p.x <= 3058 && p.y >= 3303 && p.y <= 3311).map(Data.patchKey));
// Rev 241 seq gamevals: farming_raking, farming_seed_dibbing(_nodib), human_dig, farming_trowel_shortdig,
// farming_watering, picking_low/high, farming_pick_mushroom, farming_pour_water, farming_plant_cure,
// pruning_mid_high. Which one each action plays, and its sound, follow rsprox captures (docs/farming.md).
/** Gricoller's can's doses of water (item meta, as Rewards.Farming saves it). */
const GRICOLLER_WATER_META = "farming:water";
const ANIM = { RAKE: 2273, PLANT: 2291, PLANT_BARE_HANDED: 10721, SAPLING: 830, FILL_POT: 11121, WATER: 2293, DIG: 830,
    PICK_LOW: 2282, PICK_HIGH: 2280, PICK_MUSHROOM: 2292, COMPOST: 2283, CURE: 2288, PRUNE: 2275 };
const SOUND = { RAKE: 2442, PLANT: 2432, DIG: 1470, PICK: 2437, COMPOST: 2427, CRYSTAL_SHATTER: 2541 };
// Rev 241 gameval human_pickuptable; rsprox recording 1858 pairs it with sound 2441.
const FILL_BIN_ANIMATION = 832;
const FILL_BIN_SOUND = 2441;
// Player -> queued rake/harvest/clear/bin work, stepped every tick by the farming task.
const WORK = new Map();
// Player -> actions due on a later farming tick (a seed, compost or pot already used on the click).
// They finish even if the player walks off, and run at once on logout so nothing is lost.
const PENDING = new Map();
let workTick = 0;
// How each patch is named in its lines ("You treat the tree patch with compost.").
const PATCH_NOUNS = { ALLOTMENT: "allotment", HERB: "herb patch", FLOWER: "flower patch", HOPS: "hops patch",
    BUSH: "bush patch", TREE: "tree patch", FRUIT_TREE: "fruit tree patch", HARDWOOD_TREE: "hardwood tree patch",
    SPIRIT_TREE: "spirit tree patch", CALQUAT: "calquat tree patch", CACTUS: "cactus patch", MUSHROOM: "bittercap mushroom patch",
    BELLADONNA: "belladonna patch", ANIMA: "anima patch", HESPORI: "hespori patch", REDWOOD: "redwood patch",
    CRYSTAL_TREE: "crystal tree patch", SEAWEED: "seaweed patch", CELASTRUS: "celastrus patch", GRAPES: "vine patch", CORAL: "coral patch" };
const TREE_TYPES = new Set(["TREE", "FRUIT_TREE", "HARDWOOD_TREE", "CALQUAT", "SPIRIT_TREE", "CELASTRUS", "REDWOOD", "CRYSTAL_TREE"]);
// How a grown crop is picked: the animation (with its sound) every three ticks, the produce `delay`
// ticks later, and the lines said. Types not listed pick with the low pick and no line.
const PICKS = {
    ALLOTMENT: { anim: ANIM.DIG, sound: SOUND.DIG, delay: 1, begin: true },
    HOPS: { anim: ANIM.DIG, sound: SOUND.DIG, delay: 1, begin: true },
    HERB: { anim: ANIM.PICK_LOW, delay: 1, begin: true },
    FRUIT_TREE: { anim: ANIM.PICK_HIGH, pickSound: SOUND.PICK, delay: 2, each: true },
    MUSHROOM: { anim: ANIM.PICK_MUSHROOM, sound: SOUND.PICK, delay: 2, each: "a Bittercap mushroom" },
    BELLADONNA: { anim: ANIM.PICK_LOW, sound: SOUND.PICK, delay: 3, each: "some Deadly Nightshade" },
    FLOWER: { anim: ANIM.PICK_MUSHROOM, sound: SOUND.PICK, delay: 3 },
};
const PICK_PERIOD = 3;
const RAKE_PERIOD = 4;
const CLEAR_TICKS = 5;
const COMPOST_NAMES = ["", "compost", "supercompost", "ultracompost"];
const RENDERED = new WeakMap();
const LLETYA_FRUIT_PATCH = Data.CACHE.patches.find(p => p.type === "FRUIT_TREE" && p.x === 2346 && p.y === 3161 && p.z === 0);
// A patch can be visible from its own 64-tile region or one of its neighbours.
const PATCHES_BY_REGION = new Map();
const HARMONY_HERB_PATCH = Data.CACHE.patches.find(p => p.type === "HERB" && p.x === 3789 && p.y === 2837 && p.z === 0);
for (const patch of Data.CACHE.patches) {
    const rx = Math.floor((patch.x + patch.maxX) / 128), ry = Math.floor((patch.y + patch.maxY) / 128);
    for (let x = rx - 1; x <= rx + 1; x++) {
        for (let y = ry - 1; y <= ry + 1; y++) {
            for (const z of patch.type === "REDWOOD" ? [patch.z, patch.z + 1, patch.z + 2] : [patch.z]) {
                const key = `${x}:${y}:${z}`;
                if (!PATCHES_BY_REGION.has(key)) PATCHES_BY_REGION.set(key, []);
                PATCHES_BY_REGION.get(key).push(patch);
            }
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

function retrievalItems(request) {
    for (const {id: itemId, amount} of request.player.getAttribute(FARM_ATTRIBUTE)?.deathbank ?? [])
        request.items.push({itemId, amount});
}
function stateFor(player, patch) {
    const farm = farmFor(player);
    return farm.patches[Data.patchKey(patch)] ??= Model.emptyPatch(Date.now(), farm, ["GRAPES", "CORAL", "SEAWEED"].includes(patch.type) ? 0 : 3);
}
function hasTool(player, name) {
    const id = Data.itemId(name);
    return player.getInventory().contains(id) || player.getEquipment().contains(id);
}
function requireTool(player, name, refusal = `You need a ${name.toLowerCase()} to do that.`) {
    if (name === "Seed dibber" && farmFor(player).barbarian?.planting === 3) return true;
    if (hasTool(player, name)) return true;
    player.sendMessage(refusal);
    return false;
}
function spam(player, text) { player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text); }
function sound(player, id) { if (id) player.getPacketSender().sendSound(id, 1, 0); }
const article = (noun) => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
const patchNoun = (patch) => PATCH_NOUNS[patch.type] ?? `${patch.type.toLowerCase().replace(/_/g, " ")} patch`;
/** Runs `action` `ticks` farming ticks from now (see PENDING). */
function after(player, ticks, action) {
    if (!PENDING.has(player)) PENDING.set(player, []);
    PENDING.get(player).push({ at: workTick + ticks, action });
}
function runPending(player, all = false) {
    const queue = PENDING.get(player);
    if (!queue) return;
    for (const entry of queue.filter(entry => all || entry.at <= workTick)) {
        queue.splice(queue.indexOf(entry), 1);
        entry.action();
    }
    if (!queue.length) PENDING.delete(player);
}
function award(player, xp, patch) {
    // Keep the server's configured XP rate; the table contains unmultiplied OSRS XP.
    const worn = new Set(player.getEquipment().getItems().map(i => core.CacheDefinitions.getItem(i.getId()).name));
    const pieces = [[worn.has("Farmer's strawhat"), 0.004],
        [worn.has("Farmer's jacket") || worn.has("Farmer's shirt"), 0.008],
        [worn.has("Farmer's boro trousers"), 0.006], [worn.has("Farmer's boots"), 0.002]];
    const bonus = pieces.reduce((total, [equipped, boost]) => total + (equipped ? boost : 0), 0) + (pieces.every(([equipped]) => equipped) ? 0.005 : 0);
    // https://oldschool.runescape.wiki/w/South_Falador_Farm: Medium Diary, all four patches.
    const diary = { player, diary: "falador", tier: "medium", complete: false };
    if (patch && FALADOR_FARM_PATCHES.has(Data.patchKey(patch))) core.PluginManager.emitCustomEvent("diary:is-complete", diary);
    player.getSkillManager().addExperiences(core.Skill.FARMING, xp * (diary.complete === true ? 1.1 : 1) * (1 + bonus));
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
const farmingMenus = new WeakMap();
function choose(player, entries, page = 0, title = undefined) {
    const shown = entries.slice(page * 4, page * 4 + 4);
    if (!shown.length) return;
    if (entries.length > 4) shown.push(["More options", () => choose(player, entries, (page + 1) * 4 >= entries.length ? 0 : page + 1, title)]);
    if (shown.length === 1) shown.push(["Cancel", () => {}]);
    // Generic legacy dialogue callbacks do not identify the widget that sent them.
    // Keep the action private to the exact-widget adapter below instead.
    const menu = new core.OptionDialogue(0, null, ...shown.map(([text]) => text));
    if (title) menu.setTitle(title);
    farmingMenus.set(menu, option => {
        // Native option resumes are one-based, including the fifth pagination choice.
        const number = Number(option);
        if (!Number.isInteger(number) || !shown[number - 1]
            || player.getDialogueManager().getCurrent() !== menu
            || !player.getPacketSender().isChatboxInterface(core.OptionDialogue.OPTIONS_WIDGET_ID >>> 16)
            || player.busy()) return;
        farmingMenus.delete(menu);
        player.getPacketSender().sendInterfaceRemoval();
        shown[number - 1][1]();
    });
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(menu));
}
function farmingOptionClick(event) {
    const menu = event.player.getDialogueManager().getCurrent();
    const select = farmingMenus.get(menu);
    if (event.buttonId !== core.OptionDialogue.OPTIONS_WIDGET_ID || !select) return;
    // Handle both resume and widget inputs before the legacy button fallback changes their index.
    event.handled = true;
    select(event.slot === undefined || event.slot === -1 ? event.action : event.slot);
}
function clearPatch(player, patch) {
    if (patch.type === "REDWOOD") redwoodRegrowth.delete(player);
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
    // Every patch action ends here, so a changed patch reschedules its owner's next growth.
    if (tracked.has(player)) dirty.add(player);
    sender.sendVarbit(patch.varbit, value);
    if (patch.type === "REDWOOD") Redwood.refresh(player, patch);
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
/** The axe Woodcutting would use (one the player has the level for), or null after the captured refusal. */
function requireAxe(player, patch) {
    const request = { player, itemId: null, axe: null };
    core.PluginManager.emitCustomEvent("woodcutting:axe", request);
    if (request.axe) return request.axe;
    // Captures word it two ways: tree patches "which ... woodcutting", fruit and crystal trees "that ... Woodcutting".
    player.sendMessage(Data.WOOD_TREES.has(patch.type)
        ? "You need an axe to chop down this tree.<br>You do not have an axe which you have the woodcutting level to use."
        : "You need an axe to chop down this tree.<br>You do not have an axe that you have the Woodcutting level to use.");
    return null;
}
function animate(player, animation) { player.performAnimation(new core.Animation(animation)); }
function gate(player) {
    if (PENDING.has(player)) return false;
    if (!player.getClickDelay().elapsedTime(600)) return false;
    player.getClickDelay().reset();
    return true;
}
function nearPatch(player, patch) {
    const loc = player.getLocation();
    return loc.getZ() === patch.z && loc.getX() >= patch.x - 16 && loc.getX() <= patch.maxX + 16 && loc.getY() >= patch.y - 16 && loc.getY() <= patch.maxY + 16;
}
// Captures: the rake swings two ticks after the click and every four after, each swing after the
// first pulling a weed. A harvest swings at once and every three ticks, the produce a few ticks later.
function startWork(player, patch, action) {
    const work = { patch, action, position: player.getLocation().clone(), swung: false, nextTick: workTick };
    if (action === "rake") {
        const state = stateFor(player, patch);
        if (state.crop || state.scarecrow || !state.weeds) return;
        if (!requireTool(player, "Rake", "You need a rake to weed a farming patch.")) return;
        work.nextTick = workTick + 2;
    } else {
        work.pick = canPick(player, patch);
        if (!work.pick) return;
        if (work.pick.begin) spam(player, `You begin to harvest the ${patchNoun(patch)}.`);
    }
    WORK.set(player, work);
    if (work.nextTick <= workTick) workStep(player, work);
}
/** Digs a patch clear: the dig twice, three ticks apart, then `finish` five ticks after the click. */
function startClear(player, patch, start, finish) {
    spam(player, start);
    WORK.set(player, { patch, action: "clear", position: player.getLocation().clone(), nextTick: workTick, digs: 0, finish });
    workStep(player, WORK.get(player));
}
function clearStep(player, work) {
    if (work.digs < 2) {
        animate(player, ANIM.DIG);
        sound(player, SOUND.DIG);
        work.nextTick = workTick + (++work.digs === 1 ? 3 : CLEAR_TICKS - 3);
        return true;
    }
    work.finish();
    return false;
}
function startBinWork(player, patch, input, action = "fill-bin") {
    WORK.set(player, { patch, action, input, nextTick: workTick + 2,
        position: player.getLocation().clone(), depositing: false });
}
function fillBinStep(player, work) {
    const { patch, input } = work;
    const inventory = player.getInventory();
    const bin = stateFor(player, patch).bin;
    const capacity = patch.type === "BIG_COMPOST" ? 30 : 15;
    if (bin !== input.bin || bin.closedAt || bin.open || bin.count >= capacity || !inventory.contains(input.id)) return false;
    // Captures: animate at +2, deposit at +3, then repeat both phases every two ticks.
    if (!work.depositing) {
        animate(player, FILL_BIN_ANIMATION);
        player.getPacketSender().sendSound(FILL_BIN_SOUND, 1, 0);
    } else {
        inventory.deleteNumber(input.id, 1);
        bin.count++;
        if (input.superItem) bin.super++;
        if (input.tomato) bin.tomatoes++;
        bin.tier = bin.super === bin.count ? 2 : bin.tomatoes === bin.count ? 4 : 1;
        syncPatch(player, patch);
        if (bin.count >= capacity || !inventory.contains(input.id)) return false;
    }
    work.depositing = !work.depositing;
    work.nextTick = workTick + 1;
    return true;
}
function workStep(player, work) {
    if (player.getHitpoints() <= 0 || player.busy() || !player.getLocation().equals(work.position) || player.getMovementQueue().isMovings()) {
        WORK.delete(player);
        return;
    }
    if (work.levelUpPaused || workTick < work.nextTick) return;
    let again;
    if (work.action === "fill-bin") again = fillBinStep(player, work);
    else if (work.action === "take-bin") {
        // Returns the ticks to its next step, or false when done.
        again = Services.takeBinStep(player, work);
        if (again) work.nextTick = workTick + again;
    }
    else if (work.action === "clear") again = clearStep(player, work);
    else if (work.action === "rake") again = rakeStep(player, work);
    else again = harvestStep(player, work);
    if (!again) WORK.delete(player);
    if (!work.action.endsWith("-bin")) syncPatch(player, work.patch);
}
/** Ticks between rake swings or harvest picks; content may make them faster ("skills:action-interval", a league relic's 2-tick pace). */
function pace(player, kind, ticks) {
    return actionInterval(core.PluginManager, player, core.Skill.FARMING, kind, ticks);
}
function rakeStep(player, work) {
    const state = stateFor(player, work.patch);
    if (work.swung && !rake(player, work.patch)) return false;
    if (state.crop || state.scarecrow || !state.weeds || !hasTool(player, "Rake")) return false;
    animate(player, ANIM.RAKE);
    sound(player, SOUND.RAKE);
    work.swung = true;
    work.nextTick = workTick + pace(player, "rake", RAKE_PERIOD);
    return true;
}
function rake(player, patch) {
    const state = stateFor(player, patch);
    if (state.crop || state.scarecrow || !state.weeds) return false;
    if (!give(player, Data.itemId("Weeds"))) return false;
    state.weeds--;
    state.nextAt = Model.nextGrowth(Date.now(), Data.FORMULAS.growth.tickMinutes, farmFor(player).offset);
    award(player, 4, patch);
    // "farming:raked" { player, patch, patchType }: a weed raked from the patch.
    core.PluginManager.emitCustomEvent("farming:raked", { player, patch, patchType: patch.type });
    return state.weeds > 0;
}
function harvestStep(player, work) {
    const { pick } = work;
    if (work.swung) {
        work.swung = false;
        sound(player, pick.pickSound);
        let again = harvest(player, work.patch);
        // Content may pick several times an action ("farming:harvests-per-action", a league relic's faster harvests).
        if (again) {
            const request = { player, patch: work.patch, crop: stateFor(player, work.patch).crop, harvests: 1 };
            core.PluginManager.emitCustomEvent("farming:harvests-per-action", request);
            const harvests = Number.isInteger(request.harvests) ? Math.min(100, request.harvests) : 1;
            for (let more = 1; more < harvests && again && !work.levelUpPaused; more++) again = harvest(player, work.patch);
        }
        if (again && !hasSpaceFor(player, stateFor(player, work.patch))) {
            spam(player, "You have run out of inventory space.");
            again = false;
        }
        if (!again) return false;
        work.nextTick = work.swungAt + pace(player, "harvest", PICK_PERIOD);
        if (workTick < work.nextTick) return true;
    }
    if (!canPick(player, work.patch)) return false;
    if (pick.swing) spam(player, pick.swing);
    animate(player, pick.anim);
    sound(player, pick.sound);
    work.swung = true;
    work.swungAt = workTick;
    work.nextTick = workTick + pick.delay;
    return true;
}
/**
 * Whether the player has the Farming level `required` to plant, place or make a crop's item
 * (`kind`: "plant", "scarecrow", "seedling"); else says the refusal. Content may waive it
 * ("farming:level-rules" { player, kind, required, waived }, a league relic).
 */
function hasLevel(player, required, kind, refusal = `You need level ${required} Farming.`) {
    if (player.getSkillManager().getCurrentLevel(core.Skill.FARMING) >= required) return true;
    const rules = { player, kind, required, waived: false };
    core.PluginManager.emitCustomEvent("farming:level-rules", rules);
    if (rules.waived === true) return true;
    player.sendMessage(refusal);
    return false;
}
function plant(player, patch, id) {
    const crop = Data.SEEDS.get(id);
    const state = stateFor(player, patch);
    if (state.crop || state.scarecrow) { player.sendMessage("There is already something growing here."); return; }
    if (state.weeds) { player.sendMessage("You need to rake the weeds out first."); return; }
    if (!crop) { player.sendMessage("That cannot be planted in this patch."); return; }
    if (crop.type !== patch.type) {
        player.sendMessage(`You can only plant ${crop.sapling ? saplingNoun(crop) : seedNoun(crop)}s in ${article(PATCH_NOUNS[crop.type] ?? "patch")}.`); return;
    }
    if (patch === TROLL_HERB_PATCH && crop.key === "GOUTWEED") { player.sendMessage("Regular goutweed cannot grow in this patch."); return; }
    if (!hasLevel(player, crop.level, "plant", `You need level ${crop.level} Farming to plant that.`)) return;
    const barbarian = farmFor(player).barbarian;
    const bareHanded = !crop.sapling && crop.type !== "GRAPES" && barbarian?.planting > 0 && !hasTool(player, "Seed dibber");
    if (!bareHanded && !requireTool(player, crop.sapling ? "Spade" : "Seed dibber")) return;
    if (patch.type === "GRAPES" && !state.compost) { player.sendMessage("Treat the vine patch with saltpetre first."); return; }
    if (crop.type === "SPIRIT_TREE") {
        const level = player.getSkillManager().getCurrentLevel(core.Skill.FARMING);
        const limit = level >= 99 ? Infinity : level >= 96 ? 4 : level >= 93 ? 3 : level >= 88 ? 2 : 1;
        if (Object.values(farmFor(player).patches).filter(s => s.crop === crop.key).length >= limit) {
            player.sendMessage("You cannot grow any more spirit trees at your Farming level."); return;
        }
    }
    if (player.getInventory().getAmount(id) < crop.seedCount) { player.sendMessage(`You need ${crop.seedCount} seeds to plant this crop.`); return; }
    if (bareHanded && barbarian.planting === 1 && Math.random() < Data.FORMULAS.barbarianPlantFailureChance) {
        player.getInventory().deleteNumber(id, crop.seedCount);
        player.sendMessage("You crush the seeds while trying to plant them bare-handed."); return;
    }
    // Content may keep the seed, grow the crop at once or keep it from disease and death ("farming:plant-rules", a league relic);
    // `message` is said after the planting's own.
    const rules = { player, crop: crop.key, seedId: id, patch, keepSeed: false, grown: false, diseaseFree: false, undying: false, message: null };
    core.PluginManager.emitCustomEvent("farming:plant-rules", rules);
    const keepSeed = rules.keepSeed === true;
    let seedCount = crop.seedCount;
    if (!keepSeed && patch.type === "ALLOTMENT" && player.getEquipment().contains(Data.itemId("Amulet of bounty")) && Math.random() < Data.FORMULAS.amuletOfBountySaveChance) {
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
    // Captures: a seed leaves the inventory with the dibbing (bare-handed: _nodib) and its sound, and
    // takes root three ticks later; a sapling is dug in with the spade and planted the next tick.
    animate(player, crop.sapling ? ANIM.SAPLING : bareHanded ? ANIM.PLANT_BARE_HANDED : ANIM.PLANT);
    sound(player, crop.sapling ? SOUND.DIG : SOUND.PLANT);
    if (!keepSeed && !crop.sapling) player.getInventory().deleteNumber(id, seedCount);
    after(player, crop.sapling ? 1 : 3, () => {
        if (!keepSeed && crop.sapling) {
            if (!player.getInventory().contains(id)) return;
            player.getInventory().deleteNumber(id, seedCount);
            if (barbarian?.smashing && barbarian.autoSmash) {
                player.sendMessage("You smash the empty plant pot to dust.");
                if (barbarian.smashing === 1 && crop.type !== "SPIRIT_TREE") barbarian.smashing = 2;
            } else player.getInventory().addItem(new core.Item(Data.itemId("Plant pot")));
        }
        if (bareHanded && barbarian.planting === 1) {
            barbarian.planting = 2;
            player.sendMessage("You feel you have learned more of barbarian ways. Otto might wish to talk to you more.");
        }
        const plantedAt = Date.now(), offset = farmFor(player).offset;
        Object.assign(state, { crop: crop.key, stage: 0, status: "growing", checked: false, protected: false, watered: false,
            lives: 0, plantedAt, plantedTick: Model.tickIndex(plantedAt, offset),
            nextAt: Model.nextGrowth(plantedAt, Data.stageMinutes(crop, 0), offset),
            diseaseFree: rules.diseaseFree === true, undying: rules.undying === true });
        // Fully grown at once, as the growth model leaves a crop on its last stage (an anima plant's last stage is its end).
        if (rules.grown === true && crop.type !== "ANIMA") {
            Object.assign(state, { stage: crop.stages, status: "grown", lives: Model.startingLives(crop, state.compost) });
            if (crop.regrow) state.nextAt = Model.nextGrowth(Date.now(), crop.regrow, farmFor(player).offset);
        }
        // Herbs award their planting XP only after the final herb is picked.
        if (crop.type !== "HERB") award(player, crop.plant, patch);
        spam(player, plantLine(crop, patch, crop.seedCount));
        if (typeof rules.message === "string") player.sendMessage(rules.message);
        syncPatch(player, patch);
        core.PluginManager.emitCustomEvent("farming:planted", { player, crop: crop.key, seedId: id, patch });
    });
}
/** The captured planting line: "You plant a tarromin seed in the herb patch.", "You plant 3 potato seeds in the allotment." */
function plantLine(crop, patch, count) {
    if (crop.type === "SPIRIT_TREE") return "You plant the Spirit Tree sapling.";
    // Every captured hardwood sapling (mahogany, teak) is named "the plantpot" in live.
    if (crop.type === "HARDWOOD_TREE") return `You plant the plantpot in the ${patchNoun(patch)}.`;
    if (crop.sapling) return `You plant the ${saplingNoun(crop)} in the ${patchNoun(patch)}.`;
    const seed = seedNoun(crop);
    return count > 1 ? `You plant ${count} ${seed}s in the ${patchNoun(patch)}.` : `You plant ${article(seed)} in the ${patchNoun(patch)}.`;
}
/** Live calls the oak to yew saplings "<tree> sapling" and every other one "<tree> tree sapling". */
function saplingNoun(crop) {
    const name = crop.name.toLowerCase().replace(/ tree$/, "");
    return `${name}${crop.type === "TREE" && crop.key !== "MAGIC" ? "" : " tree"} sapling`;
}
// Captured: "snape grass seed", "Yanillian hop seeds", "Bittercap mushroom spore".
const HOP_SEEDS = new Set(["HAMMERSTONE", "ASGARNIAN", "YANILLIAN", "KRANDORIAN", "WILDBLOOD"]);
function seedNoun(crop) {
    if (crop.key === "MUSHROOM") return "Bittercap mushroom spore";
    if (HOP_SEEDS.has(crop.key)) return `${crop.name} hop seed`;
    return core.CacheDefinitions.getItem(crop.seed).name.toLowerCase();
}
/**
 * A watering can with water or Gricoller's can (matching `id` when given). By name: the cache has
 * no "Magic watering can", and looking one up threw for Gricoller's can.
 */
function isWateringCan(item, id) {
    if (!item || (id && item.getId() !== id)) return false;
    return /^Watering can\([1-8]\)$|^Gricoller's can$/.test(core.CacheDefinitions.getItem(item.getId())?.name ?? "");
}
/** Pours one charge from `can`; false when it is Gricoller's can with none left. */
function pour(player, can) {
    const name = core.CacheDefinitions.getItem(can.getId()).name;
    if (name === "Gricoller's can") {
        const charges = Number(can.getMetaValue(GRICOLLER_WATER_META) ?? 0);
        if (!charges) return false;
        can.setMetaValue(GRICOLLER_WATER_META, charges - 1);
    }
    const charges = name.match(/^Watering can\(([1-8])\)$/);
    if (charges) can.setId(Data.itemId(+charges[1] === 1 ? "Watering can" : `Watering can(${+charges[1] - 1})`));
    player.getInventory().refreshItems();
    return true;
}
function water(player, id, slot) {
    const inventory = player.getInventory();
    const can = slot === undefined ? inventory.getItems().find(item => isWateringCan(item, id)) : inventory.forSlot(slot);
    if (!isWateringCan(can, id)) { player.sendMessage("You need a watering can containing water."); return false; }
    if (!pour(player, can)) { player.sendMessage("Your can is empty."); return false; }
    animate(player, ANIM.WATER);
    return true;
}
/**
 * "farming:use-water" `{ player, check?, used }`: watering for content outside Farming (a POH
 * garden plant). Pours one charge from the first carried can that has water and sets `used`;
 * with `check` it only says whether one would pour. Silent, no animation: the caller owns both.
 */
function useWater(event) {
    if (event.used) return;
    const cans = event.player.getInventory().getItems().filter(item => isWateringCan(item));
    const wet = cans.find(can => core.CacheDefinitions.getItem(can.getId()).name !== "Gricoller's can"
        || Number(can.getMetaValue(GRICOLLER_WATER_META) ?? 0) > 0);
    if (!wet) return;
    event.used = event.check ? true : pour(event.player, wet);
}
function waterPatch(player, patch, id, slot) {
    const state = stateFor(player, patch);
    if (!state.crop || state.status !== "growing" || !Data.WATERABLE.has(patch.type)) { player.sendMessage("This patch does not need watering."); return; }
    if (state.watered) { player.sendMessage("This crop is already watered."); return; }
    if (water(player, id, slot)) state.watered = true;
}
function canCompost(player, patch) {
    const state = stateFor(player, patch);
    if (state.weeds || state.compost || state.status === "dead" || ["ANIMA", "GRAPES", "CORAL"].includes(patch.type)) {
        player.sendMessage(state.compost ? "This patch has already been treated." : "You cannot compost this patch now."); return false;
    }
    return true;
}
function treat(player, patch, tier, xp = [0, 18, 26, 36][tier]) {
    const state = stateFor(player, patch);
    state.compost = tier;
    if (state.status === "grown" && Data.COMPOSTABLE_YIELD.has(patch.type)) state.lives += tier;
    award(player, xp, patch);
    syncPatch(player, patch);
}
/** Treats the patch at once (the Fertile Soil spell). */
function fertilize(player, patch, tier, consume = true, xp = [0, 18, 26, 36][tier]) {
    if (!canCompost(player, patch)) return false;
    if (consume) {
        const id = Data.itemId(["", "Compost", "Supercompost", "Ultracompost"][tier]);
        if (!player.getInventory().contains(id)) return false;
        player.getInventory().deleteNumber(id, 1);
        player.getInventory().addItem(new core.Item(Data.itemId("Bucket")));
    }
    treat(player, patch, tier, xp);
    animate(player, ANIM.COMPOST);
    return true;
}
function swapForBucket(player, id) {
    if (!player.getInventory().contains(id)) return false;
    player.getInventory().deleteNumber(id, 1);
    player.getInventory().addItem(new core.Item(Data.itemId("Bucket")));
    return true;
}
/**
 * Pours compost from a bucket: the pour and its sound now, the patch treated and named two ticks
 * later (captures). `use` takes the compost then and says whether there was any.
 */
function pourCompost(player, patch, tier, use) {
    if (!canCompost(player, patch)) return false;
    animate(player, ANIM.COMPOST);
    sound(player, SOUND.COMPOST);
    after(player, 2, () => {
        if (stateFor(player, patch).compost || !use()) return;
        treat(player, patch, tier);
        player.sendMessage(`You treat the ${patchNoun(patch)} with ${COMPOST_NAMES[tier]}.`);
    });
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
        if (pruning && Math.random() < Data.FORMULAS.pruneFailureChance) { player.sendMessage("There are still some diseased leaves left."); return false; }
    }
    state.status = "growing";
    state.nextAt = Model.nextGrowth(Date.now(), Data.stageMinutes(Data.CROPS.get(state.crop), state.stage), farmFor(player).offset);
    syncPatch(player, patch);
    return true;
}
function healthCheck(player, patch) {
    const state = stateFor(player, patch);
    const crop = Data.CROPS.get(state.crop);
    if (!crop || state.status !== "grown" || state.checked) return;
    state.checked = true;
    award(player, crop.check, patch);
    // Captured nouns: "the tree" (tree, fruit, hardwood and crystal patches), "the Spirit Tree",
    // "the Calquat Tree", "the potato cactus"; the Wiki gives "the bush".
    const noun = crop.type === "SPIRIT_TREE" ? "Spirit Tree" : crop.type === "CALQUAT" ? "Calquat Tree"
        : crop.type === "CACTUS" ? crop.name.toLowerCase() : crop.type === "BUSH" ? "bush" : "tree";
    spam(player, `You examine the ${noun} for signs of disease and find that it is in perfect health.`);
    Services.cropRewards(player, crop);
    core.PluginManager.emitCustomEvent("farming:check-health", { player, crop: crop.key, type: crop.type, patch, experience: crop.check });
}
function hasSpaceFor(player, state) {
    const crop = Data.CROPS.get(state.crop);
    const inventory = player.getInventory();
    if (!inventory.isFull()) return true;
    // An open herb sack takes the herbs itself (Guild.storeCrop).
    if (crop?.type === "HERB" && inventory.contains(Data.itemId("Open herb sack"))) return true;
    return crop?.produce > 0 && core.CacheDefinitions.getItem(crop.produce).stackability !== 0 && inventory.contains(crop.produce);
}
/** Whether a grown patch can be picked now, and how (PICKS); says why not. */
function canPick(player, patch) {
    const state = stateFor(player, patch);
    const crop = Data.CROPS.get(state.crop);
    if (!crop || state.status !== "grown") return null;
    if (crop.check && !state.checked) { healthCheck(player, patch); return null; }
    if (crop.type === "HESPORI") { Hespori.harvestHespori(player, patch); return null; }
    if (crop.produce < 0 || Data.WOOD_TREES.has(crop.type) || state.lives <= 0) return null;
    if (["ALLOTMENT", "HERB", "HOPS", "BELLADONNA"].includes(crop.type) && !requireTool(player, "Spade")) return null;
    if (crop.type === "BELLADONNA" && !Data.BELLADONNA_HANDWEAR.has(player.getEquipment().get(core.Equipment.HANDS_SLOT)?.getId())) {
        player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(2, core.HitMask.GREEN)]);
        player.sendMessage("Your hands are not protected from the poisonous nightshade."); return null;
    }
    if (!hasSpaceFor(player, state)) { spam(player, "You have run out of inventory space."); return null; }
    if (["CRYSTAL_TREE", "CELASTRUS"].includes(crop.type)) {
        const axe = requireAxe(player, patch);
        if (!axe) return null;
        // Crystal tree capture (recording 819): the swing line at once, the shatter four ticks later.
        if (crop.type === "CRYSTAL_TREE") return { anim: axe.animationId, pickSound: SOUND.CRYSTAL_SHATTER, delay: 4,
            swing: "You swing your axe at the tree.", each: "You shatter the crystal tree into crystal shards." };
    }
    return PICKS[crop.type] ?? { anim: ANIM.PICK_LOW, delay: 1 };
}
function harvest(player, patch) {
    const state = stateFor(player, patch);
    const crop = Data.CROPS.get(state.crop);
    if (!crop || state.status !== "grown" || crop.produce < 0 || state.lives <= 0) return false;
    const pickLine = (PICKS[crop.type] ?? (crop.type === "CRYSTAL_TREE" ? { each: "You shatter the crystal tree into crystal shards." } : {})).each;
    const level = player.getSkillManager().getCurrentLevel(core.Skill.FARMING);
    const attas = Model.activeAnima(farmFor(player), Date.now()) === "ATTAS";
    const belladonna = Data.FORMULAS.belladonna;
    let amount = crop.key === "WOAD" ? 3 : crop.key === "LIMPWURT" ? 3 + Math.floor(Math.floor(Math.random() * level) * (hasTool(player, "Magic secateurs") ? 1.1 : 1) * (attas ? 1.05 : 1) / 10)
        : crop.type === "BELLADONNA" ? belladonna.base + Math.floor(Math.random() * (Math.floor(level / belladonna.levelStep) + 1))
        : crop.type === "CRYSTAL_TREE" ? 16 + state.compost * 4 + Math.floor(Math.random() * 5) : 1;
    let produce = crop.produce;
    const blessing = crop.type === "GRAPES" && player.getInventory().contains(Data.itemId("Bologa's blessing"));
    if (blessing) produce = Data.itemId("Zamorak's grapes");
    // Content may change what one pick yields and its XP ("farming:pick", a league relic's triple, noted harvests),
    // or take some of it itself (`stored`, a league fragment's banked harvests).
    const experience = crop.harvest * (["FLOWER", "BELLADONNA"].includes(crop.type) ? 1 : amount);
    const pick = { player, crop: crop.key, patch, itemId: produce, amount, experience, stored: 0 };
    core.PluginManager.emitCustomEvent("farming:pick", pick);
    const picked = Number.isInteger(pick.itemId) && pick.itemId > 0 ? pick.itemId : produce;
    const pickedAmount = Number.isSafeInteger(pick.amount) && pick.amount > 0 ? pick.amount : amount;
    const left = pickedAmount - (Number.isSafeInteger(pick.stored) ? Math.min(pickedAmount, Math.max(0, pick.stored)) : 0);
    const sack = crop.type === "HERB" && picked === produce && player.getInventory().getItems().find(i => i.getId() === Data.itemId("Open herb sack"));
    if (left > 0 && !(sack && Guild.storeCrop(player, sack, produce, left)) && !give(player, picked, left)) return false;
    if (blessing) player.getInventory().deleteNumber(Data.itemId("Bologa's blessing"), 1);
    if (pickLine) spam(player, pickLine === true ? `You pick ${article(core.CacheDefinitions.getItem(picked).name.toLowerCase())}.`
        : pickLine.startsWith("You ") ? pickLine : `You pick ${pickLine}.`);
    award(player, Number.isFinite(pick.experience) && pick.experience >= 0 ? pick.experience : experience, patch);
    const variable = Data.COMPOSTABLE_YIELD.has(crop.type) || ["BUSH", "CACTUS", "GRAPES", "CORAL"].includes(crop.type);
    // Wiki: a worn Farming cape (or max cape) saves herb lives more often.
    const capePerk = { player, skill: "FARMING", result: false };
    core.PluginManager.emitCustomEvent("skillcape:has-perk", capePerk);
    const cape = capePerk.result === true;
    const vars = player.getPacketSender();
    const diary = crop.type !== "HERB" ? 0 : patch.x === 2813 && patch.y === 3463
        ? vars.getVarbit(4478) ? 25 : vars.getVarbit(4477) ? 17 : vars.getVarbit(4476) ? 10 : 0
        : [1738, 1238].includes(patch.x) && vars.getVarbit(7927) ? 10 : 0;
    const chance = Model.saveLifeChance(crop, level, hasTool(player, "Magic secateurs"), cape, diary, attas);
    if (!variable || Math.random() >= chance) state.lives--;
    if (["FLOWER", "BELLADONNA", "CRYSTAL_TREE"].includes(crop.type)) state.lives = 0;
    if (state.lives === 0) {
        if (PICKS[crop.type]?.begin) player.sendMessage(`The ${patchNoun(patch)} is now empty.`);
        if (crop.type === "HERB") award(player, crop.plant, patch);
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
    if (state.scarecrow) {
        if (requireTool(player, "Spade") && give(player, Data.itemId("Scarecrow"))) { state.scarecrow = false; syncPatch(player, patch); }
        return;
    }
    if (!state.crop) return;
    const crop = Data.CROPS.get(state.crop);
    if (crop.type === "REDWOOD" && state.status === "grown") { player.sendMessage("Ask Alexandra to remove the redwood tree."); return; }
    if (state.status === "dead" || state.stump) { clearCrop(player, patch, state, crop); return; }
    if ((Data.WOOD_TREES.has(crop.type) || crop.type === "FRUIT_TREE") && state.status === "grown") {
        player.sendMessage("Chop the tree down before digging out the stump, or pay a gardener to remove it."); return;
    }
    if (!requireTool(player, "Spade", "You need a spade to clear a farming patch.")) return;
    choose(player, [["Yes, I want to clear it for new crops.", () => {
        if (nearPatch(player, patch) && stateFor(player, patch) === state) clearCrop(player, patch, state, crop);
    }], ["No, I want to leave it as it is.", () => {}]], 0, "Are you sure you want to dig up this patch?");
}
/** Digs out a crop or stump with the captured start and finish lines. */
function clearCrop(player, patch, state, crop) {
    if (!requireTool(player, "Spade", "You need a spade to clear a farming patch.")) return;
    const stump = state.stump ? `${crop.type === "FRUIT_TREE" ? "fruit tree" : "tree"} stump` : null;
    startClear(player, patch, stump ? `You start digging up the ${stump}.` : "You start digging the farming patch...", () => {
        if (stateFor(player, patch) !== state) return;
        if (state.stump && crop.type === "TREE") {
            // Wiki Tree_roots_(Farming): one more root every eight levels above planting,
            // capped at four; temporary boosts apply when the stump is dug.
            const roots = 1 + Math.min(3, Math.floor((player.getSkillManager().getCurrentLevel(core.Skill.FARMING) - crop.level) / 8));
            if (!give(player, Data.itemId(`${crop.name} roots`), Math.max(1, roots))) return;
        }
        clearPatch(player, patch);
        spam(player, stump ? `You dig up the ${stump}.` : "You have successfully cleared this patch for new crops.");
    });
}
/** The captured one-paragraph inspect line, and the gardener's when one protects the patch. */
function inspect(player, patch) {
    const state = stateFor(player, patch);
    const crop = Data.CROPS.get(state.crop);
    const soil = state.compost ? `The soil has been treated with ${COMPOST_NAMES[state.compost]}.` : "The soil has not been treated.";
    const name = crop && (TREE_TYPES.has(crop.type) ? (/ tree$/i.test(crop.name) ? crop.name : `${crop.name} tree`) : crop.name.toLowerCase());
    const growth = crop ? (state.status === "grown" ? `The patch (${name}) is fully grown.`
            : `The patch has ${name} growing in it and is at state ${state.stage}/${crop.stages}.`)
        : state.scarecrow ? "A scarecrow protects nearby sweetcorn." : state.weeds ? "The patch needs weeding." : "The patch is empty and weeded.";
    player.sendMessage(`This is ${article(patchNoun(patch))}. ${soil} ${growth}`);
    if (state.protected) player.sendMessage("A nearby gardener is looking after this patch for you.");
}
function fillPlantPot(player, patch, state, id) {
    if (state.crop || state.scarecrow) { player.sendMessage("You can only fill a plantpot from an empty farming patch."); return; }
    if (state.weeds) { player.sendMessage("This patch needs weeding first."); return; }
    if (!requireTool(player, "Gardening trowel")) return;
    // Captures: the short trowel dig, then the pot is filled two ticks later.
    animate(player, ANIM.FILL_POT);
    after(player, 2, () => {
        if (!player.getInventory().contains(id)) return;
        player.getInventory().deleteNumber(id, 1);
        player.getInventory().addItem(new core.Item(Data.itemId("Filled plant pot")));
    });
}
function canUsePatch(player, patch) {
    if (patch === TROLL_HERB_PATCH) {
        const quest = { player, key: "my_arms_big_adventure", complete: null };
        core.PluginManager.emitCustomEvent("quest:is-complete", quest);
        if (quest.complete !== true) { player.sendMessage("You must complete My Arm's Big Adventure to use this herb patch."); return false; }
    }
    const request = { player, patch, allowed: true };
    if (patch === LLETYA_FRUIT_PATCH) {
        const quest = { player, key: "mournings_end_part_i", started: false };
        core.PluginManager.emitCustomEvent("quest:is-started", quest);
        if (quest.started !== true) {
            player.sendMessage("You must start Mourning's End Part I to use this fruit tree patch.");
            return false;
        }
    }
    core.PluginManager.emitCustomEvent("farming:can-use-patch", request);
    if (request.allowed !== false && patch === HARMONY_HERB_PATCH) {
        const diary = { player, diary: "morytania", tier: "elite", complete: false };
        core.PluginManager.emitCustomEvent("diary:is-complete", diary);
        if (diary.complete !== true) {
            player.sendMessage("You must complete the elite Morytania Diary to use this herb patch.");
            return false;
        }
    }
    return request.allowed !== false;
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
    if (!canUsePatch(player, patch)) return;
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
    else if (action === "travel" && state.checked) spiritTravel(player, patch);
    else if (action === "chop-down" && patch.type === "CRYSTAL_TREE") startWork(player, patch, "harvest");
    else if (action === "chop" && patch.type === "CELASTRUS" && state.status === "grown" && !state.lives && requireAxe(player, patch)) {
        state.stump = true; state.nextAt = Number.MAX_SAFE_INTEGER; animate(player, 879);
    }
    else if ((["chop-down", "chop down", "chop"].includes(action) || action === "cut" && patch.type === "REDWOOD") && state.status === "grown" && state.checked) {
        if (!requireAxe(player, patch)) return;
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
                if (core.CacheDefinitions.getItem(id).name === "Gricoller's can") can.setMetaValue(GRICOLLER_WATER_META, 1000);
                else can.setId(Data.itemId("Watering can(8)"));
                player.getInventory().refreshItems();
            }
        }
        return;
    }
    event.handled = true;
    if (!canUsePatch(player, patch)) return;
    if (!gate(player) || !player.getInventory().contains(id)) return;
    Model.advanceFarm(farmFor(player), Date.now());
    const state = stateFor(player, patch);
    if (patch.type.includes("COMPOST")) { Services.binAction(player, patch, "", id, event.itemSlot); syncPatch(player, patch); return; }
    const compostTier = ["Compost", "Supercompost", "Ultracompost"].findIndex(name => id === Data.itemId(name)) + 1;
    if (Data.SEEDS.has(id)) plant(player, patch, id);
    else if (id === Data.itemId("Rake")) startWork(player, patch, "rake");
    else if (id === Data.itemId("Spade") && patch.type === "HESPORI" && state.status === "grown") Hespori.harvestHespori(player, patch);
    else if (id === Data.itemId("Spade")) dig(player, patch);
    else if (id === Data.itemId("Plant cure") || id === Data.itemId("Secateurs") || id === Data.itemId("Magic secateurs")) cure(player, patch, true, id);
    else if (/^Watering can(?:\([1-8]\))?$|^Magic watering can$|^Gricoller's can$/.test(core.CacheDefinitions.getItem(id).name)) waterPatch(player, patch, id, event.itemSlot);
    else if (core.CacheDefinitions.getItem(id).name === "Bottomless compost bucket") Services.useBottomless(player, patch, id, event.itemSlot);
    else if (id === Data.itemId("Amulet of Nature")) {
        farmFor(player).boundPatch = Data.patchKey(patch);
        farmFor(player).boundStatus = state.crop ? state.status : "empty";
        player.sendMessage("You bind the amulet to this patch.");
    }
    else if (compostTier) pourCompost(player, patch, compostTier, () => swapForBucket(player, id));
    else if (id === Data.itemId("Saltpetre") && patch.type === "GRAPES" && !state.crop && !state.compost && requireTool(player, "Gardening trowel")) {
        player.getInventory().deleteNumber(id, 1); state.compost = 1;
    } else if (id === Data.itemId("Scarecrow") && patch.type === "FLOWER" && !state.crop && !state.weeds && !state.scarecrow) {
        if (!hasLevel(player, SCARECROW_LEVEL, "scarecrow")) return;
        player.getInventory().deleteNumber(id, 1); state.scarecrow = true;
    } else if (id === Data.itemId("Plant pot")) fillPlantPot(player, patch, state, id);
    else player.sendMessage("Nothing interesting happens.");
    syncPatch(player, patch);
}
function itemOnItem(event) {
    WORK.delete(event.player);
    const definitions = [event.usedItemId, event.usedWithItemId].map(id => core.CacheDefinitions.getItem(id));
    if (definitions.some(definition => definition.noteTemplate >= 0)) {
        // Notes are accepted only for bottomless filling, never other Farming recipes/storage.
        if (definitions.some(definition => definition.noteTemplate < 0 && definition.name === "Bottomless compost bucket"))
            Services.farmingItemPair(event);
        return;
    }
    Guild.storagePair(event);
    if (!event.handled) Services.farmingItemPair(event);
}
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
    if (patch && !canUsePatch(event.player, patch)) { event.handled = true; return; }
    Spells.farmingSpell(event, patch);
}
/** A grown tree's Travel opens the spirit tree network's menu (SpiritTrees). */
function spiritTravel(player, patch) {
    core.PluginManager.emitCustomEvent("spirit-trees:open", { player, x: patch.x, y: patch.y, z: patch.z });
}
/** SpiritTrees asks which spirit tree patches the player has grown and checked. */
function grownSpiritTrees(request) {
    const farm = farmFor(request.player);
    for (const p of Data.CACHE.patches.filter(p => p.type === "SPIRIT_TREE" && farm.patches[Data.patchKey(p)]?.checked)) {
        request.patches.push({ x: p.x, y: p.y, z: p.z });
    }
}
function validateTree(event) {
    const pos = event.object.getLocation();
    const patch = findPatch(event.object.getId(), { x: pos.getX(), y: pos.getY(), z: pos.getZ() });
    if (!patch) return;
    const state = stateFor(event.player, patch);
    event.allow = state.status === "grown" && state.checked && !state.stump;
    if (patch.type === "REDWOOD") {
        Redwood.advance(state, Date.now());
        const branch = Redwood.branchIndex(patch, event.object);
        event.allow = state.status === "grown" && state.checked && branch >= 0 && !state.redwoodBranches?.[branch];
    }
}
function depleteTree(event) {
    const pos = event.object.getLocation();
    const patch = findPatch(event.object.getId(), { x: pos.getX(), y: pos.getY(), z: pos.getZ() });
    if (!patch) return;
    event.handled = true;
    const state = stateFor(event.player, patch);
    if (patch.type === "REDWOOD") {
        const branch = Redwood.branchIndex(patch, event.object);
        if (branch < 0 || state.status !== "grown" || !state.checked) return;
        Redwood.advance(state, Date.now());
        state.redwoodBranches ??= [0, 0, 0, 0];
        if (state.redwoodBranches[branch]) return;
        state.redwoodBranches[branch] = Date.now() + Redwood.REGROW_TICKS * 600;
        redwoodRegrowth.set(event.player, Redwood.nextDue(state));
        syncPatch(event.player, patch);
        return;
    }
    state.stump = true;
    state.nextAt = Date.now() + event.respawnTicks * 600;
    syncPatch(event.player, patch);
}
// Each player is grown when their next patch stage or watered seedling is due - the OSRS
// farming tick, with their account offset - and at least every SWEEP_MS in case something
// changed that nothing reported (a seedling received in a trade, say).
const SWEEP_MS = 5 * Model.MINUTE;
const dueByMinute = new Map(); // minute -> players due within it
const dueMinuteOf = new WeakMap();
const immediate = new Set();
const dirty = new Set(); // players whose patches changed; rescheduled on the next tick
const tracked = new WeakSet();
const seedlingDue = new WeakMap();
// Only owners of depleted redwood spots need sub-minute checks.
const redwoodRegrowth = new Map();
// Players standing in a map square with patches nearby -> their last tile, so nearby patches
// follow them tile by tile without checking anyone who is nowhere near a patch.
const nearPatches = new Map();
let lastMinute = null;

function grow(player) {
    const farm = farmFor(player);
    const now = Date.now();
    if (player.getPacketSender().getVarbit(7925)) farm.hosidiusProtected = true;
    if (player.getPacketSender().getVarbit(4465)) farm.faladorProtected = true;
    if (player.getPacketSender().getVarp(4130) >= 16000) farm.fortisProtected = true;
    Model.advanceFarm(farm, now);
    seedlingDue.set(player, Services.growSeedlings(player, now));
    const bound = farm.patches[farm.boundPatch];
    const status = bound?.crop ? bound.status : "empty";
    if (farm.boundStatus !== status && ["diseased", "dead", "grown"].includes(status) && hasTool(player, "Amulet of Nature")) {
        player.sendMessage(`Your amulet of nature hums: the crop in your bound patch is ${status}.`);
    }
    farm.boundStatus = status;
}
const squareKey = (pos) => `${Math.floor(pos.getX() / 64)}:${Math.floor(pos.getY() / 64)}:${pos.getZ()}`;
/** Shows the nearest patch within 64 tiles for each varbit indexed around the player. */
function syncNearby(player) {
    const pos = player.getLocation();
    const nearest = new Map();
    for (const patch of PATCHES_BY_REGION.get(squareKey(pos)) ?? []) {
        const distance = Math.max(Math.abs((patch.x + patch.maxX) / 2 - pos.getX()), Math.abs((patch.y + patch.maxY) / 2 - pos.getY()));
        if (distance <= 64 && (!nearest.has(patch.varbit) || nearest.get(patch.varbit).distance > distance)) nearest.set(patch.varbit, { patch, distance });
    }
    for (const { patch } of nearest.values()) syncPatch(player, patch);
}
function unschedule(player) {
    const minute = dueMinuteOf.get(player);
    if (minute !== undefined) dueByMinute.get(minute)?.delete(player);
    dueMinuteOf.delete(player);
    immediate.delete(player);
}
function schedule(player) {
    unschedule(player);
    const now = Date.now();
    const due = Math.min(Model.nextDue(farmFor(player)), seedlingDue.get(player) ?? Infinity, now + SWEEP_MS);
    if (due <= now) { immediate.add(player); return; }
    const minute = Math.ceil(due / Model.MINUTE);
    let players = dueByMinute.get(minute);
    if (!players) dueByMinute.set(minute, players = new Set());
    players.add(player);
    dueMinuteOf.set(player, minute);
}
function refresh(player) {
    grow(player);
    syncNearby(player);
    schedule(player);
    dirty.delete(player);
    const redwood = Data.CACHE.patches.find(p => p.type === "REDWOOD");
    const due = Redwood.nextDue(farmFor(player).patches[Data.patchKey(redwood)] ?? {});
    if (due < Infinity) redwoodRegrowth.set(player, due);
    else redwoodRegrowth.delete(player);
}
function farmingTick() {
    workTick++;
    Geomancy.tick();
    for (const [player, due] of redwoodRegrowth) if (due <= Date.now()) refresh(player);
    for (const player of [...PENDING.keys()]) runPending(player);
    for (const [player, work] of WORK) workStep(player, work);
    for (const player of dirty) schedule(player);
    dirty.clear();
    for (const [player, tile] of nearPatches) {
        const pos = player.getLocation();
        const here = (pos.getZ() << 28) | (pos.getX() << 14) | pos.getY();
        if (here !== tile) { nearPatches.set(player, here); syncNearby(player); }
    }
    const minute = Math.floor(Date.now() / Model.MINUTE);
    lastMinute ??= minute;
    while (lastMinute < minute) {
        const due = dueByMinute.get(++lastMinute);
        if (!due) continue;
        dueByMinute.delete(lastMinute);
        for (const player of due) { dueMinuteOf.delete(player); immediate.add(player); }
    }
    if (immediate.size === 0) return;
    const batch = [...immediate];
    immediate.clear();
    for (const player of batch) refresh(player);
}
function startTicking() {
    class FarmingTask extends core.Task { execute() { farmingTick(); } }
    core.TaskManager.submit(new FarmingTask(1));
}
function followPatches(player) {
    if (PATCHES_BY_REGION.has(squareKey(player.getLocation()))) nearPatches.set(player, -1);
    else nearPatches.delete(player);
}
function mapSquareChanged({ player }) {
    if (tracked.has(player)) followPatches(player);
}
/** A seedling was just watered: grow it on time even if no patch is due sooner. */
/** Test hook: moves this player's farming clock `ms` forward, then grows as normal. */
function advanceTime(event) {
    const { player, ms } = event;
    if (!tracked.has(player)) return;
    for (const state of Object.values(farmFor(player).patches)) {
        if (Number.isFinite(state.nextAt)) state.nextAt -= ms;
        if (Number.isFinite(state.plantedAt)) state.plantedAt -= ms;
        if (state.redwoodBranches) state.redwoodBranches = state.redwoodBranches.map(at => at > 0 ? at - ms : 0);
    }
    for (const container of [player.getInventory(), ...player.getBanks()]) {
        for (const item of container?.getItems() ?? []) {
            const at = item?.getMetaValue?.("farming:sapling-at");
            if (at) item.setMetaValue("farming:sapling-at", at - ms);
        }
    }
    seedlingDue.delete(player);
    refresh(player);
    event.handledBy.push("Farming");
}
function noteSeedling(player, at) {
    if (!tracked.has(player) || !Number.isFinite(at)) return;
    seedlingDue.set(player, Math.min(seedlingDue.get(player) ?? Infinity, at));
    dirty.add(player);
}
function login(event) {
    const { player } = event;
    for (const state of Object.values(farmFor(player).patches)) state.hesporiFight = false;
    RENDERED.delete(player);
    if (player.isPlayerBot?.() === true) return;
    tracked.add(player);
    followPatches(player);
    refresh(player);
}
function logout({ player }) {
    Hespori.hesporiLogout({ player });
    runPending(player, true);
    redwoodRegrowth.delete(player);
    WORK.delete(player); RENDERED.delete(player);
    unschedule(player); tracked.delete(player); dirty.delete(player); nearPatches.delete(player); seedlingDue.delete(player);
}
function cancelWork({ player }) { WORK.delete(player); }

function pauseWork(event) {
    pauseForLevelUp(event, WORK, (player) => WORK.delete(player));
}

/** Every hook the Farming plugin attaches. */
function attach(api) {
    api.persistAttribute(FARM_ATTRIBUTE);
    api.onServerStartup(Data.initializeFarmingData);
    api.onServerStartup(startTicking);
    api.onPlayerLogin(login);
    api.onPlayerLogin(Tithe.titheLogin);
    api.onPlayerLogin(Rewards.login);
    api.onCanShop(Rewards.canShop);
    api.onPlayerMapSquareChange(mapSquareChanged);
    api.onPlayerLogout(logout);
    api.onPlayerLogout(Vault.logout);
    api.onInterfaceActionClick(Vault.click);
    api.onCustomEvent("player:widget-action", Vault.drag);
    api.onPlayerLogout(Geomancy.logout);
    api.onPlayerLogout(Tithe.titheLogout);
    api.onPlayerLogout(Rewards.logout);
    api.onPlayerLogout(Tools.logout);
    api.onCustomEvent("omnishop:currency", Rewards.currency);
    api.onCustomEvent("omnishop:describe", Rewards.describe);
    api.onCustomEvent("omnishop:can-buy", Rewards.canBuy);
    api.onCustomEvent("omnishop:purchase", Rewards.purchase);
    api.onCustomEvent("level-up:popup-opened", pauseWork);
    api.onObjectInteraction(objectInteraction);
    api.onInterfaceActionClick(farmingOptionClick);
    api.onItemOnObject(itemOnObject, { noted: false });
    api.onItemOnItem(itemOnItem);
    api.onNpcInteraction(npcInteraction);
    api.onItemOnNpc(itemOnNpc);
    api.onItemAction(Services.farmingItemAction);
    api.onItemAction(Guild.rewardItem);
    api.onItemAction(Guild.storageAction);
    api.onCustomEvent(core.Bank.INVENTORY_OP_EVENT, Guild.bankStorageOp);
    api.onSpellOnObject(spellOnObject);
    api.onButtonClick(Spells.farmingButton);
    api.onInterfaceActionClick(Tools.click);
    api.onInterfaceActionClick(Spells.farmingButton);
    api.onInterfaceActionClick(Geomancy.tab);
    api.onCustomEvent("woodcutting:validate-tree", validateTree);
    api.onCustomEvent("spirit-trees:grown", grownSpiritTrees);
    api.onCustomEvent("farming:check-health", Guild.completeContract);
    api.onCustomEvent("farming:harvest", Guild.harvestContract);
    api.onCustomEvent("farming:open-seed-vault", Guild.openSeedVault);
    api.onCustomEvent("woodcutting:deplete-tree", depleteTree);
    api.onCustomEvent("magic:water-containers", Services.waterContainers);
    api.onCustomEvent("farming:use-water", useWater);
    api.onCustomEvent("magic:humidified", Services.humidified);
    api.onCustomEvent("agent:advance-time", advanceTime);
    api.onCustomEvent("player:world-input", Hespori.hesporiInput);
    api.onCustomEvent("npc-dialogue:action", Hespori.reentryAction);
    api.onCustomEvent("interface:changed", Hespori.warningInterfaceChanged);
    api.onCustomEvent("player:world-input", cancelWork);
    api.onCustomEvent("npc-drops:generated", Hespori.hesporiLoot);
    api.onCustomEvent("hespori:quest-challenge", Hespori.challengeHespori);
    api.onCustomEvent("item-retrieval:items", retrievalItems);
    api.onCustomEvent("hespori:quest-process", Hespori.hesporiProcess);
    api.onCustomEvent("hespori:quest-can-attack", Hespori.hesporiCanAttack);
    api.onCustomEvent("hespori:quest-leave", Hespori.hesporiLogout);
    api.onNpcDeath(Hespori.questHesporiDeath);
    api.onCombatHitRoll(Hespori.hesporiHitRoll);
    api.onCombatHitResolved(Hespori.hesporiHit);
    api.onPlayerDealtDamage(Hespori.hesporiDamage);
    api.onPlayerDeathItemDrop(Hespori.hesporiDeathDrop);
    api.onPlayerDeath(Hespori.hesporiPlayerDeath);
    api.registerNpcCombatMethodProvider(core.NpcIdentifiers.HESPORI, Hespori.HesporiCombat, { singleton: false });
    api.registerNpcCombatMethodProvider(core.NpcIdentifiers.HESPORI_2, Hespori.HesporiCombat, { singleton: false });
}

Object.assign(module.exports, { FARM_ATTRIBUTE, SCARECROW_LEVEL, farmFor, hasLevel, stateFor, hasTool, requireTool, award, give, choose, clearPatch, syncPatch, nearPatch, water, fertilize, pourCompost, cure, noteSeedling, advanceTime, attach, tick: farmingTick, retrievalItems, startBinWork,
    startClear, after, spam, sound });
