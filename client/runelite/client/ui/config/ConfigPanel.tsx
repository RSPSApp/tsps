import { useEffect, useMemo, useState } from "react";

import {
    type ConfigGroupDescriptor,
    type ConfigItemDef,
    type ConfigSectionDef,
} from "@runelite/client/config/ConfigItem";
import { parseConfigValue } from "@runelite/client/config/ConfigManager";
import { FontType } from "@runelite/client/config/FontType";
import { Keybind } from "@runelite/client/config/Keybind";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import { runeliteImage } from "../runeliteImages";

const DEFAULT_SECTION = "";

type OrderedItem = {
    property: string;
    item: ConfigItemDef;
    section: string;
};

function toColorInput(value: unknown): string {
    const color = Number(value) >>> 0;
    const hex = (color & 0xffffff).toString(16).padStart(6, "0");
    return `#${hex}`;
}

function orderItems(descriptor: ConfigGroupDescriptor): OrderedItem[] {
    const items = Object.entries(descriptor.items)
        .filter(([, item]) => !item.hidden)
        .map(([property, item], index) => ({
            property,
            item,
            section: item.section ?? DEFAULT_SECTION,
            index,
        }));
    items.sort((a, b) => {
        const sectionA = a.section === DEFAULT_SECTION ? -1 : descriptor.sections?.[a.section]?.position ?? 0;
        const sectionB = b.section === DEFAULT_SECTION ? -1 : descriptor.sections?.[b.section]?.position ?? 0;
        if (sectionA !== sectionB) return sectionA - sectionB;
        const positionA = a.item.position ?? a.index;
        const positionB = b.item.position ?? b.index;
        return positionA - positionB;
    });
    return items.map(({ property, item, section }) => ({ property, item, section }));
}

function groupBySection(
    descriptor: ConfigGroupDescriptor,
    items: OrderedItem[],
): Array<{ id: string; section?: ConfigSectionDef; items: OrderedItem[] }> {
    const groups: Array<{ id: string; section?: ConfigSectionDef; items: OrderedItem[] }> = [];
    for (const entry of items) {
        let group = groups.find((candidate) => candidate.id === entry.section);
        if (!group) {
            group = {
                id: entry.section,
                section: entry.section === DEFAULT_SECTION ? undefined : descriptor.sections?.[entry.section],
                items: [],
            };
            groups.push(group);
        }
        group.items.push(entry);
    }
    return groups;
}

function ConfigField({
    descriptor,
    property,
    item,
    configManager,
    onOpenFont,
}: {
    descriptor: ConfigGroupDescriptor;
    property: string;
    item: ConfigItemDef;
    configManager: ConfigManager;
    onOpenFont: (property: string) => void;
}): JSX.Element {
    const key = item.keyName ?? property;
    const raw = configManager.getConfiguration(descriptor.group, key);
    const value = parseConfigValue(item, raw ?? null);
    const update = (next: unknown) => configManager.setConfigValue(descriptor, property, next);
    const label = (
        <span className="rl-config-label">
            <span>{item.name}</span>
            {item.description ? (
                <span className="rl-config-description">{item.description}</span>
            ) : null}
            {item.warning ? <span className="rl-config-warning">{item.warning}</span> : null}
        </span>
    );

    if (item.enum) {
        const enumEntries = Object.entries(item.enum);
        const selectedName =
            enumEntries.find(
                ([, enumValue]) =>
                    enumValue === value || String(enumValue) === String(value),
            )?.[0] ?? String(value);
        return (
            <label className="rl-sidebar-field">
                {label}
                <select
                    value={selectedName}
                    onChange={(event) => {
                        const entry = enumEntries.find(([name]) => name === event.target.value);
                        update(entry ? entry[1] : event.target.value);
                    }}
                >
                    {enumEntries.map(([name]) => (
                        <option key={name} value={name}>
                            {item.enumLabels?.[name] ?? name}
                        </option>
                    ))}
                </select>
            </label>
        );
    }

    if (item.keybind) {
        return (
            <label className="rl-sidebar-field">
                {label}
                <KeybindButton value={value instanceof Keybind ? value : Keybind.NOT_SET} onChange={update} />
            </label>
        );
    }

    if (item.fontType) {
        // RuneLite's createFont: a button that opens the font's own panel.
        return (
            <div className="rl-sidebar-row rl-sidebar-value-row">
                <span className="rl-sidebar-field">{label}</span>
                <button
                    type="button"
                    className="rl-config-font-button"
                    onClick={() => onOpenFont(property)}
                    aria-label={`${item.name} settings`}
                    title="Edit font"
                >
                    <img src={runeliteImage("config_edit_icon.png")} alt="" width={18} height={18} />
                </button>
            </div>
        );
    }

    if (typeof item.default === "boolean") {
        return (
            <label className="rl-sidebar-check">
                <input
                    type="checkbox"
                    checked={value === true}
                    onChange={(event) => update(event.target.checked)}
                />
                {label}
            </label>
        );
    }

    if (item.color) {
        // RuneLite's @Alpha colours: no alpha bits means opaque.
        const argb = Number(value) >>> 0;
        const alpha = item.alpha ? (argb >>> 24) || 255 : 255;
        const withAlpha = (rgb: number, a: number) =>
            item.alpha ? ((a & 0xff) << 24 | (rgb & 0xffffff)) >>> 0 : rgb & 0xffffff;
        return (
            <div className="rl-sidebar-row rl-sidebar-value-row">
                <label className="rl-sidebar-field">{label}</label>
                <input
                    className="rl-sidebar-color-input"
                    type="color"
                    value={toColorInput(argb & 0xffffff)}
                    onChange={(event) => {
                        const color = parseInt(event.target.value.slice(1), 16) || 0;
                        update(withAlpha(color, alpha));
                    }}
                />
                {item.alpha && (
                    <input
                        className="rl-sidebar-alpha-input"
                        type="range"
                        min={1}
                        max={255}
                        aria-label={`${label} alpha`}
                        title={`Alpha ${alpha}`}
                        value={alpha}
                        onChange={(event) => update(withAlpha(argb, Number(event.target.value)))}
                    />
                )}
            </div>
        );
    }

    if (typeof item.default === "number") {
        return (
            <label className="rl-sidebar-field">
                {label}
                <input
                    type="number"
                    min={item.range?.min}
                    max={item.range?.max}
                    step={item.step}
                    value={Number(value)}
                    onChange={(event) => {
                        const numeric = Number(event.target.value);
                        update(Number.isFinite(numeric) ? numeric : item.default);
                    }}
                />
                {item.units ? <span className="rl-config-units">{item.units}</span> : null}
            </label>
        );
    }

    if (item.textArea) {
        return (
            <label className="rl-sidebar-field">
                {label}
                <textarea
                    className="rl-sidebar-textarea"
                    rows={3}
                    value={String(value)}
                    onChange={(event) => update(event.target.value)}
                />
            </label>
        );
    }

    return (
        <label className="rl-sidebar-field">
            {label}
            <input
                type={item.secret ? "password" : "text"}
                value={String(value)}
                onChange={(event) => update(event.target.value)}
            />
        </label>
    );
}

/**
 * RuneLite's FontPanel for one FontType item: the font family, its size in points and bold.
 * Each change is saved at once. Italic is not offered.
 */
function FontPanel({
    descriptor,
    property,
    item,
    configManager,
    onBack,
}: {
    descriptor: ConfigGroupDescriptor;
    property: string;
    item: ConfigItemDef;
    configManager: ConfigManager;
    onBack: () => void;
}): JSX.Element {
    const load = (): FontType => {
        const raw = configManager.getConfiguration(descriptor.group, item.keyName ?? property);
        const value = parseConfigValue(item, raw ?? null);
        return value instanceof FontType ? value : FontType.REGULAR;
    };
    const save = (font: FontType) => configManager.setConfigValue(descriptor, property, font);
    const font = load();
    return (
        <div className="rl-config-font-panel">
            <div className="rl-config-font-header">
                <button type="button" className="rl-plugin-config-back" onClick={onBack} aria-label="Back" title="Back">
                    <svg viewBox="0 0 12 20" aria-hidden="true">
                        <path d="M8.4 3.1 3.9 10l4.5 6.9" />
                    </svg>
                </button>
                <span className="rl-plugin-config-title">{item.name}</span>
            </div>
            <label className="rl-sidebar-field">
                <span className="rl-config-label">
                    <span>Font</span>
                    <span className="rl-config-description">Configures the font.</span>
                </span>
                <select value={font.family} onChange={(event) => save(load().withFamily(event.target.value))}>
                    {FontType.FAMILIES.map((family) => (
                        <option key={family} value={family}>
                            {family}
                        </option>
                    ))}
                </select>
            </label>
            <label className="rl-sidebar-field">
                <span className="rl-config-label">
                    <span>Size</span>
                    <span className="rl-config-description">Configures the font size.</span>
                </span>
                <input
                    type="number"
                    min={FontType.MIN_SIZE}
                    max={FontType.MAX_SIZE}
                    step={1}
                    value={font.size}
                    onChange={(event) => {
                        const size = Number(event.target.value);
                        if (event.target.value !== "" && Number.isFinite(size)) save(load().withSize(size));
                    }}
                />
                <span className="rl-config-units">pt</span>
            </label>
            <label className="rl-sidebar-check">
                <input type="checkbox" checked={font.bold} onChange={(event) => save(load().withBold(event.target.checked))} />
                <span className="rl-config-label">
                    <span>Bold</span>
                    <span className="rl-config-description">Toggle bold styling for the font.</span>
                </span>
            </label>
        </div>
    );
}

/**
 * RuneLite's HotkeyButton: click, then press the key (with any modifiers) to bind it. Escape
 * cancels; Backspace or Delete clears it to "Not set".
 */
function KeybindButton({ value, onChange }: { value: Keybind; onChange: (next: Keybind) => void }): JSX.Element {
    const [listening, setListening] = useState(false);
    return (
        <button
            type="button"
            className="rl-sidebar-keybind"
            onClick={() => setListening(true)}
            onBlur={() => setListening(false)}
            onKeyDown={(event) => {
                if (!listening) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Escape") {
                    setListening(false);
                    return;
                }
                if (event.key === "Backspace" || event.key === "Delete") {
                    onChange(Keybind.NOT_SET);
                } else {
                    onChange(Keybind.fromEvent(event.nativeEvent));
                }
                setListening(false);
            }}
        >
            {listening ? "Press a key…" : value.describe()}
        </button>
    );
}

export function ConfigPanel({
    descriptor,
    configManager,
    title,
}: {
    descriptor: ConfigGroupDescriptor;
    configManager: ConfigManager;
    title?: string;
}): JSX.Element {
    const [, setVersion] = useState(0);

    useEffect(() => {
        return configManager.addListener((event) => {
            if (event.getGroup() === descriptor.group) setVersion((version) => version + 1);
        });
    }, [configManager, descriptor]);

    const groups = useMemo(() => groupBySection(descriptor, orderItems(descriptor)), [descriptor]);
    // Sections fold like RuneLite's: closed at first when `closedByDefault`.
    const [closed, setClosed] = useState<ReadonlySet<string>>(() => {
        const sections = Object.entries(descriptor.sections ?? {});
        return new Set(sections.filter(([, section]) => section.closedByDefault).map(([id]) => id));
    });
    // The FontType item whose FontPanel is open, which replaces the list as RuneLite's does.
    const [fontProperty, setFontProperty] = useState<string>();
    const toggleSection = (id: string): void =>
        setClosed((current) => {
            const next = new Set(current);
            if (!next.delete(id)) next.add(id);
            return next;
        });

    const fontItem = fontProperty !== undefined ? descriptor.items[fontProperty] : undefined;
    if (fontProperty !== undefined && fontItem) {
        return (
            <div className="rl-config-panel">
                <FontPanel
                    descriptor={descriptor}
                    property={fontProperty}
                    item={fontItem}
                    configManager={configManager}
                    onBack={() => setFontProperty(undefined)}
                />
            </div>
        );
    }

    return (
        <div className="rl-config-panel">
            {title ? <div className="rl-sidebar-panel-title">{title}</div> : null}
            {groups.map((group, index) => (
                <div key={group.id || `section-${index}`}>
                    {group.section ? (
                        <button
                            type="button"
                            className={
                                closed.has(group.id)
                                    ? "rl-config-section-title closed"
                                    : "rl-config-section-title"
                            }
                            aria-expanded={!closed.has(group.id)}
                            onClick={() => toggleSection(group.id)}
                        >
                            {group.section.name}
                        </button>
                    ) : null}
                    {(group.section && closed.has(group.id) ? [] : group.items).map((entry) => (
                        <ConfigField
                            key={entry.property}
                            descriptor={descriptor}
                            property={entry.property}
                            item={entry.item}
                            configManager={configManager}
                            onOpenFont={setFontProperty}
                        />
                    ))}
                </div>
            ))}
            {groups.length === 0 ? (
                <p className="rl-sidebar-panel-copy">This plugin has no settings.</p>
            ) : null}
        </div>
    );
}
