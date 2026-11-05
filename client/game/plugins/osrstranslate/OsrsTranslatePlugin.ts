/*
 * Copyright (c) 2026, Walter Rezende
 * All rights reserved.
 *
 * Ported to TypeScript from OSRS Translate PT-BR (OsrsTranslatePlugin). BSD 2-Clause License,
 * see ./LICENSE.
 */
import type { ConfigChanged } from "@runelite/api/events";
import { WELCOME_SCREEN } from "@runelite/api/gameval/InterfaceID";
import type { ConfigOf } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { chatHistory, type ChatHistoryStore } from "../../../rs/cs2/ChatHistory";
import { setMenuOptionDisplayText } from "../../../ui/menu/menuOptionDisplayText";
import { wrapTextToWidth } from "../../../widgets/components/TextRenderer";
import type { OsrsClient } from "../../OsrsClient";
import { markChatTransmit } from "../../TransmitCycles";
import type { ScriptCallbackEvent, WidgetDisplayText, WidgetTextEvent, WidgetTextFont } from "../ClientPluginManager";
import { LANGUAGE_FOLDERS, localizeOsrsTranslateConfig, OsrsTranslateConfig, type TranslationLanguage } from "./OsrsTranslateConfig";
import {
    cleanText,
    containsLetters,
    normalizeChatOverlayTags,
    normalizeLookupText,
    preserveStartTags,
    richLookupText,
    splitCollapseSuffix,
    splitQuestHelperPrefix,
    translateSpecialText,
} from "./TranslationLookup";
import { loadReleaseFiles, TranslationRepository } from "./TranslationRepository";
import { COMPONENT_ROUTES, routeDomains, routeFor, TranslationState, type Area, type InterfaceRoute } from "./TranslationState";
import { workerLoadFiles } from "./workerLoadFiles";
import { applyAdditions, fetchAdditions, type LoadAdditions } from "./additions";
import { SKILL_GUIDE_BODY_SCRIPT, translateGuideBody } from "./skillGuide";
import { TranslationCoverage } from "./coverage";
import { CHATBOX } from "@runelite/api/gameval/InterfaceID";
import type { Cs2Vm } from "../../../rs/cs2/Cs2Vm";

/** Upstream re-reads the manifest hourly. */
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/** RuneLite ChatMessageType ids upstream translates (shouldTranslateChatMessage). */
const GAMEMESSAGE = 0;
const ENGINE = 4;
const LOGINLOGOUTNOTIFICATION = 5;
const ITEM_EXAMINE = 27;
const NPC_EXAMINE = 28;
const OBJECT_EXAMINE = 29;
const CONSOLE = 99;
const SPAM = 105;
const WELCOME = 108;
const MESBOX = 115;
const DIDYOUKNOW = 117;
const LEVELUPMESSAGE = 118;
const GAME_MESSAGE_TYPES = new Set([
    GAMEMESSAGE, LEVELUPMESSAGE, ENGINE, SPAM, MESBOX, CONSOLE, DIDYOUKNOW, LOGINLOGOUTNOTIFICATION,
    ITEM_EXAMINE, NPC_EXAMINE, OBJECT_EXAMINE,
]);

const TAG = /<[^>]+>/g;
/** How many components a joined sentence may span. */
const MAX_JOIN = 4;

/** A journal line's share of a sentence spread over several components. */
type JoinedLine = { source: string; display: string; startOffset: number; startSource: string };

/** What the plugin needs from the client; the real one by default. */
export interface TranslateHost {
    /** Redraws cached interfaces and rebuilds the chatbox, after the dictionaries change. */
    refresh(): void;
}

function clientHost(client: OsrsClient | undefined): TranslateHost {
    return {
        refresh() {
            try {
                client?.widgetManager?.invalidateAll?.();
            } catch {}
            markChatTransmit();
        },
    };
}

/**
 * OSRS Translate PT-BR: shows dialogue, game messages, NPC overhead text, menu options and the
 * interfaces upstream covers in Brazilian Portuguese or Spanish, from the author's dictionaries.
 * Text is replaced only where it is drawn, so scripts, other plugins and the server keep seeing
 * the game's English: no option has to be translated back before a click, as upstream must.
 */
export class OsrsTranslatePlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "OSRS Translate PT-BR",
        description:
            "Translates dialogue, chat, menus and interfaces to Brazilian Portuguese or Spanish, " +
            "using dictionaries downloaded from the author's GitHub repository",
        tags: ["translate", "translation", "portuguese", "ptbr", "traducao", "spanish", "espanol", "language"],
        // Off until a player turns it on: it downloads about 25 MB from GitHub when started.
        enabledByDefault: false,
        configKey: "osrstranslate",
    };

    static config = OsrsTranslateConfig;

    readonly config: ConfigOf<typeof OsrsTranslateConfig>;
    private readonly host: TranslateHost;
    private readonly repository: TranslationRepository;
    private readonly history: ChatHistoryStore;
    private readonly loadAdditions: LoadAdditions;
    private state = TranslationState.empty();
    private releaseId: string | undefined;
    /** Bumped whenever a load's result would be stale (stop, language change). */
    private generation = 0;
    private timer: ReturnType<typeof setInterval> | undefined;
    private readonly menuText = (option: string) => this.translateMenuOption(option);
    /** The `::translatecoverage` developer counter; records nothing until switched on. */
    readonly coverage = new TranslationCoverage();

    constructor(deps: {
        configManager?: ConfigManager;
        host?: TranslateHost;
        repository?: TranslationRepository;
        history?: ChatHistoryStore;
        loadAdditions?: LoadAdditions;
    } = {}) {
        super();
        const configManager = deps.configManager ?? inject(ConfigManager);
        this.config = configManager.getConfig(OsrsTranslateConfig);
        // The settings panel follows the chosen language whether or not the plugin is on, as
        // upstream's does; this listener lives as long as the plugin object (the whole session).
        localizeOsrsTranslateConfig(this.config.translationLanguage());
        configManager.addListener((event) => {
            if (event.getGroup() === OsrsTranslateConfig.group && event.getKey() === "translationLanguage") {
                localizeOsrsTranslateConfig(this.config.translationLanguage());
            }
        });
        this.host = deps.host ?? clientHost(inject<OsrsClient | undefined>(CLIENT_TOKEN));
        this.repository = deps.repository ?? new TranslationRepository({ loadFiles: workerLoadFiles((release) => loadReleaseFiles(release, {
            fetch: (...args) => fetch(...args),
            caches: typeof caches === "undefined" ? undefined : caches,
            subtle: globalThis.crypto.subtle,
        })) });
        this.history = deps.history ?? chatHistory;
        this.loadAdditions = deps.loadAdditions ?? fetchAdditions;
    }

    protected async startUp(): Promise<void> {
        setMenuOptionDisplayText(this.menuText);
        this.timer = setInterval(() => void this.update(), UPDATE_INTERVAL_MS);
        // Not awaited: the game stays playable in English while the dictionaries download.
        void this.update();
    }

    protected async shutDown(): Promise<void> {
        this.generation++;
        if (this.timer !== undefined) clearInterval(this.timer);
        this.timer = undefined;
        setMenuOptionDisplayText(undefined);
        this.state = TranslationState.empty();
        this.releaseId = undefined;
        this.host.refresh();
    }

    /** The loaded dictionaries (empty until the first download finishes). */
    getState(): TranslationState {
        return this.state;
    }

    private language(): TranslationLanguage {
        const value = String(this.config.translationLanguage()) as TranslationLanguage;
        return Object.prototype.hasOwnProperty.call(LANGUAGE_FOLDERS, value) ? value : "PORTUGUESE_BRAZIL";
    }

    /** Reads the manifest and loads its release when it is new. Resolves once done or failed. */
    async update(): Promise<void> {
        if (!this.isStarted()) return;
        const generation = this.generation;
        const folder = LANGUAGE_FOLDERS[this.language()];
        try {
            const loaded = await this.repository.update(String(this.config.manifestUrl()), folder, this.releaseId);
            if (!loaded || generation !== this.generation || !this.isStarted()) return;
            // tsps's additions fill the author's gaps and fix known errors until he merges them.
            const additions = await this.loadAdditions(folder);
            if (generation !== this.generation || !this.isStarted()) return;
            const data = additions ? applyAdditions(loaded.data, additions).data : loaded.data;
            this.state = new TranslationState(data, loaded.version);
            this.releaseId = loaded.id;
            this.host.refresh();
        } catch (error) {
            if (generation !== this.generation) return;
            // Upstream keeps the last good dictionaries when an update fails; so does this.
            console.warn("[osrs-translate] could not update the dictionaries", error);
        }
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== OsrsTranslateConfig.group || !this.isStarted()) return;
        const key = event.getKey();
        if (key === "translationLanguage" || key === "manifestUrl") {
            // English until the other language arrives, rather than the old language.
            this.generation++;
            this.state = TranslationState.empty();
            this.releaseId = undefined;
            this.host.refresh();
            void this.update();
            return;
        }
        this.host.refresh();
    }

    private areaEnabled(area: Area): boolean {
        switch (area) {
            case "dialogues": return this.config.enableDialogues() !== false;
            case "skillGuide": return this.config.enableSkillGuide() !== false;
            case "questJournal": return this.config.enableQuestJournal() !== false;
            case "achievementDiary": return this.config.enableAchievementDiary() !== false;
            case "items": return this.config.enableItems() !== false;
            case "clueScrolls": return this.config.enableClueScrolls() !== false;
            case "menuInterfaces": return this.config.enableMenuEntries() !== false;
            case "gameMessages": return this.config.enableGameMessages() !== false;
            case "welcome": return this.config.enableWelcome() !== false;
            case "settings": return this.config.enableSettings() !== false;
            case "sidePanels": return this.config.enableSidePanels() !== false;
        }
    }

    /** Lines given their share of a joined sentence, by uid; rebuilt with each dictionary. */
    private joins = new Map<number, JoinedLine>();
    private joinsFor: TranslationState | undefined;

    /**
     * Journals send one line per component, wrapped to the scroll's width (a diary task "Have
     * Wizard Cromperty teleport you to the Rune Essence" / "mine."), while the dictionaries hold
     * whole sentences. A line that has no translation alone is joined with up to three lines
     * after it, and with up to three before it in case it continues one; the first join that is
     * a dictionary key is translated, wrapped to the component width and shared out over those
     * components, each keeping its own leading colour or strike-through.
     */
    private joinedLine(event: WidgetTextEvent, route: InterfaceRoute): string | null {
        if (this.joinsFor !== this.state || this.joins.size > 4096) {
            this.joins = new Map();
            this.joinsFor = this.state;
        }
        const uid = event.uid;
        const sibling = event.siblingText;
        if (uid === undefined || !sibling || !event.font) return null;
        const textAt = (offset: number) => (offset === 0 ? event.text : sibling(offset));

        const known = this.joins.get(uid);
        if (known && known.source === event.text && textAt(known.startOffset) === known.startSource) return known.display;

        const domain = this.state[route.domain];
        const alone = (text: string) => {
            const clean = normalizeLookupText(cleanText(text));
            return !clean || domain.values.has(clean) || domain.translate(clean) !== null;
        };
        if (alone(event.text)) return null;

        for (let start = 0; start >= -MAX_JOIN + 1; start--) {
            const first = textAt(start);
            // A line before this one that translates by itself ends its own sentence.
            if (first === undefined || (start < 0 && alone(first))) break;
            const lines: string[] = [];
            for (let offset = start; offset < start + MAX_JOIN; offset++) {
                const line = textAt(offset);
                if (line === undefined || !cleanText(line)) break;
                lines.push(line);
                if (lines.length < 2 || offset < 0) continue;
                const joined = lines.join(" ");
                const lookup = normalizeLookupText(cleanText(joined));
                if (domain.values.has(lookup)) continue;
                const translation = domain.translate(lookup, richLookupText(joined));
                if (translation === null) continue;
                this.shareOut(translation, lines, uid + start, event);
                return this.joins.get(uid)?.display ?? null;
            }
        }
        return null;
    }

    /** Wraps a joined sentence's translation to the width and gives each source line its part. */
    private shareOut(translation: string, lines: string[], firstUid: number, event: WidgetTextEvent): void {
        const font = event.font!;
        const width = Math.max(1, event.width);
        let parts = wrapTextToWidth(translation, width, (s) => font.measure(s.replace(TAG, "")));
        // More lines than the components: the rest runs on in the last one rather than being lost.
        if (parts.length > lines.length) parts = [...parts.slice(0, lines.length - 1), parts.slice(lines.length - 1).join(" ")];
        lines.forEach((line, index) => {
            const part = parts[index] ?? "";
            this.joins.set(firstUid + index, {
                source: line,
                display: part ? preserveStartTags(line) + part : "",
                // Relative to this line, so a change to the sentence's first line is noticed.
                startOffset: -index,
                startSource: lines[0],
            });
        });
    }

    /** OsrsTranslatePlugin.translateWidgetText, for one routed interface. */
    translateWidgetText(original: string, groupId: number, route: InterfaceRoute): string | null {
        const clean = normalizeLookupText(cleanText(original));
        if (!clean || !containsLetters(clean)) return null;
        const [prefix, lookup] = splitQuestHelperPrefix(clean);
        const special = translateSpecialText(lookup, groupId === WELCOME_SCREEN, this.state.welcome.exact);
        if (special !== null) return preserveStartTags(original) + prefix + special;
        const domains = routeDomains(route);
        if (domains.some((name) => this.state[name].values.has(lookup))) return null;
        const rich = splitQuestHelperPrefix(richLookupText(original))[1];
        for (const name of domains) {
            let translation = this.state[name].translate(lookup, rich);
            if (translation === null) continue;
            if (name === "gameMessage") translation = normalizeChatOverlayTags(translation);
            return preserveStartTags(original) + prefix + translation;
        }
        return null;
    }

    widgetDisplayText(event: WidgetTextEvent): WidgetDisplayText | undefined {
        const result = this.displayText(event);
        // Chat lines are counted where they are built; of the chatbox, only its tabs count here.
        if (this.coverage.enabled && this.isStarted() && (event.groupId !== CHATBOX || COMPONENT_ROUTES.has((event.uid ?? -1) >>> 0))) {
            this.coverage.record(`interface ${event.groupId}`, event.text, result?.text);
        }
        return result;
    }

    private displayText(event: WidgetTextEvent): WidgetDisplayText | undefined {
        if (!this.isStarted() || this.state.isEmpty) return undefined;
        const route = routeFor(event);
        if (!route || !this.areaEnabled(route.area)) return undefined;
        if (route.joinLines) {
            // A line that is part of a sentence spread over several components shows its share
            // of that sentence's translation, even when it would also match a key on its own.
            const joined = this.joinedLine(event, route);
            if (joined !== null) return { text: joined };
        }
        const text = this.translateWidgetText(event.text, event.groupId, route);
        if (text === null) return undefined;
        if (!route.dialogue || this.config.enableTextWrapFix() === false || !event.font) return { text };
        const lineHeight = fitLineHeight(text, event.width, event.height, event.lineHeight, event.font);
        return lineHeight === undefined ? { text } : { text, lineHeight };
    }

    /**
     * The skill guide's paragraphs: script 9183 lays a body out one component per word, so the
     * body is translated as it starts (its argument is still on the stack) and the game wraps the
     * translation itself. Upstream can't translate these; it sees only single words.
     */
    onScriptPreFired(scriptId: number, vm?: Cs2Vm): void {
        if (scriptId !== SKILL_GUIDE_BODY_SCRIPT || !vm || !this.isStarted() || this.state.isEmpty) return;
        if (!this.areaEnabled("skillGuide")) return;
        const slot = vm.stringStackSize - 1;
        const body = vm.stringStack[slot];
        if (typeof body !== "string" || !body) return;
        const translated = translateGuideBody(body, (text) => this.state.skills.translate(text) ?? this.state.general.translate(text));
        if (translated !== body) vm.stringStack[slot] = translated;
    }

    /** Menu options only, from the menu dictionary (upstream never translates targets). */
    translateMenuOption(option: string): string | undefined {
        const result = this.menuOption(option);
        if (this.coverage.enabled && this.isStarted()) this.coverage.record("menu", option, result);
        return result;
    }

    private menuOption(option: string): string | undefined {
        if (!this.isStarted() || this.config.enableMenuEntries() === false) return undefined;
        const clean = option.replace(TAG, "").trim();
        if (!clean) return undefined;
        const translation = this.state.menu.translate(clean);
        if (translation === null || translation === clean) return undefined;
        return option.split(clean).join(translation);
    }

    npcOverheadText({ text }: { npcIndex: number; text: string }): string | undefined {
        if (!this.isStarted() || this.config.enableOverhead() === false) return undefined;
        const clean = normalizeLookupText(cleanText(text));
        if (clean.length <= 3) return undefined;
        const translation = this.state.overhead.translate(clean) ?? undefined;
        this.coverage.record("overhead", text, translation);
        return translation;
    }

    /**
     * RuneLite's chatbox scripts build each line through "chatMessageBuilding": ints
     * [..., splitpmbox, uid], strings [..., channel, name, message, timestamp]. The message is
     * replaced before the script measures the line, so it wraps as drawn; the history keeps
     * the game's text.
     */
    onScriptCallback({ eventName, vm }: ScriptCallbackEvent): void {
        if (eventName !== "chatMessageBuilding" || !this.isStarted() || this.state.isEmpty) return;
        if (this.config.enableGameMessages() === false) return;
        const node = this.history.getByUid(vm.intStack[vm.intStackSize - 1]);
        if (!node) return;
        const isWelcome = node.type === WELCOME;
        if (!GAME_MESSAGE_TYPES.has(node.type) && !(isWelcome && this.config.enableWelcome() !== false)) return;
        const slot = vm.stringStackSize - 2;
        const message = vm.stringStack[slot];
        if (typeof message !== "string") return;
        const translated = this.translateChatMessage(message);
        this.coverage.record("chat", message, translated);
        if (translated !== null) vm.stringStack[slot] = translated;
    }

    /**
     * `::translatecoverage on|off|report|reset`: the developer counter. It records what the
     * plugin is asked to translate while on; `report` prints the share translated and lists the
     * English that remains in the console (and `window.__osrsTranslateCoverage`).
     */
    handleClientCommand(command: string): boolean {
        const [name, action = "report"] = command.trim().split(/\s+/);
        if (name.toLowerCase() !== "translatecoverage") return false;
        const say = (text: string) => this.history.addMessage("game", `[OSRS Translate] ${text}`);
        switch (action.toLowerCase()) {
            case "on":
                this.coverage.enabled = true;
                this.host.refresh();
                say(this.isStarted() ? "coverage counter on" : "coverage counter on (turn the plugin on to record)");
                break;
            case "off":
                this.coverage.enabled = false;
                say("coverage counter off");
                break;
            case "reset":
                this.coverage.reset();
                say("coverage counter reset");
                break;
            default: {
                const report = this.coverage.report();
                say(`${report.translated} of ${report.seen} texts seen translated (${report.percent}%)`);
                const table = report.untranslated.map((entry) => ({ where: entry.where, text: entry.text, count: entry.count }));
                (globalThis as { __osrsTranslateCoverage?: unknown }).__osrsTranslateCoverage = { ...report, untranslated: table };
                console.table(table.slice(0, 200));
            }
        }
        return true;
    }

    /** OsrsTranslatePlugin.onChatMessage's lookup, keeping Chat Filter's " (n)" and a highlight's colour. */
    translateChatMessage(message: string): string | null {
        const [body, suffix] = splitCollapseSuffix(message);
        // A highlight's tags become spaces; normalising drops the one left before punctuation.
        const clean = normalizeLookupText(cleanText(body));
        if (!clean || this.state.gameMessage.values.has(clean)) return null;
        // Filled from the tagged text where it matches, so a coloured track or item name stays coloured.
        const translation = this.state.gameMessage.translate(clean, richLookupText(body));
        if (translation === null) return null;
        // Line breaks only: in the chatbox "</col>" returns to the line's own colour (white on a
        // transparent chatbox), so upstream's overlay rewrite to black does not apply here.
        return preserveStartTags(body) + translation.replace(/<br\s*\/?>/gi, "\n") + suffix;
    }
}

/**
 * The line height that fits `text` in the component, when its own does not. The server picks a
 * dialogue's line height from the English line count (two lines 28, three 20, four 16), so a
 * translation one line longer would run into "Click here to continue". Undefined when it fits.
 */
export function fitLineHeight(
    text: string,
    width: number,
    height: number,
    lineHeight: number,
    font: WidgetTextFont,
): number | undefined {
    const fontLineHeight = font.lineHeight || font.ascent || 12;
    const current = lineHeight || fontLineHeight;
    const lines = wrapTextToWidth(text, Math.max(1, width), (s) => font.measure(s.replace(TAG, ""))).length;
    if (lines <= 1) return undefined;
    const ascent = font.maxAscent ?? font.ascent;
    const descent = font.maxDescent ?? 0;
    if (ascent + (lines - 1) * current + descent <= height) return undefined;
    const fit = Math.floor((height - ascent - descent) / (lines - 1));
    const result = Math.min(current, Math.max(fontLineHeight, fit));
    return result < current ? result : undefined;
}
