const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const plugin = require("../plugins/treasuretrails/TreasureTrails.plugin");
const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
const Dialogue = require("../plugins/treasuretrails/trails/Dialogue.TreasureTrails");
const Caskets = require("../plugins/treasuretrails/trails/Caskets.TreasureTrails");
const Stash = require("../plugins/treasuretrails/trails/Stash.TreasureTrails");
const Catalogue = require("../plugins/treasuretrails/trails/Catalogue.TreasureTrails");
const { byName } = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails");
const TRANSCRIPTS = require("../data/definitions/npc-dialogues.json");
const MEDIUM = byName.get("medium");
const I = core.ItemIdentifiers;
const C = core.CacheDefinitions;

// Every line Dialogue.play shows, so tests can check the transcript words used.
const played = [];
const play = Dialogue.play;
Dialogue.play = (player, npcId, spoken, onEnd) => { played.push(...spoken); return play(player, npcId, spoken, onEnd); };

function fixture() {
  const actions = new Map(), events = new Map(), attributes = new Map(), sent = [], ground = [], spawned = [], refreshed = [];
  let position = new core.Location(3222, 3218, 0), chain, amountAction, placed = 0;
  const items = Array(28).fill(null), worn = [];
  const inventory = {
    getItems: () => items, refreshItems() { refreshed.push(items.map(item => item?.getId() > 0 ? item.getId() : null)); }, setItem(slot, item) { items[slot] = item; return inventory; },
    getFreeSlots: () => items.filter(i => !i).length, isFull() { return this.getFreeSlots() === 0; },
    delete(id, amount) { while (amount > 0) { const slot = items.findIndex(i => i?.getId() === id); if (slot < 0) return; const take = Math.min(amount, items[slot].getAmount()); this.deleteAtSlot(slot, take); amount -= take; } },
    deleteAtSlot(slot, amount) { const item = items[slot]; if (!item) return; if (item.getAmount() <= amount) items[slot] = null; else item.setAmount(item.getAmount() - amount); },
    adds(id, amount) { this.forceAdd(null, new core.Item(id, amount)); },
    forceAdd(player, item) { const slot = items.findIndex(i => !i); if (slot < 0) ground.push(item); else items[slot] = item; },
  };
  const sender = new Proxy({}, { get: (_, name) => (...args) => { sent.push([name, ...args]); return sender; } });
  const skills = { level: 1, xp: 0, getCurrentLevel() { return this.level; }, addExperiences(skill, xp) { this.xp += xp; } };
  const player = { getInventory: () => inventory, getSkillManager: () => skills, getEquipment: () => ({ getItems: () => worn }),
    getPacketSender: () => sender, getLocation: () => position, getPrivateArea: () => null,
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: message => sent.push(["message", message]), performAnimation: value => sent.push(["animation", value]),
    setEnteredAmountAction: action => { amountAction = action; },
    getDialogueManager: () => ({ startDialogues: value => { chain = value; } }) };
  const api = { core, persistAttribute() {}, onItemAction: (name, handlers) => actions.set(name, { ...actions.get(name), ...handlers }),
    onBeforeNpcInteraction() {}, onItemOnNpc() {}, onBeforeObjectInteraction() {}, onCanUseItem() {},
    onCustomEvent: (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent: (name, request) => { for (const fn of events.get(name) ?? []) fn(request); },
    onPlayerLogout() {}, onPlayerDisconnect() {}, onPlayerLogin() {}, onPlayerDeath() {}, onNpcDeath() {}, onInterfaceActionButton() {},
    spawnNpc: def => { const npc = { getLocation: () => new core.Location(def.x, def.y, def.z), def }; spawned.push(npc); return npc; },
    removeNpc: npc => { npc.removed = true; }, getRegionManager: () => ({ blocked: () => false, canMovestart: () => true }) };
  plugin.register(api);
  api.onCustomEvent("treasure-trails:milestone-rewards", request => { request.handled = true; });
  // NpcDialogues' answer to "npc-dialogue:start", read straight from the imported transcripts.
  api.onCustomEvent("npc-dialogue:start", request => {
    const steps = TRANSCRIPTS[C.getNpc(request.npcId)?.name]?.variants?.[request.variant];
    if (steps?.length && request.select) request.select(steps);
  });
  function place(step, length = 3, slot = 0, completed = 0) {
    items[slot] = new core.Item(step.itemId, 1).setMetaValue(Runtime.metaKey(MEDIUM),
      { version: 1, token: `t${slot}-${++placed}`, revision: 0, completed, length, row: step.row });
    position = new core.Location(step.location.x, step.location.y, step.location.z);
  }
  const talk = (npcId, npc = { getLocation: () => position }) => {
    const event = { player, npcId, npc, clickType: 1, handled: false, definition: { getActions: () => ["Talk-to"] } };
    Runtime.talk(event);
    return event;
  };
  return { player, items, worn, skills, attributes, actions, sent, ground, spawned, refreshed, place, talk, on: api.onCustomEvent, emit: api.emitCustomEvent,
    event: (slot = 0) => ({ player, slot, item: items[slot], itemId: items[slot]?.getId() }),
    move: target => { position = new core.Location(target.x, target.y, target.z); },
    answer: value => amountAction.execute(value),
    state: () => items[0]?.getMetaValue(Runtime.metaKey(MEDIUM)),
    box: () => { const box = chain?.getDialogues().get(0); assert.ok(box instanceof core.ItemStatementDialogue); box.send(player); return box; },
    finish: () => { const current = chain; chain = null; for (const d of current?.getDialogues().values() ?? []) if (d instanceof core.ActionDialogue) d.send(player); },
  };
}

const steps = () => Runtime.data(MEDIUM).steps;
const ofKind = (family, target) => steps().filter(step => step.family === family && (!target || step.target === target));

test("every medium step is a distinct cache clue item with a solvable target", () => {
  fixture();
  const data = Runtime.data(MEDIUM);
  assert.equal(data.steps.length, 167);
  for (const [family, target, count] of [["anagram", "npc", 47], ["cipher", "npc", 6], ["coordinate", "coord", 44], ["cryptic", "npc", 8],
    ["cryptic", "loc", 8], ["cryptic", "key", 11], ["emote", "coord", 25], ["map", "coord", 10], ["map", "loc", 2], ["music", "npc", 6]])
    assert.equal(ofKind(family, target).length, count, `${family}/${target}`);
  for (const step of data.steps) {
    assert.equal(core.ItemDefinition.forId(step.itemId).getName(), "Clue scroll (medium)", step.key);
    if (step.target === "npc") assert.ok(step.npcIds.length, step.key);
    if (step.target === "key") assert.ok(step.keyItem > 0 && step.npcIds.length && step.locIds.length, step.key);
    if (step.family === "map") assert.ok(step.interfaceId != null, `${step.key} has no map interface`);
    if (step.family === "emote") assert.ok(step.emotes.length === 2 && step.stash && step.equipment.every(r => r.anyOf?.length || Number.isInteger(r.group) || Number.isInteger(r.emptySlot)), step.key);
    if (step.family === "coordinate") assert.match(step.text, /^\d+ degrees \d+ minutes (north|south)<br>\d+ degrees \d+ minutes (east|west)$/, step.key);
  }
  const challenged = data.steps.filter(step => step.challenge);
  assert.equal(challenged.length, 44);
  for (const step of challenged) {
    assert.equal(core.ItemDefinition.forId(step.challenge.itemId).getName(), "Challenge scroll (medium)", step.key);
    assert.ok(step.challenge.question && Number.isInteger(step.challenge.answer), step.key);
    assert.equal(data.byItem.get(step.challenge.itemId), step);
  }
  assert.equal(Catalogue.coordinateText("00.05S 01.13E"), "00 degrees 05 minutes south<br>01 degrees 13 minutes east");
});

test("every challenge NPC hands over its scroll, then takes only the cache's answer", () => {
  const f = fixture();
  for (const step of steps().filter(entry => entry.challenge)) {
    f.items.fill(null); f.sent.length = 0;
    f.place(step);
    assert.equal(f.talk(step.npcIds[0]).handled, true, step.key);
    f.finish();
    assert.equal(f.items[0].getId(), step.itemId, `${step.key} keeps the clue scroll`);
    assert.equal(f.items[1].getId(), step.challenge.itemId, `${step.key} adds the challenge scroll`);
    assert.equal(Runtime.trails(f.player).length, 1, "the challenge is not a second trail");
    f.actions.get("Challenge scroll (medium)").Read(f.event(1));
    assert.ok(f.sent.some(([name, text]) => name === "sendString" && text === step.challenge.question), step.key);
    f.talk(step.npcIds[0]);
    f.finish();
    assert.ok(f.sent.some(([name, text]) => name === "sendEnterAmountPrompt" && text === "Enter amount:"), step.key);
    f.answer(step.challenge.answer + 1);
    f.finish();
    assert.equal(f.items[1].getId(), step.challenge.itemId, `${step.key} keeps the scroll after a wrong answer`);
    f.talk(step.npcIds[0]);
    f.finish();
    f.answer(step.challenge.answer);
    f.finish();
    assert.equal(f.state().completed, 1, step.key);
    assert.notEqual(f.items[0].getId(), step.challenge.itemId);
    assert.equal(f.items[1].getId(), -1, "the correct answer removes the challenge with the clue");
  }
});

test("challenge NPCs speak their own transcript where it has the words", () => {
  const f = fixture();
  const baraek = steps().find(step => step.challenge?.key === "cluehelper_challenge_question_baraek");
  f.place(baraek);
  played.length = 0;
  f.talk(baraek.npcIds[0]); f.finish();
  assert.deepEqual(played[0], { npc: "I must ask you something..." });
  assert.equal(f.box().getText(), "Baraek has given you a challenge scroll!");
  f.talk(baraek.npcIds[0]); f.finish(); f.answer(1); f.finish();
  assert.ok(played.some(line => line.npc === "Wrong! Try again."));
  f.talk(baraek.npcIds[0]); f.finish(); f.answer(baraek.challenge.answer); f.finish();
  assert.ok(played.some(line => line.npc === "Correct."));
  assert.equal(f.box().getText(), "Baraek has given you another clue scroll!");
});

test("an NPC with no transcript lines hands over its challenge scroll at once", () => {
  const f = fixture();
  const otto = steps().find(step => step.challenge && C.getNpc(step.npcIds[0])?.name === "Otto Godblessed");
  f.place(otto);
  played.length = 0;
  f.talk(otto.npcIds[0]);
  assert.deepEqual(played, []);
  assert.equal(f.items[1].getId(), otto.challenge.itemId, "no dialogue is left holding the hand-over");
  assert.equal(f.box().getText(), "Otto Godblessed has given you a challenge scroll!");
});

test("plain anagram, cipher and cryptic NPCs complete after their dialogue", () => {
  const f = fixture();
  for (const step of steps().filter(entry => entry.target === "npc" && !entry.challenge && entry.family !== "music")) {
    f.items.fill(null);
    f.place(step);
    assert.equal(f.talk(step.npcIds[0]).handled, true, step.key);
    f.finish();
    assert.equal(f.state().completed, 1, step.key);
    const transcript = TRANSCRIPTS[C.getNpc(step.npcIds[0]).name]?.variants?.["treasure-trails-medium"];
    assert.equal(f.box().getText(), Dialogue.message(transcript) ?? `${C.getNpc(step.npcIds[0]).name} has given you another clue scroll!`, step.key);
  }
});

test("keyed steps drop their key only during the trail, and the loc opens only with it", () => {
  const f = fixture();
  for (const step of ofKind("cryptic", "key")) {
    f.items.fill(null);
    f.place(step);
    const drops = [];
    f.emit("npc-drops:add", { player: f.player, npcId: step.npcIds[0] + 100000, drops });
    assert.deepEqual(drops, [], `${step.key} other NPCs drop no key`);
    f.emit("npc-drops:add", { player: f.player, npcId: step.npcIds[0], drops });
    assert.deepEqual(drops, [{ itemId: step.keyItem, amount: 1 }], step.key);
    const open = () => { const event = { player: f.player, objectId: step.locIds[0], location: step.location, handled: false }; Runtime.search(event); return event.handled; };
    f.sent.length = 0;
    assert.equal(open(), true, `${step.key} handles its locked container without a key`);
    assert.equal(f.state().completed, 0, "a locked search does not advance the clue");
    assert.deepEqual(f.sent.at(-1), ["message", `It is locked. ${step.description}`]);
    f.items[5] = new core.Item(step.keyItem, 1);
    const again = [];
    f.emit("npc-drops:add", { player: f.player, npcId: step.npcIds[0], drops: again });
    assert.deepEqual(again, [], `${step.key} drops no second key`);
    assert.equal(open(), true, step.key);
    assert.equal(f.items[5], null, `${step.key} uses the key up`);
    assert.equal(f.state().completed, 1, step.key);
  }
});

test("crate maps search their crate; coordinate and map digs need the exact tile", () => {
  const f = fixture();
  for (const step of ofKind("map", "loc")) {
    f.items.fill(null); f.place(step);
    const event = { player: f.player, objectId: step.locIds[0], location: step.location, handled: false };
    Runtime.search(event);
    assert.equal(event.handled, true, step.key);
  }
  for (const step of [...ofKind("coordinate"), ...ofKind("map", "coord")]) {
    f.items.fill(null); f.place(step);
    f.items[1] = new core.Item(I.SPADE, 1);
    const dig = () => { const event = { player: f.player, itemId: I.SPADE, option: "Dig", allow: true }; Runtime.dig(event); return event.allow; };
    f.move({ ...step.location, x: step.location.x + 1 });
    assert.equal(dig(), true, step.key);
    f.move(step.location);
    assert.equal(dig(), false, step.key);
    assert.equal(f.state().completed, 1, step.key);
  }
});

test("medium emotes need both emotes in order, the outfit (groups included) and Uri's own words", () => {
  const f = fixture();
  for (const step of ofKind("emote")) {
    f.items.fill(null); f.worn.length = 0; f.spawned.length = 0;
    f.place(step);
    for (const requirement of step.equipment) {
      if (requirement.emptySlot != null) continue;
      const id = requirement.anyOf?.[0] ?? [...C.getObjNames().keys()].find(item => C.getItem(item)?.params?.get?.(Catalogue.TRAIL_ITEM_GROUP_PARAM) === requirement.group);
      assert.ok(id != null, `${step.key} group ${requirement.group} has an item`);
      f.worn.push(new core.Item(id, 1));
    }
    Runtime.emote({ player: f.player, slot: step.emotes[1] });
    assert.equal(f.spawned.length, 0, `${step.key} the second emote alone does nothing`);
    Runtime.emote({ player: f.player, slot: step.emotes[0] });
    assert.equal(f.spawned.length, 1, step.key);
    const uri = f.spawned[0];
    played.length = 0;
    f.talk(uri.def.id, uri); f.finish();
    assert.deepEqual(played, [{ npc: "I do not believe we have any business, Comrade." }], `${step.key} needs the second emote`);
    assert.equal(f.state().completed, 0);
    Runtime.emote({ player: f.player, slot: step.emotes[1] });
    played.length = 0;
    f.talk(uri.def.id, uri);
    assert.equal(f.state().completed, 1, `${step.key} advances on Uri's first phrase`);
    f.finish();
    assert.deepEqual(played.at(-1), { player: "What?" }, step.key);
    assert.equal(f.state().completed, 1, step.key);
    assert.equal(f.box().getText(), "You've been given a clue!", step.key);
    assert.equal(f.box().getItemId(), C.getObjId("trail_medium_emote_exp9"), "Uri's display item differs from the inventory clue");
  }
});

test("the imported medium table opens a casket of 3-5 rolls once", () => {
  const f = fixture();
  assert.deepEqual(require("../data/definitions/clue-caskets.json").tables.medium.rolls, [3, 5]);
  f.items[0] = new core.Item(I.REWARD_CASKET_MEDIUM_, 1);
  const event = f.event();
  assert.equal(Caskets.open(event), true);
  assert.equal(f.attributes.get(Runtime.completedAttribute(MEDIUM)), 1);
  assert.equal(Caskets.open(event), false);
});

test("a medium STASH unit needs Construction 42 and oak planks", () => {
  const f = fixture();
  const units = [...Stash.stashes().values()].filter(unit => unit.tier === MEDIUM);
  assert.equal(units.length, 25);
  const unit = units[0];
  const use = () => { const event = { player: f.player, objectId: unit.step.stash.locId, location: unit.location, handled: false }; Stash.interact(event); };
  [[I.HAMMER, 1], [I.SAW, 1], [I.PLANK, 2], [I.STEEL_NAILS, 10]].forEach(([id, amount], slot) => { f.items[slot] = new core.Item(id, amount); });
  f.skills.level = 42;
  use();
  assert.equal(f.attributes.get(Stash.BUILT_ATTRIBUTE), undefined, "regular planks do not build a medium unit");
  f.items[2] = new core.Item(I.OAK_PLANK, 2);
  f.skills.level = 41;
  use();
  assert.equal(f.attributes.get(Stash.BUILT_ATTRIBUTE), undefined);
  f.skills.level = 42;
  use();
  assert.deepEqual(f.attributes.get(Stash.BUILT_ATTRIBUTE), [unit.step.stash.locId]);
  assert.equal(f.skills.xp, 250);
});

test("\"no boots\" means nothing may be worn in that slot", () => {
  const f = fixture();
  const step = steps().find(entry => entry.key === "cluehelper_emote_medium_17");
  const feet = step.equipment.find(requirement => requirement.emptySlot != null);
  assert.equal(feet.emptySlot, core.Equipment.FEET_SLOT);
  f.place(step);
  f.worn.push(...step.equipment.filter(requirement => requirement.anyOf).map(requirement => new core.Item(requirement.anyOf[0], 1)));
  assert.equal(Runtime.emoteReady(f.player, step), true);
  f.worn.push(new core.Item(I.LEATHER_BOOTS, 1));
  assert.equal(Runtime.emoteReady(f.player, step), false);
});

test("answer variants and branches are found under the transcripts' other names", () => {
  const f = fixture();
  const ali = steps().find(step => step.key === "cluehelper_cipher_medium_0");
  f.place(ali);
  played.length = 0;
  f.talk(ali.npcIds[0]); f.finish();
  assert.ok(played.some(line => line.npc === "I need you to answer this for me."));
  f.talk(ali.npcIds[0]); f.finish();
  assert.ok(played.some(line => line.npc === "Please give me your answer!"));
  f.answer(1); f.finish();
  assert.ok(played.some(line => line.npc === "Nope, not correct!"));
  f.talk(ali.npcIds[0]); f.finish(); f.answer(ali.challenge.answer); f.finish();
  assert.ok(played.some(line => line.npc === "Spot on!"));
  assert.equal(f.box().getText(), "Ali the Kebab seller has given you another clue scroll!");
});

test("an exact npc-dialogue:start request for a missing variant gets nothing, not the NPC's default chat", () => {
  const api = PluginManager.createApi("NpcDialoguesExactVariant");
  require("../plugins/npcs/NpcDialogues.plugin").register(api);
  const torgan = steps().find(step => step.key === "cluehelper_anagram_medium_torgan").npcIds[0];
  const ask = exact => {
    let found = null;
    api.emitCustomEvent("npc-dialogue:start", { player: {}, npcId: torgan, variant: "treasure-trails-medium", exact, handled: false,
      select: stepsFound => { found = stepsFound; return []; } });
    return found;
  };
  assert.equal(ask(true), null, "Elder Torgan has no treasure-trails-medium variant");
  assert.ok(Array.isArray(ask(false)) && ask(false).length, "without exact, the default transcript still plays");
});

test("challenge handouts need room, cannot duplicate, and completing a full pack removes both scrolls", () => {
  const f = fixture(), step = steps().find(entry => entry.challenge);
  f.place(step);
  const clue = f.items[0];
  f.items.fill(new core.Item(I.COINS, 1), 1);
  f.talk(step.npcIds[0]); f.finish();
  assert.equal(f.items[0], clue);
  assert.ok(!f.items.some(item => item?.getId() === step.challenge.itemId));
  assert.equal(f.ground.length, 0);
  f.items[8] = null;
  f.talk(step.npcIds[0]); f.finish();
  assert.equal(f.items[0], clue);
  assert.equal(f.items[8].getId(), step.challenge.itemId);
  f.box();
  assert.ok(f.sent.some(([name, widget, itemId, zoom]) => name === "sendItemOnInterfaces" && widget === (193 << 16 | 1) && itemId === step.challenge.itemId && zoom === 400));
  assert.ok(f.sent.some(([name, script, text]) => name === "sendClientScript" && text === "Click here to continue"));
  const snapshot = f.state();
  f.talk(step.npcIds[0]);
  assert.ok(!f.sent.some(([name]) => name === "sendEnterAmountPrompt"), "NPC line precedes the amount prompt");
  f.finish();
  f.answer(step.challenge.answer); f.finish();
  assert.equal(f.items[8].getId(), -1);
  assert.equal(f.state().completed, 1);
  assert.equal(f.state().token, snapshot.token);
  f.answer(step.challenge.answer); f.finish();
  assert.equal(f.state().completed, 1, "replayed answer cannot advance twice");
});

test("an orphan challenge can be read but cannot answer or initialize a replacement trail", () => {
  const f = fixture(), step = steps().find(entry => entry.challenge);
  f.place(step); f.talk(step.npcIds[0]); f.finish();
  f.items[0] = null;
  const challenge = f.items[1];
  f.actions.get("Challenge scroll (medium)").Read(f.event(1));
  assert.equal(f.items[1], challenge);
  assert.equal(Runtime.trails(f.player).length, 0);
  assert.equal(f.talk(step.npcIds[0]).handled, false);
  assert.ok(!f.sent.some(([name]) => name === "sendEnterAmountPrompt"));
});

test("the final challenge replaces the clue and removes its challenge in the same refresh before the casket box", () => {
  const f = fixture(), step = steps().find(entry => entry.challenge);
  f.place(step, 3, 0, 2); f.talk(step.npcIds[0]); f.finish();
  f.talk(step.npcIds[0]); f.finish(); f.answer(step.challenge.answer);
  f.refreshed.length = 0;
  f.finish();
  assert.equal(f.refreshed.length, 1);
  assert.deepEqual(f.refreshed[0].slice(0, 2), [I.REWARD_CASKET_MEDIUM_, null]);
  assert.equal(f.box().getItemId(), I.REWARD_CASKET_MEDIUM_);
  assert.equal(f.box().getText(), "You've obtained a casket!");
});

test("line transcripts preserve player speech and reject an unrelated NPC speaker", () => {
  assert.deepEqual(Dialogue.lines([{ type: "line", speaker: "Player", text: "What?" }], Math.random, "Uri"), [{ player: "What?" }]);
  assert.deepEqual(Dialogue.lines([{ type: "line", speaker: "Dunstan", text: "Please enter the answer to the question." }], Math.random, "Baraek"), []);
});

test("Uri keeps standing during his first phrase even when the player closes the advanced dialogue", () => {
  const f = fixture(), step = ofKind("emote")[0];
  f.place(step);
  for (const requirement of step.equipment) {
    if (requirement.emptySlot != null) continue;
    const id = requirement.anyOf?.[0] ?? [...C.getObjNames().keys()].find(item => C.getItem(item)?.params?.get?.(Catalogue.TRAIL_ITEM_GROUP_PARAM) === requirement.group);
    f.worn.push(new core.Item(id, 1));
  }
  Runtime.emote({ player: f.player, slot: step.emotes[0] });
  Runtime.emote({ player: f.player, slot: step.emotes[1] });
  const uri = f.spawned[0];
  f.talk(uri.def.id, uri);
  assert.equal(f.state().completed, 1);
  assert.notEqual(uri.removed, true, "Uri is present while the first phrase is shown");
  f.talk(uri.def.id, uri);
  assert.equal(f.state().completed, 1, "a repeated click after closing cannot grant a second clue");
});

test("key NPC variants with and without tables use one canonical death-drop lifecycle", () => {
  const f = fixture(), Drops = require("../plugins/npcs/NpcDrops.plugin");
  const placed = [], lifecycle = [];
  let death;
  const noop = () => {};
  const api = new Proxy({ core, getItemOnGroundManager: () => ({ registerLocation: (player, item) => placed.push(item) }),
    onNpcDeath: callback => { death = callback; }, emitCustomEvent: (name, event) => { lifecycle.push(name); f.emit(name, event); }
  }, { get: (target, key) => key in target ? target[key] : noop });
  Drops.register(api);
  Drops._test.loadDrops();
  for (const npcId of [7261, 11195, 10498, 10499, 3063, 3266]) {
    f.items.fill(null); placed.length = 0; lifecycle.length = 0;
    const step = ofKind("cryptic", "key").find(entry => entry.npcIds.includes(npcId));
    assert.ok(step, `key step for NPC ${npcId}`);
    f.place(step);
    death({ killer: f.player, npcId, npc: { getLocation: () => f.player.getLocation() } });
    assert.equal(placed.filter(item => item.getId() === step.keyItem).length, 1, `NPC ${npcId}`);
    assert.equal(lifecycle.filter(name => name === "npc-drops:add").length, 1);
    assert.equal(lifecycle.filter(name => name === "npc-drops:generated").length, 1);
    f.items[5] = new core.Item(step.keyItem, 1); placed.length = 0;
    death({ killer: f.player, npcId, npc: { getLocation: () => f.player.getLocation() } });
    assert.equal(placed.filter(item => item.getId() === step.keyItem).length, 0, "carrying the key prevents another drop");
  }
});

test('challenge completion preserves real Inventory slots, held-clue capacity and stale guards', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const Capacity = require('../plugins/treasuretrails/Capacity.ClueCapacity');
  const events = new Map();
  const api = new Proxy({ core,
    onCustomEvent: (name, fn) => events.set(name, fn),
    emitCustomEvent: (name, request) => events.get(name)?.(request),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  plugin.register(api); Capacity(api);
  t.mock.method(Dialogue, 'play', (_player, _npc, _lines, end) => end?.());
  t.mock.method(Dialogue, 'itemBox', () => {});
  const step = Runtime.data(MEDIUM).steps.find(entry => entry.challenge);
  for (const completed of [0, 2]) {
    const player = new Player(null), sender = new Proxy({}, { get: () => () => sender });
    player.getPacketSender = () => sender; player.sendMessage = () => {};
    player.moveTo(new core.Location(step.location.x, step.location.y, step.location.z));
    const inventory = player.getInventory(), key = Runtime.metaKey(MEDIUM);
    inventory.setItem(0, new core.Item(step.itemId).setMetaValue(key,
      { version: 1, token: `real-${completed}`, revision: 0, completed, length: 3, row: step.row }));
    const npc = { getLocation: () => player.getLocation() };
    Runtime.talk({ player, npcId: step.npcIds[0], npc, clickType: 1, definition: { getActions: () => ['Talk-to'] } });
    assert.equal(inventory.getAmount(step.itemId), 1);
    assert.equal(inventory.getAmount(step.challenge.itemId), 1);
    assert.equal(Capacity.count(player, 'medium'), 1);
    const snapshot = Runtime.trails(player)[0];
    Runtime.answered(player, npc, step.npcIds[0], snapshot, null, step.challenge.answer);
    assert.equal(inventory.getAmount(step.challenge.itemId), 0);
    assert.ok(inventory.getItems().every(item => item instanceof core.Item));
    assert.equal(inventory.getFreeSlots(), 27);
    assert.equal(Runtime.advance(player, snapshot), false, 'a stale answer cannot advance again');
    inventory.add(new core.Item(I.SPADE), false);
    assert.equal(inventory.getAmount(I.SPADE), 1);
    if (completed === 2) assert.equal(inventory.getAmount(I.REWARD_CASKET_MEDIUM_), 1);
  }
});


test("Uri displays the casket after a final emote joins an existing stack", () => {
  const f = fixture(), step = ofKind("emote")[0];
  f.items.fill(null);
  const inventory = new core.Inventory(f.player).setItems(f.items);
  f.player.getInventory = () => inventory;
  for (let slot = 0; slot < f.items.length; slot++) f.items[slot] = new core.Item(-1, 0);
  f.place(step, 3, 0, 2);
  const casket = Runtime.data(MEDIUM).casket;
  inventory.setItem(13, new core.Item(casket, 1));
  for (const requirement of step.equipment) {
    if (requirement.emptySlot != null) continue;
    const id = requirement.anyOf?.[0] ?? [...C.getObjNames().keys()].find(item => C.getItem(item)?.params?.get?.(Catalogue.TRAIL_ITEM_GROUP_PARAM) === requirement.group);
    f.worn.push(new core.Item(id, 1));
  }
  Runtime.emote({ player: f.player, slot: step.emotes[0] });
  Runtime.emote({ player: f.player, slot: step.emotes[1] });
  const uri = f.spawned[0];
  f.talk(uri.def.id, uri);
  assert.equal(inventory.get(13).getAmount(), 2);
  assert.equal(inventory.get(0).getId(), -1);
  f.finish();
  assert.equal(f.box().getItemId(), casket);
});
