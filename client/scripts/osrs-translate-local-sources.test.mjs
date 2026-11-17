import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addLocalEntries, loadLocalSources } from "./osrs-translate-local-sources.mjs";

const languages = ["ESP", "pt-BR"], files = ["translations_game_message.json"];
const fixture = (t) => {
    const directory = mkdtempSync(join(tmpdir(), "translation-source-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
};
const document = (value) => ({ ESP: { [files[0]]: { Message: value } } });

test("local sources are ordered, fingerprinted independently of checkout newlines, and repeatable", (t) => {
    const directory = fixture(t), text = JSON.stringify(document("Mensaje"), null, 2) + "\n";
    writeFileSync(join(directory, "z.json"), text.replace(/\n/g, "\r\n"));
    writeFileSync(join(directory, "a.json"), text);
    const sources = loadLocalSources(directory, languages, files);
    assert.deepEqual(sources.map(({ name }) => name), ["a.json", "z.json"]);
    assert.equal(sources[0].sha256, createHash("sha256").update(text).digest("hex"));
    assert.equal(sources[0].sha256, sources[1].sha256);
    assert.deepEqual(loadLocalSources(directory, languages, files), sources);
});

test("canonical publication retires local wording and conflicts fail instead of silently replacing contributions", () => {
    const sources = [{ name: "local.json", data: document("Local") }];
    const original = { Message: "Author" }, additions = {};
    addLocalEntries(sources, "ESP", files[0], original, additions);
    assert.deepEqual(additions, {});
    assert.deepEqual(original, { Message: "Author" });
    addLocalEntries(sources, "ESP", files[0], {}, additions);
    assert.deepEqual(additions, { Message: "Local" });
    assert.throws(() => addLocalEntries(sources, "ESP", files[0], {}, { Message: "Other" }), /conflicting translation/);
});

test("invalid source languages, domains and translation values fail closed", (t) => {
    const directory = fixture(t);
    for (const value of [[], { XX: {} }, { ESP: { wrong: {} } }, document(7), { ESP: [] }]) {
        writeFileSync(join(directory, "invalid.json"), JSON.stringify(value));
        assert.throws(() => loadLocalSources(directory, languages, files));
    }
    assert.deepEqual(loadLocalSources(join(directory, "absent"), languages, files), []);
});
