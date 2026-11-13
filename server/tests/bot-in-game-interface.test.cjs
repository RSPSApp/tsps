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

test('registered activity launchers appear beside routines and deploy through the bounded common flow', () => {
  const attack = { getName: () => 'Attack' };
  const runtime = { entriesByUsername: new Map() };
  const activities = [{ id: 'custom_oak', manual: true, repeat: true, spawnSetup: null }];
  const brainRegistry = { activities, byId: new Map(activities.map(activity => [activity.id, activity])) };
  const commands = new Map(), actions = [], interfaces = [], launches = [];
  const api = {
    core: { PlayerRights: { DEVELOPER: DEVELOPER_RIGHT }, Skill: { values: () => [attack] } },
    registerCommand(name, handler, rights, description) { commands.set(name, { handler, rights, description }); },
    registerCustomInterface(definition) { interfaces.push(definition); },
    onInterfaceActionButton(buttons, handler) { actions.push({ buttons, handler }); },
    emitCustomEvent(name, event) {
      if (name !== 'bots:collect-launchers') return;
      event.register({
        id: 'barbarian-assault', name: 'Barbarian Assault', detail: 'Minigame',
        description: 'Deploys bots through the activity plugin.', spawnLocation: { x: 3210, y: 3211, z: 0 },
        setupFields: [
          { id: 'role', label: 'Role', choices: [{ value: 'attacker', label: 'Attacker' }, { value: 'defender', label: 'Defender' }] },
          { id: 'wave', label: 'Wave', choices: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] },
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
  };
  registerBotsInterface({ api, runtime, brainRegistry });
  const player = fakePlayer();
  player.getSkillManager = () => ({ getMaxLevel: () => 70 });
  commands.get('bots').handler({ player, parts: ['bots'] });
  const rows = JSON.parse(player.strings.get(Layout.uid(Layout.COMPONENT.DATA)));
  assert.deepEqual(rows.map(row => row.name), ['Oak', 'Barbarian Assault']);
  assert.equal(rows[1].detail, 'Minigame');

  actions.find(action => action.buttons.includes(Layout.rowUids[0])).handler({ player, slot: 2, opId: 1 });
  assert.equal(_test.sessions.get(player).selectedLauncherKey, 'activity:barbarian-assault');
  assert.equal(player.strings.get(Layout.uid(Layout.COMPONENT.SETUP_OPTION_1_LABEL)), 'Role: Attacker >');
  assert.equal(player.visibility.get(Layout.uid(Layout.COMPONENT.SETUP_OPTION_1)), false);
  const buttonHandler = actions.find(action => action.buttons.includes(Layout.uid(Layout.COMPONENT.SPAWN_BUTTON))).handler;
  buttonHandler({ player, buttonId: Layout.uid(Layout.COMPONENT.COPY_LEVELS_BUTTON) });
  buttonHandler({ player, buttonId: Layout.uid(Layout.COMPONENT.SETUP_OPTION_1) });
  assert.equal(player.strings.get(Layout.uid(Layout.COMPONENT.SETUP_OPTION_1_LABEL)), 'Role: Defender >');
  buttonHandler({ player, buttonId: Layout.uid(Layout.COMPONENT.SPAWN_BUTTON) });
  assert.deepEqual(launches, [{ count: 1, location: { x: 3210, y: 3211, z: 0 }, skillOverrides: { attack: 70 }, setup: { role: 'defender', wave: 'low' } }]);
  assert.equal(runtime.entriesByUsername.get('AssaultBot1').adminDeployedActivityId, 'barbarian-assault');
  assert.match(player.strings.get(Layout.uid(Layout.COMPONENT.FEEDBACK)), /Spawned 1\/1 Barbarian Assault bot/);
});

test('copying the owner skill setup uses validated base levels and normalized skill names', () => {
  const attack = { getName: () => 'Attack' }, woodcutting = { getName: () => 'Woodcutting' }, bad = { getName: () => 'Sailing' };
  const player = { getSkillManager: () => ({ getMaxLevel: skill => skill === attack ? 72 : skill === woodcutting ? 99 : 0 }) };
  const core = { Skill: { values: () => [attack, woodcutting, bad] } };
  assert.deepEqual(_test.ownerSkillOverrides(player, core), { attack: 72, woodcutting: 99 });
  assert.equal(_test.ownerSkillOverrides({}, core), null);
});

test('::bots registers a developer-only custom interface and opens saved routine choices', () => {
  const activities = [
    { id: 'custom_oak', manual: true, repeat: true, usesAiAgent: false, spawnSetup: { location: { x: 3100, y: 3200, z: 0 }, skills: { woodcutting: 60 }, inventory: [], equipment: [] } },
    { id: 'custom_fishing', manual: true, repeat: false, usesAiAgent: true, spawnSetup: null },
    { id: 'woodcutting', manual: false, repeat: true },
  ];
  const brainRegistry = { activities, byId: new Map(activities.map(activity => [activity.id, activity])), aiAgentAvailable: false };
  const runtime = { entriesByUsername: new Map() };
  const commands = new Map(), actions = [], interfaces = [];
  const api = {
    core: { PlayerRights: { DEVELOPER: DEVELOPER_RIGHT } },
    registerCommand(name, handler, rights, description) { commands.set(name, { handler, rights, description }); },
    registerCustomInterface(definition) { interfaces.push(definition); },
    onInterfaceActionButton(buttons, handler) { actions.push({ buttons, handler }); },
  };
  registerBotsInterface({ api, runtime, brainRegistry });

  assert.equal(interfaces[0].groupId, Layout.GROUP_ID);
  assert.equal(commands.get('bots').rights, DEVELOPER_RIGHT);
  const player = fakePlayer();
  assert.equal(commands.get('bots').handler({ player, parts: ['bots', 'oak'] }), true);
  assert.equal(player.interfaceId, Layout.GROUP_ID);
  assert.equal(player.subInterface.group, Layout.GROUP_ID);
  const rows = JSON.parse(player.strings.get(Layout.uid(Layout.COMPONENT.DATA)));
  assert.deepEqual(rows.map(row => [row.id, row.name]), [[1, 'Fishing'], [2, 'Oak']]);
  assert.equal(player.strings.get(Layout.uid(Layout.COMPONENT.SEARCH_INPUT)), 'oak');
  assert.match(player.strings.get(Layout.uid(Layout.COMPONENT.PANEL_TITLE)), /Fishing|Oak/);

  const rowHandler = actions.find(action => action.buttons.includes(Layout.rowUids[0])).handler;
  const controlHandler = actions.find(action => action.buttons.includes(Layout.uid(Layout.COMPONENT.COUNT_PLUS))).handler;
  rowHandler({ player, slot: 2, opId: 1 });
  assert.equal(_test.sessions.get(player).selectedLauncherKey, 'routine:custom_oak');
  controlHandler({ player, buttonId: Layout.uid(Layout.COMPONENT.COUNT_PLUS) });
  assert.equal(_test.sessions.get(player).count, 2);
  controlHandler({ player, buttonId: Layout.uid(Layout.COMPONENT.LOCATION_LABEL) });
  assert.equal(_test.sessions.get(player).usePlayerLocation, true);
  assert.equal(player.strings.get(Layout.uid(Layout.COMPONENT.LOCATION_INFO)), 'Spawn tile: 3200, 3201, plane 0');
  assert.match(player.strings.get(Layout.uid(Layout.COMPONENT.LOCATION_LABEL)), /saved location/i);
});
