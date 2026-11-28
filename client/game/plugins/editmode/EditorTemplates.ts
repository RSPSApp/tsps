import house from "./generation/templates/varrock-house-a.json";
import westHouse from "./generation/templates/varrock-house-west.json";
import tent from "./generation/templates/varrock-tent.json";

const templates = {
    "varrock-house-a": house,
    "varrock-house-west": westHouse,
    "varrock-tent": tent,
};

export async function loadEditorTemplateCatalog() {
    return Object.entries(templates).map(([name, template]) => ({
        name,
        about: template.about,
        width: template.width,
        height: template.height,
        objects: template.objects.length,
        tiles: template.tiles.length,
        source: { ...template.source, planes: [...template.source.planes] },
    }));
}

export async function loadEditorTemplate(name: string): Promise<unknown> {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(name) || !Object.hasOwn(templates, name)) {
        throw new Error(`No built-in template "${name}"`);
    }
    // Each load is independent, just like imported presets and the old file-backed library.
    return JSON.parse(JSON.stringify(templates[name as keyof typeof templates]));
}
