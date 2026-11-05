import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigGroup, ConfigItem } from "../runelite/client/config/ConfigItem";
import { PluginConfigView } from "../runelite/client/ui/plugin/PluginConfigView";
import { ConfigChanged } from "@runelite/api/events";
import * as InterfaceID from "@runelite/api/gameval/InterfaceID";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import type { ConfigStorage } from "../runelite/client/config/ConfigStorage";
import { EventBus } from "../runelite/client/eventbus/EventBus";
import { PluginManager } from "../runelite/client/plugins/PluginManager";
import { CLIENT_TOKEN } from "../runelite/client/plugins/PluginInjector";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ClientPluginManager, type WidgetTextFont } from "../game/plugins/ClientPluginManager";
import { chatHistory } from "../rs/cs2/ChatHistory";
import { menuOptionDisplayText } from "../ui/menu/menuOptionDisplayText";
import { OsrsTranslateConfig } from "../game/plugins/osrstranslate/OsrsTranslateConfig";
import { fitLineHeight, OsrsTranslatePlugin } from "../game/plugins/osrstranslate/OsrsTranslatePlugin";
import { translateGuideBody } from "../game/plugins/osrstranslate/skillGuide";
import {
    cleanText,
    compileRegexTranslations,
    findRegexTranslation,
    normalizeChatOverlayTags,
    normalizeLookupText,
    preserveStartTags,
    richLookupText,
    TranslationDomain,
    translateSpecialText,
} from "../game/plugins/osrstranslate/TranslationLookup";
import {
    DEFAULT_MANIFEST_URL,
    loadReleaseFiles,
    parseManifest,
    sha256Hex,
    TranslationRepository,
    type FetchDeps,
} from "../game/plugins/osrstranslate/TranslationRepository";
import { REQUIRED_FILES } from "../game/plugins/osrstranslate/TranslationState";

class MemoryStorage implements ConfigStorage {
    private readonly values = new Map<string, string>();
    getItem(key: string): string | null { return this.values.get(key) ?? null; }
    setItem(key: string, value: string): void { this.values.set(key, value); }
    removeItem(key: string): void { this.values.delete(key); }
    key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
    get length(): number { return this.values.size; }
}

const subtle = globalThis.crypto.subtle;
const encode = (text: string) => new TextEncoder().encode(text);

// --- Lookup: the keys' normal form ---------------------------------------------------------------
assert.equal(cleanText("Hello,<br>what are you<br/>doing here ?"), "Hello, what are you doing here ?");
assert.equal(cleanText("<col=ff0000>Red</col>  text"), "Red text");
assert.equal(normalizeLookupText("doing here ?"), "doing here?", "no space before punctuation");
assert.equal(normalizeLookupText("Hardcore Ironmen are"), "Hardcore Ironman are");
assert.equal(preserveStartTags("<col=ff0000><str>Done</str>"), "<col=ff0000><str>");
assert.equal(preserveStartTags("Plain"), "");
assert.equal(normalizeChatOverlayTags("A<br>B</col>C"), "A\nB<col=000000>C");

// --- Lookup: placeholder patterns ----------------------------------------------------------------
const general = new Map([
    ["You have [number] coins.", "Você tem [number] moedas."],
    ["You have [number] [item].", "Você tem [number] [item]."],
    ["[player], hello!", "[player], olá!"],
    ["[a]", "match everything"], // only placeholders: skipped
    ["[Vampyre name].", "[Vampyre name]"], // pt-BR's real key: punctuation alone, skipped too
    ["Same [x] text", "Same [x] text"], // identity template: skipped
    ["Plain key", "Chave simples"],
]);
const patterns = compileRegexTranslations(general);
assert.deepEqual(patterns.map((p) => p.translation), ["Você tem [number] moedas.", "Você tem [number] [item].", "[player], olá!"],
    "most static text first; identity, all-placeholder and punctuation-only keys skipped");
assert.equal(new TranslationDomain(general, true).translate("Welcome to my shop."), null,
    "an untranslated sentence keeps its full stop (punctuation-only keys match nothing)");
assert.equal(findRegexTranslation(patterns, "You have 5 coins."), "Você tem 5 moedas.", "the more specific key wins");
assert.equal(findRegexTranslation(patterns, "You have 2 logs."), "Você tem 2 logs.");
assert.equal(findRegexTranslation(patterns, "Zezima, hello!"), "Zezima, olá!", "a leading placeholder");
assert.equal(findRegexTranslation(patterns, "Banker"), null);
const domain = new TranslationDomain(general, true);
for (const text of ["You have 5 coins.", "You have 2 logs.", "Zezima, hello!", "Banker", "Plain key", "(paren) text"]) {
    assert.equal(domain.translate(text), general.get(text) ?? findRegexTranslation(patterns, text),
        `bucketed lookup matches the linear scan: ${text}`);
}
assert.equal(domain.translate("Plain key"), "Chave simples", "exact keys first, memoised");
// Equally specific keys: the dictionary's order decides, whichever bucket each key lands in.
const tie = new Map([["[a] the cow.", "L:[a]"], ["Kill [b]cow.", "B:[b]"]]);
assert.equal(new TranslationDomain(tie, true).translate("Kill the cow."), findRegexTranslation(compileRegexTranslations(tie), "Kill the cow."));
assert.equal(new TranslationDomain(tie, true).translate("Kill the cow."), "L:Kill");
// Placeholders are filled from the tagged text when it matches, so a coloured value keeps its colour.
const music = new TranslationDomain(new Map([["You have unlocked a new music track: [track]", "Nova faixa: [track]"]]), true);
const track = "You have unlocked a new music track: <col=e00a19>Forever";
assert.equal(music.translate(cleanText(track), richLookupText(track)), "Nova faixa: <col=e00a19>Forever");
const tagInKey = "You have <col=ff0000>unlocked</col> a new music track: Forever";
assert.equal(music.translate(normalizeLookupText(cleanText(tagInKey)), richLookupText(tagInKey)), "Nova faixa: Forever",
    "a tag inside the key's own text: filled from the plain text instead");
assert.equal(richLookupText("<col=ff0000>Hi<br>there ."), "Hi there.");
// A captured value that looks like a placeholder is not filled in again.
assert.equal(findRegexTranslation(compileRegexTranslations(new Map([["[a] and [b]", "[a] e [b]"]])), "x [y] and z"), "x [y] e z");
assert.ok(domain.values.has("Chave simples"), "translations are recognised as already translated");

// --- Welcome-screen and Hans specials ------------------------------------------------------------
const welcome = new Map([
    ["You last logged in [value] ago.", "Sua última sessão foi há [value]."],
    ["__duration.days", "dias"],
    ["__duration.day", "dia"],
    ["__duration.hours", "horas"],
    ["__duration.minutes", "minutos"],
    ["__hans.template", "[daysInWorld] [daysUnit], [hoursInWorld] [hoursUnit], [minutesInWorld] [minutesUnit]; [daysSinceArrival] [daysSinceArrivalUnit]"],
]);
assert.equal(translateSpecialText("You last logged in 3 days ago.", true, welcome), "Sua última sessão foi há 3 dias.");
assert.equal(translateSpecialText("You last logged in a day ago.", true, welcome), "Sua última sessão foi há 1 dia.");
assert.equal(translateSpecialText("You last logged in 3 days ago.", false, welcome), null, "only on the welcome screen");
assert.equal(
    translateSpecialText("You've spent 2 days, 3 hours, 4 minutes in the world since you arrived 10 days ago.", false, welcome),
    "2 dias, 3 horas, 4 minutos; 10 dias",
    "Hans's line, on any interface",
);

// --- Dialogue line height ------------------------------------------------------------------------
// Font 497's metrics; 7 px a character puts about 54 characters on a 380 px line.
const font: WidgetTextFont = { measure: (s) => s.length * 7, lineHeight: 15, ascent: 15, maxAscent: 15, maxDescent: 5 };
const line = "x".repeat(50);
const lines = (n: number) => Array.from({ length: n }, () => line).join(" ");
assert.equal(fitLineHeight(lines(2), 380, 67, 28, font), undefined, "two lines at 28 fit 67 px");
assert.equal(fitLineHeight(lines(3), 380, 67, 28, font), 23, "three lines where the English had two");
assert.equal(fitLineHeight(lines(4), 380, 67, 20, font), 15, "four lines where the English had three");
assert.equal(fitLineHeight(lines(5), 380, 67, 16, font), 15, "five lines can't fit: the font's own line height");
assert.equal(fitLineHeight("Short.", 380, 67, 0, font), undefined);

// --- Skill guide bodies (script 9183's argument), the real Attack guide's markup -----------------
const ATTACK_GUIDE_P1 = "Your Attack level determines your accuracy with melee weapons and unlocks the ability to wield increasingly powerful weapons. Use the tabs on the left to see what level is required to equip certain equipment.";
const ATTACK_GUIDE_P2 = "To level your Attack skill, attack enemies with a melee weapon that has an Accurate or Controlled attack style. Attack styles can be selected in the ||side_panel:0::300::Combat Options panel||. The tooltip for each attack style shows the style name, type of damage and the skill XP attacking with that style gives.";
const ATTACK_GUIDE_P3 = "Melee Attack Styles deal either Stab, Slash or Crush damage as shown in the tooltip.";
const attackBody = [ATTACK_GUIDE_P1, ATTACK_GUIDE_P2, ATTACK_GUIDE_P3].join("||::p||");
const guideKeys = new Map([
    [ATTACK_GUIDE_P1, "P1 traduzido."],
    ["To level your Attack skill, attack enemies with a melee weapon that has an Accurate or Controlled attack style. Attack styles can be selected in the Combat Options panel. The tooltip for each attack style shows the style name, type of damage and the skill XP attacking with that style gives.", "P2 traduzido."],
    ["Combat Options panel", "Painel de opções de combate"],
]);
assert.equal(
    translateGuideBody(attackBody, (text) => guideKeys.get(text) ?? null),
    `P1 traduzido.||::p||P2 traduzido. ||side_panel:0::300::Painel de opções de combate||::p||${ATTACK_GUIDE_P3}`,
    "paragraphs translated whole, the link kept clickable after its paragraph, an untranslated paragraph unchanged",
);
assert.equal(translateGuideBody(attackBody, () => null), attackBody, "nothing translated: the body is untouched");
// Two links in one paragraph (the guide's shop sentence) keep a space segment between them.
assert.equal(
    translateGuideBody("Weapons are sold at the ||::131::Sword Shop|| and the ||::132::Scimitar Shop||.", (text) => (text === "Weapons are sold at the Sword Shop and the Scimitar Shop." ? "Armas à venda." : null)),
    "Armas à venda. ||::131::Sword Shop|| ||::132::Scimitar Shop",
    "shop links (\"::icon::text\") are links, not tags",
);
// A lead-in link ("Strength:") stays in front of its translated paragraph.
assert.equal(
    translateGuideBody("||skill:2::5::Strength:::|| While Attack increases your accuracy, Strength increases your damage.", (text) => (text === "While Attack increases your accuracy, Strength increases your damage." ? "Strength aumenta o dano." : null)),
    "||skill:2::5::Strength:::|| Strength aumenta o dano.",
);
assert.equal(translateGuideBody("a ||tab:5::::Crossbows tab|| here", (text) => (text === "Crossbows tab" ? "Aba de bestas" : text === "a Crossbows tab here" ? "x" : null)), "x ||tab:5::::Aba de bestas");
// The dictionaries hold the guide's sentences one by one, as the live ones do.
const sentenceKeys = new Map([
    ["Your Attack level determines your accuracy with melee weapons and unlocks the ability to wield increasingly powerful weapons.", "Tu nivel de Attack determina tu precisión."],
    ["To level your Attack skill, attack enemies with a melee weapon that has an Accurate or Controlled attack style.", "Para subir Attack, ataca con un estilo Accurate o Controlled."],
]);
assert.equal(
    translateGuideBody(attackBody, (text) => sentenceKeys.get(text) ?? null).split("||::p||").slice(0, 2).join("||::p||"),
    "Tu nivel de Attack determina tu precisión. Use the tabs on the left to see what level is required to equip certain equipment." +
        "||::p||Para subir Attack, ataca con un estilo Accurate o Controlled. Attack styles can be selected in the Combat Options panel. " +
        "The tooltip for each attack style shows the style name, type of damage and the skill XP attacking with that style gives. " +
        "||side_panel:0::300::Combat Options panel",
    "sentence by sentence when the paragraph isn't a key; a sentence with no key stays English",
);

async function main(): Promise<void> {
    // --- Repository: manifest, hashes, cache ---------------------------------------------------------
    const DICTIONARIES: Record<string, Record<string, Record<string, string>>> = {
        "pt-BR": {
            "translations.json": {
                "Hello, what are you doing here?": "Olá, o que você está fazendo aqui?",
                "[1] Yes.": "unused",
                "Yes please.": "Sim, por favor.",
                "A wrongly translated line.": "Uma linha Nothing.",
                "You have [number] coins.": "Você tem [number] moedas.",
                "Level 1 Thick Skin Increases your defence by 5%.": "Nível 1<br>Thick Skin<br>Aumenta sua defesa em 5%.",
            },
            "translations_menu.json": {
                "Talk-to": "Falar-com", "Walk here": "Andar aqui", "Choose Option": "Escolha a opção",
                "Report": "Denunciar", "Combat Level:": "Nível de combate:",
            },
            "translations_skills.json": {
                [ATTACK_GUIDE_P1]: "Seu nível de Attack determina sua precisão.",
                "Combat Options panel": "Painel de opções de combate",
            },
            "translations_overhead.json": { "I need your help, [player]!": "Preciso da sua ajuda, [player]!" },
            "translations_game_message.json": {
                "Nothing interesting happens.": "Nada de interessante acontece.",
                "You've started a new quest: [quest]": "Você iniciou uma nova quest: [quest]",
                "You have unlocked a new music track: [track]": "Você desbloqueou uma nova faixa de música: [track]",
            },
            "translations_settings.json": { "Settings": "Configuracoes" },
            "translations_quests.json": {
                "Have Wizard Cromperty teleport you to the Rune Essence mine.": "Peça ao Wizard Cromperty para teletransportar você até a mina de Rune Essence.",
                "Steal a cake from the Ardougne market stalls.": "Roube um bolo das barracas do mercado de Ardougne.",
            },
            "translations_welcome.json": { "Welcome to Old School RuneScape": "Bem-Vindo(a) ao Old School RuneScape" },
        },
        ESP: {
            "translations.json": { "Hello, what are you doing here?": "Hola, ¿qué haces aquí?" },
            "translations_menu.json": { "Talk-to": "Hablar-con" },
        },
    };
    const BASE = "https://raw.githubusercontent.com/walterrezende12-tech/osrs-translate-translations/abc123/";
    const bodies = new Map<string, Uint8Array>();
    async function buildManifest(version: string): Promise<string> {
        const languages: Record<string, { files: Record<string, { url: string; sha256: string }> }> = {};
        for (const [language, files] of Object.entries(DICTIONARIES)) {
            languages[language] = { files: {} };
            for (const name of REQUIRED_FILES) {
                const body = encode(JSON.stringify(files[name] ?? {}));
                const url = `${BASE}${language}/${name}`;
                bodies.set(url, body);
                languages[language].files[name] = { url, sha256: await sha256Hex(body, subtle) };
            }
        }
        return JSON.stringify({ schemaVersion: 1, version, languages });
    }

    let manifestBody = await buildManifest("2026.11.05.1");
    // tsps's bundled additions (client/public/osrstranslate), served from the page's own origin.
    bodies.set("/osrstranslate/additions-pt-BR.json", encode(JSON.stringify({
        files: {
            "translations.json": {
                add: {
                    "Only in our additions.": "Só nas nossas adições.",
                    "Yes please.": "would override the author",
                },
                fix: {
                    "A wrongly translated line.": ["Uma linha Nothing.", "Uma linha corrigida."],
                    "Yes please.": ["a text the author has since changed", "stale fix"],
                },
            },
        },
    })));
    const fetched: string[] = [];
    let offline = false;
    const fakeFetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        if (offline) throw new TypeError("network down");
        if (url === DEFAULT_MANIFEST_URL) return new Response(manifestBody);
        const body = bodies.get(url);
        return body ? new Response(body) : new Response("missing", { status: 404 });
    }) as typeof fetch;

    // A Map-backed Cache API.
    const stores = new Map<string, Map<string, Uint8Array>>();
    const fakeCaches = {
        async open(name: string) {
            let store = stores.get(name);
            if (!store) stores.set(name, (store = new Map()));
            const s = store;
            return {
                async match(key: string) { const v = s.get(String(key)); return v ? new Response(v) : undefined; },
                async put(key: string, response: Response) { s.set(String(key), new Uint8Array(await response.arrayBuffer())); },
                async keys() { return [...s.keys()].map((url) => ({ url })); },
                async delete(request: { url: string }) { return s.delete(request.url); },
            };
        },
    } as unknown as CacheStorage;
    const deps: FetchDeps = { fetch: fakeFetch, caches: fakeCaches, subtle };

    const parsedManifest = JSON.parse(manifestBody);
    assert.throws(() => parseManifest({ ...parsedManifest, schemaVersion: 2 }, "pt-BR", DEFAULT_MANIFEST_URL), /schema/);
    assert.throws(() => parseManifest(parsedManifest, "fr", DEFAULT_MANIFEST_URL), /not in manifest/);
    assert.throws(() => parseManifest(parsedManifest, "../x", DEFAULT_MANIFEST_URL), /invalid language/);
    const insecure = JSON.parse(manifestBody);
    insecure.languages["pt-BR"].files["translations.json"].url = "http://example.com/t.json";
    assert.throws(() => parseManifest(insecure, "pt-BR", DEFAULT_MANIFEST_URL), /HTTPS/);
    const release = parseManifest(parsedManifest, "pt-BR", DEFAULT_MANIFEST_URL);
    assert.equal(release.files.length, REQUIRED_FILES.length);

    // A wrong hash fails the release.
    const tampered = { ...release, files: release.files.map((f, i) => (i === 0 ? { ...f, sha256: "0".repeat(64) } : f)) };
    await assert.rejects(loadReleaseFiles(tampered, deps), /SHA-256 mismatch/);

    fetched.length = 0;
    const files = await loadReleaseFiles(release, deps);
    assert.equal(files["translations_menu.json"]?.["Talk-to"], "Falar-com");
    assert.equal(fetched.length, REQUIRED_FILES.length, "every file downloaded once");
    fetched.length = 0;
    await loadReleaseFiles(release, deps);
    assert.equal(fetched.length, 0, "the second load is served from the cache");

    const repository = new TranslationRepository({ deps });
    const first = await repository.update(DEFAULT_MANIFEST_URL, "pt-BR");
    assert.ok(first && first.version === "2026.11.05.1");
    assert.equal(await repository.update(DEFAULT_MANIFEST_URL, "pt-BR", first!.id), null, "same release: nothing to load");
    offline = true;
    const cold = await new TranslationRepository({ deps }).update(DEFAULT_MANIFEST_URL, "pt-BR");
    assert.equal(cold?.data["translations_menu.json"]?.get("Talk-to"), "Falar-com", "offline: the last release, from the cache");
    await assert.rejects(repository.update(DEFAULT_MANIFEST_URL, "pt-BR", first!.id), /network down/,
        "an offline update keeps the loaded release (the caller ignores the error)");
    offline = false;

    // --- The plugin, through the real plugin manager -------------------------------------------------
    // CORE_PLUGINS pulls in WebGL plugins Node can't load, so read the list's source.
    const registry = readFileSync(join(__dirname, "../runelite/client/plugins/index.ts"), "utf8");
    assert.match(registry.slice(registry.indexOf("export const CORE_PLUGINS")), /^\s+OsrsTranslatePlugin,$/m, "registered as a core plugin");
    assert.equal(OsrsTranslatePlugin.descriptor.enabledByDefault, false, "off by default");

    // The plugin's own repository runs on the page's fetch (no Worker or Cache API under Node).
    const realFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    fetched.length = 0;
    let refreshes = 0;
    const invalidate = () => refreshes++;
    const client: any = { widgetManager: { invalidateAll: invalidate } };
    const configManager = new ConfigManager(undefined, new MemoryStorage());
    const pluginManager = new PluginManager(new EventBus(), configManager);
    pluginManager.getInjector().provide(CLIENT_TOKEN, client);
    pluginManager.loadCorePlugins([OsrsTranslatePlugin]);
    const plugin = pluginManager.getPlugin(OsrsTranslatePlugin)!;
    const hooks = new ClientPluginManager();
    hooks.add(plugin);

    assert.equal(pluginManager.isEnabled(OsrsTranslatePlugin), false, "a fresh profile has it disabled");
    assert.equal(hooks.hasWidgetDisplayText(), false, "disabled: the draw loop skips the hook");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(fetched, [], "nothing is downloaded while it is disabled");

    const dialogue = (text: string, groupId: number = InterfaceID.CHAT_LEFT) =>
        hooks.widgetDisplayText({ groupId, text, width: 380, height: 67, lineHeight: 28, font });
    assert.equal(dialogue("Hello, what are you<br>doing here?"), undefined, "disabled: drawn as sent");
    assert.equal(menuOptionDisplayText("Talk-to"), "Talk-to");
    assert.equal(hooks.npcOverheadText(1, "I need your help, Zezima!"), "I need your help, Zezima!");

    await pluginManager.setPluginEnabled(OsrsTranslatePlugin, true);
    await plugin.update(); // the first update started with startUp; this waits for one to finish
    assert.ok(!plugin.getState().isEmpty, "dictionaries loaded");
    assert.equal(hooks.hasWidgetDisplayText(), true);
    assert.ok(fetched.includes(DEFAULT_MANIFEST_URL), "read the author's manifest");
    assert.ok(refreshes > 0, "interfaces redraw once the dictionaries arrive");
    // Bundled additions: they fill gaps and fix known-bad entries, never override the author.
    const general = plugin.getState().general;
    assert.equal(general.translate("Only in our additions."), "Só nas nossas adições.", "an addition fills a gap");
    assert.equal(general.translate("Yes please."), "Sim, por favor.", "an addition never replaces the author's entry");
    assert.equal(general.translate("A wrongly translated line."), "Uma linha corrigida.", "a fix replaces the known-bad text");

    // Dialogue: the server's 53-character wrap is joined back into one key.
    assert.deepEqual(dialogue("Hello, what are you<br>doing here?"), { text: "Olá, o que você está fazendo aqui?" });
    // A translation that needs one more line than the server's line height allows gets a smaller one.
    assert.deepEqual(dialogue("You have 5 coins.", InterfaceID.CHAT_LEFT), { text: "Você tem 5 moedas." }, "fits: no change");
    const long = hooks.widgetDisplayText({ groupId: InterfaceID.CHAT_LEFT, text: "You have 5 coins.", width: 60, height: 67, lineHeight: 28, font });
    assert.ok(long && long.lineHeight !== undefined && long.lineHeight < 28, "wrapped onto more lines: the line height shrinks");
    assert.equal(dialogue("Hello, what are you doing here?", InterfaceID.CHATBOX), undefined, "the chatbox and chat input are never rewritten");
    assert.equal(dialogue("Hello, what are you doing here?", InterfaceID.STATS), undefined, "nor any interface that isn't routed");
    assert.equal(dialogue("Hello, what are you doing here?", InterfaceID.FRIENDS), undefined, "the friends list never reads the general dictionary (player names)");
    assert.deepEqual(dialogue("<col=0000ff>[1] Yes please.", InterfaceID.CHATMENU), { text: "<col=0000ff>[1] Sim, por favor." },
        "Quest Helper's option number and colour are kept");
    // Journals: one line per component, so a task wrapped over two lines is joined back.
    const journal = [
        "<col=ffff00>Easy",
        "<col=000000>Have Wizard Cromperty teleport you to the Rune Essence",
        "<col=000000>mine.",
        "<str>Steal a cake from the Ardougne market stalls.",
        "<col=000000>Untranslated task text",
    ];
    const FIRST = (InterfaceID.JOURNALSCROLL << 16) | 10;
    const journalLine = (index: number, lines = journal) => hooks.widgetDisplayText({
        groupId: InterfaceID.JOURNALSCROLL, text: lines[index], width: 380, height: 15, lineHeight: 0, font,
        uid: FIRST + index, siblingText: (offset) => lines[index + offset],
    })?.text;
    // The continuation first: it finds the line before it.
    // 7 px a character in 380 px: 54 characters on the first line.
    assert.equal(journalLine(2), "<col=000000>a mina de Rune Essence.", "the second line gets the rest, in its own colour");
    assert.equal(journalLine(1), "<col=000000>Peça ao Wizard Cromperty para teletransportar você até");
    assert.equal(journalLine(3), "<str>Roube um bolo das barracas do mercado de Ardougne.", "a one-line task, struck through");
    assert.equal(journalLine(0), undefined, "no key: left alone");
    assert.equal(journalLine(4), undefined, "no join forms a key: left alone");
    const edited = [...journal];
    edited[1] = "<col=000000>Have someone else teleport you to the Rune Essence";
    assert.equal(journalLine(2, edited), undefined, "the first line changed: the old share is not reused");
    assert.equal(dialogue("<col=000000>mine.", InterfaceID.CHAT_LEFT), undefined, "only journals join lines");
    assert.deepEqual(dialogue("Settings", InterfaceID.SETTINGS), { text: "Configuracoes" });

    // Routing beyond upstream: a component, then its container, then its interface.
    const component = (groupId: number, text: string, uid?: number, parentUid?: number) =>
        hooks.widgetDisplayText({ groupId, text, width: 200, height: 40, lineHeight: 0, font, uid, parentUid })?.text;
    assert.equal(component(InterfaceID.CHATBOX, "Report", (InterfaceID.CHATBOX << 16) | 33), "Denunciar", "a chat tab label");
    assert.equal(component(InterfaceID.CHATBOX, "Report", (InterfaceID.CHATBOX << 16) | 50), undefined, "the rest of the chatbox stays as typed");
    const mouseover = (InterfaceID.TOPLEVEL_OSRS_STRETCH << 16) | 37;
    assert.equal(component(InterfaceID.TOPLEVEL_OSRS_STRETCH, "Level 1<br>Thick Skin<br>Increases your defence by 5%.", 0x8001, mouseover),
        "Nível 1<br>Thick Skin<br>Aumenta sua defesa em 5%.", "a prayer tooltip, by its container");
    assert.equal(component(InterfaceID.TOPLEVEL_OSRS_STRETCH, "Settings", 0x8002, mouseover), undefined,
        "tooltips don't read the settings dictionary that the rest of 161 uses");
    assert.equal(component(InterfaceID.TOPLEVEL_OSRS_STRETCH, "Settings"), "Configuracoes");
    assert.equal(component(InterfaceID.ACCOUNT_SUMMARY_SIDEPANEL, "Combat Level:", 0x8003, (InterfaceID.ACCOUNT_SUMMARY_SIDEPANEL << 16) | 3),
        "Nível de combate:", "a side panel");
    configManager.setConfigValue(OsrsTranslateConfig, "enableSidePanels", false);
    assert.equal(component(InterfaceID.CHATBOX, "Report", (InterfaceID.CHATBOX << 16) | 33), undefined, "side panels toggle");
    configManager.setConfigValue(OsrsTranslateConfig, "enableSidePanels", true);

    // The skill guide: script 9183's body is translated while still on the stack, only when
    // invoked from another script (a top-level run gives no vm).
    const guideVm: any = { stringStack: ["layer name", attackBody], stringStackSize: 2 };
    hooks.onScriptPreFired(9183, guideVm);
    assert.ok(guideVm.stringStack[1].startsWith("Seu nível de Attack determina sua precisão.||::p||"), "the body is translated in place");
    assert.equal(guideVm.stringStack[0], "layer name");
    hooks.onScriptPreFired(9183);
    const otherVm: any = { stringStack: [attackBody], stringStackSize: 1 };
    hooks.onScriptPreFired(9152, otherVm);
    assert.equal(otherVm.stringStack[0], attackBody, "other scripts are left alone");

    // The coverage counter: off until asked, then counts what the plugin sees.
    assert.equal(plugin.coverage.enabled, false);
    component(InterfaceID.STATS, "Total level: 33");
    assert.equal(plugin.coverage.report().seen, 0, "nothing recorded while off");
    assert.equal(hooks.handleClientCommand("translatecoverage on"), true, "the command is the plugin's, not the server's");
    component(InterfaceID.STATS, "Total level: 33");
    component(InterfaceID.STATS, "Total level: 33");
    dialogue("Hello, what are you<br>doing here?");
    component(InterfaceID.CHATBOX, "Olá, o que você está fazendo aqui?", (InterfaceID.CHATBOX << 16) | 60);
    const counted = plugin.coverage.report();
    assert.equal(counted.seen, 2, "one entry per text and place; chat lines in the chatbox aren't counted twice");
    assert.equal(counted.translated, 1);
    assert.equal(counted.percent, 50);
    assert.deepEqual(counted.untranslated.map((entry) => [entry.text, entry.count]), [["Total level: 33", 2]]);
    hooks.handleClientCommand("translatecoverage report");
    assert.ok((globalThis as any).__osrsTranslateCoverage?.untranslated?.length === 1);
    hooks.handleClientCommand("translatecoverage reset");
    hooks.handleClientCommand("translatecoverage off");
    assert.equal(plugin.coverage.report().seen, 0);
    assert.equal(dialogue("Olá, o que você está fazendo aqui?"), undefined, "already translated text is left");

    // Menus: options only, through the shared display transform.
    assert.equal(menuOptionDisplayText("Talk-to"), "Falar-com");
    assert.equal(menuOptionDisplayText("<col=ffffff>Walk here</col>"), "<col=ffffff>Andar aqui</col>");
    assert.equal(menuOptionDisplayText("Attack"), "Attack", "no key: unchanged");

    // NPC overheads, with placeholders; players' overheads go through a different hook.
    assert.equal(hooks.npcOverheadText(1, "I need your help, Zezima!"), "Preciso da sua ajuda, Zezima!");
    assert.equal(hooks.overheadChatText("Zezima", "I need your help, Zezima!"), "I need your help, Zezima!");

    // Chat: "chatMessageBuilding" rewrites game messages' text slot only.
    function build(type: number, message: string): { message: string; timestamp: string } {
        const uid = chatHistory.addMessage(type, message);
        const vm: any = { intStack: [0, uid], intStackSize: 2, stringStack: ["", "", message, "[12:00]"], stringStackSize: 4 };
        plugin.onScriptCallback({ eventName: "chatMessageBuilding", vm });
        return { message: vm.stringStack[2], timestamp: vm.stringStack[3] };
    }
    assert.deepEqual(build(0, "Nothing interesting happens."), { message: "Nada de interessante acontece.", timestamp: "[12:00]" });
    assert.equal(build(0, "You've started a new quest: Cook's Assistant").message, "Você iniciou uma nova quest: Cook's Assistant");
    assert.equal(build(0, "Nothing interesting happens. (3)").message, "Nada de interessante acontece. (3)", "Chat Filter's repeat count is kept");
    assert.equal(build(0, "<col=ef1020>Nothing interesting happens.</col>").message, "<col=ef1020>Nada de interessante acontece.",
        "a highlight's colour is kept");
    assert.equal(build(0, "Nothing interesting <col=ff0000>happens</col>.").message, "Nada de interessante acontece.",
        "a highlighted word inside the message still matches");
    assert.equal(build(0, "You have unlocked a new music track: <col=e00a19>Forever").message,
        "Você desbloqueou uma nova faixa de música: <col=e00a19>Forever", "the track name stays red, as the game sends it");
    assert.equal(build(2, "Nothing interesting happens.").message, "Nothing interesting happens.", "players' public chat is never translated");
    const history = chatHistory.getByUid(chatHistory.addMessage(0, "Nothing interesting happens."));
    assert.equal(history?.text, "Nothing interesting happens.", "the chat history keeps the game's text");

    // Toggles.
    configManager.setConfigValue(OsrsTranslateConfig, "enableDialogues", false);
    assert.equal(dialogue("Hello, what are you<br>doing here?"), undefined, "dialogue toggle");
    configManager.setConfigValue(OsrsTranslateConfig, "enableDialogues", true);
    configManager.setConfigValue(OsrsTranslateConfig, "enableMenuEntries", false);
    assert.equal(menuOptionDisplayText("Talk-to"), "Talk-to", "menu toggle");
    configManager.setConfigValue(OsrsTranslateConfig, "enableMenuEntries", true);

    // Another language: English until it loads, then that language.
    assert.equal(OsrsTranslateConfig.items.enableDialogues.name, "Traduzir diálogos");
    configManager.setConfigValue(OsrsTranslateConfig, "translationLanguage", "SPANISH");
    assert.equal(OsrsTranslateConfig.items.enableDialogues.name, "Traducir diálogos", "the settings follow the chosen language");
    assert.equal(OsrsTranslateConfig.sections?.staticTranslations.name, "Traducciones estáticas");
    // The shared settings view words its Back and Reset from the group, when the group asks.
    const view = (descriptor: typeof OsrsTranslateConfig) => renderToStaticMarkup(React.createElement(PluginConfigView, {
        name: "OSRS Translate PT-BR", descriptor, configManager, onBack: () => {},
    }));
    const spanishView = view(OsrsTranslateConfig);
    assert.match(spanishView, />Restablecer</);
    assert.match(spanishView, /title="Atrás"/);
    assert.match(spanishView, /Traducir diálogos/);
    const plainView = view(ConfigGroup("plain", { on: ConfigItem<boolean>({ name: "On", default: true }) }));
    assert.match(plainView, />Reset</, "other plugins keep the English labels");
    assert.match(plainView, /title="Back"/);
    plugin.onConfigChanged(new ConfigChanged("osrstranslate", "translationLanguage", undefined, "SPANISH"));
    assert.equal(menuOptionDisplayText("Talk-to"), "Talk-to", "the old language is dropped at once");
    await plugin.update();
    assert.equal(menuOptionDisplayText("Talk-to"), "Hablar-con");
    assert.equal(dialogue("Hello, what are you<br>doing here?")?.text, "Hola, ¿qué haces aquí?");

    // Disabling: English again, and the menu transform is released.
    await pluginManager.setPluginEnabled(OsrsTranslatePlugin, false);
    assert.equal(menuOptionDisplayText("Talk-to"), "Talk-to");
    assert.equal(dialogue("Hello, what are you<br>doing here?"), undefined);
    assert.equal(hooks.npcOverheadText(1, "I need your help, Zezima!"), "I need your help, Zezima!");
    fetched.length = 0;
    await plugin.update();
    assert.deepEqual(fetched, [], "a stopped plugin never downloads");

    globalThis.fetch = realFetch;
    console.log("runelite-osrs-translate: ok");
}

void main().catch((error) => {
    console.error(error);
    // Exit now: a started plugin's hourly update timer would keep the test running.
    process.exit(1);
});
