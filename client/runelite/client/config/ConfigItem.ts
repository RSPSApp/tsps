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
    /** Enum values shown as a dropdown, in declaration order. */
    enum?: Record<string, unknown>;
    default: T;
}

export function ConfigItem<T>(options: ConfigItemDef<T>): ConfigItemDef<T> {
    return options;
}

export interface ConfigGroupOptions {
    sections?: Record<string, ConfigSectionDef>;
}

export interface ConfigGroupDescriptor {
    group: string;
    items: Record<string, ConfigItemDef<any>>;
    sections?: Record<string, ConfigSectionDef>;
}

export function ConfigGroup(
    group: string,
    items: Record<string, ConfigItemDef<any>>,
    options?: ConfigGroupOptions,
): ConfigGroupDescriptor {
    return { group, items, sections: options?.sections };
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
