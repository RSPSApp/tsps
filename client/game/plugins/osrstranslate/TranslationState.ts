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
    | "settings";

export interface InterfaceRoute {
    readonly area: Area;
    readonly domain: keyof Pick<
        TranslationState,
        "general" | "skills" | "quests" | "items" | "menu" | "gameMessage" | "welcome" | "settings"
    >;
    /** The server pre-wraps this text and picks its line height from the English line count. */
    readonly dialogue?: boolean;
    /** One line per component (journals, books): a sentence may span the next few. */
    readonly joinLines?: boolean;
}

const route = (area: Area, domain: InterfaceRoute["domain"], dialogue = false): InterfaceRoute => ({ area, domain, dialogue });
const lines = (area: Area, domain: InterfaceRoute["domain"]): InterfaceRoute => ({ area, domain, joinLines: true });

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
]);
