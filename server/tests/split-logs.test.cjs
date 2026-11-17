// Run after `yarn build`: node --test tests/split-logs.test.cjs
// The Neitiznot woodcutting stump (iznot_shield_stump) against rsprox.net recording 3027 (rev 231, ticks 8906-11229)
// and the Wiki's Split log page: Cut-wood opens "How many do you wish to make?" (Neitiznot shield, Arctic pine split
// log); a split log is made 2 ticks after the choice, then every 3, one log in its own slot, with the spam line, the
// axe's woodcrafting sequence, sound 2101 and 5 Woodcutting XP. No arctic pine: "Only arctic pine may be cut here."
// Real engine: every plugin loaded, a real Player, the stump's named Cut-wood hook through PluginManager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9700;
const shieldOutputs = new WeakMap();
const STUMP = { x: 2342, y: 3807, z: 0 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register(PM.createApi("ItemDefinitionLoader"));
  require("../plugins/skills/Woodcutting.plugin").register(PM.createApi("Woodcutting"));
  require("../plugins/quests/quests/TheFremennikIsles.Quest")(PM.createApi("Quests"));
  PM.createApi("ShieldOutputObserver").onCustomEvent("fremennik-isles:shield-made", ({player}) => {
    shieldOutputs.set(player, (shieldOutputs.get(player) ?? 0) + 1);
  });
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, { level = 99, items = [[I.DRAGON_AXE, 1], [I.ARCTIC_PINE_LOGS, 4]] } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("split" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(STUMP.x, STUMP.y + 1, STUMP.z));
  const sm = p.getSkillManager();
  sm.setExperiences(core.Skill.WOODCUTTING, core.SkillManager.getExperienceForLevel(level), false);
  sm.setMaxLevel(core.Skill.WOODCUTTING, level); sm.setCurrentLevels(core.Skill.WOODCUTTING, level);
  for (const [id, amount] of items) p.getInventory().add(new core.Item(id, amount), true);
  const log = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => { log.push(`message ${message}`); return sender; });
  const typed = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, "sendTypedMessage", (type, message) => { log.push(`${type === core.ChatType.SPAM ? "spam" : "typed"} ${message}`); return typed(type, message); });
  t.mock.method(sender, "sendSoundEffect", (id) => { log.push(`sound ${id}`); return sender; });
  t.mock.method(p, "performAnimation", (animation) => { log.push(`seq ${animation.getId()}`); });
  t.after(() => { core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  return { p, log };
}

function cutWood(p) {
  const objectId = core.ObjectIdentifiers.WOODCUTTING_STUMP;
  const definition = core.ObjectDefinition.forId(objectId);
  assert.equal(definition.getName(), "Woodcutting stump");
  const clickType = definition.getActions().findIndex((name) => name === "Cut-wood") + 1;
  assert.ok(clickType > 0);
  return PM.emitObjectInteraction({
    player: p, object: new core.GameObject(objectId, new core.Location(STUMP.x, STUMP.y, STUMP.z), 10, 0), objectId, definition,
    location: STUMP, clickType, option: "Cut-wood", handled: false,
  });
}

/** Runs the task manager `ticks` times and returns, per tick, what the player got. */
function run(log, ticks) {
  const out = [];
  for (let tick = 1; tick <= ticks; tick++) {
    const from = log.length;
    core.TaskManager.process();
    out.push(log.slice(from));
  }
  return out;
}

test("Cut-wood with arctic pine opens the captured skillmulti", (t) => {
  const { p } = actor(t);
  assert.equal(cutWood(p), true);
  const menu = p.getCreationMenu();
  assert.equal(menu.getTitle(), "How many do you wish to make?");
  assert.deepEqual(menu.getItems(), [I.NEITIZNOT_SHIELD, I.SPLIT_LOG]);
  assert.deepEqual(menu.getOptions().labels, ["Neitiznot shield", "Arctic pine split log"]);
  assert.equal(menu.getOptions().maxAmount, 4);
  assert.equal(menu.getOptions().mode, 0);
});

test("Cut-wood without arctic pine sends the captured refusal and no menu", (t) => {
  const { p, log } = actor(t, { items: [[I.DRAGON_AXE, 1], [I.YEW_LOGS, 2]] });
  assert.equal(cutWood(p), true);
  assert.equal(p.getCreationMenu() ?? null, null);
  assert.deepEqual(log, ["message Only arctic pine may be cut here."]);
});

test("split logs: 2 ticks after the choice, then every 3, each log in its own slot", (t) => {
  const { p, log } = actor(t);
  const logSlots = p.getInventory().getItems().map((item, slot) => (item?.getId() === I.ARCTIC_PINE_LOGS ? slot : -1)).filter((s) => s >= 0);
  const xp = p.getSkillManager().getExperience(core.Skill.WOODCUTTING);
  cutWood(p);
  p.getCreationMenu().execute(I.SPLIT_LOG, 4);
  const dragonSeq = core.CacheDefinitions.getSeqId("human_woodcrafting_axe_dragon");
  const perItem = ["spam You split some arctic pine logs.", `seq ${dragonSeq}`, "sound 2101"];
  const ticks = run(log, 12);
  const made = ticks.map((events, i) => (events.length ? i + 1 : null)).filter(Boolean);
  assert.deepEqual(made, [2, 5, 8, 11], "first split 2 ticks after the choice, then every 3 ticks");
  for (const tick of made) assert.deepEqual(ticks[tick - 1], perItem);
  assert.equal(p.getInventory().getAmount(I.ARCTIC_PINE_LOGS), 0);
  assert.equal(p.getInventory().getAmount(I.SPLIT_LOG), 4);
  for (const slot of logSlots) assert.equal(p.getInventory().getItems()[slot].getId(), I.SPLIT_LOG, "split in the log's own slot");
  assert.equal(p.getSkillManager().getExperience(core.Skill.WOODCUTTING) - xp, 20, "5 Woodcutting XP per log");
});

test("the chosen amount stops the loop, and walking away ends it", (t) => {
  const { p, log } = actor(t);
  cutWood(p);
  p.getCreationMenu().execute(I.SPLIT_LOG, 1);
  run(log, 10);
  assert.equal(p.getInventory().getAmount(I.SPLIT_LOG), 1);
  assert.equal(p.getInventory().getAmount(I.ARCTIC_PINE_LOGS), 3);
  cutWood(p);
  p.getCreationMenu().execute(I.SPLIT_LOG, 3);
  run(log, 2);
  assert.equal(p.getInventory().getAmount(I.SPLIT_LOG), 2);
  p.setLocation(new core.Location(STUMP.x + 1, STUMP.y + 1, STUMP.z));
  run(log, 10);
  assert.equal(p.getInventory().getAmount(I.SPLIT_LOG), 2, "moving off the tile stops splitting");
});

test("splitting needs 56 Woodcutting and an axe", (t) => {
  for (const [level, items] of [[55, [[I.DRAGON_AXE, 1], [I.ARCTIC_PINE_LOGS, 2]]], [99, [[I.ARCTIC_PINE_LOGS, 2]]]]) {
    const { p, log } = actor(t, { level, items });
    cutWood(p);
    p.getCreationMenu().execute(I.SPLIT_LOG, 2);
    run(log, 8);
    assert.equal(p.getInventory().getAmount(I.SPLIT_LOG), 0);
    assert.equal(p.getInventory().getAmount(I.ARCTIC_PINE_LOGS), 2);
    assert.equal(log.length, 1, "one refusal line");
  }
});

test("each split requires a usable axe and current level, and uses the current axe", (t) => {
  for (const change of ["axe", "level", "replacement"]) {
    const { p, log } = actor(t, { level: 56, items: [[I.BRONZE_AXE, 1], [I.ARCTIC_PINE_LOGS, 4]] });
    cutWood(p);
    p.getCreationMenu().execute(I.SPLIT_LOG, 4);
    run(log, 2);
    if (change === "level") p.getSkillManager().setCurrentLevels(core.Skill.WOODCUTTING, 55);
    else {
      p.getInventory().delete(I.BRONZE_AXE, 1);
      if (change === "replacement") p.getInventory().add(new core.Item(I.IRON_AXE, 1), true);
    }
    const ticks = run(log, 3);
    assert.equal(p.getInventory().getAmount(I.SPLIT_LOG), change === "replacement" ? 2 : 1, change);
    if (change === "replacement") {
      assert.ok(ticks[2].includes(`seq ${core.CacheDefinitions.getSeqId("human_woodcrafting_axe_iron")}`));
    }
  }
});

test("interaction replacement and emotes interrupt splitting", (t) => {
  for (const event of ["player:interaction-cleared", "player:emote"]) {
    const { p, log } = actor(t);
    cutWood(p);
    p.getCreationMenu().execute(I.SPLIT_LOG, 4);
    run(log, 2);
    PM.emitCustomEvent(event, { player: p, reason: "item" });
    run(log, 9);
    assert.equal(p.getInventory().getAmount(I.SPLIT_LOG), 1, event);
  }
});

test("the shield choice without the parts sends the captured line", (t) => {
  const { p, log } = actor(t);
  cutWood(p);
  p.getCreationMenu().execute(I.NEITIZNOT_SHIELD, 1);
  assert.deepEqual(log, ["message You need 2 arctic pine logs, a bronze nail and some rope to make a Neitiznot shield."]);
  assert.equal(p.getInventory().getAmount(I.ARCTIC_PINE_LOGS), 4);
});

// This catches dropped menu quantities, immediate output, the carried-shield gate and missing XP.
async function send(p, packet) {
  const {ClientConnection}=require('../dist/net/NetworkBuilder');
  const c=new ClientConnection({kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}}); c.player=p;
  await c.dispatch([packet]);
  c.processTurnPackets();
}
async function chooseShield(p, amount, split=false) {
  await send(p,{type:'dialogue_continue',widgetId:(270<<16)|(require('../dist/net/packet/PacketSender').CREATION_MENU_FIRST_ITEM_COMPONENT+(split?1:0)),childIndex:amount});
}
function shieldActor(t, {stage=17, level=56, held=0, logs=4, nails=2, ropes=2, hammer=true}={}) {
  const items=[[I.ARCTIC_PINE_LOGS,logs],[I.BRONZE_NAILS,nails],[I.ROPE,ropes]];
  if(hammer) items.push([I.HAMMER,1]); if(held) items.push([I.NEITIZNOT_SHIELD,held]);
  const f=actor(t,{level,items});
  require('../plugins/quests/QuestRuntime').questNamed('The Fremennik Isles').setStage(f.p,stage);
  return f;
}
test('native shield quantity 2 produces at +2/+5, retains the first, and gives 34 Crafting XP each',async t=>{
  const {p,log}=shieldActor(t); const inv=p.getInventory();
  const xp=p.getSkillManager().getExperience(core.Skill.CRAFTING);
  assert.equal(core.CacheDefinitions.getSeqId('human_woodcrafting_hammer'),5754);
  cutWood(p); await chooseShield(p,2);
  assert.equal(inv.getAmount(I.NEITIZNOT_SHIELD),0,'selection only starts a delayed batch');
  run(log,1);assert.equal(inv.getAmount(I.NEITIZNOT_SHIELD),0);
  run(log,1);assert.equal(inv.getAmount(I.NEITIZNOT_SHIELD),1);
  run(log,2);assert.equal(inv.getAmount(I.NEITIZNOT_SHIELD),1);
  run(log,1);assert.equal(inv.getAmount(I.NEITIZNOT_SHIELD),2);
  run(log,8); assert.equal(inv.getAmount(I.ARCTIC_PINE_LOGS),0);
  assert.equal(inv.getAmount(I.BRONZE_NAILS),0);assert.equal(inv.getAmount(I.ROPE),0);
  assert.equal(inv.getAmount(I.HAMMER),1);assert.equal(p.getSkillManager().getExperience(core.Skill.CRAFTING)-xp,68);
  assert.equal(log.filter(x=>x==='spam You make a Neitiznot shield.').length,2);
  assert.equal(shieldOutputs.get(p),2,"each completed shield reaches the existing diary event");
  assert.equal(log.filter(x=>x==='seq 5754').length,2);assert.equal(log.filter(x=>x==='sound 2101').length,2);
});

for(const [amount,held,logs,nails,ropes,want] of [[1,0,6,3,3,1],[2,1,6,3,3,2],[28,0,5,3,3,2],[28,0,6,1,3,1],[28,0,6,3,1,1]]) {
  test('shield quantity/material cap '+[amount,held,logs,nails,ropes].join('/'),async t=>{
    const {p,log}=shieldActor(t,{held,logs,nails,ropes});cutWood(p);await chooseShield(p,amount);run(log,12);
    assert.equal(p.getInventory().getAmount(I.NEITIZNOT_SHIELD),held+want);
    assert.equal(p.getInventory().getAmount(I.ARCTIC_PINE_LOGS),logs-2*want);
    assert.equal(p.getInventory().getAmount(I.BRONZE_NAILS),nails-want);
    assert.equal(p.getInventory().getAmount(I.ROPE),ropes-want);
  });
}
test('shield requirements retain stage 17 gate, allow completed quest, and require current level and hammer',async t=>{
  for(const options of [{stage:16},{level:55},{hammer:false},{stage:17},{stage:340}]) {
    const {p,log}=shieldActor(t,options);cutWood(p);await chooseShield(p,1);run(log,8);
    const succeeds=options.stage===17||options.stage===340;
    assert.equal(p.getInventory().getAmount(I.NEITIZNOT_SHIELD),succeeds?1:0,JSON.stringify(options));
    assert.equal(p.getInventory().getAmount(I.ARCTIC_PINE_LOGS),succeeds?2:4);
  }
});
test('each shield rechecks hammer, boosted Woodcutting and live materials before output',async t=>{
  for(const loss of ['hammer','level','logs','nails','rope']) {
    const {p,log}=shieldActor(t);cutWood(p);await chooseShield(p,2);run(log,2);
    if(loss==='level')p.getSkillManager().setCurrentLevels(core.Skill.WOODCUTTING,55);
    else p.getInventory().deleteNumber({hammer:I.HAMMER,logs:I.ARCTIC_PINE_LOGS,nails:I.BRONZE_NAILS,rope:I.ROPE}[loss],28);
    run(log,5);assert.equal(p.getInventory().getAmount(I.NEITIZNOT_SHIELD),1,loss);
    assert.equal(p.getSkillManager().getExperience(core.Skill.CRAFTING),34,loss);
  }
});
test('native walking, emotes, interface replacement and disconnect stop shield batch without consuming pending materials',async t=>{
  for(const interruption of ['walk','emote','interface','disconnect']) {
    const {p,log}=shieldActor(t);cutWood(p);await chooseShield(p,2);run(log,2);
    if(interruption==='walk')await send(p,{type:'move',worldX:2342,worldY:3809,modifierFlags:0,run:false});
    if(interruption==='emote')PM.emitCustomEvent('player:emote',{player:p});
    if(interruption==='interface')p.getPacketSender().sendInterface(12);
    if(interruption==='disconnect') {PM.emitPlayerDisconnect({player:p,username:p.getUsername()});p.setRegistered(false);p.setRegistered(true);}
    run(log,8);assert.equal(p.getInventory().getAmount(I.NEITIZNOT_SHIELD),1,interruption);
    assert.equal(p.getInventory().getAmount(I.ARCTIC_PINE_LOGS),2,interruption);
  }
});
test('bank hammer remove/return and closing before next tick cannot revive shield batch',async t=>{
  const {Bank}=require('../dist/game/model/container/impl/Bank');
  const {p,log}=shieldActor(t);cutWood(p);await chooseShield(p,2);run(log,2);
  p.getBank(0).open();assert.equal(Bank.isOpen(p),true);
  Bank.deposit(p,I.HAMMER,p.getInventory().getSlotForItemId(I.HAMMER),1,false);
  assert.equal(p.getInventory().getAmount(I.HAMMER),0);
  Bank.withdraw(p,I.HAMMER,p.getBank(0).getSlotForItemId(I.HAMMER),1,0);
  assert.equal(p.getInventory().getAmount(I.HAMMER),1);
  p.getPacketSender().sendInterfaceRemoval();run(log,8);
  assert.equal(p.getInventory().getAmount(I.NEITIZNOT_SHIELD),1);
  cutWood(p);await chooseShield(p,1);run(log,2);assert.equal(p.getInventory().getAmount(I.NEITIZNOT_SHIELD),2,'fresh selection after banking works');
});
test('rapid native reselection and switching split/shield replace pending activity',async t=>{
  for(const sequence of [[false,false],[false,true],[true,false]]) {
    const {p,log}=shieldActor(t,{logs:6,nails:3,ropes:3});p.getInventory().adds(I.BRONZE_AXE,1);
    cutWood(p);await chooseShield(p,3,sequence[0]);run(log,1);
    cutWood(p);await chooseShield(p,1,sequence[1]);run(log,10);
    assert.equal(p.getInventory().getAmount(I.NEITIZNOT_SHIELD),sequence[1]?0:1,sequence.join('/'));
    assert.equal(p.getInventory().getAmount(I.SPLIT_LOG),sequence[1]?1:0,sequence.join('/'));
  }
});
test('completed shield output persists while the unfinished batch is absent after real save hydration',async t=>{
  const {PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave');
  let codec;require('../plugins/persistence/JsonPlayerPersistence.plugin').register({getSkillManager:()=>core.SkillManager,setPlayerPersistence:value=>codec=value,log(){}});
  const {p,log}=shieldActor(t);cutWood(p);await chooseShield(p,2);run(log,2);
  PM.emitPlayerDisconnect({player:p,username:p.getUsername()});p.setRegistered(false);
  const saved=JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p),codec.replacer.bind(codec)),codec.reviver.bind(codec));
  const fresh=actor(t,{items:[]});codec.hydratePlayerSave(saved).applyToPlayer(fresh.p);run(fresh.log,8);
  assert.equal(fresh.p.getInventory().getAmount(I.NEITIZNOT_SHIELD),1);
  assert.equal(fresh.p.getInventory().getAmount(I.ARCTIC_PINE_LOGS),2);
  assert.equal(fresh.p.getSkillManager().getExperience(core.Skill.CRAFTING),34);
  assert.equal(require('../plugins/quests/QuestRuntime').questNamed('The Fremennik Isles').getStage(fresh.p),17);
});
