/**
 * A diary's task list, as captured opening every diary from the diary tab (259:2, one row per
 * diary): the server writes the journal scroll (741) line by line - tier headers yellow (green
 * once the tier is done), finished tasks struck through - sets pagepos (varp 334) to the line
 * count, opens the scroll as the main modal and hands script 6845 the line count. The rows'
 * second option ("Wiki") is the client's own.
 */
const { TIERS, BY_INDEX } = require("./DiaryData");
const Progress = require("./DiaryProgress");

const AREA_TASK = 259;
const TASKBOX = 2;
const JOURNAL_SCROLL = 741;
const TITLE = 2;
const FIRST_LINE = 4;
const CLOSE = 205;
const MAIN_MODAL = (161 << 16) | 16;
const PAGEPOS_VARP = 334;
const BUSY_VARBIT = 12393;
const SCRIPT_JOURNAL_RESET = 6844;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_JOURNAL_SHOW = 6845;
/** How wide OSRS wraps the journal's reminder lines (characters, close to its pixel wrap). */
const WRAP = 60;

const TIER_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard", elite: "Elite" };

function wrap(text) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > WRAP) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function journalLines(player, diary) {
  const done = Progress.doneTasks(player, diary);
  const claimed = Progress.claimedTiers(player, diary);
  const lines = [`<col=ffff00>${diary.header}`, ...diary.afterHeader];
  for (const tier of TIERS) {
    const data = diary.tiers[tier];
    lines.push(`<col=${Progress.isTierComplete(player, diary, tier) ? "00ff00" : "ffff00"}>${TIER_NAMES[tier]}`);
    lines.push(...data.journalBefore);
    for (const task of data.tasks) {
      const finished = done.has(task.key);
      task.lines.forEach((text, index) => {
        const suffix = !finished && diary.openSuffix && index === task.lines.length - 1 ? diary.openSuffix : "";
        // A wrapped line can start in its own colour ("<col=800000>Bones.)"); it keeps it.
        const prefix = finished ? "<str>" : /^<col=[0-9a-f]{6}>/.test(text) ? "" : "<col=000000>";
        lines.push(`${prefix}${text}${suffix}`);
      });
    }
    if (claimed.has(tier)) {
      for (const text of wrap(`If I ever lose my ${diary.itemNoun} I can speak to ${data.npcAt ?? diary.npcAt}.`)) lines.push(`<col=000000>${text}`);
    }
    lines.push(...data.journalAfter);
  }
  return lines;
}

function open(player, diary) {
  const lines = journalLines(player, diary);
  const sender = player.getPacketSender();
  sender.sendConfig(PAGEPOS_VARP, lines.length);
  sender.sendVarbit(BUSY_VARBIT, 1);
  sender.sendInterfaceScript(SCRIPT_JOURNAL_RESET);
  sender.sendString(`<col=800000>Achievement Diary - ${diary.name}`, (JOURNAL_SCROLL << 16) | TITLE);
  lines.forEach((line, index) => sender.sendString(line, (JOURNAL_SCROLL << 16) | (FIRST_LINE + index)));
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(JOURNAL_SCROLL);
  sender.sendSubInterface(MAIN_MODAL, JOURNAL_SCROLL, 0);
  sender.sendInterfaceScript(SCRIPT_JOURNAL_SHOW, [1, lines.length]);
}

function click(event) {
  const buttonId = Number(event.buttonId ?? 0);
  const groupId = event.groupId ?? (buttonId >> 16);
  const childId = event.childId ?? (buttonId & 0xffff);
  const { player } = event;
  if (groupId === JOURNAL_SCROLL && childId === CLOSE) {
    player.getPacketSender().sendInterfaceRemoval();
    return;
  }
  if (groupId !== AREA_TASK || childId !== TASKBOX) return;
  if (Number(event.opId ?? event.action) !== 1) return;
  const diary = BY_INDEX.get(Number(event.slot));
  if (diary) open(player, diary);
}

function closed({ player, interfaceId }) {
  if (interfaceId === JOURNAL_SCROLL) player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

module.exports = { journalLines, open, click, closed, wrap };
