// Run after `yarn build`: node --test tests/family-pest.test.cjs
//
// Family Pest (rev 242 miniquest row 140): the quest's conversations are played through the real
// transcript player for real Dimintheis, Avan, Caleb and Johnathon NPCs, with the real
// before-interaction hook, so the lines, menus, flags and rewards are what a player gets.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { Gamevals, GamevalKind } = require('../dist/game/cache/Gamevals');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { NpcIdentifiers } = require('../dist/util/NpcIdentifiers');
const runtime = require('../plugins/quests/QuestRuntime');
const { questRowById } = require('../plugins/quests/QuestList.QuestRuntime');

const DIMINTHEIS = NpcIdentifiers.DIMINTHEIS;
const AVAN = NpcIdentifiers.AVAN;
const CALEB = NpcIdentifiers.CALEB;
const JOHNATHON = NpcIdentifiers.JOHNATHON;
const STAGE_VARBIT = 5347;
const FLAG_VARBIT = { caleb: 5348, avan: 5349, johnathon: 5350 };
const ID_BY_NAME = { dimintheis: DIMINTHEIS, avan: AVAN, caleb: CALEB, johnathon: JOHNATHON };
const COMPLETE = 3;

let api;
let quest;
let next = 9100;

before(async () => {
  // The whole plugin set, as a real server loads it: Family Pest, Family Crest, the transcript player.
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  api = { core: PluginManager.getCoreApi() };
  api.core.RegionManager.init();
  quest = runtime.getRegisteredQuests().find((entry) => entry.name === 'Family Pest');
  assert.ok(quest, 'Family Pest registers');
});

function makePlayer(t, { stage = 0, talked = [] } = {}) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const player = new Player(null, new api.core.Location(3279, 3404, 0));
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  player.setIndex(next++);
  player.setRegistered?.(true);
  player.setAttribute('family-pest:talked', Object.fromEntries(talked.map((name) => [name, true])));
  const crest = runtime.questNamed('Family Crest');
  if (crest) crest.setStage(player, crest.completionValue ?? 11); // the quest needs Family Crest done
  quest.setStage(player, stage);
  return player;
}

function npcFor(key) {
  return api.core.NPC.create(ID_BY_NAME[key], new api.core.Location(3279, 3404, 0));
}

/** Clicks Talk-to through the real NPC dispatcher; true when the quest answered it. */
function talk(player, key) {
  const npc = npcFor(key);
  return PluginManager.emitNpcInteraction({ player, npc, npcId: npc.getId(), npcIndex: 2, clickType: 1, location: { x: 3279, y: 3404, z: 0 }, handled: false });
}

/** Plays the open conversation: picks[i] answers the i-th menu (1-based). Returns every line and every menu's options. */
function play(player, picks = []) {
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const manager = player.getDialogueManager();
  const lines = [];
  const menus = [];
  const queue = [...picks];
  for (let step = 0; step < 300; step++) {
    const pending = MultiChatboxPrompt.getPending(player);
    if (pending && !manager.isActive()) {
      menus.push(pending.options);
      const pick = queue.shift();
      if (pick === undefined) return { lines, menus, open: true };
      MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: pick });
      continue;
    }
    const current = manager.getCurrent();
    if (!current) break;
    if (typeof current.getText === 'function') lines.push(current.getText());
    manager.advance();
  }
  return { lines, menus, open: false };
}

const sender = (stage) => ({ getVarbit: (id) => (id === STAGE_VARBIT ? stage : 0), getVarp: () => 0 });

test('the quest is keyed on the cache: row 140, varbit family_quest_progress, completion 3, and the NPC ids resolve to themselves', () => {
  const row = questRowById(140, CacheDefinitions);
  assert.equal(row.displayname[0], 'Family Pest');
  assert.equal(row.startnpc[0], DIMINTHEIS);
  assert.equal(row.endstate[0], COMPLETE);
  assert.deepEqual(row.requirement_quests, [48]);
  const gamevals = new Gamevals();
  const varbits = gamevals.namesOf(GamevalKind.VARBIT);
  assert.deepEqual([5347, 5348, 5349, 5350].map((id) => varbits.get(id)), ['family_quest_progress', 'family_quest_caleb', 'family_quest_avan', 'family_quest_johnathon']);
  assert.equal(gamevals.namesOf(GamevalKind.VARP).get(1418), 'family_quest_varp');
  assert.equal(quest.varbitId, STAGE_VARBIT);
  assert.equal(quest.completionValue, COMPLETE);
  assert.equal(quest.questPoints, 0);
  // None of the handled ids is a multi-NPC parent: the server passes the resolved id to interactions.
  const ids = [NpcIdentifiers.DIMINTHEIS, NpcIdentifiers.DIMINTHEIS_2, NpcIdentifiers.AVAN, NpcIdentifiers.AVAN_2, NpcIdentifiers.MAN,
    NpcIdentifiers.CALEB, NpcIdentifiers.CALEB_2, NpcIdentifiers.JOHNATHON, NpcIdentifiers.JOHNATHON_2];
  for (const stage of [0, 1, 2, 3]) {
    for (const id of ids) assert.equal(CacheDefinitions.resolveNpc(id, sender(stage))?.id, id, `npc ${id} at stage ${stage}`);
  }
  const names = ids.map((id) => CacheDefinitions.resolveNpc(id, sender(0)).name);
  assert.deepEqual(names, ['Dimintheis', 'Dimintheis', 'Avan', 'Avan', 'Man', 'Caleb', 'Caleb', 'Johnathon', 'Johnathon']);
});

test('the quest starts at the end of the "Oh come on, however menial" conversation, and not twice', (t) => {
  const player = makePlayer(t);
  const fire = (stepId) => PluginManager.emitCustomEvent('npc-dialogue:action', { player, npcId: DIMINTHEIS, stepId, kind: 'message', text: '', handled: false });
  fire('other-step');
  assert.equal(quest.getStage(player), 0);
  fire('jjabGL');
  assert.equal(quest.getStage(player), 1);
  assert.equal(player.getPacketSender().getVarbit(STAGE_VARBIT), 1);
  quest.setStage(player, 2);
  fire('jjabGL');
  assert.equal(quest.getStage(player), 2, 'the start step cannot reset a started quest');
});

test('Dimintheis in progress: the menu is "Family Pest" and "Other", and he asks whether the sons have been seen', (t) => {
  const player = makePlayer(t, { stage: 1 });
  const handled = talk(player, 'dimintheis');
  assert.equal(handled, true);
  const { lines, menus } = play(player, [1]);
  assert.deepEqual(menus[0], ['Family Pest', 'Other']);
  assert.deepEqual(lines, ['Have you spoke to Avan, Caleb and Johnathon yet?', 'Nope, not yet!']);
});

test('each son: the quest option, the exact Wiki lines, the flag varbit, and the shorter repeat conversation', (t) => {
  const player = makePlayer(t, { stage: 1 });
  talk(player, 'avan');
  let result = play(player, [1]);
  assert.deepEqual(result.menus[0], ['Family Pest', 'Gauntlets']);
  assert.equal(result.lines[0], "Hello there Avan, I've had a bit of spare time lately, and I was wondering whether you had anything I could help you out with, like a quest or something?");
  assert.equal(result.lines.at(-2), "Very well, I'll go and see if your other brothers need anything...");
  assert.equal(result.lines.at(-1), 'The sweet smell of the great rewards that may come fades slightly.');
  assert.equal(player.getPacketSender().getVarbit(FLAG_VARBIT.avan), 1);
  assert.equal(quest.getStage(player), 1);
  talk(player, 'avan');
  result = play(player, [1]);
  assert.deepEqual(result.lines, ['Are you absolutely sure there is nothing I can help you out with?', 'Look, I really just want to get on with my life, your insistence on wanting another quest is getting annoying!']);
  talk(player, 'caleb');
  result = play(player, [1]);
  assert.equal(result.lines[1], 'You daydream briefly of what the rich family could offer you this time as a reward.');
  assert.equal(result.lines.at(-1), 'The sweet smell of the great rewards that may come fades even more.');
  assert.equal(player.getPacketSender().getVarbit(FLAG_VARBIT.caleb), 1);
  // The last son gets the "last brother" ending and moves the quest on.
  talk(player, 'johnathon');
  result = play(player, [1]);
  assert.equal(result.lines.at(-2), "I do one quest for you all and it solves all of your problems? Amazing... I'll go and tell your father how happy you all are!");
  assert.equal(result.lines.at(-1), 'The sweet smell of the great rewards that may come has almost faded completely.');
  assert.equal(quest.getStage(player), 2, 'all three sons spoken to');
  assert.equal(player.getPacketSender().getVarbit(STAGE_VARBIT), 2);
  assert.equal(player.getPacketSender().getVarbit(FLAG_VARBIT.johnathon), 1);
});

test('the order of the sons does not matter, and Dimintheis is not asked for the money before all three are seen', (t) => {
  const player = makePlayer(t, { stage: 1 });
  for (const name of ['johnathon', 'caleb', 'avan']) { talk(player, name); play(player, [1]); }
  assert.equal(quest.getStage(player), 2);
  const spoken = makePlayer(t, { stage: 1, talked: ['avan'] });
  talk(spoken, 'dimintheis');
  assert.deepEqual(play(spoken, [1]).lines, ['Have you spoke to Avan, Caleb and Johnathon yet?', 'Nope, not yet!']);
});

test('returning to Dimintheis: refusing, too few coins, then paying 500,000 coins completes the miniquest', (t) => {
  const player = makePlayer(t, { stage: 2, talked: ['avan', 'caleb', 'johnathon'] });
  player.getInventory().adds(ItemIdentifiers.COINS, 500000); // the ask is only put to a player who can pay
  talk(player, 'dimintheis');
  let result = play(player, [1, 2]); // Family Pest, then Refuse
  assert.equal(result.lines[0], 'I have been and spoken to Avan, Caleb and Johnathon and none of them need anything from me!');
  assert.equal(result.lines.at(-2), "You don't need 500,000 coins from me! I don't believe you! You can keep your rewards.");
  assert.equal(result.lines.at(-1), 'I will be here if you change your mind.');
  assert.equal(quest.getStage(player), 2);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 500000, 'refusing keeps the coins');
  // The next visit starts at the ask; without the coins he is told so.
  player.getInventory().deleteNumber(ItemIdentifiers.COINS, 500000);
  talk(player, 'dimintheis');
  result = play(player, [1]);
  assert.equal(result.lines[0], 'I need 500,000 coins. Can you help me out with that?');
  assert.equal(result.lines.at(-1), "I don't have enough coins on me.");
  assert.equal(quest.getStage(player), 2);
  player.getInventory().adds(ItemIdentifiers.COINS, 500000);
  talk(player, 'dimintheis');
  result = play(player, [1, 1]); // Family Pest, then Yes
  assert.equal(result.lines.includes('You hand over 500,000 coins to Dimintheis.'), true);
  assert.equal(result.lines.at(-2), 'Thank you very much. In appreciation, I will inform Avan, Caleb and Johnathon that you did yet another great deed for the family, and that you would find more pairs of those gauntlets useful.');
  assert.equal(result.lines.at(-1), "Well this didn't feel very heroic...");
  assert.equal(quest.getStage(player), COMPLETE);
  assert.equal(player.getPacketSender().getVarbit(STAGE_VARBIT), COMPLETE);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 0, 'the 500,000 coins are taken');
  assert.equal(player.getAttribute(runtime.QUEST_POINTS_ATTRIBUTE) ?? 0, 0, 'a miniquest: no quest point');
});

test('the "Other" and "Gauntlets" entries lead into the standard conversation', (t) => {
  const player = makePlayer(t, { stage: 1 });
  talk(player, 'avan');
  const result = play(player, [2]);
  assert.deepEqual(result.menus[0], ['Family Pest', 'Gauntlets']);
  assert.equal(result.lines[0], 'Can you change my gauntlets for me?');
  talk(player, 'dimintheis');
  const other = play(player, [2]);
  assert.deepEqual(other.menus[0], ['Family Pest', 'Other']);
  assert.ok(other.lines.length > 0, 'Dimintheis\' standard conversation plays');
});

test('once complete, each NPC plays the generated post-miniquest conversation and hands out its gauntlets', (t) => {
  const player = makePlayer(t, { stage: COMPLETE });
  const inventory = player.getInventory();
  // A first visit: the first pair is the conversation's hand-out step.
  talk(player, 'avan');
  let result = play(player);
  assert.equal(result.lines[0].startsWith('I have received word from my father that you assisted us again!'), true);
  assert.equal(result.lines.includes('Avan hands you a pair of Goldsmith gauntlets.'), true);
  assert.equal(inventory.getAmount(ItemIdentifiers.GOLDSMITH_GAUNTLETS), 1);
  talk(player, 'caleb'); play(player);
  talk(player, 'johnathon'); play(player);
  assert.equal(inventory.getAmount(ItemIdentifiers.COOKING_GAUNTLETS), 1);
  assert.equal(inventory.getAmount(ItemIdentifiers.CHAOS_GAUNTLETS), 1);
  // A repeat visit offers more, asking how many.
  let action;
  player.setEnteredAmountAction = (entered) => { action = entered; };
  const queued = [];
  t.mock.method(api.core.TaskManager, 'submit', (task) => { queued.push(task); });
  talk(player, 'avan');
  result = play(player, [1]);
  assert.deepEqual(result.menus[0], ['Could I have some more goldsmith gauntlets, please?', "You're welcome."]);
  assert.ok(!action, 'the prompt is not open before the chatbox has closed (the engine clears it)');
  queued.at(-1).execute(); // the next tick
  assert.ok(action, 'the quantity prompt opened');
  action.execute(5);
  assert.equal(inventory.getAmount(ItemIdentifiers.GOLDSMITH_GAUNTLETS), 6);
  // Dimintheis offers steel gauntlets the same way.
  talk(player, 'dimintheis');
  result = play(player);
  assert.equal(result.lines[1].includes('Those 500,000 coins have allowed us to put food on the table.'), true);
});

test('relog at every stage keeps the stage and the sons\' flags, and no stage is a dead end', (t) => {
  const expected = { 0: [0, 0, 0], 1: [0, 0, 0], 2: [1, 1, 1], 3: [1, 1, 1] };
  for (const stage of [0, 1, 2, 3]) {
    const flags = expected[stage].some(Boolean) ? ['avan', 'caleb', 'johnathon'] : [];
    const player = makePlayer(t, { stage, talked: flags });
    // the login hook of this plugin resends the stage and the flags
    PluginManager.emitPlayerLogin({ player, username: player.getUsername() || 'family_pest_tester', isNewAccount: false });
    assert.equal(player.getPacketSender().getVarbit(STAGE_VARBIT), stage, `stage ${stage}`);
    for (const [index, name] of ['caleb', 'avan', 'johnathon'].entries()) {
      assert.equal(player.getPacketSender().getVarbit(FLAG_VARBIT[name]), expected[stage][index], `${name} flag at stage ${stage}`);
    }
    // At every stage in progress the next conversation is available.
    if (stage === 1 || stage === 2) {
      assert.equal(talk(player, 'dimintheis'), true, `Dimintheis answers at stage ${stage}`);
      play(player);
    }
  }
});
