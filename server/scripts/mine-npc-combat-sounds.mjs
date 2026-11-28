// Builds data/definitions/npc-combat-sounds.json from the rsprox.net captures
// (https://rsprox.net/database). It imports a .ts file, so it needs Node 22.18 or later (type stripping on by
// default); on 22.6-22.17 run it as `node --experimental-strip-types scripts/mine-npc-combat-sounds.mjs`.
//
// INPUT FORMATS. Either the text RSProx's own decoder, the
// `net.rsprox.proxy.cli.BinaryToStringCommandKt` class in the RSProx launcher repository, writes for a
// `.bin` recording: one file per recording, packet lines of the form `[tick] <- PacketName(fields)`:
//   [176] <- SynthSound(id=2811, loops=1, delay=20)
//   [176] <- NpcInfo(updates={904=Active(x=3431, ..., extendedInfo=[SequenceExtendedInfo(id=1517, delay=0)])})
// To get them, run that class over the `.bin` files from the database (java -cp "*"
// net.rsprox.proxy.cli.BinaryToStringCommandKt -name=<recording>, from the launcher's repository folder,
// with user.home pointing at a folder that holds the recording), then:
//
//   rg -N --with-filename --glob "*.txt" "^\[[0-9]+\] <- (NpcInfo|SynthSound)" <decoded dir> \
//     | node scripts/mine-npc-combat-sounds.mjs --out data/definitions/npc-combat-sounds.json
//
// It also reads the transcripts RSProx's TranscribeCommandKt writes (the `rsprox_transcripts/<rev>/<rec>.txt`
// files of rsprox_index.py in osrs-captures), where every NPC line names its id and every animation its gameval:
//   [322]
//       [synth_sound] id=dark_beast_attack (389), delay=20
//       [npc_info_small_v5]
//           [walk] npc=(index=26936, id=mourning_dark_beast (4005), coord=(3227, 12394, 0)), ...
//               [sequence] id=dark_beast_update_attack (2731)
//               [hit] id=16, value=4, limit=8
// Feed it every tick header, packet header, NPC line and NPC sequence/hit line:
//
//   rg -N --with-filename --glob "*.txt" "^(\[[0-9]+\]$| {4}\[| {8}\[[a-z_]+\] npc=| {12}\[(sequence|hit)\] )" \
//     <rsprox_transcripts dir> | node scripts/mine-npc-combat-sounds.mjs --out data/definitions/npc-combat-sounds.json
//
// `--out` writes the file only once the run is checked. The run is refused (exit 1, the file left as it
// is) if it read no NpcInfo or no SynthSound lines, or built no NPCs: a plain `>` redirect would empty
// the table when the input is in another format.
//
// Live sends an NPC's combat sounds as private synths (SynthSound) to the player in the fight, in
// the same tick as the NPC's own update: a hit sound when the NPC is hit, an attack sound when it
// plays an attack animation, a death sound when it plays its death animation. The packet names no
// NPC, so a sound is tied to an NPC id by how reliably it shows up in that NPC's ticks:
//   - a tick counts for "hit" when the NPC took a hitsplat and played no attack animation, for
//     "attack" when it played an attack animation and took no hitsplat, for "death" when it played
//     its death animation (animations are classed by a gameval name that says attack or death first, with
//     NpcDefinitionLoader's rule: `dark_beast_update_attack` is an attack; then by
//     npc-captured-animations.json. The BinaryToString text names no animation, so there only the captured
//     classes count);
//   - a sound is kept for an NPC when it is in at least MIN_SHARE of that NPC's ticks of the kind,
//     at least MIN_TICKS times;
//   - a sound is NPC-specific only if the NPCs it was kept for account for at least
//     MIN_SPECIFIC of every tick it was sent in (counting each of their ticks of the event, also those
//     that mixed an attack with a hit): that drops weapon swings, armour and voices that
//     happen to ride along with whatever the player was fighting.
// A sound's delay is its most common delay in the captures.
//   - a sound the server already plays somewhere else (a boss plugin, Sound.ts, another data file) is
//     left out, so it is never sent twice; only code counts (digits in comments and strings don't), and the
//     quest plugins don't, as their scenes play sounds for scripted actors outside combat. SCOPED_SOUNDS
//     narrows a plugin's sound to the NPCs it plays it for.
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { animationRoleByName } from "../src/main/typescript/elvarg/game/definition/CombatAnimationRoles.ts";

const MIN_TICKS_OF_KIND = 12;
const MIN_CO = 8;
const MIN_SHARE = 0.6;
const MIN_SPECIFIC = 0.3;
// A variant no capture shows fighting sounds as the same monster that one does (variant -> that id): the
// Wilderness Slayer Cave's abyssal demon (11239) and jelly (11241), only ever recorded walking past or not at all.
const SOUNDS_AS = new Map([[11239, 415], [11241, 437]]);

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The text of a JS/TS file with every digit inside a comment or string literal blanked, so a capture note
 * ("ticks 154, 389") or a line of dialogue ("1,500 coins") next to the word "sound" is no sound id. Words
 * stay, so a quoted key (`"sound": 433`) still names its sound.
 */
function codeDigitsOnly(text) {
    const out = text.split("");
    let state = null; // null (code), "//", "/*", or the quote that opened a string
    for (let i = 0; i < out.length; i++) {
        const c = text[i];
        if (state === null) {
            if (c === "/" && text[i + 1] === "/") { state = "//"; i++; }
            else if (c === "/" && text[i + 1] === "*") { state = "/*"; i++; }
            else if (c === "'" || c === '"' || c === "`") state = c;
            continue;
        }
        if (state === "//" ? c === "\n" : state === "/*" ? c === "*" && text[i + 1] === "/"
            : c === state || (c === "\n" && state !== "`")) {
            if (state === "/*") i++;
            state = null;
            continue;
        }
        if (c === "\\" && state !== "//" && state !== "/*") { i++; continue; }
        if (c >= "0" && c <= "9") out[i] = " ";
    }
    return out.join("");
}

/** Quest plugins play their sounds in scenes for scripted actors, not through the combat hooks this table feeds. */
const QUESTS = path.join(here, "..", "plugins", "quests");
const skipDir = (dir, name) => name === "node_modules" || name === "dist" || path.join(dir, name) === QUESTS;

/**
 * Sound ids the server already sends: any number in the code of a `sound` statement, outside
 * data/definitions and the quest plugins (a Watchtower cutscene playing the dragon hit sound 410 is no
 * reason for every dragon to fight in silence).
 */
function knownSounds() {
    const known = new Set();
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) { if (!skipDir(dir, entry.name)) walk(file); continue; }
            if (!/\.(js|ts)$/.test(entry.name)) continue;
            const text = codeDigitsOnly(fs.readFileSync(file, "utf8"));
            for (const m of text.matchAll(/sound/gi)) {
                let end = m.index;
                let depth = 0;
                for (; end < Math.min(text.length, m.index + 600); end++) {
                    const c = text[end];
                    // Brackets of every kind: `HIT_SOUND = Object.freeze({\n  mirrorback: [4020, 9],` spans lines.
                    if (c === "[" || c === "{" || c === "(") depth++;
                    else if (c === "]" || c === "}" || c === ")") depth--;
                    else if ((c === "\n" || c === ";") && depth <= 0) break;
                }
                for (const n of text.slice(m.index, end).matchAll(/(?<![\w.])(\d{1,5})(?![\w.])/g)) known.add(Number(n[1]));
            }
        }
    };
    for (const dir of ["src", "plugins"]) walk(path.join(here, "..", dir));
    // JSON data beside the plugins: numbers under any key containing "sound".
    const json = (value, inSound) => {
        if (Array.isArray(value)) value.forEach((v) => json(v, inSound));
        else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) json(v, inSound || /sound/i.test(k));
        else if (typeof value === "number" && inSound) known.add(value);
    };
    const walkJson = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) { if (!skipDir(dir, entry.name)) walkJson(file); continue; }
            if (entry.name.endsWith(".json")) { try { json(JSON.parse(fs.readFileSync(file, "utf8")), false); } catch { /* not data */ } }
        }
    };
    walkJson(path.join(here, "..", "plugins"));
    return known;
}
const known = knownSounds();
/**
 * Sounds a plugin plays for some NPCs only: left out for those, kept for every other NPC that makes them.
 * An empty list is a send tied to no NPC's own hit, attack or death (a projectile landing, a cloud fading).
 */
const SCOPED_SOUNDS = new Map([
    [4020, [13671]], // the Araxxor Mirrorback's hit (bosses/araxxor); Nylocas and other araxytes keep it
    [3403, [8059, 8061]], // Vorkath's ranged shot landing (bosses/vorkath); Jal-Ak keeps its attack
    [795, []], [796, []], // Zulrah's toxic cloud fading (bosses/zulrah)
]);
const isKnown = (sound, npc) => known.has(sound) && (SCOPED_SOUNDS.get(sound)?.includes(npc) ?? true);
const captured = JSON.parse(fs.readFileSync(path.join(here, "../data/definitions/npc-captured-animations.json"), "utf8")).npcs;
const animKind = new Map();
for (const [id, npc] of Object.entries(captured)) {
    const kinds = new Map();
    for (const [anim, v] of Object.entries(npc.seen ?? {})) {
        const best = Math.max(v[0], v[1], v[2]);
        if (best < 2) continue;
        kinds.set(Number(anim), v[0] === best ? "death" : v[2] === best ? "attack" : "block");
    }
    animKind.set(Number(id), kinds);
}

/**
 * "attack", "death" or null for an animation an NPC played. A gameval name that says attack or death comes
 * first (`dog_update_wolf_attack` is an attack, though a dire wolf's few captured sightings class it a
 * block), then the captured class: a name that only says block doesn't overrule it (`scarab_parry` is the
 * scarab swarm's death, 23 captured sightings).
 */
function animationKind(npc, anim, name) {
    const named = animationRoleByName(name ?? null);
    const role = named === "attack" || named === "death" ? named : animKind.get(npc)?.get(anim) ?? null;
    return role === "attack" || role === "death" ? role : null;
}

const inc = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const co = new Map(); // `${sound}|${kind}:${npc}` -> ticks
const soundTicks = new Map();
const kindTicks = new Map(); // `${kind}:${npc}` -> ticks
const delays = new Map(); // `${sound}|${delay}` -> count
let file = null;
let index = new Map();
let tick = null;
let sounds = new Set();
let kinds = new Set();
let tickNpcs = new Map(); // transcript input: npc id -> { attack, death, hit } this tick
let block = null; // transcript input: the packet the current indented lines belong to
let transcriptNpc = null; // transcript input: the NPC the current extended-info lines belong to
let transcriptIndex = null; // transcript input: that NPC's index
let lastHitMine = new Map(); // transcript input: npc index -> whether its last hitsplat was the recording player's

const npcState = (map, npc) => {
    let state = map.get(npc);
    if (!state) map.set(npc, (state = { attack: false, death: false, hit: false }));
    return state;
};

function addKinds(seen) {
    for (const [npc, s] of seen) {
        if (s.death) kinds.add(`death:${npc}`);
        else if (s.hit && !s.attack) kinds.add(`hit:${npc}`);
        else if (s.attack && !s.hit) kinds.add(`attack:${npc}`);
        // Every tick the NPC attacked or was hit, whatever else it did: what the specificity test credits.
        if (!s.death && s.attack) kinds.add(`any-attack:${npc}`);
        if (!s.death && s.hit) kinds.add(`any-hit:${npc}`);
    }
}

function flush() {
    if (tick === null) return;
    // A death counts once the tick's hits are read: not when the NPC's last hitsplat was another player's.
    for (const state of tickNpcs.values()) {
        if (state.deathAt) state.death = state.deathAt.some((i) => lastHitMine.get(i) !== false);
    }
    addKinds(tickNpcs);
    tickNpcs = new Map();
    for (const key of kinds) inc(kindTicks, key);
    for (const sound of sounds) {
        inc(soundTicks, sound);
        for (const key of kinds) inc(co, `${sound}|${key}`);
    }
    tick = null;
    sounds = new Set();
    kinds = new Set();
}

function readNpcInfo(line) {
    const starts = [];
    const entry = /(?:\{|, )(\d+)=([A-Za-z]+)/g;
    let match;
    while ((match = entry.exec(line))) starts.push([match.index, Number(match[1]), match[2]]);
    const seen = new Map(); // npc id -> { attack, death, hit }
    for (let i = 0; i < starts.length; i++) {
        const [from, slot, type] = starts[i];
        const body = line.slice(from, i + 1 < starts.length ? starts[i + 1][0] : line.length);
        if (type === "HighResolutionToLowResolution") { index.delete(slot); continue; }
        if (type === "LowResolutionToHighResolution") {
            const id = body.match(/id=(\d+)/);
            if (id) index.set(slot, Number(id[1]));
        }
        const npc = index.get(slot);
        if (npc === undefined) continue;
        const state = npcState(seen, npc);
        for (const m of body.matchAll(/SequenceExtendedInfo\(id=(\d+)/g)) {
            const kind = animationKind(npc, Number(m[1]), null);
            if (kind) state[kind] = true;
        }
        if (body.includes("HitExtendedInfo")) state.hit = true;
    }
    addKinds(seen);
}

/**
 * Hitsplat types that show another player's hit (RuneLite's HitsplatID: BLOCK_OTHER 13, DAMAGE_OTHER 17 and
 * its cyan/orange/yellow/white 19/21/23/25, poise 54, and the poison tsps sends others, 66). The sound of
 * such a hit goes to that player, so the tick is no hit tick for the recording, and an NPC whose last
 * hitsplat was such a hit dies as that player's kill.
 */
const OTHER_HITSPLATS = new Set([13, 17, 19, 21, 23, 25, 54, 66]);

/** One transcript line (tick header, packet, NPC or NPC extended info); returns false for any other line. */
function readTranscriptLine(line) {
    const header = line.match(/^\[(\d+)\]\s*$/);
    if (header) {
        const t = Number(header[1]);
        if (tick !== null && t !== tick) flush();
        tick = t;
        block = null;
        transcriptNpc = null;
        return true;
    }
    const packet = line.match(/^ {4}\[([a-z0-9_]+)\](.*)$/);
    if (packet) {
        block = packet[1];
        transcriptNpc = null;
        if (block.startsWith("npc_info")) npcInfoLines++;
        if (block === "synth_sound" && tick !== null) {
            synthLines++;
            const id = packet[2].match(/id=(?:[^,(]*\()?(\d+)\)?/);
            const delay = packet[2].match(/delay=(\d+)/);
            if (!id) return true;
            sounds.add(Number(id[1]));
            inc(delays, `${id[1]}|${delay ? delay[1] : 0}`);
        }
        return true;
    }
    if (!block?.startsWith("npc_info")) return /^ {8}/.test(line);
    const entity = line.match(/^ {8}\[[a-z_]+\] npc=\(index=(\d+), id=(?:[^,(]*\()?(\d+)\)?/);
    if (entity) { transcriptNpc = Number(entity[2]); transcriptIndex = Number(entity[1]); return true; }
    const info = line.match(/^ {12}\[(sequence|hit)\] (.*)$/);
    if (!info) return /^ {8}/.test(line);
    if (transcriptNpc === null) return true;
    const state = npcState(tickNpcs, transcriptNpc);
    if (info[1] === "hit") {
        const type = info[2].match(/^id=(?:[^,(]*\()?(\d+)\)?/);
        const mine = !type || !OTHER_HITSPLATS.has(Number(type[1]));
        lastHitMine.set(transcriptIndex, mine);
        if (mine) state.hit = true;
        return true;
    }
    const seq = info[2].match(/^id=(?:([A-Za-z0-9_]+) \()?(-?\d+)\)?/);
    if (!seq || Number(seq[2]) < 0) return true;
    const kind = animationKind(transcriptNpc, Number(seq[2]), seq[1]);
    if (kind === "death") (state.deathAt ??= []).push(transcriptIndex);
    else if (kind) state[kind] = true;
    return true;
}

let npcInfoLines = 0;
let synthLines = 0;
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const raw of lines) {
    let line = raw;
    const prefixed = raw.match(/^([^:]*\.txt):(.*)$/s);
    if (prefixed) {
        if (prefixed[1] !== file) {
            flush();
            file = prefixed[1];
            index = new Map();
            block = null;
            transcriptNpc = null;
            lastHitMine = new Map();
        }
        line = prefixed[2];
    }
    if (!line.startsWith("[") || /^\[\d+\]\s*$/.test(line)) { readTranscriptLine(line); continue; }
    const m = line.match(/^\[(\d+)\] <- (NpcInfo|SynthSound)/);
    if (!m) continue;
    const t = Number(m[1]);
    if (tick !== null && t !== tick) flush();
    tick = t;
    if (m[2] === "SynthSound") {
        synthLines++;
        const s = line.match(/id=(\d+), loops=\d+, delay=(\d+)/);
        sounds.add(Number(s[1]));
        inc(delays, `${s[1]}|${s[2]}`);
    } else {
        npcInfoLines++;
        readNpcInfo(line);
    }
}
flush();

const modalDelay = new Map();
for (const [key, count] of delays) {
    const [sound, delay] = key.split("|").map(Number);
    const best = modalDelay.get(sound);
    if (!best || count > best.count) modalDelay.set(sound, { delay, count });
}

// Candidate (sound, kind, npc) triples.
const candidates = new Map(); // sound -> [{ kind, npc, co }]
for (const [key, c] of co) {
    if (c < MIN_CO) continue;
    const [sound, target] = key.split("|");
    if (target.startsWith("any-") || isKnown(Number(sound), Number(target.split(":")[1]))) continue;
    const ticks = kindTicks.get(target);
    if (ticks < MIN_TICKS_OF_KIND || c / ticks < MIN_SHARE) continue;
    const [kind, npc] = target.split(":");
    if (!candidates.has(sound)) candidates.set(sound, []);
    candidates.get(sound).push({ kind, npc: Number(npc), co: c });
}

const npcs = {};
for (const [sound, list] of candidates) {
    // One sound belongs to one kind per NPC: the kind it follows most closely.
    const bestPerNpc = new Map();
    for (const item of list) {
        const share = item.co / kindTicks.get(`${item.kind}:${item.npc}`);
        const cur = bestPerNpc.get(item.npc);
        if (!cur || share > cur.share) bestPerNpc.set(item.npc, { ...item, share });
    }
    const kept = [...bestPerNpc.values()];
    // A sound counts as following its NPCs in every tick of their event, also those that mixed it with
    // another (the dark beast's attack sound mostly plays as the player's hit lands on it).
    const covered = kept.reduce((total, item) => total
        + (item.kind === "death" ? item.co : co.get(`${sound}|any-${item.kind}:${item.npc}`) ?? item.co), 0);
    if (covered / soundTicks.get(Number(sound)) < MIN_SPECIFIC) continue;
    for (const item of kept) {
        const npc = (npcs[item.npc] ??= {});
        (npc[item.kind] ??= []).push([Number(sound), modalDelay.get(Number(sound)).delay]);
    }
}
for (const npc of Object.values(npcs)) for (const list of Object.values(npc)) list.sort((a, b) => a[0] - b[0]);
for (const [variant, id] of SOUNDS_AS) if (!npcs[variant] && npcs[id]) npcs[variant] = npcs[id];

// Fixed key order, so a rerun on the same captures gives the same bytes whatever order rg read the files in.
const ordered = (npc) => Object.fromEntries(["hit", "attack", "death"].filter((kind) => npc[kind]).map((kind) => [kind, npc[kind]]));
const sorted = Object.fromEntries(Object.entries(npcs).sort((a, b) => Number(a[0]) - Number(b[0])).map(([id, npc]) => [id, ordered(npc)]));
const out = {
    $comment: "NPC combat sounds from rsprox.net captures, built by scripts/mine-npc-combat-sounds.mjs. npcs[id] has hit (the NPC took a hit), attack and death: lists of [sound, delay], one picked at random per event.",
    npcs: sorted,
};
if (npcInfoLines === 0 || synthLines === 0 || Object.keys(sorted).length === 0) {
    console.error(`mine-npc-combat-sounds: read ${npcInfoLines} NpcInfo and ${synthLines} SynthSound lines and built `
        + `${Object.keys(sorted).length} NPCs; the input is neither RSProx's BinaryToString text nor its transcripts (see the header). Nothing written.`);
    process.exit(1);
}
const text = "{\n \"$comment\": " + JSON.stringify(out.$comment) + ",\n \"npcs\": {\n"
    + Object.entries(sorted).map(([id, v]) => `  "${id}": ${JSON.stringify(v)}`).join(",\n") + "\n }\n}\n";
const outIndex = process.argv.indexOf("--out");
if (outIndex > 0) fs.writeFileSync(path.resolve(process.argv[outIndex + 1]), text);
else process.stdout.write(text);
