/** Generic source-described ordered pools. Persistence remains a plugin event contract. */
function validRate(rate) {
    return Number.isSafeInteger(rate?.weight) && Number.isSafeInteger(rate?.out_of) &&
        rate.weight > 0 && rate.weight <= rate.out_of;
}
function validKey(key) {
    return typeof key === 'string' && /^[a-z0-9][a-z0-9:_-]*$/i.test(key) && !['constructor', 'prototype', '__proto__'].includes(key);
}
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function validateState(state, stages) {
    if (!record(state))
        throw new Error('Invalid ordered reward state');
    for (const [key, value] of Object.entries(state)) {
        if (!validKey(key) || !(typeof value === 'boolean' || Number.isSafeInteger(value) && value >= 0))
            throw new Error('Invalid ordered reward state value');
    }
    for (const stage of stages) {
        for (const row of stage.entries) {
            const p = row.progression;
            if (p && state[p.state_key] !== undefined && (!Number.isSafeInteger(state[p.state_key]) || state[p.state_key] < 0 || state[p.state_key] >= p.hits))
                throw new Error('Invalid cyclic reward state');
        }
        for (const contract of [stage.eligibility, stage.record_first_received]) {
            if (contract && state[contract.state_key] !== undefined && typeof state[contract.state_key] !== 'boolean')
                throw new Error('Invalid first-receipt reward state');
        }
    }
}
function select(table, player, api, random = Math.random, multiplier = () => 1) {
    const chain = table.reward_chain;
    if (!chain)
        return { entry: null };
    if (chain.type !== 'ordered_exclusive' || !validKey(chain.state_domain) || !validKey(table.table_id) || !Array.isArray(chain.stages) || !chain.stages.length)
        throw new Error('Unsupported ordered reward chain');
    for (const stage of chain.stages) {
        if (!validRate(stage) || !Number.isSafeInteger(stage.main_max_roll) || stage.main_max_roll < 1 || !Array.isArray(stage.entries) || !stage.entries.length || stage.entries.some(row => !Number.isSafeInteger(row.weight) || row.weight < 1) || stage.entries.reduce((n, row) => n + row.weight, 0) !== stage.main_max_roll)
            throw new Error('Invalid ordered reward pool');
        if (stage.eligibility && (stage.eligibility.type !== 'until_first_received' || !validKey(stage.eligibility.state_key)))
            throw new Error('Unsupported reward eligibility');
        if (stage.record_first_received && !validKey(stage.record_first_received.state_key))
            throw new Error('Invalid receipt key');
        for (const row of stage.entries) {
            const p = row.progression;
            if (p && (p.type !== 'cyclic_hits' || !validKey(p.state_key) || !Number.isSafeInteger(p.hits) || p.hits < 2 || !Number.isSafeInteger(p.intermediate_item_id) || p.intermediate_item_id < 1 || !Array.isArray(p.intermediate_quantities) || p.intermediate_quantities.length !== p.hits - 1 || p.intermediate_quantities.some(n => !Number.isSafeInteger(n) || n < 1)))
                throw new Error('Unsupported reward progression');
        }
    }
    const request = { player, tableId: table.table_id, wikiPage: table.wiki_page, domain: chain.state_domain, state: null, handled: false };
    api?.emitCustomEvent('npc-drops:reward-state', request);
    if (!request.handled)
        throw new Error('Missing ordered reward state provider');
    validateState(request.state, chain.stages);
    const state = { ...request.state };
    for (const stage of chain.stages) {
        if (stage.eligibility && state[stage.eligibility.state_key] === true)
            continue;
        let rate = stage;
        const scaling = stage.source_scaling;
        if (scaling?.execution === 'documented_base_and_endpoint') {
            const endpoint = scaling.known_endpoint;
            if (!validRate(endpoint) || !Number.isSafeInteger(endpoint.kill_count) || endpoint.kill_count < 0 ||
                !stage.record_first_received || !Number.isSafeInteger(request.killCount) || request.killCount < 0 || !validRate(scaling.after_first_received))
                throw new Error('Invalid documented reward endpoint');
            if (state[stage.record_first_received.state_key] === true)
                rate = scaling.after_first_received;
            else if (request.killCount >= endpoint.kill_count)
                rate = endpoint;
        }
        if (random() * rate.out_of >= Math.min(rate.out_of, rate.weight * multiplier(rate, stage)))
            continue;
        let slot = Math.floor(random() * stage.main_max_roll);
        const selected = stage.entries.find(row => (slot -= row.weight) < 0);
        let entry = selected;
        if (selected.progression) {
            const p = selected.progression, progress = (state[p.state_key] ?? 0) + 1;
            state[p.state_key] = progress % p.hits;
            if (progress < p.hits)
                entry = { ...selected, item_id: p.intermediate_item_id, quantity: [p.intermediate_quantities[progress - 1], p.intermediate_quantities[progress - 1]], noted: false, bonus_drops: [], quantity_alternatives: undefined, quantity_raw: undefined };
        }
        if (stage.record_first_received)
            state[stage.record_first_received.state_key] = true;
        return { entry, commit() {
                const commit = { ...request, state, committed: false };
                api.emitCustomEvent('npc-drops:reward-state-commit', commit);
                if (!commit.committed)
                    throw new Error('Ordered reward state commit rejected');
            } };
    }
    return { entry: null };
}
function group(entries, multiplier, random = Math.random) {
    let base = 0;
    const chances = entries.map(row => {
        if (!validRate(row))
            throw new Error('Invalid exclusive tertiary rate');
        base += row.weight / row.out_of;
        const chance = row.weight / row.out_of * multiplier(row);
        if (!Number.isFinite(chance) || chance < 0)
            throw new Error('Invalid tertiary multiplier');
        return chance;
    });
    if (base > 1)
        throw new Error('Exclusive tertiary probabilities exceed one');
    // Boosts can guarantee one outcome; preserve their relative weights and exclusivity.
    let roll = random() * Math.max(1, chances.reduce((a, b) => a + b, 0));
    for (let i = 0; i < entries.length; i++) {
        roll -= chances[i];
        if (roll < 0)
            return entries[i];
    }
    return null;
}
module.exports = { select, group, validKey, record };
