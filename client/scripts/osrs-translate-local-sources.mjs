import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Project-owned dictionary inputs; unknown domains and invalid values fail generation. */
export function loadLocalSources(directory, languages, files) {
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => {
        const text = readFileSync(join(directory, name), "utf8").replace(/\r\n/g, "\n");
        const data = JSON.parse(text);
        if (!isObject(data)) throw new Error(`${name}: expected a language dictionary`);
        for (const [language, domains] of Object.entries(data)) {
            if (!languages.includes(language) || !isObject(domains)) throw new Error(`${name}: invalid language ${language}`);
            for (const [file, entries] of Object.entries(domains)) {
                if (!files.includes(file) || !isObject(entries)) throw new Error(`${name}: invalid dictionary ${file}`);
                if (Object.values(entries).some((value) => typeof value !== "string")) throw new Error(`${name}: translations must be strings`);
            }
        }
        return { name, data, sha256: createHash("sha256").update(text).digest("hex") };
    });
}

/** Local additions fill missing keys only; canonical wording always takes precedence. */
export function addLocalEntries(sources, language, file, original, additions) {
    for (const source of sources) {
        for (const [key, value] of Object.entries(source.data[language]?.[file] ?? {})) {
            if (Object.hasOwn(original, key)) continue;
            if (Object.hasOwn(additions, key) && additions[key] !== value) {
                throw new Error(`${source.name}: conflicting translation for ${language}/${file}: ${JSON.stringify(key)}`);
            }
            additions[key] = value;
        }
    }
}
