// Run after `yarn build`: node --test tests/xp-reward.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
const { Dialogue } = require("../dist/game/model/dialogues/entries/Dialogue");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { Sounds } = require("../dist/game/Sounds");
const XpReward = require("../plugins/interface/XpReward.plugin");

function createPlayer(levels = {}, attributes = {}) {
  const log = [];
  const sender = {
    sendConfig: (id, value) => { log.push(`varp ${id}=${value}`); return sender; },
    sendVarbit: (id, value) => { log.push(`varbit ${id}=${value}`); return sender; },
    sendInterface: (id) => { log.push(`open ${id}`); return sender; },
    sendInterfaceFlagsRange: (uid, from, to, flags) => { log.push(`flags ${uid >> 16}:${uid & 0xffff} ${from}-${to} ${flags}`); return sender; },
    sendString: (text, uid) => { log.push(`text ${uid >> 16}:${uid & 0xffff} ${text}`); return sender; },
    sendInterfaceRemoval: () => { log.push("close"); return sender; },
    sendTypedMessage: (type, text) => { log.push(`chat ${type} ${text}`); return sender; },
  };
  const self = {
    log,
    getPacketSender: () => sender,
    getSkillManager: () => ({ getMaxLevel: (skill) => levels[skill.getName()] ?? 99 }),
    // The box logs its own chat line as it opens, as the real one does.
    getDialogueManager: () => ({ startDialogues: (chain) => { Dialogue.sendBoxChatLine(self, chain.getDialogues().get(0)?.getText?.()); log.push("mesbox"); } }),
    getAttribute: (key) => attributes[key],
    sendMessage: (text) => log.push(`message ${text}`),
  };
  return self;
}

Sounds.sendSound = () => {};

test("as captured: busy, the xpreward modal, its 24 skill slots as pause buttons, and the title", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const player = createPlayer();
  const request = { player, onConfirm: () => null };
  XpReward._test.open(request);
  assert.deepEqual(player.log, [
    "varp 261=0",
    `varp 262=${XpReward._test.availableMask()}`,
    "varbit 12393=1",
    "open 240",
    "flags 240:0 0-23 1",
    "text 240:26 Choose the stat you wish to be advanced!",
  ]);
  assert.equal(request.opened, true);
  // Script 3809 refuses a skill whose enum 81 bit is clear in varp 262: all 24 must be set (bits 1-24).
  assert.equal(XpReward._test.availableMask(), 0x1fffffe);
});

test("a locked skill's slot is refused with script 3809's message, and the choice stays open", () => {
  const player = createPlayer();
  let chosen = null;
  XpReward._test.open({ player, onConfirm: (skill) => { chosen = skill; return "granted"; } });
  player.log.length = 0;
  XpReward._test.confirm({ player, buttonId: (240 << 16) | 0, action: 11 });
  assert.equal(chosen, null);
  assert.deepEqual(player.log, ["message You need to complete the Rune Mysteries quest to choose that option."]);
  XpReward._test.confirm({ player, buttonId: (240 << 16) | 0, action: 0 });
  assert.equal(chosen, Skill.ATTACK, "another skill can still be chosen");
});

test("as captured: the confirmed slot is enum 681's key less one (slot 11 -> Runecraft), named from enum 680", () => {
  assert.equal(XpReward._test.skillForSlot(11), Skill.RUNECRAFTING);
  assert.equal(XpReward._test.skillForSlot(0), Skill.ATTACK);
  assert.equal(XpReward._test.statName(Skill.RUNECRAFTING), "Runecraft");
  // The captured account had finished Rune Mysteries, which Runecraft needs here (script 3809).
  const player = createPlayer({}, { "quest.rune_mysteries.stage": 6 });
  const sounds = [];
  Sounds.sendSound = (_player, sound) => sounds.push(sound.getId?.() ?? sound.id);
  let chosen = null;
  XpReward._test.open({ player, onConfirm: (skill, name) => { chosen = [skill, name]; return "Your wish has been granted!<br>You have been awarded 980 Runecraft XP!"; } });
  player.log.length = 0;
  const event = { player, buttonId: (240 << 16) | 0, action: 11 };
  XpReward._test.confirm(event);
  assert.equal(event.handled, true);
  assert.deepEqual(chosen, [Skill.RUNECRAFTING, "Runecraft"]);
  // The box's text goes to chat as a message box line, its line break a space.
  assert.deepEqual(player.log, ["close", "chat 115 Your wish has been granted! You have been awarded 980 Runecraft XP!", "mesbox"]);
  assert.deepEqual(sounds, [2655]);
  player.log.length = 0;
  XpReward._test.confirm(event);
  assert.deepEqual(player.log, [], "once");
});

test("the server checks the lamp's level too; refusing or closing clears busy", () => {
  const low = createPlayer({ Runecraft: 20, Runecrafting: 20 });
  let calls = 0;
  XpReward._test.open({ player: low, minLevel: 30, onConfirm: () => { calls++; return "x"; } });
  assert.ok(low.log.includes("varp 261=30"));
  XpReward._test.confirm({ player: low, buttonId: 240 << 16, action: 11 });
  assert.equal(calls, 0);

  const refused = createPlayer();
  XpReward._test.open({ player: refused, onConfirm: () => null });
  refused.log.length = 0;
  XpReward._test.confirm({ player: refused, buttonId: 240 << 16, action: 0 });
  assert.deepEqual(refused.log, ["close", "varbit 12393=0"]);

  const walked = createPlayer();
  XpReward._test.open({ player: walked, onConfirm: () => "x" });
  walked.log.length = 0;
  XpReward._test.closed({ player: walked, interfaceId: 240 });
  assert.deepEqual(walked.log, ["varbit 12393=0"]);
});

test("a restricted combat lamp offers and accepts only its allowed skills", () => {
  const player = createPlayer();
  let chosen = null;
  const skills = [Skill.ATTACK, Skill.HITPOINTS];
  XpReward._test.open({ player, skills, minLevel: 50, onConfirm: (skill) => { chosen = skill; return null; } });
  assert.ok(player.log.includes(`varp 262=${XpReward._test.availableMask(skills)}`));
  assert.notEqual(XpReward._test.availableMask(skills), XpReward._test.availableMask());
  XpReward._test.confirm({ player, buttonId: 240 << 16, action: 11 });
  assert.equal(chosen, null, "a forged Runecraft confirmation is refused");
  XpReward._test.confirm({ player, buttonId: 240 << 16, action: 0 });
  assert.equal(chosen, Skill.ATTACK);
});
