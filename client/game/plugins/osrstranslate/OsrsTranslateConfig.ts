/*
 * Copyright (c) 2026, Walter Rezende
 * All rights reserved.
 *
 * Ported to TypeScript from OSRS Translate PT-BR (OsrsTranslateConfig and
 * OsrsTranslateConfigLocalization). BSD 2-Clause License, see ./LICENSE.
 */
import { ConfigGroup, ConfigItem, ConfigSection, type ConfigViewLabels } from "@runelite/client/config/ConfigItem";
import { DEFAULT_MANIFEST_URL } from "./TranslationRepository";

export type TranslationLanguage = "PORTUGUESE_BRAZIL" | "SPANISH";

/** The folder each language's dictionaries live in, in the author's repository. */
export const LANGUAGE_FOLDERS: Record<TranslationLanguage, string> = {
    PORTUGUESE_BRAZIL: "pt-BR",
    SPANISH: "ESP",
};

const LANGUAGE = "language";
const STATIC = "staticTranslations";
const VISUAL = "visualFixes";

type Label = { name: string; description?: string };
type Labels = Record<TranslationLanguage, Label>;

const pt = (name: string, description?: string): Label => ({ name, description });
const es = pt;

/** Upstream's panel labels (OsrsTranslateConfigLocalization), in both languages. */
const ITEM_LABELS: Record<string, Labels> = {
    translationLanguage: {
        PORTUGUESE_BRAZIL: pt("Idioma", "Seleciona o idioma baixado do repositório oficial"),
        SPANISH: es("Idioma", "Selecciona el idioma descargado del repositorio oficial"),
    },
    enableDialogues: {
        PORTUGUESE_BRAZIL: pt("Traduzir diálogos", "Traduz diálogos de NPCs, opções, sprites e ações"),
        SPANISH: es("Traducir diálogos", "Traduce diálogos de NPC, opciones, sprites y acciones"),
    },
    enableSkillGuide: {
        PORTUGUESE_BRAZIL: pt("Traduzir Skill Guide", "Traduz textos do Skill Guide"),
        SPANISH: es("Traducir guía de habilidades", "Traduce textos de la guía de habilidades"),
    },
    enableQuestJournal: {
        PORTUGUESE_BRAZIL: pt("Traduzir Quest Journal", "Traduz textos do Quest Journal"),
        SPANISH: es("Traducir diario de misiones", "Traduce textos del diario de misiones"),
    },
    enableAchievementDiary: {
        PORTUGUESE_BRAZIL: pt("Traduzir Achievement Diary", "Traduz textos dos diários de conquistas"),
        SPANISH: es("Traducir diario de logros", "Traduce textos de los diarios de logros"),
    },
    enableItems: {
        PORTUGUESE_BRAZIL: pt("Traduzir livros", "Traduz textos de livros e notas no jogo"),
        SPANISH: es("Traducir libros", "Traduce textos de libros y notas del juego"),
    },
    enableMenuEntries: {
        PORTUGUESE_BRAZIL: pt("Traduzir opções de menu", "Traduz opções de menu dos npcs, objetos e clique direito"),
        SPANISH: es("Traducir opciones de menú", "Traduce opciones de menú de NPC, objetos y clic derecho"),
    },
    enableOverhead: {
        PORTUGUESE_BRAZIL: pt("Traduzir falas acima da cabeça", "Traduz textos que aparecem acima da cabeça dos NPCs"),
        SPANISH: es("Traducir textos sobre la cabeza", "Traduce textos que aparecen sobre la cabeza de los NPC"),
    },
    enableGameMessages: {
        PORTUGUESE_BRAZIL: pt("Traduzir mensagens do jogo", "Traduz mensagens do jogo como examinar, ações que aparecem no chat do jogo"),
        SPANISH: es("Traducir mensajes del juego", "Traduce mensajes del juego, como examinar y acciones que aparecen en el chat"),
    },
    enableWelcome: {
        PORTUGUESE_BRAZIL: pt("Traduzir boas-vindas", "Traduz a tela e mensagens de boas-vindas"),
        SPANISH: es("Traducir bienvenida", "Traduce la pantalla y los mensajes de bienvenida"),
    },
    enableSettings: {
        PORTUGUESE_BRAZIL: pt("Traduzir Settings", "Traduz textos da interface de configuracoes"),
        SPANISH: es("Traducir configuración", "Traduce los textos de la interfaz de configuración"),
    },
    enableClueScrolls: {
        PORTUGUESE_BRAZIL: pt("Traduzir clue scrolls", "Traduz o texto dos pergaminhos de pistas"),
        SPANISH: es("Traducir clue scrolls", "Traduce el texto de los pergaminos de pistas"),
    },
    enableSidePanels: {
        PORTUGUESE_BRAZIL: pt("Traduzir painéis laterais", "Traduz a lista de quests, o resumo do personagem, as dicas de feitiços e orações, as abas do chat e outros painéis"),
        SPANISH: es("Traducir paneles laterales", "Traduce la lista de misiones, el resumen del personaje, las descripciones de hechizos y plegarias, las pestañas del chat y otros paneles"),
    },
    enableTextWrapFix: {
        PORTUGUESE_BRAZIL: pt("Espaçamento entre linhas", "Ajusta automaticamente a altura das linhas quando o texto traduzido é maior"),
        SPANISH: es("Espaciado entre líneas", "Ajusta automáticamente la altura de las líneas cuando el texto traducido es más largo"),
    },
};

const SECTION_LABELS: Record<string, Record<TranslationLanguage, string>> = {
    [LANGUAGE]: { PORTUGUESE_BRAZIL: "Idioma", SPANISH: "Idioma" },
    [STATIC]: { PORTUGUESE_BRAZIL: "Traduções Estáticas", SPANISH: "Traducciones estáticas" },
    [VISUAL]: { PORTUGUESE_BRAZIL: "Correções Visuais", SPANISH: "Correcciones visuales" },
};

/** Upstream's "Back" and "Reset"; the reset question is worded to match. */
const VIEW_LABELS: Record<TranslationLanguage, ConfigViewLabels> = {
    PORTUGUESE_BRAZIL: {
        back: "Voltar",
        reset: "Redefinir",
        resetConfirm: (name) => `Redefinir todas as configurações de ${name} para o padrão?`,
    },
    SPANISH: {
        back: "Atrás",
        reset: "Restablecer",
        resetConfirm: (name) => `¿Restablecer todos los ajustes de ${name} a sus valores predeterminados?`,
    },
};

/** The language the settings are shown in, set by localizeOsrsTranslateConfig. */
let shownLanguage: TranslationLanguage = "PORTUGUESE_BRAZIL";

const toggle = (key: string, section: string, position: number) =>
    ConfigItem<boolean>({ keyName: key, ...ITEM_LABELS[key].PORTUGUESE_BRAZIL, section, position, default: true });

/**
 * Upstream's group and keys. Its developer options (local JSON folder and hot reload) are left
 * out: a browser can't read a folder, and the dictionaries come from the author's repository.
 */
export const OsrsTranslateConfig = ConfigGroup(
    "osrstranslate",
    {
        translationLanguage: ConfigItem<TranslationLanguage>({
            keyName: "translationLanguage",
            ...ITEM_LABELS.translationLanguage.PORTUGUESE_BRAZIL,
            section: LANGUAGE,
            position: 0,
            enum: { PORTUGUESE_BRAZIL: "PORTUGUESE_BRAZIL", SPANISH: "SPANISH" },
            enumLabels: { PORTUGUESE_BRAZIL: "Português", SPANISH: "Español" },
            default: "PORTUGUESE_BRAZIL",
        }),
        enableDialogues: toggle("enableDialogues", STATIC, 0),
        enableSkillGuide: toggle("enableSkillGuide", STATIC, 1),
        enableQuestJournal: toggle("enableQuestJournal", STATIC, 2),
        enableAchievementDiary: toggle("enableAchievementDiary", STATIC, 3),
        enableItems: toggle("enableItems", STATIC, 4),
        enableMenuEntries: toggle("enableMenuEntries", STATIC, 5),
        enableOverhead: toggle("enableOverhead", STATIC, 6),
        enableGameMessages: toggle("enableGameMessages", STATIC, 7),
        enableWelcome: toggle("enableWelcome", STATIC, 8),
        enableSettings: toggle("enableSettings", STATIC, 9),
        enableClueScrolls: toggle("enableClueScrolls", STATIC, 10),
        enableSidePanels: toggle("enableSidePanels", STATIC, 11),
        enableTextWrapFix: toggle("enableTextWrapFix", VISUAL, 0),
        manifestUrl: ConfigItem<string>({
            keyName: "manifestUrl",
            name: "Manifest URL",
            description: "Where the dictionaries' manifest is read from",
            hidden: true,
            default: DEFAULT_MANIFEST_URL,
        }),
    },
    {
        // The settings view's own Back and Reset, in the chosen language (upstream relabels
        // RuneLite's panel the same way while its settings are open).
        viewLabels: () => VIEW_LABELS[shownLanguage],
        sections: {
            [LANGUAGE]: ConfigSection({ name: SECTION_LABELS[LANGUAGE].PORTUGUESE_BRAZIL, position: 0 }),
            [STATIC]: ConfigSection({ name: SECTION_LABELS[STATIC].PORTUGUESE_BRAZIL, position: 1 }),
            [VISUAL]: ConfigSection({ name: SECTION_LABELS[VISUAL].PORTUGUESE_BRAZIL, position: 2 }),
        },
    },
);

/**
 * Shows the settings in `language`, as upstream relabels its config panel. The panel reads the
 * labels from this group each time it redraws, and it redraws on every change to the group, so
 * relabelling before that redraw is enough.
 */
export function localizeOsrsTranslateConfig(language: unknown): void {
    const lang: TranslationLanguage = language === "SPANISH" ? "SPANISH" : "PORTUGUESE_BRAZIL";
    shownLanguage = lang;
    for (const [key, labels] of Object.entries(ITEM_LABELS)) {
        const item = OsrsTranslateConfig.items[key];
        if (!item) continue;
        item.name = labels[lang].name;
        item.description = labels[lang].description;
    }
    for (const [key, labels] of Object.entries(SECTION_LABELS)) {
        const section = OsrsTranslateConfig.sections?.[key];
        if (section) section.name = labels[lang];
    }
}
