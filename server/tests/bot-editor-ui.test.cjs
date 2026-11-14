const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const graphHtml = fs.readFileSync(path.join(root, 'scripts/bot-graph.html'), 'utf8');
const panelHtml = fs.readFileSync(path.join(root, 'plugins/tools/worldadmin/panel/page.html'), 'utf8');
const localPanelScript = fs.readFileSync(path.join(root, 'scripts/local-panel.cjs'), 'utf8');

function inlineScript(html, id) {
  const tag = id ? new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`).exec(html) : /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(tag, `inline script ${id ?? ''} exists`);
  return tag[1];
}

test('Host Local exposes the routine editor under Tools after the main panel navigation update', () => {
  assert.match(panelHtml, /<nav class="tool-group" aria-label="Tools">[\s\S]*id="bot-editor-link"/);
  assert.match(panelHtml, /updateToolLink\("bot-editor-link", state\.data\.botEditorUrl, "bot"\)/);
  assert.match(localPanelScript, /botEditorUrl: botEditorUrl\(\)/);
  assert.match(localPanelScript, /\/bot-editor\?bot=1/);
});

test('bot routine editor separates local JSON import from the not-yet-available BotHub import', () => {
  assert.match(graphHtml, /id="import">Import local JSON<\/button>/);
  assert.match(graphHtml, /id="import-bothub" type="button" disabled title="BotHub is not implemented yet/);
  assert.match(graphHtml, /id="import-file" type="file" accept="application\/json,\.json"/);
  assert.match(inlineScript(graphHtml), /\$\('import'\)\.onclick=\(\)=>\$\('import-file'\)\.click\(\)/);
});

test('bot routine editor inline JavaScript parses and exposes canvas zoom and resizing controls', () => {
  assert.doesNotThrow(() => new vm.Script(inlineScript(graphHtml)));
  for (const id of ['canvas-controls', 'zoom-in', 'zoom-out', 'zoom-reset', 'zoom-label', 'inspector-resizer', 'inspector-reset']) assert.match(graphHtml, new RegExp(`id="${id}"`));
  assert.match(inlineScript(graphHtml), /const viewport=\$\('viewport'\),old=zoom/);
  const toolbar = /<div class="status-toolbar">([\s\S]*?)<\/div><div id="workspace"/.exec(graphHtml);
  assert.ok(toolbar, 'status and zoom controls share a normal-flow toolbar');
  assert.match(toolbar[1], /id="status"/);
  assert.match(toolbar[1], /id="canvas-controls"/);
  assert.match(graphHtml, /\.status-toolbar\{display:grid;grid-template-columns:minmax\(0,1fr\) 8px minmax\(240px,var\(--inspector-width,320px\)\)/);
  assert.match(graphHtml, /\.status-line\{grid-column:1;[^}]*background:#17181c/);
  const viewportStart = graphHtml.indexOf('<div id="viewport"');
  const resizerStart = graphHtml.indexOf('<div id="inspector-resizer"', viewportStart);
  assert.doesNotMatch(graphHtml.slice(viewportStart, resizerStart), /id="canvas-controls"/);
  assert.match(graphHtml, /\.canvas-controls\{position:static[^}]*background:transparent/);
  assert.match(graphHtml, /scale\(\$\{zoom\}\)/);
  assert.match(graphHtml, /bot-routine-inspector-width/);
  assert.match(graphHtml, /aria-valuemin="240" aria-valuemax="700"/);
});

test('canvas zoom scales the scene, keeps the viewport center, resets, and clamps its range', () => {
  const script = inlineScript(graphHtml);
  const start = script.indexOf('function applyZoom(value)');
  const end = script.indexOf('\nfunction setInspectorWidth', start);
  assert.ok(start >= 0 && end > start, 'applyZoom implementation is present');
  const elements = {
    viewport: { clientWidth: 1000, clientHeight: 600, scrollLeft: 200, scrollTop: 300 },
    'canvas-scene': { style: {} }, canvas: { style: {} }, 'zoom-label': {}, 'zoom-in': {}, 'zoom-out': {},
  };
  const context = { zoom: 1, $: id => elements[id], requestAnimationFrame: callback => callback() };
  vm.runInNewContext(`${script.slice(start, end)}\napplyZoom(1.5); globalThis.scaled={zoom,sceneWidth:$('canvas-scene').style.width,transform:$('canvas').style.transform,label:$('zoom-label').value,left:$('viewport').scrollLeft,top:$('viewport').scrollTop}; applyZoom(1); globalThis.reset={zoom,sceneWidth:$('canvas-scene').style.width,left:$('viewport').scrollLeft,top:$('viewport').scrollTop}; applyZoom(5); globalThis.max=zoom; applyZoom(-1); globalThis.min=zoom`, context);
  assert.equal(context.scaled.sceneWidth, '4500px');
  assert.equal(context.scaled.transform, 'scale(1.5)');
  assert.equal(context.scaled.label, '150%');
  assert.equal(context.scaled.left, 550);
  assert.equal(context.scaled.top, 600);
  assert.deepEqual({ ...context.reset }, { zoom: 1, sceneWidth: '3000px', left: 200, top: 300 });
  assert.equal(context.max, 2);
  assert.equal(context.min, 0.4);
});

test('movement sampler keeps bounded per-bot trails, samples stationary bots, and expires old positions', () => {
  const script = inlineScript(panelHtml, 'local-bots-script');
  const start = script.indexOf('function routineKey(bot)');
  const end = script.indexOf('\n    function renderSwarm()', start);
  assert.ok(start >= 0 && end > start, 'movement sampler is present');
  const context = { movementByBot: new Map() };
  const sample = (username, x, at) => `recordMovement([{username:${JSON.stringify(username)},displayName:${JSON.stringify(username)},activityId:'mine',location:{x:${x},y:3200,z:0}}],${at});`;
  vm.runInNewContext(`const movementWindowMs=900000,maxMovementBots=2,maxMovementPoints=60;${script.slice(start, end)}\n${sample('A', 1, 1000)}${sample('A', 1, 5000)}${sample('A', 1, 11000)};globalThis.stationaryCount=movementByBot.get('A').points.length;${sample('A', 9, 12000)}${sample('B', 2, 13000)}${sample('C', 3, 14000)}${sample('C', 3, 920000)};globalThis.trails=[...movementByBot.values()].map(t=>({username:t.username,points:t.points}))`, context);
  assert.equal(context.stationaryCount, 2);
  assert.deepEqual([...context.trails].map(trail => trail.username).sort(), ['C']);
  assert.equal(context.trails[0].points.length, 1);
  assert.equal(context.trails[0].points[0].x, 3);
});

test('block search removes a stale selected category and restores browsing selection when cleared', () => {
  const script = inlineScript(graphHtml);
  assert.match(script, /categories\.classList\.toggle\('is-searching',!!query\)/);
  assert.match(script, /const selected=!query&&key===selectedCategory/);
  assert.match(script, /Search results across all categories/);
  assert.match(script, /\(blockCategories\[selectedCategory\]\?\?\[\]\)/);
});

test('routine dropdown explicitly opens saved routines while keeping the name editable', () => {
  assert.match(graphHtml, /<label for="activities">Bot routine<\/label><div class="activity-picker"><input id="activities" autocomplete="off"[^>]*aria-controls="activity-options"/);
  assert.match(graphHtml, /id="activity-toggle"[^>]*Show saved bot routines/);
  assert.match(graphHtml, /id="activity-options" class="routine-options" role="listbox"/);
  assert.doesNotMatch(graphHtml, /list="activity-options"|<label>Routine ID/);
  const script = inlineScript(graphHtml);
  assert.match(script, /function renderRoutineOptions\(query=''\)/);
  assert.match(script, /\$\('activity-toggle'\)\.onclick=\(\)=>\{const open=\$\('activity-options'\)\.hidden/);
  assert.match(script, /Renamed \$\{previous\} to \$\{value\} in this draft/);
  assert.match(script, /permanently removes it from the saved routine list/);
});

test('routine dropdown lists, filters, and selects saved routines', () => {
  const script = inlineScript(graphHtml);
  const start = script.indexOf('function setRoutineMenu(open)');
  const end = script.indexOf('\nfunction nextId()', start);
  assert.ok(start >= 0 && end > start, 'routine dropdown helpers are present');
  const elements = {
    activities: { value: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, focus() { this.focused = true; } },
    'activity-options': { hidden: true, children: [], replaceChildren(...children) { this.children = children; }, append(child) { this.children.push(child); } },
    'activity-toggle': { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } },
  };
  const context = {
    all: [{ id: 'routine_alpha', graph: {} }, { id: 'routine_beta', graph: {} }, { id: 'legacy', actions: [] }],
    selectedActivity: 'routine_alpha', selectedNode: 'start', link: { from: 'start', port: 'next' },
    $: id => elements[id],
    el: (tag, text) => ({ tag, textContent: text, className: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }),
    btn: (text, onclick) => ({ textContent: text, className: '', attributes: {}, onclick, setAttribute(name, value) { this.attributes[name] = value; } }),
    render() { globalThis.rendered = (globalThis.rendered ?? 0) + 1; },
  };
  vm.runInNewContext(script.slice(start, end), context);
  vm.runInNewContext("renderRoutineOptions(); globalThis.names=$('activity-options').children.map(option=>option.textContent)", context);
  assert.deepEqual([...context.names], ['routine_alpha', 'routine_beta']);
  vm.runInNewContext("renderRoutineOptions('beta'); globalThis.filtered=$('activity-options').children.map(option=>option.textContent)", context);
  assert.deepEqual([...context.filtered], ['routine_beta']);
  elements['activity-options'].children[0].onclick();
  assert.equal(context.selectedActivity, 'routine_beta');
  assert.equal(context.selectedNode, null);
  assert.equal(context.link, null);
  assert.equal(elements.activities.value, 'routine_beta');
  assert.equal(elements['activity-options'].hidden, true);
  assert.equal(elements.activities.attributes['aria-expanded'], 'false');
  assert.equal(elements.activities.focused, true);
});

test('Bots detail view inline script parses and contains cache-backed OSRS-style item slots', () => {
  const script = inlineScript(panelHtml, 'local-bots-script');
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(panelHtml, /local-bot-skill-icon/);
  assert.match(panelHtml, /local-bot-item-icon/);
  assert.match(panelHtml, /local-bot-inventory-grid/);
  assert.match(panelHtml, /local-bot-equipment-grid/);
  assert.match(script, /\/api\/bots\/item-icon\?id=/);
  assert.match(script, /Swarm overview/);
  assert.doesNotMatch(panelHtml, /World-coordinate movement|local-bot-movement-map|local-bot-map-gridline/);
  assert.match(panelHtml, /local-bot-aerial-roster/);
  assert.match(script, /function renderAerialRoster\(bots\)/);
  assert.match(script, /botColor\(bots, bot\.username, bot\.location\.z\)/);
  assert.match(script, /function recordMovement\(bots/);
  assert.match(script, /Configurable swarm aggregate/);
  assert.match(script, /Overhead bot map/);
  assert.match(script, /LocalBotMapView\.render/);
  assert.match(script, /aerialFollow/);
  assert.match(script, /aggregateSwarm\(bots/);
  assert.match(panelHtml, /swarm-aggregates\.js/);
  assert.match(panelHtml, /bot-map-view\.js/);
  assert.match(script, /function renderAerial\(\)/);
  assert.match(script, /movementWindowMs = 15 \* 60 \* 1000/);
  assert.match(script, /Filter bots by routine/);
  const graph = inlineScript(graphHtml);
  assert.match(graph, /Roam radius \(tiles\)/);
  assert.match(graph, /Base pause at each endpoint/);
  assert.match(graph, /Bait quantity to carry/);
});
