/**
 * Builds plugins/quests/data/chathead-animations.json from decoded RSProx captures.
 *
 *   node scripts/chathead-animations-from-capture.js <decoded.txt>:<fromTick>-<toTick> ...
 *
 * Each argument is one quest's window in a capture. Lines naming the recording player are left
 * out (no account names in the repo, and the transcripts spell them "[player name]" anyway). A
 * speaker's line captured with two animations keeps the first and warns.
 */
const fs = require("fs");
const path = require("path");

const OUTPUT = path.join(__dirname, "..", "plugins", "quests", "data", "chathead-animations.json");
const NPC_CHAT = 231;
const PLAYER_CHAT = 217;
const PLAYER_SPEAKER = "player";

const animations = {};

function addLine(speaker, anim, text, playerName) {
  if (anim === null || !speaker) return;
  if (playerName && text.toLowerCase().includes(playerName.toLowerCase())) return;
  const lines = (animations[speaker] ??= {});
  if (lines[text] !== undefined && lines[text] !== anim) {
    console.warn(`${speaker}: "${text}" captured as ${lines[text]} and ${anim}; keeping ${lines[text]}`);
    return;
  }
  lines[text] = anim;
}

function readWindow(argument) {
  const match = /^(.*):(\d+)-(\d+)$/.exec(argument);
  if (!match) throw new Error(`Expected <decoded.txt>:<from>-<to>, got ${argument}`);
  const [, file, from, to] = match;
  const content = fs.readFileSync(file, "utf8");
  const playerName = /IfSetText\(interfaceId=217, componentId=4, text='(.*)'\)/.exec(content)?.[1];
  let box = { anim: null, speaker: null };
  for (const line of content.split(/\r?\n/)) {
    const packet = /^\[(\d+)\] <- (IfOpenSub|IfSetAnim|IfSetText)\((.*)\)$/.exec(line);
    if (!packet) continue;
    const tick = Number(packet[1]);
    if (tick < Number(from)) continue;
    if (tick > Number(to)) break;
    const [, , name, rest] = packet;
    const iface = Number(/interfaceId=(-?\d+)/.exec(rest)?.[1]);
    if (name === "IfOpenSub" && rest.includes("destinationInterfaceId=162")) box = { anim: null, speaker: null };
    if (iface !== NPC_CHAT && iface !== PLAYER_CHAT) continue;
    if (name === "IfSetAnim") box.anim = Number(/anim=(-?\d+)/.exec(rest)?.[1]);
    if (name === "IfSetText") {
      const component = Number(/componentId=(\d+)/.exec(rest)?.[1]);
      const text = /text='(.*)'$/.exec(rest)?.[1] ?? "";
      if (component === 4) box.speaker = iface === PLAYER_CHAT ? PLAYER_SPEAKER : text;
      if (component === 6) addLine(box.speaker, box.anim, text.replace(/<br>/g, " ").replace(/\s+/g, " ").trim(), playerName);
    }
  }
}

process.argv.slice(2).forEach(readWindow);
const sorted = Object.fromEntries(Object.keys(animations).sort().map((speaker) => [speaker,
  Object.fromEntries(Object.keys(animations[speaker]).sort().map((text) => [text, animations[speaker][text]]))]));
fs.writeFileSync(OUTPUT, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${Object.values(sorted).reduce((total, lines) => total + Object.keys(lines).length, 0)} lines -> ${OUTPUT}`);
