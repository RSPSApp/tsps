/* Maintained separately from the upstream Host Local bundle. */
const teamNames = { saradomin: 'Castle Wars · Saradomin', zamorak: 'Castle Wars · Zamorak', blue: 'Soul Wars · Blue', red: 'Soul Wars · Red' };
const teamMode = team => ({ saradomin: 'castle-wars', zamorak: 'castle-wars', blue: 'soul-wars', red: 'soul-wars' })[team];
function element(tag, text, properties = {}) {
  const node = document.createElement(tag);
  Object.assign(node, properties);
  if (text !== undefined) node.textContent = text;
  return node;
}
const button = (text, onclick) => element('button', text, { type: 'button', onclick });
function select(entries, value, onchange) {
  const node = element('select');
  node.append(...entries.map(([id, name]) => element('option', name, { value: id })));
  node.value = value;
  node.onchange = () => onchange(node.value);
  return node;
}
function field(text, control) {
  const label = element('label', text);
  label.append(control);
  return label;
}
async function request(path, body) {
  const response = await fetch(`/api/bots/${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? response.statusText);
  return result;
}

function spawnRuleControls() {
  const dialog = element('dialog', undefined, { className: 'local-bot-spawn-rules' });
  const rules = element('ul');
  const status = element('output');
  status.setAttribute('role', 'status');
  let loading = false;

  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const { deployments } = await request('activation');
      rules.replaceChildren(...deployments.map(rule => {
        const row = element('li');
        const info = element('div');
        const state = rule.enabled ? 'Enabled' : rule.blocked ? 'Deactivated' : 'Not enabled';
        info.append(element('strong', rule.name), element('small', `${rule.trigger} � ${state} � ${rule.online.length} online`));
        const active = rule.enabled || rule.online.length > 0;
        const toggle = button(active ? 'Deactivate' : 'Enable', async () => {
          if (active && !confirm(`Deactivate ${rule.name}? This also logs out its bots.`)) return;
          toggle.disabled = true;
          try {
            const result = await request('activation', { id: rule.id, enabled: !active });
            status.textContent = result.notice ?? (active ? 'Deactivated.' : 'Enabled.');
            await refresh();
          } catch (error) { status.textContent = error.message; }
          finally { toggle.disabled = false; }
        });
        row.append(info, toggle);
        return row;
      }));
    } catch (error) { status.textContent = error.message; }
    finally { loading = false; }
  }

  const open = button('Spawn rules', () => {
    dialog.showModal();
    status.textContent = '';
    rules.replaceChildren();
    void refresh();
  });
  const actions = element('div', undefined, { className: 'local-bot-management-bar' });
  actions.append(button('Close', () => dialog.close()), button('Refresh', refresh));
  dialog.append(element('h3', 'Spawn rules'), element('p', 'These switches control when groups of bots can spawn. An enabled rule may have no bots online yet.'), actions, status, rules);
  return { open, dialog };
}

function planControls() {
  const section = element('section', undefined, { className: 'local-bot-card local-bot-management' });
  const status = element('output'); status.setAttribute('role', 'status');
  const chooser = element('div', undefined, { className: 'local-bot-management-bar' });
  const dialog = element('dialog', undefined, { className: 'local-bot-plan-dialog' });
  const editStatus = element('output'); editStatus.setAttribute('role', 'status');
  const form = element('form', undefined, { className: 'local-bot-plan-form' });
  const overrides = element('details');
  const planSummary = element('div');
  const overrideRows = element('div');
  overrides.append(element('summary', 'Deployment overrides'), overrideRows);
  let plans = [], routines = [], draft, selected = '', rows = [], launching = false;
  let routineNames = {}, matchRoutineIds = {}, codePlanIds = [];
  const routineName = id => Object.hasOwn(routineNames, id) ? routineNames[id] : id;
  const builtinFor = team => matchRoutineIds[teamMode(team)];
  const isPest = id => id === matchRoutineIds['pest-control'];
  const choiceName = value => {
    const [id, team] = value.split('@');
    if (!team) return routineName(id);
    return id === builtinFor(team) ? teamNames[team] : `${routineName(id)} · ${teamNames[team]}`;
  };
  const matchChoices = () => Object.keys(teamNames).flatMap(team => builtinFor(team) ? [`${builtinFor(team)}@${team}`] : []);
  const first = () => ({ routine: '', count: 1 });
  const blank = () => ({ id: '', name: '', rows: [first()] });
  let catalogueReady = false, pendingCatalogue;
  const loadCatalogue = () => pendingCatalogue ??= request('plans').then(result => {
    const planChanged = JSON.stringify(plans) !== JSON.stringify(result.plans);
    ({ plans, routineIds: routines = [], routineNames = {}, matchRoutineIds = {}, codePlanIds = [] } = result);
    catalogueReady = true;
    if (planChanged) selectPlan(plans.some(plan => plan.id === selected) ? selected : plans[0]?.id);
  }).finally(() => { pendingCatalogue = undefined; });
  async function openEditor(id) {
    dialog.showModal();
    choose(id);
    editStatus.textContent = 'Loading routines…';
    try { await loadCatalogue(); if (dialog.open) { draw(); form.querySelector('input')?.focus(); } editStatus.textContent = ''; }
    catch (error) { editStatus.textContent = error.message; }
  }
  const create = button('New deployment plan', () => openEditor(''));
  function choose(id) {
    draft = id ? structuredClone(plans.find(plan => plan.id === id)) : blank();
    draw();
  }
  function draw() {
    const existing = plans.some(plan => plan.id === draft.id);
    const name = element('input', undefined, { value: draft.name, required: true, maxLength: 48 });
    name.oninput = () => { draft.name = name.value; };
    const editor = draft.rows.map((row, index) => {
      const line = element('div', undefined, { className: 'local-bot-management-bar local-bot-plan-row' });
      const current = row.team ? `${row.routine}@${row.team}` : row.routine;
      const contextual = row.team ? routines.map(id => `${id}@${row.team}`) : [];
      const listed = [...new Set([...routines, ...matchChoices(), matchRoutineIds['pest-control'], ...contextual, current].filter(Boolean))];
      line.append(field('Routine', select([['', 'Choose a routine'], ...listed.map(id => [id, choiceName(id)])], current, value => {
        const [id, team] = value.split('@');
        row.routine = id;
        if (team) row.team = team;
        else delete row.team;
        draw();
      })));
      const count = element('input', undefined, { type: 'number', min: '0', step: '1', value: row.count, required: true });
      count.oninput = () => { row.count = Number(count.value); };
      line.append(field('Count', count));
      const remove = button('Remove', () => { draft.rows.splice(index, 1); draw(); });
      remove.disabled = draft.rows.length === 1;
      line.append(remove);
      return line;
    });
    const add = button('Add routine row', () => { draft.rows.push(first()); draw(); });
    add.disabled = draft.rows.length >= 12 || draft.rows.some(row => isPest(row.routine));
    const save = element('button', 'Save plan', { type: 'submit', disabled: !catalogueReady });
    const deletePlan = button('Delete plan', async () => {
      if (!confirm(`Delete ${draft.name}? Its routines will not be deleted.`)) return;
      try { await request('plans', { id: draft.id, remove: true }); await loadCatalogue(); selectPlan(''); dialog.close(); status.textContent = 'Plan deleted.'; }
      catch (error) { editStatus.textContent = error.message; }
    });
    deletePlan.hidden = !existing;
    const fields = element('div', undefined, { className: 'local-bot-management-bar' });
    fields.append(field('Plan name', name));
    const actions = element('div', undefined, { className: 'local-bot-management-bar' });
    actions.append(add, save, deletePlan, button('Close', () => dialog.close()));
    form.replaceChildren(fields, ...editor, actions);
  }
  form.onsubmit = async event => {
    event.preventDefault();
    try {
      if (!draft.rows.every(row => row.routine)) throw new Error('Choose a routine for each row.');
      const slug = draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const prefix = (/^[a-z]/.test(slug) ? slug : `plan-${slug}`).slice(0, 40).replace(/-$/, '');
      let id = draft.id || prefix;
      for (let sequence = 2; !draft.id && plans.some(plan => plan.id === id); sequence++) id = `${prefix}-${sequence}`;
      await request('plans', { ...draft, id });
      await loadCatalogue();
      selectPlan(id);
      dialog.close();
      status.textContent = 'Plan saved.';
    } catch (error) { editStatus.textContent = error.message; }
  };
  const deploy = button('Deploy plan', async () => {
    if (launching || !selected) return;
    launching = true;
    deploy.disabled = true;
    try {
      const result = await request('plans/deploy', { id: selected, rows });
      status.textContent = Number.isInteger(result.spawnedCount) ? `Deployed ${result.spawnedCount} bots.` : 'Deployment requested.';
    } catch (error) { status.textContent = error.message; }
    finally { launching = false; deploy.disabled = !selected; }
  });
  function selectPlan(id) {
    const plan = plans.find(plan => plan.id === id);
    selected = plan?.id ?? '';
    rows = (plan?.rows ?? []).map(() => ({}));
    chooser.replaceChildren(field('Deployment plan', select([['', 'Choose a plan'], ...plans.map(plan => [plan.id, plan.name])], selected, selectPlan)));
    if (plan && !codePlanIds.includes(plan.id)) chooser.append(button('Edit saved plan', () => openEditor(selected)));
    planSummary.replaceChildren(...(plan?.rows ?? []).map(row => element('p', `${row.count} × ${choiceName(row.team ? `${row.routine}@${row.team}` : row.routine)}`)));
    drawOverrides(plan);
    overrides.hidden = !overrideRows.childElementCount;
    overrides.open = false;
    deploy.disabled = launching || !plan;
    status.textContent = '';
  }
  function drawOverrides(plan) {
    overrideRows.replaceChildren(...(plan?.rows ?? []).flatMap((row, index) => {
      const rule = plan.launchOverrides?.[index];
      if (!rule?.count && !rule?.routines.length) return [];
      const line = element('div', undefined, { className: 'local-bot-management-bar' });
      const title = choiceName(row.team ? `${row.routine}@${row.team}` : row.routine);
      line.append(element('strong', title));
      if (rule.routines.length) {
        const choices = [...new Set([row.routine, ...rule.routines])].map(id => [id, routineName(id)]);
        line.append(field('Routine', select(choices, rows[index].routine ?? row.routine, value => {
          if (value === row.routine) delete rows[index].routine;
          else rows[index].routine = value;
        })));
      }
      if (rule.count) {
        const count = element('input', undefined, { type: 'number', min: '0', step: '1', value: rows[index].count ?? row.count });
        count.oninput = () => {
          if (count.valueAsNumber === row.count) delete rows[index].count;
          else rows[index].count = count.value === '' ? null : count.valueAsNumber;
        };
        line.append(field('Count', count));
      }
      return [line];
    }));
  }
  selectPlan('');
  dialog.append(element('h3', 'Deployment plan'), element('p', 'Choose a routine and count for each row. A team-specific routine already includes its side.'), form, editStatus);
  const heading = element('div', undefined, { className: 'local-bot-section-heading' });
  heading.append(element('h3', 'Deployment plans'), create);
  deploy.classList.add('primary');
  section.append(heading, element('p', 'Deploy multiple routine rows together, including team rosters.'), chooser, planSummary, overrides, deploy, status, dialog);
  loadCatalogue().catch(error => { status.textContent = error.message; });
  const timer = setInterval(() => {
    if (!section.isConnected) clearInterval(timer);
    else if (!dialog.open && section.getClientRects().length) void loadCatalogue().catch(() => {});
  }, 10000);
  return section;
}

const root = document.getElementById('panel-bots');
const positions = { Head: [1, 2], Cape: [2, 1], Neck: [2, 2], Ammo: [2, 3], Weapon: [3, 1], Body: [3, 2], Shield: [3, 3], Legs: [4, 2], Hands: [5, 1], Feet: [5, 2], Ring: [5, 3] };
const failedIcons = new Set();
function enhance() {
  const list = root.querySelector('#bot-count')?.closest('.local-bot-card');
  const deploy = root.querySelector('.local-bot-deploy-grid')?.closest('.local-bot-card');
  if (list && deploy && !list.dataset.onlineBots) {
    list.dataset.onlineBots = 'true';
    const heading = deploy.querySelector('h3');
    heading.textContent = 'Single routine';
    deploy.querySelector('.local-bot-deploy-grid .local-bot-select-field span').textContent = 'Routine';
    const rules = spawnRuleControls();
    const onlineHeading = list.querySelector('.local-bots-card-heading') ?? list.querySelector('h3');
    onlineHeading?.after(rules.open);
    list.append(rules.dialog);
    const sections = element('div', undefined, { className: 'local-bot-launch-sections' });
    sections.append(deploy, planControls());
    list.closest('.local-bot-columns').before(sections);
  }
  for (const slot of root.querySelectorAll('.local-bot-equipment-grid .equipment-slot:not([data-layout])')) {
    const position = positions[slot.querySelector('small')?.textContent];
    if (position) [slot.style.gridRow, slot.style.gridColumn] = position;
    slot.dataset.layout = 'equipment';
  }
  for (const icon of root.querySelectorAll('.local-bot-item-icon[data-item-icon]:not([data-preview])')) {
    const id = icon.dataset.itemIcon;
    icon.dataset.preview = 'checked';
    const slot = icon.parentElement;
    if (slot.querySelector('strong')?.textContent === '×1') slot.querySelector('strong').hidden = true;
    if (icon.getAttribute('src') || !/^\d{1,7}$/.test(id) || failedIcons.has(id)) continue;
    // Fallback only. The bundle's cache-native sprite replaces this when available.
    const fallback = `https://static.runelite.net/cache/item/icon/${id}.png`;
    icon.referrerPolicy = 'no-referrer';
    icon.addEventListener('load', () => {
      icon.hidden = false;
      const name = slot.querySelector('.local-bot-item-name');
      if (name) name.hidden = true;
    });
    icon.addEventListener('error', () => { if (icon.src === fallback) failedIcons.add(id); });
    icon.src = fallback;
  }
}
if (root) {
  new MutationObserver(enhance).observe(root, { childList: true, subtree: true });
  enhance();
}
