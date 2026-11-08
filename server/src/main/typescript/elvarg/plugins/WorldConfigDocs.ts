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

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function areaOf(option: CatalogOption, owners: Map<string, string>): string {
    if (option.owner === "core") return "core";
    if (option.owner === "world") return "world";
    return owners.get(option.owner) ?? "other";
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
    const owners = new Map<string, string>(catalog.plugins.map((p) => [p.name, p.area]));
    const groups = new Map<string, CatalogOption[]>();
    for (const option of [...catalog.world, ...catalog.options]) {
        const area = areaOf(option, owners);
        const list = groups.get(area) ?? [];
        list.push(option);
        groups.set(area, list);
    }
    const out: string[] = ["### Options", ""];
    const areas = [...groups.keys()].sort((a, b) => {
        const rank = (x: string) => (x === "world" ? 0 : x === "core" ? 1 : 2);
        return rank(a) - rank(b) || compare(a, b);
    });
    for (const area of areas) {
        const heading = area === "world" ? "World settings (top-level keys)" : area === "core" ? "Core (`pluginConfig`)" : `${area} (\`pluginConfig\`)`;
        out.push(`#### ${heading}`, "");
        out.push(...optionTable(groups.get(area)!.sort((a, b) => compare(a.key, b.key))), "");
    }

    const described = catalog.plugins
        .filter((p): p is CatalogPlugin & { description: string } => !!p.description)
        .sort((a, b) => compare(a.area, b.area) || compare(a.name, b.name));
    out.push("### Plugin switches", "");
    out.push("| Plugin key | Area | On by default | Effect |", "| --- | --- | --- | --- |");
    for (const plugin of described) {
        out.push(
            `| ${code(plugin.name)} | ${cell(plugin.area)} | ${plugin.defaultEnabled ? "yes" : "no"} | ${cell(plugin.description)}${plugin.members ? " (members only)" : ""} |`,
        );
    }
    return out.join("\n");
}
