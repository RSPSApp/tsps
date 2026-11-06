import type { EventClass } from "../../api/events";

export interface ConfigSectionDef {
    name: string;
    position?: number;
    closedByDefault?: boolean;
}

export function ConfigSection(options: ConfigSectionDef): ConfigSectionDef {
    return options;
}

export interface ConfigItemDef<T = unknown> {
    /** Storage key. Defaults to the descriptor's property name. */
    keyName?: string;
    name: string;
    description?: string;
    position?: number;
    section?: string;
    hidden?: boolean;
    secret?: boolean;
    textArea?: boolean;
    warning?: string;
    /** Mark value as a colour; serialised as #RRGGBB / #AARRGGBB. */
    color?: boolean;
    /** Accept an alpha channel in the generated colour picker. */
    alpha?: boolean;
    units?: string;
    range?: { min?: number; max?: number };
    /** Step of a number field; whole numbers unless set (RuneLite's `double` items). */
    step?: number;
    /** Enum values shown as a dropdown, in declaration order. */
    enum?: Record<string, unknown>;
    /** What the dropdown shows for each enum name (RuneLite's enum toString), when not the name. */
    enumLabels?: Record<string, string>;
    /** A Keybind (RuneLite's Keybind), stored as "keyCode:modifiers". */
    keybind?: boolean;
    /** A FontType (RuneLite's FontType items), edited in its own Font panel. */
    fontType?: boolean;
    default: T;
}

export function ConfigItem<T>(options: ConfigItemDef<T>): ConfigItemDef<T> {
    return options;
}

/**
 * Words the settings view shows around a group's items, for a plugin whose settings are in
 * another language. Read each time the view draws; any left out stay English.
 */
export interface ConfigViewLabels {
    back?: string;
    reset?: string;
    /** The question before resetting, given the plugin's name. */
    resetConfirm?: (pluginName: string) => string;
}

export interface ConfigGroupOptions {
    sections?: Record<string, ConfigSectionDef>;
    viewLabels?: () => ConfigViewLabels;
}

export interface ConfigGroupDescriptor {
    group: string;
    items: Record<string, ConfigItemDef<any>>;
    sections?: Record<string, ConfigSectionDef>;
    viewLabels?: () => ConfigViewLabels;
}

export function ConfigGroup(
    group: string,
    items: Record<string, ConfigItemDef<any>>,
    options?: ConfigGroupOptions,
): ConfigGroupDescriptor {
    return { group, items, sections: options?.sections, ...(options?.viewLabels ? { viewLabels: options.viewLabels } : {}) };
}

export function isConfigGroupDescriptor(value: unknown): value is ConfigGroupDescriptor {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as ConfigGroupDescriptor).group === "string" &&
        typeof (value as ConfigGroupDescriptor).items === "object"
    );
}

type ConfigItemValue<T> = T extends ConfigItemDef<infer V> ? V : never;

/** The accessor object RuneLite config interfaces become in TypeScript. */
export type ConfigOf<D extends ConfigGroupDescriptor> = {
    [K in keyof D["items"]]: () => ConfigItemValue<D["items"][K]>;
};

export type ConfigToken = ConfigGroupDescriptor | EventClass;
