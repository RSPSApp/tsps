// Builds data/definitions/npc-combat-sounds.json from the rsprox.net captures
// (https://rsprox.net/database).
//
// INPUT FORMAT. Not the rsprox_transcripts/ files (their own transcriber writes `[npc_info...]`,
// `[synth_sound] id=` and `[hit]` lines). It reads the text RSProx's own decoder, the
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
//     its death animation (animations are classed with npc-captured-animations.json);
//   - a sound is kept for an NPC when it is in at least MIN_SHARE of that NPC's ticks of the kind,
//     at least MIN_TICKS times;
//   - a sound is NPC-specific only if the NPCs it was kept for account for at least
//     MIN_SPECIFIC of every tick it was sent in: that drops weapon swings, armour and voices that
//     happen to ride along with whatever the player was fighting.
// A sound's delay is its most common delay in the captures.
//   - a sound the server already plays somewhere else (a boss plugin, Sound.ts, another data file) is
//     left out, so it is never sent twice.
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIN_TICKS_OF_KIND = 12;
const MIN_CO = 8;
const MIN_SHARE = 0.6;
const MIN_SPECIFIC = 0.3;

const here = path.dirname(fileURLToPath(import.meta.url));

/** Sound ids the server already sends: any number in a `sound` statement, outside data/definitions. */
function knownSounds() {
    const known = new Set();
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) { if (entry.name !== "node_modules" && entry.name !== "dist") walk(file); continue; }
            if (!/\.(js|ts)$/.test(entry.name)) continue;
            const text = fs.readFileSync(file, "utf8");
            for (const m of text.matchAll(/sound/gi)) {
                let end = m.index;
                let depth = 0;
                for (; end < Math.min(text.length, m.index + 600); end++) {
                    const c = text[end];
                    if (c === "[") depth++;
                    else if (c === "]") depth--;
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
            if (entry.isDirectory()) { if (entry.name !== "node_modules") walkJson(file); continue; }
            if (entry.name.endsWith(".json")) { try { json(JSON.parse(fs.readFileSync(file, "utf8")), false); } catch { /* not data */ } }
        }
    };
    walkJson(path.join(here, "..", "plugins"));
    return known;
}
const known = knownSounds();
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

function flush() {
    if (tick === null) return;
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
        const state = seen.get(npc) ?? { attack: false, death: false, hit: false };
        for (const m of body.matchAll(/SequenceExtendedInfo\(id=(\d+)/g)) {
            const kind = animKind.get(npc)?.get(Number(m[1]));
            if (kind === "attack") state.attack = true;
            else if (kind === "death") state.death = true;
        }
        if (body.includes("HitExtendedInfo")) state.hit = true;
        seen.set(npc, state);
    }
    for (const [npc, s] of seen) {
        if (s.death) kinds.add(`death:${npc}`);
        else if (s.hit && !s.attack) kinds.add(`hit:${npc}`);
        else if (s.attack && !s.hit) kinds.add(`attack:${npc}`);
    }
}

let npcInfoLines = 0;
let synthLines = 0;
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const raw of lines) {
    let line = raw;
    const prefixed = raw.match(/^([^:]*\.txt):(.*)$/s);
    if (prefixed) {
        if (prefixed[1] !== file) { flush(); file = prefixed[1]; index = new Map(); }
        line = prefixed[2];
    }
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
    if (known.has(Number(sound))) continue;
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
    const covered = kept.reduce((total, item) => total + item.co, 0);
    if (covered / soundTicks.get(Number(sound)) < MIN_SPECIFIC) continue;
    for (const item of kept) {
        const npc = (npcs[item.npc] ??= {});
        (npc[item.kind] ??= []).push([Number(sound), modalDelay.get(Number(sound)).delay]);
    }
}
for (const npc of Object.values(npcs)) for (const list of Object.values(npc)) list.sort((a, b) => a[0] - b[0]);

// Fixed key order, so a rerun on the same captures gives the same bytes whatever order rg read the files in.
const ordered = (npc) => Object.fromEntries(["hit", "attack", "death"].filter((kind) => npc[kind]).map((kind) => [kind, npc[kind]]));
const sorted = Object.fromEntries(Object.entries(npcs).sort((a, b) => Number(a[0]) - Number(b[0])).map(([id, npc]) => [id, ordered(npc)]));
const out = {
    $comment: "NPC combat sounds from rsprox.net captures, built by scripts/mine-npc-combat-sounds.mjs. npcs[id] has hit (the NPC took a hit), attack and death: lists of [sound, delay], one picked at random per event.",
    npcs: sorted,
};
if (npcInfoLines === 0 || synthLines === 0 || Object.keys(sorted).length === 0) {
    console.error(`mine-npc-combat-sounds: read ${npcInfoLines} NpcInfo and ${synthLines} SynthSound lines and built `
        + `${Object.keys(sorted).length} NPCs; the input is not RSProx's BinaryToString text (see the header). Nothing written.`);
    process.exit(1);
}
const text = "{\n \"$comment\": " + JSON.stringify(out.$comment) + ",\n \"npcs\": {\n"
    + Object.entries(sorted).map(([id, v]) => `  "${id}": ${JSON.stringify(v)}`).join(",\n") + "\n }\n}\n";
const outIndex = process.argv.indexOf("--out");
if (outIndex > 0) fs.writeFileSync(path.resolve(process.argv[outIndex + 1]), text);
else process.stdout.write(text);
