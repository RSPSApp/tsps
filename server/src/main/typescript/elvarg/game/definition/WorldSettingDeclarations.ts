import { WORLD_GAMEFRAMES } from "./WorldDefinition";

export type ConfigOptionType = "boolean" | "number" | "string" | "enum" | "date" | "json";

export interface ConfigOptionDeclaration {
    type: ConfigOptionType;
    label: string;
    help: string;
    /** JSON-literal default. Exactly one of default / defaultText is set. */
    default?: unknown;
    /** Default described in words, when it is not a plain value. */
    defaultText?: string;
    /** enum only. */
    values?: { value: string | number; label: string }[];
    /** number only. */
    min?: number;
    max?: number;
    integer?: boolean;
    /** number only: min itself is not allowed. */
    exclusiveMin?: boolean;
    /** Members-only option: hidden on free-to-play worlds. */
    members?: boolean;
}

export type ConfigCheck = { ok: true; value: unknown } | { ok: false; error: string };

const TYPES: readonly string[] = ["boolean", "number", "string", "enum", "date", "json"];

const DECLARATION_FIELDS: readonly string[] = [
    "type", "label", "help", "default", "defaultText", "values", "min", "max", "integer", "exclusiveMin", "members",
];

/** A default must already have its declared type: no "5" for a number, no "true" for a boolean. */
function defaultTypeProblem(type: ConfigOptionType, value: unknown): string | null {
    switch (type) {
        case "boolean":
            return typeof value === "boolean" ? null : "must be true or false";
        case "number":
            return typeof value === "number" ? null : "must be a number, not text";
        case "string":
        case "date":
            return typeof value === "string" ? null : "must be text";
        case "enum":
            return typeof value === "string" || typeof value === "number" ? null : "must be one of the values";
        case "json":
            return isJsonValue(value) ? null : "must be a JSON value";
    }
}

function isJsonValue(value: unknown): boolean {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (typeof value === "object") {
        const proto = Object.getPrototypeOf(value);
        return (proto === Object.prototype || proto === null) && Object.values(value as object).every(isJsonValue);
    }
    return false;
}

/** Problems with a plugin's option declaration; an empty list means it is valid. */
export function validateDeclaration(key: string, decl: unknown): string[] {
    const problems: string[] = [];
    if (!/^[^:\s]+:[^:\s]+$/.test(key)) problems.push(`${key}: key must be namespace:key`);
    if (!decl || typeof decl !== "object" || Array.isArray(decl)) {
        problems.push(`${key}: declaration must be an object`);
        return problems;
    }
    const d = decl as Record<string, unknown>;
    if (typeof d.type !== "string" || !TYPES.includes(d.type)) problems.push(`${key}: type must be one of ${TYPES.join(", ")}`);
    if (typeof d.label !== "string" || !d.label.trim()) problems.push(`${key}: label is required`);
    if (typeof d.help !== "string" || !d.help.trim()) problems.push(`${key}: help is required`);
    const hasDefault = d.default !== undefined;
    const hasText = d.defaultText !== undefined;
    if (hasDefault === hasText) problems.push(`${key}: set exactly one of default or defaultText`);
    if (hasText && (typeof d.defaultText !== "string" || !d.defaultText.trim())) {
        problems.push(`${key}: defaultText must be a non-empty string`);
    }
    for (const field of Object.keys(d)) {
        if (!DECLARATION_FIELDS.includes(field)) problems.push(`${key}: unknown field ${field}`);
    }
    if (d.type === "enum") {
        const values = d.values;
        if (!Array.isArray(values) || values.length === 0 ||
            !values.every((v) => v && typeof v === "object" && ["string", "number"].includes(typeof v.value) && typeof v.label === "string")) {
            problems.push(`${key}: enum needs a non-empty values list of { value, label }`);
        } else if (new Set(values.map((v) => v.value)).size !== values.length) {
            problems.push(`${key}: enum values must be unique`);
        }
    } else if (d.values !== undefined) {
        problems.push(`${key}: values is only for enum`);
    }
    for (const field of ["min", "max", "integer", "exclusiveMin"]) {
        if (d.type !== "number" && d[field] !== undefined) problems.push(`${key}: ${field} is only for number`);
    }
    for (const field of ["min", "max"]) {
        if (d[field] !== undefined && !Number.isFinite(d[field])) problems.push(`${key}: ${field} must be a finite number`);
    }
    for (const field of ["integer", "exclusiveMin", "members"]) {
        if (d[field] !== undefined && typeof d[field] !== "boolean") problems.push(`${key}: ${field} must be true or false`);
    }
    if (d.exclusiveMin !== undefined && d.min === undefined) problems.push(`${key}: exclusiveMin needs min`);
    if (Number.isFinite(d.min) && Number.isFinite(d.max) && (d.min as number) > (d.max as number)) {
        problems.push(`${key}: min must not be greater than max`);
    }
    if (hasDefault && problems.length === 0) {
        const typeProblem = defaultTypeProblem(d.type as ConfigOptionType, d.default);
        if (typeProblem) {
            problems.push(`${key}: default is invalid: ${typeProblem}`);
        } else if (d.type === "enum") {
            const values = d.values as { value: unknown }[];
            if (!values.some((v) => v.value === d.default)) {
                problems.push(`${key}: default is invalid: must be exactly one of ${values.map((v) => JSON.stringify(v.value)).join(", ")}`);
            }
        } else if (d.type !== "json") {
            const check = checkConfigValue(decl as ConfigOptionDeclaration, d.default);
            if (check.ok === false) problems.push(`${key}: default is invalid: ${check.error}`);
        }
    }
    return problems;
}

/** Validates (and for numbers, coerces) a value against its declaration. Booleans are not coerced. */
export function checkConfigValue(decl: ConfigOptionDeclaration, value: unknown): ConfigCheck {
    switch (decl.type) {
        case "boolean":
            return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: "must be true or false" };
        case "number": {
            const n = typeof value === "number" ? value
                : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
            if (!Number.isFinite(n)) return { ok: false, error: "must be a number" };
            if (decl.integer && !Number.isInteger(n)) return { ok: false, error: "must be a whole number" };
            if (decl.min !== undefined && (decl.exclusiveMin ? n <= decl.min : n < decl.min)) {
                return { ok: false, error: decl.exclusiveMin ? `must be greater than ${decl.min}` : `must be at least ${decl.min}` };
            }
            if (decl.max !== undefined && n > decl.max) return { ok: false, error: `must be at most ${decl.max}` };
            return { ok: true, value: n };
        }
        case "string":
            return typeof value === "string" ? { ok: true, value } : { ok: false, error: "must be text" };
        case "enum": {
            // Numeric options are read with Number(), so "5" counts as 5.
            const asNumber = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
            const match = decl.values?.find((v) => v.value === value || (typeof v.value === "number" && v.value === asNumber));
            return match
                ? { ok: true, value: match.value }
                : { ok: false, error: `must be one of ${(decl.values ?? []).map((v) => v.value).join(", ")}` };
        }
        case "date": {
            if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                return { ok: false, error: "must be a date as YYYY-MM-DD" };
            }
            const t = new Date(`${value}T00:00:00Z`);
            return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === value
                ? { ok: true, value }
                : { ok: false, error: "must be a real calendar date" };
        }
        case "json":
            return value !== undefined ? { ok: true, value } : { ok: false, error: "must be a JSON value" };
        default:
            return { ok: false, error: "unknown option type" };
    }
}

/** Scalar top-level world.json settings (zones and the plugin sections are edited elsewhere). */
export const WORLD_SETTING_DECLARATIONS: Record<string, ConfigOptionDeclaration> = {
    name: {
        type: "string", label: "World name", default: "Old School RuneScape",
        help: "Shown on the world list. Plain text, 1 to 64 characters.",
    },
    description: {
        type: "string", label: "Description", default: "",
        help: "Short blurb shown with the world, at most 120 characters.",
    },
    experienceMultiplier: {
        type: "number", label: "Experience rate", default: 1, min: 0, exclusiveMin: true,
        help: "Global experience rate for all skills. 1 is the normal rate; 5 gives five times the experience.",
    },
    spawn: {
        type: "json", label: "Spawn point", defaultText: "Required: set in world.json",
        help: "Where new and stranded players appear, as { \"x\": 3222, \"y\": 3218, \"z\": 0 }.",
    },
    membersWorld: {
        type: "boolean", label: "Members world", default: true,
        help: "When off, members-only content is not loaded and the spawn must sit inside a zone tagged \"f2p\".",
    },
    gameframe: {
        type: "enum", label: "Game frame", defaultText: "Client default",
        values: WORLD_GAMEFRAMES.map((value) => ({ value, label: value })),
        help: "Interface layout the web client uses for this world.",
    },
};

/** Options the server core reads from pluginConfig, owned by "core". */
export const CORE_CONFIG_DECLARATIONS: Record<string, ConfigOptionDeclaration> = {
    "commands:permissions": {
        type: "json", label: "Command permissions", default: {},
        help: "Lowest rank that may run each command, e.g. { \"items\": \"NONE\", \"teleports\": \"OWNER\" }. Ranks: NONE, MODERATOR, ADMINISTRATOR, OWNER, DEVELOPER.",
    },
};
