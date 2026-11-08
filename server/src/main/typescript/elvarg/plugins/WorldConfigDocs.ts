import { ConfigOptionDeclaration } from "../game/definition/WorldSettingDeclarations";
import { CatalogOption, CatalogPlugin, WorldConfigCatalogData } from "./WorldConfigCatalog";

export const WORLD_CONFIG_DOCS_START = "<!-- world-config:generated:start -->";
export const WORLD_CONFIG_DOCS_END = "<!-- world-config:generated:end -->";

function cell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function code(text: string): string {
    return "`" + String(text).replace(/`/g, "'").replace(/\r?\n/g, " ") + "`";
}

function typeText(decl: ConfigOptionDeclaration): string {
    if (decl.type === "enum") {
        const values = (decl.values ?? []).map((v) => `${code(String(v.value))} (${cell(v.label)})`);
        return `enum: ${values.join(", ")}`;
    }
    if (decl.type === "number") {
        const bounds: string[] = [];
        if (decl.integer) bounds.push("integer");
        if (decl.min !== undefined) bounds.push(`${decl.exclusiveMin ? ">" : ">="} ${decl.min}`);
        if (decl.max !== undefined) bounds.push(`<= ${decl.max}`);
        return bounds.length ? `number (${bounds.join(", ")})` : "number";
    }
    return decl.type;
}

function defaultText(decl: ConfigOptionDeclaration): string {
    if (decl.defaultText !== undefined) return `*${cell(decl.defaultText)}*`;
    return code(JSON.stringify(decl.default));
}

function switchKey(plugin: CatalogPlugin): string {
    return plugin.file.split("/").pop()!.replace(/\.plugin\.js$/i, "");
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function optionTable(options: CatalogOption[]): string[] {
    const lines = ["| Key | Type | Default | Description |", "| --- | --- | --- | --- |"];
    for (const option of options) {
        const label = option.decl.members ? `${cell(option.decl.label)} (members worlds only)` : cell(option.decl.label);
        lines.push(
            `| ${code(option.key)} | ${typeText(option.decl)} | ${defaultText(option.decl)} | **${label}.** ${cell(option.decl.help)} |`,
        );
    }
    return lines;
}

/**
 * Markdown for docs/world-configuration.md: every declared option grouped by area, then the
 * plugin switches that carry a description. Reads shipped values only, so it never depends on
 * a local world.local.json.
 */
export function renderWorldConfigDocs(catalog: WorldConfigCatalogData): string {
    const areaByOwner = new Map<string, string>(catalog.plugins.map((p) => [p.name, p.area]));
    // Owner kind and plugin area are separate grouping levels, so a plugin folder named
    // "world" or "core" can never be mistaken for the top-level or core sections.
    const sections: { heading: string; options: CatalogOption[] }[] = [
        { heading: "World settings (top-level keys)", options: catalog.world.filter((o) => o.owner === "world") },
        { heading: "Core (`pluginConfig`)", options: catalog.options.filter((o) => o.owner === "core") },
    ];
    const byArea = new Map<string, CatalogOption[]>();
    for (const option of catalog.options) {
        if (option.owner === "core" || option.owner === "world") continue;
        const area = areaByOwner.get(option.owner) ?? "other";
        byArea.set(area, [...(byArea.get(area) ?? []), option]);
    }
    for (const area of [...byArea.keys()].sort(compare)) {
        sections.push({ heading: `Plugin area ${code(area)} (\`pluginConfig\`)`, options: byArea.get(area)! });
    }
    const out: string[] = ["### Options", ""];
    for (const section of sections) {
        if (section.options.length === 0) continue;
        out.push(`#### ${section.heading}`, "");
        out.push(...optionTable([...section.options].sort((a, b) => compare(a.key, b.key))), "");
    }

    const described = catalog.plugins
        .filter((p): p is CatalogPlugin & { description: string } => !!p.description)
        .sort((a, b) => compare(a.area, b.area) || compare(a.name, b.name));
    out.push("### Plugin switches", "");
    out.push(
        "Only plugins that have a description are listed here; the world config page's Plugins tab lists all of them. " +
            "The switch key is what goes in `plugins` (matched ignoring case and spaces).",
        "",
    );
    out.push("| Switch key | Plugin | Area | On by default | Effect |", "| --- | --- | --- | --- | --- |");
    for (const plugin of described) {
        out.push(
            `| ${code(switchKey(plugin))} | ${cell(plugin.name)} | ${cell(plugin.area)} | ${plugin.defaultEnabled ? "yes" : "no"} | ${cell(plugin.description)}${plugin.members ? " (members only)" : ""} |`,
        );
    }
    return out.join("\n");
}
