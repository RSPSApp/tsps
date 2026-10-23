// Run after `yarn build`: node --test tests/settings-keybinds.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const Settings = require('../plugins/interface/Settings.plugin');

const CONTROLS = 3;
const COMBAT_KEY = 4675;
const INVENTORY_KEY = 4678;

function viewing(view) {
  const attributes = new Map([['settings-view', view]]);
  return { getAttribute: (key) => attributes.get(key) };
}

before(async () => {
  await CachePipeline.initialize();
});

test('All Settings > Controls: rows 27-40 are the keybinds (cache enum 1562)', () => {
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 27), COMBAT_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 36), INVENTORY_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 26), -1, 'the "external keyboard" note');
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 41), -1, 'Restore default keybinds');
});

test('the same row in another category is not a keybind', () => {
  assert.equal(Settings.keybindVarbitForRow(viewing(0), 27), -1);
});

test('search results number rows across every category, so the keybinds come after the first three', () => {
  const before = [0, 1, 2].reduce((rows, index) => {
    const category = CacheDefinitions.getStructParams(Number(CacheDefinitions.getEnumValues(422).get(index)));
    return rows + CacheDefinitions.getEnumValues(Number(category.get(745))).size;
  }, 0);
  assert.ok(before + 27 > 63, 'past the old 0..63 transmit range');
  assert.equal(Settings.keybindVarbitForRow(viewing(-1), before + 27), COMBAT_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(-1), before + 36), INVENTORY_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(-1), 27), -1, 'row 27 of search is not Controls row 27');
});

/** The Settings plugin registered on a fake api; returns its button handlers and custom events. */
function registered() {
  const buttons = new Map();
  const events = new Map();
  const logins = [];
  const ids = (id) => (Array.isArray(id) ? id : [id]);
  const api = {
    onInterfaceActionButton: (id, handler) => ids(id).forEach((one) => buttons.set(one, handler)),
    onCustomEvent: (name, handler) => events.set(name, handler),
    onPlayerLogin: (handler) => logins.push(handler),
    core: { CacheDefinitions },
  };
  Settings.register(new Proxy(api, { get: (target, prop) => (prop in target ? target[prop] : () => {}) }));
  return { buttons, events, logins };
}

function recordingPlayer() {
  const sent = [];
  const attributes = new Map();
  const vars = new Map();
  const sender = {
    sendVarbit: (id, value) => { vars.set(`varbit ${id}`, value); sent.push(`varbit ${id}=${value}`); return sender; },
    sendConfig: (id, value) => { vars.set(`varp ${id}`, value); sent.push(`varp ${id}=${value}`); return sender; },
    getVarbit: (id) => vars.get(`varbit ${id}`) ?? 0,
    getVarp: (id) => vars.get(`varp ${id}`) ?? 0,
    sendClientScript: (id) => { sent.push(`script ${id}`); return sender; },
  };
  return { sent, getPacketSender: () => sender, setAttribute: (k, v) => attributes.set(k, v), getAttribute: (k) => attributes.get(k) };
}

test('as captured: the search bar takes the keyboard, and closing All Settings by any route gives it back', () => {
  const { buttons, events } = registered();
  const player = recordingPlayer();
  buttons.get((134 << 16) | 11)({ player });
  assert.deepEqual(player.sent, ['varbit 16073=1', 'varbit 16074=1', 'script 4020']);
  player.sent.length = 0;
  events.get('interface:closed')({ player, interfaceId: 134 });
  assert.deepEqual(player.sent, ['varbit 16073=0', 'varbit 16074=0', 'script 2158']);
  player.sent.length = 0;
  events.get('interface:closed')({ player, interfaceId: 12 });
  assert.deepEqual(player.sent, [], 'closing anything else leaves them alone');
});

test('XP orb mounts the counter only while enabled, and Setup opens the cached settings', () => {
  const { buttons, logins } = registered();
  const player = recordingPlayer();
  const sender = player.getPacketSender();
  sender.sendSubInterface = (uid, group, type) => { player.sent.push(`open ${uid}:${group}:${type}`); return sender; };
  sender.closeSubInterface = (uid) => { player.sent.push(`close ${uid}`); return sender; };
  const click = buttons.get((160 << 16) | 6);
  assert.equal(buttons.get((897 << 16) | 2), click, "orbs_osm:xp_drops, the mobile orb, as well");
  logins[0]({ player });
  assert.deepEqual(player.sent, ['varbit 4702=0'], 'fresh accounts have XP drops off');
  player.sent.length = 0;
  click({ player, opId: 1 });
  assert.equal(player.getAttribute('xp-drops:enabled'), true);
  assert.deepEqual(player.sent, ['varbit 4702=1', `open ${(161 << 16) | 9}:122:1`]);
  player.sent.length = 0;
  logins[0]({ player });
  assert.deepEqual(player.sent, ['varbit 4702=1'], 'login restores the saved toggle before bootstrap');
  player.sent.length = 0;
  click({ player, opId: 1 });
  assert.deepEqual(player.sent, ['varbit 4702=0', `close ${(161 << 16) | 9}`]);
  player.sent.length = 0;
  click({ player, opId: 2 });
  assert.deepEqual(player.sent, [`open ${(161 << 16) | 16}:137:0`]);
  assert.equal(player.getAttribute('xp-drops:enabled'), false);
  player.sent.length = 0;
  assert.equal(click({ player, opId: 3 }), false);
  assert.deepEqual(player.sent, []);
});

test('both close routes announce interface:closed with the interface that closed', () => {
  const { PacketSender } = require('../dist/net/packet/PacketSender');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const emitted = [];
  const emit = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => emitted.push([name, payload.interfaceId]);
  try {
    for (const route of ['sendInterfaceRemoval', 'closeInterruptibleInterfaces']) {
      PacketSender.prototype[route].call({
        player: {},
        resetInterfaceState: () => 134,
        closeTrackedInterfaces: () => true,
        endBankSearch: () => {},
        sendSubInterface: () => {},
        emitInterfaceClosed: PacketSender.prototype.emitInterfaceClosed,
      });
    }
  } finally {
    PluginManager.emitCustomEvent = emit;
  }
  assert.deepEqual(emitted, [['interface:closed', 134], ['interface:closed', 134]]);
});

const CLICKZONE = (134 << 16) | 20;
const DROPDOWN = (134 << 16) | 29;
const DROPDOWN_CLOSE = (134 << 16) | 26;
const CATEGORIES = (134 << 16) | 24;
const SEARCH = (134 << 16) | 11;

/** The All Settings handlers and a player looking at them, starting on `category`. */
function allSettings(category) {
  const { buttons, logins } = registered();
  const player = recordingPlayer();
  const click = (component, slot) => { player.sent.length = 0; buttons.get(component)({ player, slot }); return player.sent; };
  if (category === 'search') click(SEARCH);
  else click(CATEGORIES, category);
  return { player, click, logins, varbit: (id) => player.getPacketSender().getVarbit(id) };
}

test('as captured: "Level-up pop-up notifications" from search results, each option', () => {
  const { player, click, varbit } = allSettings('search');
  // Search result 301 is setting 315; its category (Interfaces, 6) is shown behind the results.
  assert.deepEqual(click(CLICKZONE, 301), ['varbit 9657=315', 'varbit 9656=6']);
  const options = { 2: [1, 0], 5: [0, 0], 8: [0, 1] };
  for (const [button, [disabled, list]] of Object.entries(options)) {
    click(CLICKZONE, 301);
    const sent = click(DROPDOWN, Number(button));
    assert.equal(varbit(20157), disabled, `option ${button / 3 | 0}: option_level_up_message_disabled`);
    assert.equal(varbit(4371), list, `option ${button / 3 | 0}: option_level_up_popup_list`);
    assert.equal(sent.at(-1), 'varbit 9657=0', 'the selection clears after the vars change');
  }
  assert.deepEqual(player.getAttribute('settings:values'), { 'varbit:9656': 6, 'varbit:20157': 0, 'varbit:4371': 1 });
});

test('as captured: the level-up chatbox and guide lists are toggles beside it', () => {
  const { click, varbit } = allSettings('search');
  assert.deepEqual(click(CLICKZONE, 302), ['varbit 9657=493', 'varbit 9656=6', 'varbit 20158=1']);
  click(CLICKZONE, 302);
  assert.equal(varbit(20158), 0);
  assert.deepEqual(click(CLICKZONE, 303), ['varbit 9657=494', 'varbit 9656=6', 'varbit 20159=1']);
});

test('as captured: a category click ends the search', () => {
  const { click } = allSettings('search');
  assert.deepEqual(click(CATEGORIES, 0), ['varbit 16073=0', 'varbit 16074=0', 'varbit 9656=0', 'varbit 9657=0', 'script 2158']);
  assert.deepEqual(click(CATEGORIES, 2), ['varbit 9656=2', 'varbit 9657=0'], 'not searching: no search varbits');
});

test('as captured: toggles in a category flip their var; split private chat runs its script', () => {
  const { click } = allSettings(0);
  assert.deepEqual(click(CLICKZONE, 47), ['varbit 9657=5', 'varbit 10236=1'], 'Hitsplat tinting');
  assert.deepEqual(click(CLICKZONE, 47), ['varbit 9657=5', 'varbit 10236=0']);
  click(CATEGORIES, 2);
  assert.deepEqual(click(CLICKZONE, 5), ['varbit 9657=35', 'varp 287=1', 'script 83'], 'Split friends private chat');
});

// Regression adapted from Bandit-HaxUnit's upstream PR #825.
test('Hide roofs saves both choices and restores them on login', () => {
  const { player, click, logins } = allSettings(4);
  const restore = logins.find(login => login.name === 'restoreSettings');
  for (const expected of [1, 0]) {
    assert.deepEqual(click(CLICKZONE, 4), ['varbit 9657=7', `varbit 12378=${expected}`]);
    assert.equal(player.getAttribute('settings:values')['varbit:12378'], expected);
    const restored = recordingPlayer();
    restored.setAttribute('settings:values', structuredClone(player.getAttribute('settings:values')));
    restore({ player: restored });
    assert.equal(restored.getPacketSender().getVarbit(12378), expected);
    assert.ok(restored.sent.includes(`varbit 12378=${expected}`), 'login explicitly restores disabled as well as enabled');
  }
});

test('as captured: a dropdown that sets one varbit to the option, and closing a dropdown', () => {
  const { click, varbit } = allSettings(0);
  click(CLICKZONE, 67);
  assert.deepEqual(click(DROPDOWN, 5), ['varbit 11865=1', 'varbit 9657=0'], 'LMS fog colour: Green');
  click(CLICKZONE, 67);
  assert.equal(click(DROPDOWN, 3 * 6 + 2).length, 0, 'the enum has six options');
  assert.deepEqual(click(DROPDOWN_CLOSE), ['varbit 9657=0']);
  assert.equal(varbit(11865), 1);
});

test('as captured: a keybind dropdown still binds its key', () => {
  const { click, varbit } = allSettings(3);
  assert.deepEqual(click(CLICKZONE, 40), ['varbit 9657=29']);
  assert.deepEqual(click(DROPDOWN, 41).slice(-2), ['varbit 4689=13', 'varbit 9657=0'], 'Logout: Esc');
  assert.equal(varbit(4689), 13);
});

test('login sends back every setting the player changed', () => {
  const { player, logins } = allSettings(0);
  player.setAttribute('settings:values', { 'varbit:20157': 1, 'varp:287': 0 });
  player.sent.length = 0;
  logins.find((login) => login.name === 'restoreSettings')({ player });
  assert.ok(player.sent.includes('varbit 20157=1'));
  assert.ok(player.sent.includes('varp 287=0'));
});

test('quest-list Settings opens Quest List search and dispatches global result rows', () => {
  const { buttons, events } = registered();
  const player = recordingPlayer();
  player.setInterfaceId = id => player.sent.push(`interface ${id}`);
  const sender = player.getPacketSender();
  sender.sendSubInterface = () => { player.sent.push('open settings'); return sender; };
  sender.sendInterfaceFlagsRange = () => sender;
  sender.sendClientScript = (id, ...args) => { player.sent.push(`script ${id}${args.length ? ':' + args.join(',') : ''}`); return sender; };
  assert.equal(typeof buttons.get((399 << 16) | 11), 'function');
  assert.equal(buttons.get((399 << 16) | 11)({ player }), true);
  assert.equal(player.getAttribute('settings-view'), -1);
  assert.equal(sender.getVarbit(9656), 6);
  assert.equal(sender.getVarbit(9648), 1);
  assert.equal(sender.getVarbit(16073), 1);
  assert.equal(sender.getVarbit(16074), 1);
  assert.ok(player.sent.indexOf('open settings') < player.sent.indexOf('script 5968:Quest List'));
  assert.ok(player.sent.indexOf('varbit 16074=1') < player.sent.indexOf('script 5968:Quest List'));
  assert.ok(player.sent.indexOf('script 5968:Quest List') < player.sent.indexOf('script 4020'));
  // Global search result301 is setting315, unlike Interfaces category row301.
  player.sent.length = 0;
  buttons.get(CLICKZONE)({ player, slot: 301 });
  assert.ok(player.sent.includes('varbit 9657=315'));
  events.get('interface:closed')({ player, interfaceId: 134 });
  assert.equal(sender.getVarbit(16073), 0);
  assert.equal(sender.getVarbit(16074), 0);
  assert.ok(player.sent.includes('script 2158'));
});

test('quest colour picker saves RGB+1, accepts black, rejects invalid amounts and resets defaults', () => {
  const { buttons } = registered();
  const player = recordingPlayer();
  player.setAttribute('settings-view', 6);
  let amount;
  player.setEnteredAmountAction = action => { amount = action; };
  const sender = player.getPacketSender();
  sender.sendSubInterface = () => sender;
  sender.closeSubInterface = () => sender;
  const row = buttons.get((134 << 16) | 20);
  row({ player, slot: 51 });
  assert.ok(amount, 'native colour modal arms its resume-count handler');
  assert.equal(amount.acceptsZero, true);
  amount.execute(0);
  assert.equal(sender.getVarp(3410), 1, 'black is a real colour');
  row({ player, slot: 51 });
  amount.execute(0x1000000);
  assert.equal(sender.getVarp(3410), 1, 'out of range colour ignored');
  row({ player, slot: 51 });
  assert.equal(amount.acceptsNegative, true);
  amount.execute(-1);
  assert.equal(sender.getVarp(3410), 0, 'native Default colour restores cache default');
  row({ player, slot: 55 });
  assert.equal(sender.getVarp(3410), 0, 'zero selects cache default');
});

test('all native quest preferences are mapped, constrained and restored including colours', () => {
  const { buttons, logins } = registered();
  const player = recordingPlayer();
  player.setAttribute('settings-view', 6);
  const click = buttons.get((134 << 16) | 20);
  const option = buttons.get((134 << 16) | 29);
  for (const [slot, id] of [[42,13776],[43,13775],[44,13777],[45,13773],[46,13774],[47,13890],[49,13889],[50,13781]]) {
    assert.equal(click({ player, slot }), true);
    assert.equal(player.getPacketSender().getVarbit(id), 1);
  }
  for (const [slot, id, count] of [[39,13772,12],[40,13778,3],[41,13779,3],[48,13780,2]]) {
    click({ player, slot });
    for (let index=0;index<count;index++) {
      click({ player, slot });
      assert.equal(option({ player, slot:index*3 }), true);
      assert.equal(player.getPacketSender().getVarbit(id), index);
    }
    click({ player, slot });
    assert.equal(option({ player, slot:count*3 }), false);
  }
  const saved = structuredClone(player.getAttribute('settings:values'));
  const restored = recordingPlayer();
  restored.setAttribute('settings:values', saved);
  for (const login of logins.slice(1)) login({player:restored});
  for (const [key,value] of Object.entries(saved)) {
    const [kind,id]=key.split(':');
    assert.equal(kind==='varp' ? restored.getPacketSender().getVarp(+id) : restored.getPacketSender().getVarbit(+id), value);
  }
});

test('quest cache sort modes, status/requirements filters, empty lists and hidden headers', () => {
  const {questListGroups} = require('../plugins/quests/QuestList.QuestRuntime');
  const vars=new Map();
  const player={getAttribute:()=>0,getPacketSender:()=>({getVarbit:id=>vars.get(id)??0}),getSkillManager:()=>({getMaxLevels:()=>1,getCombatLevel:()=>3})};
  const quests=[{key:'animal',name:'Animal Magnetism',status:1},{key:'below',name:'Below Ice Mountain',status:0},{key:'bar',name:"Alfred Grimhand's Barcrawl",status:2}];
  const groups=()=>questListGroups(quests,player,CacheDefinitions,q=>q.status);
  const rows=()=>groups().flatMap(g=>g.quests);
  for(let sort=0;sort<12;sort++){
    vars.set(13772,sort);
    const result=groups();
    assert.equal(rows().length,3,`sort ${sort} retains all entries`);
    assert.ok(result.every(g=>g.title.length>0),`sort ${sort} produces a real group label`);
  }
  vars.set(13772,3);
  assert.ok(groups().some(g=>g.title==='Novice'));
  vars.set(13772,11);
  assert.ok(groups().some(g=>g.title==='Free Quests'));
  vars.set(13778,1);
  assert.equal(rows().find(q=>q.quest.key==='animal').status,3,'missing requirements shown as unavailable');
  vars.set(13890,1);
  assert.ok(!rows().some(q=>q.quest.key==='animal'),'unavailable filter excludes the row');
  vars.set(13890,0);vars.set(13778,2);
  assert.ok(!rows().some(q=>q.quest.key==='animal'),'hide requirements filter excludes the row');
  vars.set(13778,0);vars.set(13779,2);
  assert.ok(!rows().some(q=>q.quest.key==='below'),'recommended combat filter uses cache metadata');
  vars.set(13779,0);vars.set(13889,1);
  assert.deepEqual(groups().map(g=>g.title),['']);
  vars.set(13775,1);vars.set(13776,1);vars.set(13777,1);
  assert.deepEqual(groups(),[],'all statuses filtered yields an empty list');
  vars.clear();vars.set(13772,1);
  const ties=questListGroups([{key:'z',name:'Animal Magnetism',status:1},{key:'a',name:'Animal Magnetism',status:1}],player,CacheDefinitions,q=>q.status);
  assert.deepEqual(ties[0].quests.map(q=>q.quest.key),['a','z'],'equal names use stable quest keys');
});

test('quest requirements translate cache stat ids to Skill objects including Hunter/Construction', () => {
  const {questListGroups,metadata}=require('../plugins/quests/QuestList.QuestRuntime');
  const {Skill}=require('../dist/game/model/Skill');
  const ids=[];
  const player={getAttribute:()=>9999,getPacketSender:()=>({getVarbit:id=>id===13778?2:0}),getSkillManager:()=>({getMaxLevel:skill=>{ids.push(skill.getClientId());return 99;},getCombatLevel:()=>126})};
  const records=[...metadata(CacheDefinitions).values()];
  const names=records.filter(r=>r.requirement_stats?.some((v,i)=>i%2===0&&(v===21||v===22))).map(r=>({key:r.rowId.toString(),name:r.displayname[0],status:1}));
  questListGroups(names,player,CacheDefinitions,q=>q.status,Skill);
  assert.ok(ids.includes(21),'Hunter uses its client id');
  assert.ok(ids.includes(22),'Construction uses its client id');
});

test('closing or replacing a quest colour picker invalidates only its owned amount callback', () => {
  const {buttons,events}=registered();
  const player=recordingPlayer();let amount;
  player.setAttribute('settings-view',6);
  player.setEnteredAmountAction=action=>{amount=action;};
  player.getEnteredAmountAction=()=>amount;
  const sender=player.getPacketSender();
  sender.sendSubInterface=()=>sender;sender.closeSubInterface=()=>sender;
  const click=buttons.get((134<<16)|20);
  click({player,slot:51});const stale=amount;
  events.get('interface:closed')({player,interfaceId:134});
  assert.equal(amount,null,'closing clears the owned prompt');
  stale.execute(123);
  assert.equal(sender.getVarp(3410),0,'late reply cannot write a closed picker');
  click({player,slot:51});const old=amount;
  click({player,slot:52});old.execute(123);
  assert.equal(sender.getVarp(3410),0,'replaced picker cannot mutate its colour');
  const unrelated={execute(){}};amount=unrelated;
  events.get('interface:closed')({player,interfaceId:288});
  assert.equal(amount,unrelated,'unrelated amount prompt is preserved');
});
