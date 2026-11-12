/**
 * Some Wiki drop rows roll their shared table a variable number of times ("rolls" on the DropsLine, e.g. the
 * aberrant spectre's herb roll gives 1, 2 or 3 herbs at 11/26, 11/26 and 4/26). The dump carries them as
 * `roll_count_weights: [{ rolls, weight }]` on the row.
 */

/** The weights accepted by `pick`: a non-empty list of positive-integer `rolls` with positive-integer `weight`. */
function validRollCounts(weights) {
    return Array.isArray(weights) && weights.length > 0 && weights.every(entry =>
        Number.isSafeInteger(entry?.rolls) && entry.rolls >= 1 && Number.isSafeInteger(entry?.weight) && entry.weight >= 1);
}

/** How many times to roll: one weighted draw over `weights`; a row without (valid) weights rolls once. */
function pick(weights, randomInt) {
    if (!validRollCounts(weights)) return 1;
    let roll = randomInt(weights.reduce((sum, entry) => sum + entry.weight, 0));
    for (const entry of weights) {
        roll -= entry.weight;
        if (roll < 0) return entry.rolls;
    }
    return weights[weights.length - 1].rolls;
}

module.exports = { validRollCounts, pick };
