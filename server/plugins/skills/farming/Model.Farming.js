const Data = require("./Data.Farming");
const Redwood = require("./Redwood.Farming");

const MINUTE = 60_000;
function advanceTithe(plant, now) {
    while (!plant.dead && plant.stage < 3 && plant.nextAt <= now) {
        if (!plant.watered) { plant.dead = true; break; }
        plant.stage++;
        plant.watered = false;
        plant.nextAt += plant.fertilized ? 30_000 : MINUTE;
    }
}
function titheDeposit(score, amount, harvestXp) {
    const count = Math.min(amount, 100 - score);
    let xp = 0, bonus = 0, points = 0;
    for (let i = score + 1; i <= score + count; i++) {
        xp += harvestXp * (i >= 75 ? 20 : 10);
        if (i % 3 === 0) points++;
        if (i === 75) bonus = harvestXp * 250;
        if (i === 100) points += 2;
    }
    return { count, score: (score + count) % 100, xp, bonus, points };
}
const EPOCH = Date.UTC(2025, 5, 9); // Day 1 of the wiki's four-day growth schedule.
const GROWTH_TICK = Data.FORMULAS.growth.tickMinutes * MINUTE;
function nextGrowth(now, minutes, offset) {
    const period = minutes * MINUTE;
    return EPOCH + (Math.floor((now - EPOCH + offset) / period) + 1) * period - offset;
}
/** The five-minute growth tick a timestamp belongs to, from the same epoch and player offset. */
function tickIndex(at, offset) {
    return Math.floor((at - EPOCH + offset) / GROWTH_TICK);
}
function emptyPatch(now, farm, weeds = 0) {
    return { stage: 0, weeds, compost: 0, watered: false, status: "growing", checked: false,
        protected: false, lives: 0, plantExperiencePending: false,
        nextAt: nextGrowth(now, Data.FORMULAS.growth.tickMinutes, farm.offset), plantedAt: now };
}
function startingLives(crop, compost) {
    if (Data.COMPOSTABLE_YIELD.has(crop.type)) return 3 + compost;
    if (crop.type === "CORAL") return 6;
    if (crop.type === "GRAPES") return 5;
    return Math.max(1, crop.lives);
}
function diseaseChance(crop, compost, watered, iasor) {
    const { disease } = Data.FORMULAS;
    // The published numerator already includes the zero roll, so modifiers apply to the
    // rolls above zero and the final +1 restores it.
    let rolls = Data.diseaseNumerator(crop) - 1;
    if (watered) rolls = Math.floor(rolls * disease.wateredMultiplier);
    rolls = Math.floor(rolls * disease.compostMultipliers[compost]);
    if (iasor) rolls = Math.floor(rolls * disease.iasorMultiplier);
    return (rolls + 1) / disease.denominator;
}

const HERB_LOW = { GUAM: 25, MARRENTILL: 28, TARROMIN: 31, HARRALANDER: 36, GOUTWEED: 39,
    RANARR: 39, TOADFLAX: 43, IRIT: 46, AVANTOE: 50, KWUARM: 54, SNAPDRAGON: 57, HUASCA: 59,
    CADANTINE: 60, LANTADYME: 64, DWARF_WEED: 67, TORSTOL: 71 };
// Low/high life-save parameters published by the corresponding seed Wiki calculators.
const TEXTILE_HOP_CTS = { FLAX: [140, 194], HEMP: [120, 178], COTTON: [82, 142] };
const CROP_LOW = { POTATO: 101, ONION: 105, CABBAGE: 107, TOMATO: 112, SWEETCORN: 88, STRAWBERRY: 103,
    BARLEY: 103, HAMMERSTONE: 104, ASGARNIAN: 108, KRANDORIAN: 121, WILDBLOOD: 128 };
// Post-August-2026 low/high parameters published by each frag's Wiki yield calculator.
const CORAL_CTS = { ELKHORN_CORAL: [85, 182], PILLAR_CORAL: [25, 180], UMBRAL_CORAL: [-50, 178] };
function saveLifeChance(crop, level, secateurs = false, cape = false, diary = 0, attas = false) {
    let low, high;
    if (crop.type === "HERB") { low = HERB_LOW[crop.key]; high = 80; }
    else if (CORAL_CTS[crop.key]) { [low, high] = CORAL_CTS[crop.key]; }
    else if (crop.type === "SEAWEED") { low = 150; high = 210; }
    else if (crop.key === "CACTUS") { low = -76; high = 178; }
    else if (crop.key === "GRAPE") { low = -50; high = 180; }
    else if (crop.key === "SNAPE_GRASS") { low = 148; high = 195; }
    else if (crop.key === "WATERMELON") { low = 126; high = 180; }
    else if (crop.key === "YANILLIAN") { low = 116; high = 180; }
    else if (crop.key === "JUTE") { low = 113; high = 180; }
    else if (TEXTILE_HOP_CTS[crop.key]) { [low, high] = TEXTILE_HOP_CTS[crop.key]; }
    else if (CROP_LOW[crop.key]) { low = CROP_LOW[crop.key]; high = 180; }
    else {
        // ponytail: unpublished CTS endpoints, estimated from wiki yields; not claimed as exact OSRS rates.
        [low, high] = crop.type === "ALLOTMENT" || crop.type === "HOPS" ? [100, 180]
            : crop.type === "BUSH" || crop.key === "POTATO_CACTUS" ? [90, 190] : [25, 80];
    }
    const { yield: rates } = Data.FORMULAS;
    const items = (secateurs && ["ALLOTMENT", "HERB", "HOPS", "GRAPES", "BUSH", "CELASTRUS", "CORAL"].includes(crop.type) ? rates.secateursMultiplier : 0)
        + (cape && crop.type === "HERB" ? rates.farmingCapeMultiplier : 0);
    const boost = (value) => Math.floor((Math.floor(value * (1 + items)) + diary) * (attas ? 1 + rates.attasMultiplier : 1));
    level = Math.max(1, Math.min(99, level));
    const chance = (1 + Math.floor((boost(low) * (99 - level) + boost(high) * (level - 1)) / 98 + 0.5)) / rates.denominator;
    return Math.max(0, Math.min((rates.denominator - 1) / rates.denominator, chance));
}
function activeAnima(farm, at) {
    return Object.values(farm.patches).find(s => s.crop && Data.CACHE.timing[s.crop]?.type === "ANIMA"
        && at >= s.plantedAt && at < s.nextAt + (8 - s.stage - 1) * 640 * MINUTE && s.status !== "dead")?.crop;
}
function kronosGrowth(farm, at, minutes, random, skips) {
    if (activeAnima(farm, at) !== "KRONOS") return 1;
    const key = `${at}:${minutes}`;
    if (!skips.has(key)) {
        let extra = 0;
        while (extra < Data.FORMULAS.kronosMaxStageSkips && random() < Data.FORMULAS.kronosStageSkipChance) extra++;
        skips.set(key, extra);
    }
    return 1 + skips.get(key);
}
function diseaseFree(farm, patch, state, at) {
    const crop = Data.CROPS.get(state.crop);
    if (state.protected || state.diseaseFree || ["POISON_IVY", "HESPORI", "CRYSTAL_TREE"].includes(crop.key) || ["ANIMA", "GRAPES"].includes(crop.type)) return true;
    // Troll Stronghold and Weiss use the same herb growth states, with permanent immunity.
    if (crop.type === "HERB" && ((patch.x >= 2800 && patch.x <= 2840 && patch.y >= 3670 && patch.y <= 3710)
        || (patch.x >= 2830 && patch.x <= 2870 && patch.y >= 3920 && patch.y <= 3950))) return true;
    if (farm.hosidiusProtected && patch.x >= 1720 && patch.x <= 1760 && patch.y >= 3540 && patch.y <= 3565) return true;
    if (farm.faladorProtected && patch.type === "TREE" && patch.x === 3003 && patch.y === 3372) return true;
    if (farm.fortisProtected && patch.type === "HERB" && patch.x === 1581 && patch.y === 3094) return true;
    // Harmony Island's diary unlock grants a permanently disease-free herb patch.
    if (patch.type === "HERB" && patch.x === 3789 && patch.y === 2837 && patch.z === 0) return true;
    if (crop.type !== "ALLOTMENT") return false;
    for (const flower of Data.CACHE.patches.filter(p => p.type === "FLOWER" && p.z === patch.z && Math.abs(p.x - patch.x) < 32 && Math.abs(p.y - patch.y) < 32)) {
        const s = farm.patches[Data.patchKey(flower)];
        if (!s || s.plantedAt > at) continue;
        if (s.scarecrow && crop.key === "SWEETCORN") return true;
        if (s.status !== "grown") continue;
        if (s.crop === "WHITE_LILY" || (s.crop === "MARIGOLD" && ["POTATO", "ONION", "TOMATO"].includes(crop.key))
            || (s.crop === "ROSEMARY" && crop.key === "CABBAGE") || (s.crop === "NASTURTIUM" && crop.key === "WATERMELON")) return true;
    }
    return false;
}

/** Process crop events in time order, so offline flower/anima protection has the same lifetime as online. */
// Patch definitions by patchKey, so a farm is walked by the patches it has state for rather
// than by every patch in the game - most players have a handful, or none.
const PATCH_BY_KEY = new Map(Data.CACHE.patches.map((patch) => [Data.patchKey(patch), patch]));

function* patchStates(farm) {
    for (const key in farm.patches) {
        const patch = PATCH_BY_KEY.get(key);
        if (patch) yield { patch, state: farm.patches[key] };
    }
}

/**
 * The stage a healthy crop has reached `tick` growth ticks after `plantedTick`.
 * Unlike the live state this ignores disease, so it only describes the wiki schedule.
 */
function stageAt(crop, plantedTick, tick) {
    let stage = 0, at = plantedTick;
    while (stage < crop.stages && at < tick) {
        // Growth ticks are aligned to the cycle's own five-minute grid, not counted from
        // the previous stage, so a yew's 5-minute first stage rejoins the 40-minute grid.
        const cycle = Data.stageMinutes(crop, stage) / Data.FORMULAS.growth.tickMinutes;
        const next = (Math.floor(at / cycle) + 1) * cycle;
        if (next > tick) break;
        at = next;
        stage++;
    }
    return stage;
}

/** Whether advanceFarm still has growth to apply to this planted state. */
function growing(state) {
    // An undying crop's disease waits for a cure ("farming:plant-rules").
    if (!state?.crop || state.status === "dead" || (state.status === "diseased" && state.undying)) return false;
    return !(state.status === "grown" && !Data.CROPS.get(state.crop)?.regrow && !state.stump);
}
/** Whether advanceFarm still regrows weeds on this unplanted state. */
function weeding(farm, patch, state) {
    return !!state && !["GRAPES", "CORAL"].includes(patch.type)
        && !(state.crop || state.scarecrow || state.bin || farm.autoWeed) && state.weeds < 3;
}
/** When advanceFarm next has something to do for this farm, or Infinity. */
function nextDue(farm) {
    let due = Infinity;
    for (const { patch, state } of patchStates(farm)) {
        if (state.crop === "REDWOOD") due = Math.min(due, Redwood.nextDue(state));
        if (growing(state) || weeding(farm, patch, state)) due = Math.min(due, state.nextAt);
    }
    return due;
}

function advanceFarm(farm, now, random = Math.random, onMature = null) {
    for (const { state } of patchStates(farm)) if (state.crop === "REDWOOD") Redwood.advance(state, now);
    const kronos = new Map();
    const planted = [];
    const matured = [];
    for (const entry of patchStates(farm)) if (growing(entry.state)) planted.push(entry);
    for (;;) {
        let due;
        for (const entry of planted) {
            const { state } = entry;
            const crop = Data.CROPS.get(state.crop);
            if (state.status === "dead" || (state.status === "diseased" && state.undying) || (state.status === "grown" && !crop.regrow && !state.stump)) continue;
            if (state.nextAt <= now && (!due || state.nextAt < due.state.nextAt)) due = entry;
        }
        if (!due) break;
        const { patch, state } = due;
        const crop = Data.CROPS.get(state.crop);
        const at = state.nextAt;
        if (state.status === "grown") {
            if (state.stump) { state.stump = false; continue; }
            const maximum = startingLives(crop, state.compost);
            // Partial patches need chronological rolls, including anima planting and expiry.
            // Once full, skip empty work in bulk; at most the produce cap needs individual ticks.
            const ticks = state.lives >= maximum ? 1 + Math.floor((now - at) / (crop.regrow * MINUTE)) : 1;
            if (state.lives < maximum) state.lives = Math.min(maximum,
                state.lives + kronosGrowth(farm, at, crop.regrow, random, kronos));
            state.nextAt = at + ticks * crop.regrow * MINUTE;
            continue;
        }
        if (state.status === "diseased") { state.status = "dead"; continue; }
        const growth = crop.type === "ANIMA" ? 1 : kronosGrowth(farm, at, crop.minutes, random, kronos);
        // Kronos skips still visit every stage and stop at the first disease roll that succeeds.
        for (let step = 0; step < growth && state.status === "growing"; step++) {
            state.stage = Math.min(crop.stages, state.stage + 1);
            if (crop.type === "ANIMA") {
                if (state.stage >= crop.stages) state.status = "dead";
            } else if (state.stage >= crop.stages) {
                state.status = "grown";
                state.lives = startingLives(crop, state.compost);
                if (onMature) matured.push({ patch, state, at });
            } else if (Data.CACHE.states[crop.type][crop.key].DISEASED?.[state.stage] != null
                && state.stage < crop.stages - (crop.type === "FRUIT_TREE" ? 1 : 0)
                && !diseaseFree(farm, patch, state, at)
                && random() < diseaseChance(crop, state.compost, state.watered, activeAnima(farm, at) === "IASOR")) {
                state.status = "diseased";
            }
            state.watered = false;

        }
        state.nextAt = nextGrowth(at, state.status === "diseased" ? Data.diseasedMinutes(crop)
            : state.status === "grown" && crop.regrow ? crop.regrow : Data.stageMinutes(crop, state.stage), farm.offset);
    }
    for (const { patch, state } of patchStates(farm)) {
        if (!state || ["GRAPES", "CORAL"].includes(patch.type)) continue;
        if (state.crop || state.scarecrow || state.bin || farm.autoWeed) continue;
        if (state.nextAt <= now) {
            state.weeds = Math.min(3, state.weeds + 1 + Math.floor((now - state.nextAt) / (Data.FORMULAS.growth.tickMinutes * MINUTE)));
            state.nextAt = nextGrowth(now, Data.FORMULAS.growth.tickMinutes, farm.offset);
        }
    }
    for (const entry of matured) onMature(entry.patch, entry.state, entry.at);
}

function patchValue(patch, state) {
    const states = Data.CACHE.states[patch.type];
    if (state.scarecrow) return states.SCARECROW?.GROWING?.[3] ?? 36;
    if (!state.crop) return patch.type === "GRAPES" ? (state.compost ? 1 : 0) : (states.WEEDS?.GROWING?.[state.weeds] ?? 0);
    const crop = Data.CROPS.get(state.crop);
    const visual = states[state.crop];
    if (crop.type === "HESPORI" && state.status === "grown") return state.hesporiLoot ? 8 : state.hesporiFight ? 9 : 7;
    if (crop.type === "CELASTRUS" && state.stump) return 28;
    if (crop.type === "CELASTRUS" && state.status === "grown" && state.checked && !state.lives) return 17;
    // The cache distinguishes these actions even though RuneLite coalesces their timer states.
    if (crop.type === "SPIRIT_TREE" && state.status === "grown") return state.checked ? 20 : 44;
    if (crop.type === "GRAPES" && state.status === "grown" && state.checked) return 15 - Math.max(1, Math.min(5, state.lives));
    if (crop.type === "REDWOOD" && state.status === "grown" && state.checked) return Redwood.value(state);
    if (state.stump) return visual.STUMP?.[0] ?? visual.HARVESTABLE?.[0];
    if (crop.type === "GRAPES" && state.status === "dead") return 15;
    if (state.status === "dead") return (visual.DEAD ?? states.ANYHERB?.DEAD)?.[Math.max(1, state.stage)] ?? visual.GROWING[crop.stages];
    if (state.status === "diseased") return visual.DISEASED?.[state.stage] ?? visual.GROWING[state.stage];
    if (state.status === "grown") {
        if (crop.check && !state.checked) return visual.GROWING[crop.stages];
        const harvest = visual.HARVESTABLE;
        if (!harvest) return visual.GROWING[crop.stages];
        return harvest[Math.min(harvest.length - 1, Math.max(0, state.lives - (crop.regrow ? 0 : 1)))] ?? harvest[0];
    }
    return (state.watered ? visual.WATERED?.[state.stage] : undefined) ?? visual.GROWING[state.stage];
}

Object.assign(module.exports, { MINUTE, advanceTithe, titheDeposit, nextGrowth, tickIndex, stageAt, emptyPatch, startingLives, diseaseChance, saveLifeChance, activeAnima, advanceFarm, diseaseFree, nextDue, patchValue });
