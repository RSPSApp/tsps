const { test } = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../plugins/bots/interface/Layout.Bots.PlayerBots');
const { registerBotsInterface, _test } = require('../plugins/bots/interface/Bots.PlayerBots');
const DEVELOPER_RIGHT = { id: 'developer' };

function fakePlayer() {
  const strings = new Map();
  const visibility = new Map();
  const player = {
    interfaceId: -1,
    strings, visibility,
    sentMessages: [],
    setInterfaceId(id) { this.interfaceId = id; },
    getInterfaceId() { return this.interfaceId; },
    getLocation() { return { getX: () => 3200, getY: () => 3201, getZ: () => 0 }; },
    sendMessage(message) { this.sentMessages.push(message); },
    getPacketSender() {
      return {
        sendString(value, widget) { strings.set(widget, value); return this; },
        sendInterfaceDisplayState(widget, hidden) { visibility.set(widget, hidden); return this; },
        sendSubInterface(parent, group, type, options) { player.subInterface = { parent, group, type, options }; return this; },
        sendInterfaceRemoval() { player.interfaceId = -1; },
      };
    },
  };
  return player;
}

function setupFixture({ activities = [], collectLaunchers } = {}) {
  const attack = { getName: () => 'Attack' };
  const runtime = { entriesByUsername: new Map() };
  const brainRegistry = { activities, byId: new Map(activities.map(activity => [activity.id, activity])) };
  const commands = new Map(), actions = [], interfaces = [], launches = [];
  const api = {
    core: { PlayerRights: { DEVELOPER: DEVELOPER_RIGHT }, Skill: { values: () => [attack] } },
    registerCommand(name, handler, rights, description) { commands.set(name, { handler, rights, description }); },
    registerCustomInterface(definition) { interfaces.push(definition); },
    onInterfaceActionButton(buttons, handler) { actions.push({ buttons, handler }); },
    emitCustomEvent(name, event) {
      if (name === 'bots:collect-launchers') collectLaunchers?.(event, { runtime, launches });
    },
  };
  registerBotsInterface({ api, runtime, brainRegistry });
  return { api, runtime, brainRegistry, commands, actions, interfaces, launches };
}

function handlerFor(actions, componentUid) {
  const action = actions.find(candidate => candidate.buttons.includes(componentUid));
  assert.ok(action, `No handler registered for ${componentUid}`);
  return action.handler;
}

test('bot launcher browser uses the centered teleport-style frame and a separate compact setup view', () => {
  const browser = Layout.buildBrowserInterface();
  const setup = Layout.buildSetupInterface();
  const browserRoot = browser.widgets.find(widget => widget.uid === Layout.uid(Layout.BROWSER_COMPONENT.ROOT));
  const setupRoot = setup.widgets.find(widget => widget.uid === Layout.setupUid(Layout.SETUP_COMPONENT.ROOT));

  assert.equal(browser.groupId, Layout.GROUP_ID);
  assert.equal(setup.groupId, Layout.SETUP_GROUP_ID);
  for (const root of [browserRoot, setupRoot]) {
    assert.equal(root.width, 494);
    assert.equal(root.height, 316);
    assert.equal(root.widthMode, 1);
    assert.equal(root.heightMode, 1);
    assert.equal(root.xPositionMode, 1);
    assert.equal(root.yPositionMode, 1);
  }
  assert.match(browser.search.placeholder, /Search routines and activities/);
  assert.deepEqual(browser.tabs.labels, ['All', 'Routines', 'Activities']);
  assert.deepEqual(browser.tabs.components, [20, 21, 22]);
  assert.notEqual(Layout.GROUP_ID, 30016);
  assert.equal(browser.tabs.layoutComponent, Layout.BROWSER_COMPONENT.LAYOUT);
  assert.equal(browser.list.clickable, true);
  assert.equal(browser.list.select.texts.description, Layout.BROWSER_COMPONENT.PANEL_DESCRIPTION);
});

test('activity launchers use the teleports-style browser, setup view, and bounded common deployment flow', () => {
  const fixture = setupFixture({
    activities: [{ id: 'custom_oak', manual: true, repeat: true, spawnSetup: null }],
    collectLaunchers(event, { launches }) {
      event.register({
        id: 'barbarian-assault', name: 'Barbarian Assault', detail: 'Minigame',
        description: 'Deploys bots through the activity plugin.', spawnLocation: { x: 3210, y: 3211, z: 0 },
        setupFields: [
          { id: 'role', label: 'Role', defaultValue: 'attacker', choices: [{ value: 'attacker', label: 'Attacker' }, { value: 'defender', label: 'Defender' }] },
          { id: 'wave', label: 'Wave', defaultValue: 'low', choices: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] },
        ],
        deploy({ runtime: botRuntime, count, location, skillOverrides, setup }) {
          launches.push({ count, location, skillOverrides, setup });
          const spawned = [];
          for (let index = 1; index <= count; index += 1) {
            const username = `AssaultBot${index}`;
            const bot = { getUsername: () => username, isPlayerBot: () => true };
            botRuntime.entriesByUsername.set(username, { player: bot });
            spawned.push(username);
          }
          return { spawned, failures: [] };
        },
      });
    },
  });
  const player = fakePlayer();
  player.getSkillManager = () => ({ getMaxLevel: () => 70 });
  fixture.commands.get('bots').handler({ player, parts: ['bots'] });

  assert.equal(fixture.interfaces.length, 2);
  assert.equal(player.interfaceId, Layout.GROUP_ID);
  assert.equal(player.subInterface.group, Layout.GROUP_ID);
  const rows = JSON.parse(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.DATA)));
  assert.deepEqual(rows.map(row => [row.id, row.name]), [[1, 'Oak'], [2, 'Barbarian Assault']]);
  const state = _test.sessions.get(player);
  assert.deepEqual(state.tabLayouts, [[{ header: 'Saved routines' }, 1, { header: 'Activity launchers' }, 2], [1], [2]]);
  assert.equal(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.PANEL_TITLE)), 'Choose a launcher');

  handlerFor(fixture.actions, Layout.TAB_UIDS[2])({ player, buttonId: Layout.TAB_UIDS[2] });
  assert.equal(state.activeTab, 2);
  assert.equal(state.selectedLauncherKey, null);
  assert.equal(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.PANEL_DESCRIPTION)), 'Choose an activity provided by a server plugin.');
  handlerFor(fixture.actions, Layout.TAB_UIDS[1])({ player, buttonId: Layout.TAB_UIDS[1] });
  assert.equal(state.activeTab, 1);
  handlerFor(fixture.actions, Layout.rowUids[0])({ player, slot: 2, opId: 1 });
  assert.equal(_test.sessions.get(player).selectedLauncherKey, 'activity:barbarian-assault');
  assert.equal(player.visibility.get(Layout.uid(Layout.BROWSER_COMPONENT.CONFIGURE_BUTTON)), false);
  handlerFor(fixture.actions, Layout.uid(Layout.BROWSER_COMPONENT.CONFIGURE_BUTTON))({ player, buttonId: Layout.uid(Layout.BROWSER_COMPONENT.CONFIGURE_BUTTON) });
  assert.equal(player.interfaceId, Layout.SETUP_GROUP_ID);
  assert.equal(player.subInterface.group, Layout.SETUP_GROUP_ID);
  assert.equal(player.strings.get(Layout.setupUid(Layout.SETUP_COMPONENT.OPTION_1_LABEL)), 'Role: Attacker  >');
  assert.equal(player.visibility.get(Layout.setupUid(Layout.SETUP_COMPONENT.OPTION_1_BUTTON)), false);

  const setupHandler = handlerFor(fixture.actions, Layout.setupUid(Layout.SETUP_COMPONENT.SPAWN_BUTTON));
  setupHandler({ player, buttonId: Layout.setupUid(Layout.SETUP_COMPONENT.COPY_LEVELS_BUTTON) });
  setupHandler({ player, buttonId: Layout.setupUid(Layout.SETUP_COMPONENT.OPTION_1_BUTTON) });
  assert.equal(player.strings.get(Layout.setupUid(Layout.SETUP_COMPONENT.OPTION_1_LABEL)), 'Role: Defender  >');
  setupHandler({ player, buttonId: Layout.setupUid(Layout.SETUP_COMPONENT.SPAWN_BUTTON) });
  assert.deepEqual(fixture.launches, [{
    count: 1, location: { x: 3210, y: 3211, z: 0 }, skillOverrides: { attack: 70 }, setup: { role: 'defender', wave: 'low' },
  }]);
  assert.equal(fixture.runtime.entriesByUsername.get('AssaultBot1').adminDeployedActivityId, 'barbarian-assault');
  assert.match(player.strings.get(Layout.setupUid(Layout.SETUP_COMPONENT.FEEDBACK)), /Spawned 1\/1 Barbarian Assault bot/);
});

test('::bots opens saved routine choices, preserves selection when returning from setup, and bounds setup controls', () => {
  const activities = [
    { id: 'custom_oak', manual: true, repeat: true, usesAiAgent: false, spawnSetup: { location: { x: 3100, y: 3200, z: 0 }, skills: { woodcutting: 60 }, inventory: [], equipment: [] } },
    { id: 'custom_fishing', manual: true, repeat: false, usesAiAgent: true, spawnSetup: null },
    { id: 'woodcutting', manual: false, repeat: true },
  ];
  const fixture = setupFixture({ activities });
  const { commands, actions } = fixture;
  assert.equal(fixture.interfaces[0].groupId, Layout.GROUP_ID);
  assert.equal(fixture.interfaces[1].groupId, Layout.SETUP_GROUP_ID);
  assert.equal(commands.get('bots').rights, DEVELOPER_RIGHT);
  const player = fakePlayer();
  assert.equal(commands.get('bots').handler({ player, parts: ['bots', 'oak'] }), true);
  assert.equal(player.interfaceId, Layout.GROUP_ID);
  assert.equal(player.subInterface.group, Layout.GROUP_ID);
  const rows = JSON.parse(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.DATA)));
  assert.deepEqual(rows.map(row => [row.id, row.name]), [[1, 'Fishing'], [2, 'Oak']]);
  assert.equal(_test.sessions.get(player).tabLayouts[1].length, 2);
  assert.equal(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.SEARCH_INPUT)), 'oak');
  assert.equal(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.PANEL_TITLE)), 'Choose a launcher');

  handlerFor(actions, Layout.TAB_UIDS[1])({ player, buttonId: Layout.TAB_UIDS[1] });
  assert.equal(_test.sessions.get(player).activeTab, 1);
  assert.equal(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.SEARCH_INPUT)), '');
  handlerFor(actions, Layout.rowUids[0])({ player, slot: 2, opId: 1 });
  assert.equal(_test.sessions.get(player).selectedLauncherKey, 'routine:custom_oak');
  handlerFor(actions, Layout.uid(Layout.BROWSER_COMPONENT.CONFIGURE_BUTTON))({ player, buttonId: Layout.uid(Layout.BROWSER_COMPONENT.CONFIGURE_BUTTON) });
  const setupHandler = handlerFor(actions, Layout.setupUid(Layout.SETUP_COMPONENT.COUNT_PLUS));
  setupHandler({ player, buttonId: Layout.setupUid(Layout.SETUP_COMPONENT.COUNT_PLUS) });
  assert.equal(_test.sessions.get(player).count, 2);
  setupHandler({ player, buttonId: Layout.setupUid(Layout.SETUP_COMPONENT.LOCATION_LABEL) });
  assert.equal(_test.sessions.get(player).usePlayerLocation, true);
  assert.equal(player.strings.get(Layout.setupUid(Layout.SETUP_COMPONENT.LOCATION_INFO)), 'Spawn tile: 3200, 3201, plane 0');
  assert.equal(player.visibility.get(Layout.setupUid(Layout.SETUP_COMPONENT.OPTION_1_BUTTON)), true);

  handlerFor(actions, Layout.setupUid(Layout.SETUP_COMPONENT.BACK_BUTTON))({ player, buttonId: Layout.setupUid(Layout.SETUP_COMPONENT.BACK_BUTTON) });
  assert.equal(player.interfaceId, Layout.GROUP_ID);
  assert.equal(player.strings.get(Layout.uid(Layout.BROWSER_COMPONENT.PANEL_TITLE)), 'Oak');
  assert.equal(player.visibility.get(Layout.uid(Layout.BROWSER_COMPONENT.CONFIGURE_BUTTON)), false);
});

test('copying the owner skill setup uses validated base levels and normalized skill names', () => {
  const attack = { getName: () => 'Attack' }, woodcutting = { getName: () => 'Woodcutting' }, bad = { getName: () => 'Sailing' };
  const player = { getSkillManager: () => ({ getMaxLevel: skill => skill === attack ? 72 : skill === woodcutting ? 99 : 0 }) };
  const core = { Skill: { values: () => [attack, woodcutting, bad] } };
  assert.deepEqual(_test.ownerSkillOverrides(player, core), { attack: 72, woodcutting: 99 });
  assert.equal(_test.ownerSkillOverrides({}, core), null);
});
