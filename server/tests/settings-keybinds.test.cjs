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
function registered({persistAttribute = () => {}} = {}) {
  const buttons = new Map();
  const events = new Map();
  const logins = [];
  const ids = (id) => (Array.isArray(id) ? id : [id]);
  const api = {
    persistAttribute,
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

test('Hide roofs is saved and sent back on login (the client script flips it too)', () => {
  const { player, click, logins } = allSettings(4);
  assert.deepEqual(click(CLICKZONE, 4), ['varbit 9657=7', 'varbit 12378=1'], 'Hide roofs');
  assert.deepEqual(player.getAttribute('settings:values'), { 'varbit:9656': 4, 'varbit:12378': 1 });
  player.sent.length = 0;
  logins.find((login) => login.name === 'restoreSettings')({ player });
  assert.ok(player.sent.includes('varbit 12378=1'));
});

test('the native master clue warning toggles both ways and survives actual player save/load', () => {
  const {Player} = require('../dist/game/entity/impl/player/Player');
  const {PlayerSave} = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const {buttons, logins} = registered({persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value)});
  const restore = logins.find(login => login.name === 'restoreSettings');
  const settingId = 379, varbit = CacheDefinitions.getVarbitId('option_trail_reminder_master');
  assert.equal(varbit, 10725);
  assert.equal(CacheDefinitions.getStructParams(955).get(1077), settingId);
  const ids = [];
  for (const [, categoryId] of [...CacheDefinitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const category = CacheDefinitions.getStructParams(Number(categoryId));
    for (const [, structId] of [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b))
      ids.push(CacheDefinitions.getStructParams(Number(structId)).get(1077));
  }
  const row = ids.indexOf(settingId); assert.ok(row >= 0, 'the setting is present in native search results');
  let player = new Player(null), sender = recordingPlayer().getPacketSender();
  player.getPacketSender = () => sender;
  for (const value of [1, 0]) {
    buttons.get(SEARCH)({player});
    buttons.get(CLICKZONE)({player, slot: row});
    assert.equal(sender.getVarbit(varbit), value);
    assert.equal(player.getAttribute('settings:values')[`varbit:${varbit}`], value);
    const loaded = new Player(null), nextSender = recordingPlayer().getPacketSender();
    PlayerSave.fromPlayer(player).applyToPlayer(loaded);
    loaded.getPacketSender = () => nextSender;
    restore({player: loaded});
    assert.equal(nextSender.getVarbit(varbit), value, 'login restores enabled and disabled choices');
    player = loaded; sender = nextSender;
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

test('quest-list Settings opens native Interfaces category with controls transmitted', () => {
  const { buttons } = registered();
  const player = recordingPlayer();
  player.setInterfaceId = id => player.sent.push(`interface ${id}`);
  const sender = player.getPacketSender();
  sender.sendSubInterface = () => sender;
  sender.sendInterfaceFlagsRange = () => sender;
  assert.equal(typeof buttons.get((399 << 16) | 11), 'function');
  assert.equal(buttons.get((399 << 16) | 11)({ player }), true);
  assert.equal(player.getAttribute('settings-view'), 6);
  assert.equal(sender.getVarbit(9656), 6);
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

// Chat timestamps (setting 119): a dropdown over Off / On (Server time) / On (Local time) on
// varbit 12384. Live sends 12384=1 at login in 532 of 540 rsprox recordings (revs 236-239), so
// a player who never touched it starts on server time; the row's clientscript 4586 re-applies it.
const CHAT = 2;
const CHAT_TIMESTAMPS = 119;
const CHAT_TIMESTAMPS_VARBIT = 12384;
const CHAT_TIMESTAMPS_SCRIPT = 4586;

function chatRowOf(settingId) {
  const category = CacheDefinitions.getStructParams(Number(CacheDefinitions.getEnumValues(422).get(CHAT)));
  const rows = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b)
    .map(([, struct]) => CacheDefinitions.getStructParams(Number(struct)).get(1077));
  const row = rows.indexOf(settingId);
  assert.ok(row >= 0, `setting ${settingId} is in the Chat category`);
  return row;
}

test('Chat timestamps: choosing an option sets varbit 12384 to it and runs the row\'s clientscript', () => {
  const { click, varbit } = allSettings(CHAT);
  const row = chatRowOf(CHAT_TIMESTAMPS);
  assert.deepEqual(click(CLICKZONE, row), ['varbit 9657=119'], 'a dropdown row only selects');
  assert.deepEqual(click(DROPDOWN, 2 * 3), [`varbit ${CHAT_TIMESTAMPS_VARBIT}=2`, `script ${CHAT_TIMESTAMPS_SCRIPT}`, 'varbit 9657=0'], 'On (Local time)');
  click(CLICKZONE, row);
  assert.deepEqual(click(DROPDOWN, 0), [`varbit ${CHAT_TIMESTAMPS_VARBIT}=0`, `script ${CHAT_TIMESTAMPS_SCRIPT}`, 'varbit 9657=0'], 'Off');
  assert.equal(varbit(CHAT_TIMESTAMPS_VARBIT), 0);
});

test('Chat timestamps: off for a fresh account, and a chosen option is restored at login', () => {
  const { player, logins } = allSettings(CHAT);
  const restore = logins.find((login) => login.name === 'restoreSettings');
  player.sent.length = 0;
  restore({ player });
  assert.ok(!player.sent.includes(`varbit ${CHAT_TIMESTAMPS_VARBIT}=1`), 'fresh account: Off');
  player.setAttribute('settings:values', { [`varbit:${CHAT_TIMESTAMPS_VARBIT}`]: 2 });
  player.sent.length = 0;
  restore({ player });
  assert.ok(player.sent.includes(`varbit ${CHAT_TIMESTAMPS_VARBIT}=2`), 'a chosen On (Local time) is restored');
});

// https://oldschool.runescape.wiki/w/Fletching_training (retrieved 2026-10-27):
// Make-X for darts and bolts defaults to enabled since Easter 2023.
test('dart and bolt Make-X defaults on and restores either saved choice', () => {
  const { player, logins } = allSettings(0);
  const restore = logins.find((login) => login.name === 'restoreSettings');
  const id = CacheDefinitions.getVarbitId('option_fletch_dart_or_bolt_makex');
  restore({ player });
  assert.equal(player.getPacketSender().getVarbit(id), 1);
  for (const choice of [0, 1]) {
    player.setAttribute('settings:values', { [`varbit:${id}`]: choice });
    restore({ player });
    assert.equal(player.getPacketSender().getVarbit(id), choice);
  }
});

/** A sender that keeps varps the way PacketSender does, varbits packed into their varps. */
function varpPlayer({ native = false } = {}) {
  const varps = new Map();
  const flags = [];
  const attributes = new Map(native ? [['native-client', true]] : []);
  const sender = {
    getVarp: (id) => varps.get(id) ?? 0,
    sendConfig: (id, value) => { varps.set(id, value | 0); return sender; },
    sendVarbit: (id, value) => {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = ((1 << (endBit - startBit + 1)) - 1) << startBit;
      varps.set(baseVar, (sender.getVarp(baseVar) & ~mask) | ((value << startBit) & mask));
      return sender;
    },
    sendInterfaceFlagsRange: (uid, from, to, value) => { flags.push([uid, from, to, value]); return sender; },
    sendSubInterface: () => sender,
  };
  return { varps, flags, getPacketSender: () => sender, setAttribute: (k, v) => attributes.set(k, v), getAttribute: (k) => attributes.get(k) };
}

const XPDROPS_SETUP = 137;
const XPDROPS_VARP = 1227;

test('XP drops setup: a dropdown row sets its varbit to the row - 1 (script 1036), and the varp is kept', () => {
  const { buttons, logins } = registered();
  const player = varpPlayer({ native: true });
  const position = buttons.get((XPDROPS_SETUP << 16) | 51);
  assert.ok(position, 'the position dropdown is handled');
  assert.equal(position({ player, buttonId: (XPDROPS_SETUP << 16) | 51, slot: 3 }), true);
  assert.equal(buttons.get((XPDROPS_SETUP << 16) | 54)({ player, buttonId: (XPDROPS_SETUP << 16) | 54, slot: 6 }), true);
  const varp = player.varps.get(XPDROPS_VARP);
  assert.equal(varp & 0b11, 2, 'varbit 4692 (position, bits 0-1) = row 3 - 1');
  assert.equal((varp >>> 22) & 0b11111, 5, 'varbit 4697 (counter, bits 22-26) = row 6 - 1');
  assert.equal(position({ player, buttonId: (XPDROPS_SETUP << 16) | 51, slot: 0 }), false, 'the list itself');

  // Another session of the same account gets it back at login.
  const next = varpPlayer({ native: true });
  next.setAttribute('settings:xpdrops-setup', player.getAttribute('settings:xpdrops-setup'));
  logins.forEach((login) => login({ player: next }));
  assert.equal(next.varps.get(XPDROPS_VARP), varp);
});

test('XP drops setup: the browser transmits the whole varp, which is kept and echoed', () => {
  const { events, logins } = registered();
  const player = varpPlayer();
  const transmission = { player, varpId: XPDROPS_VARP, value: 0x1234, handled: false };
  events.get('player:varp-transmit')(transmission);
  assert.equal(transmission.handled, true);
  assert.equal(player.varps.get(XPDROPS_VARP), 0x1234);
  const other = { player, varpId: 173, value: 1, handled: false };
  events.get('player:varp-transmit')(other);
  assert.equal(other.handled, false, 'not an XP drops varp');

  const next = varpPlayer();
  next.setAttribute('settings:xpdrops-setup', player.getAttribute('settings:xpdrops-setup'));
  logins.forEach((login) => login({ player: next }));
  assert.equal(next.varps.get(XPDROPS_VARP), 0x1234);
});

test('a volume slider released sets the stored volume from its trigger argument', () => {
  const { buttons } = registered();
  const applied = [];
  const player = { applyAudioSettingFromClient: (varp, value) => applied.push([varp, value]) };
  const sliders = [[95, 3796], [109, 168], [123, 169], [137, 872]];
  for (const [component, varp] of sliders) {
    const buttonId = (116 << 16) | component;
    // 70 is zigzag 35; the scripts trigger on release and when the volume reaches or leaves 0.
    assert.equal(buttons.get(buttonId)({ player, buttonId, argsData: Buffer.from([70]), scriptTrigger: true }), true, `slider ${component}`);
    assert.deepEqual(applied.pop(), [varp, 35]);
  }
  const music = (116 << 16) | 109;
  assert.equal(buttons.get(music)({ player, buttonId: music, argsData: Buffer.from([70]), scriptTrigger: false }), false, 'a click is not the trigger');
  assert.equal(applied.length, 0);
});

test('an All Settings volume slider stores its volume, not a click on its row', () => {
  const { buttons } = registered();
  const applied = [];
  const player = { applyAudioSettingFromClient: (varp, value) => applied.push([varp, value]), getAttribute: () => undefined, setAttribute: () => {} };
  const list = (134 << 16) | 20;
  // Scripts 9260-9278 trigger the row with the setting (30: music) and the volume, zigzag varints.
  assert.equal(buttons.get(list)({ player, buttonId: list, slot: 7, argsData: Buffer.from([60, 84]), scriptTrigger: true }), true);
  assert.deepEqual(applied, [[168, 42]]);
  // A setting that isn't a volume is left alone.
  assert.equal(buttons.get(list)({ player, buttonId: list, slot: 7, argsData: Buffer.from([2, 84]), scriptTrigger: true }), false);
  assert.equal(applied.length, 1);
});

test('the mute buttons save the volume and restore it, as live does', () => {
  const { buttons } = registered();
  const audio = { 168: 8, 169: 65, 872: 100, 3796: 100, 3109: 0, 3797: 0 };
  const sent = [];
  const player = {
    getAudioSettings: () => audio,
    setAudioSetting: (varp, value) => { audio[varp] = value; return true; },
    applyAudioSettingFromClient: (varp, value) => { audio[varp] = value; return true; },
    getPacketSender: () => ({ sendConfig: (varp, value) => sent.push([varp, value]) }),
  };
  const click = (component) => {
    const buttonId = (116 << 16) | component;
    assert.equal(buttons.get(buttonId)({ player, buttonId }), true, `mute ${component}`);
  };
  // A live capture: music at 8, then its mute (116:110): 3109 = 8, then 168 = 0.
  click(110);
  assert.deepEqual(sent.splice(0), [[3109, 8], [168, 0]]);
  // Sound effects keep their own bits (8-14) of 3109, beside music's saved level.
  click(124);
  assert.deepEqual(sent.splice(0), [[3109, 8 | (65 << 8)], [169, 0]]);
  // Unmuting puts the saved level back.
  click(110);
  assert.deepEqual(sent.splice(0), [[168, 8]]);
  click(124);
  assert.deepEqual(sent.splice(0), [[169, 65]]);
  // Master saves into 3797.
  click(96);
  assert.deepEqual(sent.splice(0), [[3797, 100], [3796, 0]]);
});

test('the volume sliders get the transmit-trigger event at login, so the client sends their triggers', async () => {
  const { logins } = registered();
  const flags = [];
  const sender = new Proxy({ sendInterfaceFlagsRange: (uid, from, to, value) => flags.push([uid >>> 16, uid & 0xffff, from, to, value]) }, { get: (t, k) => (k in t ? t[k] : () => sender) });
  const player = new Proxy({ getPacketSender: () => sender, getAttribute: () => undefined }, { get: (t, k) => (k in t ? t[k] : () => undefined) });
  for (const login of logins) { try { login({ player }); } catch {} }
  await new Promise((resolve) => setImmediate(resolve));
  const sliders = flags.filter(([group]) => group === 116).map(([, component, from, to, value]) => [component, from, to, value]);
  assert.deepEqual(sliders.sort((a, b) => a[0] - b[0]), [95, 109, 123, 137].map((component) => [component, -1, -1, 1 << 23]));
});

test('"Shift click to drop items" (setting 51) starts on and is a plain toggle', () => {
  assert.equal(CacheDefinitions.getVarbitId('desktop_shiftclickdrop_enabled'), 11556);
  const { player, click, logins } = allSettings('search');
  const restore = logins.find((login) => login.name === 'restoreSettings');
  restore({ player });
  assert.ok(player.sent.includes('varbit 11556=1'), 'a fresh account has shift-click drop on');
  const ids = [];
  for (const [, categoryId] of [...CacheDefinitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const category = CacheDefinitions.getStructParams(Number(categoryId));
    for (const [, structId] of [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b))
      ids.push(CacheDefinitions.getStructParams(Number(structId)).get(1077));
  }
  const row = ids.indexOf(51);
  assert.ok(row >= 0, 'the setting is in the search results');
  assert.equal(click(CLICKZONE, row).at(-1), 'varbit 11556=0', 'the first click turns it off');
  player.sent.length = 0;
  restore({ player });
  assert.ok(player.sent.includes('varbit 11556=0') && !player.sent.includes('varbit 11556=1'), 'login keeps it off');
});
