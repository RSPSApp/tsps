/**
 * Config operations: ObjType, NpcType, LocType, Struct, Enum parameters
 */
import {
    getCustomEnumCountOverride,
    getCustomEnumValueOverride,
    getCustomStructParam,
    getLeagueTaskStructParam,
    getRelicOrMasteryStructParam,
    getReplacedChallengeStructIds,
} from "../../../common/gamemode/GamemodeContentStore";
import { isNpcSearch, isNpcSearchResult, setNpcSearchResults } from "../spawnSearch";
import { createTypedArrayFromCode } from "../Cs2ArrayObject";
import { Opcodes } from "../Opcodes";
import type { HandlerContext, HandlerMap } from "./HandlerTypes";
import { GAMEFRAME_LAYOUT_ENUM, GAMEFRAME_317_OPTION, GAMEFRAME_317_LABEL, GAMEFRAME_317_FIXED_OPTION, GAMEFRAME_317_FIXED_LABEL } from "../../../common/ui/gameframeLayout";

function loadEnum(ctx: HandlerContext, enumId: number) {
    const type = ctx.enumTypeLoader?.load(enumId);
    if (enumId === GAMEFRAME_LAYOUT_ENUM && type?.stringValues) {
        for (const [key, label] of [
            [GAMEFRAME_317_OPTION, GAMEFRAME_317_LABEL],
            [GAMEFRAME_317_FIXED_OPTION, GAMEFRAME_317_FIXED_LABEL],
        ] as const) {
            if (type.keys.includes(key)) continue;
            type.keys.push(key);
            type.stringValues.push(label);
        }
        type.outputCount = type.keys.length;
    }
    return type;
}

export function registerConfigOps(handlers: HandlerMap): void {
    // === ObjType (Item) ===
    handlers.set(Opcodes.OC_NAME, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        // Rows of an npc search are npc ids; everything else stays an item lookup.
        const name = isNpcSearchResult(itemId)
            ? (ctx.npcTypeLoader?.load(itemId)?.name ?? "null")
            : (ctx.objTypeLoader?.load(itemId)?.name ?? "null");
        ctx.pushString(name);
    });

    handlers.set(Opcodes.OC_OP, (ctx) => {
        const opIndex = ctx.intStack[--ctx.intStackSize];
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        ctx.pushString(obj?.groundActions?.[opIndex - 1] ?? "");
    });

    handlers.set(Opcodes.OC_IOP, (ctx) => {
        const opIndex = ctx.intStack[--ctx.intStackSize];
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        ctx.pushString(obj?.inventoryActions?.[opIndex - 1] ?? "");
    });

    handlers.set(Opcodes.OC_COST, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const cost = ctx.objTypeLoader?.load(itemId)?.price ?? 0;
        ctx.pushInt(cost);
    });

    handlers.set(Opcodes.OC_STACKABLE, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        // Check if stackability is ALWAYS (1) - default (0) is NEVER
        const stackable = obj?.stackability === 1;
        ctx.pushInt(stackable ? 1 : 0);
    });

    handlers.set(Opcodes.OC_CERT, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        // note = the noted version of this item
        ctx.pushInt(obj?.notedId ?? -1);
    });

    handlers.set(Opcodes.OC_UNCERT, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        // unnotedId = the unnoted version of this item
        ctx.pushInt(obj?.unnotedId ?? -1);
    });

    handlers.set(Opcodes.OC_MEMBERS, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const members = ctx.objTypeLoader?.load(itemId)?.isMembers ?? false;
        ctx.pushInt(members ? 1 : 0);
    });

    handlers.set(Opcodes.OC_PLACEHOLDER, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        //  (see ScriptOpcodes.OC_PLACEHOLDER):
        // If this item has a placeholder defined (placeholder >= 0) and is NOT itself a placeholder
        // (placeholderTemplate == -1), return the placeholder item id; else return the input id.
        if (obj && (obj.placeholderTemplate | 0) === -1 && (obj.placeholder | 0) >= 0) {
            ctx.pushInt(obj.placeholder | 0);
        } else {
            ctx.pushInt(itemId | 0);
        }
    });

    handlers.set(Opcodes.OC_UNPLACEHOLDER, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        //  (see ScriptOpcodes.OC_UNPLACEHOLDER):
        // If this item IS a placeholder (placeholderTemplate >= 0 && placeholder >= 0), return the
        // original/underlying item id stored in placeholder; else return the input id.
        if (obj && (obj.placeholderTemplate | 0) >= 0 && (obj.placeholder | 0) >= 0) {
            ctx.pushInt(obj.placeholder | 0);
        } else {
            ctx.pushInt(itemId | 0);
        }
    });

    handlers.set(Opcodes.OC_FIND, (ctx) => {
        // oc_find(string, boolean)(count): starts an item search by name
        ctx.intStackSize--; // the boolean (tradeable items only in the cache scripts' use)
        const query = ctx.stringStack[--ctx.stringStackSize].toLowerCase();

        // Clear previous search results
        ctx.itemSearchResults = [];
        ctx.itemSearchIndex = 0;

        if (query.length > 0 && isNpcSearch() && ctx.npcTypeLoader) {
            const count = ctx.npcTypeLoader.getCount();
            for (let id = 0; id < count; id++) {
                const npc = ctx.npcTypeLoader.load(id);
                if (npc?.name && npc.name !== "null" && npc.name.toLowerCase().includes(query)) {
                    ctx.itemSearchResults.push(id);
                }
            }
            setNpcSearchResults(ctx.itemSearchResults);
        } else if (query.length > 0 && ctx.objTypeLoader) {
            // Search through all items for matching names
            // Note: This searches items 0-65535 which covers all standard items
            const maxItemId = 65535;
            for (let id = 0; id < maxItemId; id++) {
                const obj = ctx.objTypeLoader.load(id);
                if (obj && obj.name && obj.name !== "null") {
                    if (obj.name.toLowerCase().includes(query)) {
                        ctx.itemSearchResults.push(id);
                    }
                }
            }
        }

        ctx.pushInt(ctx.itemSearchResults.length);
    });

    handlers.set(Opcodes.OC_FINDNEXT, (ctx) => {
        if (ctx.itemSearchIndex < ctx.itemSearchResults.length) {
            ctx.pushInt(ctx.itemSearchResults[ctx.itemSearchIndex++]);
        } else {
            ctx.pushInt(-1); // no more results
        }
    });

    handlers.set(Opcodes.OC_FINDRESET, (ctx) => {
        // Reset search state
        ctx.itemSearchResults = [];
        ctx.itemSearchIndex = 0;
        setNpcSearchResults([]);
    });

    handlers.set(Opcodes.OC_SHIFTCLICKIOP, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        const obj = ctx.objTypeLoader?.load(itemId);
        // Returns the shift-click inventory option index (1-based for iop), or -1 if none
        const shiftIndex = obj?.getShiftClickIndex?.() ?? -1;
        // Convert to 1-based iop index for script usage (scripts expect 1-5, not 0-4)
        ctx.pushInt(shiftIndex >= 0 ? shiftIndex + 1 : -1);
    });

    handlers.set(Opcodes.OC_WEARPOS, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(ctx.objTypeLoader?.load(itemId)?.wearPos ?? -1);
    });

    handlers.set(Opcodes.OC_WEARPOS2, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(ctx.objTypeLoader?.load(itemId)?.wearPos2 ?? -1);
    });

    handlers.set(Opcodes.OC_WEARPOS3, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(ctx.objTypeLoader?.load(itemId)?.wearPos3 ?? -1);
    });

    handlers.set(Opcodes.OC_WEIGHT, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(ctx.objTypeLoader?.load(itemId)?.weight ?? 0);
    });

    // Rev 241: an obj's category, and obj <-> int (the same id either way).
    handlers.set(Opcodes.OC_CATEGORY, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(ctx.objTypeLoader?.load(itemId)?.category ?? -1);
    });
    handlers.set(Opcodes.OC_ID, (ctx) => {
        ctx.pushInt(ctx.intStack[--ctx.intStackSize]);
    });
    handlers.set(Opcodes.OC_BYID, (ctx) => {
        ctx.pushInt(ctx.intStack[--ctx.intStackSize]);
    });

    // enum_getoutputs(type $outputtype, enum)(array): every output value, in key order (rev 241).
    handlers.set(Opcodes.ENUM_GETOUTPUTS, (ctx) => {
        const enumId = ctx.intStack[--ctx.intStackSize];
        const outputType = ctx.intStack[--ctx.intStackSize];
        const enumType = loadEnum(ctx, enumId);
        const values: any[] = enumType?.stringValues ?? enumType?.intValues ?? [];
        const array = createTypedArrayFromCode(outputType, values.length);
        values.forEach((value, index) => array.setAt(index, value));
        ctx.pushString(array);
    });

    handlers.set(Opcodes.OC_EXAMINE, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        ctx.pushString(ctx.objTypeLoader?.load(itemId)?.examine ?? "null");
    });

    // oc_isubop(obj, opIndex, subIndex) - inventory op submenu text for an item.
    // Args read as an array of 3 ints; opIndex/subIndex are 1-based. Returns ""
    // unless the op exists and the subop slot is populated.
    handlers.set(Opcodes.OC_ISUBOP, (ctx) => {
        ctx.intStackSize -= 3;
        const itemId = ctx.intStack[ctx.intStackSize];
        const opIndex = ctx.intStack[ctx.intStackSize + 1];
        const subIndex = ctx.intStack[ctx.intStackSize + 2];
        const obj = ctx.objTypeLoader?.load(itemId);
        let subop: string | null = null;
        if (
            obj &&
            opIndex >= 1 &&
            opIndex <= 5 &&
            obj.inventoryActions?.[opIndex - 1] != null &&
            obj.subops != null &&
            obj.subops[opIndex - 1] != null &&
            subIndex >= 1 &&
            subIndex <= obj.subops[opIndex - 1]!.length
        ) {
            subop = obj.subops[opIndex - 1]![subIndex - 1];
        }
        ctx.pushString(subop != null ? subop : "");
    });

    handlers.set(Opcodes.OC_PARAM, (ctx) => {
        const paramId = ctx.intStack[--ctx.intStackSize];
        const itemId = ctx.intStack[--ctx.intStackSize];
        const param = ctx.paramTypeLoader?.load(paramId);
        const obj = ctx.objTypeLoader?.load(itemId);
        if (param && obj && obj.params) {
            const val = obj.params.get(paramId);
            if (param.isString()) {
                ctx.pushString(typeof val === "string" ? val : param.defaultString || "");
            } else {
                ctx.pushInt(typeof val === "number" ? val : param.defaultInt || 0);
            }
        } else {
            if (param?.isString()) {
                ctx.pushString(param.defaultString || "");
            } else {
                ctx.pushInt(param?.defaultInt ?? 0);
            }
        }
    });

    // === NpcType ===
    handlers.set(Opcodes.NC_NAME, (ctx) => {
        const npcId = ctx.intStack[--ctx.intStackSize];
        const name = ctx.npcTypeLoader?.load(npcId)?.name ?? "";
        ctx.pushString(name);
    });

    handlers.set(Opcodes.NC_PARAM, (ctx) => {
        const paramId = ctx.intStack[--ctx.intStackSize];
        const npcId = ctx.intStack[--ctx.intStackSize];
        const param = ctx.paramTypeLoader?.load(paramId);
        const npc = ctx.npcTypeLoader?.load(npcId);
        if (param && npc && npc.params) {
            const val = npc.params.get(paramId);
            if (param.isString()) {
                ctx.pushString(typeof val === "string" ? val : param.defaultString || "");
            } else {
                ctx.pushInt(typeof val === "number" ? val : param.defaultInt || 0);
            }
        } else {
            if (param?.isString()) {
                ctx.pushString(param.defaultString || "");
            } else {
                ctx.pushInt(param?.defaultInt ?? 0);
            }
        }
    });

    // === LocType ===
    handlers.set(Opcodes.LC_NAME, (ctx) => {
        const locId = ctx.intStack[--ctx.intStackSize];
        const name = ctx.locTypeLoader?.load(locId)?.name ?? "";
        ctx.pushString(name);
    });

    handlers.set(Opcodes.LC_PARAM, (ctx) => {
        const paramId = ctx.intStack[--ctx.intStackSize];
        const locId = ctx.intStack[--ctx.intStackSize];
        const param = ctx.paramTypeLoader?.load(paramId);
        const loc = ctx.locTypeLoader?.load(locId);
        if (param && loc && loc.params) {
            const val = loc.params.get(paramId);
            if (param.isString()) {
                ctx.pushString(typeof val === "string" ? val : param.defaultString || "");
            } else {
                ctx.pushInt(typeof val === "number" ? val : param.defaultInt || 0);
            }
        } else {
            if (param?.isString()) {
                ctx.pushString(param.defaultString || "");
            } else {
                ctx.pushInt(param?.defaultInt ?? 0);
            }
        }
    });

    // === StructType ===
    handlers.set(Opcodes.STRUCT_PARAM, (ctx) => {
        const paramId = ctx.intStack[--ctx.intStackSize];
        const structId = ctx.intStack[--ctx.intStackSize];
        const param = ctx.paramTypeLoader?.load(paramId);

        // Check for custom content override first (centralized registry)
        let overrideVal = getCustomStructParam(structId, paramId);
        // Then check for cache league task data
        if (overrideVal === undefined) {
            overrideVal = getLeagueTaskStructParam(structId, paramId);
        }
        // Then check for relic/mastery override
        if (overrideVal === undefined) {
            overrideVal = getRelicOrMasteryStructParam(structId, paramId);
        }

        if (param && overrideVal !== undefined) {
            if (param.isString()) {
                ctx.pushString(
                    typeof overrideVal === "string" ? overrideVal : param.defaultString || "",
                );
            } else {
                ctx.pushInt(typeof overrideVal === "number" ? overrideVal : param.defaultInt || 0);
            }
            return;
        }
        const struct = ctx.structTypeLoader?.load(structId);
        if (param && struct && struct.params) {
            const val = struct.params.get(paramId);
            if (param.isString()) {
                ctx.pushString(typeof val === "string" ? val : param.defaultString || "");
            } else {
                ctx.pushInt(typeof val === "number" ? val : param.defaultInt || 0);
            }
        } else {
            if (param?.isString()) {
                ctx.pushString(param.defaultString || "");
            } else {
                ctx.pushInt(param?.defaultInt ?? 0);
            }
        }
    });

    // === EnumType ===
    handlers.set(Opcodes.ENUM, (ctx) => {
        let key = ctx.intStack[--ctx.intStackSize];
        const enumId = ctx.intStack[--ctx.intStackSize];
        // enum(inputtype, outputtype, enum, key): the requested output type picks the stack, as in
        // the real client, even when the enum is missing or declares another type.
        const outputType = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize--; // input type
        const wantsString = outputType === 115; // 's'

        const enumType = loadEnum(ctx, enumId);
        const baseCount = enumType?.outputCount ?? 0;

        // Check for custom content enum override
        // - Tasks are prepended (inserted at beginning)
        // - Challenges are prepended (inserted at beginning)
        const customOverride = getCustomEnumValueOverride(enumId, key, baseCount);

        if (customOverride) {
            if ("custom" in customOverride) {
                ctx.pushInt(customOverride.custom);
                return;
            }
            // Shift the key to account for inserted custom content
            key = customOverride.shiftedKey;
        }

        // Skip cache entries replaced by custom challenges.
        // When iterating, the Nth non-replaced cache entry maps to a higher
        // original cache key because replaced entries are removed from the sequence.
        const replaced = getReplacedChallengeStructIds();
        if (replaced.size > 0 && enumType?.intValues && customOverride) {
            let target = key; // 0-based position among non-replaced entries
            let cacheIdx = 0;
            for (let i = 0; i < (enumType.keys?.length ?? 0); i++) {
                const structId = enumType.intValues[i];
                if (replaced.has(structId)) continue;
                if (cacheIdx === target) {
                    key = enumType.keys![i];
                    break;
                }
                cacheIdx++;
            }
        }

        if (wantsString) {
            if (enumType?.stringValues) {
                const idx = enumType.keys?.indexOf(key) ?? -1;
                const result =
                    idx >= 0 ? enumType.stringValues[idx] : (enumType.defaultString ?? "null");
                ctx.pushString(result);
            } else {
                ctx.pushString(enumType?.defaultString ?? "null");
            }
        } else {
            if (enumType?.intValues) {
                const idx = enumType.keys?.indexOf(key) ?? -1;
                const result = idx >= 0 ? enumType.intValues[idx] : (enumType.defaultInt ?? -1);
                ctx.pushInt(result);
            } else {
                ctx.pushInt(enumType?.defaultInt ?? -1);
            }
        }
    });

    handlers.set(Opcodes.ENUM_STRING, (ctx) => {
        const key = ctx.intStack[--ctx.intStackSize];
        const enumId = ctx.intStack[--ctx.intStackSize];

        const enumType = loadEnum(ctx, enumId);
        if (enumType && enumType.stringValues) {
            const idx = enumType.keys?.indexOf(key) ?? -1;
            ctx.pushString(
                idx >= 0 ? enumType.stringValues[idx] : (enumType.defaultString ?? "null"),
            );
        } else {
            ctx.pushString(enumType?.defaultString ?? "null");
        }
    });

    handlers.set(Opcodes.ENUM_GETOUTPUTCOUNT, (ctx) => {
        const enumId = ctx.intStack[--ctx.intStackSize];

        const enumType = loadEnum(ctx, enumId);
        const baseCount = enumType?.outputCount ?? 0;
        // Add custom content count from centralized registry
        const customCount = getCustomEnumCountOverride(enumId);
        ctx.pushInt(baseCount + customCount);
    });

    // === Map Element Category ===
    handlers.set(Opcodes.MEC_TEXT, (ctx) => {
        const mecId = ctx.intStack[--ctx.intStackSize];
        ctx.pushString(ctx.mapElementTypeLoader?.load(mecId)?.name ?? "");
    });

    handlers.set(Opcodes.MEC_TEXTSIZE, (ctx) => {
        const mecId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(ctx.mapElementTypeLoader?.load(mecId)?.textSize ?? 0);
    });

    handlers.set(Opcodes.MEC_CATEGORY, (ctx) => {
        const mecId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(ctx.mapElementTypeLoader?.load(mecId)?.category ?? -1);
    });

    handlers.set(Opcodes.MEC_SPRITE, (ctx) => {
        const mecId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(ctx.mapElementTypeLoader?.load(mecId)?.spriteId ?? -1);
    });
}
