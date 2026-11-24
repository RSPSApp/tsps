import { BONUSES, NPC_STATS, SKILLS, newProject } from './project.mjs';

// All edits use the existing project schema. UI snapshots belong to state.gameData.
export const ELEMENTS = [[0, 'None'], [1, 'Air (wind)'], [2, 'Water'], [3, 'Earth'], [4, 'Fire']];
export const DROP_LIMIT = 150;
const MAX_WEIGHT = 1000000, MAX_STACK = 2147483647;
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const gcd = (a, b) => b ? gcd(b, a % b) : a;
export const human = key => key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
export const title = key => String(key).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
export const ticksText = ticks => `${ticks} ticks (${Number((ticks * .6).toFixed(1))} seconds)`;
export const quantityText = row => row.min === row.max ? row.min.toLocaleString('en') : `${row.min.toLocaleString('en')} to ${row.max.toLocaleString('en')}`;
export function chanceText(chance) {
    if (chance === 1) return 'Every kill (100%)';
    if (!(chance > 0)) return 'Never';
    const inverse = 1 / chance, denominator = Math.round(inverse);
    const percent = (chance * 100).toLocaleString('en', { maximumSignificantDigits: 5 });
    if (chance > .5) return `${percent}% of kills`;
    return `${Math.abs(inverse - denominator) < .000001 ? '' : 'About '}1 in ${Math.max(1, denominator).toLocaleString('en')} (${percent}%)`;
}
export function analyseDrops(drops) {
    const errors = [], warnings = [], rows = drops?.rows ?? [];
    if (!['none', 'borrow', 'custom'].includes(drops?.mode)) errors.push('Choose a drop table mode.');
    if (drops?.mode === 'borrow' && !integer(drops.sourceId, 0, 65022)) errors.push('Choose a creature to borrow drops from.');
    // Unused custom rows are still saved and validated by validateProject.
    if (!integer(drops?.emptyWeight, 0, MAX_WEIGHT)) errors.push('The nothing chance must use 0 to 1,000,000 shares.');
    if (!Array.isArray(rows) || rows.length > DROP_LIMIT) errors.push(`Keep at most ${DROP_LIMIT} drops.`);
    const seen = new Set();
    for (const [i, row] of (Array.isArray(rows) ? rows : []).entries()) {
        const label = `Drop ${i + 1}`;
        if (!integer(row.itemId, 0, 65022)) errors.push(`${label}: choose an item.`);
        if (!integer(row.min, 1, MAX_STACK) || !integer(row.max, row.min, MAX_STACK)) errors.push(`${label}: quantities must be whole numbers from 1 to ${MAX_STACK.toLocaleString('en')}, with maximum at least minimum.`);
        if (!integer(row.weight, 0, MAX_WEIGHT)) errors.push(`${label}: use 0 to 1,000,000 shares.`);
        if (seen.has(row.itemId)) warnings.push(`${label} repeats an item. Its quantities can combine with a guaranteed drop.`);
        seen.add(row.itemId);
    }
    const total = (Number.isFinite(drops?.emptyWeight) ? drops.emptyWeight : 0) + (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (row.weight > 0 ? row.weight : 0), 0);
    const entries = (Array.isArray(rows) ? rows : []).map((row, index) => {
        const guaranteed = row.weight === 0, chance = guaranteed ? 1 : total > 0 ? row.weight / total : 0;
        return { ...row, index, guaranteed, chance, expected: (row.min + row.max) / 2 * chance };
    });
    return { errors, warnings, total, entries, guaranteed: entries.filter(row => row.guaranteed), weighted: entries.filter(row => !row.guaranteed), emptyChance: total > 0 ? drops.emptyWeight / total : 1 };
}

// Set one probability exactly using integer shares, preserving the ratios of all
// other weighted outcomes. Zero remains reserved for guaranteed drops.
export function setDropChance(drops, index, percent) {
    const row = drops.rows[index];
    if (!row || row.weight === 0) throw new Error('Choose a weighted drop first.');
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100 || Math.abs(percent * 100 - Math.round(percent * 100)) > .000001) throw new Error('Use a chance above 0%, up to 100%, with at most two decimal places.');
    const copy = structuredClone(drops), numerator = Math.round(percent * 100), denominator = 10000 - numerator;
    const others = copy.rows.filter((_, i) => i !== index && copy.rows[i].weight > 0);
    const otherTotal = others.reduce((sum, r) => sum + r.weight, copy.emptyWeight);
    if (!denominator) {
        if (others.length) throw new Error('Other weighted drops need a chance too. Remove them or choose less than 100%.');
        copy.emptyWeight = 0; copy.rows[index].weight = 1; return copy;
    }
    if (!otherTotal) {
        const divisor = gcd(numerator, denominator);
        copy.rows[index].weight = numerator / divisor; copy.emptyWeight = denominator / divisor;
    } else {
        const divisor = gcd(numerator * otherTotal, denominator);
        const scale = denominator / divisor;
        copy.rows[index].weight = numerator * otherTotal / divisor;
        for (const other of others) other.weight *= scale;
        copy.emptyWeight *= scale;
        const common = [...copy.rows.filter(r => r.weight > 0).map(r => r.weight), copy.emptyWeight].reduce((a, b) => gcd(a, b), 0) || 1;
        copy.rows.forEach(r => { if (r.weight > 0) r.weight /= common; }); copy.emptyWeight /= common;
    }
    if ([copy.emptyWeight, ...copy.rows.map(r => r.weight)].some(n => !integer(n, 0, MAX_WEIGHT))) throw new Error('That exact chance needs too many shares. Use a simpler percentage or edit shares in Advanced.');
    return copy;
}
export function sampleDrops(drops, count = 10, random = Math.random) {
    const analysis = analyseDrops(drops);
    if (drops.mode !== 'custom' || analysis.errors.length) throw new Error(analysis.errors[0] ?? 'Choose a custom drop table.');
    const next = () => { const v = random(); if (!(v >= 0 && v < 1)) throw new Error('Invalid random sample.'); return v; };
    const amount = row => row.min + Math.floor(next() * (row.max - row.min + 1));
    return Array.from({ length: Math.max(1, Math.min(50, Math.floor(count))) }, () => {
        const result = analysis.guaranteed.map(row => ({ itemId: row.itemId, amount: amount(row) }));
        let roll = next() * analysis.total;
        for (const row of analysis.weighted) {
            roll -= row.weight;
            if (roll < 0) { result.push({ itemId: row.itemId, amount: amount(row) }); break; }
        }
        return result;
    });
}
export const STAT_GROUPS = {
    npc: [ ['Levels', [0, 1, 2, 3, 4]], ['Accuracy bonuses', [5, 7, 9]], ['Defence bonuses', [10, 11, 12, 13, 14]] ],
    gear: [ ['Attack bonuses', [0, 1, 2, 3, 4]], ['Defence bonuses', [5, 6, 7, 8, 9]], ['Strength and prayer', [10, 11, 12, 13]] ]
};
export const GAMEPLAY_GROUPS = {
    npc: {
        combat: ['combatLevel', 'hitpoints', 'maxHit', 'attackSpeed', 'attackType', 'stats', 'attackable'],
        behaviour: ['size', 'aggressive', 'poisonous', 'venomous', 'immunePoison', 'immuneVenom', 'freezeResistance', 'deathTicks', 'respawn', 'walkRadius', 'huntRange', 'projectileId', 'launchGraphicId', 'deathSound', 'elementalWeaknessType', 'elementalWeaknessPercent']
    },
    gear: {
        equipment: ['equipmentType', 'weaponInterface', 'doubleHanded', 'attackSpeed'],
        bonuses: ['bonuses'], requirements: ['requirements'],
        value: ['value', 'highAlch', 'lowAlch', 'stackable', 'tradeable', 'dropable', 'sellable'],
        special: ['specialFrom', 'specialEnergy']
    }
};
export function templateGameplay(source, kind) {
    const project = newProject('template', kind, { ...source, mesh: source.mesh ?? { vertices: [], faces: [] }, warnings: [] }, { definition: 50000, modelBase: 1000000 }, '');
    return { settings: structuredClone(project.settings), examine: project.examine, members: project.members };
}
export function copyGameplayGroup(project, template, group) {
    if (group === 'about') { project.examine = template.examine; project.members = template.members; return; }
    const keys = GAMEPLAY_GROUPS[project.kind]?.[group];
    if (!keys) throw new Error('Choose a gameplay group to copy.');
    for (const key of keys) project.settings[key] = structuredClone(template.settings[key]);
}
export function compareGameplay(project, template, group) {
    const keys = group === 'about' ? ['examine', 'members'] : GAMEPLAY_GROUPS[project.kind]?.[group] ?? [];
    const current = group === 'about' ? project : project.settings, base = group === 'about' ? template : template.settings;
    return keys.filter(key => JSON.stringify(current[key]) !== JSON.stringify(base[key])).flatMap(key => {
        const labels = key === 'requirements' ? SKILLS : key === 'bonuses' ? BONUSES : key === 'stats' ? NPC_STATS : null;
        if (labels) return labels.flatMap((label, i) => label !== 'Unused' && current[key][i] !== base[key][i] ? [{ key, index: i, label, current: current[key][i], template: base[key][i] }] : []);
        return [{ key, label: human(key), current: current[key], template: base[key] }];
    });
}
export const CREATURE_PRESETS = [
    { id: 'peaceful', label: 'Peaceful', values: { attackable: false, aggressive: false, maxHit: 0 } },
    { id: 'melee', label: 'Melee fighter', values: { attackable: true, attackType: 'MELEE', hitpoints: 30, maxHit: 4, attackSpeed: 4, combatLevel: 20 }, levels: [20, 20, 15, 1, 1] },
    { id: 'ranged', label: 'Ranged fighter', values: { attackable: true, attackType: 'RANGED', hitpoints: 25, maxHit: 4, attackSpeed: 5, combatLevel: 20 }, levels: [1, 1, 10, 25, 1] },
    { id: 'magic', label: 'Magic fighter', values: { attackable: true, attackType: 'MAGIC', hitpoints: 25, maxHit: 5, attackSpeed: 5, combatLevel: 20 }, levels: [1, 1, 10, 1, 25] }
];
export function applyCreaturePreset(project, id) {
    const preset = CREATURE_PRESETS.find(row => row.id === id);
    if (project.kind !== 'npc' || !preset) throw new Error('Choose a creature preset.');
    Object.assign(project.settings, preset.values);
    preset.levels?.forEach((value, index) => project.settings.stats[index] = value);
}
export function activeRequirements(settings) {
    return SKILLS.flatMap((name, index) => settings.requirements[index] > 0 ? [{ name, index, level: settings.requirements[index] }] : []);
}
export function statSummary(project) {
    const s = project.settings;
    if (project.kind === 'npc') return [ ['Combat', s.combatLevel], ['Hitpoints', s.hitpoints], ['Max hit', s.maxHit], ['Attack interval', `${Number((s.attackSpeed * .6).toFixed(1))} sec`] ];
    const indexes = [0, 1, 2, 3, 4], best = indexes.reduce((a, b) => s.bonuses[b] > s.bonuses[a] ? b : a, 0);
    return [ ['Slot', title(s.equipmentType)], ['Best attack', `${BONUSES[best].replace(' attack', '')} ${s.bonuses[best] >= 0 ? '+' : ''}${s.bonuses[best]}`], ['Prayer', `${s.bonuses[13] >= 0 ? '+' : ''}${s.bonuses[13]}`], ['Value', `${s.value.toLocaleString('en')} gp`] ];
}
export function gameplayWarnings(project) {
    const s = project.settings, warnings = [];
    if (project.kind === 'npc') {
        if (!s.attackable && s.aggressive) warnings.push('Aggressive is enabled on a creature players cannot attack.');
        if (s.attackType !== 'MELEE' && s.projectileId < 0) warnings.push('No projectile override. TSPS uses its normal combat defaults.');
        if (s.elementalWeaknessType > 0 && !s.elementalWeaknessPercent) warnings.push('The elemental weakness has a 0% bonus and is inactive.');
        if (s.poisonous && s.venomous) warnings.push('Both poison and venom are enabled. Check which effect you intend.');
    } else {
        if (s.doubleHanded && s.equipmentType !== 'WEAPON') warnings.push('Two-handed is enabled outside the weapon slot.');
        if (s.specialFrom >= 0 && s.equipmentType !== 'WEAPON') warnings.push('A special attack needs a weapon slot to be usable.');
        if (s.highAlch > s.value) warnings.push('High alchemy gives more coins than the item value.');
        if (s.lowAlch > s.highAlch) warnings.push('Low alchemy gives more coins than high alchemy.');
        if (s.equipmentType === 'NONE' && activeRequirements(s).length) warnings.push('Wear requirements are set on an item that cannot be equipped.');
        if (activeRequirements(s).some(row => row.level > 99)) warnings.push('A requirement exceeds level 99. TSPS accepts levels up to 126.');
    }
    return warnings;
}
