/**
 * Runtime helpers over the generated patch value tables (farmingPatchValues.js).
 *
 * The tables list, for each patch type, the varbit value ranges the OSRS cache uses
 * to pick a patch object model (crop, growth stage, disease, dead, harvest stage).
 * Profiles are derived once per crop: how many growing stages it has, which value
 * shows it fully grown, and the ranges used for harvest/disease/death.
 */
const TABLES = require("./farmingPatchValues");

const profileCache = new Map();

function splitExpr(range) {
    const [kind, amount] = range.stage.split(":");
    return { kind, amount: Number(amount) };
}

function valueForStageExpr(range, stage) {
    const { kind, amount } = splitExpr(range);
    if (kind === "const") {
        return amount === stage ? range.from : null;
    }
    if (kind === "value-minus") {
        const value = amount + stage;
        return value >= range.from && value <= range.to ? value : null;
    }
    if (kind === "minus-value") {
        const value = amount - stage;
        return value >= range.from && value <= range.to ? value : null;
    }
    return null;
}

function stagesInRange(range) {
    const { kind, amount } = splitExpr(range);
    if (kind === "const") return 1;
    if (kind === "value-minus") return range.to - amount + 1;
    if (kind === "minus-value") return amount - range.from + 1;
    return 0;
}

/** Candidate value for a stage across a set of ranges, else the first value in the set. */
function valueFromRanges(ranges, stage) {
    for (const range of ranges) {
        const value = valueForStageExpr(range, stage);
        if (value !== null) {
            return value;
        }
    }
    return ranges.length > 0 ? ranges[0].from : null;
}

/**
 * Growing ranges split into runs. The tables list a crop's dry stages first and,
 * when the crop can be watered, a second run of watered models after it.
 */
function growingRuns(type, produce) {
    const ranges = (TABLES[type] ?? []).filter(
        (range) => range.produce === produce && range.state === "GROWING" && range.stage !== "stages-1",
    );
    const runs = [];
    for (const range of ranges) {
        const current = runs[runs.length - 1];
        if (!current || range.from > current[current.length - 1].to) {
            runs.push([range]);
        } else {
            current.push(range);
        }
    }
    return runs;
}

function profileFor(type, produce) {
    const key = `${type}:${produce}`;
    if (profileCache.has(key)) {
        return profileCache.get(key);
    }
    const ranges = (TABLES[type] ?? []).filter((range) => range.produce === produce);
    const growing = ranges.filter((range) => range.state === "GROWING");
    const harvest = ranges.filter((range) => range.state === "HARVESTABLE");
    const runs = growingRuns(type, produce);
    const dry = runs[0] ?? [];
    const full = growing.find((range) => range.stage === "stages-1") ?? null;
    const harvestPrimary = harvest.find((range) => range.stage !== "const:0") ?? harvest[0] ?? null;
    const harvestEmpty = harvest.find((range) => range !== harvestPrimary && range.stage === "const:0") ?? null;
    const profile = {
        stages: dry.reduce((total, range) => total + stagesInRange(range), 0) + (full ? 1 : 0),
        growing: dry,
        watered: runs.length > 1 ? runs.slice(1).flat() : null,
        full,
        harvest: harvestPrimary,
        harvestMax: harvestPrimary ? Math.max(0, stagesInRange(harvestPrimary) - 1) : 0,
        harvestEmptyValue: harvestEmpty ? harvestEmpty.from : null,
        diseased: ranges.filter((range) => range.state === "DISEASED"),
        dead: ranges.filter((range) => range.state === "DEAD"),
    };
    profileCache.set(key, profile);
    return profile;
}

function clampWeeds(weeds) {
    if (!Number.isFinite(weeds)) return 3;
    return Math.max(0, Math.min(3, weeds));
}

/** The varbit value the client needs to render this patch state. */
function displayValue(type, state) {
    if (!state || state.crop == null) {
        return clampWeeds(state ? state.w : 3);
    }
    const profile = profileFor(type, state.crop);
    if (state.d === 2) {
        // Dead herbs all share one generic "Dead herbs" model range.
        const dead = profile.dead.length > 0 ? profile.dead : profileFor(type, "ANYHERB").dead;
        return valueFromRanges(dead, Math.max(1, state.s)) ?? clampWeeds(3);
    }
    if (state.d === 1) {
        return valueFromRanges(profile.diseased, Math.max(1, state.s)) ?? clampWeeds(3);
    }
    if (!state.f) {
        const runs = state.wa && profile.watered ? profile.watered : profile.growing;
        const value = valueFromRanges(runs, state.s);
        return value ?? clampWeeds(3);
    }
    if (!state.c && profile.full) {
        return profile.full.from;
    }
    if (!profile.harvest && profile.full) {
        return profile.full.from;
    }
    if (profile.harvest) {
        const value = valueForStageExpr(profile.harvest, Math.min(state.h ?? 0, profile.harvestMax));
        if (value !== null) {
            return value;
        }
    }
    if (profile.harvestEmptyValue !== null) {
        return profile.harvestEmptyValue;
    }
    return clampWeeds(3);
}

module.exports = {
    profileFor,
    displayValue,
    clampWeeds,
};
