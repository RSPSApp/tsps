// Run after `yarn build`: node --test tests/enlightened-journey-capture.test.cjs
//
// Enlightened Journey against the user's revision 242 RSProx recording (rsprox local enlightened-journey; facts and
// ticks in docs/quests/enlightened-journey/README.md). Every plugin loaded, a real Player, the transcript runner with
// native dialogue input and the real item-use listener; the packet sender is watched for what the player sees:
// zep_quest's own values at the recorded beats, the hand-ins' varbits, the balloon diagram, the three scenes (copy,
// camera, fade, tabs, the way back), the crafting beats, and the post-quest talk.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const { UseItemPacketListener } = require('../dist/net/packet/impl/UseItemPacketListener');

const STAGE_KEY = 'quest.enlightened_journey.stage';
const NUMBERING_KEY = 'quest.enlightened_journey.numbering';
const FLAGS_KEY = 'quest.enlightened_journey.flags';
const VARBIT = { QUEST: 2866, BASKET: 2867, PICCARD: 2868, RED: 2873, YELLOW: 2874, SANDBAGS: 2875, SILK: 2876, BOWL: 2878, BOTH: 2879, RETURN: 2886, CUTSCENE: 542 };
const BLUEPRINT = 472;
const AUGUSTE_AT = [2809, 3354, 0];
let core, I, next = 4300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi(); I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2808, 3355);
  core.RegionManager.loadMapFiles(2938, 3421);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/** A real player on Entrana by Auguste, with what the packet sender sent in `seen`. */
function actor(t, { stage = 0, items = [], at = AUGUSTE_AT, flags = 0 } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('ejcap' + next);
  p.setRegistered(true); p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(...at)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  for (const [id, amount = 1] of items) p.getInventory().add(new core.Item(id, amount), true);
  p.setAttribute(STAGE_KEY, stage);
  p.setAttribute(NUMBERING_KEY, 2);
  p.setAttribute(FLAGS_KEY, flags);
  p.setAttribute(require('../plugins/quests/QuestRuntime').QUEST_POINTS_ATTRIBUTE, 20);
  for (const skill of [core.Skill.CRAFTING, core.Skill.FARMING, core.Skill.FIREMAKING]) {
    p.getSkillManager().setMaxLevels(skill, 60, false);
    p.getSkillManager().setCurrentLevels(skill, 60, false);
  }
  const seen = [];
  const sender = p.getPacketSender();
  const spy = (name, record) => {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { seen.push(record(...args)); return original(...args); };
  };
  spy('sendVarbit', (id, value) => ['varbit', id, value]);
  spy('sendInterface', (id) => ['interface', id]);
  spy('sendCameraMoveTo', (x, y, h) => ['camera-move', x, y, h]);
  spy('sendCameraLookAt', (x, y, h) => ['camera-look', x, y, h]);
  spy('sendCameraReset', () => ['camera-reset']);
  spy('sendJingle', (id) => ['jingle', id]);
  spy('sendProjectile', (from, to, offset, end, id, startHeight, endHeight) => ['projectile', id, from.getX(), from.getY(), to.getX(), to.getY(), startHeight, endHeight]);
  spy('sendTypedMessage', (type, text) => ['typed', type, text]);
  spy('sendSoundEffect', (id, loops, delay) => ['sound', id, delay]);
  spy('mountSubInterface', (uid, id, type, options) => ['fade', options?.postScripts?.[0]?.args?.[1], options?.postScripts?.[0]?.args?.[3]]);
  const messages = [];
  const send = p.sendMessage.bind(p);
  p.sendMessage = (message, ...rest) => { messages.push(String(message)); return send(message, ...rest); };
  const animations = [];
  const animate = p.performAnimation.bind(p);
  p.performAnimation = (animation) => { animations.push(animation.getId()); return animate(animation); };
  const graphics = [];
  const graphic = p.performGraphic.bind(p);
  p.performGraphic = (g) => { graphics.push(g.getId?.() ?? g.id); return graphic(g); };
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p); });
  return { p, c, seen, messages, animations, graphics };
}

async function input(f, message) { await f.c.dispatch([message]); f.c.processTurnPackets(); core.TaskManager.process(); }
const text = (f) => f.p.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g, ' ');
const stage = (f) => f.p.getAttribute(STAGE_KEY);
const varbit = (f, id) => f.seen.filter(([kind, at]) => kind === 'varbit' && at === id).at(-1)?.[2];
const tick = (n = 1) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const talk = (f, npcId = core.NpcIdentifiers.AUGUSTE) => PM.emitCustomEvent('npc-dialogue:start', { player: f.p, npcId });
const menu = (f) => MultiChatboxPrompt.getPending(f.p)?.options ?? null;
async function choose(f, option) {
  const options = menu(f);
  assert.ok(options?.includes(option), `${option} in ${JSON.stringify(options)}`);
  await input(f, { type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: options.indexOf(option) + 1 });
}
async function next1(f) {
  const group = f.p.getPacketSender().getChatboxGroupId?.() ?? 231;
  const child = group === 229 ? 4 : group === 193 ? 3 : 5;
  await input(f, { type: 'dialogue_continue', widgetId: (group << 16) | child, childIndex: -1 });
}
/** Continues lines until `until` shows (or a menu, or the chat closes), ticking through a scene's pauses. */
async function continueTo(f, until, limit = 80) {
  const shown = [];
  for (let i = 0; i < limit; i++) {
    const line = text(f);
    if (until && line === until) return shown;
    if (menu(f)) return shown;
    if (!f.p.getDialogueManager().isActive()) return shown;
    if (!line) { tick(); continue; }
    shown.push(line);
    await next1(f);
  }
  return shown;
}
function useOn(f, a, b) {
  const inv = f.p.getInventory();
  UseItemPacketListener.itemOnItem(f.p, inv.getSlotForItemId(a), inv.getSlotForItemId(b));
}
const where = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];

test('the start: zep_quest 5 with the start message, then "Let me show you!" continued opens the diagram at 6', async (t) => {
  const f = actor(t);
  talk(f);
  await continueTo(f);
  await choose(f, 'Yes.');
  await continueTo(f, 'Wonderful! Let\'s get started.');
  assert.equal(stage(f), 5);
  assert.equal(varbit(f, VARBIT.QUEST), 5);
  assert.ok(f.messages.some((m) => m.startsWith("You've started a new quest:") && m.includes('Enlightened Journey')), JSON.stringify(f.messages));
  await continueTo(f, 'Let me show you!');
  assert.equal(stage(f), 5, 'not before the continue');
  await next1(f);
  assert.equal(stage(f), 6);
  assert.ok(f.seen.some(([kind, id]) => kind === 'interface' && id === BLUEPRINT), 'zep_if_balloon_blueprint opened');
  assert.equal(f.p.getPacketSender().getChatboxGroupId?.() ?? -1, -1, 'the chat closed behind it');
  assert.equal(f.p.getInterfaceId(), BLUEPRINT, 'and the diagram stays open (the playthrough saw it close)');
});

test('his explanation (zep_quest 6): either answer leads on, and its last line continued is zep_quest 10', async (t) => {
  for (const answer of ['Umm, yes. What\'s your point?', 'Err, no. I can\'t see that kind of detail.']) {
    const f = actor(t, { stage: 6 });
    talk(f);
    await continueTo(f);
    await choose(f, answer);
    const lines = await continueTo(f, "You're the adventurer, you should know! Think of logical places, like, churches; they have tons of candles.");
    assert.ok(lines.includes("Don't you see? It's the hot air! It rises, taking the ashes with it."), lines.join(' | '));
    assert.equal(stage(f), 6);
    await next1(f);
    assert.equal(stage(f), 10, answer);
  }
});

test('with the materials (zep_quest 10) "Good, you have everything!" continued is 20; without, "Failure is not an option."', async (t) => {
  const f = actor(t, { stage: 10, items: [[I.PAPYRUS, 3], [I.BALL_OF_WOOL], [I.POTATOES_10_], [I.CANDLE]] });
  talk(f);
  await continueTo(f);
  await choose(f, 'Yes.');
  await continueTo(f, 'Good, you have everything! Now, I need you to create an origami balloon.');
  await next1(f);
  assert.equal(stage(f), 20);
  const g = actor(t, { stage: 10 });
  talk(g);
  await continueTo(g);
  await choose(g, 'No.');
  assert.deepEqual(await continueTo(g), ['No.', 'Failure is not an option.']);
  assert.equal(stage(g), 10);
});

test('the origami balloon: the structure, the balloon a tick later with 35 Crafting XP, each with zep_making_balloon', async (t) => {
  const f = actor(t, { stage: 20, items: [[I.PAPYRUS, 3], [I.BALL_OF_WOOL], [I.CANDLE]] });
  useOn(f, I.BALL_OF_WOOL, I.PAPYRUS);
  assert.equal(f.p.getInventory().getAmount(I.BALLOON_STRUCTURE), 1);
  assert.ok(f.messages.includes('You create the origami balloon structure.'));
  assert.deepEqual(f.animations, [5140]);
  assert.ok(f.seen.some(([kind, id]) => kind === 'sound' && id === 3248));
  const xp = f.p.getSkillManager().getExperience(core.Skill.CRAFTING);
  useOn(f, I.CANDLE, I.BALLOON_STRUCTURE);
  assert.equal(f.p.getInventory().getAmount(I.ORIGAMI_BALLOON), 1);
  assert.equal(f.messages.includes('You create an origami balloon.'), false, 'a tick later');
  tick();
  assert.ok(f.messages.includes('You create an origami balloon.'));
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.CRAFTING) - xp, 35);
  // Talking with the structure but short of the raw materials asks first (tick 459).
  const g = actor(t, { stage: 20, items: [[I.BALLOON_STRUCTURE], [I.CANDLE], [I.PAPYRUS, 2], [I.POTATOES_10_]] });
  talk(g);
  await continueTo(g);
  await choose(g, 'I lost some items, what do I need again?');
  const lost = await continueTo(g);
  assert.equal(lost[0], 'I lost some items, what do I need again?');
  assert.ok(lost.includes('You need more papyrus and a ball of wool.'), lost.join(' | '));
});

test('"How do you make the origami balloon?" at zep_quest 20: his three lines (ticks 470-473)', async (t) => {
  const f = actor(t, { stage: 20, items: [[I.BALLOON_STRUCTURE]] });
  talk(f);
  await continueTo(f);
  await choose(f, 'How do you make the origami balloon?');
  assert.deepEqual(await continueTo(f), [
    'How do you make the origami balloon?',
    'First, use the papyrus on the ball of wool. The papyrus is folded into an origami box and the yarn will support the heat source.',
    'Next, add the unlit candle to the balloon structure. It will act as the heat source.',
    'Once you have done that let me know and we will begin our experiment.',
  ]);
});

test('Extinguish on a lit candle gives the unlit one the balloon takes (tick 2533)', async (t) => {
  const f = actor(t, { stage: 20, items: [[I.LIT_CANDLE]] });
  const slot = f.p.getInventory().getSlotForItemId(I.LIT_CANDLE);
  PM.emitItemAction({ player: f.p, interfaceId: 149, item: f.p.getInventory().getItems()[slot], itemId: I.LIT_CANDLE, slot, clickType: 1, handled: false });
  assert.equal(f.p.getInventory().getAmount(I.CANDLE), 1);
  assert.equal(f.p.getInventory().getAmount(I.LIT_CANDLE), 0);
  assert.ok(f.seen.some(([kind, , words]) => kind === 'typed' && words === 'You extinguish the candle.'));
});

test('a dye colours the balloon (10 Crafting XP); a tinderbox lets it go and it burns three ticks later', async (t) => {
  const f = actor(t, { stage: 200, items: [[I.ORIGAMI_BALLOON], [I.BLUE_DYE], [I.TINDERBOX]] });
  const xp = f.p.getSkillManager().getExperience(core.Skill.CRAFTING);
  useOn(f, I.BLUE_DYE, I.ORIGAMI_BALLOON);
  assert.equal(f.p.getInventory().getAmount(I.BLUE_BALLOON), 1);
  assert.ok(f.messages.includes('You dye the origami balloon blue.'));
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.CRAFTING) - xp, 10);
  const fm = f.p.getSkillManager().getExperience(core.Skill.FIREMAKING);
  useOn(f, I.TINDERBOX, I.BLUE_BALLOON);
  assert.equal(f.p.getInventory().getAmount(I.BLUE_BALLOON), 0);
  assert.ok(f.messages.includes('You light the origami balloon.'));
  assert.deepEqual(f.animations, [5142]);
  assert.deepEqual(f.graphics, [886]);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.FIREMAKING) - fm, 20);
  tick(3);
  const [x, y] = AUGUSTE_AT;
  assert.deepEqual(f.seen.find(([kind]) => kind === 'projectile'), ['projectile', 888, x, y - 2, x, y - 8, 0, 25]);
});

test('the first experiment: the copy, the camera, the cutscene Auguste\'s head, then zep_quest 40 back on the real map', async (t) => {
  const f = actor(t, { stage: 20, items: [[I.ORIGAMI_BALLOON]] });
  const start = where(f);
  talk(f);
  await continueTo(f, "Wonderful! I'll take that, and we'll conduct our first experiment.");
  f.seen.length = 0;
  await next1(f);
  assert.ok(f.seen.some(([kind, , to]) => kind === 'fade' && to === 0), 'fade out on the continue');
  tick(3);
  const inCopy = where(f);
  assert.notDeepEqual(inCopy, start, 'in the copy of Entrana');
  assert.ok(inCopy[0] > 6400, `an instance tile ${inCopy}`);
  assert.equal(varbit(f, VARBIT.CUTSCENE), 1);
  tick(1);
  assert.deepEqual(f.animations, [5142], 'the balloon set off');
  assert.deepEqual(f.graphics, [880], 'zep_test_balloon_setoff');
  assert.ok(f.seen.some(([kind, id]) => kind === 'jingle' && id === 116));
  tick(3);
  assert.ok(f.seen.some(([kind, id]) => kind === 'projectile' && id === 882), 'zep_test_balloon_on_fire');
  const lines = await continueTo(f, "We're doomed.");
  assert.deepEqual(lines, ['That was perfect. My hypothesis was right!', 'Did you not see the burning?', 'One more test. Then we shall proceed.', 'Burning? Fire? Hello?', 'We shall meekly go! No...no...it needs to sound grander. We shall cautiously go...']);
  assert.equal(stage(f), 20, 'not until the scene ends');
  f.seen.length = 0;
  await next1(f);
  tick(3);
  assert.equal(stage(f), 40);
  assert.equal(f.p.getInventory().getAmount(I.ORIGAMI_BALLOON), 0, 'Auguste took the balloon');
  assert.deepEqual(where(f), start, 'back where they stood');
  assert.ok(f.seen.some(([kind]) => kind === 'camera-reset'));
  assert.equal(varbit(f, VARBIT.CUTSCENE), 0);
  assert.equal(f.p.getMovementQueue().isMovementBlocked?.() ?? false, false);
});

test('the second experiment: four peasants, one shouting overhead; zep_quest 60 with the materials gone as the last line shows', async (t) => {
  const f = actor(t, { stage: 40, items: [[I.PAPYRUS, 2], [I.POTATOES_10_]] });
  const start = where(f);
  talk(f);
  await continueTo(f);
  await choose(f, 'Yes, I have them here.');
  await continueTo(f, 'Commendable. If I may have those, I will construct this experiment.');
  await next1(f);
  tick(3);
  const scene = PM.getCoreApi().World.getNpcs?.() ?? [];
  const peasants = [...scene].filter((npc) => npc && [4724, 4725, 4726, 4727].includes(npc.getId()));
  assert.equal(peasants.length, 4, 'zep_peasant_1-4');
  const shouts = [];
  const shouter = peasants.find((npc) => npc.getId() === 4724);
  const say = shouter.forceChat.bind(shouter);
  shouter.forceChat = (words) => { shouts.push(words); return say(words); };
  const lines = await continueTo(f, 'Well, that went down like a lead balloon.');
  assert.deepEqual(shouts, ['Burn, stab, burn!', 'Destroy the floating thing!', 'We are peasants against science!']);
  assert.deepEqual(lines, []);
  assert.equal(stage(f), 60);
  assert.equal(f.p.getInventory().getAmount(I.PAPYRUS), 0);
  assert.equal(f.p.getInventory().getAmount(I.POTATOES_10_), 0);
  assert.ok(f.animations.includes(2113), 'the shrug');
  await next1(f);
  tick(3);
  assert.deepEqual(where(f), start);
  assert.equal(varbit(f, VARBIT.CUTSCENE), 0);
});

test('the sapling and apples come with zep_quest 70 as "Here you go" is continued; the hand-ins set their own varbits', async (t) => {
  const f = actor(t, { stage: 60 });
  talk(f);
  await continueTo(f, 'Here you go. Now be very careful not to lose it!');
  assert.equal(f.p.getInventory().getAmount(I.AUGUSTES_SAPLING), 0);
  await next1(f);
  assert.equal(stage(f), 70);
  assert.equal(f.p.getInventory().getAmount(I.AUGUSTES_SAPLING), 1);
  assert.equal(f.p.getInventory().getAmount(I.APPLES_5_), 1);

  const g = actor(t, { stage: 70, flags: 1 << 5, items: [[I.RED_DYE], [I.YELLOW_DYE], [I.SILK, 10], [I.BOWL], [I.SANDBAG, 8]] });
  talk(g);
  await continueTo(g);
  await choose(g, 'Yes, I want to give you some items.');
  await continueTo(g);
  await choose(g, 'Dye.');
  await continueTo(g, 'Ah, wonderful, yellow dye. Thank you.');
  await next1(g);
  assert.equal(varbit(g, VARBIT.YELLOW), 1, 'zep_ydye as the yellow line is continued (tick 755)');
  assert.equal(g.p.getInventory().getAmount(I.YELLOW_DYE), 0);
  await continueTo(g, 'Red dye! Thank you.');
  await next1(g);
  assert.equal(varbit(g, VARBIT.RED), 1);
  assert.equal(varbit(g, VARBIT.BOTH), 1, 'zep_alldye with the red (tick 757)');
  await continueTo(g);
  assert.deepEqual(menu(g), ['Sandbags.', 'Silk.', 'Bowl.', 'Never mind.'], 'the item menu again, the dyes gone (tick 757)');
  for (const [option, line, id, left] of [
    ['Silk.', 'Silk for the balloon, thank you.', VARBIT.SILK, ['Sandbags.', 'Bowl.', 'Never mind.']], // tick 769
    ['Bowl.', 'Ah the bowl. This will be used to hold the fuel while it heats the air in the balloon.', VARBIT.BOWL, ['Sandbags.', 'Never mind.']], // tick 774
  ]) {
    await choose(g, option);
    await continueTo(g, line);
    await next1(g);
    assert.equal(varbit(g, id), 1, option);
    await continueTo(g);
    assert.deepEqual(menu(g), left, option);
  }
  assert.equal(stage(g), 70);
  await choose(g, 'Sandbags.');
  await continueTo(g, 'Sandbags, thank you. This will allow us to change height.');
  await next1(g);
  assert.equal(varbit(g, VARBIT.SANDBAGS), 1);
  assert.equal(stage(g), 80, 'the last of them (tick 850)');
  const last = await continueTo(g, "That's the last of it!");
  assert.equal(text(g), "That's the last of it!", `${last.join(' | ')} / menu ${JSON.stringify(menu(g))}`);
});

test("a refusal brings the item menu back too: too few sandbags (tick 765)", async (t) => {
  const f = actor(t, { stage: 70, flags: (1 << 5) | 0b11, items: [[I.SANDBAG, 3]] });
  talk(f);
  await continueTo(f);
  await choose(f, 'Yes, I want to give you some items.');
  await continueTo(f);
  await choose(f, 'Sandbags.');
  const lines = await continueTo(f);
  assert.ok(lines.includes("You don't have enough sandbags. Please bring me eight."), lines.join(' | '));
  assert.deepEqual(menu(f), ['Sandbags.', 'Silk.', 'Bowl.', 'Never mind.']);
  assert.equal(f.p.getInventory().getAmount(I.SANDBAG), 3);
});

test('an empty sack on the sand pit fills one sandbag a use, as recorded', async (t) => {
  const f = actor(t, { stage: 70, items: [[I.EMPTY_SACK], [I.EMPTY_SACK]], at: [2816, 3342, 0] });
  UseItemPacketListener.itemOnObject(f.p, 149, core.ObjectIdentifiers.SAND_PIT_2, I.EMPTY_SACK, 0, 2816, 3341);
  for (let i = 0; i < 4 && !f.p.getInventory().getAmount(I.SANDBAG); i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); tick(); }
  assert.equal(f.p.getInventory().getAmount(I.SANDBAG), 1, 'one per use');
  assert.equal(f.p.getInventory().getAmount(I.EMPTY_SACK), 1);
  assert.ok(f.seen.some(([kind, , words]) => kind === 'typed' && words === 'You fill the bag with sand.'));
  assert.deepEqual(f.animations, [5155]);
});

test('the basket scene shows the balloon (zep_multi_basket 2) and hands the camera and tabs back', async (t) => {
  const f = actor(t, { stage: 80, flags: 0b111111, items: [[I.WILLOW_BRANCH, 12]] });
  UseItemPacketListener.itemOnObject(f.p, 149, 19133, I.WILLOW_BRANCH, 0, 2806, 3355);
  for (let i = 0; i < 6 && !text(f); i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); tick(); }
  assert.equal(text(f), "Great! Let me just put it all together and we'll be ready for lift off! Speak to me again in a moment.");
  await next1(f);
  tick(2);
  assert.equal(stage(f), 90);
  assert.equal(f.p.getInventory().getAmount(I.WILLOW_BRANCH), 0);
  tick(5);
  assert.equal(varbit(f, VARBIT.BASKET), 2);
  assert.equal(varbit(f, VARBIT.CUTSCENE), 1);
  assert.deepEqual(where(f), [2808, 3354, 0]);
  tick(12);
  assert.equal(varbit(f, VARBIT.CUTSCENE), 0);
  assert.ok(f.seen.some(([kind]) => kind === 'camera-reset'));
});

test('completion: the jacket and cap, the hand-ins\' bits cleared, and the scroll as live words it', async (t) => {
  const f = actor(t, { stage: 100, flags: 0b111111, at: [2938, 3421, 0] });
  talk(f);
  await continueTo(f, 'For all your hard work, I give you this jacket and cap for future ballooning adventures.');
  await next1(f);
  tick();
  assert.equal(stage(f), 200);
  assert.equal(f.p.getInventory().getAmount(I.BOMBER_JACKET), 1);
  assert.equal(f.p.getInventory().getAmount(I.BOMBER_CAP), 1);
  for (const id of [VARBIT.RED, VARBIT.YELLOW, VARBIT.BOTH, VARBIT.SILK, VARBIT.BOWL, VARBIT.SANDBAGS]) assert.equal(varbit(f, id), 0, `varbit ${id}`);
  // Again: nothing more.
  talk(f);
  await continueTo(f);
  assert.equal(f.p.getInventory().getAmount(I.BOMBER_JACKET), 1);
});

test('after the quest: Taverley\'s menu has "What motivates you?"; on Entrana the enterprise is explained once', async (t) => {
  const f = actor(t, { stage: 200, at: [2938, 3421, 0] });
  talk(f);
  await continueTo(f);
  assert.deepEqual(menu(f), ['Yes.', 'No.', 'Could you tell me how to make an origami balloon?', 'What motivates you?']);
  await choose(f, 'What motivates you?');
  assert.deepEqual(await continueTo(f), ['What motivates you to do all of this?', 'Well...', "What we leave behind is not as important as how we've lived.", 'Wise words.', "That's what I think, anyway."]);

  const g = actor(t, { stage: 200 });
  talk(g);
  const first = await continueTo(g);
  assert.ok(first.some((line) => line.includes('It is good to see you again')), first.join(' | '));
  assert.equal(varbit(g, VARBIT.RETURN), 1, 'zep_return_check (tick 2983)');
  assert.ok(menu(g).includes('What motivates you?'));
  await choose(g, 'No.');
  await continueTo(g);
  talk(g);
  const again = await continueTo(g);
  assert.equal(again.some((line) => line.includes('It is good to see you again')), false, 'once');
});

test('Fly on Auguste before the quest is done: "You should speak to Auguste first."', async (t) => {
  const f = actor(t, { stage: 20 });
  const npc = PM.spawnNpc({ id: core.NpcIdentifiers.AUGUSTE, x: 2810, y: 3354, z: 0, wanderRadius: 0 });
  t.after(() => PM.getCoreApi().World.getRemoveNpcQueue?.()?.push?.(npc));
  const event = { player: f.p, npc, npcId: npc.getId(), option: 'Fly', clickType: 4, handled: false };
  PM.emitNpcInteraction(event);
  assert.ok(f.messages.includes('You should speak to Auguste first.'), JSON.stringify(f.messages));
});

test('older saves move to zep_quest\'s numbering once, at login', async (t) => {
  for (const [old, flags, native] of [[1, 0, 10], [2, 0, 40], [3, 0, 60], [4, 0b100000, 70], [4, 0b111111, 80], [5, 0b111111, 90], [6, 0b111111, 90], [7, 0, 100], [8, 0, 200]]) {
    const f = actor(t, { stage: old, flags });
    f.p.setAttribute(NUMBERING_KEY, 0);
    PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
    assert.equal(stage(f), native, `old ${old}`);
    PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
    assert.equal(stage(f), native, `old ${old}, twice`);
  }
});

test('the journal at zep_quest 10 is live\'s, the items struck as carried', async (t) => {
  const runtime = require('../plugins/quests/QuestRuntime');
  const quest = runtime.getRegisteredQuests().find((entry) => entry.key === 'enlightened_journey');
  const f = actor(t, { stage: 10, items: [[I.PAPYRUS, 3], [I.CANDLE]] });
  const lines = quest.buildJournal(f.p, quest);
  assert.deepEqual(lines.slice(5), [
    '<col=000080>Auguste needs the following items for his experiments:',
    '<str>3 Papyrus sheets',
    '1 Ball of wool',
    '1 Full sack of potatoes',
    '<str>1 Unlit candle',
  ]);
});

test('full inventories: no sapling without two free slots, no reward without two (the transcript\'s branches)', async (t) => {
  const f = actor(t, { stage: 60 });
  f.p.getInventory().add(new core.Item(I.COINS, 1), true);
  while (f.p.getInventory().getFreeSlots() > 1) f.p.getInventory().add(new core.Item(I.BRONZE_DAGGER, 1), true);
  talk(f);
  const lines = await continueTo(f);
  assert.ok(lines.includes("Looks like you don't have enough room in your inventory for the basket and the sapling. Come back when you do."), lines.join(' | '));
  assert.equal(stage(f), 60);
  assert.equal(f.p.getInventory().getAmount(I.AUGUSTES_SAPLING), 0);

  const g = actor(t, { stage: 100, at: [2938, 3421, 0] });
  while (g.p.getInventory().getFreeSlots() > 1) g.p.getInventory().add(new core.Item(I.BRONZE_DAGGER, 1), true);
  talk(g);
  const end = await continueTo(g);
  assert.ok(end.includes("You don't have enough space in your inventory. Speak to me again when you do."), end.join(' | '));
  assert.equal(stage(g), 100);
  assert.equal(g.p.getInventory().getAmount(I.BOMBER_JACKET), 0);
});

test('without the requirements Auguste keeps his secret and the quest does not start', async (t) => {
  const f = actor(t);
  f.p.getSkillManager().setMaxLevels(core.Skill.CRAFTING, 35, false);
  f.p.getSkillManager().setCurrentLevels(core.Skill.CRAFTING, 35, false);
  talk(f);
  const lines = await continueTo(f);
  assert.deepEqual(lines.slice(0, 3), ['Greetings!', 'What are you doing?', "Ah, it's a secret I'm afraid."]);
  assert.equal(stage(f), 0);
});

test('a lost cap is given back by Auguste; the cap and goggles combine and split (Wiki: Bomber cap)', async (t) => {
  const f = actor(t, { stage: 200, items: [[I.BOMBER_JACKET]], flags: 0 });
  f.p.setAttribute('quest.enlightened_journey.return_check', 1);
  talk(f);
  await continueTo(f);
  await choose(f, 'Could you replace some items for me?');
  const lines = await continueTo(f);
  assert.ok(lines.includes("Here's your cap. Try to keep better track of it."), lines.join(' | '));
  assert.equal(f.p.getInventory().getAmount(I.BOMBER_CAP), 1);
  assert.equal(f.p.getInventory().getAmount(I.BOMBER_JACKET), 1, 'no second jacket');

  const g = actor(t, { stage: 200, items: [[I.BOMBER_JACKET], [I.BOMBER_CAP], [I.GNOME_GOGGLES]] });
  g.p.setAttribute('quest.enlightened_journey.return_check', 1);
  talk(g);
  await continueTo(g);
  await choose(g, 'Could you combine my cap and goggles?');
  await continueTo(g);
  assert.equal(g.p.getInventory().getAmount(I.CAP_AND_GOGGLES), 1);
  assert.equal(g.p.getInventory().getAmount(I.BOMBER_CAP), 0);
  const slot = g.p.getInventory().getSlotForItemId(I.CAP_AND_GOGGLES);
  const split = core.CacheDefinitions.getItem(I.CAP_AND_GOGGLES).inventoryActions.indexOf('Split') + 1;
  PM.emitItemAction({ player: g.p, interfaceId: 149, item: g.p.getInventory().getItems()[slot], itemId: I.CAP_AND_GOGGLES, slot, clickType: split, handled: false });
  assert.equal(g.p.getInventory().getAmount(I.BOMBER_CAP), 1);
  assert.equal(g.p.getInventory().getAmount(I.GNOME_GOGGLES), 1);
});

test('a logout inside the first experiment\'s copy saves the player at its exit; nothing is taken and it plays again', async (t) => {
  const f = actor(t, { stage: 20, items: [[I.ORIGAMI_BALLOON]] });
  const start = where(f);
  talk(f);
  await continueTo(f, "Wonderful! I'll take that, and we'll conduct our first experiment.");
  await next1(f);
  tick(4);
  assert.ok(where(f)[0] > 6400, 'in the copy');
  f.p.onLogout();
  assert.deepEqual(where(f), start, 'saved where they stood');
  assert.equal(stage(f), 20);
  assert.equal(f.p.getInventory().getAmount(I.ORIGAMI_BALLOON), 1, 'the balloon kept');
  assert.equal(varbit(f, VARBIT.CUTSCENE), 0);
});

test('before the quest the origami crafts do nothing; at zep_quest 70 the branches do nothing', async (t) => {
  const f = actor(t, { items: [[I.PAPYRUS], [I.BALL_OF_WOOL]] });
  useOn(f, I.BALL_OF_WOOL, I.PAPYRUS);
  assert.equal(f.p.getInventory().getAmount(I.BALLOON_STRUCTURE), 0);
});

test('the sapling replacement: "already have one", too poor, or 30,000 coins for a new one (ticks 659, 980)', async (t) => {
  for (const [items, reply, sapling] of [
    [[[I.AUGUSTES_SAPLING]], "You already have one! Don't be greedy.", 1],
    [[], "You don't have enough money for it. You should have been more careful.", 0],
    [[[I.COINS, 30000]], 'Here you go. Now be very careful not to lose it again!', 1],
  ]) {
    const f = actor(t, { stage: 70, flags: 1 << 5, items });
    talk(f);
    await continueTo(f);
    await choose(f, 'I have lost my willow sapling. Can I buy a replacement?');
    await continueTo(f);
    await choose(f, 'Yes.');
    const lines = await continueTo(f);
    assert.ok(lines.includes(reply), lines.join(' | '));
    assert.equal(f.p.getInventory().getAmount(I.AUGUSTES_SAPLING), sapling, reply);
    if (items[0]?.[0] === I.COINS) assert.equal(f.p.getInventory().getAmount(I.COINS), 0, '30,000 taken');
  }
});

test('"What do I do again?" at zep_quest 80: the player asks, then Auguste (ticks 882, 1443)', async (t) => {
  const f = actor(t, { stage: 80, flags: 0b111111 });
  talk(f);
  const opening = await continueTo(f);
  assert.deepEqual(opening, ['You just need to build the basket and I can finish the balloon! How are you getting on with the willow?']);
  await choose(f, 'What do I do again?');
  const lines = await continueTo(f);
  assert.equal(lines[0], 'What do I do again?');
  assert.ok(lines[1].startsWith('Use the willow sapling I gave you'), lines.join(' | '));
});
