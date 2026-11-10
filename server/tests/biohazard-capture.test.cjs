// Run after yarn build: node --test tests/biohazard-capture.test.cjs
// Biohazard's scenes against a complete live run (rsprox 20261110T121228-5ab63b4, revision 242).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

let core, api, quest;
let index = 4800;
const projectiles = [];
const doorOpens = [];
const MESSAGEBOX = 229;
const OBJECTBOX = 193;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[2562, 3301], [2557, 3267], [2541, 3331], [2611, 3326], [2551, 3320], [2551, 3325], [3264, 3405], [3282, 3382]]) {
    core.RegionManager.loadMapFiles(x, y);
  }
  PluginManager.emitServerStartup({});
  api = PluginManager.createApi("BiohazardCaptureTest");
  api.onCustomEvent("door:open", (event) => doorOpens.push(event));
  quest = QuestRuntime.getRegisteredQuests().find(({ key }) => key === "biohazard");
  assert.ok(quest);
  const send = core.Projectile.prototype.sendProjectile;
  core.Projectile.prototype.sendProjectile = function record() {
    projectiles.push(this);
    return send.call(this);
  };
});

function actor(stage, x, y, z = 0) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++);
  player.setUsername("biohazardcap" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, z));
  player.setNeedsPlacement(false);
  const log = { messages: [], chatbox: [], strings: [], anims: [], sounds: [], varbits: [] };
  player.log = log;
  const sender = player.getPacketSender();
  sender.sendMessage = (text) => { log.messages.push(String(text)); return sender; };
  const chatbox = sender.sendChatboxInterface.bind(sender);
  sender.sendChatboxInterface = (id, ...rest) => { log.chatbox.push(id); return chatbox(id, ...rest); };
  const string = sender.sendString.bind(sender);
  sender.sendString = (text, uid, ...rest) => { log.strings.push(String(text)); return string(text, uid, ...rest); };
  const sound = sender.sendSoundEffect.bind(sender);
  sender.sendSoundEffect = (id, ...rest) => { log.sounds.push(id); return sound(id, ...rest); };
  const varbit = sender.sendVarbit.bind(sender);
  sender.sendVarbit = (id, value) => { log.varbits.push([id, value]); return varbit(id, value); };
  const animate = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { log.anims.push(animation.getId()); return animate(animation); };
  quest.setStage(player, stage);
  return player;
}

function tick(player, count = 1) {
  for (let i = 0; i < count; i++) {
    player.getMovementQueue().process();
    core.TaskManager.processWalkTo(player.getIndex());
    core.TaskManager.process();
  }
}

const amount = (player, id) => player.getInventory().getAmount(id);
const current = (player) => player.getDialogueManager().getCurrent();
const shown = (player) => {
  const text = current(player)?.getText?.() ?? current(player)?.text ?? null;
  return text == null ? null : String(text).replace(/\s+/g, " ").trim();
};
const held = (player) => current(player)?.isSelfAdvancing?.() === true;
const next = (player) => player.getDialogueManager().advance();
const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const objectAt = (id, x, y, z = 0) => core.MapObjects.get(id, new core.Location(x, y, z));

function wear(player, slot, itemId) {
  player.getEquipment().setItem(slot, new core.Item(itemId, 1));
}

function objectOption(player, id, x, y, z, option, definitionId = id) {
  const object = objectAt(id, x, y, z);
  assert.ok(object, `loc ${id} at ${x},${y},${z}`);
  const definition = core.ObjectDefinition.forId(definitionId);
  const clickType = definition.getInteractions().indexOf(option) + 1;
  assert.ok(clickType > 0, `${option} on loc ${definitionId}`);
  const event = { player, object, objectId: id, definition, option, clickType, location: object.getLocation(), handled: false };
  PluginManager.emitObjectInteraction(event);
  return event;
}

test("Investigate throws the feed with the cage on the ground, in a message box (tick 181)", () => {
  const player = actor(2, 2563, 3301);
  player.getInventory().adds(core.ItemIdentifiers.BIRD_FEED, 1);
  objectOption(player, 37328, 2562, 3301, 0, "Investigate", 35947);
  assert.equal(quest.getStage(player), 3);
  assert.equal(amount(player, core.ItemIdentifiers.BIRD_FEED), 0);
  assert.equal(player.log.chatbox.at(-1), MESSAGEBOX);
  assert.equal(shown(player), "You throw a handful of seeds onto the watchtower. The mourners do not seem to notice.");
  assert.deepEqual(player.log.messages, []);
});

test("the pigeons fly at the watchtower: held box, three projectiles, then a continue (ticks 205-210)", () => {
  const player = actor(3, 2562, 3300);
  player.getInventory().adds(core.ItemIdentifiers.PIGEON_CAGE, 1);
  projectiles.length = 0;
  const slot = player.getInventory().getItems().findIndex((item) => item?.getId() === core.ItemIdentifiers.PIGEON_CAGE);
  ItemActionPacketListener.handleAction(player, 149, core.ItemIdentifiers.PIGEON_CAGE, slot, 1, "Open");
  assert.equal(quest.getStage(player), 4);
  assert.equal(amount(player, core.ItemIdentifiers.PIGEON_CAGE), 0);
  assert.equal(amount(player, core.ItemIdentifiers.PIGEON_CAGE_2), 1);
  assert.deepEqual(projectiles.map((shot) => [shot.projectileId, shot.end.getX(), shot.end.getY(), shot.delay, shot.speed]),
    [[72, 2560, 3304, 5, 126], [72, 2561, 3305, 15, 146], [72, 2559, 3303, 25, 106]]);
  assert.equal(held(player), true);
  tick(player, 4);
  assert.equal(held(player), true);
  tick(player);
  assert.equal(held(player), false);
  assert.equal(shown(player), "The pigeons fly towards the watchtower. The mourners frantically try to scare them away.");
});

test("the cage away from the watchtower or before the feed: chat only", () => {
  const player = actor(3, 2600, 3300);
  player.getInventory().adds(core.ItemIdentifiers.PIGEON_CAGE, 1);
  const slot = player.getInventory().getItems().findIndex((item) => item?.getId() === core.ItemIdentifiers.PIGEON_CAGE);
  ItemActionPacketListener.handleAction(player, 149, core.ItemIdentifiers.PIGEON_CAGE, slot, 1, "Open");
  assert.equal(quest.getStage(player), 3);
  assert.deepEqual(player.log.messages, ["The pigeons don't want to leave."]);
});

function omartYes(steps) {
  return steps.find((step) => step.type === "choice").options[0].steps;
}

test("Omart's rope ladder: ladder up, climb, landing at 2556,3267, walls back, then Kilron (ticks 254-264)", () => {
  const player = actor(4, 2559, 3267);
  wear(player, core.Equipment.HEAD_SLOT, core.ItemIdentifiers.GAS_MASK);
  QuestRuntime.startTranscript(api, player, core.NpcIdentifiers.OMART, "Biohazard",
    "getting-started-talking-to-omart-after-freeing-the-birds", omartYes);
  assert.equal(shown(player), "Okay, lets do it.");
  next(player);
  assert.equal(held(player), true, "the throw box has no continue");
  assert.ok(objectAt(2066, 2558, 3267) && objectAt(2066, 2557, 3267));
  tick(player);
  assert.ok(objectAt(2065, 2558, 3267) && objectAt(2065, 2557, 3267), "the ladder replaces both walls");
  tick(player, 2);
  assert.equal(held(player), true, "the climb box has no continue either");
  assert.deepEqual(player.log.anims, [828]);
  assert.equal(quest.getStage(player), 4);
  tick(player);
  assert.deepEqual(at(player), [2556, 3267, 0]);
  assert.equal(quest.getStage(player), 5);
  tick(player, 2);
  assert.equal(held(player), false);
  assert.equal(shown(player), "...and drop down on the other side.");
  assert.ok(objectAt(2066, 2558, 3267) && objectAt(2066, 2557, 3267), "the walls are back");
  assert.ok(!objectAt(2065, 2558, 3267));
  next(player);
  assert.match(shown(player), /^Welcome to West Ardougne friend/);
});

test("Kilron's ladder lands at 2559,3267 without moving the stage (ticks 651-657)", () => {
  const player = actor(7, 2556, 3267);
  QuestRuntime.startTranscript(api, player, core.NpcIdentifiers.KILRON, "Biohazard",
    "infiltrating-the-mourner-hq-talking-to-kilron", (steps) => steps.find((step) => step.type === "choice").options[0].steps);
  next(player); // "Yes I do."
  next(player); // "Okay, quickly now!"
  assert.equal(held(player), true);
  tick(player, 4);
  assert.deepEqual(at(player), [2559, 3267, 0]);
  tick(player, 2);
  assert.equal(shown(player), "...and drop down on the other side.");
  assert.equal(quest.getStage(player), 7);
});

test("Omart without a gas mask stops before the ladder", () => {
  const player = actor(4, 2559, 3267);
  QuestRuntime.startTranscript(api, player, core.NpcIdentifiers.OMART, "Biohazard",
    "getting-started-talking-to-omart-after-freeing-the-birds", omartYes);
  next(player);
  assert.match(shown(player), /^I'd recommend you wear a gas mask/);
  next(player);
  next(player);
  tick(player, 6);
  assert.deepEqual(at(player), [2559, 3267, 0]);
  assert.equal(quest.getStage(player), 4);
});

test("Jerico's cupboard: open message, reach a tick later, open loc after; feed with the player's line", () => {
  const player = actor(2, 2611, 3325);
  objectOption(player, 2056, 2611, 3326, 0, "Open");
  assert.deepEqual(player.log.messages, ["You open the cupboard."]);
  assert.deepEqual(player.log.anims, []);
  tick(player);
  assert.deepEqual(player.log.anims, [536]);
  assert.deepEqual(player.log.sounds, [58]);
  assert.ok(objectAt(2056, 2611, 3326));
  tick(player);
  assert.ok(objectAt(2057, 2611, 3326));
  objectOption(player, 2057, 2611, 3326, 0, "Search");
  assert.equal(player.log.chatbox.at(-1), OBJECTBOX);
  assert.equal(shown(player), "The cupboard is full of bird feed.");
  assert.equal(amount(player, core.ItemIdentifiers.BIRD_FEED), 0);
  next(player);
  assert.equal(shown(player), "Mmm, bird feed! Now what could I do with that?");
  assert.equal(amount(player, core.ItemIdentifiers.BIRD_FEED), 1);
  objectOption(player, 2057, 2611, 3326, 0, "Search");
  next(player);
  assert.equal(shown(player), "I don't need any more bird feed.");
  assert.equal(amount(player, core.ItemIdentifiers.BIRD_FEED), 1);
  player.log.messages.length = 0;
  player.log.anims.length = 0;
  objectOption(player, 2057, 2611, 3326, 0, "Close");
  assert.deepEqual(player.log.messages, ["You close the cupboard."]);
  assert.deepEqual(player.log.anims, [535]);
  tick(player);
  assert.ok(objectAt(2056, 2611, 3326));
});

test("the yard fence: message, regicide_tightfit and the exact move across (tick 304)", () => {
  const player = actor(5, 2541, 3331);
  objectOption(player, 2068, 2541, 3331, 0, "Squeeze-through");
  tick(player);
  assert.ok(player.log.messages.includes("You squeeze through the fence."));
  assert.ok(player.log.anims.includes(1237));
  tick(player, 3);
  assert.deepEqual(at(player), [2542, 3331, 0]);
});

test("the cauldron's Inspect with a rotten apple poisons the stew in a message box (tick 319)", () => {
  const player = actor(5, 2543, 3331);
  player.getInventory().adds(core.ItemIdentifiers.ROTTEN_APPLE, 1);
  objectOption(player, 37327, 2543, 3332, 0, "Inspect", 35945);
  assert.equal(quest.getStage(player), 6);
  assert.equal(amount(player, core.ItemIdentifiers.ROTTEN_APPLE), 0);
  assert.equal(player.log.chatbox.at(-1), MESSAGEBOX);
  next(player);
  assert.equal(shown(player), "Anyone who eats this stew is going to have a bad time now.");
  const empty = actor(5, 2543, 3331);
  objectOption(empty, 37327, 2543, 3332, 0, "Inspect", 35945);
  assert.equal(shown(empty), "Looks like a nice stew is being prepared. This must be to feed all of the mourners.");
  assert.equal(quest.getStage(empty), 5);
});

test("the HQ door is its mourner: turned away, then let in in the gown at stage 6 (ticks 468-483)", () => {
  const poisoned = actor(6, 2551, 3319);
  const refused = objectOption(poisoned, 2036, 2551, 3320, 0, "Open");
  assert.equal(refused.handled, true);
  assert.equal(shown(poisoned), "Back away citizen. Several mourners are ill with food poisoning.");
  const early = actor(5, 2551, 3319);
  objectOption(early, 2036, 2551, 3320, 0, "Open");
  assert.equal(shown(early), "Back away citizen. Only mourners are allowed inside the headquarters.");
  const doctor = actor(6, 2551, 3320);
  wear(doctor, core.Equipment.BODY_SLOT, core.ItemIdentifiers.MEDICAL_GOWN);
  doorOpens.length = 0;
  objectOption(doctor, 2036, 2551, 3320, 0, "Open");
  assert.equal(shown(doctor), "A doctor? I didn't think there were any left around here.");
  next(doctor);
  next(doctor);
  assert.equal(shown(doctor), "You heard right. Head on in and see what you can do.");
  assert.equal(doorOpens.length, 0);
  next(doctor);
  assert.equal(doorOpens.length, 1);
  assert.equal(doorOpens[0].object.getId(), 2036);
  // A pass-through door, as live: inviswall and the open leaf north, the player steps in (tick 483).
  assert.ok(objectAt(2037, 2551, 3321));
  tick(doctor);
  assert.deepEqual(at(doctor), [2551, 3321, 0]);
  tick(doctor, 2);
  assert.ok(objectAt(2036, 2551, 3320), "it shuts two ticks later");
  const later = actor(7, 2551, 3320);
  wear(later, core.Equipment.BODY_SLOT, core.ItemIdentifiers.MEDICAL_GOWN);
  objectOption(later, 2036, 2551, 3320, 0, "Open");
  assert.equal(current(later), undefined, "in the gown later it just opens (tick 598)");
  assert.ok(objectAt(2037, 2551, 3321));
});

test("the cage gate with the key shows its box going in, none coming out (ticks 557, 580)", () => {
  const entering = actor(6, 2550, 3325, 1);
  entering.getInventory().adds(core.ItemIdentifiers.KEY_2, 1);
  const event = { player: entering, objectId: 2060, location: new core.Location(2551, 3325, 1), handled: false };
  PluginManager.emitCustomEvent("door:toggle", event);
  assert.equal(event.handled, false, "Doors opens it");
  assert.equal(shown(entering), "You use the key to open the gate.");
  const leaving = actor(7, 2552, 3325, 1);
  leaving.getInventory().adds(core.ItemIdentifiers.KEY_2, 1);
  PluginManager.emitCustomEvent("door:toggle", { player: leaving, objectId: 2060, location: new core.Location(2551, 3325, 1), handled: false });
  assert.equal(current(leaving), undefined);
  const keyless = actor(6, 2550, 3325, 1);
  PluginManager.emitCustomEvent("door:toggle", { player: keyless, objectId: 2060, location: new core.Location(2551, 3325, 1), handled: false });
  assert.deepEqual(keyless.log.messages, ["The gate is locked. You need a key."]);
});

test("the sickest mourner's key goes into the backpack with its box, not onto the ground (tick 543)", () => {
  const player = actor(6, 2550, 3326, 1);
  const drops = [{ itemId: core.ItemIdentifiers.KEY_2, amount: 1 }, { itemId: 526, amount: 1 }];
  PluginManager.emitCustomEvent("npc-drops:roll", { player, npcId: core.NpcIdentifiers.MOURNER_14, drops, damagers: [player] });
  assert.deepEqual(drops.map((drop) => drop.itemId), [526]);
  const npc = { getLocation: () => new core.Location(2550, 3327, 1) };
  PluginManager.emitNpcDeath({ killer: player, npcId: core.NpcIdentifiers.MOURNER_14, npc });
  assert.equal(amount(player, core.ItemIdentifiers.KEY_2), 1);
  assert.equal(player.log.chatbox.at(-1), OBJECTBOX);
  assert.equal(shown(player), "The mourner drops a key as he dies.");
  const after = actor(16, 2550, 3326, 1);
  const kept = [{ itemId: core.ItemIdentifiers.KEY_2, amount: 1 }];
  PluginManager.emitCustomEvent("npc-drops:roll", { player: after, npcId: core.NpcIdentifiers.MOURNER_14, drops: kept, damagers: [after] });
  assert.equal(kept.length, 1, "outside the quest the drop table's key stays");
});

test("the distillator crate's find is an item box (tick 574)", () => {
  const player = actor(6, 2554, 3326, 1);
  objectOption(player, 2064, 2554, 3327, 1, "Search");
  assert.equal(quest.getStage(player), 7);
  assert.equal(amount(player, core.ItemIdentifiers.DISTILLATOR), 1);
  assert.equal(player.log.chatbox.at(-1), OBJECTBOX);
});

test("Elena keeps the distillator until she hands out the sample and vials (tick 723)", () => {
  const player = actor(7, 2591, 3336);
  player.getInventory().adds(core.ItemIdentifiers.DISTILLATOR, 1);
  QuestRuntime.startTranscript(api, player, core.NpcIdentifiers.ELENA, "Biohazard", "delivering-the-samples-talking-to-elena-with-the-distillator");
  for (let i = 0; i < 12 && shown(player) !== "touch paper."; i++) next(player);
  assert.equal(shown(player), "touch paper.", "the end of Elena's long line, its second page");
  assert.equal(amount(player, core.ItemIdentifiers.DISTILLATOR), 1);
  assert.equal(quest.getStage(player), 7);
  next(player);
  assert.equal(shown(player), "Elena gives you a plague sample along with three vials.");
  assert.equal(amount(player, core.ItemIdentifiers.DISTILLATOR), 0);
  assert.equal(amount(player, core.ItemIdentifiers.PLAGUE_SAMPLE), 1);
  assert.equal(quest.getStage(player), 10);
});

test("south-east Varrock's guard searches at the gate and opens it after 'You may now pass.' (ticks 944-957)", () => {
  const player = actor(12, 3263, 3406);
  player.getInventory().adds(core.ItemIdentifiers.ETHENEA, 1);
  doorOpens.length = 0;
  const object = objectAt(2051, 3264, 3406);
  const event = { player, object, objectId: 2051, location: object.getLocation(), handled: false };
  PluginManager.emitCustomEvent("door:toggle", event);
  assert.equal(event.handled, true);
  assert.match(shown(player), /^Halt\. I need to conduct a search on you/);
  next(player);
  assert.equal(shown(player), "The guard searches you.");
  next(player);
  assert.equal(shown(player), "He takes the vial of ethenea from you.");
  assert.equal(amount(player, core.ItemIdentifiers.ETHENEA), 0);
  next(player);
  assert.equal(shown(player), "You may now pass.");
  assert.equal(doorOpens.length, 0);
  next(player);
  assert.equal(doorOpens.length, 1);
  const before = actor(10, 3263, 3406);
  const free = { player: before, object, objectId: 2051, location: object.getLocation(), handled: false };
  PluginManager.emitCustomEvent("door:toggle", free);
  assert.equal(current(before), undefined, "no search before the chemist");
});

test("Julie asks for a priest at Guidor's door and sets biohazard_met_julie; in the gown it opens (ticks 1064-1077)", () => {
  const player = actor(12, 3281, 3382);
  objectOption(player, 2032, 3282, 3382, 0, "Open");
  assert.match(shown(player), /^Please leave my husband alone/);
  next(player);
  next(player);
  assert.equal(shown(player), "Thank you, but I just want him to see a priest.");
  assert.deepEqual(player.log.varbits.filter(([id]) => id === 9105), [[9105, 1]]);
  assert.equal(Number(player.getAttribute("biohazard:met-julie")), 1);
  const priest = actor(12, 3281, 3382);
  wear(priest, core.Equipment.BODY_SLOT, core.ItemIdentifiers.PRIEST_GOWN);
  wear(priest, core.Equipment.LEG_SLOT, core.ItemIdentifiers.PRIEST_GOWN_3);
  objectOption(priest, 2032, 3282, 3382, 0, "Open");
  assert.equal(current(priest), undefined, "no line in the gown");
  assert.ok(objectAt(2033, 3282, 3382) ?? objectAt(2033, 3283, 3382));
});

test("the gas mask stays on in West Ardougne during the quest (ticks 270, 275)", () => {
  const message = "You should leave your gas mask on while you're in West Ardougne.";
  const inside = actor(5, 2550, 3300);
  wear(inside, core.Equipment.HEAD_SLOT, core.ItemIdentifiers.GAS_MASK);
  assert.equal(PluginManager.emitCanUnequip(inside, core.Equipment.HEAD_SLOT, inside.getEquipment().get(core.Equipment.HEAD_SLOT)), false);
  assert.equal(PluginManager.emitCanEquip(inside, core.Equipment.HEAD_SLOT, new core.Item(1153, 1)), false);
  assert.deepEqual(inside.log.messages, [message, message]);
  const outside = actor(5, 2560, 3300);
  wear(outside, core.Equipment.HEAD_SLOT, core.ItemIdentifiers.GAS_MASK);
  assert.notEqual(PluginManager.emitCanUnequip(outside, core.Equipment.HEAD_SLOT, outside.getEquipment().get(core.Equipment.HEAD_SLOT)), false);
  const done = actor(16, 2550, 3300);
  wear(done, core.Equipment.HEAD_SLOT, core.ItemIdentifiers.GAS_MASK);
  assert.notEqual(PluginManager.emitCanUnequip(done, core.Equipment.HEAD_SLOT, done.getEquipment().get(core.Equipment.HEAD_SLOT)), false);
});

test("Elena points back to Jerico before the wall is crossed (tick 29), and the key leaves on completion (tick 1241)", () => {
  const player = actor(1, 2591, 3337);
  for (const stage of [1, 4]) {
    quest.setStage(player, stage);
    assert.equal(PluginManager.emitNpcDialogueVariant({ player, npcId: core.NpcIdentifiers.ELENA_2 }),
      "getting-started-talking-to-elena-again");
  }
  quest.setStage(player, 5);
  assert.equal(PluginManager.emitNpcDialogueVariant({ player, npcId: core.NpcIdentifiers.ELENA_2 }),
    "infiltrating-the-mourner-hq-talking-to-elena-without-the-distillator");
  assert.ok(QuestRuntime.startTranscript(api, player, core.NpcIdentifiers.ELENA, "Biohazard", "getting-started-talking-to-elena-again"));
  assert.equal(shown(player), "Hello Elena.");
  const king = actor(15, 2579, 3291, 1);
  king.getInventory().adds(core.ItemIdentifiers.KEY_2, 1);
  quest.complete(king);
  assert.equal(amount(king, core.ItemIdentifiers.KEY_2), 0);
});
