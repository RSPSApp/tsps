/*
 * Copyright (c) 2026, Walter Rezende
 * All rights reserved.
 *
 * Ported to TypeScript from OSRS Translate PT-BR (TranslationState, TranslationRepository and
 * OsrsTranslatePlugin.domainForInterface). BSD 2-Clause License, see ./LICENSE.
 */
import * as InterfaceID from "@runelite/api/gameval/InterfaceID";
import { TranslationDomain } from "./TranslationLookup";

/** The dictionary files every language folder holds (RemoteTranslationService.REQUIRED_FILES). */
export const REQUIRED_FILES = [
    "translations.json",
    "translations_skills.json",
    "translations_quests.json",
    "translations_items.json",
    "translations_menu.json",
    "translations_overhead.json",
    "translations_game_message.json",
    "translations_welcome.json",
    "translations_settings.json",
] as const;

export type DictionaryFile = (typeof REQUIRED_FILES)[number];
export type DictionaryData = Partial<Record<DictionaryFile, ReadonlyMap<string, string>>>;

/** One language's dictionaries. Upstream compiles placeholder patterns for four of them. */
export class TranslationState {
    readonly general: TranslationDomain;
    readonly skills: TranslationDomain;
    readonly quests: TranslationDomain;
    readonly items: TranslationDomain;
    readonly menu: TranslationDomain;
    readonly overhead: TranslationDomain;
    readonly gameMessage: TranslationDomain;
    readonly welcome: TranslationDomain;
    readonly settings: TranslationDomain;

    constructor(data: DictionaryData, readonly version = "") {
        const map = (file: DictionaryFile) => data[file] ?? new Map<string, string>();
        this.general = new TranslationDomain(map("translations.json"), true);
        this.skills = new TranslationDomain(map("translations_skills.json"), false);
        this.quests = new TranslationDomain(map("translations_quests.json"), false);
        this.items = new TranslationDomain(map("translations_items.json"), false);
        this.menu = new TranslationDomain(map("translations_menu.json"), false);
        this.overhead = new TranslationDomain(map("translations_overhead.json"), true);
        this.gameMessage = new TranslationDomain(map("translations_game_message.json"), true);
        this.welcome = new TranslationDomain(map("translations_welcome.json"), true);
        this.settings = new TranslationDomain(map("translations_settings.json"), false);
    }

    static empty(): TranslationState {
        return new TranslationState({});
    }

    get isEmpty(): boolean {
        return this.general.size === 0 && this.menu.size === 0 && this.gameMessage.size === 0;
    }
}

/** Which config toggle governs an interface, and which dictionary it reads. */
export type Area =
    | "dialogues"
    | "skillGuide"
    | "questJournal"
    | "achievementDiary"
    | "items"
    | "clueScrolls"
    | "menuInterfaces"
    | "gameMessages"
    | "welcome"
    | "settings"
    | "sidePanels";

export type Domain = keyof Pick<
    TranslationState,
    "general" | "skills" | "quests" | "items" | "menu" | "gameMessage" | "welcome" | "settings"
>;

export interface InterfaceRoute {
    readonly area: Area;
    /** The dictionary upstream reads for this interface. */
    readonly domain: Domain;
    /** Further dictionaries to try, in order, when the first has no entry. */
    readonly fallback?: readonly Domain[];
    /** The server pre-wraps this text and picks its line height from the English line count. */
    readonly dialogue?: boolean;
    /** One line per component (journals, books): a sentence may span the next few. */
    readonly joinLines?: boolean;
}

/** The dictionaries a route reads, in order. */
export function routeDomains(route: InterfaceRoute): readonly Domain[] {
    return route.fallback ? [route.domain, ...route.fallback] : [route.domain];
}

const route = (area: Area, domain: Domain, dialogue = false): InterfaceRoute => ({ area, domain, dialogue });
const lines = (area: Area, domain: Domain): InterfaceRoute => ({ area, domain, joinLines: true });
const panel = (domain: Domain, ...fallback: Domain[]): InterfaceRoute => ({ area: "sidePanels", domain, fallback });
const uid = (group: number, child: number): number => ((group << 16) | child) >>> 0;

/**
 * Interfaces upstream translates, by group id. Any other group (the chatbox, friends, private
 * messages, bank search) is left alone: upstream falls back to the dialogue dictionary for
 * unknown groups, which would rewrite player-typed text that happens to match a key.
 */
export const INTERFACE_ROUTES: ReadonlyMap<number, InterfaceRoute> = new Map([
    // Dialogue: NPC, player, options, item/sprite boxes, message box, level-up.
    [InterfaceID.CHAT_LEFT, route("dialogues", "general", true)],
    [InterfaceID.CHAT_RIGHT, route("dialogues", "general", true)],
    [InterfaceID.CHATMENU, route("dialogues", "general")],
    [InterfaceID.OBJECTBOX, route("dialogues", "general", true)],
    [InterfaceID.OBJECTBOX_DOUBLE, route("dialogues", "general", true)],
    [InterfaceID.MESSAGEBOX, route("dialogues", "general", true)],
    [InterfaceID.LEVELUP_DISPLAY, route("dialogues", "general")],
    // Skill guide (both layouts).
    [InterfaceID.SKILL_GUIDE, route("skillGuide", "skills")],
    [InterfaceID.SKILL_GUIDE_V2, route("skillGuide", "skills")],
    // Quest journal, quest scroll and the journal overview.
    [InterfaceID.QUESTJOURNAL, lines("questJournal", "quests")],
    [InterfaceID.QUESTJOURNAL_OVERVIEW, route("questJournal", "quests")],
    [InterfaceID.QUESTSCROLL, lines("questJournal", "quests")],
    // Achievement diaries.
    [InterfaceID.AREA_TASK, route("achievementDiary", "quests")],
    [InterfaceID.JOURNALSCROLL, lines("achievementDiary", "quests")],
    // Books and notes; clue scroll text shares the items dictionary.
    [InterfaceID.INDEXED_BOOK, lines("items", "items")],
    [InterfaceID.TRAIL_CLUETEXT, route("clueScrolls", "items")],
    // Character creation, tutorial prompts, emotes and gold crafting: the menu dictionary.
    [InterfaceID.PLAYER_DESIGN, route("menuInterfaces", "menu")],
    [InterfaceID.TUTORIAL_PLAYER_EXPERIENCE, route("menuInterfaces", "menu")],
    [InterfaceID.TUTORIAL_DISPLAYNAME, route("menuInterfaces", "menu")],
    [InterfaceID.MACRO_MIME_EMOTES, route("menuInterfaces", "menu")],
    [InterfaceID.CRAFTING_GOLD, route("menuInterfaces", "menu")],
    // The game-message overlay over the chatbox (e.g. "Congratulations, you just advanced...").
    [InterfaceID.MESOVERLAY, route("gameMessages", "gameMessage")],
    [InterfaceID.WELCOME_SCREEN, route("welcome", "welcome")],
    [InterfaceID.SETTINGS, route("settings", "settings")],
    [InterfaceID.BANKPIN_KEYPAD, route("settings", "settings")],
    [InterfaceID.TOPLEVEL_OSRS_STRETCH, route("settings", "settings")],
    // Beyond upstream: side panels, each reading the dictionaries their text is filed in. Panels
    // that show player names (friends, ignore, the character summary's title) skip the general
    // dictionary, whose many one-word keys could match a name.
    [InterfaceID.QUESTLIST, panel("quests", "menu", "general")],
    [InterfaceID.ACCOUNT_SUMMARY_SIDEPANEL, panel("menu", "settings")],
    [InterfaceID.SETTINGS_SIDE, panel("settings", "menu")],
    [InterfaceID.COMBAT_INTERFACE, panel("menu", "general", "settings")],
    [InterfaceID.FRIENDS, panel("menu", "settings")],
    [InterfaceID.IGNORE, panel("menu", "settings")],
    [InterfaceID.LOGOUT, panel("menu", "general", "settings")],
    [InterfaceID.MUSIC, panel("menu", "general", "settings")],
    [InterfaceID.WORNITEMS, panel("menu", "general", "settings")],
]);

/**
 * Single components routed in a group that is otherwise left alone: the chatbox's tab labels and
 * their status lines (its chat lines, input and search prompts must never be rewritten).
 */
export const COMPONENT_ROUTES: ReadonlyMap<number, InterfaceRoute> = new Map(
    [6, 9, 10, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33].map((child) => [uid(InterfaceID.CHATBOX, child), panel("menu", "settings", "general")]),
);

/**
 * Text that scripts create inside a container, routed by that container: the toplevel mouseover
 * layers (prayer, skill and orb tooltips; the "/ N more options" label) in each layout, and the
 * spellbook's tooltip box. Without this, 161's text would be read from the settings dictionary.
 */
export const PARENT_ROUTES: ReadonlyMap<number, InterfaceRoute> = new Map(
    [
        uid(InterfaceID.TOPLEVEL_OSRS_STRETCH, 37),
        uid(InterfaceID.TOPLEVEL, 5),
        uid(InterfaceID.TOPLEVEL_PRE_EOC, 69),
        uid(InterfaceID.TOPLEVEL_DISPLAY, 36),
        uid(InterfaceID.TOPLEVEL_OSM, 132),
        uid(InterfaceID.MAGIC_SPELLBOOK, 210),
    ].map((parent) => [parent, panel("general", "menu", "skills")]),
);

/** The route for a drawn component: its own, its container's, or its interface's. */
export function routeFor(event: { uid?: number; parentUid?: number; groupId: number }): InterfaceRoute | undefined {
    return (event.uid !== undefined ? COMPONENT_ROUTES.get(event.uid >>> 0) : undefined)
        ?? (event.parentUid !== undefined ? PARENT_ROUTES.get(event.parentUid >>> 0) : undefined)
        ?? INTERFACE_ROUTES.get(event.groupId);
}
