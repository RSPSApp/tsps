// Builds client/public/osrstranslate/additions-<language>.json: the OSRS Translate entries tsps
// adds before the author's dictionaries have them. They are our own contributions, open as pull
// requests on walterrezende12-tech/osrs-translate-translations; the plugin uses an addition only
// while the author's dictionary has no entry for it, and a fix only while his entry still holds
// the text the fix replaces, so both retire themselves once he merges and republishes.
//
//   node scripts/osrs-translate-additions.mjs <dictionary clone> <base ref> <pr ref>...
//
// The clone needs the base (the author's main) and every pull request branch fetched, e.g.
//   git clone https://github.com/walterrezende12-tech/osrs-translate-translations.git dict
//   git -C dict fetch https://github.com/UnhealthyKraken/osrs-translate-translations.git <branch>...
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LANGUAGES = ["pt-BR", "ESP"];
const FILES = [
    "translations.json",
    "translations_skills.json",
    "translations_quests.json",
    "translations_items.json",
    "translations_menu.json",
    "translations_overhead.json",
    "translations_game_message.json",
    "translations_welcome.json",
    "translations_settings.json",
];

const [repo, base, ...refs] = process.argv.slice(2);
if (!repo || !base || refs.length === 0) {
    console.error("usage: node scripts/osrs-translate-additions.mjs <dictionary clone> <base ref> <pr ref>...");
    process.exit(1);
}

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const read = (ref, path) => {
    try {
        return JSON.parse(git("show", `${ref}:${path}`));
    } catch {
        return {};
    }
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "osrstranslate");
mkdirSync(outDir, { recursive: true });

for (const language of LANGUAGES) {
    const files = {};
    let added = 0;
    let fixed = 0;
    for (const file of FILES) {
        const original = read(base, `${language}/${file}`);
        const add = {};
        const fix = {};
        for (const ref of refs) {
            const changed = read(ref, `${language}/${file}`);
            for (const [key, value] of Object.entries(changed)) {
                if (typeof value !== "string") continue;
                if (!Object.prototype.hasOwnProperty.call(original, key)) {
                    if (key in add && add[key] !== value) throw new Error(`${language}/${file}: ${ref} adds ${JSON.stringify(key)} differently`);
                    add[key] = value;
                } else if (original[key] !== value) {
                    if (key in fix && fix[key][1] !== value) throw new Error(`${language}/${file}: ${ref} fixes ${JSON.stringify(key)} differently`);
                    fix[key] = [original[key], value];
                }
            }
        }
        const entry = {};
        if (Object.keys(add).length) entry.add = add;
        if (Object.keys(fix).length) entry.fix = fix;
        if (Object.keys(entry).length) files[file] = entry;
        added += Object.keys(add).length;
        fixed += Object.keys(fix).length;
    }
    const output = {
        about: "tsps's additions to the OSRS Translate dictionaries; see client/game/plugins/osrstranslate/README.md",
        base: git("rev-parse", base).trim(),
        pullRequests: refs.map((ref) => ({ ref, commit: git("rev-parse", ref).trim() })),
        files,
    };
    const path = join(outDir, `additions-${language}.json`);
    writeFileSync(path, JSON.stringify(output, null, 1) + "\n");
    console.log(`${language}: ${added} additions, ${fixed} fixes -> ${path}`);
}
