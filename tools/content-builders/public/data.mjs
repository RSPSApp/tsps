import { createGearEffectsTab } from '/gear-effects.mjs';
import { BONUSES, GEAR_NUMBERS, NPC_NUMBERS, NPC_STATS, SKILLS, SLOTS } from '/shared/project.mjs';
import { ELEMENTS, DROP_LIMIT, STAT_GROUPS, GAMEPLAY_GROUPS, CREATURE_PRESETS, activeRequirements, analyseDrops, applyCreaturePreset, chanceText, compareGameplay, copyGameplayGroup, gameplayWarnings, human, quantityText, sampleDrops, setDropChance, statSummary, templateGameplay, ticksText, title } from '/shared/data.mjs';
import { referencePicker, referencePicture } from '/picker.mjs';

// Compatibility with the existing app. The parent may wire the factory's tools
// pane as well; neither entry point creates a second editor or owns the project.
export function dataControls(ctx) { return createGameDataTab(ctx).renderProperties; }
export function createGameDataTab(ctx) {
    const { state, element: el, button, api, change, status } = ctx;
    const effects = createGearEffectsTab(ctx);
    const names = new Map(), templates = new Map();
    let target, toolsTarget;
    function ui() {
        const key = `${state.project?.id}/${state.project?.baseId}/${state.project?.kind}`;
        if (state.gameData?.key !== key) state.gameData = { key, sections: {}, dropIndex: 0, requirement: '0', templateId: state.project?.baseId, templateGroup: state.project?.kind === 'npc' ? 'combat' : 'equipment' };
        return state.gameData;
    }
    const note = (parent, text, error = false) => parent.append(el('p', { class: `note${error ? ' data-warning' : ''}`, text }));
    const refresh = () => { if (ctx.render) ctx.render(); else { if (target?.isConnected) renderProperties(target); if (toolsTarget?.isConnected) renderTools(toolsTarget); } };
    const attempt = fn => { try { return fn(); } catch (error) { status(error.message, true); } };
    function block(parent, label, key, open = false) {
        const local = ui(), area = el('details', { class: 'property-section data-block', open: local.sections[key] ?? open }, el('summary', { text: label }));
        area.dataset.dataSection = key;
        area.addEventListener('toggle', () => { if (area.isConnected) local.sections[key] = area.open; });
        parent.append(area); return area;
    }
    function grid(parent) { const node = el('div', { class: 'fields data-fields' }); parent.append(node); return node; }
    function select(parent, label, value, values, set, transient = false) {
        const input = el('select', { 'aria-label': label }, ...values.map(([id, name]) => el('option', { value: id, text: name, selected: String(id) === String(value) })));
        input.onchange = () => attempt(() => transient ? (set(input.value), refresh()) : change(() => set(input.value)));
        parent.append(el('label', {}, label, input)); return input;
    }
    function number(parent, label, value, set, options = {}) {
        const { min = 0, max = 10000, step = 1, suffix } = options;
        const input = el('input', { type: 'number', value, min, max, step, 'aria-label': label });
        input.onchange = () => attempt(() => {
            const v = input.value.trim() === '' ? NaN : Number(input.value);
            const valid = Number.isFinite(v) && v >= min && v <= max && (step !== 1 || Number.isInteger(v));
            if (!valid) { const message = `${label}: enter ${step === 1 ? 'a whole number' : 'a number'} from ${min} to ${max}.`; input.setCustomValidity(message); input.reportValidity?.(); throw new Error(message); }
            input.setCustomValidity(''); change(() => set(v));
        });
        input.oninput = () => input.setCustomValidity('');
        parent.append(el('label', {}, label, input, suffix ? el('small', { class: 'data-unit', text: suffix }) : null));
        return input;
    }
    function flag(parent, label, value, set) {
        const input = el('input', { type: 'checkbox', checked: value, onChange: () => change(() => set(input.checked)) });
        parent.append(el('label', { class: 'check' }, input, label));
    }
    function picker(parent, label, kind, value, set, options = {}) { return referencePicker(ctx, parent, label, kind, value, set, options); }
    function itemName(id, node, prefix = '') {
        if (!names.has(id)) {
            names.set(id, api(`search?kind=item&q=${id}&references=1`).then(result => result.rows.find(row => row.id === id)?.name ?? `Unresolved item ${id}`).catch(() => `Unresolved item ${id}`));
            if (names.size > 160) names.delete(names.keys().next().value);
        }
        names.get(id).then(name => { if (node.isConnected) node.textContent = prefix + name.replace(/_/g, ' '); });
    }
    function equipmentChanged() {
        state.reference = null;
        if (ctx.onEquipmentChange) ctx.onEquipmentChange();
        else if (ctx.updateReference) Promise.resolve(ctx.updateReference()).then(() => ctx.renderView?.()).catch(error => status(error.message, true));
    }
    function summary(parent) {
        const p = state.project, list = el('dl', { class: 'data-summary', 'aria-label': `${p.kind === 'npc' ? 'Creature' : 'Equipment'} summary` });
        for (const [label, value] of statSummary(p)) list.append(el('div', {}, el('dt', { text: label }), el('dd', { text: String(value) })));
        parent.append(list);
        for (const text of gameplayWarnings(p)) note(parent, text, true);
    }
    function jump(key) {
        const section = target?.querySelector(`[data-data-section="${key}"]`);
        if (section) { section.open = true; ui().sections[key] = true; section.scrollIntoView?.({ block: 'start', behavior: 'auto' }); section.querySelector('input,select,button')?.focus({ preventScroll: true }); }
    }
    function renderTools(parent) {
        toolsTarget = parent; parent.replaceChildren(); if (!state.project) return;
        const root = el('div', { class: 'game-data-tools' }); parent.append(root);
        root.append(el('h2', { text: 'Game data' })); summary(root);
        const nav = el('nav', { class: 'data-jumps', 'aria-label': 'Gameplay sections' }); root.append(nav);
        const rows = state.project.kind === 'npc' ? [['drops', 'Drops'], ['combat', 'Combat'], ['behaviour', 'Behaviour'], ['stats', 'Levels and bonuses'], ['templates', 'Copy or reset']] : [['equipment', 'Equipment slot'], ['bonuses', 'Bonuses'], ['requirements', 'Requirements'], ['special', 'Special attack'], ['value', 'Value and restrictions'], ['templates', 'Copy or reset']];
        for (const [key, label] of rows) nav.append(button(label, () => jump(key)));
        if (state.project.kind === 'npc') {
            const a = analyseDrops(state.project.drops);
            if (state.project.drops.mode === 'custom') {
                root.append(el('h3', { text: 'On each kill' }));
                note(root, `${a.guaranteed.length} guaranteed ${a.guaranteed.length === 1 ? 'item' : 'items'}, then one weighted roll.`);
                note(root, `Weighted roll gives nothing: ${chanceText(a.emptyChance)}.`);
                if (!a.errors.length) root.append(button('Try 10 kills', () => tryDrops()));
            }
        }
        note(root, 'Set gameplay here. Create movements in Animate.');
    }
    function renderProperties(parent) {
        target = parent; parent.replaceChildren(); if (!state.project) return;
        ui(); const root = el('div', { class: 'game-data' }); parent.append(root);
        summary(root);
        if (state.project.kind === 'npc') { renderDrops(root); renderCombat(root); renderBehaviour(root); renderStats(root); }
        else { renderEquipment(root); renderStats(root); renderRequirements(root); renderSpecial(root); renderValue(root); }
        renderAbout(root); renderTemplates(root); renderTechnical(root);
    }
    function renderAbout(parent) {
        const p = state.project, area = block(parent, 'Examine and membership', 'about');
        const input = el('textarea', { value: p.examine, maxLength: 1000, 'aria-label': 'Examine text' });
        input.onchange = () => change(() => p.examine = input.value);
        area.append(el('label', {}, 'Examine text', input));
        flag(area, 'Members only', p.members, v => p.members = v);
    }
    function renderCombat(parent) {
        const s = state.project.settings, area = block(parent, 'Combat', 'combat', true), fields = grid(area);
        select(fields, 'Attack style', s.attackType, [['MELEE', 'Melee'], ['RANGED', 'Ranged'], ['MAGIC', 'Magic']], v => s.attackType = v);
        for (const key of ['combatLevel', 'hitpoints', 'maxHit', 'attackSpeed']) number(fields, key === 'attackSpeed' ? 'Attack interval (ticks)' : human(key), s[key], v => s[key] = v, { min: NPC_NUMBERS[key][0], max: NPC_NUMBERS[key][1], suffix: key === 'attackSpeed' ? ticksText(s[key]) : undefined });
        flag(area, 'Players can attack', s.attackable, v => s.attackable = v);
        const presets = block(area, 'Combat starting points', 'presets');
        note(presets, 'Examples replace combat basics and levels. Keep your model, movements, drops and defence bonuses.');
        const actions = el('div', { class: 'actions data-wrap' }); presets.append(actions);
        for (const preset of CREATURE_PRESETS) actions.append(button(preset.label, () => change(() => applyCreaturePreset(state.project, preset.id))));
    }
    function renderBehaviour(parent) {
        const s = state.project.settings, area = block(parent, 'Behaviour and weaknesses', 'behaviour'), fields = grid(area);
        const labels = { size: 'Footprint (tiles)', walkRadius: 'Wander radius (tiles)', huntRange: 'Hunt range (tiles)', deathTicks: 'Death delay (ticks)', respawn: 'Respawn delay (ticks)', freezeResistance: 'Freeze resistance (%)' };
        for (const [key, label] of Object.entries(labels)) number(fields, label, s[key], v => s[key] = v, { min: NPC_NUMBERS[key][0], max: NPC_NUMBERS[key][1], suffix: key === 'deathTicks' || key === 'respawn' ? ticksText(s[key]) : undefined });
        flag(area, 'Attacks players first', s.aggressive, v => s.aggressive = v);
        const effects = grid(area);
        for (const [key, label] of [['poisonous', 'Inflicts poison'], ['venomous', 'Inflicts venom'], ['immunePoison', 'Immune to poison'], ['immuneVenom', 'Immune to venom']]) flag(effects, label, s[key], v => s[key] = v);
        select(area, 'Weak against', s.elementalWeaknessType, ELEMENTS, v => { s.elementalWeaknessType = Number(v); if (Number(v) && !s.elementalWeaknessPercent) s.elementalWeaknessPercent = 50; });
        if (s.elementalWeaknessType) number(area, 'Elemental weakness bonus (%)', s.elementalWeaknessPercent, v => s.elementalWeaknessPercent = v, { max: 1000 });
        const effectsArea = block(area, 'Combat effects and sound', 'effects');
        picker(effectsArea, 'Projectile', 'effect', s.projectileId, v => s.projectileId = v, { noneLabel: 'Use TSPS default projectile', visual: false });
        picker(effectsArea, 'Launch effect', 'effect', s.launchGraphicId, v => s.launchGraphicId = v, { noneLabel: 'No launch effect override', visual: false });
        picker(effectsArea, 'Death sound', 'sound', s.deathSound, v => s.deathSound = v, { noneLabel: 'Use captured/default sound', visual: false });
        note(effectsArea, 'These are gameplay references. Author poses and movement in Animate.');
    }
    function renderStats(parent) {
        const p = state.project, isNpc = p.kind === 'npc', values = isNpc ? p.settings.stats : p.settings.bonuses;
        const area = block(parent, isNpc ? 'Levels and bonuses' : 'Equipment bonuses', isNpc ? 'stats' : 'bonuses', !isNpc);
        for (const [label, indexes] of STAT_GROUPS[p.kind]) {
            area.append(el('h3', { text: label }));
            const fields = grid(area), names = isNpc ? NPC_STATS : BONUSES;
            for (const i of indexes) {
                const field = el('div', { class: 'data-stat' }); fields.append(field);
                number(field, names[i], values[i], v => values[i] = v, { min: -10000, max: 10000, step: !isNpc && i === 12 ? .1 : 1 });
                // A signed bar shows direction only; numeric values remain authoritative.
                const bar = el('div', { class: 'data-stat-bar', 'aria-hidden': 'true' });
                bar.append(el('span', { class: values[i] < 0 ? 'negative' : '', style: `width:${Math.min(50, Math.abs(values[i]) / 2)}%;${values[i] < 0 ? 'right:50%' : 'left:50%'}` })); field.append(bar);
            }
        }
    }
    function renderEquipment(parent) {
        const s = state.project.settings, area = block(parent, 'Equipment slot', 'equipment', true);
        const positions = [['HAT', 'Head', 'head'], ['CAPE', 'Cape', 'cape'], ['AMULET', 'Neck', 'neck'], ['ARROWS', 'Ammo', 'ammo'], ['WEAPON', 'Weapon', 'weapon'], ['BODY', 'Body', 'body'], ['SHIELD', 'Shield', 'shield'], ['LEGS', 'Legs', 'legs'], ['GLOVES', 'Hands', 'hands'], ['BOOTS', 'Feet', 'feet'], ['RING', 'Ring', 'ring'], ['NONE', 'Inventory only', 'bag']];
        const slots = el('div', { class: 'data-equipment', 'aria-label': 'Equipment slots' }); area.append(slots);
        for (const [key, label, position] of positions) slots.append(button(label, () => change(() => { s.equipmentType = key; equipmentChanged(); }), { class: `data-slot data-slot-${position}`, 'aria-pressed': SLOTS[key] === SLOTS[s.equipmentType], title: `Equip in ${label.toLowerCase()}` }));
        select(area, 'Slot and body coverage', s.equipmentType, Object.keys(SLOTS).map(v => [v, title(v)]), v => { s.equipmentType = v; equipmentChanged(); });
        if (s.equipmentType === 'WEAPON') {
            select(area, 'Weapon style', s.weaponInterface, [['', 'Inherit starting template'], ...(state.info?.weaponStyles ?? []).map(v => [v, title(v)])], v => s.weaponInterface = v);
            flag(area, 'Two-handed (uses shield space)', s.doubleHanded, v => s.doubleHanded = v);
            number(area, 'Attack interval (ticks)', s.attackSpeed, v => s.attackSpeed = v, { min: 1, max: 20, suffix: ticksText(s.attackSpeed) });
            if (!s.weaponInterface) note(area, 'The starting template supplies the weapon style when this is left inherited.');
        }
    }
    function renderRequirements(parent) {
        const p = state.project, s = p.settings, local = ui(), area = block(parent, 'Wear requirements', 'requirements', true), active = activeRequirements(s);
        if (!active.length) note(area, 'No skill levels required.');
        for (const row of active) {
            const line = el('div', { class: 'data-requirement' }); area.append(line);
            number(line, row.name, row.level, v => s.requirements[row.index] = v, { max: 126 });
            line.append(button('Remove', () => change(() => s.requirements[row.index] = 0), { 'aria-label': `Remove ${row.name} requirement` }));
        }
        const add = el('div', { class: 'data-requirement' }); area.append(add);
        select(add, 'Add a skill requirement', local.requirement, SKILLS.map((name, i) => [i, name]), v => local.requirement = v, true);
        add.append(button('Add', () => change(() => s.requirements[Number(local.requirement)] = s.requirements[Number(local.requirement)] || 1)));
        const presets = block(area, 'Requirement starting points', 'requirement-presets');
        const actions = el('div', { class: 'actions data-wrap' }); presets.append(actions);
        for (const [skill, level] of [[0, 40], [1, 40], [4, 70], [6, 70]]) actions.append(button(`${level} ${SKILLS[skill]}`, () => change(() => s.requirements[skill] = level)));
        actions.append(button('Clear requirements', () => change(() => s.requirements.fill(0))));
        note(presets, 'Adds the named level. Other skill requirements stay in place. Zero removes a requirement.');
    }
    function renderSpecial(parent) {
        const area = block(parent, 'Special and passive effects', 'special', true);
        if(ctx.setMode){
            note(area,'Choose combat behaviour and preview player and enemy visuals in their own workspaces.');
            area.append(button('Special Attacks',()=>ctx.setMode('special')),button('Set Effects',()=>ctx.setMode('set-effects')));
        }else effects.renderInline(area);
    }
    function renderValue(parent) {
        const s = state.project.settings, area = block(parent, 'Value and restrictions', 'value'), fields = grid(area);
        for (const [key, label] of [['value', 'Item value (gp)'], ['highAlch', 'High alchemy (gp)'], ['lowAlch', 'Low alchemy (gp)']]) number(fields, label, s[key], v => s[key] = v, { max: GEAR_NUMBERS[key][1] });
        for (const [key, label] of [['stackable', 'Stacks in inventory'], ['tradeable', 'Players can trade'], ['dropable', 'Players can drop'], ['sellable', 'Players can sell to shops']]) flag(area, label, s[key], v => s[key] = v);
        const camera = block(area, 'Native inventory model camera', 'camera');
        note(camera, 'Changes the exported native inventory view. Picker thumbnails show the model, not an exact inventory sprite.');
        const cameraFields = grid(camera);
        for (const [key, label] of [['zoom2d', 'Zoom'], ['xan2d', 'Tilt'], ['yan2d', 'Turn'], ['zan2d', 'Roll'], ['offsetX2d', 'Horizontal offset'], ['offsetY2d', 'Vertical offset']]) number(cameraFields, label, s[key], v => s[key] = v, { min: GEAR_NUMBERS[key][0], max: GEAR_NUMBERS[key][1] });
    }
    function tryDrops() {
        attempt(() => { const local = ui(); local.sample = sampleDrops(state.project.drops); local.sampleKey = JSON.stringify(state.project.drops); local.sections.drops = true; refresh(); });
    }
    function renderDrops(parent) {
        const p = state.project, d = p.drops, local = ui(), area = block(parent, 'Drops', 'drops', true);
        select(area, 'What drops on a kill?', d.mode, [['none', 'Nothing'], ['borrow', 'Borrow an existing drop table'], ['custom', 'Make my own table']], v => d.mode = v);
        if (d.mode === 'none') { note(area, 'This creature gives no item drops. Custom rows stay saved if you switch back.'); return; }
        if (d.mode === 'borrow') {
            picker(area, 'Drop source creature', 'npc', d.sourceId, v => d.sourceId = v, { required: true });
            note(area, 'TSPS rolls the borrowed table, including shared tables and player conditions.');
            renderBorrowed(area, d.sourceId); return;
        }
        const analysis = analyseDrops(d);
        for (const text of analysis.errors) note(area, text, true);
        for (const text of analysis.warnings) note(area, text, true);
        note(area, 'Every guaranteed item drops. Then one weighted item, or nothing, is picked.');
        const table = el('table', { class: 'data-drop-table', 'aria-label': 'Drop table preview' });
        table.append(el('thead', {}, el('tr', {}, ...['Item', 'Amount', 'Chance per kill'].map(text => el('th', { text, scope: 'col' })))));
        const body = el('tbody'); table.append(body);
        const tableScroll = el('div', { class: 'data-table-scroll', tabIndex: 0, 'aria-label': 'Drop table, scroll for more items' }, table);
        tableScroll.onscroll = () => local.tableScroll = tableScroll.scrollTop;
        area.append(tableScroll);
        queueMicrotask(() => { if (tableScroll.isConnected) tableScroll.scrollTop = local.tableScroll ?? 0; });
        for (const [label, rows] of [['Guaranteed', analysis.guaranteed], ['One weighted roll', analysis.weighted]]) {
            body.append(el('tr', { class: 'data-drop-group' }, el('th', { colSpan: 3, scope: 'colgroup', text: label })));
            if (!rows.length) body.append(el('tr', {}, el('td', { colSpan: 3, class: 'note', text: 'No items in this group.' })));
            for (const row of rows) {
                const name = el('span', { text: `Item ${row.itemId}` }); itemName(row.itemId, name);
                const choose = button('', () => { local.dropIndex = row.index; refresh(); }, { class: 'data-drop-pick', 'aria-pressed': local.dropIndex === row.index, title: `Edit drop ${row.index + 1}` });
                referencePicture(ctx, choose, 'item', row.itemId, 'Native dropped item model'); choose.append(name);
                body.append(el('tr', { class: local.dropIndex === row.index ? 'data-drop-selected' : '' }, el('td', {}, choose), el('td', { text: quantityText(row) }), el('td', { text: row.guaranteed ? 'Every kill' : chanceText(row.chance) })));
            }
        }
        body.append(el('tr', {}, el('td', { text: 'Nothing on weighted roll' }), el('td', { text: '0' }), el('td', { text: chanceText(analysis.emptyChance) })));
        if (d.rows.length) {
            local.dropIndex = Math.max(0, Math.min(d.rows.length - 1, local.dropIndex));
            renderDropEditor(area, d, local.dropIndex, analysis);
        }
        const add = block(area, 'Add an item drop', 'drop-add', !d.rows.length);
        select(add, 'New item drops', local.newDropType ?? 'weighted', [['weighted', 'On the weighted roll'], ['guaranteed', 'Every kill']], v => local.newDropType = v, true);
        if (d.rows.length < DROP_LIMIT) picker(add, 'Item to add', 'item', -1, id => {
            if (id < 0) return;
            d.rows.push({ itemId: id, min: 1, max: 1, weight: local.newDropType === 'guaranteed' ? 0 : 1 }); local.dropIndex = d.rows.length - 1;
        }, { required: true, references: true });
        else note(add, `This table has the maximum ${DROP_LIMIT} rows. Remove a row before adding another.`);
        const advanced = block(area, 'Advanced shares', 'drop-shares');
        number(advanced, 'Nothing on weighted roll (shares)', d.emptyWeight, v => d.emptyWeight = v, { max: 1000000 });
        note(advanced, `Current weighted total: ${analysis.total.toLocaleString('en')} shares. Changing one share changes every weighted chance. Zero on an item means guaranteed.`);
        const preview = el('div', { class: 'actions' }); area.append(preview);
        preview.append(button('Try 10 kills', tryDrops, { disabled: !!analysis.errors.length }));
        note(area, 'Preview only. Sample results do not change your table or award items.');
        if (local.sample && local.sampleKey === JSON.stringify(d)) {
            const sample = el('ol', { class: 'data-sample', 'aria-label': 'Ten sample kills' });
            for (const kill of local.sample) {
                const line = el('li'); sample.append(line);
                if (!kill.length) line.append('Nothing');
                for (const [i, drop] of kill.entries()) { const name = el('span', { text: `Item ${drop.itemId}` }); itemName(drop.itemId, name); line.append(i ? ', ' : '', `${drop.amount.toLocaleString('en')} × `, name); }
            }
            area.append(sample);
        }
    }
    function renderDropEditor(parent, d, index, analysis) {
        const row = d.rows[index], area = el('section', { class: 'data-drop-editor', 'aria-label': `Edit drop ${index + 1}` }); parent.append(area);
        area.append(el('h3', { text: `Edit drop ${index + 1}` }));
        picker(area, 'Dropped item', 'item', row.itemId, v => row.itemId = v, { required: true, references: true });
        select(area, 'When it drops', row.weight === 0 ? 'guaranteed' : 'weighted', [['guaranteed', 'Every kill (guaranteed)'], ['weighted', 'On the weighted roll']], v => row.weight = v === 'guaranteed' ? 0 : 1);
        const quantities = grid(area);
        number(quantities, 'Minimum amount', row.min, v => { row.min = v; row.max = Math.max(row.max, v); }, { min: 1, max: 2147483647 });
        number(quantities, 'Maximum amount', row.max, v => { row.max = v; row.min = Math.min(row.min, v); }, { min: 1, max: 2147483647 });
        const quantitiesActions = el('div', { class: 'actions data-wrap' }); area.append(quantitiesActions);
        for (const [label, min, max] of [['One', 1, 1], ['5 to 10', 5, 10], ['10 to 100', 10, 100]]) quantitiesActions.append(button(label, () => change(() => { row.min = min; row.max = max; })));
        if (row.weight > 0) {
            const percent = Number((analysis.entries[index].chance * 100).toPrecision(8));
            number(area, 'Chance on each kill (%)', percent, v => Object.assign(d, setDropChance(d, index, v)), { min: .01, max: 100, step: .01 });
            note(area, 'An exact chance rescales the other weighted shares together. Guaranteed items stay guaranteed.');
            if (percent < .01) note(area, 'This chance is below 0.01%. Use shares below to preserve a chance this small.');
            const advanced = block(area, 'Edit item shares', `drop-weight-${index}`);
            number(advanced, 'Item shares', row.weight, v => row.weight = v, { min: 1, max: 1000000 });
        }
        const expected = analysis.entries[index].expected * 100;
        note(area, `Average over 100 kills: ${expected.toLocaleString('en', { maximumFractionDigits: 2 })} items from this row.`);
        const actions = el('div', { class: 'actions data-wrap' }); area.append(actions);
        actions.append(button('Duplicate', () => change(() => { d.rows.splice(index + 1, 0, { ...row }); ui().dropIndex = index + 1; }), { disabled: d.rows.length >= DROP_LIMIT }), button('Remove drop', () => change(() => { d.rows.splice(index, 1); ui().dropIndex = Math.min(index, d.rows.length - 1); }), { class: 'danger' }));
    }
    function renderBorrowed(parent, id) {
        const area = block(parent, 'Look inside the borrowed table', 'borrowed-preview');
        area.append(button('Load table preview', async () => {
            try {
                const result = await api(`drop-table?id=${id}`);
                if (!area.isConnected || state.project.drops.sourceId !== id) return;
                area.replaceChildren(el('summary', { text: 'Borrowed table preview' }));
                note(area, result.notice);
                for (const table of result.tables) {
                    area.append(el('h3', { text: table.name }));
                    const list = el('ul', { class: 'data-borrowed' }); area.append(list);
                    for (const row of table.rows) {
                        const line = el('li');
                        const name = el('span', { text: row.name });
                        if (row.itemId >= 0) itemName(row.itemId, name);
                        line.append(name, `, ${row.amount}, ${row.chance}`);
                        if (row.conditions?.length) line.append(el('small', { text: row.conditions.join('; ') }));
                        list.append(line);
                    }
                    if (table.more) note(area, `${table.more} more source rows. Shared tables and runtime conditions stay with TSPS.`);
                }
                if (!result.tables.length) note(area, 'No source table is mapped to this creature. TSPS may supply drops through another plugin.');
            } catch (error) { status(error.message, true); note(area, `Could not load this table. ${error.message}`, true); }
        }));
    }
    function renderTemplates(parent) {
        const p = state.project, local = ui(), area = block(parent, 'Copy gameplay or reset', 'templates');
        const kind = p.kind === 'npc' ? 'npc' : 'item';
        const pickerCtx = { ...ctx, change: fn => { fn(); refresh(); } };
        referencePicker(pickerCtx, area, p.kind === 'npc' ? 'Gameplay source creature' : 'Gameplay source item', kind, local.templateId, id => { local.templateId = id; }, { required: true, references: true });
        select(area, 'Copy which settings?', local.templateGroup, [['about', 'Examine and membership'], ...Object.keys(GAMEPLAY_GROUPS[p.kind]).map(key => [key, title(key)])], v => local.templateGroup = v, true);
        note(area, 'Compare first, then copy one group. Models, drops and animations stay as authored. Undo restores copied settings.');
        const key = `${kind}/${local.templateId}`, loaded = templates.get(key);
        const actions = el('div', { class: 'actions data-wrap' }); area.append(actions);
        actions.append(button('Compare source', async () => {
            try { const source = await api(`game-data?kind=${kind}&id=${local.templateId}`); templates.set(key, { name: source.name, data: templateGameplay(source, p.kind) }); if (templates.size > 8) templates.delete(templates.keys().next().value); if (state.project?.id === p.id) refresh(); }
            catch (error) { status(error.message, true); }
        }));
        if (loaded) {
            actions.append(button('Copy this group', () => change(() => { copyGameplayGroup(p, loaded.data, local.templateGroup); equipmentChangedIfNeeded(local.templateGroup); })));
            const diffs = compareGameplay(p, loaded.data, local.templateGroup);
            if (!diffs.length) note(area, `This group matches ${loaded.name}.`);
            else {
                const table = el('table', { class: 'data-compare' }); area.append(table);
                table.append(el('thead', {}, el('tr', {}, ...['Setting', 'Yours', loaded.name].map(text => el('th', { text, scope: 'col' })))));
                const body = el('tbody'); table.append(body);
                for (const diff of diffs) body.append(el('tr', {}, el('th', { scope: 'row', text: diff.label }), el('td', { text: display(diff.key, diff.current) }), el('td', { text: display(diff.key, diff.template) })));
            }
        }
        area.append(button('Restore group from starting template', async () => {
            try {
                const id = p.baseId, group = local.templateGroup, baseKey = `${kind}/${id}`;
                let base = templates.get(baseKey);
                if (!base) { const source = await api(`game-data?kind=${kind}&id=${id}`); base = { name: source.name, data: templateGameplay(source, p.kind) }; templates.set(baseKey, base); }
                if (state.project !== p) return;
                change(() => { copyGameplayGroup(p, base.data, group); equipmentChangedIfNeeded(group); });
                status(`Restored ${title(group).toLowerCase()} from ${base.name}.`);
            } catch (error) { status(error.message, true); }
        }));
    }
    function equipmentChangedIfNeeded(group) { if (state.project.kind === 'gear' && group === 'equipment') equipmentChanged(); }
    function display(key, value) {
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        if (key === 'elementalWeaknessType') return ELEMENTS.find(([id]) => id === value)?.[1] ?? String(value);
        if (['equipmentType', 'weaponInterface', 'attackType'].includes(key)) return value ? title(value) : 'Inherit template';
        if (typeof value === 'number' && value < 0 && ['specialFrom', 'deathSound', 'projectileId', 'launchGraphicId'].includes(key)) return 'Default / no override';
        return String(value);
    }
    function renderTechnical(parent) {
        const p = state.project, area = block(parent, 'Export identity', 'technical');
        note(area, `Starting template ${p.baseId}. New game ID ${p.ids.definition}. Model IDs ${p.ids.modelBase} to ${p.ids.modelBase + 4}. Reassign only when export reports a collision.`);
        area.append(button('Assign fresh export IDs', async () => { if(ctx.reassignExportIds)return ctx.reassignExportIds();const result = await api('reassign', { project: p }); if (state.project !== p) return; change(() => p.ids = result.project.ids); status('Assigned fresh IDs. Export a new package to use them.'); }));
    }
    function reset() { delete state.gameData; templates.clear(); names.clear(); }
    return { renderTools, renderProperties, syncValues: refresh, reset };
}
