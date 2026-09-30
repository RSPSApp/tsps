/**
 * Growth engine: advances crops, rolls disease, regrows weeds and rots compost.
 *
 * Ported from Void's Farming.kt (GregHib/void, BSD-3). Void ticks each patch on a
 * shared minute with a per-type multiplier; here every patch stores the timestamp
 * of its next growth so offline growth is caught up on the next login.
 */
const { profileFor } = require("./farmingValues");

const MINUTE = 60_000;
const SAPLING_GROW_MS = 5 * MINUTE;
const COMPOST_ROT_MS = 60 * MINUTE;

const PATCH_CYCLE_MINUTES = Object.freeze({
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
});

function cycleMs(patch) {
    return (PATCH_CYCLE_MINUTES[patch.type] ?? 5) * MINUTE;
}

module.exports = function registerGrowth(api, patches, crops, state) {
    function process(player) {
        const now = Date.now();
        const all = player.getAttribute(state.STATE_ATTRIBUTE) ?? {};
        for (const [key, entry] of Object.entries(all)) {
            const patch = patches.BY_KEY.get(key);
            if (!patch) {
                continue;
            }
            const changed =
                patch.type === "COMPOST" ? processBin(patch, entry, now) : processPatch(player, patch, entry, now);
            if (changed) {
                state.refresh(player, patch, entry);
            }
        }
        growSaplings(player, now);
        state.refreshNearby(player, patches);
    }

    function processPatch(player, patch, entry, now) {
        const cycle = cycleMs(patch);
        let changed = false;
        if (entry.crop == null) {
            if (entry.w > 0) {
                if (!entry.wnext) {
                    entry.wnext = now + cycle;
                }
                while (now >= entry.wnext && entry.w > 0) {
                    entry.w -= 1;
                    entry.wnext += cycle;
                    changed = true;
                }
            }
        } else {
            while (entry.next > 0 && now >= entry.next) {
                changed = true;
                if (entry.d === 1) {
                    entry.d = 2;
                    entry.next = 0;
                    break;
                }
                if (entry.d === 2) {
                    entry.next = 0;
                    break;
                }
                const crop = crops.BY_PRODUCE.get(entry.crop);
                const profile = profileFor(patch.type, entry.crop);
                const lastGrowing = profile.stages - 1 - (profile.full ? 1 : 0);
                if (!entry.f && shouldDisease(patch, entry, crop)) {
                    entry.d = 1;
                    entry.next += cycle;
                    break;
                }
                if (!entry.f) {
                    if (entry.s < lastGrowing) {
                        entry.s += 1;
                    } else {
                        entry.f = true;
                    }
                }
                entry.wa = false;
                entry.next += cycle;
            }
            if (entry.f && entry.rg > 0 && now >= entry.rg) {
                entry.rg = 0;
                entry.h = 0;
                changed = true;
            }
        }
        return changed;
    }

    function shouldDisease(patch, entry, crop) {
        if (!crop || entry.wa || entry.d !== 0 || entry.pr) {
            return false;
        }
        if (entry.s === 0) {
            return false;
        }
        const chance = crop.disease ?? 0;
        if (chance <= 0) {
            return false;
        }
        let divisor = 1;
        if (entry.co === 1) divisor = 2;
        else if (entry.co >= 2) divisor = 5;
        return Math.floor(Math.random() * 128) < chance / divisor;
    }

    function processBin(patch, entry, now) {
        const bin = entry.bin;
        if (!bin || bin.state !== "rot" || now < (bin.readyAt ?? 0)) {
            return false;
        }
        bin.state = "ready";
        return true;
    }

    function growSaplings(player, now) {
        const inventory = player.getInventory();
        let hasWatered = false;
        for (const item of inventory.getItems()) {
            if (!item || item.getId() === -1) continue;
            if (crops.SAPLING_BY_WATERED.has(item.getId())) {
                hasWatered = true;
                break;
            }
        }
        if (!hasWatered) {
            player.setAttribute(state.SAPLING_ATTRIBUTE, 0);
            return;
        }
        const started = player.getAttribute(state.SAPLING_ATTRIBUTE);
        if (!started) {
            player.setAttribute(state.SAPLING_ATTRIBUTE, now);
            return;
        }
        if (now - started < SAPLING_GROW_MS) {
            return;
        }
        player.setAttribute(state.SAPLING_ATTRIBUTE, 0);
        const replacements = [];
        for (const item of inventory.getItems()) {
            if (!item || item.getId() === -1) continue;
            const sapling = crops.SAPLING_BY_WATERED.get(item.getId());
            if (!sapling) continue;
            replacements.push([item.getId(), sapling, item.getAmount()]);
        }
        for (const [seedling, sapling, amount] of replacements) {
            inventory.deleteNumber(seedling, amount);
            inventory.adds(sapling, amount);
        }
        if (replacements.length > 0) {
            player.sendMessage("The seedling has grown into a sapling.");
        }
    }

    api.onPlayerProcess(({ player }) => process(player));

    // Compost bins keep rotting while nobody is logged in next to them; the
    // timestamps above make that automatic on the next process tick.
    api.log("registered growth engine", {
        patchCycleMinutes: PATCH_CYCLE_MINUTES,
        compostRotMinutes: COMPOST_ROT_MS / MINUTE,
    });
};
