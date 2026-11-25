const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../dist/Server').Server.installProductionPathResolver();
const { decodeClientPacket } = require('../dist/net/protocol/ClientProtocol');
const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');
const Layout = require('../plugins/bots/interface/Layout.Bots.PlayerBots');
const { registerBotsInterface, _test } = require('../plugins/bots/interface/Bots.PlayerBots');
const { configureBrainActivities } = require('../plugins/bots/brain/BrainActivities.PlayerBots');
const { groupRoutines } = require('../plugins/bots/runtime/RoutineDeployments.PlayerBots');
const { _test: { activityList } } = require('../plugins/tools/worldadmin/Bots.WorldAdmin');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRoutineSetups, saveRoutineSetup } = require('../plugins/bots/runtime/SavedRoutineSetups.PlayerBots');
const { readPlans, savePlan } = require('../plugins/bots/runtime/DeploymentPlans.PlayerBots');
const DEVELOPER_RIGHT = { id: 'developer' };

function fakePlayer() {
  return {
    interfaceId: -1,
    strings: new Map(), visibility: new Map(), sentMessages: [],
    setInterfaceId(id) { this.interfaceId = id; },
    getInterfaceId() { return this.interfaceId; },
    getLocation() { return { getX: () => 3200, getY: () => 3201, getZ: () => 0 }; },
    sendMessage(message) { this.sentMessages.push(message); },
    setEnteredSyntaxAction(action) { this.input = action; },
    getPacketSender() {
      const player = this;
      return {
        sendString(value, widget) { player.strings.set(widget, value); return this; },
        sendInterfaceDisplayState(widget, hidden) { player.visibility.set(widget, hidden); return this; },
        sendSubInterface(parent, group, type, options) { player.subInterface = { parent, group, type, options }; return this; },
        sendInterfaceRemoval() { player.interfaceId = -1; },
        sendEnterInputPrompt(prompt) { player.prompt = prompt; },
      };
    },
  };
}

const routines = [
  { id: 'oak_trees', repeat: true },
  { id: 'normal_trees', repeat: true },
  { id: 'varrock_trainer', name: 'Plugin Trainer', codeDefined: true, manual: true, deploymentOverrides: ['skills'] },
  { id: 'custom_gather', manual: true }, // Unregistered legacy entry must not be listed.
  { id: 'roam', repeat: true },
];
const codePlan = {
  id: 'plugin-test', name: 'Plugin plan',
  rows: [{ routine: 'normal_trees', count: 2 }, { routine: 'oak_trees', count: 1 }],
  launchOverrides: [{ count: false, routines: ['oak_trees'] }, { count: true, routines: [] }],
};

function setupFixture({ activities = routines, plans = [codePlan], storage } = {}) {
  const attack = { getName: () => 'Attack' };
  const runtime = { entriesByUsername: new Map(), botStatesByName: new Map() };
  runtime.spawnPvpBot = (location, options) => {
    const name = `Bot ${runtime.entriesByUsername.size + 1}`;
    const bot = { getUsername: () => name, getSkillManager: () => ({}), getUpdateFlag: () => ({ flag() {} }), requestLogout() {} };
    runtime.entriesByUsername.set(name, { player: bot, options });
    runtime.botStatesByName.set(name, {});
    return bot;
  };
  const brainRegistry = { activities, byId: new Map(activities.map(activity => [activity.id, activity])), deploymentPlans: plans };
  const commands = new Map(), actions = [], interfaces = [], customEvents = new Map();
  const api = {
    core: {
      PlayerRights: { DEVELOPER: DEVELOPER_RIGHT }, Skill: { values: () => [attack] },
      Location: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
      BonusManager: { update() {} }, WeaponInterfaceManager: { assign() {} }, Flag: { APPEARANCE: 1 },
      CacheDefinitions: { getItem: id => ({ wearPos: id === 1351 ? 3 : -1 }) },
    },
    registerCommand(name, handler, rights) { commands.set(name, { handler, rights }); },
    registerCustomInterface(definition) { interfaces.push(definition); },
    onInterfaceActionButton(buttons, handler) { actions.push({ buttons, handler }); },
    onCustomEvent(name, handler) { customEvents.set(name, handler); },
    emitCustomEvent(name, event) {
      if (customEvents.has(name)) return customEvents.get(name)(event);
      if (name !== 'admin:open') throw new Error('::bots must not collect activity launchers');
    },
    sendMultiChatboxPrompt() { throw new Error('Plan setup must stay in the main Configure window'); },
  };
  require('../plugins/bots/runtime/DeploymentService.PlayerBots').registerBotDeployment({ api, runtime, brainRegistry });
  registerBotsInterface({ api, runtime, brainRegistry, storage });
  const player = fakePlayer();
  const button = (buttonId, slot) => {
    const action = actions.find(candidate => candidate.buttons.includes(buttonId));
    assert.ok(action, `No handler registered for ${buttonId}`);
    return action.handler({ player, buttonId, slot, opId: 1 });
  };
  const rows = () => JSON.parse(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.DATA)));
  const choose = name => button(Layout.rowUids[0], rows().find(row => row.name === name).id);
  const configure = () => button(Layout.uid(Layout.BROWSER_COMPONENT.CONFIGURE_BUTTON));
  const deploy = () => button(Layout.uid(Layout.BROWSER_COMPONENT.DEPLOY_BUTTON));
  const setup = key => button(Layout.setupUid(Layout.SETUP_COMPONENT[key]));
  const text = key => player.strings.get(Layout.setupUid(Layout.SETUP_COMPONENT[key]));
  const planText = component => player.strings.get(Layout.planUid(component));
  const planButton = component => button(Layout.planUid(component));
  const planHidden = component => player.visibility.get(Layout.planUid(component));
  return { api, runtime, brainRegistry, commands, interfaces, player, button, rows, choose, configure, deploy, setup, text, planText, planButton, planHidden };
}

function open(fixture, query) {
  return fixture.commands.get('bots').handler({ player: fixture.player, parts: ['bots', ...(query ? [query] : [])] });
}

test('the bot browser separates Routines, Saved, and Deployment plans and fits five override rows', () => {
  const browser = Layout.buildBrowserInterface();
  const setup = Layout.buildSetupInterface();
  const plan = Layout.buildPlanInterface();
  const planRoot = plan.widgets.find(widget => widget.uid === Layout.planUid(Layout.PLAN_COMPONENT.ROOT));
  const browserRoot = browser.widgets.find(widget => widget.uid === Layout.uid(Layout.BROWSER_COMPONENT.ROOT));
  const setupRoot = setup.widgets.find(widget => widget.uid === Layout.setupUid(Layout.SETUP_COMPONENT.ROOT));
  for (const root of [browserRoot, setupRoot, planRoot]) {
    assert.equal(root.width, 494);
    assert.equal(root.height, 316);
    assert.equal(root.widthMode, 1);
    assert.equal(root.heightMode, 1);
    assert.equal(root.xPositionMode, 1);
    assert.equal(root.yPositionMode, 1);
  }
  // An already-running client may have the old four-tab browser and routine-only
  // setup in its widget cache. The new declarations must not reuse those IDs.
  assert.ok(![30100, 30101, 30102, 30104].includes(browser.groupId));
  assert.ok(![30100, 30101].includes(setup.groupId));
  assert.match(browser.search.placeholder, /Search routines and plans/);
  assert.deepEqual(browser.tabs.labels, ['Saved', 'Routines', 'Deployment plans']);
  for (const view of [browser, setup, plan]) assert.ok(!view.widgets.some(widget => widget.text === 'Close'));
  assert.deepEqual(browser.tabs.components, [20, 21, 22]);
  assert.equal(browser.list.clickable, true);
  assert.equal(Layout.SETUP_BUTTONS.setupOptions.length, 5);
});

test('::bots shares the panel routine catalog and lists plans in their own tab', () => {
  const f = setupFixture();
  const { player, brainRegistry } = f;
  assert.equal(f.commands.get('bots').rights, DEVELOPER_RIGHT);
  assert.equal(open(f, 'oak'), true);
  assert.equal(player.subInterface.group, Layout.GROUP_ID);
  assert.equal(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.SEARCH_INPUT)), 'oak');
  const state = _test.sessions.get(player);
  const labels = ids => ids.map(id => typeof id === 'number' ? f.rows().find(row => row.id === id).name : id.header);
  assert.equal(state.activeTab, 1, 'the routine catalog opens by default');
  assert.deepEqual(labels(state.tabLayouts[0]), ['Plugin Trainer']);
  assert.deepEqual(labels(state.tabLayouts[1]), groupRoutines(activityList(brainRegistry)).map(group => group.label));
  assert.deepEqual(labels(state.tabLayouts[2]), ['Castle Wars', 'Soul Wars', 'Pest Control', 'Plugin plan']);
  assert.ok(f.rows().find(row => row.name === 'Woodcutting').terms.includes('oak_trees'));
  f.choose('Soul Wars');
  assert.equal(state.selected, null, 'rows from the other tab cannot be selected');
  f.button(Layout.TAB_UIDS[0]);
  f.choose('Soul Wars');
  assert.equal(state.selected, null, 'saved routines exclude plans');
  f.button(Layout.TAB_UIDS[2]);
  f.choose('Soul Wars');
  f.configure();
  assert.equal(player.interfaceId, Layout.PLAN_GROUP_ID, 'plans use the centered Configure window');
  assert.equal(f.planText(Layout.PLAN_COMPONENT.TITLE), 'Soul Wars');
  assert.match(f.planText(Layout.PLAN_COMPONENT.SUMMARY), /20 bots across 2 rows/);
  assert.match(f.planText(Layout.planRows[0].name), /Blue/);
  assert.match(f.planText(Layout.planRows[1].name), /Red/);
  f.planButton(Layout.PLAN_COMPONENT.BACK_BUTTON);
  assert.equal(player.interfaceId, Layout.GROUP_ID);
  assert.equal(state.activeTab, 2);
  assert.equal(state.selected.plan.id, 'soul-wars');
});

test('routine configuration renders the advertised fields, switches profiles and validates overrides', () => {
  const f = setupFixture();
  const { player } = f;
  open(f);
  f.choose('Woodcutting');
  f.configure();
  const state = _test.sessions.get(player);
  const sameRoutine = activityList(f.brainRegistry).find(entry => entry.id === 'normal_trees');
  assert.equal(state.activityId, 'normal_trees', 'uses the panel default, not whichever profile was registered first');
  for (const [index, field] of sameRoutine.deploymentOverrides.entries()) {
    assert.ok(f.text(`OPTION_${index + 1}_LABEL`).startsWith(`${field.label}:`));
  }
  f.setup('OPTION_1_BUTTON');
  assert.equal(state.activityId, 'oak_trees');
  assert.match(f.text('OPTION_1_LABEL'), /Oak trees/);
  f.setup('OPTION_2_BUTTON');
  player.input.execute('here');
  assert.deepEqual(state.overrides.location, { x: 3200, y: 3201, z: 0 });
  f.setup('OPTION_3_BUTTON');
  player.input.execute('attack 75');
  assert.deepEqual(state.overrides.skills, { attack: 75 });
  f.setup('OPTION_3_BUTTON');
  player.input.execute('defence 999');
  assert.deepEqual(state.overrides.skills, { attack: 75 });
  f.setup('OPTION_4_BUTTON');
  player.input.execute('0 1511 1');
  f.setup('OPTION_5_BUTTON');
  player.input.execute('3 1351 1');
  assert.deepEqual(state.overrides.inventory, [{ slot: 0, id: 1511, amount: 1 }]);
  assert.deepEqual(state.overrides.equipment, [{ slot: 3, id: 1351, amount: 1 }]);
  assert.equal(state.overrides.replaceInventory, true);
  assert.equal(state.overrides.replaceEquipment, true);
  for (let i = 0; i < 22; i++) f.setup('COUNT_PLUS');
  assert.equal(state.count, 23);
  f.setup('COUNT_VALUE');
  player.input.execute('67');
  assert.equal(state.count, 67);
  f.setup('OPTION_2_BUTTON');
  const stale = player.input;
  f.setup('BACK_BUTTON');
  stale.execute('3222 3218 0');
  assert.equal(state.overrides.location.x, 3200);
  assert.equal(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.PANEL_TITLE)), 'Woodcutting');
});

test('code routine and preset configuration expose only their own declared overrides', () => {
  const f = setupFixture();
  const { player } = f;
  open(f);
  f.button(Layout.TAB_UIDS[0]);
  f.choose('Plugin Trainer');
  f.configure();
  assert.match(f.text('OPTION_1_LABEL'), /starting skill levels/);
  assert.equal(player.visibility.get(Layout.setupUid(Layout.SETUP_COMPONENT.OPTION_2_BUTTON)), true);
  f.setup('OPTION_2_BUTTON');
  assert.equal(player.input, undefined);
  f.setup('BACK_BUTTON');
  f.button(Layout.TAB_UIDS[2]);
  f.choose('Plugin plan');
  f.configure();
  assert.equal(player.interfaceId, Layout.PLAN_GROUP_ID);
  const [first, second, unused] = Layout.planRows;
  assert.match(f.planText(first.routine[1]), /Normal trees/);
  assert.equal(f.planHidden(first.routine[0]), false);
  assert.equal(f.planHidden(first.plus[0]), true);
  assert.equal(f.planHidden(second.routine[0]), true);
  assert.equal(f.planHidden(second.plus[0]), false);
  assert.equal(f.planHidden(unused.root), true);
  f.planButton(first.plus[0]); // Even a stale click cannot change a locked row.
  assert.equal(f.planText(first.count), '2');
  f.planButton(first.routine[0]);
  f.planButton(second.plus[0]);
  assert.match(f.planText(first.routine[1]), /Oak trees/);
  assert.equal(f.planText(second.count), '2');
  assert.match(f.planText(Layout.PLAN_COMPONENT.SUMMARY), /4 bots/);
});

test('Save as persists a routine setup or plan copy without launching or changing the original', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-configure-save-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const setupsFile = path.join(dir, 'setups.json'), plansFile = path.join(dir, 'plans.json');
  const storage = {
    readRoutineSetups: () => readRoutineSetups(setupsFile),
    saveRoutineSetup: input => saveRoutineSetup(input, setupsFile),
    readAvailablePlans: () => [...readPlans(plansFile, []), codePlan],
    savePlan: input => savePlan(input, plansFile, []),
  };
  const f = setupFixture({ storage });
  open(f);
  f.choose('Woodcutting');
  f.configure();
  f.setup('OPTION_1_BUTTON');
  f.setup('OPTION_2_BUTTON');
  f.player.input.execute('here');
  f.setup('COUNT_VALUE');
  f.player.input.execute('61');
  f.setup('SAVE_BUTTON');
  f.player.input.execute('Oak batch');
  assert.deepEqual(readRoutineSetups(setupsFile), [{ id: 'oak-batch', name: 'Oak batch', activityId: 'oak_trees', count: 61, overrides: { location: { x: 3200, y: 3201, z: 0 } } }]);
  f.setup('BACK_BUTTON');
  f.button(Layout.TAB_UIDS[0]);
  f.choose('Oak batch');
  f.configure();
  assert.equal(f.text('COUNT_VALUE'), '61');
  assert.match(f.text('DESCRIPTION'), /3200, 3201/);
  f.setup('BACK_BUTTON');
  f.button(Layout.TAB_UIDS[2]);
  f.choose('Plugin plan');
  f.configure();
  f.planButton(Layout.planRows[1].count);
  f.player.input.execute('62');
  f.planButton(Layout.PLAN_COMPONENT.SAVE_BUTTON);
  f.player.input.execute('Larger plan');
  assert.equal(readPlans(plansFile, [])[0].rows[1].count, 62);
  assert.equal(codePlan.rows[1].count, 1);
  f.planButton(Layout.PLAN_COMPONENT.BACK_BUTTON);
  assert.ok(f.rows().some(row => row.name === 'Larger plan'));
  assert.equal(f.runtime.entriesByUsername.size, 0);
});

test('Deploy uses defaults and closes the browser; configured launches also close', () => {
  const f = setupFixture();
  const { runtime, brainRegistry, player } = f;
  configureBrainActivities({ runtime, registry: brainRegistry });
  try {
    open(f);
    f.deploy(); // No selection yet.
    assert.equal(player.interfaceId, Layout.GROUP_ID);
    f.choose('Woodcutting');
    f.configure();
    f.setup('OPTION_1_BUTTON'); // Change to oak; quick deploy must ignore it.
    f.setup('COUNT_PLUS');
    f.setup('BACK_BUTTON');
    f.deploy();
    assert.equal(runtime.entriesByUsername.size, 1);
    assert.equal(runtime.entriesByUsername.get('Bot 1').adminDeployedActivityId, 'normal_trees');
    assert.equal(player.interfaceId, -1);
    assert.equal(_test.sessions.get(player), undefined);

    open(f);
    f.choose('Woodcutting');
    f.configure();
    f.setup('OPTION_1_BUTTON');
    f.setup('SPAWN_BUTTON');
    assert.equal(runtime.entriesByUsername.get('Bot 2').adminDeployedActivityId, 'oak_trees');
    assert.equal(player.interfaceId, -1);

    for (const configure of [false, true]) {
      open(f);
      f.button(Layout.TAB_UIDS[2]);
      f.choose('Plugin plan');
      const before = runtime.entriesByUsername.size;
      if (configure) {
        f.configure();
        f.planButton(Layout.planRows[1].plus[0]);
        f.planButton(Layout.PLAN_COMPONENT.DEPLOY_BUTTON);
      } else f.deploy();
      assert.equal(runtime.entriesByUsername.size - before, configure ? 4 : 3);
      assert.equal(player.interfaceId, -1);
    }
  } finally {
    configureBrainActivities();
  }
});

test('a native list click on a row background selects and deploys the concrete routine', () => {
  const f = setupFixture();
  const { runtime, brainRegistry, player } = f;
  const click = (uid, slot = 0xffff) => {
    const bytes = Buffer.alloc(9);
    bytes.writeUInt8(ClientPacketId.IF_BUTTON1);
    bytes.writeInt32BE(uid, 1);
    bytes.writeUInt16BE(slot, 5);
    bytes.writeUInt16BE(0xffff, 7);
    const packet = decodeClientPacket(bytes);
    assert.equal(packet.type, 'widget_action');
    f.button(packet.widgetId, packet.slot);
  };
  configureBrainActivities({ runtime, registry: brainRegistry });
  try {
    open(f, 'Woodcutting');
    const selected = f.rows().find(row => row.name === 'Woodcutting');
    click(Layout.uid(Layout.BROWSER_COMPONENT.ROW_BACKGROUND_START), selected.id);
    click(Layout.uid(Layout.BROWSER_COMPONENT.DEPLOY_LABEL));
    assert.equal(runtime.entriesByUsername.get('Bot 1')?.adminDeployedActivityId, 'normal_trees');
    assert.equal(player.interfaceId, -1);
    assert.match(player.sentMessages.at(-1), /3222, 3218/);
  } finally {
    configureBrainActivities();
  }
});

test('a rejected quick launch keeps the browser open and explains the rejection', () => {
  const f = setupFixture();
  f.runtime.spawnPvpBot = () => null;
  open(f);
  f.choose('Woodcutting');
  f.deploy();
  assert.equal(f.player.interfaceId, Layout.GROUP_ID);
  assert.match(f.player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.PANEL_DESCRIPTION)), /capacity/);
});

test('copying skills uses base levels and normalized names', () => {
  const attack = { getName: () => 'Attack' }, woodcutting = { getName: () => 'Woodcutting' }, bad = { getName: () => 'Sailing' };
  const player = { getSkillManager: () => ({ getMaxLevel: skill => skill === attack ? 72 : skill === woodcutting ? 99 : 0 }) };
  const core = { Skill: { values: () => [attack, woodcutting, bad] } };
  assert.deepEqual(_test.ownerSkillOverrides(player, core), { attack: 72, woodcutting: 99 });
  assert.equal(_test.ownerSkillOverrides({}, core), null);
});

function adminFixture({ activities = [], collectLaunchers } = {}) {
  const attack = { getName: () => 'Attack' };
  const runtime = { entriesByUsername: new Map() };
  const brainRegistry = { activities, byId: new Map(activities.map(activity => [activity.id, activity])) };
  const commands = new Map(), actions = [], interfaces = [], launches = [], customEvents = new Map();
  const api = {
    core: { PlayerRights: { DEVELOPER: DEVELOPER_RIGHT }, Skill: { values: () => [attack] } },
    registerCommand(name, handler, rights, description) {
      assert.equal(commands.has(name), false, `::${name} must have one handler`);
      commands.set(name, { handler, rights, description });
    },
    registerCustomInterface(definition) { interfaces.push(definition); },
    onInterfaceActionButton(buttons, handler) { actions.push({ buttons, handler }); },
    onCustomEvent(name, handler) { customEvents.set(name, handler); },
    emitCustomEvent(name, event) {
      if (customEvents.has(name)) return customEvents.get(name)(event);
      if (name === 'bots:collect-launchers') collectLaunchers?.(event, { runtime, launches });
    },
  };
  require('../plugins/bots/runtime/DeploymentService.PlayerBots').registerBotDeployment({api,runtime,brainRegistry});
  registerBotsInterface({ api, runtime, brainRegistry });
  return { api, runtime, brainRegistry, commands, actions, interfaces, launches, customEvents };
}

function handlerFor(actions, componentUid) {
  const action = actions.find(candidate => candidate.buttons.includes(componentUid));
  assert.ok(action, `No handler registered for ${componentUid}`);
  return action.handler;
}

test('the admin bot catalogue shares routine definitions and counts queued native deployments', () => {
  const f = adminFixture({ activities: routines });
  f.api.core.PlayerRights.hasAdminRights = () => true;
  f.api.core.PluginManager = { playerHasCommandRights: () => true };
  const { trackNativeDeployment } = require('../plugins/bots/runtime/Deploy.PlayerBots');
  const nativeBot = { isRegistered: () => false };
  trackNativeDeployment(f.runtime, nativeBot, { getAddPlayerQueue: () => [nativeBot] });
  f.runtime.entriesByUsername.set('Routine bot', { adminDeployedActivityId: 'oak_trees' });
  const event = { actor: fakePlayer(), action: 'catalogue' };
  f.api.emitCustomEvent('admin:bots', event);
  assert.equal(event.managed, 2);
  assert.deepEqual(new Set(event.launchers.map(launcher => launcher.key)),
    new Set(['routine:oak_trees', 'routine:normal_trees', 'routine:varrock_trainer']));
  const trainer = event.launchers.find(launcher => launcher.key === 'routine:varrock_trainer');
  assert.equal(trainer.name, 'Plugin Trainer');
  assert.equal(trainer.allowLocation, false);
  assert.equal(trainer.allowSkills, true);
});

test('::bots browser opens the standalone saved setups and plans with AdminPanel enabled', () => {
  const f = adminFixture({ activities: routines });
  const player = fakePlayer();
  let adminOpens = 0;
  f.customEvents.set('admin:open', event => { event.handled = true; adminOpens++; });
  const command = f.commands.get('bots').handler;
  command({ player, parts: ['bots'] });
  assert.equal(adminOpens, 1);
  assert.equal(player.interfaceId, -1);

  command({ player, parts: ['bots', 'browser', 'oak'] });
  assert.equal(adminOpens, 1);
  assert.equal(player.interfaceId, Layout.GROUP_ID);
  assert.equal(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.SEARCH_INPUT)), 'oak');
  const { tabLayouts } = _test.sessions.get(player);
  assert.ok(tabLayouts[0].length > 0, 'the Saved tab has available routines');
  assert.ok(tabLayouts[2].length > 0, 'the deployment plans still have a command');
});

test('admin Bots tab uses the same launcher options and deployment bounds and rechecks permissions', () => {
  const fixture = adminFixture({ collectLaunchers(event, { launches }) {
    event.register({ id: 'test-activity', name: 'Test activity', description: 'Activity bots.',
      setupFields: [{ id: 'role', label: 'Role', choices: [{value:'attack',label:'Attack'},{value:'defend',label:'Defend'}] }],
      deploy({runtime,count,location,setup,skillOverrides}) {
        launches.push({count,location,setup,skillOverrides});
        const spawned = Array.from({length:count},(_,i)=>`AdminBot${i}`);
        spawned.forEach(username=>runtime.entriesByUsername.set(username,{player:{isPlayerBot:()=>true,getUsername:()=>username}}));
        return {spawned};
      },
    });
  } });
  let allowed = true;
  fixture.api.core.PlayerRights.hasAdminRights = () => allowed;
  fixture.api.core.PluginManager = {playerHasCommandRights:()=>allowed};
  const originalEmit = fixture.api.emitCustomEvent;
  fixture.api.emitCustomEvent = (name,event) => fixture.customEvents.has(name)
    ? fixture.customEvents.get(name)(event) : originalEmit(name,event);
  const actor = fakePlayer(); actor.getSkillManager=()=>({getMaxLevel:()=>73});
  const Bots = require('../plugins/tools/adminpanel/Bots.AdminPanel');
  const state = {};
  assert.ok(Bots.rows(fixture.api,actor,state).some(row=>row.name==='Test activity'));
  Bots.act(fixture.api,actor,state,'activity:test-activity');
  Bots.act(fixture.api,actor,state,'count',2);
  Bots.act(fixture.api,actor,state,'location');
  Bots.act(fixture.api,actor,state,'levels');
  Bots.act(fixture.api,actor,state,'field:role');
  assert.match(Bots.act(fixture.api,actor,state,'deploy'),/Spawned 2\/2/);
  assert.deepEqual(fixture.launches[0],{count:2,location:{x:3200,y:3201,z:0},setup:{role:'defend'},skillOverrides:{attack:73}});
  assert.match(Bots.act(fixture.api,actor,state,'count',0),/Choose 1-/);
  const invalid = {actor,action:'deploy',key:'activity:test-activity',count:101};
  fixture.customEvents.get('admin:bots')(invalid);
  assert.equal(invalid.result.ok,false);
  assert.equal(fixture.launches.length,1);
  allowed=false;
  assert.match(Bots.act(fixture.api,actor,state,'deploy'),/permission/);
  assert.equal(fixture.launches.length,1);
});

test('::bots routes to the admin Bots tab when AdminPanel handles the request', () => {
  const f=adminFixture();const player=fakePlayer();
  const emit=f.api.emitCustomEvent;
  f.api.emitCustomEvent=(name,event)=>{
    if(name==='admin:open'){assert.equal(event.player,player);assert.equal(event.tab,'bots');event.handled=true;}
    else emit(name,event);
  };
  f.commands.get('bots').handler({player,parts:['bots']});
  assert.equal(player.interfaceId,-1,'the old standalone browser was not opened');
});


test('Bots offers built-in spawning and live controls with no custom routines or contributed launchers', () => {
  const {registerAdminBotControls}=require('../plugins/bots/runtime/AdminControls.PlayerBots');
  const Bots=require('../plugins/tools/adminpanel/Bots.AdminPanel');
  const f=adminFixture({activities:[{id:'pvp',mode:'pvp'},{id:'follow_owner',mode:'follow_owner'},{id:'roam',mode:'roaming'}]});
  const calls=[];let permitted=true;
  f.api.core.PlayerRights.hasAdminRights=()=>true;
  f.api.core.PluginManager={playerHasCommandRights:(_player,command)=>command==='admin'||permitted};
  f.api.core.Location=class {constructor(x,y,z){Object.assign(this,{x,y,z});}};
  f.runtime.hasControllerForPlayer=()=>false;
  f.runtime.entriesByUsername.set('ExistingBot',{player:{isPlayerBot:()=>true,isRegistered:()=>true,getUsername:()=> 'ExistingBot',getDisplayName:()=> 'Existing Bot'},state:{mode:'pvp'}});
  const handlers={
    findBrainActivity:mode=>f.brainRegistry.activities.find(a=>a.mode===(mode==='recruit'?'follow_owner':mode)),
    spawnBot(args){
      calls.push(args);
      const username=`SpawnedBot${calls.length}`,bot={getUsername:()=>username,isPlayerBot:()=>true,isRegistered:()=>false};
      f.runtime.entriesByUsername.set(username,{player:bot});args.spawnedBots.push(bot);
    },
    selfBot:args=>calls.push({self:args}),behavior:args=>calls.push({behavior:args}),rename:args=>calls.push({rename:args}),info() {},
  };
  registerAdminBotControls({api:f.api,runtime:f.runtime,brainRegistry:f.brainRegistry},handlers);
  const emit=f.api.emitCustomEvent;
  f.api.emitCustomEvent=(name,event)=>f.customEvents.has(name)?f.customEvents.get(name)(event):emit(name,event);
  const actor=fakePlayer(),state={};
  const rows=Bots.rows(f.api,actor,state);
  assert.ok(rows.some(row=>row.name==='Recruit / follow me'));
  assert.ok(rows.some(row=>row.name==='Autonomous bot'));
  assert.ok(rows.some(row=>row.name==='Pvp bot'));
  state.botConfig.category='active';
  assert.ok(Bots.rows(f.api,actor,state).some(row=>row.name==='Existing Bot'));
  state.botConfig.category='spawn';
  assert.ok(!rows.some(row=>/No bot/.test(row.name)));
  Bots.act(f.api,actor,state,'activity:player-bot.recruit');
  Bots.act(f.api,actor,state,'count',2);
  assert.match(Bots.act(f.api,actor,state,'deploy'),/Spawned 2\/2/);
  assert.deepEqual(calls.slice(0,2).map(call=>call.requestedMode),['recruit','recruit']);
  assert.equal(f.runtime.entriesByUsername.get('SpawnedBot1').adminDeployedLauncherId,'player-bot.recruit');
  Bots.act(f.api,actor,state,'manage:ExistingBot');
  assert.equal(state.botConfig.view,'manage');
  assert.equal(state.botConfig.bot,'ExistingBot');
  assert.deepEqual(Bots.rows(f.api,actor,state),[],'management actions belong to their own form');
  Bots.act(f.api,actor,state,'control:behavior:manual');
  assert.equal(calls.at(-1).behavior.username,'ExistingBot');
  assert.equal(calls.at(-1).behavior.requestedMode,'manual');
  Bots.act(f.api,actor,state,'control:rename','New Name');assert.equal(calls.at(-1).rename.displayName,'New Name');
  const count=calls.length;permitted=false;
  assert.match(Bots.act(f.api,actor,state,'control:rename','Blocked'),/permission/);
  assert.equal(calls.length,count);
  permitted=true;f.runtime.entriesByUsername.delete('ExistingBot');
  assert.match(Bots.act(f.api,actor,state,'control:behavior:manual'),/no longer online/);
});
