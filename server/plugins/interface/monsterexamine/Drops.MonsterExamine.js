// A display of effective source rows, never a simulation of death scripts or reward selectors.
const MAX_ROWS = 600;
const MAX_VISITS = 4000;
const GROUPS = { guaranteed: 'Guaranteed', main: 'Main table', shared: 'Shared tables', tertiary: 'Tertiary rolls', conditional: 'Conditional rewards' };
const GROUP_HELP = { guaranteed: 'Given on every eligible kill', main: 'The regular reward roll',
  shared: 'Rewards from nested tables', tertiary: 'Extra rolls alongside the main loot',
  conditional: 'Conditions or reward progress' };
function plain(value, limit = 90) { return String(value ?? '').replace(/<[^>]*>/g, '').replace(/[<>\x00-\x1f]/g, '').slice(0, limit); }
function rateOf(entry) {
  const weight = Number(entry.weight) > 0 ? Number(entry.weight) : 1;
  return Number(entry.out_of) > 0 ? Math.min(1, weight / Number(entry.out_of)) : null;
}
function rateText(rate) {
  if (!(rate > 0)) return 'Unknown rate';
  if (rate >= 1) return '1/1';
  // Recover short ratios for presentation only. Base chances were already resolved
  // by the effective drop source; this neither rolls nor changes those chances.
  let x = rate, n0 = 0, n1 = 1, d0 = 1, d1 = 0;
  for (let i = 0; i < 24; i++) {
    const a = Math.floor(x), n = a * n1 + n0, d = a * d1 + d0;
    if (n > 9999 || d > 1e9) break;
    if (n > 0 && Math.abs(n / d - rate) <= rate * 1e-8) return `${n}/${d.toLocaleString('en-US')}`;
    [n0, n1, d0, d1] = [n1, n, d1, d];
    if (x === a) break;
    x = 1 / (x - a);
  }
  const inverse = 1 / rate;
  return `1/${inverse < 100 ? Number(inverse.toFixed(2)) : Math.round(inverse).toLocaleString('en-US')}`;
}
function percentText(probability) {
  const percent = probability * 100;
  if (percent < 0.001) return '<lt>0.001%';
  const digits = Math.max(1, Math.floor(Math.log10(Math.max(1, percent))) + 1);
  return `${Number(percent.toFixed(Math.max(0, 4 - digits)))}%`;
}
function quantity(entry) {
  const alternatives = entry.quantity_alternatives ?? [];
  const values = [entry.quantity, ...alternatives.map(row => row.quantity)].flat().filter(Number.isFinite);
  if (values.length) {
    const min = Math.min(...values), max = Math.max(...values);
    return `${min === max ? min : `${min}-${max}`}${alternatives.length ? ' varies' : ''}`;
  }
  return plain(entry.quantity_raw || 'Unknown', 24);
}
function ratePanel(probability, { always = false, eligible = false, missing = 'Not supplied', conditional = false } = {}) {
  const tint = always ? '80df91' : conditional || !(probability > 0) ? 'edbd6e'
    : probability <= 0.001 ? 'd6a4ff' : probability <= 0.01 ? '8dc8ff' : 'e8ded0';
  if (eligible) return '<col=edbd6e>When eligible</col>';
  return probability > 0 ? `<col=${tint}>[${rateText(probability)}] ${percentText(probability)}</col>` : `<col=${tint}>${missing}</col>`;
}
function panelInfo(name, lines) {
  const text = `<col=ffd27f>${plain(name, 90)}</col><br>${[...new Set(lines.filter(Boolean))].slice(0, 8).map(line => plain(line, 400)).join('<br>')}`;
  return { info: text };
}
function family(name) {
  if (/^clue (scroll|bottle|geode|nest)\b/i.test(name)) return 'Clues';
  for (const [pattern, label] of [[/ runes?$/i, 'Runes'], [/ seeds?$| spores?$/i, 'Seeds'],
    [/ arrows?$/i, 'Arrows'], [/ bolts?$/i, 'Bolts'], [/ darts?$/i, 'Darts'], [/ logs?$/i, 'Logs']]) {
    if (pattern.test(name)) return label;
  }
  // Source headings are provenance, not item families. A "Tertiary" heading
  // must never turn unrelated clues, bags and heads into one item category.
  return null;
}
function tableName(key) {
  const words = plain(String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '), 60).toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1) + (/table$/i.test(words) ? '' : ' table');
}
function quantityRange(entry) {
  // The roller uses a uniform inclusive integer range. Kill-dependent and
  // assumed alternative distributions cannot give a source-backed average.
  if (entry.quantity_alternatives?.length || !Array.isArray(entry.quantity)) return null;
  const min = entry.quantity[0], max = entry.quantity.at(-1);
  return Number.isSafeInteger(min) && Number.isSafeInteger(max) && min >= 0 && max >= min ? [min, max] : null;
}
function buildDrops(source, itemName) {
  const rows = [];
  let visits = 0, truncated = false, incomplete = false;
  function each(entries, callback) {
    for (const entry of (entries ?? []).slice(0, MAX_VISITS)) {
      if (visits >= MAX_VISITS || rows.length >= MAX_ROWS) { truncated = true; break; }
      callback(entry);
    }
    if (entries?.length > MAX_VISITS) truncated = true;
  }
  function visit(entry, probability, context = {}, depth = 0) {
    if (++visits > MAX_VISITS || rows.length >= MAX_ROWS || depth > 5) { truncated = true; return; }
    if (!entry || entry.nothing) return;
    probability = Number.isFinite(probability) && probability >= 0 && probability <= 1 ? probability : null;
    const reasons = [...(context.reasons ?? []), ...(entry.notes ?? []).filter(note => !/^Quest requirement: WikiQuestDropRequirement\(/.test(note)).slice(0, 6).map(note => plain(note, 400))].slice(0, 8);
    if (!reasons.length && entry.notes?.some(note => /^Quest requirement: WikiQuestDropRequirement\(/.test(note))) {
      reasons.push('Only available when the reward\'s quest requirement is met.');
    }
    if (entry.quantity_alternatives?.length) reasons.push('Amount varies with the kill conditions.');
    if (entry.quantity_selection === 'unknown') reasons.push('The amount distribution is not supplied; the server chooses the listed amounts uniformly.');
    if (entry.quest_requirement && !entry.notes?.length) reasons.push(`Requires ${entry.quest_requirement.key}: ${entry.quest_requirement.mode}.`);
    if (entry.location_requirement) reasons.push(`Location: ${entry.location_requirement.not ? 'outside ' : ''}${entry.location_requirement.place}.`);
    if (entry.shared_table || entry.ref) {
      const key = entry.shared_table ?? entry.ref;
      const split = source.categories?.[key];
      const branches = split?.categories ?? [{ entries: source.shared?.[key], probability: 1 }];
      const multiple = entry.roll_count_weights?.some(row => row.rolls !== 1);
      const path = [...(context.path ?? []), { key: visits, name: tableName(key) }];
      if (multiple) reasons.push('A successful table roll can give several rewards; these are reference rates for one reward roll.');
      for (const branch of branches) {
        if (branch.probability === 0) continue;
        if (!branch.entries?.length) { incomplete = true; continue; }
        const chance = Number.isFinite(branch.probability) ? branch.probability : null;
        const section = tableName(key);
        const branchReasons = split ? [...reasons, source.combatLevel
          ? `This table is selected using NPC combat level ${source.combatLevel}.`
          : 'Uses the lowest-level rewards because no combat level is recorded.'] : reasons;
        each(branch.entries, child => visit({ ...child, item_id: child.itemId, out_of: child.outOf },
          probability === null || chance === null ? null : probability * chance * child.weight / branch.entries[0].outOf,
          { ...context, group: context.group === 'main' ? 'shared' : context.group, section, reasons: branchReasons,
            path, sourceGroup: context.sourceGroup ?? (context.group === 'main' ? 'shared' : context.group),
            pool: multiple || entry.notes?.length || entry.quest_requirement || entry.progression ? null : context.pool }, depth + 1));
      }
      return;
    }
    if (entry.locationTalisman) { incomplete = true; return; }
    if (!Number.isInteger(entry.item_id) || entry.item_id < 0) { incomplete = true; return; }
    if (entry.progression) reasons.push('Requires reward progress built up over earlier kills.');
    const eligible = context.group === 'tertiary' && probability >= 1;
    if (eligible && !reasons.length) reasons.push('Only awarded when the matching quest or clue requirement is met; the source does not specify which step.');
    const conditional = reasons.length > 0 && !context.section;
    const always = entry.always && !context.path?.length && !conditional;
    const category = context.path?.length ? context.sourceGroup ?? context.group ?? 'shared'
      : always ? 'guaranteed' : context.group === 'main' && conditional ? 'conditional' : context.group ?? 'main';
    const section = plain(entry.section || context.section, 60);
    const name = plain(entry.name || itemName(entry.item_id), 72);
    const range = quantityRange(entry);
    const missing = context.progression ? 'Progress-based' : 'Not supplied';
    const rules = [...reasons];
    if (entry.separate_roll) rules.push('A separate roll in addition to the main drops.');
    if (probability === null) rules.push(context.progression ? 'The chance depends on earlier reward rolls and your stored progress.'
      : 'A numerical rate is not recorded for this reward.');
    const explanation = rules.join(' ');
    const information = [...rules];
    if (context.path?.length) information.push(`Source: ${context.path.map(part => part.name).join(' / ')}.`);
    if (context.group === 'shared') information.push('Base chance before ring effects, drop boosts or encounter rewards.');
    rows.push({ id: rows.length + 1, icon: entry.item_id, name,
      detail: `x${quantity(entry)}${entry.noted ? ' noted' : ''} | ${always ? 'Always' : `${reasons.length ? 'Conditional; ' : ''}base ${rateText(probability)}`}`,
      terms: `${GROUPS[category]} ${section} ${reasons.join(' ')}`, group: category,
      panel: { quantity: `<col=b9ab96>Qty:</col> ${quantity(entry)}${entry.noted ? '<br><col=b9ab96>noted</col>' : ''}`,
        rate: ratePanel(probability, { always, eligible, missing, conditional: reasons.length > 0 }),
        source: plain(explanation, 800), rules: rules.length ? panelInfo(name, rules).info : '',
        ...panelInfo(name, [`Amount: ${quantity(entry)}${entry.noted ? ' noted' : ''}.`, ...information]) },
      _rate: probability, _pool: reasons.length || entry.quest_requirement || entry.progression || eligible ? null : context.pool,
      _family: family(name), _noted: !!entry.noted, _path: context.path ?? [], _mean: range ? (range[0] + range[1]) / 2 : null, _range: range });
    each(entry.bonus_drops, bonus => visit(bonus, probability,
      { group: 'conditional', path: context.path, sourceGroup: context.sourceGroup,
        reasons: [...reasons, `Awarded together with ${name}.`] }, depth + 1));
    const progression = entry.progression;
    if (progression) visit({ item_id: progression.intermediate_item_id, quantity: progression.intermediate_quantities }, null,
      { group: 'conditional', path: context.path, sourceGroup: context.sourceGroup,
        progression: true, reasons: ['Requires reward progress built up over earlier kills.'] }, depth + 1);
  }
  const table = source?.table;
  if (!table) return { rows, note: 'Drop source unavailable. Encounter loot may apply.' };
  each(table.entries, entry => {
    const reasons = [];
    if (entry.pre_roll) reasons.push('Rolled before the main drops; a success replaces a main roll.');
    if (entry.roll_group) reasons.push('One reward is chosen from a shared reward roll.');
    if (!entry.always && table.reward_chain) reasons.push('Only rolled if the earlier ordered rewards are missed.');
    const probability = entry.always ? 1 : !entry.pre_roll && !entry.separate_roll && table.main_max_roll > 0
      ? entry.weight / table.main_max_roll : rateOf(entry);
    visit(entry, Number.isFinite(probability) ? probability : null,
      { group: 'main', reasons, pool: !entry.always && !entry.pre_roll && !entry.separate_roll && !table.reward_chain ? 'main' : null });
  });
  each(table.tertiary, entry => visit(entry, rateOf(entry), { group: 'tertiary' }));
  each(table.tertiary_groups, group => each(group.entries, entry => visit(entry, rateOf(entry),
    { group: 'tertiary', reasons: ['One reward is chosen from this extra reward roll.'] })));
  each(table.reward_chain?.stages, stage => each(stage.entries, entry => visit(entry, null,
    { group: 'conditional', progression: true, reasons: ['Only available after the earlier ordered reward rolls are missed.'] })));
  rows.sort((a, b) => (b._rate ?? -1) - (a._rate ?? -1) || a.name.localeCompare(b.name));
  return { rows, note: `${truncated ? 'List capped. ' : ''}${incomplete ? 'Some shared sources are missing. ' : ''}Base chances per roll${table.rolls > 1 ? `; ${table.rolls} main rolls per kill` : ''}, before boosts. Hover a reward for its conditions.` };
}
function groupRows(rows) {
  let nextId = MAX_ROWS + 1;
  const result = [];
  function wire(row, parentId) {
    const { id, icon, name, panel } = row;
    return { id, icon, name, panel, ...(parentId ? { parentId } : {}) };
  }
  function folder(name, items, kind, parentId) {
    const id = nextId++;
    const duplicate = kind === 'amounts';
    // These items have already been partitioned by full shared-table access path.
    // Only exclusive, unconditional outcomes on the same main roll can be added.
    const combined = duplicate && items.every(row => row._pool === 'main' && Number.isFinite(row._rate) && row._rate > 0);
    const total = combined ? items.reduce((sum, row) => sum + row._rate, 0) : null;
    const probability = total > 0 && total <= 1 ? total : null;
    const average = probability !== null && items.every(row => Number.isFinite(row._mean))
      ? items.reduce((sum, row) => sum + row._rate * row._mean, 0) / probability : null;
    const meanText = average === null ? '' : average.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const meanCell = average === null ? '' : average.toLocaleString('en-US',
      average >= 1000 ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 2 });
    const range = probability !== null && items.every(row => row._range)
      ? [Math.min(...items.map(row => row._range[0])), Math.max(...items.map(row => row._range[1]))] : null;
    const rangeText = range ? (range[0] === range[1] ? [range[0]] : range).map(value => value.toLocaleString('en-US')).join('-') : '';
    const explanation = duplicate ? probability !== null
      ? 'Combined chance of any listed amount per main-table roll. Expand to see each amount.'
      : 'These amounts use different or conditional reward rolls. Expand to see their individual chances.'
      : kind === 'table' ? 'Rewards stay inside their source table, including nested tables. Rates include access to this table.'
      : 'Different items retain their individual rates. Expand to browse them.';
    const averageInfo = !duplicate ? '' : average !== null
      ? `Average amount per successful drop: ${meanText}. Weighted by each amount chance; uniform ranges use their midpoint.`
      : 'No average is shown: the amount distribution or reward conditions do not support a combined average.';
    const count = kind === 'items' ? new Set(items.map(row => row.icon)).size : items.length;
    const rules = [...new Set(items.map(row => row.panel.rules).filter(Boolean))];
    result.push({ id, name,
      icon: items[0].icon, examineId: duplicate ? items[0].icon : -1, expandable: true, collapsed: true,
      ...(parentId ? { parentId } : {}), panel: {
        quantity: rangeText ? `${rangeText}${meanCell ? ` (${meanCell} avg)` : ''}${items[0]._noted ? ' noted' : ''}` : '',
        rate: probability !== null ? ratePanel(probability) : '',
        source: `${count} ${kind === 'table' ? count === 1 ? 'reward' : 'rewards' : kind}`,
        rules: rules.slice(0, 4).join('<br>') + (rules.length > 4 ? `<br>${rules.length - 4} more reward rules. Expand this group and use each item's Drop info to read them.` : ''),
        ...panelInfo(name, [rangeText ? `Amount range per successful drop: ${rangeText}${items[0]._noted ? ' noted' : ''}.` : '', explanation, averageInfo]) } });
    return id;
  }
  function emitDuplicates(items, parentId) {
    const buckets = new Map();
    for (const row of items) {
      const key = `${row.icon}:${row._noted}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    for (const duplicates of buckets.values()) {
      const parent = duplicates.length > 1 ? folder(duplicates[0].name, duplicates, 'amounts', parentId) : parentId;
      result.push(...duplicates.map(item => wire(item, parent)));
    }
  }
  function emitFamilies(items, parentId) {
    const handled = new Set();
    for (const row of items) {
      if (handled.has(row.id)) continue;
      const familyItems = row._family ? items.filter(item => !handled.has(item.id) && item._family === row._family) : [];
      const unique = new Set(familyItems.map(item => item.icon));
      const alreadyInFamilyTable = parentId && familyItems.length === items.length;
      if (!alreadyInFamilyTable && (unique.size >= 5 || row._family === 'Clues' && unique.size >= 2)) {
        const parent = folder(row._family, familyItems, 'items', parentId);
        emitDuplicates(familyItems, parent);
        familyItems.forEach(item => handled.add(item.id));
      } else {
        const duplicates = items.filter(item => !handled.has(item.id) && item.icon === row.icon && item._noted === row._noted);
        emitDuplicates(duplicates, parentId);
        duplicates.forEach(item => handled.add(item.id));
      }
    }
  }
  function emitSources(items, parentId, depth = 0) {
    // A mandatory tree for each actual access to a shared table. Even a single
    // rune stays under its table, never in a sibling family/duplicate average.
    emitFamilies(items.filter(row => !row._path[depth]), parentId);
    const sources = new Map();
    for (const row of items) {
      const source = row._path[depth];
      if (!source) continue;
      if (!sources.has(source.key)) sources.set(source.key, { source, items: [] });
      sources.get(source.key).items.push(row);
    }
    for (const { source, items: rewards } of sources.values()) {
      const parent = folder(source.name, rewards, 'table', parentId);
      emitSources(rewards, parent, depth + 1);
    }
  }
  for (const [key, name] of Object.entries(GROUPS)) {
    const items = rows.filter(row => row.group === key);
    if (!items.length) continue;
    result.push({ id: nextId++, name: `${name} (${items.length})`, header: true,
      panel: { source: GROUP_HELP[key] } });
    emitSources(items);
  }
  return result;
}
function splitRows(rows, components = 4) {
  const parts = [[]];
  let bytes = 2;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8') + 1;
    if (bytes + size > 38000) { if (parts.length === components) break; parts.push([]); bytes = 2; }
    parts.at(-1).push(row); bytes += size;
  }
  return parts;
}
module.exports = { buildDrops, groupRows, splitRows, plain, MAX_ROWS };
