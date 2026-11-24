// Native ::admin with real game objects and disposable saves, without a running world.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { CommandPacketListener } = require("../dist/net/packet/impl/CommandPacketListener");
const AdminPanel = require("../plugins/tools/AdminPanel.entry");
const { Layout, TAB, SECTION, BotView } = require("../plugins/tools/adminpanel/Controller.AdminPanel")._test;
const B = BotView.C;
const ContainerView = require("../plugins/tools/adminpanel/Containers.AdminPanel");
const V = ContainerView.C;
const { GROUP_ID, COMPONENT: C, DATA_COMPONENTS, BUTTONS, uid } = Layout;
let core, Rights, Skill, I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  ({ PlayerRights: Rights, Skill, ItemIdentifiers: I } = core);
  require("../plugins/commands/AdminCommands.plugin").register(PluginManager.createApi("AdminCommands"));
  require("../plugins/quests/QuestCommand.plugin").register(PluginManager.createApi("QuestCommand"));
  require("../plugins/skills/PrayerUnlocks.plugin").register(PluginManager.createApi("PrayerUnlocks"));
  require("../plugins/items/Jewellery.plugin").register(PluginManager.createApi("Jewellery"));
  require("../plugins/combat/Disease.plugin").register(PluginManager.createApi("Disease"));
  require("../plugins/areas/wilderness/FountainOfRune.Wilderness")(PluginManager.createApi("FountainOfRuneTest"));
});
function fixture(t, rights = Rights.ADMINISTRATOR, extraTeleports = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "admin-panel-test-"));
  const Json = require("../plugins/persistence/JsonPlayerPersistence.plugin");
  const previous = { directory: Json.JsonPlayerPersistence.SAVE_DIRECTORY, persistence: core.GameConstants.PLAYER_PERSISTENCE, players: core.World.players };
  Json.JsonPlayerPersistence.SAVE_DIRECTORY = directory;
  let persistence;
  Json.register({ getSkillManager: () => core.SkillManager, setPlayerPersistence: value => { persistence = value; }, log() {} });
  core.GameConstants.PLAYER_PERSISTENCE = persistence;
  const players = [], buttons = new Map(), mutations = [], events = new Map();
  core.World.players = { stream: () => players, search: predicate => players.find(predicate), forEach: callback => players.forEach(callback), [Symbol.iterator]: function* () { yield* players; } };
  const quests = [{ key: "test-quest", name: "Fixture quest", stage: 0, complete: false }];
  const realApi = PluginManager.createApi("AdminPanel");
  PluginManager.commandHandlersByBase.delete("admin");
  let definition, startup;
  AdminPanel.register({ ...realApi, core,
    onServerStartup(handler) { startup = handler; },
    onCustomEvent(name, handler) { events.set(name, handler); },
    onPlayerProcess(handler) { events.set("process", handler); },
    onPlayerLogout(handler) { events.set("logout", handler); },
    registerCustomInterface(value) { definition = value; realApi.registerCustomInterface(value); },
    onInterfaceActionButton(ids, handler) { for (const id of [].concat(ids)) buttons.set(id, handler); },
    emitCustomEvent(name, event) {
      if (events.has(`provider:${name}`)) return events.get(`provider:${name}`)(event);
      if (["admin:testing-modes", "admin:testing-tools", "prayer:unlock", "disease:cure"].includes(name) || ["adminpanel:teleport-destinations", "fairy-rings:destinations"].includes(name) && extraTeleports === null) return realApi.emitCustomEvent(name, event);
      if (name === "adminpanel:teleport-destinations") { require("../plugins/items/Jewellery.plugin")._test.describeTeleports(event); event.list.push(...extraTeleports); return; }
      if (name !== "quests:admin") return;
      event.handled = true; event.quests = quests;
      if (event.action) {
        mutations.push({ target: event.player, action: event.action });
        quests[0].complete = event.action === "complete";
        quests[0].stage = quests[0].complete ? 2 : 0;
        event.message = `${quests[0].name}: ${event.action}`;
      }
    },
  });
  startup();
  function login(name, rank = Rights.NONE) {
    const player = new Player(null).setUsername(name).setRights(rank);
    player.isRegistered = () => players.includes(player);
    const texts = new Map(), hidden = new Map(), actions = new Map(), items = new Map(), messages = [];
    let mapOpen = false;
    const sender = new Proxy({}, { get(_target, key) { return (...args) => {
      if (key === "isWorldMapOpen") return mapOpen;
      if (key === "toggleWorldMap") mapOpen = !mapOpen;
      if (key === "closeWorldMap") mapOpen = false;
      if (key === "sendString" && player.getFrameUpdater().shouldUpdate(args[0], args[1])) texts.set(args[1], args[0]);
      if (key === "sendInterfaceDisplayState") hidden.set(args[0], args[1]);
      if (key === "sendInterfaceActions") actions.set(args[0], args[1]);
      if (key === "sendItemOnInterface") items.set(args[0], args.slice(1));
      if (key === "clearItemOnInterface") items.delete(args[0]);
      if (key === "sendInterfaceRemoval") player.setInterfaceId(-1);
      if (key === "abortInputPrompt") {
        player.getEnteredAmountAction()?.cancel?.();
        player.setEnteredAmountAction(null); player.setEnteredSyntaxAction(null);
      }
      return sender;
    }; } });
    player.getPacketSender = () => sender; player.sendMessage = message => messages.push(message);
    players.push(player);
    return Object.assign(player, { texts, hidden, actions, items, messages });
  }
  const actor = login("AdminFixture", rights), target = login("TargetOne"), other = login("TargetTwo");
  let currentTab = TAB.PLAYERS, searchSequence = 0;
  const rows = () => {
    const rows = DATA_COMPONENTS.flatMap(component => JSON.parse(actor.texts.get(uid(component)) ?? "[]"));
    const response = JSON.parse(actor.texts.get(uid(C.SEARCH_RESPONSE)) ?? "{}");
    return [...new Map([...rows, ...(response.rows ?? [])].map(row => [row.id, row])).values()];
  };
  const row = name => {
    const allowed = new Set([TAB.ITEMS, TAB.NPCS].includes(currentTab) ? JSON.parse(actor.texts.get(uid(C.SEARCH_RESPONSE)) ?? "{}").rows?.map(row => row.id) : JSON.parse(actor.texts.get(uid(C.LAYOUT))).tabs[currentTab]);
    const result = rows().find(value => allowed.has(value.id) && value.name === name);
    assert.ok(result, `row ${name} in tab ${currentTab}`); return result;
  };
  const click = (component, extra = {}) => buttons.get(uid(component))({ player: actor, buttonId: uid(component), opId: 1, ...extra });
  const open = () => { currentTab = TAB.PLAYERS; searchSequence = 0; CommandPacketListener.execute(actor, "admin"); };
  const tab = value => { currentTab = value; click(C.TAB_START + value); };
  const select = name => click(C.ROW_LABEL_START, { slot: row(name).id });
  const action = (index, opId = 1) => click(BUTTONS[index].button, { opId });
  const text = input => { const callback = actor.getEnteredSyntaxAction(); assert.ok(callback); actor.setEnteredSyntaxAction(null); callback.execute(input); };
  const amount = input => { const callback = actor.getEnteredAmountAction(); assert.ok(callback); actor.setEnteredAmountAction(null); callback.execute(input); };
  const choose = name => { tab(TAB.PLAYERS); select(name); };
  const section = value => { tab(TAB.EDITOR); click(C.SECTION_START + value); };
  const socket = (query, extra = {}) => {
    const request = { session: actor.texts.get(uid(C.SEARCH_SESSION)), sequence: ++searchSequence, query, ...extra };
    const event = { player: actor, packet: { widgetId: uid(C.SEARCH_REQUEST), groupId: GROUP_ID, childId: C.SEARCH_REQUEST, opId: 1, target: JSON.stringify(request) }, handled: false };
    events.get("player:widget-action")(event);
    return { request, event };
  };
  const search = query => { tab(TAB.ITEMS); socket(query); };
  const skill = name => click(C.SKILL_BUTTON_START + Skill.values().find(skill => skill.getName() === name).getIndex());
  const preset = key => click(C.PRESET_START + Layout.PRESETS.findIndex(([preset]) => preset === key));
  const settle = async () => { await persistence.flush(); await new Promise(resolve => setImmediate(resolve)); };
  const originalFlush = persistence.flush;
  t.after(async () => {
    persistence.flush = originalFlush; await persistence.flush();
    core.World.players = previous.players; core.GameConstants.PLAYER_PERSISTENCE = previous.persistence;
    Json.JsonPlayerPersistence.SAVE_DIRECTORY = previous.directory;
    PluginManager.setCommandRights("admin", Rights.ADMINISTRATOR);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { actor, target, other, login, players, quests, persistence, definition, mutations, open, click, tab, rows, row, select, action, text, amount, choose, search, socket, skill, preset, section, events, settle };
}

test("::admin admits Admin, Owner and Developer, denies Player and Moderator", t => {
  const f = fixture(t);
  for (const rights of [Rights.NONE, Rights.MODERATOR]) {
    f.actor.setRights(rights); f.open(); assert.notEqual(f.actor.getInterfaceId(), GROUP_ID);
    assert.match(f.actor.messages.at(-1), /permission/);
  }
  for (const rights of [Rights.ADMINISTRATOR, Rights.OWNER, Rights.DEVELOPER]) {
    f.actor.setRights(rights); f.open(); assert.equal(f.actor.getInterfaceId(), GROUP_ID);
    assert.equal(f.actor.texts.get(uid(C.TARGET)), "Target: AdminFixture");
    assert.ok(f.rows().some(row => row.name === "Sailing"));
    for (const component of DATA_COMPONENTS) assert.ok(Buffer.byteLength(f.actor.texts.get(uid(component)), "latin1") < 48000);
  }
  assert.equal(f.definition.search.endpoint, undefined, "private rows stay on the game socket");
  assert.equal(new Set(f.definition.widgets.map(widget => widget.uid)).size, f.definition.widgets.length);
});

test("AdminPanel registers its own content resource", t => {
  const f = fixture(t);
  const { CustomInterfaceRegistry } = require("../dist/game/interfaces/CustomInterfaceRegistry");
  assert.equal(GROUP_ID, 30022);
  assert.equal(CustomInterfaceRegistry.get(GROUP_ID), f.definition);
});

test("every authoritative tab click delivers a layout commit even when its content is unchanged", t => {
  const f = fixture(t); f.open();
  for (const tab of [TAB.PLAYERS, TAB.EDITOR, TAB.ITEMS, TAB.SPAWN]) {
    f.tab(tab);
    f.actor.texts.delete(uid(C.LAYOUT));
    f.tab(tab);
    assert.equal(JSON.parse(f.actor.texts.get(uid(C.LAYOUT)) ?? '{}').active, tab,
      'packet deduplication must not strand the client behind its pending-view mask');
  }
});

test("named targets reject stale prompts, disconnects and demotions", async t => {
  const f = fixture(t); f.open(); f.choose("TargetOne"); f.search("Bronze arrow"); f.select("Bronze arrow"); f.action(1);
  const stale = f.actor.getEnteredAmountAction(); f.choose("TargetTwo"); stale.execute(20);
  assert.equal(f.target.getInventory().getAmount(I.BRONZE_ARROW), 0); assert.equal(f.other.getInventory().getAmount(I.BRONZE_ARROW), 0);
  f.search("Bronze arrow"); f.select("Bronze arrow"); f.action(1); f.actor.setRights(Rights.MODERATOR); f.amount(20);
  assert.equal(f.actor.getInterfaceId(), -1); assert.equal(f.other.getInventory().getAmount(I.BRONZE_ARROW), 0);
  f.actor.setRights(Rights.ADMINISTRATOR); f.open(); f.choose("TargetOne"); f.search("Bronze arrow"); f.select("Bronze arrow"); f.action(1);
  f.players.splice(f.players.indexOf(f.target), 1); const replacement = f.login("TargetOne"); f.amount(10); await f.settle();
  assert.equal(replacement.getInventory().getAmount(I.BRONZE_ARROW), 0, "a relogged session is a different target");
  assert.match(f.actor.messages.at(-1), /offline/);
  f.click(C.TARGET_BUTTON); f.text("TargetTwo"); assert.equal(f.actor.texts.get(uid(C.TARGET)), "Target: TargetTwo");
});

test("item search gives named items and quantities, clips capacity, validates and persists", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne"); f.search("Bronze arrow"); f.select("Bronze arrow");
  assert.deepEqual(f.actor.items.get(uid(C.PANEL_ICON)), [I.BRONZE_ARROW, 0, 1]);
  assert.equal(f.row("Bronze arrow").panel.description, core.ItemDefinition.forId(I.BRONZE_ARROW).getExamine());
  for (const invalid of [0, -1, 1.5, 2147483648]) { f.action(1); f.amount(invalid); await f.settle(); }
  assert.equal(f.target.getInventory().getAmount(I.BRONZE_ARROW), 0);
  f.action(1); f.amount(20); await f.settle(); assert.equal(f.target.getInventory().getAmount(I.BRONZE_ARROW), 20);
  f.search("Bronze scimitar"); f.select("Bronze scimitar"); f.action(1); f.amount(100); await f.settle();
  assert.equal(f.target.getInventory().getAmount(I.BRONZE_SCIMITAR), 27); assert.match(f.actor.messages.at(-1), /Only 27 of 100 fit/);
  assert.equal(f.other.getInventory().getAmount(I.BRONZE_SCIMITAR), 0);
  const saved = f.persistence.load(f.target.getUsername(), f.target.getProfile());
  assert.ok(saved.getInventory().some(item => item?.id === I.BRONZE_ARROW && item?.amount === 20));
});

test("item search loads bounded pages, exposes its true total and permits selecting later matches", t => {
  const f=fixture(t);f.open();f.choose("TargetOne");f.tab(TAB.ITEMS);
  const first=f.socket("ancient"),response=()=>JSON.parse(f.actor.texts.get(uid(C.SEARCH_RESPONSE)));
  const expected=require("../plugins/tools/PlayerTools").searchItems(core,"ancient");
  assert.ok(expected.length>50);assert.equal(response().total,expected.length);assert.equal(response().rows.length,40);
  const results=[...response().rows],sequence=first.request.sequence;
  for(let offset=40;offset<expected.length;offset+=40){
    f.socket("ancient",{sequence,offset});const page=response();
    assert.equal(page.offset,offset);assert.ok(page.rows.length<=40);assert.equal(page.total,expected.length);
    assert.ok(Buffer.byteLength(f.actor.texts.get(uid(C.SEARCH_RESPONSE)),"latin1")<60000,"each page fits a widget text packet");
    results.push(...page.rows);
  }
  assert.deepEqual(results.map(row=>row.icon),expected.map(row=>row.id));
  const last=response().rows.at(-1);f.select(last.name);assert.equal(f.actor.texts.get(uid(C.PANEL_TITLE)),last.name);
  const previous=f.actor.texts.get(uid(C.SEARCH_RESPONSE));
  for(const offset of [-40,1,400000000])f.socket("ancient",{sequence,offset});
  assert.equal(f.actor.texts.get(uid(C.SEARCH_RESPONSE)),previous,"invalid or out-of-range pages cannot replace results");
  f.socket("cape");const next=f.actor.texts.get(uid(C.SEARCH_RESPONSE));f.socket("ancient",{sequence,offset:40});
  assert.equal(f.actor.texts.get(uid(C.SEARCH_RESPONSE)),next,"old-query pages are rejected");
});

test("private item queries search the cache by name/ID, reject stale sessions and clear obsolete selections", async t => {
  const f = fixture(t); f.open(); f.choose("TargetOne"); f.search("scythe");
  const response = () => JSON.parse(f.actor.texts.get(uid(C.SEARCH_RESPONSE)));
  assert.ok(response().rows.some(row => /Scythe/i.test(row.name)));
  assert.ok(!f.actor.getEnteredSyntaxAction(), "typing uses no chatbox search prompt");
  const first = f.socket("Bronze arrow"); f.select("Bronze arrow"); f.action(1);
  const oldQuantity = f.actor.getEnteredAmountAction();
  f.socket(String(I.BRONZE_SCIMITAR));
  assert.ok(response().rows.some(row => row.icon === I.BRONZE_SCIMITAR));
  const latest = f.actor.texts.get(uid(C.SEARCH_RESPONSE));
  f.socket("Bronze arrow", { sequence: first.request.sequence });
  assert.equal(f.actor.texts.get(uid(C.SEARCH_RESPONSE)), latest, "older queries cannot replace newer rows");
  f.socket("Bronze arrow", { session: "previous-panel" });
  assert.equal(f.actor.texts.get(uid(C.SEARCH_RESPONSE)), latest);
  oldQuantity.execute(20); await f.settle(); assert.equal(f.target.getInventory().getAmount(I.BRONZE_ARROW), 0);
  f.socket(""); assert.equal(response().rows.length, 0);
  f.socket("a"); assert.equal(response().rows.length, 0);
  f.socket("arrow"); assert.ok(response().rows.length <= 50);
  f.actor.setInterfaceId(-1); const closed = f.actor.texts.get(uid(C.SEARCH_RESPONSE)); f.socket("scythe");
  assert.equal(f.actor.texts.get(uid(C.SEARCH_RESPONSE)), closed);
});

test("teleports cover canonical spellbooks, minigame choices, jewellery and shared source tables", t => {
  const f = fixture(t); f.open(); f.tab(TAB.TELEPORTS);
  const rows = f.rows(), byId = new Map(rows.map(row => [row.id, row]));
  const ancestry = row => { const names = []; while (row?.parentId) { row = byId.get(row.parentId); names.unshift(row?.name); } return names; };
  for (const [name, source] of [["varrock teleport", "Standard spellbook"], ["paddewwa teleport", "Ancient spellbook"],
    ["moonclan teleport", "Lunar spellbook"], ["barrows teleport", "Arceuus spellbook"],
    ["Castle Wars", "Minigame teleports"], ["Ardougne (kittens)", "Rat Pits"], ["Edgeville", "Amulet of glory"],
    ["Digsite", "Digsite Pendant"], ["Jalsavrah", "Pharaoh's sceptre"]]) {
    assert.ok(rows.some(row => row.name === name && ancestry(row).includes(source)), `${source}: ${name}`);
  }
  assert.ok(rows.filter(row => row.expandable).every(row => row.collapsed === true));
  assert.ok(rows.filter(row => row.parentId).every(row => byId.get(row.parentId)?.expandable));
  for (const unit of [core.SpellTeleports, core.LunarSpells, core.ArceuusSpells]) {
    for (const spell of unit.getTeleportDestinations().filter(spell => spell.name !== "teleport to house")) assert.ok(rows.some(row => row.name === spell.name && row.panel.info ===
      `${spell.destination.getX()}, ${spell.destination.getY()}, plane ${spell.destination.getZ()}`));
  }
});

test("travel providers merge existing source folders and invalid coordinates never become buttons", t => {
  const f = fixture(t, Rights.ADMINISTRATOR, [
    { path: ["Spellbooks", "Standard spellbook"], key: "fixture", name: "Fixture route", location: core.GameConstants.DEFAULT_LOCATION },
    { path: ["Items", "Invalid"], key: "outside", name: "Invalid route", tile: [16384, 3200, 0] },
    { path: [], name: "Missing source", tile: [3200, 3200, 0] },
    { path: ["Items", "Invalid"], name: "Invalid plane", tile: [3200, 3200, 4] },
    { path: ["Items", "Invalid"], name: "Fractional tile", tile: [3200.5, 3200, 0] },
    { path: ["Spellbooks", "Standard spellbook"], key: "fixture", name: "Duplicate route", tile: [3200, 3200, 0] },
    { path: ["Items", "Fixture source"], key: "fixture", name: "Fixture route", location: core.GameConstants.DEFAULT_LOCATION },
  ]);
  f.open(); const rows = f.rows();
  const route = rows.find(row => row.name === "Fixture route");
  assert.ok(route); assert.equal(rows.find(row => row.id === route.parentId)?.name, "Standard spellbook");
  assert.ok(rows.indexOf(route) < rows.findIndex(row => row.name === "Minigame teleports"));
  assert.equal(rows.filter(row => row.name === "Fixture route").length, 2, "identical destinations in different sources remain separate");
  assert.ok(!rows.some(row => ["Invalid route", "Missing source", "Invalid plane", "Fractional tile", "Duplicate route"].includes(row.name)));
});

test("dynamic provider buttons reject missing, malformed and throwing resolvers at click time", async t => {
  let landing = [3205, 3207, 0];
  const f = fixture(t, Rights.ADMINISTRATOR, [{ path: ["Items", "Dynamic fixture"], name: "Live landing", tile: landing,
    resolve() { if (landing === "throw") throw new Error("destination moved"); return landing; } }]);
  f.open(); f.choose("TargetOne"); f.tab(TAB.TELEPORTS);
  const origin = [f.target.getLocation().getX(), f.target.getLocation().getY()];
  for (const invalid of [null, [], [3200, 3200, 5], "throw"]) {
    landing = invalid; f.select("Live landing"); await f.settle();
    assert.deepEqual([f.target.getLocation().getX(), f.target.getLocation().getY()], origin);
    assert.match(f.actor.messages.at(-1), /unavailable/);
  }
  landing = [3209, 3210, 0]; f.select("Live landing"); await f.settle();
  assert.deepEqual([f.target.getLocation().getX(), f.target.getLocation().getY()], [3209, 3210]);
});

test("native skill grid uses cache icons, target levels and expanded vertical layout", async t => {
  const f = fixture(t); f.open(); f.choose("TargetOne"); f.section(SECTION.SKILLS);
  const widgets = new Map(f.definition.widgets.map(widget => [widget.fileId, widget]));
  for (const skill of Skill.values()) {
    assert.equal(widgets.get(C.SKILL_ICON_START + skill.getIndex()).spriteId, core.CacheDefinitions.getEnumValues(255).get(skill.getIndex()));
    assert.equal(f.actor.texts.get(uid(C.SKILL_BASE_START + skill.getIndex())), `/ ${f.target.getSkillManager().getMaxLevel(skill)}`);
  }
  assert.equal(widgets.get(C.LIST_VIEW).heightMode, 1);
  assert.equal(widgets.get(C.PANEL).heightMode, 1);
  assert.equal(f.actor.hidden.get(uid(C.LIST_VIEW)), true);
  assert.equal(f.actor.hidden.get(uid(C.SKILL_VIEW)), false);
  f.skill("Attack"); const pending = f.actor.getEnteredAmountAction(); f.choose("TargetTwo"); pending.execute(75); await f.settle();
  assert.equal(f.target.getSkillManager().getMaxLevel(Skill.ATTACK), 1);
  assert.equal(f.other.getSkillManager().getMaxLevel(Skill.ATTACK), 1);
});

test("named/coordinate teleports and go/bring respect targets and private instances", async t => {
  const f = fixture(t); f.open(); f.choose("TargetOne"); f.tab(TAB.TELEPORTS); f.select("varrock teleport"); f.action(0); await f.settle();
  assert.equal(f.target.getLocation().getX(), 3213); assert.equal(f.target.getLocation().getY(), 3424);
  f.click(C.UTILITY); f.text("16384 3218 0"); await f.settle(); assert.match(f.actor.messages.at(-1), /coordinates/);
  f.click(C.UTILITY); f.text("3221 3218 0"); await f.settle(); assert.equal(f.target.getLocation().getX(), 3221);
  f.target.getPrivateArea = () => ({}); f.select("varrock teleport"); f.action(0); await f.settle(); assert.match(f.actor.messages.at(-1), /instance/);
  f.tab(TAB.PLAYERS); f.select("TargetOne"); f.action(1); await f.settle(); assert.match(f.actor.messages.at(-1), /instance/);
  f.target.getPrivateArea = () => null; f.target.moveTo(new core.Location(3213, 3424, 0)); f.action(1); await f.settle();
  assert.equal(f.actor.getLocation().getX(), 3213); assert.equal(f.actor.texts.get(uid(C.TARGET)), "Target: TargetOne");
  f.actor.moveTo(new core.Location(3222, 3218, 0)); f.open(); f.select("TargetOne"); f.action(2); await f.settle(); assert.equal(f.target.getLocation().getX(), 3222);
});

test("stats change current/base/XP with +/-1, +/-5, presets and restore", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne"); f.section(SECTION.SKILLS); f.skill("Attack"); f.amount(60); await f.settle();
  for (const [button, op] of [[2, 1], [2, 2], [1, 1], [1, 2]]) { f.action(button, op); await f.settle(); }
  assert.equal(f.target.getSkillManager().getMaxLevel(Skill.ATTACK), 60);
  assert.equal(f.target.getSkillManager().getCurrentLevel(Skill.ATTACK), 60);
  assert.equal(f.target.getSkillManager().getExperience(Skill.ATTACK), core.SkillManager.getExperienceForLevel(60));
  assert.equal(f.persistence.load(f.target.getUsername(), f.target.getProfile()).getSkills().maxLevel[Skill.ATTACK.getIndex()], 60);
  f.skill("Hitpoints"); f.amount(1); await f.settle(); assert.equal(f.target.getSkillManager().getMaxLevel(Skill.HITPOINTS), 10);
  f.preset("combat"); f.text("cancel"); await f.settle(); assert.equal(f.target.getSkillManager().getMaxLevel(Skill.ATTACK), 60);
  f.preset("combat"); f.text("CONFIRM"); await f.settle(); assert.equal(f.target.getSkillManager().getMaxLevel(Skill.ATTACK), 99); assert.equal(f.target.getSkillManager().getMaxLevel(Skill.SAILING), 1);
  f.preset("max"); f.text("CONFIRM"); await f.settle(); assert.equal(f.target.getSkillManager().getMaxLevel(Skill.SAILING), 99);
  f.preset("reset"); f.text("CONFIRM"); await f.settle(); assert.equal(f.target.getSkillManager().getMaxLevel(Skill.ATTACK), 1); assert.equal(f.target.getSkillManager().getMaxLevel(Skill.HITPOINTS), 10);
  f.target.getSkillManager().setCurrentLevels(Skill.HITPOINTS, 5); f.target.setRunEnergy(10); f.preset("restore"); await f.settle();
  assert.equal(f.target.getSkillManager().getCurrentLevel(Skill.HITPOINTS), 10); assert.equal(f.target.getRunEnergy(), 100);
});

test("reopening admin panels keeps every selectable row inside native 16-bit slots", t => {
  const f = fixture(t);
  for (let count = 0; count < 2000; count++) f.open();
  assert.ok(f.rows().every(row => row.id > 0 && row.id < 65535));
});

test("large player and quest lists split bounded packets, exclude bots/other profiles and find players beyond the list", t => {
  const f = fixture(t);
  for (let index = 0; index < 205; index++) f.login(`Extra${String(index).padStart(4, "0")}`);
  for (let index = 0; index < 250; index++) f.quests.push({ key: `fixture-${index}`, name: `Fixture quest ${index}`, stage: 0, complete: false });
  f.login("Robot").isPlayerBot = () => true;
  f.login("Foreign").getProfile = () => "another-profile";
  f.open();
  const layout = JSON.parse(f.actor.texts.get(uid(C.LAYOUT)));
  assert.equal(layout.tabs[TAB.PLAYERS].length, 200);
  assert.ok(!f.rows().some(row => row.name === "Robot" || row.name === "Foreign"));
  assert.ok(JSON.parse(f.actor.texts.get(uid(DATA_COMPONENTS[1]))).length > 0, "large rows travel in more than one packet");
  for (const component of DATA_COMPONENTS) assert.ok(Buffer.byteLength(f.actor.texts.get(uid(component)), "latin1") < 48000);
  f.click(C.TARGET_BUTTON); f.text("TargetOne");
  assert.equal(f.actor.texts.get(uid(C.TARGET)), "Target: TargetOne");
});

test("resetting a detail panel clears locally selected text despite server packet deduplication", t => {
  const f = fixture(t); f.open(); f.select("TargetOne");
  // list.select changes widgets locally, without changing the server's FrameUpdater.
  f.actor.texts.set(uid(C.PANEL_TITLE), "TargetOne");
  f.actor.texts.set(uid(C.PANEL_DESCRIPTION), "Use player selects the target for every tab.");
  f.action(0);
  assert.equal(f.actor.texts.get(uid(C.PANEL_TITLE)), "");
  assert.equal(f.actor.texts.get(uid(C.PANEL_DESCRIPTION)), "");
  assert.equal(f.actor.hidden.get(uid(BUTTONS[0].button)), true);
});

test("quest buttons act directly through their owning plugin with no typed confirmation", async t => {
  const f = fixture(t); f.open(); f.choose("TargetOne"); f.section(SECTION.QUESTS); f.select("Fixture quest"); assert.match(f.row("Fixture quest").panel.description, /Reset keeps item\/XP rewards/);
  f.action(0); assert.equal(f.mutations.length, 1); assert.ok(!f.actor.getEnteredSyntaxAction());
  await f.settle(); assert.deepEqual(f.mutations, [{ target: f.target, action: "complete" }]);
  f.action(1); await f.settle(); assert.equal(f.mutations[1].action, "reset");
  f.players.splice(f.players.indexOf(f.target), 1); f.action(0); await f.settle(); assert.equal(f.mutations.length, 2);
  assert.match(f.actor.messages.at(-1), /offline/);
  f.open(); f.section(SECTION.QUESTS); f.select("Fixture quest"); f.actor.setRights(Rights.MODERATOR); f.action(0);
  assert.equal(f.mutations.length, 2); assert.equal(f.actor.getInterfaceId(), -1);
});

test("staff ranks protect owners/developers, own rank and delayed authority", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne"); f.section(SECTION.STAFF); f.select("Admin"); f.action(0); f.text("CONFIRM"); await f.settle();
  assert.equal(f.target.getRights(), Rights.ADMINISTRATOR); assert.ok(!f.rows().some(row => row.name === "Developer" || row.name === "Owner"));
  f.select("Moderator"); f.action(0); f.actor.setRights(Rights.ADMINISTRATOR); f.text("CONFIRM"); await f.settle(); assert.equal(f.target.getRights(), Rights.ADMINISTRATOR); assert.match(f.actor.messages.at(-1), /Only owners/);
  f.actor.setRights(Rights.DEVELOPER); f.open(); f.choose("TargetOne"); f.section(SECTION.STAFF); f.select("Owner"); f.action(0); f.text("CONFIRM"); await f.settle(); assert.equal(f.target.getRights(), Rights.OWNER);
  f.actor.setRights(Rights.OWNER); f.open(); f.choose("TargetOne"); f.section(SECTION.STAFF); f.select("Moderator"); f.action(0); f.text("CONFIRM"); await f.settle(); assert.equal(f.target.getRights(), Rights.OWNER, "owners cannot demote their peers");
  f.actor.setRights(Rights.DEVELOPER); f.open(); f.section(SECTION.STAFF);
  f.click(C.SELF_BUTTON); f.select("Player"); f.action(0); f.text("CONFIRM"); await f.settle(); assert.equal(f.actor.getRights(), Rights.DEVELOPER);
});

test("forged/cross-tab/closed-panel clicks and command overrides cannot bypass ranks", async t => {
  const f = fixture(t); f.open(); f.search("Bronze arrow"); const item = f.row("Bronze arrow");
  f.section(SECTION.SKILLS); f.click(C.ROW_LABEL_START, { slot: item.id }); f.action(0); assert.ok(!f.actor.getEnteredAmountAction());
  f.tab(TAB.ITEMS); f.click(C.ROW_LABEL_START, { slot: 2147483647 }); f.action(0); await f.settle(); assert.equal(f.actor.getInventory().getAmount(I.BRONZE_ARROW), 0);
  f.socket("Bronze arrow"); f.select("Bronze arrow"); PluginManager.setCommandRights("admin", Rights.OWNER); f.action(0); await f.settle(); assert.equal(f.actor.getInterfaceId(), -1);
  f.action(0); await f.settle(); assert.equal(f.actor.getInventory().getAmount(I.BRONZE_ARROW), 0);
  PluginManager.setCommandRights("admin", Rights.NONE); f.actor.setRights(Rights.MODERATOR); f.open(); assert.notEqual(f.actor.getInterfaceId(), GROUP_ID);
});

test("native player edits recheck command permissions and the selected player's rank", async t => {
  const f = fixture(t);
  f.target.setRights(Rights.OWNER);
  f.target.getBank(0).setItem(0, new core.Item(I.COINS, 1000));
  f.open();
  f.choose("TargetOne");
  f.section(SECTION.SKILLS);
  f.skill("Attack"); f.amount(77); await f.settle();
  assert.equal(f.target.getSkillManager().getMaxLevel(Skill.ATTACK), 1);
  f.section(SECTION.BANK);
  f.click(V.BANK_START, { opId: 4 }); await f.settle();
  assert.equal(f.target.getBank(0).getAmount(I.COINS), 1000);

  f.target.setRights(Rights.NONE);
  f.section(SECTION.SKILLS);
  f.preset("max"); f.text("CONFIRM"); await f.settle();
  assert.equal(f.target.getSkillManager().getMaxLevel(Skill.ATTACK), 1);
  assert.match(f.actor.messages.at(-1), /::master/);
  f.section(SECTION.BANK);
  f.click(V.BANK_START, { opId: 4 }); await f.settle();
  assert.equal(f.target.getBank(0).getAmount(I.COINS), 1000);
  assert.match(f.actor.messages.at(-1), /::copybank/);

  f.actor.setRights(Rights.OWNER);
  f.section(SECTION.SKILLS);
  f.skill("Attack");
  const previous = PluginManager.commandPermissionsCache;
  PluginManager.commandPermissionsCache = new Map([["setlevel", Rights.DEVELOPER.getId()]]);
  t.after(() => { PluginManager.commandPermissionsCache = previous; });
  f.amount(77); await f.settle();
  assert.equal(f.target.getSkillManager().getMaxLevel(Skill.ATTACK), 1);
  assert.match(f.actor.messages.at(-1), /::setlevel/);

  f.target.setRights(Rights.DEVELOPER);
  f.tab(TAB.TELEPORTS);
  const before = f.target.getLocation().clone();
  f.select("varrock teleport"); await f.settle();
  assert.equal(f.target.getLocation().equals(before), true);
  assert.match(f.actor.messages.at(-1), /higher-ranked/);
});

test("pending saves block duplicates and failures report the already-applied live grant", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne"); f.search("Bronze arrow"); f.select("Bronze arrow");
  let finish; f.persistence.flush = () => new Promise(resolve => { finish = resolve; }); f.action(0); f.action(0);
  assert.equal(f.target.getInventory().getAmount(I.BRONZE_ARROW), 1); assert.match(f.actor.messages.at(-1), /finish saving/);
  finish(); await new Promise(resolve => setImmediate(resolve));
  const oldError = console.error; t.after(() => { console.error = oldError; }); console.error = () => {};
  f.search("Bronze arrow"); f.select("Bronze arrow");
  f.persistence.flush = async () => { throw new Error("fixture save failure"); }; f.action(0); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.target.getInventory().getAmount(I.BRONZE_ARROW), 2); assert.match(f.actor.messages.at(-1), /live change happened, but saving failed/);
});

test("Character switches every supported spellbook and saves only the selected target", async t => {
  const f = fixture(t); f.open(); f.choose("TargetOne"); f.section(SECTION.CHARACTER);
  assert.equal(f.actor.hidden.get(uid(C.LIST_VIEW)), false);
  assert.equal(f.actor.hidden.get(uid(C.SKILL_VIEW)), true);
  for (const [key, name] of [["ANCIENT", "Ancient"], ["LUNAR", "Lunar"], ["ARCEUUS", "Arceuus"], ["NORMAL", "Standard"]]) {
    f.target.getCombat().setAutocastSpell(core.CombatSpells.WIND_STRIKE);
    f.select(`${name} spellbook`); f.action(0); await f.settle();
    assert.equal(f.target.getSpellbook(), core.MagicSpellbook[key]);
    assert.equal(f.target.getCombat().getAutocastSpell(), null);
    assert.equal(f.actor.getSpellbook(), core.MagicSpellbook.NORMAL);
    assert.equal(f.persistence.load(f.target.getUsername(), f.target.getProfile()).getSpellBook(), core.MagicSpellbook[key]);
  }
  assert.ok(!f.rows().some(row => /curses|ancient prayer/i.test(row.name)));
});

test("Testing sets bounded resources, restores without changing XP, cures and clears combat restrictions", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne"); f.tab(TAB.TESTING);
  f.target.getSkillManager().setMaxLevels(Skill.PRAYER, 70);
  const xp = f.target.getSkillManager().getExperience(Skill.HITPOINTS);
  for (const [name, amount, read] of [
    ["Hitpoints", 3, () => f.target.getHitpoints()],
    ["Prayer points", 25, () => f.target.getSkillManager().getCurrentLevel(Skill.PRAYER)],
    ["Run energy", 42, () => f.target.getRunEnergy()],
    ["Special attack", 55, () => f.target.getSpecialPercentage()],
  ]) {
    f.select(name); f.action(1); f.amount(amount); await f.settle(); assert.equal(read(), amount);
    f.action(1); f.amount(-1); await f.settle(); assert.equal(read(), amount);
    f.action(1); f.amount(1000); await f.settle(); assert.equal(read(), amount);
    f.action(2); await f.settle(); assert.equal(read(), name === "Hitpoints" ? 1 : 0);
  }
  f.target.setPoisonDamage(12); f.target.setVenomed(true);
  f.target.getCombat().getTeleblockTimer().start(100);
  f.target.getCombat().getPrayerBlockTimer().start(100);
  for (const key of ["FREEZE", "FREEZE_IMMUNITY", "STUN", "STUN_IMMUNITY"]) f.target.getTimers().registers(core.TimerKey[key], 20);
  f.select("Clear combat restrictions"); f.action(0); await f.settle();
  assert.ok(f.target.getCombat().getTeleblockTimer().finished());
  assert.ok(f.target.getCombat().getPrayerBlockTimer().finished());
  for (const key of ["FREEZE", "FREEZE_IMMUNITY", "STUN", "STUN_IMMUNITY"]) assert.ok(!f.target.getTimers().has(core.TimerKey[key]));
  f.select("Full restore"); f.action(0); await f.settle();
  assert.equal(f.target.getHitpoints(), 10); assert.equal(f.target.getRunEnergy(), 100); assert.equal(f.target.getSpecialPercentage(), 100);
  assert.equal(f.target.getSkillManager().getCurrentLevel(Skill.PRAYER), 70);
  assert.equal(f.target.getPoisonDamage(), 0); assert.equal(f.target.isVenomed(), false);
  assert.equal(f.target.getSkillManager().getExperience(Skill.HITPOINTS), xp);
  assert.equal(f.target.getSkillManager().getMaxLevel(Skill.HITPOINTS), 10);
  core.PrayerHandler.activatePrayerPrayerId(f.target, core.PrayerHandler.THICK_SKIN);
  f.select("Deactivate prayers"); f.action(0); await f.settle();
  assert.ok(!f.target.getPrayerActive().some(Boolean));
  f.target.getCombat().setTarget(f.actor);
  f.select("Stop combat"); f.action(0); await f.settle(); assert.equal(f.target.getCombat().getTarget(), null);
});

test("Character uses canonical prayer unlocks and protects delayed actions and owner modes", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne"); f.section(SECTION.CHARACTER);
  for (const prayer of ["Preserve", "Rigour", "Augury"]) {
    f.select(`Unlock ${prayer}`); f.action(0); await f.settle();
    assert.equal(f.target.getAttribute(`prayer:${prayer.toLowerCase()}-unlocked`), true);
  }
  assert.equal(f.persistence.load(f.target.getUsername(), f.target.getProfile()).attributes["prayer:rigour-unlocked"], true);
  f.tab(TAB.GODMODE);
  f.select("Infinite run energy"); f.action(0); await f.settle();
  f.target.setRunEnergy(30); PluginManager.emitPlayerProcess({ player: f.target }); assert.equal(f.target.getRunEnergy(), 100);
  f.action(1); await f.settle(); assert.notEqual(f.target.getAttribute("admin:infinite-run-energy"), true);
  f.select("Infinite hitpoints"); f.actor.setRights(Rights.ADMINISTRATOR); f.action(0); await f.settle();
  assert.notEqual(f.target.getAttribute("admin:infinite-health"), true);
  f.click(C.UTILITY);
  assert.ok(!f.rows().some(row => row.name === "Infinite hitpoints"));
  f.tab(TAB.TESTING);
  f.select("Special attack"); f.action(1); const stale = f.actor.getEnteredAmountAction();
  f.choose("TargetTwo"); stale.execute(10); await f.settle(); assert.equal(f.other.getSpecialPercentage(), 100);
  f.tab(TAB.TESTING); f.select("Hitpoints"); f.action(1); f.actor.setRights(Rights.MODERATOR); f.amount(1); await f.settle();
  assert.equal(f.other.getHitpoints(), 10);
});

test("Testing opens only the actor's bank and obeys its command permission", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.tab(TAB.TESTING);
  let opened = 0; f.actor.getBank = () => ({ open() { opened++; f.actor.setInterfaceId(12); } });
  f.select("Open bank"); f.action(0); await f.settle(); assert.equal(opened, 1); assert.equal(f.actor.getInterfaceId(), 12);
  f.open(); f.choose("TargetOne"); f.tab(TAB.TESTING); assert.ok(!f.rows().some(row => row.name === "Open bank"));
  PluginManager.setCommandRights("bank", Rights.DEVELOPER);
  t.after(() => PluginManager.setCommandRights("bank", Rights.OWNER));
  f.click(C.SELF_BUTTON); assert.ok(!f.rows().some(row => row.name === "Open bank"));
});

test("Godmode toggles independently, affects real spell/prayer costs and visibility, and resets on logout", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne"); f.tab(TAB.GODMODE);
  assert.equal(f.definition.tabs.labels.length, 7);
  assert.equal(f.definition.widgets.find(widget => widget.uid === uid(C.TAB_START + TAB.NPCS)).rawX + 47 <= 494, true);
  const toggle = async (name, enabled) => { f.select(name); f.action(enabled ? 0 : 1); await f.settle(); };
  const target = f.target, skills = target.getSkillManager();
  skills.setMaxLevels(Skill.MAGIC, 99).setCurrentLevels(Skill.MAGIC, 99);
  skills.setMaxLevels(Skill.PRAYER, 70).setCurrentLevels(Skill.PRAYER, 1);
  const wind = core.CombatSpells.WIND_STRIKE;
  assert.equal(wind.canCast(target, false), false);
  await toggle("Infinite runes", true);
  assert.equal(wind.canCast(target, true), true, "no rune ownership needed");
  target.getInventory().adds(I.AIR_RUNE, 10).adds(I.MIND_RUNE, 10);
  const cycle = core.World.processCycle;
  core.World.processCycle++;
  t.after(() => { core.World.processCycle = cycle; });
  assert.equal(wind.canCast(target, true), true);
  assert.equal(target.getInventory().getAmount(I.AIR_RUNE), 10, "held runes are not consumed");
  assert.equal(target.getInventory().getAmount(I.MIND_RUNE), 10);
  const display = { player: target, active: false }; PluginManager.emitCustomEvent("magic:infinite-rune-display", display); assert.equal(display.active, true);
  await toggle("Infinite prayer", true);
  assert.equal(skills.getCurrentLevel(Skill.PRAYER), 70);
  core.PrayerHandler.activatePrayerPrayerId(target, core.PrayerHandler.PROTECT_FROM_MELEE);
  for (let tick = 0; tick < 500; tick++) core.PrayerHandler.processDrain(target);
  assert.equal(skills.getCurrentLevel(Skill.PRAYER), 70);
  const effects = require("../dist/game/content/combat/EquipmentEffects");
  assert.equal(effects.applyPrayerDrainModifiers(target, 100, {}), 0);
  await toggle("Infinite special attack", true); assert.equal(effects.applySpecialEnergyCostModifiers(target, 50), 0);
  target.setSpecialPercentage(10); PluginManager.emitPlayerProcess({ player: target }); assert.equal(target.getSpecialPercentage(), 100);
  await toggle("Invisible", true); assert.equal(target.isAppearanceHidden(), true);
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  assert.equal(ClientConnection.prototype.getPlayerAppearance.call({}, target).hidden, true, "the native appearance sent to observers is hidden");
  await toggle("Noclip", true); assert.equal(require("../dist/game/model/movement/Noclip").isNoclip(target), true);
  await toggle("Infinite hitpoints", true); target.setHitpoints(1); assert.equal(target.getHitpoints(), 10);
  await toggle("Infinite hitpoints", false); target.setHitpoints(4); assert.equal(target.getHitpoints(), 4);
  assert.equal(target.isAppearanceHidden(), true, "disabling HP leaves invisibility on");
  await toggle("Infinite runes", false); assert.equal(wind.itemsToConsume(target).length, 2);
  assert.equal(effects.applyPrayerDrainModifiers(target, 100, {}), 0, "disabling runes leaves infinite prayer on");
  f.tab(TAB.TESTING); f.select("Full restore"); f.action(0); await f.settle();
  const saved = f.persistence.load(target.getUsername(), target.getProfile());
  for (const key of ["admin:invisible", "admin:infinite-prayer", "admin:infinite-runes", "admin:infinite-special", "admin:noclip"]) assert.equal(saved.attributes[key], undefined);
  PluginManager.emitPlayerLogout({ player: target, username: target.getUsername() });
  assert.equal(target.isAppearanceHidden(), false);
  assert.equal(effects.applyPrayerDrainModifiers(target, 10, {}), 10);
  assert.equal(effects.applySpecialEnergyCostModifiers(target, 50), 50);
  assert.equal(require("../dist/game/model/movement/Noclip").isNoclip(target), false);
});

test("Spawn NPCs uses the actor's reachable tiles, never persists, and cleans only its admin's spawns", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne"); f.tab(TAB.NPCS);
  f.actor.setLocation(new core.Location(3200, 3200, 0));
  f.target.setLocation(new core.Location(1000, 1000, 0));
  t.mock.method(core.RegionManager, "getRegion", () => ({}));
  t.mock.method(core.RegionManager, "getClipping", () => 0);
  const { MobileList } = require("../dist/game/entity/impl/MobileList");
  const previous = core.World.npcs, queue = core.World.getRemoveNPCQueue(), queued = [...queue];
  core.World.npcs = new MobileList(120); queue.length = 0;
  t.after(() => { core.World.npcs = previous; queue.splice(0, Infinity, ...queued); });
  const write = t.mock.method(fs, "appendFileSync", () => { throw new Error("temporary spawns must not touch spawn files"); });
  const save = t.mock.method(f.persistence, "save", () => { throw new Error("temporary spawns must not write player saves"); });
  const spawn = async (input) => {
    const [id, count] = input.split(" ").map(Number); f.socket(String(id));
    const row = f.rows().find(row => row.npc === id);
    if (!row) { assert.equal(JSON.parse(f.actor.texts.get(uid(C.SEARCH_RESPONSE))).rows.length, 0); return; }
    f.click(C.ROW_LABEL_START, { slot: row.id }); f.action(1); f.amount(count); await f.settle();
  };
  const id = core.NpcIdentifiers.GOBLIN;
  await spawn(`${id} 21`); assert.equal(core.World.npcs.sizeReturn(), 0);
  await spawn(`65535 1`); assert.equal(core.World.npcs.sizeReturn(), 0);
  await spawn(`${id} 2`);
  const created = [...core.World.npcs]; assert.equal(created.length, 2, f.actor.messages.at(-1));
  assert.ok(created.every(npc => npc.__skipDefaultRespawn === true));
  assert.equal(new Set(created.map(npc => `${npc.getLocation().getX()},${npc.getLocation().getY()}`)).size, 2);
  assert.ok(created.every(npc => npc.getLocation().getDistance(f.actor.getLocation()) <= 10));
  const unrelated = core.NPC.create(id, f.target.getLocation().clone()); core.World.npcs.add(unrelated);
  const tasks = t.mock.method(core.TaskManager, "submit", () => { throw new Error("test NPC death must not queue a respawn"); });
  new (require("../dist/game/task/impl/NPCDeathTask").NPCDeathTask)(created[0]).remove();
  assert.equal(tasks.mock.callCount(), 0); assert.ok(queue.includes(created[0]));
  core.World.npcs.remove(created[0]); queue.length = 0;
  f.click(C.ADD_ITEMS); await f.settle();
  assert.deepEqual(queue, [created[1]]); assert.ok(!queue.includes(unrelated));
  core.World.npcs.remove(created[1]); queue.length = 0;
  await spawn(`${id} 1`); PluginManager.emitPlayerLogout({ player: f.actor, username: f.actor.getUsername() }); assert.equal(queue.length, 1);
  assert.ok(!queue.includes(unrelated));
  assert.equal(write.mock.callCount(), 0); assert.equal(save.mock.callCount(), 0);
});

test("Spawn sub-tabs place pictured ground items under the actor and reject stale searches and prompts", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne"); f.tab(TAB.SPAWN);
  assert.equal(Layout.TAB_LABELS[TAB.SPAWN], "Spawn");
  assert.equal(f.actor.texts.get(uid(C.TARGET)), "Spawning as: AdminFixture");
  f.actor.setLocation(new core.Location(3200, 3200, 0));
  f.target.setLocation(new core.Location(1000, 1000, 0));
  t.mock.method(core.RegionManager, "getRegion", () => ({}));
  t.mock.method(core.RegionManager, "getClipping", () => 0);
  const floor = core.World.getItems(), previous = [...floor];
  t.after(() => floor.splice(0, floor.length, ...previous));
  const save = t.mock.method(f.persistence, "save", () => { throw new Error("floor spawns must not save players"); });
  f.socket(String(core.NpcIdentifiers.GOBLIN)); f.select("Goblin"); f.action(1);
  const npcPrompt = f.actor.getEnteredAmountAction(), npcSession = f.actor.texts.get(uid(C.SEARCH_SESSION));
  f.click(C.SPAWN_LABEL_START + 1);
  assert.equal(f.actor.getEnteredAmountAction(), null);
  assert.notEqual(f.actor.texts.get(uid(C.SEARCH_SESSION)), npcSession);
  const cleared = f.actor.texts.get(uid(C.SEARCH_RESPONSE));
  f.socket("Goblin", { session: npcSession });
  assert.equal(f.actor.texts.get(uid(C.SEARCH_RESPONSE)), cleared);
  npcPrompt.execute(2);
  assert.deepEqual(floor, previous);
  f.socket(String(I.COINS)); f.select("Coins");
  assert.deepEqual(f.actor.items.get(uid(C.PANEL_ICON)), [I.COINS, 0, 1]);
  assert.ok(f.row("Coins").panel.description.startsWith(core.ItemDefinition.forId(I.COINS).getExamine()));
  assert.equal(f.actor.texts.get(uid(BUTTONS[0].label)), "Spawn 1 under me");
  assert.equal(f.actor.texts.get(uid(BUTTONS[1].label)), "Spawn X");
  f.action(0);
  const first = floor.at(-1);
  assert.equal(first.getPosition().equals(f.actor.getLocation()), true);
  assert.equal(first.getOwner(), f.actor.getUsername());
  assert.equal(f.target.getInventory().getAmount(I.COINS), 0);
  f.action(1); f.amount(4);
  const batch = floor.slice(previous.length + 1);
  assert.equal(batch.length, 4);
  assert.equal(new Set(batch.map(item => `${item.getPosition().getX()},${item.getPosition().getY()}`)).size, 4);
  assert.ok(batch.every(item => item.getPosition().getDistance(f.actor.getLocation()) <= 10));
  assert.ok(batch.every(item => item.getItem().getAmount() === 1));
  f.action(1); const oldAmount = f.actor.getEnteredAmountAction();
  const itemSession = f.actor.texts.get(uid(C.SEARCH_SESSION));
  f.click(C.SPAWN_START);
  oldAmount.execute(5);
  assert.equal(floor.length, previous.length + 5);
  assert.notEqual(f.actor.texts.get(uid(C.SEARCH_SESSION)), itemSession);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(JSON.parse(f.actor.texts.get(uid(C.LAYOUT))).focusSearch, true);
});

test("the canonical source providers describe all implemented teleport families without travel or player writes", t => {
  // Registration only: do not start a world, spawn NPCs, run tasks or touch player saves.
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  const Catalogue = require("../plugins/tools/adminpanel/Teleports.AdminPanel");
  const errors = [];
  t.mock.method(console, "error", label => errors.push(label));
  const forbidden = () => { throw new Error("describing a destination must not travel, roll RNG, create an instance or write a player"); };
  t.mock.method(Math, "random", forbidden);
  for (const name of ["teleport", "checkReqs", "confirm"]) t.mock.method(core.TeleportHandler, name, forbidden);
  t.mock.method(core.TaskManager, "submit", forbidden);
  const sailing = Object.freeze({ boats: Object.freeze([]) });
  const reads = Object.freeze({
    getAttribute: () => undefined,
    getSkillManager: () => Object.freeze({ getMaxLevel: () => 1, getCombatLevel: () => 3 }),
    getSailing: () => sailing,
  });
  const player = new Proxy(reads, {
    get(target, key) { if (key in target) return target[key]; throw new Error(`unexpected player access: ${String(key)}`); },
    set: forbidden, defineProperty: forbidden, deleteProperty: forbidden,
  });
  const api = { core, emitCustomEvent: (name, request) => PluginManager.emitCustomEvent(name, request) };
  const groups = Catalogue.destinations(api, player);
  assert.deepEqual(errors, [], "provider hooks must not swallow a failed read-only check");
  const group = source => { const found = groups.find(value => value.path.join("/") === source); assert.ok(found, source); return found.places; };
  const place = (source, name, tile) => {
    const found = group(source).find(value => value.name === name); assert.ok(found, `${source}: ${name}`);
    assert.deepEqual([found.x, found.y, found.z], tile, `${source}: ${name} canonical landing`);
  };
  place("Spellbooks/Standard spellbook", "lumbridge home teleport", [3222, 3218, 0]);
  place("Spellbooks/Ancient spellbook", "edgeville home teleport (landing area origin)", [3087, 3501, 0]);
  place("Spellbooks/Lunar spellbook", "lunar home teleport", [2094, 3913, 0]);
  place("Spellbooks/Arceuus spellbook", "arceuus home teleport (landing area origin)", [1698, 3880, 0]);
  for (const spell of core.LunarSpells.getTeleportDestinations(true)) {
    place("Spellbooks/Lunar spellbook", spell.name, Catalogue.tileOf(spell.destination));
  }
  const counts = {
    "Items/Camulet": 2, "Items/Chronicle": 1, "Items/Eternal teleport crystal": 2,
    "Jewellery/Ring of the elements": 4, "Jewellery/Ring of shadows": 5,
    "Jewellery/Drakan's medallion": 4, "Items/Icy basalt": 1, "Items/Stony basalt": 2,
    "Jewellery/Xeric's talisman": 5, "Items/Kharedst's memoirs": 5, "Items/Book of the dead": 5,
    "Items/Royal seed pod": 1, "Items/Teleport crystal": 1, "Items/Ectophial": 1,
    "Items/Skull sceptre": 1, "Items/Skull sceptre (i)": 1, "Items/Mythical cape": 1,
    "Items/Calcified moth": 1, "Jewellery/Giantsoul amulet": 3, "Jewellery/Pendant of Ates": 6,
    "Jewellery/Amulet of glory (t)": 4, "Jewellery/Amulet of eternal glory": 4, "Jewellery/Slayer ring (eternal)": 6,
    "Items/Magic whistle": 3, "Items/Goblin village sphere": 3, "Items/Master scroll book": 22,
    "Items/Teleport scrolls/Revenant cave teleport": 3, "Skillcapes/Strength cape": 1,
    "Skillcapes/Fishing cape": 2, "Skillcapes/Hunter cape": 3, "Skillcapes/Construction cape": 9,
    "Skillcapes/Defence cape": 2, "Skillcapes/Quest point cape": 1, "Skillcapes/Music cape": 1,
    "Skillcapes/Sailing cape": 1, "Spirit trees": 13, "Wilderness obelisks": 6,
    "Runecrafting/Mysterious ruins": 13,
  };
  for (const [source, count] of Object.entries(counts)) assert.equal(group(source).length, count, source);
  place("Jewellery/Drakan's medallion", "Darkmeyer", [3592, 3337, 0]);
  place("Jewellery/Drakan's medallion", "Castle Drakan", [3167, 7707, 0]);
  place("Items/Goblin village sphere", "Goblin Village (Another Slice of H.A.M. route)", [2955, 3507, 0]);
  place("Items/Teleport crystal", "Lletya", [2352, 3170, 0]);
  place("Items/Eternal teleport crystal", "Lletya", [2328, 3170, 0]);
  place("Items/Teleport tablets", "Ape atoll teleport", [2770, 9100, 0]);
  place("Items/Teleport tablets", "Varrock teleport: Grand Exchange", [3163, 3478, 0]);
  place("Items/Teleport scrolls", "Guthixian temple teleport", [4063, 4557, 0]);
  place("Spirit trees", "Etceteria", [2612, 3858, 0]);
  place("Runecrafting/Mysterious ruins", "Blood altar", [3239, 4832, 0]);
  place("NPC teleports/Aubury", "Rune essence mine", [2913, 4832, 0]);
  const Capes = require("../plugins/items/skillcapes/Common.SkillCapes");
  const maxSources = new Set([Capes.MAX.cape, ...Capes.COMBINED_BY_CAPE.keys()].map(id => core.CacheDefinitions.getItem(id).name));
  for (const source of maxSources) assert.equal(group(`Skillcapes/${source}`).length, source === "Max cape" ? 20 : 18, source);
  assert.ok(!groups.some(value => value.path.includes("Enchanted lyre") || value.path.includes("Grand seed pod")), "unimplemented travel must not become a fake static button");
  assert.ok(!groups.flatMap(value => value.places).some(place => place.name === "teleport to house"), "a fallback portal must not masquerade as a player house");
  for (const source of groups) {
    assert.equal(new Set(source.places.map(value => value.key)).size, source.places.length, `deduplicated ${source.path}`);
    assert.ok(source.places.every(value => Catalogue.validTile([value.x, value.y, value.z])));
  }
  const summary = Object.fromEntries(["Spellbooks", "Minigame teleports", "Jewellery", "Items", "Skillcapes", "Spirit trees", "Fairy rings", "Wilderness obelisks", "Runecrafting", "NPC teleports", "Diary rewards", "Server destinations", "World"].map(branch => [branch,
    groups.filter(value => value.path[0] === branch).reduce((count, value) => count + value.places.length, 0)]));
  t.diagnostic(`Source coverage: ${JSON.stringify(summary)}; ${groups.length} source paths, ${groups.reduce((count, value) => count + value.places.length, 0)} destinations`);
  t.mock.restoreAll();
  const f = fixture(t, Rights.OWNER, null);
  for (let index = 0; index < 205; index++) f.login(`Full${String(index).padStart(4, "0")}`);
  for (let index = 0; index < 250; index++) f.quests.push({ key: `full-${index}`, name: `Catalogue quest ${index}`, stage: 0, complete: false });
  f.open();
  const teleportIds = new Set(JSON.parse(f.actor.texts.get(uid(C.LAYOUT))).tabs[TAB.TELEPORTS]);
  const visible = f.rows().filter(row => teleportIds.has(row.id) && !row.expandable);
  const expected = Catalogue.destinations(api, f.actor).flatMap(group => group.places);
  assert.equal(visible.length, expected.length, "the complete canonical catalogue fits in the panel");
  assert.ok(visible.length >= 1080, `full catalogue has ${visible.length} landings`);
  for (const component of DATA_COMPONENTS) assert.ok(Buffer.byteLength(f.actor.texts.get(uid(component)), "latin1") <= 40000);
});


test("world interaction preserves only opted-in panels, explicit close and bank replace them", async t => {
  const f = fixture(t);
  const player = new Player(null).setUsername("LifecycleFixture");
  const packets = [];
  player.getSession = () => ({ sendClientPacket: packet => packets.push(packet), write() {} });
  const sender = player.getPacketSender();
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const connection = new ClientConnection({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  connection.player = player;
  const send = async packet => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  let requestedWalk, cancelled = false;
  t.mock.method(player.getMovementQueue(), "requestWalk", tile => { requestedWalk = tile; return true; });
  player.setInterfaceId(GROUP_ID);
  sender.sendSubInterface(Layout.MAIN_MODAL_UID, GROUP_ID, 0);
  player.setEnteredAmountAction({ execute() {}, cancel() { cancelled = true; } });
  await send({ type: "move", worldX: 3223, worldY: 3218, modifierFlags: 0, run: false });
  assert.equal(requestedWalk.getX(), 3223, "the real network route requested the walk");
  assert.equal(cancelled, true, "walking cancels a pending input without closing the tool");
  assert.equal(sender.hasInputPrompt(), false);
  assert.equal(player.getInterfaceId(), GROUP_ID, "walking must keep the admin panel");
  assert.equal(sender.isSubInterfaceOpen(GROUP_ID), true);
  assert.equal(player.busy(), false, "a preserved tool panel must not block object/NPC actions");
  const canEquip = t.mock.method(core.PluginManager, "emitCanEquip", () => true);
  const emit = core.PluginManager.emitCustomEvent;
  t.mock.method(core.PluginManager, "emitCustomEvent", (name, event) => {
    if (name !== "equipment:changed") return emit.call(core.PluginManager, name, event);
  });
  player.getInventory().adds(I.BRONZE_SCIMITAR, 1);
  core.EquipPacketListener.equip(player, I.BRONZE_SCIMITAR, player.getInventory().getSlotForItemId(I.BRONZE_SCIMITAR), core.Inventory.INTERFACE_ID);
  assert.equal(player.getEquipment().forSlot(core.Equipment.WEAPON_SLOT).getId(), I.BRONZE_SCIMITAR);
  assert.equal(player.getInterfaceId(), GROUP_ID, "ordinary equipment changes must keep the tool panel");
  assert.ok(canEquip.mock.callCount() > 0);
  await send({ type: "interface_close" });
  assert.equal(player.getInterfaceId(), -1, "explicit close still closes it");
  player.setInterfaceId(GROUP_ID); sender.sendSubInterface(Layout.MAIN_MODAL_UID, GROUP_ID, 0);
  player.setInterfaceId(core.Bank.MAIN_INTERFACE_ID); sender.sendSubInterface(Layout.MAIN_MODAL_UID, core.Bank.MAIN_INTERFACE_ID, 0);
  assert.equal(sender.isSubInterfaceOpen(GROUP_ID), false);
  await send({ type: "move", worldX: 3223, worldY: 3218, modifierFlags: 0, run: false });
  assert.equal(player.getInterfaceId(), -1, "bank retains its normal interruption lifecycle");
});


test("player selection opens the combined editor only through Edit player", t => {
  const f = fixture(t); f.open(); f.select("TargetOne");
  assert.equal(f.actor.texts.get(uid(C.TARGET)), "Target: TargetOne");
  assert.equal(f.actor.texts.get(uid(BUTTONS[0].label)), "Edit player");
  f.action(0);
  assert.equal(JSON.parse(f.actor.texts.get(uid(C.LAYOUT))).active, TAB.EDITOR);
  assert.equal(f.actor.hidden.get(uid(C.SKILL_VIEW)), false);
  assert.equal(f.actor.texts.get(uid(C.SKILL_NAME_START)), "Attack");
  assert.match(f.actor.actions.get(uid(C.SKILL_BUTTON_START))[0], /TargetOne.*Attack/);
});

test("live inventory and bank edits use named pickers, refresh current slots and persist safely", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne");
  for (const [section, name] of [[SECTION.INVENTORY, "inventory"], [SECTION.BANK, "bank"]]) {
    f.section(section); const start = name === "bank" ? V.BANK_START : V.INVENTORY_START; f.click(start); f.socket("Bronze arrow");
    const response = JSON.parse(f.actor.texts.get(uid(C.SEARCH_RESPONSE)));
    const item = response.rows.find(row => row.icon === I.BRONZE_ARROW);
    assert.ok(item); assert.match(item.panel.info, new RegExp(name));
    f.click(C.ROW_LABEL_START, { slot: item.id }); f.action(1); f.amount(12); await f.settle();
    const held = name === "bank" ? f.target.getBank(0) : f.target.getInventory();
    assert.equal(held.getAmount(I.BRONZE_ARROW), 12);
    f.section(section); assert.equal(f.actor.items.get(uid(start))[2],12); f.click(start);
    assert.equal(f.actor.texts.get(uid(C.PANEL_DESCRIPTION)), core.ItemDefinition.forId(I.BRONZE_ARROW).getExamine());
    f.click(start); f.action(1); const stale = f.actor.getEnteredAmountAction();
    held.adds(I.BRONZE_ARROW, 1); f.events.get("process")({ player: f.actor });
    assert.equal(f.actor.items.get(uid(start))[2],13);
    stale.execute(12); await f.settle(); assert.equal(held.getAmount(I.BRONZE_ARROW), 13);
    f.click(start); f.action(2); f.amount(1); await f.settle(); assert.equal(held.getAmount(I.BRONZE_ARROW), 12);
    f.click(start,{opId:2}); f.amount(1); await f.settle(); assert.equal(held.getAmount(I.BRONZE_ARROW), 13);
  }
  f.choose("TargetTwo"); f.section(SECTION.INVENTORY); f.click(C.CONTAINER_ADD); await f.settle();
  assert.equal(f.other.getInventory().getAmount(I.BRONZE_ARROW), 0);
  const saved = f.persistence.load(f.target.getUsername(), f.target.getProfile());
  assert.ok(saved.getInventory().some(item => item?.id === I.BRONZE_ARROW));
});

test("equipment picker enforces wearable slots and live requirements without replacing held equipment", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.choose("TargetOne"); f.section(SECTION.EQUIPMENT);
  const equipGate = t.mock.method(core.PluginManager, "emitCanEquip", () => true);
  t.mock.method(core.PluginManager, "emitCanUnequip", () => true);
  const event = core.PluginManager.emitCustomEvent;
  t.mock.method(core.PluginManager, "emitCustomEvent", (name, payload) => {
    if (name !== "equipment:changed") return event.call(core.PluginManager, name, payload);
  });
  const add = async name => {
    const slot=f.target.getEquipment().forSlot(core.Equipment.WEAPON_SLOT).getId()<0?core.Equipment.WEAPON_SLOT:core.Equipment.HEAD_SLOT;
    f.click(V.EQUIPMENT_START+slot); f.socket(name);
    const row = JSON.parse(f.actor.texts.get(uid(C.SEARCH_RESPONSE))).rows.find(row => row.name === name);
    assert.ok(row); f.click(C.ROW_LABEL_START, { slot: row.id }); f.action(0); await f.settle();
  };
  await add("Bronze scimitar");
  assert.equal(f.target.getEquipment().forSlot(core.Equipment.WEAPON_SLOT).getId(), I.BRONZE_SCIMITAR);
  f.section(SECTION.EQUIPMENT); await add("Iron scimitar");
  assert.equal(f.target.getEquipment().forSlot(core.Equipment.WEAPON_SLOT).getId(), I.BRONZE_SCIMITAR);
  assert.match(f.actor.messages.at(-1), /different equipment slot/);
  f.section(SECTION.EQUIPMENT); f.click(V.EQUIPMENT_START+core.Equipment.WEAPON_SLOT,{opId:4}); await f.settle();
  assert.equal(f.target.getEquipment().forSlot(core.Equipment.WEAPON_SLOT).getId(), -1);
  f.section(SECTION.EQUIPMENT); await add("Shark"); assert.match(f.actor.messages.at(-1), /different equipment slot/);
  assert.ok(equipGate.mock.callCount() > 0);
  equipGate.mock.mockImplementation(() => false);
  f.section(SECTION.EQUIPMENT); await add("Bronze scimitar"); assert.match(f.actor.messages.at(-1), /cannot be equipped now/);
});

test("shared bank undo restores collapsed tabs and refuses changes in any bank tab", t => {
  const f=fixture(t,Rights.OWNER),Containers=require('../plugins/tools/Containers.PlayerTools');
  f.target.getBank(1).setItem(0,new core.Item(I.BRONZE_ARROW,7));
  f.target.getBank(2).setItem(0,new core.Item(I.RAKE,3));
  const remove=()=>Containers.apply(core,f.target,{container:'bank',bankTab:1,mode:'remove',slot:0,
    signature:Containers.signature(f.target.getBank(1).getItems()[0]),quantity:7});
  const result=remove();
  assert.equal(f.target.getBank(1).getAmount(I.RAKE),3);
  Containers.apply(core,f.target,{container:'bank',bankTab:1,mode:'undo',undo:result.undo});
  assert.equal(f.target.getBank(1).getAmount(I.BRONZE_ARROW),7);
  assert.equal(f.target.getBank(2).getAmount(I.RAKE),3);
  assert.equal(f.target.getBank(1).getAmount(I.RAKE),0);
  const next=remove(); f.target.getBank(0).adds(I.BRONZE_ARROW,1);
  assert.throws(()=>Containers.apply(core,f.target,{container:'bank',bankTab:1,mode:'undo',undo:next.undo}),/changed.*Undo/);
  assert.equal(f.target.getBank(0).getAmount(I.BRONZE_ARROW),1);
  assert.equal(f.target.getBank(1).getAmount(I.RAKE),3);
});

test("NPC search shows only combat stats supplied by the cache", () => {
  const search = require("../plugins/tools/adminpanel/Npcs.AdminPanel").search;
  const definitions = [
    { name: "Fixture guard", modelIds: [1], combatLevel: 21, hitpoints: 35 },
    { name: "Fixture citizen", modelIds: [2], combatLevel: -1, hitpoints: -1 },
  ];
  const cacheCore = {
    CacheDefinitions: { getCounts: () => ({ npcs: definitions.length }), getCustomDefinitions: () => [], getNpc: id => definitions[id] },
    NpcDefinition: { forId: () => ({ getCombatLevel: () => 0, getHitpoints: () => 10 }) },
  };
  const rows = search(cacheCore, "Fixture");
  assert.equal(rows.find(row => row.name === "Fixture citizen").hp, undefined, "the gameplay default is not known HP");
  assert.equal(rows.find(row => row.name === "Fixture guard").hp, 35);
  assert.equal(rows.find(row => row.name === "Fixture guard").level, 21);
});

test("clicking rendered tab captions reaches the same authoritative tab as its background", t => {
  const f = fixture(t); f.open();
  assert.doesNotThrow(() => f.click(C.TAB_LABEL_START + TAB.EDITOR));
  assert.equal(f.actor.hidden.get(uid(C.SKILL_VIEW)), false);
  assert.equal(f.actor.hidden.get(uid(C.LIST_VIEW)), true);
  f.click(C.TAB_LABEL_START + TAB.CHEATS);
  assert.equal(f.actor.hidden.get(uid(C.SKILL_VIEW)), true);
});

test("navigation and searches stay authoritative while a save is pending", async t => {
  const f = fixture(t, Rights.OWNER); f.open(); f.search("Bronze arrow"); f.select("Bronze arrow");
  let finish;
  f.persistence.flush = () => new Promise(resolve => { finish = resolve; });
  f.action(0);
  f.click(C.TAB_LABEL_START + TAB.EDITOR);
  assert.equal(f.actor.hidden.get(uid(C.SKILL_VIEW)), false, "caption navigation is not rejected during a save");
  assert.equal(f.actor.hidden.get(uid(C.CONTAINER_ADD)), true, "item undo cannot overlap the native skill grid");
  f.click(C.TAB_LABEL_START + TAB.NPCS);
  f.socket("Guard");
  assert.ok(JSON.parse(f.actor.texts.get(uid(C.SEARCH_RESPONSE))).rows.length > 0, "read-only search remains available");
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.actor.hidden.get(uid(C.SKILL_VIEW)), true, "save completion keeps the current tab");
  assert.equal(f.actor.getInventory().getAmount(I.BRONZE_ARROW), 1);
});


test("leaving an Admin section aborts its own value prompt without answering it", async t => {
  const f = fixture(t); f.open(); f.section(SECTION.SKILLS); f.skill("Attack");
  const stale = f.actor.getEnteredAmountAction(); assert.ok(stale);
  f.tab(TAB.CHEATS);
  assert.equal(f.actor.getEnteredAmountAction(), null, "the old skill prompt must release keyboard input");
  stale.execute(50); await f.settle();
  assert.equal(f.actor.getSkillManager().getMaxLevel(Skill.ATTACK), 1);
  f.section(SECTION.SKILLS); f.skill("Attack");
  f.click(C.SECTION_LABEL_START + SECTION.QUESTS);
  assert.equal(f.actor.getEnteredAmountAction(), null);
  f.section(SECTION.SKILLS); f.skill("Attack");
  const unrelated = { execute() {} }; f.actor.setEnteredAmountAction(unrelated);
  f.tab(TAB.CHEATS);
  assert.equal(f.actor.getEnteredAmountAction(), unrelated, "another interface's prompt is never aborted");
});


test("item picking is opened from container slots without a Spawn items section", t => {
  const f = fixture(t); f.open(); f.choose("TargetOne"); f.section(SECTION.INVENTORY);
  assert.ok(!Layout.SECTION_LABELS.includes("Spawn items"));
  f.click(V.INVENTORY_START+9);
  assert.equal(JSON.parse(f.actor.texts.get(uid(C.LAYOUT))).active,TAB.ITEMS);
  f.tab(TAB.EDITOR);
  assert.equal(JSON.parse(f.actor.texts.get(uid(C.LAYOUT))).active,TAB.EDITOR);
  assert.equal(f.actor.hidden.get(uid(V.INVENTORY)),false);
});


function dragContainer(f, source, destination, sourceItemId, targetItemId=65535) {
  const event={player:f.actor,packet:{type:'widget_drag',sourceWidgetId:uid(source),targetWidgetId:uid(destination),sourceSlot:-1,targetSlot:-1,sourceItemId,targetItemId},handled:false};
  f.events.get('player:widget-action')(event); assert.equal(event.handled,true);
}
test('native inventory empty slots, quantities, slot actions and metadata-preserving drags work', async t => {
  const f=fixture(t,Rights.OWNER); f.open(); f.choose('TargetOne'); f.section(SECTION.INVENTORY);
  f.click(V.INVENTORY_START+9); f.socket('Bronze arrow');
  const row=JSON.parse(f.actor.texts.get(uid(C.SEARCH_RESPONSE))).rows.find(row=>row.icon===I.BRONZE_ARROW);
  f.click(C.ROW_LABEL_START,{slot:row.id}); f.action(1); f.amount(25); await f.settle();
  assert.equal(f.target.getInventory().getItems()[9].getId(),I.BRONZE_ARROW);
  assert.equal(f.target.getInventory().getItems()[9].getAmount(),25);
  assert.equal(JSON.parse(f.actor.texts.get(uid(C.LAYOUT))).active,TAB.EDITOR);
  assert.equal(f.actor.hidden.get(uid(C.LIST_VIEW)),true);
  assert.deepEqual(f.actor.items.get(uid(V.INVENTORY_START+9)),[I.BRONZE_ARROW,0,25]);
  f.click(V.INVENTORY_START+9); assert.equal(f.actor.texts.get(uid(C.PANEL_DESCRIPTION)),core.ItemDefinition.forId(I.BRONZE_ARROW).getExamine());
  f.amount(40); await f.settle(); assert.equal(f.target.getInventory().getItems()[9].getAmount(),40);
  f.target.getInventory().getItems()[9].setMetaValue('fixture-marker',7); f.events.get('process')({player:f.actor});
  dragContainer(f,V.INVENTORY_START+9,V.INVENTORY_START+1,I.BRONZE_ARROW); await f.settle();
  assert.equal(f.target.getInventory().getItems()[1].getMetaValue('fixture-marker'),7);
  assert.equal(f.target.getInventory().getItems()[9].getId(),-1);
  assert.ok(!f.actor.items.has(uid(V.INVENTORY_START+9)));
  dragContainer(f,V.INVENTORY_START+1,V.INVENTORY_START+9,I.BRONZE_ARROW); await f.settle();
  f.click(V.INVENTORY_START+9,{opId:3}); f.amount(1); await f.settle(); assert.equal(f.target.getInventory().getItems()[9].getAmount(),39);
  f.click(V.INVENTORY_START+9,{opId:4}); await f.settle(); assert.equal(f.target.getInventory().getItems()[9].getId(),-1);
});
test('native drags reject stale data, wrong targets and revoked permissions', async t=>{
  const f=fixture(t,Rights.OWNER); f.target.getInventory().setItem(0,new core.Item(I.BRONZE_ARROW,8));
  f.open();f.choose('TargetOne');f.section(SECTION.INVENTORY);
  f.target.getInventory().getItems()[0].setAmount(9);
  dragContainer(f,V.INVENTORY_START,V.INVENTORY_START+1,I.BRONZE_ARROW);await f.settle();
  assert.equal(f.target.getInventory().getItems()[0].getAmount(),9); assert.match(f.actor.messages.at(-1),/moved during/);
  f.events.get('process')({player:f.actor});
  dragContainer(f,V.INVENTORY_START,V.EQUIPMENT_START,I.BRONZE_ARROW);await f.settle();
  assert.equal(f.target.getInventory().getItems()[0].getAmount(),9);
  f.actor.setRights(Rights.NONE);
  dragContainer(f,V.INVENTORY_START,V.INVENTORY_START+1,I.BRONZE_ARROW);await f.settle();
  assert.equal(f.target.getInventory().getItems()[0].getAmount(),9);
});
test('native empty equipment slots enforce the picked slot and update their empty-slot icon', async t=>{
  const f=fixture(t,Rights.OWNER); f.open(); f.choose('TargetOne');
  t.mock.method(core.PluginManager,'emitCanEquip',()=>true);
  const emit=core.PluginManager.emitCustomEvent;
  t.mock.method(core.PluginManager,'emitCustomEvent',(name,event)=>{
    if(name!=='equipment:changed') return emit.call(core.PluginManager,name,event);
  });
  const pickScimitar=async slot=>{
    f.section(SECTION.EQUIPMENT); f.click(V.EQUIPMENT_START+slot); f.socket('Bronze scimitar');
    const row=JSON.parse(f.actor.texts.get(uid(C.SEARCH_RESPONSE))).rows.find(row=>row.icon===I.BRONZE_SCIMITAR);
    assert.ok(row); f.click(C.ROW_LABEL_START,{slot:row.id}); f.action(0); await f.settle();
  };
  await pickScimitar(core.Equipment.HEAD_SLOT);
  assert.match(f.actor.messages.at(-1),/different equipment slot/);
  assert.equal(f.target.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId(),-1);
  await pickScimitar(core.Equipment.WEAPON_SLOT);
  assert.equal(f.target.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId(),I.BRONZE_SCIMITAR);
  assert.equal(f.actor.hidden.get(uid(V.EQUIPMENT_GHOST_START+core.Equipment.WEAPON_SLOT)),true);
  assert.equal(f.actor.hidden.get(uid(V.EQUIPMENT_GHOST_START+core.Equipment.HEAD_SLOT)),false);
});
test('native bank grid moves stacks within and between tabs',async t=>{
  const f=fixture(t,Rights.OWNER);f.target.getBank(0).setItem(0,new core.Item(I.BRONZE_ARROW,8));
  f.target.getBank(1).setItem(0,new core.Item(I.RAKE,1));
  f.open();f.choose('TargetOne');f.section(SECTION.BANK);
  assert.equal(f.actor.hidden.get(uid(V.BANK_VIEW)),false);
  dragContainer(f,V.BANK_START,V.BANK_START+6,I.BRONZE_ARROW);await f.settle();
  assert.equal(f.target.getBank(0).getAmount(I.BRONZE_ARROW),8);
  assert.equal(f.target.getBank(0).getItems()[6].getId(),I.BRONZE_ARROW);
  dragContainer(f,V.BANK_START+6,V.BANK_START,I.BRONZE_ARROW);await f.settle();
  dragContainer(f,V.BANK_START,V.BANK_TAB_START+1,I.BRONZE_ARROW);await f.settle();
  assert.equal(f.target.getBank(1).getAmount(I.BRONZE_ARROW),8);
  f.click(V.BANK_TAB_LABEL_START+1);
  assert.ok([...f.actor.items.entries()].some(([id,item])=>id>=uid(V.BANK_START)&&item[0]===I.BRONZE_ARROW));
  assert.equal(f.target.getBank(0).getAmount(I.BRONZE_ARROW),0);
});
test('Cheats sections are collapsed tree groups with matching search ancestry',t=>{
  const f=fixture(t,Rights.OWNER);f.open();f.tab(TAB.CHEATS);
  const groups=f.rows().filter(row=>row.expandable&&row.name==='Temporary modes');
  assert.equal(groups.length,1);assert.equal(groups[0].collapsed,true);
  assert.equal(f.row('Noclip').parentId,groups[0].id);
});

test('slot quantity zero crosses the native input packet route and removes the stack', async t=>{
  const f=fixture(t,Rights.OWNER);f.target.getInventory().setItem(0,new core.Item(I.BRONZE_ARROW,8));
  f.open();f.choose('TargetOne');f.section(SECTION.INVENTORY);f.click(V.INVENTORY_START);
  const { ClientConnection }=require('../dist/net/NetworkBuilder');
  const connection=new ClientConnection({kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}});
  connection.player=f.actor;
  await connection.dispatch([{type:'dialogue_amount',amount:0}],true);await f.settle();
  assert.equal(f.target.getInventory().getAmount(I.BRONZE_ARROW),0);
  assert.ok(!f.actor.items.has(uid(V.INVENTORY_START)));
});

test('a full native bank stays within private metadata packet limits',t=>{
  const f=fixture(t,Rights.OWNER);
  for(let slot=0;slot<core.Bank.MAX_SLOTS;slot++) f.target.getBank(0).setItem(slot,new core.Item(I.BRONZE_ARROW,slot+1));
  f.open();f.choose('TargetOne');
  assert.doesNotThrow(()=>f.section(SECTION.BANK));
  assert.deepEqual(f.actor.items.get(uid(V.BANK_START+core.Bank.MAX_SLOTS-1)),[I.BRONZE_ARROW,0,core.Bank.MAX_SLOTS]);
  assert.equal(f.rows().filter(row=>row.icon===I.BRONZE_ARROW).length,0,'containers do not duplicate slot data into hidden result lists');
  assert.ok(DATA_COMPONENTS.every(component=>Buffer.byteLength(f.actor.texts.get(uid(component)),'latin1')<40000));
});

test('native occupied-slot menus set, add and remove the stated quantity and cancel pending edits',async t=>{
  const f=fixture(t,Rights.OWNER); f.open();f.choose('TargetOne');
  for(const [section,held,start] of [[SECTION.INVENTORY,f.target.getInventory(),V.INVENTORY_START],
    [SECTION.BANK,f.target.getBank(0),V.BANK_START]]) {
    held.setItem(0,new core.Item(I.BRONZE_ARROW,100).setMetaValue('fixture-marker',9));
    f.section(section);
    assert.deepEqual(f.actor.actions.get(uid(start)),['Set quantity','Add quantity','Remove quantity','Remove stack'].map(action=>action+' Bronze arrow'));
    f.click(start); f.amount(20); await f.settle(); assert.equal(held.getItems()[0].getAmount(),20);
    f.click(start,{opId:2}); f.amount(5); await f.settle(); assert.equal(held.getItems()[0].getAmount(),25);
    f.click(start,{opId:3}); f.amount(7); await f.settle(); assert.equal(held.getItems()[0].getAmount(),18);
    assert.equal(held.getItems()[0].getMetaValue('fixture-marker'),9);
    f.click(start); const pending=f.actor.getEnteredAmountAction();
    if(section===SECTION.BANK) {
      assert.equal(f.actor.hidden.get(uid(C.ADD_ITEMS)),false);
      assert.equal(f.actor.texts.get(uid(C.ADD_ITEMS_LABEL)),'Cancel');f.click(C.ADD_ITEMS);
    } else { assert.equal(f.actor.texts.get(uid(BUTTONS[3].label)),'Cancel');f.action(3); }
    assert.equal(f.actor.getEnteredAmountAction(),null); pending.execute(999);await f.settle();
    assert.equal(held.getItems()[0].getAmount(),18);
    f.click(start,{opId:4});await f.settle(); assert.equal(held.getItems()[0].getId(),-1);
  }
});

test("Add item merges stacks in full inventories and unnotes bank grants", async t => {
  const f = fixture(t, Rights.OWNER);
  f.open();
  f.choose("TargetOne");
  const addPicker = async (id, query, quantity = 1) => {
    f.click(C.CONTAINER_ADD);
    f.socket(query);
    const row = JSON.parse(f.actor.texts.get(uid(C.SEARCH_RESPONSE))).rows.find(row => row.icon === id);
    assert.ok(row);
    f.click(C.ROW_LABEL_START, { slot: row.id });
    f.action(1); f.amount(quantity); await f.settle();
  };
  const inventory = f.target.getInventory();
  inventory.setItem(0, new core.Item(I.COINS, 2147483600));
  for (let slot = 1; slot < inventory.capacity(); slot++) inventory.setItem(slot, new core.Item(I.RAKE, 1));
  f.section(SECTION.INVENTORY);
  assert.equal(f.actor.hidden.get(uid(C.CONTAINER_ADD)), false);
  await addPicker(I.COINS, "coins", 100);
  assert.equal(inventory.getItems()[0].getAmount(), 2147483647);
  assert.match(f.actor.messages.at(-1), /Only 47 of 100 fit/);
  await addPicker(I.BRONZE_ARROW, "Bronze arrow");
  assert.equal(inventory.getAmount(I.BRONZE_ARROW), 0);
  assert.match(f.actor.messages.at(-1), /no room/);

  f.section(SECTION.EQUIPMENT);
  assert.equal(f.actor.hidden.get(uid(C.CONTAINER_ADD)), true);
  f.click(C.CONTAINER_ADD);
  assert.equal(JSON.parse(f.actor.texts.get(uid(C.LAYOUT))).active, TAB.EDITOR);

  const sword = I.BLACK_SCIMITAR;
  const note = core.ItemDefinition.forId(sword).getNoteId();
  assert.equal(core.ItemDefinition.forId(note).isNoted(), true);
  f.target.getBank(1).setItem(0, new core.Item(I.BRONZE_ARROW, 8));
  f.section(SECTION.BANK);
  f.click(V.BANK_TAB_START + 1);
  await addPicker(note, String(note), 5);
  assert.equal(f.target.getBank(1).getAmount(note), 0);
  assert.equal(f.target.getBank(1).getAmount(sword), 5);
  f.click(V.BANK_TAB_START);
  await addPicker(sword, String(sword), 3);
  assert.equal(f.target.getBank(0).getAmount(sword), 0);
  assert.equal(f.target.getBank(1).getItems().filter(item => item.getId() === sword).length, 1);
  assert.equal(f.target.getBank(1).getAmount(sword), 8);
});

test('actual PacketSender publishes ordered widget operations on the modern socket transport',()=>{
  const player=new Player(null).setUsername('ActionsFixture'),packets=[];
  player.getSession=()=>({sendClientPacket:packet=>packets.push(packet),write(){assert.fail('legacy action packets are not delivered by the browser transport');}});
  player.getPacketSender().sendInterfaceActions(uid(V.INVENTORY_START),['Set quantity','Add quantity',null,'Remove stack']);
  assert.equal(packets.length,1);assert.equal(packets[0][0],171);
  assert.ok(packets[0].includes(Buffer.from('Set quantity')));
  assert.ok(packets[0].includes(Buffer.from('Add quantity')));
});


test('map teleport opens above Teleports and sends the selected target to dungeon coordinates once', async t=>{
  const f=fixture(t);f.open();f.choose('TargetOne');f.tab(TAB.TELEPORTS);
  assert.equal(f.actor.hidden.get(uid(C.MAP_TELEPORT)),false);
  f.click(C.MAP_TELEPORT);assert.equal(f.actor.getPacketSender().isWorldMapOpen(),true);
  const origin=f.actor.getLocation().clone();
  const event={player:f.actor,packet:{type:'world_map_click',x:2884,y:9798,level:2},handled:false};
  f.events.get('player:world-input')(event);await f.settle();
  assert.equal(event.handled,true);
  assert.deepEqual([f.target.getLocation().getX(),f.target.getLocation().getY(),f.target.getLocation().getZ()],[2884,9798,2]);
  assert.equal(f.actor.getLocation().equals(origin),true);
  assert.equal(f.actor.getPacketSender().isWorldMapOpen(),false);
  event.handled=false;f.events.get('player:world-input')(event);assert.equal(event.handled,false,'selection is consumed once');
});

test('map teleport rechecks permission and cancels on close, tab and target changes', async t=>{
  const f=fixture(t);f.open();f.tab(TAB.TELEPORTS);
  const packet={type:'world_map_click',x:3104,y:9910,level:0};
  const click=()=>{const e={player:f.actor,packet,handled:false};f.events.get('player:world-input')(e);return e;};
  f.click(C.MAP_TELEPORT);f.events.get('interface:closed')({player:f.actor,interfaceId:595});
  assert.equal(click().handled,false);
  f.click(C.MAP_TELEPORT);f.tab(TAB.CHEATS);assert.equal(click().handled,false);
  f.tab(TAB.TELEPORTS);f.click(C.MAP_TELEPORT);f.click(C.SELF_BUTTON);assert.equal(click().handled,false);
  f.click(C.MAP_TELEPORT);const before=f.actor.getLocation().clone();f.actor.setRights(Rights.MODERATOR);
  assert.equal(click().handled,true);await f.settle();assert.equal(f.actor.getLocation().equals(before),true);
});

test('spellbooks and prayer unlocks belong to Character and no longer appear under Cheats',t=>{
  const f=fixture(t);f.open();f.tab(TAB.CHEATS);
  const ids=new Set(JSON.parse(f.actor.texts.get(uid(C.LAYOUT))).tabs[TAB.CHEATS]);
  assert.ok(!f.rows().some(row=>ids.has(row.id)&&/spellbook|Unlock (Preserve|Rigour|Augury)/.test(row.name)));
  f.section(SECTION.CHARACTER);assert.ok(f.row('Ancient spellbook'));assert.ok(f.row('Unlock Rigour'));
  assert.doesNotThrow(()=>f.events.get('process')({player:f.actor}));
});


test('Bots uses a separate setup form with bounded quantity and rejects stale prompts',t=>{
  const f=fixture(t,Rights.DEVELOPER),deployments=[];
  f.events.set('provider:admin:bots',event=>{
    event.handled=true;event.allowed=true;event.limit=20;event.managed=0;event.capacity=100;
    if(event.action==='catalogue')event.launchers=[{key:'activity:fixture',name:'Fixture bots',kind:'activity',detail:'Activity',description:'Test bots',setupFields:[]}];
    else {deployments.push({...event});event.result={message:'Deployed fixture bots'};}
  });
  const event={player:f.actor,tab:'bots',handled:false};f.events.get('admin:open')(event);
  assert.equal(event.handled,true);
  assert.equal(JSON.parse(f.actor.texts.get(uid(C.LAYOUT))).active,TAB.BOTS);
  f.tab(TAB.BOTS);f.select('Fixture bots');
  assert.equal(f.actor.hidden.get(uid(C.PANEL_EMPTY)),true,'selected details must hide the empty-panel prompt');
  f.action(0);assert.equal(f.actor.hidden.get(uid(B.VIEW)),false);assert.equal(f.actor.hidden.get(uid(C.LIST_VIEW)),true);
  assert.equal(f.actor.texts.get(uid(B.PRIMARY_LABEL)),'Spawn 1 bot');
  f.click(B.COUNT);const stale=f.actor.getEnteredAmountAction();
  f.tab(TAB.CHEATS);stale.execute(12);f.tab(TAB.BOTS);
  assert.equal(f.actor.texts.get(uid(B.COUNT)),'1');
  f.click(B.COUNT);f.amount(3);f.click(B.PLUS);assert.equal(f.actor.texts.get(uid(B.COUNT)),'4');f.click(B.MINUS);
  f.click(B.LOCATION);f.click(B.LEVELS);
  f.click(B.PRIMARY);
  assert.equal(deployments.length,1);assert.equal(deployments[0].count,3);assert.equal(deployments[0].actor,f.actor);
  assert.equal(deployments[0].copyOwnerSkills,true);assert.equal(deployments[0].usePlayerLocation,true);
  assert.equal(f.actor.texts.get(uid(B.FEEDBACK)),'Deployed fixture bots');
  f.click(B.BACK);assert.equal(f.actor.hidden.get(uid(B.VIEW)),true);assert.equal(f.actor.hidden.get(uid(C.LIST_VIEW)),false);
});

test('human admins can stop their own bot controller through the Bots tab',t=>{
  const f=fixture(t,Rights.DEVELOPER);
  f.actor.getSession=()=>({hasNetworkClient:()=>true});
  f.events.set('provider:admin:bot-controls',event=>{
    event.handled=true;
    if(event.action==='catalogue'){event.allowed={self:true};event.selfEnabled=f.actor.isPlayerBot();event.bots=[];}
    else if(event.operation==='self') f.actor.setPlayerBot(!f.actor.isPlayerBot());
  });
  f.open();f.tab(TAB.BOTS);f.click(B.CATEGORY+2);f.click(B.PRIMARY);
  assert.equal(f.actor.isPlayerBot(),true);assert.equal(f.actor.getInterfaceId(),GROUP_ID);
  f.click(B.PRIMARY);
  assert.equal(f.actor.isPlayerBot(),false);
});


test('Active bots has a focused management view and returns to the bot browser',t=>{
  const f=fixture(t,Rights.DEVELOPER),calls=[];
  f.events.set('provider:admin:bot-controls',event=>{
    event.handled=true;
    if(event.action==='catalogue')Object.assign(event,{allowed:{stats:true,behavior:true},modes:['manual','recruit'],bots:[{username:'TestBot',name:'Test Bot',mode:'pvp'}]});
    else calls.push({operation:event.operation,mode:event.mode,username:event.username});
  });
  f.open();f.tab(TAB.BOTS);f.click(B.CATEGORY+1);f.select('Test Bot');f.action(0);
  assert.equal(f.actor.hidden.get(uid(C.PANEL)),true);assert.equal(f.actor.hidden.get(uid(B.VIEW)),false);
  assert.equal(f.actor.texts.get(uid(B.TITLE)),'Manage Test Bot');
  assert.equal(f.actor.texts.get(uid(B.MANAGE_LABEL)),'Copy my stats');
  assert.equal(f.actor.texts.get(uid(B.MANAGE_LABEL+1)),'Pause AI');
  f.click(B.MANAGE+1);assert.deepEqual(calls,[{operation:'behavior',mode:'manual',username:'TestBot'}]);
  f.click(B.BACK);assert.ok(f.row('Test Bot'));assert.equal(f.actor.hidden.get(uid(B.VIEW)),true);
});

test('Bots visual snapshots use the same server browse, setup and management states',t=>{
  const f=fixture(t,Rights.DEVELOPER),out=process.env.ADMIN_BOTS_VISUAL_DIR;
  f.events.set('provider:admin:bots',event=>{
    Object.assign(event,{handled:true,allowed:true,limit:20,managed:2,capacity:100});
    if(event.action==='catalogue')event.launchers=[{key:'activity:recruit',name:'Recruit / follow me',kind:'activity',detail:'Built-in bot',description:'Spawn a geared recruit that follows you and joins your clan chat.',setupFields:[{id:'role',label:'Role',defaultValue:'attacker',choices:[{value:'attacker',label:'Attacker'},{value:'defender',label:'Defender'}]}]}];
  });
  f.events.set('provider:admin:bot-controls',event=>Object.assign(event,{handled:true,allowed:{self:true,stats:true,gear:true,control:true,rename:true,info:true,behavior:true},selfEnabled:false,modes:['manual','recruit','auto','woodcutting','mining','fishing','combat_training'],bots:[{username:'TestBot',name:'Field Recruit',mode:'pvp'}]}));
  const capture=name=>{if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,`${name}.json`),JSON.stringify({definition:f.definition,texts:[...f.actor.texts],hidden:[...f.actor.hidden],actions:[...f.actor.actions]}));}};
  f.open();f.tab(TAB.BOTS);f.select('Recruit / follow me');capture('browse');
  assert.equal(f.actor.hidden.get(uid(C.PANEL_EMPTY)),true);
  f.action(0);capture('setup');assert.equal(f.actor.hidden.get(uid(B.VIEW)),false);
  f.click(B.BACK);f.click(B.CATEGORY+1);f.select('Field Recruit');capture('active');f.action(0);capture('manage');
  assert.equal(f.actor.texts.get(uid(B.TITLE)),'Manage Field Recruit');
  f.click(B.BACK);f.click(B.CATEGORY+2);capture('self');
  assert.equal(f.actor.texts.get(uid(B.PRIMARY_LABEL)),'Start bot control');
});
