const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateGraph, createGraphAction } = require('../plugins/bots/brain/Graph.PlayerBots');

const graph = () => ({ nodes: [{ id: 'start', kind: 'start' }, { id: 'check', kind: 'if' }, { id: 'bank', kind: 'action' }, { id: 'end', kind: 'end' }], edges: [
  { from: 'start', port: 'next', to: 'check' }, { from: 'check', port: 'true', to: 'bank' }, { from: 'check', port: 'false', to: 'end' }, { from: 'bank', port: 'next', to: 'check' },
] });
test('graph validates branches, converging paths and loops', () => {
  const result = validateGraph(graph());
  assert.equal(result.start, 'start');
  assert.equal(result.outputs.get('check:true'), 'bank');
});
test('graph advances one node per update and chooses a branch per bot', () => {
  const calls = [];
  const runner = createGraphAction(graph(), () => ({ update: () => { calls.push('bank'); return 'success'; } }), () => ({ check: ctx => ctx.player.hasItem }));
  const brain = { stopAction: () => calls.push('stop') };
  const yes = { player: { hasItem: true }, brain }, no = { player: { hasItem: false }, brain };
  assert.equal(runner.update(yes), 'running');
  assert.equal(runner.update(no), 'running');
  assert.equal(runner.update(yes), 'running');
  assert.equal(runner.update(no), 'running');
  assert.equal(runner.update(no), 'success');
  assert.equal(runner.update(yes), 'running');
  assert.deepEqual(calls, ['bank', 'stop']);
});

test('interrupt monitor routes an unexpected condition away from a running action', () => {
  const graph = { nodes: [
    { id: 'start', kind: 'start' }, { id: 'watch', kind: 'interrupt', condition: { surprise: true } },
    { id: 'routine', kind: 'action', action: { type: 'routine' } }, { id: 'disarm', kind: 'disarm' },
    { id: 'rescue', kind: 'action', action: { type: 'rescue' } }, { id: 'end', kind: 'end' },
  ], edges: [
    { from: 'start', port: 'next', to: 'watch' }, { from: 'watch', port: 'next', to: 'routine' },
    { from: 'watch', port: 'trigger', to: 'rescue' }, { from: 'routine', port: 'next', to: 'disarm' },
    { from: 'disarm', port: 'next', to: 'end' }, { from: 'rescue', port: 'next', to: 'end' },
  ] };
  let surprise=false, stopped=0; const calls=[];
  const runner=createGraphAction(graph,node=>({id:node.type,update(){calls.push(node.type);return 'running'},stop(){stopped++}}),spec=>({check(){return spec.surprise===true&&surprise}}));
  const ctx={player:{},brain:{stopAction(step){step.stop()}}};
  runner.update(ctx); // Start -> monitor
  runner.update(ctx); // arm -> routine
  runner.update(ctx); // routine keeps running
  surprise=true;
  assert.equal(runner.update(ctx),'running'); // stop routine and branch immediately
  assert.equal(stopped,1);
  runner.update(ctx); // rescue keeps running
  assert.deepEqual(calls,['routine','rescue']);
});

test('event triggers leave the routine and select the highest-priority match deterministically', () => {
  const run = (lowPriority, highPriority) => {
    const graph = { nodes: [
      { id: 'start', kind: 'start' },
      { id: 'low', kind: 'interrupt', condition: { low: true }, priority: lowPriority },
      { id: 'high', kind: 'interrupt', condition: { high: true }, priority: highPriority },
      { id: 'routine', kind: 'action', action: { type: 'routine' } },
      { id: 'normal_end', kind: 'end' }, { id: 'low_event', kind: 'end' }, { id: 'high_event', kind: 'end' },
    ], edges: [
      { from: 'start', port: 'next', to: 'low' },
      { from: 'low', port: 'next', to: 'high' }, { from: 'low', port: 'trigger', to: 'low_event' },
      { from: 'high', port: 'next', to: 'routine' }, { from: 'high', port: 'trigger', to: 'high_event' },
      { from: 'routine', port: 'next', to: 'normal_end' },
    ] };
    let stopped = 0;
    const runner = createGraphAction(graph, () => ({ update: () => 'running', stop: () => stopped++ }), spec => ({ check: ctx => ctx[Object.keys(spec)[0]] === true }));
    const ctx = { player: {}, low: false, high: false, brain: { stopAction(step) { step.stop(); } } };
    runner.update(ctx); runner.update(ctx); runner.update(ctx); runner.update(ctx);
    ctx.low = ctx.high = true;
    assert.equal(runner.update(ctx), 'running');
    assert.equal(stopped, 1);
    const winner = runner.describe(ctx);
    assert.equal(runner.update(ctx), 'success', 'simultaneous lower-priority matches must not cascade');
    assert.equal(runner.describe(ctx), winner);
    return winner;
  };
  assert.equal(run(5, 10), 'end: high_event');
  assert.equal(run(10, 5), 'end: low_event');
  assert.equal(run(5, 5), 'end: high_event', 'equal priority favors the most recently armed trigger');
  const invalid = { nodes: [
    { id: 'start', kind: 'start' }, { id: 'event', kind: 'interrupt', condition: { inCombat: true }, priority: 101 },
    { id: 'continue', kind: 'end' }, { id: 'trigger', kind: 'end' },
  ], edges: [
    { from: 'start', port: 'next', to: 'event' }, { from: 'event', port: 'next', to: 'continue' }, { from: 'event', port: 'trigger', to: 'trigger' },
  ] };
  assert.throws(() => validateGraph(invalid), /priority must be 0–100/);
});

test('interrupt recovery can explicitly resume a stopped routine node from its beginning', () => {
  const graph = { nodes: [
    { id: 'start', kind: 'start' }, { id: 'watch', kind: 'interrupt', condition: { inCombat: true } },
    { id: 'routine', kind: 'action', action: { type: 'routine' } }, { id: 'recover', kind: 'action', action: { type: 'recover' } }, { id: 'resume', kind: 'resume' }, { id: 'end', kind: 'end' },
  ], edges: [
    { from: 'start', port: 'next', to: 'watch' }, { from: 'watch', port: 'next', to: 'routine' },
    { from: 'watch', port: 'trigger', to: 'recover' }, { from: 'routine', port: 'next', to: 'end' },
    { from: 'recover', port: 'next', to: 'resume' },
  ] };
  let inCombat=false, routineRuns=0, stops=0;
  const runner=createGraphAction(graph,spec=>({update(){if(spec.type==='routine'){routineRuns++;return routineRuns<=2?'running':'success'}return 'success'},stop(){stops++}}),()=>({check(){return inCombat}}));
  const ctx={player:{},brain:{stopAction(step){step.stop()}}};
  runner.update(ctx); runner.update(ctx); runner.update(ctx);
  inCombat=true;
  runner.update(ctx); // trigger interrupts the running routine
  assert.equal(stops,1);
  inCombat=false;
  runner.update(ctx); // recovery
  runner.update(ctx); // explicit resume
  runner.update(ctx); // routine starts fresh
  assert.equal(routineRuns,2);
  assert.equal(runner.update(ctx),'running'); // resumed routine completes
  assert.equal(runner.update(ctx),'success');
});

test('AI agent graph node can only route through its authored choice ports', () => {
  const graph = { nodes: [
    { id: 'start', kind: 'start' },
    { id: 'agent', kind: 'agent', prompt: 'Pick a route.', choices: [{ label: 'Gather', description: 'Collect resources.' }, { label: 'Explore', description: 'Explore nearby.' }] },
    { id: 'gather', kind: 'end' }, { id: 'explore', kind: 'end' },
  ], edges: [
    { from: 'start', port: 'next', to: 'agent' }, { from: 'agent', port: 'choice_0', to: 'gather' }, { from: 'agent', port: 'choice_1', to: 'explore' },
  ] };
  const stopped=[];
  const runner=createGraphAction(graph,()=>null,()=>null,node=>({update(){return 'success'},outputPort(){return 'choice_1'},stop(){stopped.push(node.id)}}));
  const ctx={player:{},brain:{stopAction(step){step.stop()}}};
  assert.equal(runner.update(ctx),'running');
  assert.equal(runner.update(ctx),'running');
  assert.equal(runner.update(ctx),'success');
  assert.deepEqual(stopped,['agent']);
});

test('graph AI prompts and routes are validated and normalized', () => {
  const { validateActivities } = require('../plugins/bots/brain/Editor.PlayerBots');
  const graph = { nodes: [
    { id: 'start', kind: 'start', x: 0, y: 0 },
    { id: 'agent', kind: 'agent', prompt: '  Choose a route.  ', choices: [{ label: 'Gather', description: 'Gather.' }, { label: 'Explore', description: '' }], x: 100, y: 0 },
    { id: 'gather', kind: 'end', x: 200, y: 0 }, { id: 'explore', kind: 'end', x: 200, y: 100 },
  ], edges: [
    { from: 'start', port: 'next', to: 'agent' }, { from: 'agent', port: 'choice_0', to: 'gather' }, { from: 'agent', port: 'choice_1', to: 'explore' },
  ] };
  const saved = validateActivities([{ id: 'custom_agent', repeat: false, graph }]);
  assert.equal(saved[0].graph.nodes[1].prompt, 'Choose a route.');
  graph.nodes[1].choices[1].label = 'gather';
  assert.throws(() => validateActivities([{ id: 'custom_agent', repeat: false, graph }]), /unique labels/);
});

test('failed actions may follow an optional error connection', () => {
  const graph = { nodes: [{ id: 'start', kind: 'start' }, { id: 'attempt', kind: 'action', action: { type: 'work' } }, { id: 'recover', kind: 'action', action: { type: 'recover' } }, { id: 'end', kind: 'end' }], edges: [
    { from: 'start', port: 'next', to: 'attempt' }, { from: 'attempt', port: 'next', to: 'end' }, { from: 'attempt', port: 'error', to: 'recover' }, { from: 'recover', port: 'next', to: 'end' },
  ] };
  const called=[];
  const runner=createGraphAction(graph,node=>({id:node.type,update(){called.push(node.type);return node.type==='work'?'failed':'success'},stop(){}}),()=>({check:()=>true}));
  const ctx={player:{},brain:{stopAction(step){step.stop()}}};
  assert.equal(runner.update(ctx),'running'); assert.equal(runner.update(ctx),'running');
  assert.equal(runner.update(ctx),'running'); assert.equal(runner.update(ctx),'success');
  assert.deepEqual(called,['work','recover']);
});

test('graph activity validates action and condition payloads before persistence', () => {
  const { validateActivities } = require('../plugins/bots/brain/Editor.PlayerBots');
  const data = graph();
  for (const [i, node] of data.nodes.entries()) { node.x = i * 100; node.y = 50; }
  data.nodes[1].condition = { hasItem: { id: 1511, min: 1 } };
  data.nodes[2].action = { type: 'bank', itemIds: [1511] };
  const raw = [{ id: 'custom_graph_test', repeat: false, graph: data }];
  const saved = validateActivities(raw);
  assert.deepEqual(validateActivities(saved), saved);
  data.nodes[2].action.itemIds = [null];
  assert.throws(() => validateActivities(raw), /invalid parameters/);
});

test('has-item conditions use an explicit boolean and migrate older quantity input', () => {
  const { validateActivities } = require('../plugins/bots/brain/Editor.PlayerBots');
  const makeActivity = condition => {
    const data = graph();
    for (const [index, node] of data.nodes.entries()) { node.x = index * 100; node.y = 50; }
    data.nodes[1].condition = condition;
    data.nodes[2].action = { type: 'wander' };
    return validateActivities([{ id: 'custom_has_item', repeat: false, graph: data }])[0];
  };
  assert.deepEqual(makeActivity({ hasItem: { id: 1511, present: true } }).graph.nodes[1].condition, { hasItem: { id: 1511, present: true } });
  assert.deepEqual(makeActivity({ hasItem: { id: 1511, present: false } }).graph.nodes[1].condition, { hasItem: { id: 1511, present: false } });
  assert.deepEqual(makeActivity({ hasItem: { id: 1511, min: 4 } }).graph.nodes[1].condition, { hasItem: { id: 1511, present: true } });
  assert.throws(() => makeActivity({ hasItem: { id: 1511, present: 'yes' } }), /true\/false/);
});

test('compound conditions and health thresholds are normalized and bounded', () => {
  const { validateActivities } = require('../plugins/bots/brain/Editor.PlayerBots');
  const data = graph();
  for (const [i, node] of data.nodes.entries()) { node.x = i * 100; node.y = 50; }
  data.nodes[1].condition = { and: [{ inCombat: true }, { or: [{ inventoryFull: true }, { healthPercentBelow: 30 }] }] };
  data.nodes[2].action = { type: 'wander' };
  const saved = validateActivities([{ id: 'custom_condition_group', repeat: false, graph: data }]);
  assert.deepEqual(saved[0].graph.nodes[1].condition, data.nodes[1].condition);
  data.nodes[1].condition = { healthPercentBelow: 100 };
  assert.throws(() => validateActivities([{ id: 'custom_condition_group', repeat: false, graph: data }]), /percentage from 1–99/);
});

test('start setup is validated and remains separate from the graph loop', () => {
  const { validateActivities } = require('../plugins/bots/brain/Editor.PlayerBots');
  const data = graph();
  for (const [i, node] of data.nodes.entries()) { node.x = i * 100; node.y = 50; }
  data.nodes[0].setup = { location: { x: 3222, y: 3218, z: 0 }, skills: { woodcutting: 30 }, inventory: [{ slot: 0, id: 1511, amount: 1 }], equipment: [] };
  data.nodes[1].condition = { hasItem: { id: 1511, min: 1 } };
  data.nodes[2].action = { type: 'bank', itemIds: [1511] };
  const raw = [{ id: 'custom_setup', repeat: true, graph: data }];
  assert.deepEqual(validateActivities(raw)[0].graph.nodes[0].setup, data.nodes[0].setup);
  data.nodes[0].setup.inventory.push({ slot: 0, id: 1511, amount: 1 });
  assert.throws(() => validateActivities(raw), /duplicate slots/);
});

test('looping an interrupt monitor keeps armed guards bounded by node count', () => {
  const graph = { nodes: [
    { id: 'start', kind: 'start' },
    { id: 'watch', kind: 'interrupt', condition: { monitor: true } },
    { id: 'loop', kind: 'if', condition: { loop: true } },
    { id: 'done', kind: 'end' }, { id: 'triggered', kind: 'end' },
  ], edges: [
    { from: 'start', port: 'next', to: 'watch' },
    { from: 'watch', port: 'next', to: 'loop' }, { from: 'watch', port: 'trigger', to: 'triggered' },
    { from: 'loop', port: 'true', to: 'watch' }, { from: 'loop', port: 'false', to: 'done' },
  ] };
  const iterations = 1000;
  let monitorChecks = 0;
  const runner = createGraphAction(graph, () => null, spec => ({ check: () => {
    if (spec.monitor) { monitorChecks++; return false; }
    return true;
  } }));
  const ctx = { player: {}, brain: { stopAction() {} } };
  runner.update(ctx); // Start -> monitor
  for (let i = 0; i < iterations; i++) {
    runner.update(ctx); // arm/re-arm monitor
    runner.update(ctx); // loop back to monitor
  }
  assert.equal(monitorChecks, iterations * 2 - 1, 'each update checks one armed monitor, not the full visit history');
});

test('re-arming a monitor refreshes equal-priority recency', () => {
  const graph = { nodes: [
    { id: 'start', kind: 'start' },
    { id: 'first', kind: 'interrupt', condition: { trigger: true } },
    { id: 'second', kind: 'interrupt', condition: { trigger: true } },
    { id: 'first_event', kind: 'end' }, { id: 'second_event', kind: 'end' },
  ], edges: [
    { from: 'start', port: 'next', to: 'first' },
    { from: 'first', port: 'next', to: 'second' }, { from: 'first', port: 'trigger', to: 'first_event' },
    { from: 'second', port: 'next', to: 'first' }, { from: 'second', port: 'trigger', to: 'second_event' },
  ] };
  let trigger = false;
  const runner = createGraphAction(graph, () => null, () => ({ check: () => trigger }));
  const ctx = { player: {}, brain: { stopAction() {} } };
  runner.update(ctx); runner.update(ctx); runner.update(ctx); runner.update(ctx);
  trigger = true;
  assert.equal(runner.update(ctx), 'running');
  assert.equal(runner.describe(ctx), 'end: first_event', 'the re-armed first monitor is most recent and wins the tie');
});

test('switch node selects first matching case and supports a default route', () => {
  const graph = { nodes: [{ id: 'start', kind: 'start' }, { id: 'switch', kind: 'switch', cases: [{ condition: 'a' }, { condition: 'b' }] }, { id: 'a', kind: 'end' }, { id: 'b', kind: 'end' }, { id: 'default', kind: 'end' }], edges: [
    { from: 'start', port: 'next', to: 'switch' }, { from: 'switch', port: 'case_0', to: 'a' }, { from: 'switch', port: 'case_1', to: 'b' }, { from: 'switch', port: 'default', to: 'default' },
  ] };
  const { outputs } = validateGraph(graph);
  assert.equal(outputs.get('switch:case_1'), 'b');
});

test('graph rejects ambiguous, disconnected and incomplete flows', () => {
  let g = graph(); g.edges.pop(); assert.throws(() => validateGraph(g), /Connect/);
  g = graph(); g.edges = g.edges.filter(edge => edge.from !== 'check' || edge.port !== 'true');
  assert.throws(() => validateGraph(g), /Connect the True output of the If \/ else block/);
  g = graph(); g.edges.push({ from: 'check', port: 'true', to: 'end' }); assert.throws(() => validateGraph(g), /multiple/);
  g = graph(); g.nodes.push({ id: 'lost', kind: 'end' }); assert.throws(() => validateGraph(g), /reachable/);
  g = graph(); g.edges[0].to = 'start'; assert.throws(() => validateGraph(g), /invalid/);
});
