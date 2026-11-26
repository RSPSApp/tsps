import { assemble, bounds, nearestRig, followsParentAnimation, reparentPart, isConnection, connectionDependents, partScaleAxes } from '/shared/mesh.mjs';

/**
 * Build inspector. No listeners are installed globally and no project fields are added.
 * The host calls syncValues() after gizmo AND direct part-drag updates, and forwards
 * keydown events to onKeyDown(). For the size gizmo, call scaleFromGizmo(initialScale,
 * axis, factor) in place of assigning one scale axis, so Keep proportions also applies.
 * Gizmo checkpointing, rendering and draft writes remain the host's responsibility.
 */
export function createBuildTab(ctx) {
    const { state, element, button } = ctx;
    let root = null, renderedPart = null, renderedProject = null, bindings = [], gesture = null;
    const settings = () => state.build ??= { uniform: false, nudge: 1 };
    const current = () => state.project && state.mode === 'build' && ctx.selected();
    const isCurrent = () => current() === renderedPart && state.project === renderedProject;
    const display = n => String(Number(n.toFixed(6)));
    const views = ctx.views ?? [['inventory', 'Inventory'], ['male', 'Male worn'], ['female', 'Female worn'], ['maleHead', 'Male head'], ['femaleHead', 'Female head']];
    const viewName = variant => views.find(([key]) => key === variant)?.[1] ?? (variant === 'body' ? 'Creature body' : 'All views');
    const subtree = part => ctx.descendants(part.id);
    const actions = (...children) => element('div', { class: 'actions build-actions' }, ...children);

    function syncValues() {
        // History restoration replaces objects. Never write old-selection values into
        // another selection's inspector; its normal render will establish new bindings.
        if (!root?.isConnected || !isCurrent()) return false;
        const active = root.ownerDocument.activeElement;
        const axes = partScaleAxes(renderedPart, state.project.parts);
        for (const binding of bindings) {
            if (binding.scaleAxis !== undefined) {
                const info = axes[binding.scaleAxis];
                binding.label = info.label;
                binding.caption.textContent = info.label + (info.angled ? ' ↗' : '');
                binding.number.setAttribute('aria-label', `${info.label} value`);
                binding.range.setAttribute('aria-label', info.label);
                binding.row.title = `${info.label}: local ${'XYZ'[info.axis]} axis${info.angled ? ', angled across scene dimensions' : ''}. Hover or focus to see its direction.`;
            }
            const value = binding.get();
            if (!Number.isFinite(value)) continue;
            if (binding.range) {
                // Set bounds first: range inputs otherwise clamp values during a drag.
                binding.range.min = Math.min(binding.low, value);
                binding.range.max = Math.max(binding.high, value);
                binding.range.value = String(value);
                binding.range.setAttribute('aria-valuetext', display(value));
            }
            if (binding.number !== active) {
                binding.number.value = display(value);
                binding.number.setCustomValidity('');
                binding.number.removeAttribute('aria-invalid');
            }
        }
        return true;
    }

    function update(fn) {
        if (!isCurrent()) return;
        ctx.change(fn, false);
        syncValues();
    }

    function group(parent, title, reset) {
        const area = element('section', { class: 'property-section build-group' });
        const heading = element('div', { class: 'build-heading' }, element('h3', { text: title }));
        if (reset) heading.append(button('Reset', () => update(reset), { class: 'build-reset', 'aria-label': `Reset ${title.toLowerCase()}`, title: `Reset ${title.toLowerCase()} only` }));
        area.append(heading); parent.append(area); return area;
    }

    function valueControl(parent, label, get, set, options = {}) {
        const { min = -16000, max = 16000, low = min, high = max, step = 1, axis, integer = false, range: withRange = true } = options;
        const number = element('input', { type: 'number', min, max, step, value: display(get()), 'aria-label': `${label} value`, inputMode: 'decimal' });
        // 'any' is intentional: externally produced transforms must display exactly,
        // including fractions between normal pointer/keyboard increments.
        const range = withRange ? element('input', { type: 'range', min: Math.min(low, get()), max: Math.max(high, get()), step: 'any', value: get(), 'aria-label': label }) : null;
        const binding = { number, range, get, low, high, label };
        bindings.push(binding);
        const invalid = message => { number.setCustomValidity(message); number.setAttribute('aria-invalid', 'true'); ctx.status(message, true); };
        number.addEventListener('input', () => { number.setCustomValidity(''); number.removeAttribute('aria-invalid'); });
        number.addEventListener('change', () => {
            if (!isCurrent()) return;
            const value = Number(number.value);
            if (!number.value.trim() || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) {
                invalid(`${binding.label} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
                return;
            }
            update(() => set(value));
        });
        number.addEventListener('blur', () => syncValues());
        if (range) {
            const begin = () => {
                if (!isCurrent()) return false;
                if (gesture !== binding) { ctx.checkpoint(); gesture = binding; }
                return true;
            };
            const end = () => { if (gesture === binding) { gesture = null; ctx.draft(); } };
            range.addEventListener('pointerdown', begin);
            range.addEventListener('input', () => {
                if (!begin()) return;
                const value = Math.max(min, Math.min(max, Math.round(Number(range.value) / step) * step));
                set(Number(value.toFixed(6))); ctx.changed(false); syncValues();
            });
            for (const event of ['change', 'pointerup', 'pointercancel', 'keyup', 'blur']) range.addEventListener(event, end);
        }
        const visibleLabel = label.replace(/^[XYZ] \((.*)\)$/, '$1');
        const caption = element('span', { text: visibleLabel });
        const name = element('span', { class: 'build-axis', ...(axis !== undefined && { 'data-axis': 'xyz'[axis] }) },
            ...(axis !== undefined ? [element('small', { text: 'XYZ'[axis], 'aria-hidden': 'true' })] : []), caption);
        const row = element('label', { class: withRange ? 'slider-row build-transform-row' : 'build-value-row' }, name, range, number);
        Object.assign(binding, { row, caption });
        if (options.scaleAxis) {
            binding.scaleAxis = axis;
            let hovered = false;
            const preview = () => {
                const show = isCurrent() && (hovered || row.contains(root.ownerDocument.activeElement));
                ctx.viewport.scaleAxisPreview = show ? { partId: renderedPart.id, axis } : null;
                ctx.viewport.dirty = true;
            };
            row.addEventListener('pointerenter', () => { hovered = true; preview(); });
            row.addEventListener('pointerleave', () => { hovered = false; preview(); });
            row.addEventListener('focusin', preview);
            row.addEventListener('focusout', event => {
                if (!row.contains(event.relatedTarget)) { ctx.viewport.scaleAxisPreview = hovered && isCurrent() ? { partId: renderedPart.id, axis } : null; ctx.viewport.dirty = true; }
            });
        }
        parent.append(row);
        return binding;
    }

    function toggle(parent, label, checked, set, title) {
        const input = element('input', { type: 'checkbox', checked, 'aria-label': label });
        input.addEventListener('change', () => set(input.checked));
        parent.append(element('label', { class: 'check', ...(title && { title }) }, input, label));
        return input;
    }

    function scaled(initial, factor) {
        // Clamp a common factor, rather than individual axes, to keep their ratio.
        const minimum = Math.max(...initial.map(n => .01 / n));
        const maximum = Math.min(...initial.map(n => 100 / n));
        const bounded = Math.max(minimum, Math.min(maximum, factor));
        return initial.map(n => Math.max(.01, Math.min(100, n * bounded)));
    }

    function setAxisScale(part, axis, value) {
        if (settings().uniform) part.scale = scaled(part.scale, value / part.scale[axis]);
        else part.scale[axis] = value;
    }

    function scaleFromGizmo(initialScale, axis, factor) {
        const part = current();
        if (!part || isConnection(part) || !Number.isInteger(axis) || axis < 0 || axis > 2 || !Number.isFinite(factor) ||
            !Array.isArray(initialScale) || initialScale.length !== 3 || initialScale.some(n => !Number.isFinite(n) || n < .01 || n > 100)) return false;
        if (settings().uniform) part.scale = scaled(initialScale, factor);
        else part.scale[axis] = Math.max(.01, Math.min(100, initialScale[axis] * factor));
        return true;
    }

    function nudge(axis, direction, multiplier = 1) {
        const part = current();
        if (!part || isConnection(part)) return;
        const value = Number((part.position[axis] + settings().nudge * direction * multiplier).toFixed(6));
        if (value < -16000 || value > 16000) { ctx.status('The part has reached the position limit.', true); return; }
        update(() => part.position[axis] = value);
    }

    function fitSelection() {
        const part = current();
        if (!part) return;
        const mesh = assemble(state.project.parts, state.variant, subtree(part));
        if (!mesh.vertices.length) { ctx.status('Show this part to frame it.', true); return; }
        const box = bounds(mesh);
        ctx.viewport.target = box.center;
        ctx.viewport.distance = Math.max(40, Math.max(...box.max.map((n, i) => n - box.min[i])) * 1.8);
        ctx.viewport.dirty = true;
    }

    function copyIds(initial) {
        const ids = new Set([...initial].filter(id => !isConnection(state.project.parts.find(p => p.id === id))));
        for (const part of state.project.parts) if (isConnection(part) && part.mesh.vertexLinks.every(ref => ids.has(ref.partId))) ids.add(part.id);
        return ids;
    }
    function remapLinks(part, copies) {
        if (isConnection(part)) {
            const remap = ref => ({ ...ref, partId: copies.get(ref.partId) });
            part.mesh.vertexLinks = part.mesh.vertexLinks.map(remap);
            part.connectionEdges = part.connectionEdges?.map(edge => edge.map(remap));
        }
        return part;
    }
    function copyAttacks(copies) {
        for (const attack of state.project.attacks ?? []) for (const [id, override] of Object.entries(attack.parts))
            if (copies.has(id)) attack.parts[copies.get(id)] = structuredClone(override);
    }

    function duplicate() {
        const part = current();
        if (!part || isConnection(part)) return;
        const ids = copyIds(subtree(part));
        if (state.project.parts.length + ids.size > 128) throw new Error('A project supports at most 128 parts.');
        ctx.change(() => {
            const copies = new Map([...ids].map(id => [id, crypto.randomUUID()]));
            const clones = state.project.parts.filter(p => ids.has(p.id)).map(old => {
                const clone = structuredClone(old);
                clone.id = copies.get(old.id); clone.name = `${old.name.slice(0, 95)} copy`;
                clone.parentId = copies.get(old.parentId) ?? old.parentId;
                return remapLinks(clone, copies);
            });
            state.project.parts.push(...clones); copyAttacks(copies); state.selected = copies.get(part.id);
        });
        ctx.status('Duplicated this part and its children. Drag the copy to move it.');
    }

    function remove() {
        const part = current();
        if (!part) return;
        const ids = connectionDependents(state.project.parts, subtree(part)), remaining = state.project.parts.filter(p => !ids.has(p.id));
        const required = state.project.kind === 'npc' ? 'body' : 'inventory';
        if (!assemble(remaining, required).faces.length) throw new Error(`Keep visible geometry in the ${required === 'body' ? 'creature body' : 'inventory view'}.`);
        ctx.change(() => { state.project.parts = remaining; for (const attack of state.project.attacks ?? []) for (const id of ids) delete attack.parts[id]; state.selected = ctx.activeParts()[0]?.id ?? null; });
    }

    function attachments(parent, part) {
        const area = group(parent, 'Attachment');
        const ids = subtree(part);
        const select = element('select', { 'aria-label': 'Attached to' },
            element('option', { value: '', text: 'Nothing (root)', selected: !part.parentId }),
            ...state.project.parts.filter(p => !ids.has(p.id) && !isConnection(p) && (p.variant === part.variant || p.variant === 'all')).map(p =>
                element('option', { value: p.id, text: p.name, selected: p.id === part.parentId })));
        select.addEventListener('change', () => { if (isCurrent()) ctx.change(() => {reparentPart(state.project.parts, part.id, select.value);part.rigMode=select.value?'parent':'source';}); });
        area.append(element('label', {}, 'Attached to', select),
            element('p', { class: 'build-hint', text: 'Changing the parent keeps this piece in place.' }));
        if(part.parentId){toggle(area,'Follow parent animation',followsParentAnimation(part),value=>{if(isCurrent())ctx.change(()=>part.rigMode=value?'parent':'source');},'Keeps this piece affixed to the parent during animation. Moving it updates where it attaches.');
            area.append(element('p',{class:'build-hint',text:followsParentAnimation(part)?'Affixed to the parent at this position. Both mirrored sides follow their corresponding joints.':'Uses its source or manually chosen joints. Turn on Follow parent animation to affix it.'}));}
        toggle(area, 'Mirror to the other side', part.pair ?? false, value => {
            if (!value && state.project.parts.some(p => p.mesh.vertexLinks?.some(ref => ref.twin && ids.has(ref.partId)))) {
                ctx.status('Delete connections to the mirrored side before removing its pair.', true); ctx.render(); return;
            }
            update(() => part.pair = value);
        }, 'Create a linked opposite part. Its children and edits are mirrored too.');
        area.append(actions(button('Duplicate', duplicate, { title: 'Duplicate this part and its children (Ctrl+D)' }),
            button('Delete', remove, { class: 'danger', title: 'Delete this part and its children' }),
            button('Deselect', () => { state.selected = null; ctx.render(); })));
        return area;
    }

    function gearCopies(parent, part) {
        const area = ctx.disclosure(parent, 'Copy to another gear view');
        const destination = element('select', { 'aria-label': 'Copy destination' });
        for (const [value, text] of views) if (value !== state.variant) destination.append(element('option', { value, text }));
        let ancestor = state.project.parts.find(p => p.id === part.parentId), pairedParent = null;
        while (ancestor) {
            if (ancestor.pair) pairedParent = ancestor;
            ancestor = state.project.parts.find(p => p.id === ancestor.parentId);
        }
        const copy = async whole => {
            if (!isCurrent()) return;
            // A child can inherit a mirrored instance from an external parent. The
            // current reparent helper cannot carry that parent's reflection frame
            // into a detached root. Copy the paired branch rather than lose a side.
            if (!whole && pairedParent) throw new Error('Copy the mirrored parent or whole view to keep both sides.');
            const project = state.project, variant = destination.value;
            if (!views.some(([key]) => key === variant) || variant === state.variant) throw new Error('Choose another gear view.');
            const selectedIds = whole ? null : subtree(part);
            const ids = copyIds(new Set(project.parts.filter(p => (whole || selectedIds.has(p.id)) && (p.variant === state.variant || p.variant === 'all')).map(p => p.id)));
            // Reuse the existing reparent operation on a detached working value. This
            // carries parent placement into copied roots without flattening materials,
            // hierarchy, source maps or independent attachment motion.
            const working = structuredClone(project.parts);
            for(const id of ids){const child=working.find(p=>p.id===id),parent=working.find(p=>p.id===child?.parentId);if(parent&&followsParentAnimation(child)&&!ids.has(parent.id)){ids.add(parent.id);parent.visible=false;parent.name=('Placement: '+parent.name).slice(0,100);}}
            if(project.parts.length+ids.size>128)throw new Error('A project supports at most 128 parts.');
            for (const old of working.filter(p => ids.has(p.id) && p.parentId && !ids.has(p.parentId))) reparentPart(working, old.id, null);
            const copies = new Map([...ids].map(id => [id, crypto.randomUUID()]));
            const clones = working.filter(p => ids.has(p.id)).map(p => remapLinks({ ...p, id: copies.get(p.id), parentId: copies.get(p.parentId) ?? null, variant }, copies));
            ctx.change(() => {
                project.parts.push(...clones); copyAttacks(copies); state.variant = variant;
                state.selected = copies.get(part.id) ?? clones[0]?.id; state.reference = null;
            });
            await ctx.updateReference?.(); ctx.renderView();
            ctx.status(`Copied to ${viewName(variant)}. The original view is unchanged.`);
        };
        area.append(element('label', {}, 'Destination', destination), actions(
            button('Copy part + children', () => copy(false), { disabled: !!pairedParent }), button('Copy whole view', () => copy(true))),
            element('p', { class: 'build-hint', text: 'Adds an independent copy. Existing parts in the destination stay.' }));
        if (pairedParent) area.append(element('p', { class: 'build-hint', text: 'This part gets its other side from a mirrored parent. Copy that parent to keep both sides.' }),
            button('Select mirrored parent', () => { state.selected = pairedParent.id; ctx.render(); }));
    }

    function jointControls(parent, part) {
        const area = ctx.disclosure(parent, 'Advanced');
        toggle(area, 'Flip selected part', !!part.mirror, value => update(() => part.mirror = value));
        if(followsParentAnimation(part)){area.append(element('p',{class:'build-hint',text:'Parent animation controls the joints. Turn off Follow parent animation to choose source joints or manual overrides.'}),button('Reset transform',()=>update(()=>{part.position=[0,0,0];part.rotation=[0,0,0];part.scale=[1,1,1];})));return;}
        area.append(element('p', { class: 'build-hint', text: 'Joint overrides choose which body joint moves this part. Use -1 to keep the source joints.' }));
        valueControl(area, 'Classic joint (−1: original)', () => part.bindLabel, value => part.bindLabel = value, { min: -1, max: 255, integer: true, range: false });
        valueControl(area, 'Weighted bone (−1: original)', () => part.bindBone, value => part.bindBone = value, { min: -1, max: 255, integer: true, range: false });
        area.append(button('Bind to nearest body joints', () => {
            const project = state.project, ids = subtree(part);
            const donor = assemble(project.parts, state.variant, new Set([part.id]));
            const other = assemble(project.parts.filter(p => !ids.has(p.id)), state.variant);
            if (!donor.vertices.length) throw new Error('Show this part before binding it.');
            if (!other.vertices.length) throw new Error('Add a body first.');
            nearestRig(donor, other);
            update(() => {
                part.mesh.skins = donor.skins.slice(0, part.mesh.vertices.length);
                part.mesh.bones = donor.bones.slice(0, part.mesh.vertices.length);
                part.mesh.weights = donor.weights.slice(0, part.mesh.vertices.length);
                part.bindLabel = -1; part.bindBone = -1;
            });
        }), button('Reset transform', () => update(() => { part.position = [0, 0, 0]; part.rotation = [0, 0, 0]; part.scale = [1, 1, 1]; })));
    }

    function renderProperties(target) {
        ctx.viewport.scaleAxisPreview = null; ctx.viewport.dirty = true;
        bindings = []; gesture = null; renderedPart = null; renderedProject = state.project;
        root = element('div', { class: 'build-tab' }); target.replaceChildren(root);
        if (state.project?.kind === 'gear') {
            const project = state.project;
            const itemName = element('input', { class: 'part-name', value: project.name ?? '', maxLength: 80, 'aria-label': 'Item name' });
            itemName.addEventListener('change', () => {
                if (state.project !== project) return;
                const name = itemName.value.trim();
                if (!name) { ctx.status('Give this item a name.', true); itemName.value = project.name; return; }
                ctx.change(() => project.name = name);
            });
            root.append(element('label', {}, 'Item name', itemName));
            ctx.renderGearViews?.(root);
        }
        const part = current();
        if (!part) {
            root.append(element('p', { class: 'build-hint', text: state.project ? 'Choose a part in the model or the parts list.' : 'Drag a body from the library into the centre.' }));
            return;
        }
        renderedPart = part;
        const name = element('input', { class: 'part-name', value: part.name, maxLength: 100, 'aria-label': 'Part name' });
        name.addEventListener('change', () => {
            if (!name.value.trim()) { ctx.status('Give this part a name.', true); name.value = part.name; return; }
            if (isCurrent()) ctx.change(() => part.name = name.value.trim());
        });
        root.append(state.project.kind === 'gear' ? element('label', {}, 'Part name', name) : name, element('p', { class: 'build-identity', text: `${viewName(part.variant)} · ${part.mesh.vertices.length.toLocaleString()} vertices · ${part.mesh.faces.length.toLocaleString()} faces` }));
        const identity = actions(button('Fit selection', fitSelection, { title: 'Frame this part and its children (F)' }),
            button(state.isolate ? 'Show all parts' : 'Isolate part', () => { state.isolate = !state.isolate; ctx.render(); }));
        root.append(identity);
        if (isConnection(part)) {
            root.append(element('p', { class: 'build-hint', text: 'This connection follows both openings. Move or reshape its endpoint parts to change it.' }));
            for (const id of new Set(part.mesh.vertexLinks.map(ref => ref.partId))) {
                const endpoint = state.project.parts.find(p => p.id === id);
                if (endpoint) root.append(button(`Select ${endpoint.name}`, () => { state.selected = id; ctx.render(); }));
            }
            root.append(button('Delete', remove, { class: 'danger' }));
            return;
        }
        const source = element('div', { class: 'build-source' }, element('span', { text: `${part.source.kind === 'npc' ? 'Creature' : 'Item'} source #${part.source.id}` }));
        if (ctx.library?.select) source.append(button('Show source', () => ctx.library.select(part.source.kind, part.source.id, part.source.variant), { title: 'Open the original source in the part library' }));
        root.append(source);

        const position = group(root, 'Position', () => part.position = [0, 0, 0]);
        ['X (left)', 'Y (down)', 'Z (back)'].forEach((label, axis) => valueControl(position, label, () => part.position[axis], value => part.position[axis] = value,
            { min: -16000, max: 16000, low: -250, high: 250, step: .1, axis }));
        const nudges = ctx.disclosure(position, 'Precise movement');
        const step = element('select', { 'aria-label': 'Nudge distance' }, ...[.1, 1, 5, 10].map(value => element('option', { value, text: `${value} units`, selected: value === settings().nudge })));
        step.addEventListener('change', () => settings().nudge = Number(step.value));
        nudges.append(element('label', { class: 'build-step' }, 'Each click moves', step));
        const nudgeGrid = element('div', { class: 'build-nudges' });
        ['X', 'Y', 'Z'].forEach((label, axis) => nudgeGrid.append(element('div', { 'data-axis': label.toLowerCase() },
            button('−', () => nudge(axis, -1), { 'aria-label': `Move ${label} minus`, title: `Decrease local ${label}` }),
            element('span', { text: label }), button('+', () => nudge(axis, 1), { 'aria-label': `Move ${label} plus`, title: `Increase local ${label}` }))));
        nudges.append(nudgeGrid, button('Centre left / right', () => update(() => part.position[0] = 0), { title: 'Set the local X position to zero' }));

        const rotation = group(root, 'Rotation', () => part.rotation = [0, 0, 0]);
        ['Pitch', 'Yaw', 'Roll'].forEach((label, axis) => valueControl(rotation, label, () => part.rotation[axis], value => part.rotation[axis] = value,
            { min: -36000, max: 36000, low: -180, high: 180, step: 1, axis }));
        rotation.append(element('p', { class: 'build-hint', text: 'Degrees around local X, Y and Z.' }));
        const scale = group(root, 'Scale', () => part.scale = [1, 1, 1]);
        toggle(scale, 'Keep proportions', settings().uniform, value => settings().uniform = value, 'Link width, height and depth, including the size gizmo.');
        const overall = () => Math.cbrt(part.scale[0] * part.scale[1] * part.scale[2]);
        valueControl(scale, 'Overall', overall, value => part.scale = scaled(part.scale, value / overall()), { min: .01, max: 100, low: .05, high: 5, step: .01 });
        ['Width', 'Height', 'Depth'].forEach((label, axis) => valueControl(scale, label, () => part.scale[axis], value => setAxisScale(part, axis, value),
            { min: .01, max: 100, low: .05, high: 5, step: .01, axis, scaleAxis: true }));
        scale.append(element('p', { class: 'build-hint', text: 'Names follow the part’s orientation. X/Y/Z match its Size handles. ↗ means angled; hover or focus a control to see its direction.' }));
        attachments(root, part);
        if (state.project.kind === 'gear') gearCopies(root, part);
        jointControls(root, part);
        const shortcuts = ctx.disclosure(root, 'Keyboard controls');
        shortcuts.append(element('dl', { class: 'build-shortcuts' },
            ...[['W / E / R', 'Move / rotate / size gizmo'], ['F / Shift+F', 'Fit selection / whole model'], ['Alt+arrows', 'Move on X and Y'], ['Alt+Page Up / Down', 'Move on Z'], ['Hold Shift', 'Move ten nudge steps'], ['Ctrl+D', 'Duplicate part and children'], ['Ctrl+C / Ctrl+V', 'Copy / paste pieces between views and projects']].flatMap(([key, meaning]) => [element('dt', { text: key }), element('dd', { text: meaning })])));
        syncValues();
    }

    function onKeyDown(event) {
        if (event.defaultPrevented || !current() || state.placement) return false;
        const target = event.target;
        // The canvas is the keyboard workspace. Never take arrows or editing shortcuts
        // from text fields, selects, buttons, the library search or another tab.
        if (target && target !== ctx.viewport.canvas && target !== root?.ownerDocument.body) return false;
        const key = event.key.toLowerCase();
        let run;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'd') run = duplicate;
        else if (event.ctrlKey || event.metaKey) return false;
        else if (event.altKey) {
            const move = { arrowleft: [0, 1], arrowright: [0, -1], arrowup: [1, -1], arrowdown: [1, 1], pageup: [2, -1], pagedown: [2, 1] }[key];
            if (move) run = () => nudge(move[0], move[1], event.shiftKey ? 10 : 1);
        } else if (key === 'f') run = () => event.shiftKey ? ctx.viewport.fit() : fitSelection();
        else if (!event.shiftKey && ['w', 'e', 'r'].includes(key)) run = () => {
            const mode = { w: 'move', e: 'rotate', r: 'scale' }[key];
            ctx.viewport.gizmoMode = mode; ctx.viewport.gizmo = true; ctx.viewport.dirty = true;
            // These are existing host controls. Keep their display in step with the shortcut.
            const document = ctx.viewport.canvas.ownerDocument;
            const select = document.getElementById('gizmo-mode'), check = document.getElementById('gizmo');
            if (select) { select.value = mode; select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true })); }
            if (check && !check.checked) { check.checked = true; check.dispatchEvent(new document.defaultView.Event('change', { bubbles: true })); }
        };
        if (!run) return false;
        event.preventDefault();
        try { run(); } catch (error) { ctx.status(error.message, true); }
        return true;
    }

    function reset() {
        ctx.viewport.scaleAxisPreview = null; ctx.viewport.dirty = true;
        bindings = []; gesture = null; renderedPart = null; renderedProject = null; root = null;
        state.build = { uniform: false, nudge: 1 };
    }
    return { renderProperties, syncValues, scaleFromGizmo, onKeyDown, reset };
}
