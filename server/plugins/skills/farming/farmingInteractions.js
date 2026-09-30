/**
 * Farming interactions: patch object options, seeds, tools, compost bins and
 * plant pots. Behaviour ported from Void (GregHib/void, BSD-3).
 *
 * Click routing: the base patch objects are unnamed in the cache and the client
 * swaps their model from the transmit varbit, so every patch shares one primary
 * option per state (Rake/Harvest/Check-health/Cure/Clear/Pick). Op2/Op3 are the
 * inspect/guide pair and just describe the patch.
 */
const { profileFor } = require("./farmingValues");

const MINUTE = 60_000;

function patchCycleMs(patch) {
    const CYCLE_MINUTES = {
        FLOWER: 5,
        ALLOTMENT: 10,
        HOPS: 10,
        HERB: 20,
        BUSH: 20,
        TREE: 40,
        MUSHROOM: 40,
        BELLADONNA: 80,
        CACTUS: 80,
        FRUIT_TREE: 160,
        CALQUAT: 160,
        SPIRIT_TREE: 320,
        COMPOST: 2,
    };
    return (CYCLE_MINUTES[patch.type] ?? 5) * MINUTE;
}

module.exports = function registerInteractions(api, patches, crops, state) {
    const { Animation, ItemIdentifiers, Skill, Sound, Sounds } = api.core;
    const I = ItemIdentifiers;

    const ANIMATION = {
        rake: () => new Animation(2273),
        water: () => new Animation(2293),
        dib: () => new Animation(2291),
        spade: () => new Animation(830),
        pick: () => new Animation(2282),
        cure: () => new Animation(2288),
        prune: () => new Animation(2275),
        fill: () => new Animation(2272),
        check: () => new Animation(832),
    };

    // Order matters: index 0 is a full can (8), the last is empty.
    const WATERING_CANS = [
        I.WATERING_CAN_8_, I.WATERING_CAN_7_, I.WATERING_CAN_6_, I.WATERING_CAN_5_,
        I.WATERING_CAN_4_, I.WATERING_CAN_3_, I.WATERING_CAN_2_, I.WATERING_CAN_1_,
        I.WATERING_CAN_2,
    ];
    const WATER_SOURCE = /fountain|water pump|pump|sink|well|barrel|water/i;

    const level = (player) => player.getSkillManager().getCurrentLevel(Skill.FARMING);
    const xp = (player, amount) => {
        if (amount > 0) {
            player.getSkillManager().addExperiences(Skill.FARMING, amount);
        }
    };
    const inventory = (player) => player.getInventory();
    const has = (player, id) => inventory(player).contains(id);
    const take = (player, id, amount = 1) => inventory(player).deleteNumber(id, amount);
    const give = (player, id, amount = 1) => inventory(player).adds(id, amount);

    function entryOf(player, patch) {
        const entry = state.entryFor(player, patch);
        if (!entry.crop && entry.w == null) entry.w = 0;
        return entry;
    }

    function emptyPatch(entry) {
        entry.crop = null;
        entry.s = 0;
        entry.f = false;
        entry.c = false;
        entry.d = 0;
        entry.wa = false;
        entry.h = 0;
        entry.l = 0;
        entry.rg = 0;
        entry.next = 0;
        entry.w = 3;
        entry.wnext = Date.now() + 20 * MINUTE;
    }

    function livesFor(crop, entry) {
        let lives = 3;
        if (entry.co === 1) lives += 1;
        else if (entry.co >= 2) lives += 2;
        return lives;
    }

    // ---------------------------------------------------------------- object clicks

    function onObjectClick(event) {
        const patch = patches.findPatch(event.objectId, event.object.getLocation());
        if (!patch) {
            return;
        }
        event.handled = true;
        const player = event.player;
        const entry = entryOf(player, patch);
        if (patch.type === "COMPOST") {
            if (event.clickType === 1) {
                compostBinOption(player, patch, entry);
            } else {
                player.sendMessage("You can fill the compost bin with weeds and farming produce.");
            }
            return;
        }
        if (event.clickType === 1) {
            primaryAction(player, patch, entry);
        } else {
            inspect(player, patch, entry);
        }
    }

    function primaryAction(player, patch, entry) {
        const crop = entry.crop ? crops.BY_PRODUCE.get(entry.crop) : null;
        if (!crop) {
            if (entry.w < 3) {
                rake(player, patch, entry);
            } else {
                inspect(player, patch, entry);
            }
            return;
        }
        if (entry.d === 1) {
            if (crop.kind === "tree" || crop.kind === "spirit") {
                player.sendMessage("To cure trees you need to prune the diseased leaves with secateurs.");
            } else {
                player.sendMessage("This crop is diseased. Use a plant cure on it.");
            }
            return;
        }
        if (entry.d === 2) {
            clear(player, patch, entry, crop);
            return;
        }
        if (!entry.f) {
            inspect(player, patch, entry);
            return;
        }
        if (!entry.c && crop.checkXp) {
            checkHealth(player, patch, entry, crop);
            return;
        }
        if (crop.kind === "tree" || crop.kind === "spirit") {
            clear(player, patch, entry, crop);
            return;
        }
        harvest(player, patch, entry, crop);
    }

    function rake(player, patch, entry) {
        if (!has(player, I.RAKE)) {
            player.sendMessage("You need a rake to weed the patch.");
            return;
        }
        player.performAnimation(ANIMATION.rake());
        entry.w = 3;
        entry.wnext = Date.now() + patchCycleMs(patch);
        give(player, I.WEEDS, 3);
        xp(player, 24);
        player.sendMessage("You rake the weeds from the patch.");
        state.save(player, patch, entry);
        state.refresh(player, patch, entry);
    }

    function plant(player, patch, entry, crop, plantedItem) {
        if (entry.crop != null) {
            player.sendMessage("There is already something growing in this patch.");
            return;
        }
        if (entry.w < 3) {
            player.sendMessage("This patch needs weeding first.");
            return;
        }
        if (crop.patch !== patch.type) {
            player.sendMessage(`You can only plant ${crop.name} in a ${crop.patch.toLowerCase().replace(/_/g, " ")} patch.`);
            return;
        }
        if (level(player) < crop.level) {
            player.sendMessage(`You need a Farming level of ${crop.level} to plant that.`);
            return;
        }
        const tree = crop.kind === "tree" || crop.kind === "fruit" || crop.kind === "spirit";
        const tool = tree ? I.SPADE : I.SEED_DIBBER;
        if (!has(player, tool)) {
            player.sendMessage(tree ? "You need a spade to plant that." : "You need a seed dibber to plant that.");
            return;
        }
        if (!take(player, plantedItem, 1)) {
            player.sendMessage("You don't have that seed.");
            return;
        }
        emptyPatch(entry);
        entry.crop = crop.produce;
        entry.s = 0;
        entry.co = entry.co ?? 0;
        entry.l = livesFor(crop, entry);
        entry.next = Date.now() + patchCycleMs(patch);
        entry.wnext = 0;
        player.performAnimation(tree ? ANIMATION.spade() : ANIMATION.dib());
        xp(player, crop.plantXp);
        player.sendMessage(`You plant the ${crop.name} in the patch.`);
        state.save(player, patch, entry);
        state.refresh(player, patch, entry);
    }

    function checkHealth(player, patch, entry, crop) {
        entry.c = true;
        entry.h = 0;
        xp(player, crop.checkXp);
        player.performAnimation(ANIMATION.check());
        player.sendMessage(`You examine the ${crop.name} and find it in perfect health.`);
        state.save(player, patch, entry);
        state.refresh(player, patch, entry);
    }

    function harvest(player, patch, entry, crop) {
        if (!crop.product) {
            return;
        }
        if (inventory(player).full()) {
            player.sendMessage("Your inventory is full.");
            return;
        }
        const profile = profileFor(patch.type, crop.produce);
        give(player, crop.product, crop.amount ?? 1);
        xp(player, crop.harvestXp ?? 0);
        player.performAnimation(ANIMATION.pick());
        player.sendMessage(`You harvest the ${crop.name}.`);
        const regrows = crop.kind === "bush" || crop.kind === "fruit" || crop.kind === "cactus";
        if (crop.single) {
            emptyPatch(entry);
            player.sendMessage("The patch is now empty.");
        } else {
            entry.h = Math.min((entry.h ?? 0) + 1, profile.harvestMax);
            if (regrows) {
                if (entry.h >= profile.harvestMax) {
                    entry.rg = Date.now() + patchCycleMs(patch);
                }
            } else {
                entry.l = (entry.l ?? livesFor(crop, entry)) - 1;
                if (entry.l <= 0) {
                    emptyPatch(entry);
                    player.sendMessage("The patch is now empty.");
                }
            }
        }
        state.save(player, patch, entry);
        state.refresh(player, patch, entry);
    }

    function clear(player, patch, entry, crop) {
        if (crop?.roots && !inventory(player).full()) {
            give(player, crop.roots, 1);
        }
        player.performAnimation(ANIMATION.spade());
        player.sendMessage(`You clear the ${crop?.name ?? "patch"} from the patch.`);
        const compost = entry.co;
        emptyPatch(entry);
        entry.co = compost;
        state.save(player, patch, entry);
        state.refresh(player, patch, entry);
    }

    function cure(player, patch, entry, crop, item = I.PLANT_CURE) {
        if (!has(player, item)) {
            player.sendMessage("You need a plant cure to cure the disease on this patch.");
            return;
        }
        take(player, item, 1);
        if (item === I.PLANT_CURE) {
            give(player, I.VIAL, 1);
        }
        entry.d = 0;
        entry.next = Date.now() + patchCycleMs(patch);
        player.performAnimation(ANIMATION.cure());
        player.sendMessage("You treat the patch. It is restored to health.");
        state.save(player, patch, entry);
        state.refresh(player, patch, entry);
    }

    function prune(player, patch, entry) {
        entry.d = 0;
        entry.next = Date.now() + patchCycleMs(patch);
        player.performAnimation(ANIMATION.prune());
        Sounds.sendSound(player, new Sound(2581, 1, 0, 0));
        player.sendMessage("You have successfully pruned the diseased leaves.");
        state.save(player, patch, entry);
        state.refresh(player, patch, entry);
    }

    function water(player, patch, entry) {
        if (!entry.crop) {
            player.sendMessage("There is nothing to water in this patch.");
            return;
        }
        if (entry.wa) {
            player.sendMessage("This patch has already been watered.");
            return;
        }
        const slot = WATERING_CANS.findIndex((id) => has(player, id));
        if (slot === -1) {
            player.sendMessage("You need a watering can to water the patch.");
            return;
        }
        if (slot === WATERING_CANS.length - 1) {
            player.sendMessage("You need to fill your watering can first.");
            return;
        }
        take(player, WATERING_CANS[slot], 1);
        give(player, WATERING_CANS[slot + 1], 1);
        entry.wa = true;
        player.performAnimation(ANIMATION.water());
        player.sendMessage("You water the patch.");
        state.save(player, patch, entry);
        state.refresh(player, patch, entry);
    }

    function inspect(player, patch, entry) {
        const crop = entry.crop ? crops.BY_PRODUCE.get(entry.crop) : null;
        if (!crop) {
            if (entry.w < 3) {
                player.sendMessage("This patch is overgrown with weeds.");
            } else {
                player.sendMessage("This patch is empty.");
            }
            return;
        }
        if (entry.d === 1) {
            player.sendMessage(`The ${crop.name} is diseased.`);
        } else if (entry.d === 2) {
            player.sendMessage(`The ${crop.name} has died.`);
        } else if (entry.f) {
            player.sendMessage(`The ${crop.name} is fully grown.`);
        } else {
            const stage = entry.s + 1;
            player.sendMessage(`The ${crop.name} is growing (stage ${stage}).`);
        }
    }

    function compostBinOption(player, patch, entry) {
        const bin = entry.bin;
        if (!bin || bin.fill <= 0) {
            player.sendMessage("The compost bin is empty.");
            return;
        }
        if (bin.state === "ready") {
            if (!has(player, I.BUCKET)) {
                player.sendMessage("You need a bucket to empty the compost bin.");
                return;
            }
            take(player, I.BUCKET, 1);
            give(player, bin.kind === "SUPERCOMPOST" ? I.SUPERCOMPOST : I.COMPOST, 1);
            bin.taken = (bin.taken ?? 0) + 1;
            player.performAnimation(ANIMATION.fill());
            player.sendMessage(`You fill a bucket with ${bin.kind === "SUPERCOMPOST" ? "supercompost" : "compost"}.`);
            if (bin.taken >= Math.min(bin.fill, 15)) {
                entry.bin = null;
                player.sendMessage("The compost bin is now empty.");
            }
        } else if (bin.state === "rot") {
            player.sendMessage("The contents of the bin are still rotting.");
        } else {
            bin.state = "rot";
            bin.readyAt = Date.now() + 60 * MINUTE;
            player.sendMessage("You close the compost bin.");
        }
        state.save(player, patch, entry);
        state.refresh(player, patch, entry);
    }

    // ------------------------------------------------------------ item on object

    function onItemOnObject(event) {
        const player = event.player;
        if (WATERING_CANS.includes(event.itemId)) {
            const objectName = event.object.getDefinition()?.getName() ?? "";
            if (WATER_SOURCE.test(objectName) && !patches.findPatch(event.objectId, event.object.getLocation())) {
                take(player, event.itemId, 1);
                give(player, WATERING_CANS[0], 1);
                player.sendMessage("You fill the watering can.");
                event.handled = true;
                return;
            }
        }
        const patch = patches.findPatch(event.objectId, event.object.getLocation());
        if (!patch) {
            return;
        }
        const entry = entryOf(player, patch);
        if (patch.type === "COMPOST") {
            compostBinItem(player, patch, entry, event);
            return;
        }
        const crop = entry.crop ? crops.BY_PRODUCE.get(entry.crop) : null;
        if (event.itemId === I.RAKE) {
            event.handled = true;
            if (crop) {
                player.sendMessage("You can't rake a patch that has something growing in it.");
            } else {
                rake(player, patch, entry);
            }
            return;
        }
        if (event.itemId === I.COMPOST || event.itemId === I.SUPERCOMPOST) {
            if (crop) {
                player.sendMessage("You can't treat a patch that has something growing in it.");
                return;
            }
            if (entry.co > 0) {
                player.sendMessage("This patch has already been treated.");
                return;
            }
            take(player, event.itemId, 1);
            if (event.itemId === I.COMPOST) {
                give(player, I.BUCKET, 1);
                entry.co = 1;
                player.sendMessage("You treat the patch with compost.");
            } else {
                give(player, I.BUCKET, 1);
                entry.co = 2;
                player.sendMessage("You treat the patch with supercompost.");
            }
            event.handled = true;
            state.save(player, patch, entry);
            state.refresh(player, patch, entry);
            return;
        }
        if (event.itemId === I.PLANT_CURE) {
            event.handled = true;
            const treeLike = crop && (crop.kind === "tree" || crop.kind === "fruit" || crop.kind === "spirit" || crop.kind === "cactus");
            if (crop && entry.d === 1 && treeLike) {
                player.sendMessage("To cure trees you need to prune the diseased leaves with secateurs.");
            } else if (crop && entry.d === 1) {
                cure(player, patch, entry, crop, I.PLANT_CURE);
            } else {
                player.sendMessage("This patch doesn't need curing.");
            }
            return;
        }
        if (event.itemId === I.SECATEURS || event.itemId === I.MAGIC_SECATEURS) {
            event.handled = true;
            if (crop && entry.d === 1 && (crop.kind === "tree" || crop.kind === "fruit" || crop.kind === "spirit" || crop.kind === "cactus")) {
                prune(player, patch, entry);
            } else {
                player.sendMessage("There is nothing to prune here.");
            }
            return;
        }
        if (event.itemId === I.SPADE) {
            event.handled = true;
            if (crop) {
                clear(player, patch, entry, crop);
            } else {
                player.sendMessage("This patch is empty.");
            }
            return;
        }
        if (WATERING_CANS.includes(event.itemId)) {
            event.handled = true;
            water(player, patch, entry);
            return;
        }
        if (event.itemId === I.EMPTY_PLANT_POT) {
            event.handled = true;
            fillPlantPot(player, patch, entry);
            return;
        }
        const planted = crops.BY_PLANT.get(event.itemId);
        if (planted || crops.BY_SEED.get(event.itemId)) {
            const potted = crops.POTTED_BY_SEED.get(event.itemId);
            if (potted && !planted) {
                player.sendMessage("Plant the seed in a plant pot first.");
                return;
            }
            event.handled = true;
            plant(player, patch, entry, planted, event.itemId);
        }
    }

    function compostBinItem(player, patch, entry, event) {
        const bin = entry.bin;
        if (event.itemId === I.BUCKET && bin && bin.state === "ready") {
            event.handled = true;
            compostBinOption(player, patch, entry);
            return;
        }
        const superItem = crops.SUPERCOMPOST_ITEMS.has(event.itemId);
        const compostable = superItem || crops.COMPOSTABLE_ITEMS.has(event.itemId);
        if (!compostable) {
            return;
        }
        if (!bin) {
            entry.bin = { fill: 0, kind: superItem ? "SUPERCOMPOST" : "COMPOST", state: "open", taken: 0 };
        }
        const current = entry.bin;
        if (current.state !== "open" || current.fill >= 15) {
            player.sendMessage("You can't add anything else to the compost bin right now.");
            event.handled = true;
            return;
        }
        event.handled = true;
        take(player, event.itemId, 1);
        if (superItem) {
            current.kind = "SUPERCOMPOST";
        }
        current.fill += 1;
        if (current.fill === 15) {
            current.state = "rot";
            current.readyAt = Date.now() + 60 * MINUTE;
            player.sendMessage("You close the compost bin.");
        } else {
            player.sendMessage("You put the item in the compost bin.");
        }
        state.save(player, patch, entry);
        state.refresh(player, patch, entry);
    }

    function fillPlantPot(player, patch, entry) {
        if (entry.crop || entry.w < 3) {
            player.sendMessage("You need a cleared patch to fill a plant pot.");
            return;
        }
        if (!has(player, I.GARDENING_TROWEL)) {
            player.sendMessage("You need a gardening trowel to do that.");
            return;
        }
        if (!take(player, I.EMPTY_PLANT_POT, 1)) {
            return;
        }
        give(player, I.FILLED_PLANT_POT, 1);
        player.performAnimation(ANIMATION.fill());
        player.sendMessage("You fill the plant pot with soil.");
    }

    // -------------------------------------------------------------- item on item

    function onItemOnItem(event) {
        const player = event.player;
        const first = event.usedItemId;
        const second = event.usedWithItemId;
        const seed = crops.POTTED_BY_SEED.get(first) ? first : crops.POTTED_BY_SEED.get(second) ? second : null;
        const pot = first === I.FILLED_PLANT_POT || second === I.FILLED_PLANT_POT;
        if (seed !== null && pot) {
            event.handled = true;
            potSeed(player, seed);
            return;
        }
        const can = WATERING_CANS.find((id) => id === first || id === second);
        const seedlingId = first === can ? second : first;
        const watered = crops.WATERED_BY_SEEDLING.get(seedlingId);
        if (can !== undefined && watered) {
            event.handled = true;
            const slot = WATERING_CANS.indexOf(can);
            if (slot === WATERING_CANS.length - 1) {
                player.sendMessage("You need to fill your watering can first.");
                return;
            }
            take(player, can, 1);
            give(player, WATERING_CANS[slot + 1], 1);
            take(player, seedlingId, 1);
            give(player, watered, 1);
            player.sendMessage("You water the seedling.");
        }
    }

    function potSeed(player, seedId) {
        const potted = crops.POTTED_BY_SEED.get(seedId);
        if (!has(player, I.GARDENING_TROWEL)) {
            player.sendMessage("You need a gardening trowel to sow the seed.");
            return;
        }
        if (!take(player, seedId, 1) || !take(player, I.FILLED_PLANT_POT, 1)) {
            return;
        }
        give(player, potted.seedling, 1);
        player.sendMessage("You sow the seed in the plant pot. It needs watering before it will grow.");
    }

    // ------------------------------------------------------------------- wiring

    api.onObjectInteraction(onObjectClick);
    api.onItemOnObject(onItemOnObject);
    api.onItemOnItem(onItemOnItem);

    api.log("registered interactions", {
        patches: patches.PATCHES.length,
        crops: crops.CROPS.length,
        wateringCans: WATERING_CANS.length,
    });
};
