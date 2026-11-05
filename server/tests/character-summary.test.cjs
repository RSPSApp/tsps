const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Statistics = require("../plugins/combat/PvpStatistics.plugin");
const Layout = require("../plugins/interface/sidejournaldefaults/Layout.SideJournalDefaults");

function fixture(world = { plugins: { CustomCharacterSummary: true } }) {
  const events = new Map(), buttons = new Map(), defaults = new Map();
  const processes = [], gates = [], logouts = [], saves = [], emitted = [];
  const commands = new Set(["teleports", "presets", "commands", "lockxp"]);
  const api = {
    core: {
      WorldDefinition: { readWorldConfig: () => world },
      Bank: { TOTAL_BANK_TABS: 3, BANK_SEARCH_TAB_INDEX: 2 },
      ItemIdentifiers: { COINS: 995, BLOOD_MONEY: 13307, PLATINUM_TOKEN: 13204, TOKKUL: 6529, STARDUST: 25527, MARK_OF_GRACE: 11849 },
      Skill: Object.fromEntries(["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC", "HITPOINTS", "PRAYER", "WOODCUTTING"].map(name => [name, name])),
    },
    log() {}, registerCommand() {}, registerCustomInterface(definition) { this.definition = definition; },
    persistAttribute(key, value) { defaults.set(key, value); },
    onCustomEvent(name, handler) { if (!events.has(name)) events.set(name, []); events.get(name).push(handler); },
    emitCustomEvent(name, event) { emitted.push({ name, event }); for (const handler of events.get(name) ?? []) handler(event); },
    onInterfaceActionButton(ids, handler) { for (const id of [ids].flat()) buttons.set(id, handler); },
    onCanGainExperience(handler) { gates.push(handler); },
    onPlayerProcess(handler) { processes.push(handler); },
    onPlayerLogin() {}, onPlayerLogout(handler) { logouts.push(handler); },
    getRegisteredCommands: player => [...(player.commands ?? commands)].map(command => ({ command })),
  };
  api.onCustomEvent("persistence:save", ({ player }) => saves.push(player));
  Statistics.register(api);
  // Real modules present on this tree: the old state has only Defaults, not the future wrapper.
  const directory = path.join(__dirname, "../plugins/interface");
  const candidates = fs.readdirSync(directory)
    .filter(name => ["SideJournalDefaults.plugin.js", "CustomCharacterSummary.plugin.js"].includes(name))
    .map(name => require(path.join(directory, name)));
  assert.ok(candidates.some(plugin => plugin.name === "SideJournalDefaults"));
  for (const name of ["SideJournalDefaults", "CustomCharacterSummary"]) {
    candidates.find(plugin => plugin.name === name)?.register(api);
  }
  function query(player) {
    const request = { player, stats: null };
    api.emitCustomEvent("pvp:stats", request);
    return request.stats;
  }
  function click(player, component) {
    const buttonId = Layout.uid(component);
    return buttons.get(buttonId)({ player, buttonId });
  }
  return { api, buttons, defaults, processes, gates, logouts, saves, emitted, commands, query, click };
}

function item(id, amount, price = 1) {
  return { getId: () => id, getAmount: () => amount, getDefinition: () => ({ getGrandExchangeValue: () => price }) };
}

function player(attributes = {}, bot = false) {
  const attrs = new Map(Object.entries(attributes)), strings = new Map(), writes = [], mounts = [], varbits = new Map(), messages = [];
  const hidden = new Map(), positions = new Map(), controls = [];
  const banks = [[], [], []], inventory = [];
  const sender = {
    sendString(text, uid) { strings.set(uid, text); writes.push([uid, text]); return this; },
    sendSubInterface(uid, group) { mounts.push([uid, group]); return this; },
    sendVarbit(id, value) { varbits.set(id, value); return this; },
    getVarbit: id => varbits.get(id) ?? 0,
    sendMessage(message) { messages.push(message); return this; },
    sendInterfaceScript() {}, sendInterfaceFlagsRange() {},
    sendInterfaceDisplayState(uid, hide) { hidden.set(uid, hide); controls.push([uid, hide]); return this; },
    sendInterfacePosition(uid, x, y) { positions.set(uid, { x, y }); controls.push([uid, x, y]); return this; },
  };
  return {
    attrs, strings, writes, mounts, banks, inventory, messages, hidden, positions, controls,
    isPlayer: () => true, isPlayerBot: () => bot,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    sendMessage: message => messages.push(message),
    getDisplayName: () => "Test Player", getPacketSender: () => sender,
    getBank: tab => ({ getItems: () => banks[tab] }),
    getInventory: () => ({ getValidItems: () => inventory }),
  };
}

const row = (p, key) => p.strings.get(Layout.uid(Layout.ROWS.find(row => row.key === key).component));
const mount = (f, p) => f.api.emitCustomEvent("player:bootstrap-complete", { player: p });
const death = (f, victim, killer) => f.api.emitCustomEvent("player:dying", { player: victim, killer });

test("login replaces the native summary, preserves the name, and fills every requested section", () => {
  const f = fixture(), p = player();
  mount(f, p);
  assert.equal(p.mounts.at(-1)[1], Layout.GROUP_ID);
  assert.equal(p.strings.get(Layout.uid(Layout.COMPONENT.USERNAME)), "Test Player");
  assert.equal(row(p, "task"), "Current task:<br><col=ffffff>None</col>");
  assert.equal(row(p, "remaining"), "Kills left: <col=ffffff>N/A</col>");
  assert.match(row(p, "elo"), /1,000/);
  assert.match(row(p, "bloodMoney"), /^Blood Money:/);
  assert.equal(row(p, "playerKillstreak"), "Player Killstreak: <col=ffffff>0</col>");
  assert.equal(row(p, "botKillstreak"), "Bot Killstreak: <col=ffffff>0</col>");
  assert.equal(row(p, "pvpDeaths"), "Deaths against players: <col=ffffff>0</col>");
  assert.equal(row(p, "botDeaths"), "Deaths against bots: <col=ffffff>0</col>");
  const texts = f.api.definition.widgets.map(widget => widget.text);
  for (const title of ["PK Information", "Slayer Information", "Points", "Currencies", "Teleports", "Presets", "Commands"]) assert.ok(texts.includes(title));
  assert.ok(f.api.definition.scroll[0].contentHeight > 261);
  for (const widget of f.api.definition.widgets) {
    if (widget.parentUid < 0) continue;
    assert.equal(f.api.definition.widgets.find(parent => parent.uid === widget.parentUid).type, 0, "children need a drawable layer parent");
  }
});

test("dismissing the real welcome screen restores the custom summary after its second gameframe bootstrap", async () => {
  const f = fixture(), p = player();
  const contentUid = (629 << 16) | 43;
  const sender = p.getPacketSender();
  let login, root;
  sender.sendRootInterface = id => { root = id; return sender; };
  sender.sendInterfaceFlags = () => sender;
  p.getUsername = () => "Test Player";
  p.getSession = () => ({
    sendClientPacket(packet) {
      p.mounts.push([packet.targetUid, packet.groupId]);
      p.strings.clear(); // The raw bootstrap replaces the custom panel with the cache summary.
    },
  });
  require("../plugins/interface/WelcomeScreen.plugin").register({
    ...f.api,
    core: {
      ...f.api.core,
      Wilderness: { isInLocation: () => false },
      resolveGameframeRoot: () => 161,
      encodeGameframeBootstrap: () => [{ targetUid: contentUid, groupId: 712 }],
    },
    getPluginConfig: (_key, fallback) => fallback,
    onPlayerLogin: handler => { login = handler; },
    onPlayerDisconnect() {},
  });
  mount(f, p);
  assert.equal(p.mounts.at(-1)[1], Layout.GROUP_ID);
  login({ player: p, isNewAccount: false });
  await Promise.resolve();
  assert.equal(root, 378);
  const playButton = (378 << 16) | 72;
  f.buttons.get(playButton)({ player: p, buttonId: playButton });
  assert.equal(p.mounts.at(-1)[1], Layout.GROUP_ID, "the native bootstrap cannot leave the old summary mounted");
  assert.equal(p.strings.get(Layout.uid(Layout.COMPONENT.USERNAME)), "Test Player");
  assert.match(p.strings.get(Layout.uid(Layout.COMPONENT.XP + 10)), /Combat XP:.*On/);
  assert.equal(f.click(p, Layout.COMPONENT.XP), true);
  assert.equal(p.getAttribute("skills:combat-xp-locked"), true);
});

test("journal rebuilds keep the selected quest or diary tab and do not react to unrelated tab mounts", () => {
  const f = fixture(), p = player();
  mount(f, p);
  for (const [child, group] of [[10, 399], [18, 259], [2, Layout.GROUP_ID]]) {
    const buttonId = (629 << 16) | child;
    f.buttons.get(buttonId)({ player: p, buttonId });
    f.api.emitCustomEvent("gameframe:ready", { player: p });
    assert.equal(p.mounts.at(-1)[1], group);
    const before = p.mounts.length;
    f.api.emitCustomEvent("gameframe:tab-mounted", { player: p, group: 541 });
    assert.equal(p.mounts.length, before);
    f.api.emitCustomEvent("gameframe:tab-mounted", { player: p, group: 629 });
    assert.equal(p.mounts.at(-1)[1], group);
  }
  p.getPacketSender().sendVarbit(8168, 3);
  const before = p.mounts.length;
  f.api.emitCustomEvent("gameframe:ready", { player: p });
  assert.equal(p.mounts.length, before, "Adventure Paths retains ownership of its selected tab");
});

test("opening the summary keeps native main interfaces open", () => {
  const f = fixture(), p = player();
  p.getInterfaceId = () => 12;
  f.api.core.CustomInterfaceRegistry = { get: () => undefined };
  p.getPacketSender().sendInterfaceRemoval = () => assert.fail("native interfaces do not own the custom runtime");
  mount(f, p);
  assert.equal(p.mounts.at(-1)[1], Layout.GROUP_ID);
});

test("opening native journal tabs does not close a custom modal", () => {
  const f = fixture(), p = player();
  p.getInterfaceId = () => 30004;
  f.api.core.CustomInterfaceRegistry = { get: () => ({}) };
  p.getPacketSender().sendInterfaceRemoval = () => assert.fail("only the custom summary replaces the runtime");
  p.getPacketSender().sendVarbit(8168, 1);
  mount(f, p);
  assert.equal(p.mounts.at(-1)[1], 399);
});

test("navigation labels and backgrounds open the corresponding existing interfaces", () => {
  const f = fixture(), p = player();
  mount(f, p);
  for (const [component, event] of [[Layout.COMPONENT.TELEPORTS, "teleports:open"], [Layout.COMPONENT.PRESETS, "presets:open"], [Layout.COMPONENT.COMMANDS, "commands:open"]]) {
    for (const id of [component, component + 10]) {
      assert.equal(f.click(p, id), true);
      assert.equal(f.emitted.at(-1).name, event);
      assert.equal(f.emitted.at(-1).event.player, p);
    }
  }
});

test("host restrictions hide every layer and reject clicks for all sixteen button combinations", () => {
  for (let mask = 0; mask < 16; mask++) {
    const f = fixture(), p = player();
    f.commands.clear();
    Layout.BUTTONS.forEach((button, index) => { if (mask & (1 << index)) f.commands.add(button.command); });
    mount(f, p);
    for (const button of Layout.BUTTONS) {
      const enabled = f.commands.has(button.command);
      for (const offset of [0, 6, 10]) assert.equal(p.hidden.get(Layout.uid(button.component + offset)), !enabled);
      assert.equal(f.click(p, button.component), enabled, `${button.command}, mask ${mask}`);
      assert.equal(f.click(p, button.component + 10), enabled);
    }
    const navigation = Layout.BUTTONS.filter(button => button.event && f.commands.has(button.command));
    assert.equal(navigation.reduce((sum, button) => sum + p.positions.get(Layout.uid(button.component)).x, 0), 0);
    for (const button of navigation) {
      for (const offset of [6, 10]) {
        assert.deepEqual(p.positions.get(Layout.uid(button.component + offset)), p.positions.get(Layout.uid(button.component)));
      }
    }
  }
});

test("permission changes refresh mounted buttons without remounting or resending unchanged controls", t => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const f = fixture(), p = player(), other = player(); mount(f, p); mount(f, other);
  const initialControls = p.controls.length, mounts = p.mounts.length;
  now += 2000; f.processes.forEach(process => process({ player: p }));
  assert.equal(p.controls.length, initialControls);
  p.commands = new Set(["teleports", "presets"]);
  assert.equal(f.click(p, Layout.COMPONENT.COMMANDS), false, "stale clicks are denied before the next refresh");
  assert.equal(f.click(p, Layout.COMPONENT.XP), false);
  now += 2000; f.processes.forEach(process => process({ player: p }));
  assert.equal(p.hidden.get(Layout.uid(Layout.COMPONENT.COMMANDS)), true);
  assert.equal(p.hidden.get(Layout.uid(Layout.COMPONENT.XP)), true);
  assert.equal(p.positions.get(Layout.uid(Layout.COMPONENT.TELEPORTS)).x, -30);
  assert.equal(p.positions.get(Layout.uid(Layout.COMPONENT.PRESETS)).x, 30);
  assert.equal(other.hidden.get(Layout.uid(Layout.COMPONENT.COMMANDS)), false, "another player retains their own access");
  assert.equal(p.mounts.length, mounts, "the scroll panel is preserved");
  p.commands.add("commands"); p.commands.add("lockxp");
  now += 2000; f.processes.forEach(process => process({ player: p }));
  assert.equal(p.hidden.get(Layout.uid(Layout.COMPONENT.COMMANDS)), false);
  assert.equal(p.hidden.get(Layout.uid(Layout.COMPONENT.XP)), false);
});

test("the summary still mounts when optional PvP statistics are unavailable", () => {
  const f = fixture(), p = player();
  f.api.onCustomEvent("pvp:stats", request => { request.stats = null; });
  mount(f, p);
  assert.equal(p.mounts.at(-1)[1], Layout.GROUP_ID);
  assert.match(row(p, "playerKills"), />0</);
});

test("switching journal tabs stops summary updates; reopening repopulates its widgets", () => {
  const f = fixture(), p = player();
  mount(f, p);
  const questButton = (629 << 16) | 10;
  f.buttons.get(questButton)({ player: p, buttonId: questButton });
  assert.equal(p.mounts.at(-1)[1], 399);
  assert.equal(f.click(p, Layout.COMPONENT.XP), false);
  const before = p.writes.length;
  for (const process of f.processes) process({ player: p });
  assert.equal(p.writes.length, before);
  const summaryButton = (629 << 16) | 2;
  f.buttons.get(summaryButton)({ player: p, buttonId: summaryButton });
  assert.equal(p.mounts.at(-1)[1], Layout.GROUP_ID);
  assert.ok(p.writes.length > before);
});

test("combat XP toggle blocks all seven combat skills while allowing skilling XP", () => {
  const f = fixture(), p = player();
  mount(f, p);
  f.click(p, Layout.COMPONENT.XP);
  assert.match(p.strings.get(Layout.uid(Layout.COMPONENT.XP + 10)), /Off/);
  assert.equal(p.messages.at(-1), "Combat experience is now disabled.");
  assert.equal(p.getAttribute("skills:combat-xp-locked"), true);
  assert.equal(p.getAttribute("skills:xp-locked"), undefined);
  for (const skill of ["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC", "HITPOINTS", "PRAYER", "WOODCUTTING"]) {
    const event = { player: p, skill, allow: true };
    for (const gate of f.gates) gate(event);
    assert.equal(event.allow, skill === "WOODCUTTING");
  }
  f.click(p, Layout.COMPONENT.XP + 10);
  assert.equal(p.getAttribute("skills:combat-xp-locked"), false);
  assert.match(p.strings.get(Layout.uid(Layout.COMPONENT.XP + 10)), /On/);
  assert.equal(p.messages.at(-1), "Combat experience is now enabled.");
  const event = { player: p, skill: "ATTACK", allow: true };
  for (const gate of f.gates) gate(event);
  assert.equal(event.allow, true);
  assert.ok(f.saves.includes(p));
  assert.equal(f.defaults.get("skills:combat-xp-locked"), false);
});

test("turning combat XP on releases an existing all-XP lock", () => {
  const f = fixture(), p = player({ "skills:xp-locked": true });
  mount(f, p);
  assert.match(p.strings.get(Layout.uid(Layout.COMPONENT.XP + 10)), /Off/);
  f.click(p, Layout.COMPONENT.XP);
  assert.equal(p.getAttribute("skills:xp-locked"), false);
  assert.match(p.strings.get(Layout.uid(Layout.COMPONENT.XP + 10)), /On/);
});

test("wealth includes all real tabs, skips search duplicates and placeholders, and separates bank GP", () => {
  const f = fixture(), p = player();
  p.banks[0].push(item(995, 100), item(13307, 20), item(42, 0, 99999));
  p.banks[1].push(item(995, 200), item(13204, 3, 1000));
  p.banks[2].push(...p.banks[0], ...p.banks[1]);
  p.inventory.push(item(995, 900), item(13307, 5), item(13204, 2));
  mount(f, p);
  assert.match(row(p, "bankValue"), />3,320</);
  assert.match(row(p, "bankCoins"), />300</);
  assert.match(row(p, "bloodMoney"), />25</);
  assert.match(row(p, "platinumTokens"), />5</);
});

test("bank valuation retains exact integer totals above Number.MAX_SAFE_INTEGER", () => {
  const f = fixture(), p = player();
  p.banks[0].push(item(42, 2147483647, 2147483647));
  mount(f, p);
  assert.ok(row(p, "bankValue").includes((2147483647n ** 2n).toLocaleString("en-US")));
});

test("live updates send only changed text and keep the scroll panel mounted", () => {
  const f = fixture(), p = player();
  let task = { name: "abyssal demons", count: 17 };
  f.api.onCustomEvent("slayer:current-task", request => { request.task = task; request.points = 42; });
  mount(f, p);
  assert.match(row(p, "task"), /abyssal demons/);
  assert.match(row(p, "remaining"), />17</);
  assert.match(row(p, "slayerPoints"), />42</);
  const writes = p.writes.length, mounts = p.mounts.length;
  for (const process of f.processes) process({ player: p });
  assert.equal(p.writes.length, writes);
  const originalNow = Date.now;
  try {
    const later = originalNow() + 2100;
    Date.now = () => later;
    task = null;
    for (const process of f.processes) process({ player: p });
  } finally { Date.now = originalNow; }
  assert.equal(p.writes.length, writes + 2);
  assert.equal(p.mounts.length, mounts);
  assert.match(row(p, "task"), />None</);
  assert.match(row(p, "remaining"), />N\/A</);
  for (const logout of f.logouts) logout({ player: p });
  assert.equal(f.click(p, Layout.COMPONENT.XP), false);
});

test("real-player kills update both Elo ratings and persist independent PvP totals", () => {
  const f = fixture(), winner = player(), loser = player();
  death(f, loser, winner);
  assert.deepEqual(f.query(winner), { playerKills: 1, botKills: 0, pvpDeaths: 0, botDeaths: 0, otherDeaths: 0, kdr: 1, elo: 1016, killstreak: 0, playerKillstreak: 1, botKillstreak: 0 });
  assert.equal(f.query(loser).pvpDeaths, 1);
  assert.equal(f.query(loser).elo, 984);
  assert.deepEqual(f.saves, [winner, loser]);
  assert.equal(f.defaults.get("pvp:elo"), 1000);
  assert.equal(f.query(player(Object.fromEntries(winner.attrs))).elo, 1016, "a new session restores the saved rating");
});

test("upsets earn more Elo while the two ratings retain their total", () => {
  const f = fixture(), winner = player({ "pvp:elo": 600 }), loser = player({ "pvp:elo": 1400 });
  death(f, loser, winner);
  assert.equal(f.query(winner).elo, 632);
  assert.equal(f.query(loser).elo, 1368);
});

test("bot kills and deaths never affect real-player KDR or Elo", () => {
  const f = fixture(), p = player({ "pvp:player-kills": 6, "pvp:deaths": 2, "pvp:elo": 1200 }), bot = player({}, true);
  death(f, bot, p);
  assert.equal(f.query(p).playerKillstreak, 0);
  assert.equal(f.query(p).botKillstreak, 1);
  death(f, p, bot);
  assert.equal(f.query(p).botKills, 1);
  assert.equal(f.query(p).playerKills, 6);
  assert.equal(f.query(p).pvpDeaths, 2);
  assert.equal(f.query(p).botDeaths, 1);
  assert.equal(f.query(p).otherDeaths, 0);
  assert.equal(f.query(p).kdr, 3);
  assert.equal(f.query(p).elo, 1200);
  assert.equal(f.query(p).playerKillstreak, 0);
  assert.equal(f.query(p).botKillstreak, 0);
  assert.equal(f.query(bot), null);
  assert.ok(!f.saves.includes(bot));
  assert.equal(f.defaults.get("pvp:bot-deaths"), 0);
  assert.equal(f.query(player(Object.fromEntries(p.attrs))).botDeaths, 1, "bot deaths survive a save/load");
});

test("player and bot streaks advance independently, survive a save/load, and refresh their own rows", () => {
  const f = fixture(), p = player();
  mount(f, p);
  death(f, player(), p);
  death(f, player({}, true), p);
  death(f, player({}, true), p);
  assert.equal(f.query(p).playerKillstreak, 1);
  assert.equal(f.query(p).botKillstreak, 2);
  death(f, player(), p);
  assert.equal(f.query(p).playerKillstreak, 2);
  assert.equal(f.query(p).botKillstreak, 2);
  assert.match(row(p, "playerKillstreak"), />2</);
  assert.match(row(p, "botKillstreak"), />2</);
  assert.equal(f.defaults.get("pvp:player-killstreak"), 0);
  assert.equal(f.defaults.get("pvp:bot-killstreak"), 0);
  const restored = player(Object.fromEntries(p.attrs));
  assert.equal(f.query(restored).playerKillstreak, 2);
  assert.equal(f.query(restored).botKillstreak, 2);
  assert.equal(f.query(player()).playerKillstreak, 0, "streaks belong to their own character");
});

test("player, bot, NPC, environmental and self deaths reset both separate streaks", () => {
  const f = fixture();
  for (const kind of ["player", "bot", "npc", "environment", "self"]) {
    const p = player({ "pvp:player-killstreak": 3, "pvp:bot-killstreak": 5 });
    const killer = { player: player(), bot: player({}, true), npc: { isPlayer: () => false }, environment: null, self: p }[kind];
    death(f, p, killer);
    assert.equal(f.query(p).playerKillstreak, 0, kind);
    assert.equal(f.query(p).botKillstreak, 0, kind);
    assert.equal(f.query(p).pvpDeaths, kind === "player" ? 1 : 0, kind);
    assert.equal(f.query(p).botDeaths, kind === "bot" ? 1 : 0, kind);
    assert.equal(f.query(p).otherDeaths, ["npc", "environment", "self"].includes(kind) ? 1 : 0, kind);
    assert.ok(f.saves.includes(p), "a reset is persisted along with the death statistics");
  }
});

test("NPC, environmental and self deaths cannot change PvP KDR or Elo", () => {
  const f = fixture(), p = player({ "pvp:player-kills": 6, "pvp:deaths": 2, "pvp:elo": 1200 });
  for (const killer of [null, { isPlayer: () => false }, p]) death(f, p, killer);
  assert.equal(f.query(p).otherDeaths, 3);
  assert.equal(f.query(p).pvpDeaths, 2);
  assert.equal(f.query(p).kdr, 3);
  assert.equal(f.query(p).elo, 1200);
  f.api.emitCustomEvent("duelarena:duel-won", { winner: player(), loser: p });
  assert.equal(f.query(p).pvpDeaths, 2, "a forfeit is not a death");
});

test("new counters start clean without importing mixed arena history or altering old totals", () => {
  const f = fixture(), p = player({ "killstreaks:total-kills": 12, "killstreaks:deaths": 4, "killstreaks:streak": 3 });
  assert.equal(f.query(p).playerKills, 0);
  assert.equal(f.query(p).pvpDeaths, 0);
  assert.equal(f.query(p).kdr, 0);
  assert.equal(f.query(p).killstreak, 0);
  assert.equal(f.query(p).botKills, 0);
  death(f, player(), p);
  assert.equal(f.query(p).playerKills, 1);
  assert.equal(p.getAttribute("killstreaks:total-kills"), 12);
  assert.equal(p.getAttribute("killstreaks:deaths"), 4);
  assert.equal(p.getAttribute("killstreaks:streak"), 3);
  assert.equal(f.defaults.get("pvp:player-kills"), 0);
});

test("an arena veto excludes real kills, bot kills, and every kind of death from statistics", () => {
  const f = fixture(), winner = player({ "pvp:elo": 1200 }), victim = player(), bot = player({}, true);
  f.api.onCustomEvent("pvp:count-stats", event => { event.allow = false; });
  for (const [dead, killer] of [[victim, winner], [bot, winner], [victim, bot], [victim, null]]) death(f, dead, killer);
  assert.equal(f.query(winner).playerKills, 0);
  assert.equal(f.query(winner).botKills, 0);
  assert.equal(f.query(winner).elo, 1200);
  assert.equal(f.query(victim).pvpDeaths, 0);
  assert.equal(f.query(victim).botDeaths, 0);
  assert.equal(f.query(victim).otherDeaths, 0);
  assert.equal(f.query(victim).elo, 1000);
  assert.equal(f.saves.length, 0);
});

test("a journal panel mounted directly also stops hidden summary updates", () => {
  const f = fixture(), p = player();
  mount(f, p);
  f.api.emitCustomEvent("interface:opened", { player: p, groupId: 656, targetUid: (629 << 16) | 43 });
  assert.equal(f.click(p, Layout.COMPONENT.XP), false);
});

test("the actual Duel Arena policy excludes arena statistics and preserves both killstreaks", async () => {
  require("../dist/Server").Server.installProductionPathResolver();
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi();
  const f = fixture(), defeated = [];
  const api = new Proxy({
    ...f.api, core,
    getWorld: () => new Proxy({}, { get: () => () => {} }),
    getItemOnGroundManager: () => ({ registerNonGlobals() {} }),
    onPlayerDefeated: handler => defeated.push(handler),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require("../plugins/minigames/DuelArena.plugin").register(api);
  require("../plugins/combat/KillStreaks.plugin").register(api);
  const located = (tile, attrs = {}, bot = false) => {
    const p = player(attrs, bot);
    p.location = new core.Location(...tile);
    p.getLocation = () => p.location;
    p.getPrivateArea = () => null;
    return p;
  };
  for (const tile of [[3330, 3220, 0], [3366, 3266, 0], [3378, 3280, 0]]) {
    const winner = located(tile, { "pvp:killstreak": 4, "pvp:player-killstreak": 3, "pvp:bot-killstreak": 1 });
    const loser = located(tile, { "pvp:killstreak": 2, "pvp:player-killstreak": 1, "pvp:bot-killstreak": 1 });
    const bot = located(tile, {}, true);
    for (const [victim, killer] of [[loser, winner], [bot, winner], [loser, bot], [loser, null]]) {
      death(f, victim, killer);
      for (const hook of defeated) hook({ victim, killer });
    }
    assert.equal(f.query(winner).playerKills, 0, `arena kills do not count at ${tile}`);
    assert.equal(f.query(winner).botKills, 0);
    assert.equal(f.query(winner).elo, 1000);
    assert.equal(f.query(winner).killstreak, 4);
    assert.equal(f.query(winner).playerKillstreak, 3);
    assert.equal(f.query(winner).botKillstreak, 1);
    assert.equal(f.query(loser).pvpDeaths, 0);
    assert.equal(f.query(loser).botDeaths, 0);
    assert.equal(f.query(loser).otherDeaths, 0);
    assert.equal(f.query(loser).elo, 1000);
    assert.equal(f.query(loser).killstreak, 2, "safe deaths preserve an existing outside-arena streak");
    assert.equal(f.query(loser).playerKillstreak, 1);
    assert.equal(f.query(loser).botKillstreak, 1);
  }
  const winner = located([3070, 3550, 0]), loser = located([3071, 3550, 0]);
  death(f, loser, winner);
  for (const hook of defeated) hook({ killer: winner, victim: loser });
  assert.equal(f.query(winner).playerKills, 1, "ordinary Wilderness fights still count");
  assert.equal(f.query(winner).elo, 1016);
  assert.equal(f.query(winner).killstreak, 1);
  assert.equal(f.query(winner).playerKillstreak, 1);
  assert.equal(f.query(winner).botKillstreak, 0);
  assert.equal(f.query(loser).pvpDeaths, 1);
  assert.equal(f.query(loser).elo, 984);
  let spoken;
  winner.forceChat = line => { spoken = line; };
  // The summary and ::kdr use the same real-player-only totals.
  let kdr;
  api.registerCommand = (name, handler) => { if (name === "kdr") kdr = handler; };
  require("../plugins/combat/KillStreaks.plugin").register(api);
  kdr({ player: winner });
  assert.equal(spoken, "I currently have 1 kdr!");
});

// #2566 changes the intentionally custom #2258 default; old custom cases above opt in.
test("an explicit custom summary keeps a saved combat XP choice active", () => {
  const f = fixture({ plugins: { CustomCharacterSummary: true } });
  const p = player({ "skills:combat-xp-locked": true });
  mount(f, p);
  assert.equal(p.mounts.at(-1)[1], 30015);
  assert.equal(f.api.definition.groupId, 30015);
  const request = { player: p, skill: f.api.core.Skill.ATTACK, allow: true };
  f.gates.forEach(gate => gate(request));
  assert.equal(request.allow, false);
  assert.equal(p.getAttribute("skills:combat-xp-locked"), true);
});

test("the native summary is the default unless the custom feature is explicitly true", async (t) => {
  for (const [name, world] of [
    ["unset", {}],
    ["empty plugin map", { plugins: {} }],
    ["explicit false", { plugins: { CustomCharacterSummary: false } }],
    ["legacy implicit enable", { disabledPlugins: [] }],
    ["legacy with explicit false", { disabledPlugins: [], plugins: { CustomCharacterSummary: false } }],
  ]) {
    await t.test(name, () => {
      const f = fixture(world), p = player();
      const scripts = [], flags = [];
      p.getPacketSender().sendInterfaceScript = (...args) => { scripts.push(args); };
      p.getPacketSender().sendInterfaceFlagsRange = (...args) => { flags.push(args); };
      mount(f, p);
      assert.equal(p.mounts.at(-1)[1], 712, "native account summary remains mounted");
      assert.equal(f.api.definition, undefined, "custom widgets are not registered");
      assert.equal(p.strings.has(Layout.uid(Layout.COMPONENT.USERNAME)), false);
      assert.ok(scripts.some(([id]) => id === 3970), "native time-played feed remains active");
      assert.ok(flags.some(([uid]) => uid === ((712 << 16) | 3)), "native account rows retain their event flags");
      assert.equal(f.buttons.has(Layout.uid(Layout.COMPONENT.XP)), false, "no invisible custom XP button handler");
    });
  }
});

test("disabled custom UI retains the saved choice without an active hidden XP gate", async (t) => {
  for (const [name, world] of [
    ["unset", {}],
    ["explicit false", { plugins: { CustomCharacterSummary: false } }],
    ["legacy implicit enable", { disabledPlugins: [] }],
  ]) {
    await t.test(name, () => {
      const f = fixture(world), p = player({ "skills:combat-xp-locked": true });
      assert.equal(f.defaults.get("skills:combat-xp-locked"), false, "saved schema remains registered");
      const request = { player: p, skill: f.api.core.Skill.ATTACK, allow: true };
      f.gates.forEach(gate => gate(request));
      assert.equal(request.allow, true, "disabled custom feature does not block combat XP");
      assert.equal(p.getAttribute("skills:combat-xp-locked"), true, "reenabling can recover the saved choice");
    });
  }
});
