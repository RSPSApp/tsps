// Run after `yarn build`: node --test tests/mudfoots-big-adventure.test.cjs
//
// Mudfoot's Big Adventure against the rsprox capture MudfootsBigAdventure (rev 242.1; ticks in the names are its
// ticks) and the Wiki. Real Player, PlayerSession and ClientConnection, the real plugins, cache and map (the
// between-a-rock harness): talks and clicks are packets and each tick runs as World.process does.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const H = require("./between-a-rock-harness.cjs");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const { buildLines } = require("../plugins/quests/mudfoot/Journal.MudfootsBigAdventure");

const STAGE_VARBIT = 16779;
const VIS_VARBIT = 16782;
const LAMPS_VARBIT = 16789;
const CUTSCENE_STATUS = 542;
const NPC = {
  HARLAN: 16821, HOUSE: 16823, WINDMILL: 16824, FOLLOWER: 16827, FOLLOWER_SPEAR: 16828, STORE: 16833, WINDMILL_RANGER: 16834,
  RANGER_COMBAT: 16837, SPEAR_COMBAT: 16831, WARRIOR_GRAVEYARD: 16841, WARRIOR_COMBAT: 16843,
};
const VIS_ATTRIBUTE = "mudfoots-big-adventure:mudfoot-vis";
const SCHEME_ATTRIBUTE = "mudfoots-big-adventure:stage-scheme";
const LUMBRIDGE = [[3220, 3240], [3249, 3249], [3166, 3288], [3172, 3241], [3244, 3197]];

let core;
let OptionDialogue;
const quest = () => QuestRuntime.questNamed("Mudfoot's Big Adventure");

before(async () => {
  core = await H.boot();
  OptionDialogue = core.OptionDialogue;
  for (const [x, y] of LUMBRIDGE) core.RegionManager.loadMapFiles(x, y);
});
after(H.shutdown);

/** A player at a stage, saved state as live would hold it, then logged in as the quest sees a login. */
function at(t, tile, { stage = 0, vis = 0, items = [] } = {}) {
  const f = H.actor(t, { at: tile, items });
  f.player.setAttribute(SCHEME_ATTRIBUTE, 2);
  if (stage) quest().setStage(f.player, stage);
  f.player.setAttribute(VIS_ATTRIBUTE, vis);
  H.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  return f;
}

const owned = (f, id) => [...core.World.getNpcs()].filter((npc) => npc?.getOwner?.() === f.player && npc.getId() === id && npc.isRegistered());
const one = (f, id) => { const found = owned(f, id); assert.equal(found.length, 1, `one owned ${id}`); return found[0]; };
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const harlanAt = (f, tile = [3219, 3240, 0]) => H.spawn(f, NPC.HARLAN, tile);

/** The chatbox: a line, a box or an option menu. */
function shown(f) {
  const current = f.player.getDialogueManager().getCurrent?.();
  if (current instanceof OptionDialogue) return { who: "menu", title: current.getTitle(), options: current.getOptions(), text: current.getOptions().join(" | ") };
  return H.shown(f);
}

async function choose(f, text) {
  const menu = shown(f);
  assert.equal(menu?.who, "menu", `a menu shows, not ${JSON.stringify(menu)}`);
  const index = menu.options.findIndex((option) => option === text);
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(menu.options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: OptionDialogue.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  H.tick(f);
}

async function next(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  const child = [231, 217].includes(group) ? 5 : group === 229 ? 4 : group === 11 ? 4 : 0;
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | child, childIndex: -1 }]);
  H.tick(f);
}

/** Continues (or waits a tick) until `text` shows; returns the tick. */
async function until(f, text, limit = 200) {
  for (let i = 0; i < limit; i++) {
    const line = shown(f);
    if (line && (line.text === text || line.text?.startsWith?.(text) || line.title === text)) return f.tick;
    if (line && line.who !== "menu" && f.player.getPacketSender().getChatboxGroupId() > 0 && !isHeld(f)) await next(f);
    else H.tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-5))}`);
}

/** A held box (the scenes' fades) cannot be continued. */
const isHeld = (f) => f.player.getDialogueManager().getCurrent?.()?.isSelfAdvancing?.() === true;

async function talkTo(f, npc, clickType = 1) {
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType }]);
  for (let i = 0; i < 20 && !shown(f); i++) H.tick(f);
}

function inCopy(f) {
  return f.player.getLocation().getX() > 6400;
}

test("the quest is keyed on the cache: row 218, mba, live's stage values, the base NPCs and their own drop tables", () => {
  const { questRowById } = require("../plugins/quests/QuestList.QuestRuntime");
  const row = questRowById(218, core.CacheDefinitions);
  assert.equal(row.displayname[0], "Mudfoot's Big Adventure");
  assert.equal(row.endstate[0], 32);
  assert.equal(quest().varbitId, STAGE_VARBIT);
  assert.equal(quest().startedValue, 2);
  assert.equal(quest().completionValue, 32);
  const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
  const gamevals = new Gamevals();
  const varbits = gamevals.namesOf(GamevalKind.VARBIT);
  assert.deepEqual([STAGE_VARBIT, VIS_VARBIT, 16788, LAMPS_VARBIT].map((id) => varbits.get(id)),
    ["mba", "mba_mudfoot_vis", "mudfoot_first_thief_dialogue", "mba_lamps"]);
  const npcs = gamevals.namesOf(GamevalKind.NPC);
  assert.deepEqual([NPC.HOUSE, NPC.WINDMILL, NPC.FOLLOWER, NPC.FOLLOWER_SPEAR, NPC.STORE, NPC.RANGER_COMBAT].map((id) => npcs.get(id)),
    ["mba_mudfoot_ruined_building", "mba_mudfoot_windmill", "mba_mudfoot_follower", "mba_mudfoot_follower_spear",
      "mba_outlaw_ranged_general_store", "mba_outlaw_ranged_combat"]);
  // The generated tables give each outlaw its own kit (osrsreboxed-db: Multi Infobox dropversions split).
  const drops = require("../data/definitions/npc-drops.json");
  const items = (id) => drops.tables[drops.npcs[String(id)].tables[0]].entries.map((entry) => [entry.item_id, entry.quantity[0]]);
  assert.deepEqual(items(16837), [[526, 1], [841, 1], [882, 80]]);
  assert.deepEqual(items(16840), [[526, 1], [1379, 1], [556, 80], [558, 80]]);
  assert.deepEqual(items(16843), [[526, 1], [1191, 1], [1323, 1]]);
});

test("Harlan starts it: 2 on Yes. and 4 on his Good luck, with Mudfoot at his house [18-138]", async (t) => {
  const f = at(t, [3218, 3239, 0]);
  const harlan = harlanAt(f);
  await talkTo(f, harlan);
  assert.equal(shown(f).text, "Greetings, adventurer. Captain Harlan, leader of the Lumbridge Guard, at your service. Is there anything I can do for you?");
  assert.equal(varbit(f, 16780), 1, "captain_harlan_intro");
  await next(f);
  assert.deepEqual(shown(f).options, ["Do you need help with anything?", "If you lead the Lumbridge Guard, where are the other guards?",
    "About that cape you're wearing...", "I'd better be off."]);
  await choose(f, "Do you need help with anything?");
  await until(f, "Start the Mudfoot's Big Adventure quest?");
  assert.equal(shown(f).title, "Start the Mudfoot's Big Adventure quest?");
  await choose(f, "Yes.");
  assert.equal(quest().getStage(f.player), 2);
  assert.ok(f.messages.some((message) => message.text.startsWith("You've started a new quest: ")));
  await until(f, "Good luck, adventurer.");
  assert.equal(quest().getStage(f.player), 4);
  assert.equal(varbit(f, VIS_VARBIT), 1);
  const mudfoot = one(f, NPC.HOUSE);
  assert.deepEqual(H.xy(mudfoot.getLocation()), [3246, 3250, 0]);
  assert.equal(mudfoot.getCurrentDefinition(f.player).getName(), "Mudfoot", "the cache shows him at vis 1");
});

test("his menu comes back without the option just picked; the cape below 99 Defence [26-44]", async (t) => {
  const f = at(t, [3218, 3239, 0]);
  const harlan = harlanAt(f);
  await talkTo(f, harlan);
  await next(f);
  await choose(f, "About that cape you're wearing...");
  await until(f, "Ah, yes. This cape is a symbol of achievement.");
  await until(f, "You need to have fully mastered the Defence skill");
  assert.equal(f.player.getDialogueManager().getCurrent().getItemId(), core.ItemIdentifiers.DEFENCE_CAPE, "the Defence cape in the box");
  await next(f);
  assert.deepEqual(shown(f).options, ["Do you need help with anything?", "If you lead the Lumbridge Guard, where are the other guards?", "I'd better be off."]);
});

test("at his house he walks up and swings at a player who stops near; he follows from 'Okay. Me behind you.' [189-290]", async (t) => {
  const f = at(t, [3252, 3248, 0], { stage: 4, vis: 1 });
  await until(f, "Die, human, die!", 40);
  const house = one(f, NPC.HOUSE);
  assert.ok(house.getLocation().getDistance(f.player.getLocation()) <= 1, "he came up to the player");
  assert.ok(f.animations.some((entry) => entry.id === f.player.getBlockAnim()), "the player blocks his swing");
  assert.ok(H.callsNamed(f, "sendString").some((call) => call.args[0] === "Mudfoot" && call.args[1] === ((231 << 16) | 4)),
    "his chat says Mudfoot, though the base NPC has no name [195]");
  await until(f, "That sounds... wonderful. Where do we begin?");
  assert.equal(quest().getStage(f.player), 6);
  await until(f, "Other goblins see three humans who dump robbed stuff.");
  assert.equal(varbit(f, 16788), 1, "mudfoot_first_thief_dialogue");
  await until(f, "Okay. Me behind you.");
  assert.equal(varbit(f, VIS_VARBIT), 2);
  const follower = one(f, NPC.FOLLOWER);
  assert.equal(follower.getFollowing(), f.player);
  assert.equal(owned(f, NPC.HOUSE).length, 0);
  assert.equal(owned(f, NPC.STORE).length, 1, "the ranger waits outside the store at 6");
});

test("Mudfoot will not follow while a pet is out (Wiki)", async (t) => {
  const f = at(t, [3252, 3248, 0], { stage: 6, vis: 1 });
  f.player.setAttribute("pets:current", { isRegistered: () => true });
  await talkTo(f, one(f, NPC.HOUSE));
  await until(f, "You pick up follower first. Me no follow you otherwise.");
  await next(f);
  assert.equal(varbit(f, VIS_VARBIT), 1);
  assert.equal(owned(f, NPC.FOLLOWER).length, 0);
});

test("the store Confront is a cutscene in a copy; back at Harlan's post, 8, and his talk ends in Mudfoot departing to 10 [381-588]", async (t) => {
  const f = at(t, [3219, 3244, 0], { stage: 6, vis: 2 });
  harlanAt(f, [3219, 3238, 0]);
  const outlaw = one(f, NPC.STORE);
  await talkTo(f, outlaw);
  await until(f, "Er... What is this?", 30);
  assert.ok(inCopy(f), "the scene plays in an instance");
  assert.equal(varbit(f, CUTSCENE_STATUS), 1);
  assert.ok(H.callsNamed(f, "sendCameraMoveTo").length > 0, "the scene's camera");
  await until(f, "Me no understand. Why no work?");
  await until(f, "A goblin? Is this the one responsible for the robbery, adventurer?");
  await until(f, "I see... In that case, come. Let us discuss this further.");
  await until(f, "Right, regarding these thieves...", 40);
  assert.equal(quest().getStage(f.player), 8);
  assert.ok(!inCopy(f));
  assert.deepEqual(H.xy(f.player.getLocation()), [3218, 3238, 0]);
  assert.equal(varbit(f, CUTSCENE_STATUS), 0);
  assert.equal(one(f, NPC.FOLLOWER).getFollowing(), f.player);
  await until(f, "Okay, time to go now.");
  await next(f);
  await until(f, "It seems you know what you need to do next. Good luck, adventurer.", 20);
  assert.equal(quest().getStage(f.player), 10);
  assert.equal(varbit(f, VIS_VARBIT), 3);
  assert.equal(owned(f, NPC.FOLLOWER).length, 0);
  assert.equal(owned(f, NPC.WINDMILL).length, 1, "he waits at the windmill");
  await next(f);
  assert.deepEqual(shown(f).options, ["Could you run me through combat basics again?", "Could I have a weapon for stabbing?", "Thanks. I'd best get going."]);
  await choose(f, "Could you run me through combat basics again?");
  await until(f, "Different pieces of equipment have different stats");
  assert.ok(H.callsNamed(f, "sendChatboxInterface").some((call) => call.args[0] === 633), "the graphic box");
  await until(f, "Select an option");
  assert.deepEqual(shown(f).options, ["Could I have a weapon for stabbing?", "Thanks. I'd best get going."], "the lesson's option goes [617]");
  await choose(f, "Could I have a weapon for stabbing?");
  await until(f, "Captain Harlan gives you a bronze shortsword and a wooden shield.");
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BRONZE_SHORTSWORD), 1);
  assert.equal(varbit(f, 16784), 1, "captain_harlan_bonus_melee_giveaway");
});

test("kits: each style's first is a bonus the 30-minute wait does not hold back; then the wait refuses all [1382-1422]", async (t) => {
  const f = at(t, [3218, 3239, 0], { stage: 32 });
  const harlan = harlanAt(f);
  await talkTo(f, harlan);
  await next(f);
  assert.deepEqual(shown(f).options, ["If you lead the Lumbridge Guard, where are the other guards?", "Could you give me some combat advice?",
    "Do you have any weapons I could have?", "About that cape you're wearing...", "I'd better be off."]);
  await choose(f, "Do you have any weapons I could have?");
  await until(f, "Yes, I do have quite a few spare things.");
  await next(f);
  await choose(f, "Could I have a shortsword and a shield?");
  await until(f, "Now, is there anything else you need?");
  await next(f);
  assert.deepEqual(shown(f).options, ["Could I have a shortbow and some arrows?", "Could I have a staff and some runes?", "Let's talk about something else."]);
  await choose(f, "Could I have a shortbow and some arrows?");
  await until(f, "Captain Harlan gives you a shortbow and 40 bronze arrows.");
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BRONZE_ARROW), 40);
  await until(f, "Now, is there anything else you need?");
  await next(f);
  assert.deepEqual(shown(f).options, ["Could I have a shortsword and a shield?", "Could I have a staff and some runes?", "Let's talk about something else."]);
  await choose(f, "Could I have a shortsword and a shield?");
  await until(f, "I've already given you some items recently. I only have so many available, so I can't go overboard. You'll have to come back in 30 minutes.");
  await next(f);
  await choose(f, "Could I have a staff and some runes?");
  await until(f, "Captain Harlan gives you a staff, 40 mind runes and 40 air runes.");
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.MIND_RUNE), 40);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE), 40);
  await until(f, "Now, is there anything else you need?");
  await next(f);
  assert.deepEqual(shown(f).options, ["If you lead the Lumbridge Guard, where are the other guards?", "Could you give me some combat advice?",
    "About that cape you're wearing...", "I'd better be off."], "nothing more to give: his main menu [1401]");
  await choose(f, "I'd better be off.");
  await until(f, "Until next time, adventurer.");
  await next(f);
  await talkTo(f, harlan);
  await next(f);
  await choose(f, "Do you have any weapons I could have?");
  await until(f, "I do have quite a few spare things, but I've already given you some recently.");
});

test("the windmill fight: a copy two ticks after his line; the kill leaves the loot on the real tile and him beside the player [718-791]", async (t) => {
  const f = at(t, [3173, 3285, 0], { stage: 10, vis: 3 });
  await talkTo(f, one(f, NPC.WINDMILL));
  assert.equal(shown(f).text, "Look. Nasty human over there. Kill time now.");
  await next(f);
  H.ticks(f, 2);
  assert.equal(quest().getStage(f.player), 12);
  assert.ok(inCopy(f));
  const ranger = one(f, NPC.RANGER_COMBAT);
  one(f, NPC.SPEAR_COMBAT);
  H.ticks(f, 6);
  ranger.setHitpoints(0);
  H.ticks(f, 2);
  assert.equal(quest().getStage(f.player), 14);
  assert.ok(!inCopy(f));
  assert.equal(varbit(f, VIS_VARBIT), 2);
  assert.equal(one(f, NPC.FOLLOWER_SPEAR).getFollowing(), f.player);
  const loot = core.World.getItems().filter((item) => item.getOwner?.() === f.player.getUsername()
    && item.getPosition().getX() === 3166 && item.getPosition().getY() === 3288).map((item) => [item.getItem().getId(), item.getItem().getAmount()]);
  assert.deepEqual(loot.sort((a, b) => a[0] - b[0]), [[526, 1], [841, 1], [882, 80]]);
  await until(f, "Right, that's the first one of those outlaws dealt with.", 20);
  await until(f, "So directly south of here. In that case, shall we get going?");
  assert.equal(quest().getStage(f.player), 16);
});

test("the warrior prays Protect from Melee four ticks after his first hit, with 'My faith protects me!' [1163-1167]", async (t) => {
  const f = at(t, [3239, 3200, 0], { stage: 22, vis: 2 });
  await talkTo(f, one(f, NPC.WARRIOR_GRAVEYARD));
  H.ticks(f, 3);
  assert.equal(quest().getStage(f.player), 24);
  const warrior = one(f, NPC.WARRIOR_COMBAT);
  const said = [];
  const force = warrior.forceChat.bind(warrior);
  warrior.forceChat = (text) => { said.push(text); return force(text); };
  const hit = (type) => {
    const parts = [new core.HitDamage(3, core.HitMask.RED)];
    return { getAttacker: () => f.player, getCombatType: () => type, getHits: () => parts, updateTotalDamage() {}, parts };
  };
  H.PM.emitNpcHitModify(warrior, hit(core.CombatType.MAGIC));
  H.ticks(f, 4);
  assert.deepEqual(said, ["My faith protects me!"]);
  assert.equal(warrior.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MELEE], true);
  const melee = hit(core.CombatType.MELEE);
  H.PM.emitNpcHitModify(warrior, melee);
  assert.equal(melee.parts[0].getDamage(), 0, "melee is blocked");
  const magic = hit(core.CombatType.MAGIC);
  H.PM.emitNpcHitModify(warrior, magic);
  assert.equal(magic.parts[0].getDamage(), 3, "magic is not");
});

test("the report: Mudfoot departs (30) and Harlan pays four lamps and 500 coins at 32 [1262-1332]", async (t) => {
  const f = at(t, [3218, 3239, 0], { stage: 28, vis: 2 });
  const harlan = harlanAt(f);
  await talkTo(f, harlan);
  await next(f);
  await choose(f, "All of those thieves have been dealt with.");
  await until(f, "See you around, Mudfoot.");
  await next(f);
  await until(f, "Right then... Thanks for all of your help with those thieves, adventurer.", 20);
  assert.equal(quest().getStage(f.player), 30);
  assert.equal(varbit(f, VIS_VARBIT), 0);
  assert.equal(owned(f, NPC.FOLLOWER_SPEAR).length, 0);
  await next(f);
  assert.equal(quest().getStage(f.player), 32);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.ANTIQUE_LAMP_44), 4);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 500);
  assert.ok(H.callsNamed(f, "sendJingle").some((call) => call.args[0] === 154), "quest complete 3");
});

test("a lamp: the chat menu, 500 experience, mba_lamps and the wish box [1484-1490]", async (t) => {
  const f = at(t, [3218, 3239, 0], { stage: 32, items: [core.ItemIdentifiers.ANTIQUE_LAMP_44] });
  await H.itemOption(f, core.ItemIdentifiers.ANTIQUE_LAMP_44, "Rub");
  assert.equal(shown(f).title, "Choose the skill you wish to gain XP in.");
  assert.deepEqual(shown(f).options, ["Attack.", "Strength.", "Defence.", "Ranged.", "More options..."]);
  const before = f.player.getSkillManager().getExperience(core.Skill.STRENGTH);
  await choose(f, "Strength.");
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.STRENGTH) - before, 500);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.ANTIQUE_LAMP_44), 0);
  assert.equal(varbit(f, LAMPS_VARBIT), 1);
  assert.ok(H.callsNamed(f, "sendSound").some((call) => call.args[0] === 2655));
  assert.equal(shown(f).text, "<col=0000ff>Your wish has been granted!</col><br>You have been awarded 500 Strength experience!");
});

test("the journal matches the capture at stages 6 and 16 [325, 845]", () => {
  assert.deepEqual(buildLines(6), [
    "<str>I spoke with Captain Harlan north of Lumbridge Castle. He told",
    "<str>me about a bounty for some Thieves who robbed the General",
    "<str>Store. According to him, some Goblins east of the River Lum in",
    "<str>Lumbridge were the prime suspects.",
    "<col=000080>I went to investigate the <col=800000>Goblins<col=000080> east of the <col=800000>River Lum<col=000080> in",
    "<col=000080><col=800000>Lumbridge<col=000080>, and encountered one named <col=800000>Mudfoot<col=000080>. He revealed",
    "<col=000080>that the <col=800000>Goblins<col=000080> weren't responsible, and had instead been",
    "<col=000080>set up by some <col=800000>Humans<col=000080>. We decided to work together to bring",
    "<col=000080>them to justice. According to <col=800000>Mudfoot<col=000080>, we can find the first",
    "<col=000080>one near the <col=800000>General Store<col=000080>.",
  ]);
  const sixteen = buildLines(16);
  assert.equal(sixteen.length, 25);
  assert.equal(sixteen[8], "<str>them to justice.");
  assert.equal(sixteen[17], "<col=800000>Mudfoot<col=000080> and I found the first <col=800000>Thief<col=000080> again near the <col=800000>Windmill<col=000080>");
  assert.equal(sixteen[20], "<col=800000>Building<col=000080> south of the <col=800000>Windmill<col=000080>, and that she was using <col=800000>Magic<col=000080>.");
});

test("a save from the first version moves to live's stages at login", (t) => {
  const f = H.actor(t, { at: [3218, 3239, 0] });
  quest().setStage(f.player, 16); // the first version's mage fight
  H.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.equal(quest().getStage(f.player), 18);
  assert.equal(f.player.getAttribute(VIS_ATTRIBUTE), 3, "Mudfoot waits at the windmill, as a left fight leaves him");
  assert.equal(f.player.getAttribute(SCHEME_ATTRIBUTE), 2);
  H.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.equal(quest().getStage(f.player), 18, "moved once");
});
