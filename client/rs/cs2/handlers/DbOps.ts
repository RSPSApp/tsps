/**
 * Database operations
 */
import { isReferenceType, isStringType } from "../../config/db/ScriptVarType";
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

/**
 * Helper to get the effective value for a column in a row, considering table defaults.
 * Returns the explicit value if present, or the table default if not.
 */
function getEffectiveColumnValue(
    ctx: any,
    tableId: number,
    columnId: number,
    row: any,
): { found: boolean; values: any[]; types: number[] } {
    // First check if row has explicit column data
    const col = row.getColumn(columnId);
    if (col && col.values && col.values.length > 0) {
        return { found: true, values: col.values, types: col.types ?? [] };
    }

    // Fall back to table default values
    if (ctx.dbRepository) {
        const tables = ctx.dbRepository.getTables();
        const tableDef = tables.get(tableId);
        if (tableDef) {
            const colDef = tableDef.getColumn(columnId);
            if (colDef && colDef.defaultValues && colDef.defaultValues.length > 0) {
                return { found: true, values: colDef.defaultValues, types: colDef.types ?? [] };
            }
        }
    }

    return { found: false, values: [], types: [] };
}

/** Whether a row's column holds `query`: in any value, or in the packed field's tuple element. */
function columnHolds(
    ctx: any,
    tableId: number,
    tableColumnPacked: number,
    row: any,
    query: string | number,
): boolean {
    const columnId = (tableColumnPacked >> 4) & 0x7f;
    const { found, values, types } = getEffectiveColumnValue(ctx, tableId, columnId, row);
    if (!found) return false;
    const element = tableColumnPacked & 0xf;
    if (element === 0 || types.length === 0) return values.includes(query);
    for (let at = element - 1; at < values.length; at += types.length) {
        if (values[at] === query) return true;
    }
    return false;
}

/**
 * A packed field's tuple element (its low 4 bits): 0 is the whole tuple, n its (n-1)th value
 * alone. Sailing's scripts read tuples a value at a time this way (9076 reads table 188's
 * [size, offsetX, offsetY, xan, yan, zan, zoom] with fields 1-7).
 */
function tupleElementOf(tableColumnPacked: number): number {
    return tableColumnPacked & 0xf;
}

/** The types an element selects: all of them, or the one element's. */
function selectTypes(types: number[], element: number): number[] {
    if (element === 0) return types;
    return element <= types.length ? [types[element - 1]] : [];
}

function pushValue(ctx: any, type: number, val: any): void {
    if (isStringType(type)) {
        ctx.pushString(typeof val === "string" ? val : "");
    } else {
        ctx.pushInt(typeof val === "number" ? val : 0);
    }
}

/**
 * Pushes tuple `subIndex` of `values` (all of it, first type first, or one element), if it
 * exists.
 */
function pushTuple(
    ctx: any,
    types: number[],
    values: any[],
    subIndex: number,
    element: number,
): boolean {
    const tupleSize = types.length;
    const startIdx = subIndex * tupleSize;
    if (tupleSize === 0 || startIdx + tupleSize > values.length || element > tupleSize) {
        return false;
    }
    if (element > 0) {
        pushValue(ctx, types[element - 1], values[startIdx + element - 1]);
        return true;
    }
    for (let i = 0; i < tupleSize; i++) pushValue(ctx, types[i], values[startIdx + i]);
    return true;
}

function pushTypeDefaults(ctx: any, types: number[], nullReferences: boolean): void {
    for (const type of types) {
        if (isStringType(type)) {
            ctx.pushString("");
        } else if (nullReferences && isReferenceType(type)) {
            ctx.pushInt(-1);
        } else {
            ctx.pushInt(0);
        }
    }
}

export function registerDbOps(handlers: HandlerMap): void {
    handlers.set(Opcodes.DB_FIND_WITH_COUNT, (ctx) => {
        const isString = ctx.intStack[--ctx.intStackSize] === 2;
        let query: string | number;
        if (isString) {
            query = ctx.stringStack[--ctx.stringStackSize];
        } else {
            query = ctx.intStack[--ctx.intStackSize];
        }
        const tableColumnPacked = ctx.intStack[--ctx.intStackSize];

        const tableId = (tableColumnPacked >> 12) & 0xffff;
        const columnId = (tableColumnPacked >> 4) & 0x7f;

        const rowQuery: number[] = [];

        if (ctx.dbRepository) {
            const rows = ctx.dbRepository.getRows(tableId);
            for (const row of rows) {
                if (columnHolds(ctx, tableId, tableColumnPacked, row, query)) {
                    rowQuery.push(row.id);
                }
            }
        } else {
            console.warn(`[DB_FIND] No dbRepository available!`);
        }

        ctx.setDbRowQuery(rowQuery);
        ctx.setDbRowIndex(-1);
        ctx.setDbTableId(tableId);
        ctx.pushInt(rowQuery.length);
    });

    handlers.set(Opcodes.DB_FIND, (ctx) => {
        const isString = ctx.intStack[--ctx.intStackSize] === 2;
        let query: string | number;
        if (isString) {
            query = ctx.stringStack[--ctx.stringStackSize];
        } else {
            query = ctx.intStack[--ctx.intStackSize];
        }
        const tableColumnPacked = ctx.intStack[--ctx.intStackSize];

        const tableId = (tableColumnPacked >> 12) & 0xffff;
        const columnId = (tableColumnPacked >> 4) & 0x7f;

        const rowQuery: number[] = [];

        if (ctx.dbRepository) {
            const rows = ctx.dbRepository.getRows(tableId);
            for (const row of rows) {
                if (columnHolds(ctx, tableId, tableColumnPacked, row, query)) {
                    rowQuery.push(row.id);
                }
            }
        }

        ctx.setDbRowQuery(rowQuery);
        ctx.setDbRowIndex(-1);
        ctx.setDbTableId(tableId);
    });

    handlers.set(Opcodes.DB_FINDNEXT, (ctx) => {
        ctx.setDbRowIndex(ctx.dbRowIndex + 1);
        if (ctx.dbRowIndex < ctx.dbRowQuery.length) {
            ctx.pushInt(ctx.dbRowQuery[ctx.dbRowIndex]);
        } else {
            ctx.pushInt(-1);
        }
    });

    handlers.set(Opcodes.DB_GETFIELD, (ctx) => {
        const subIndex = ctx.intStack[--ctx.intStackSize];
        const tableColumnPacked = ctx.intStack[--ctx.intStackSize];
        const rowId = ctx.intStack[--ctx.intStackSize];

        const tableId = (tableColumnPacked >> 12) & 0xffff;
        const columnId = (tableColumnPacked >> 4) & 0x7f;
        const element = tupleElementOf(tableColumnPacked);

        if (ctx.dbRepository) {
            const rows = ctx.dbRepository.getRows(tableId);
            const row = rows.find((r) => r.id === rowId);
            const col = row?.getColumn(columnId);
            if (col && col.values && col.types.length > 0) {
                if (pushTuple(ctx, col.types, col.values, subIndex, element)) return;
            }
        }

        // No such tuple in the row: the table's default values, else generic defaults.
        let colTypes: number[] = [];
        let defaultValues: any[] | undefined;
        if (ctx.dbRepository) {
            const tableDef = ctx.dbRepository.getTables().get(tableId);
            const colDef = tableDef?.getColumn(columnId);
            if (colDef && colDef.types.length > 0) {
                colTypes = colDef.types;
                defaultValues = colDef.defaultValues;
            }
        }
        if (defaultValues && defaultValues.length > 0) {
            if (pushTuple(ctx, colTypes, defaultValues, subIndex, element)) return;
            pushTypeDefaults(ctx, selectTypes(colTypes, element), false);
            return;
        }
        // Reference types (DBROW, OBJ, NPC, etc.) default to -1 (null), other integers to 0.
        pushTypeDefaults(ctx, selectTypes(colTypes, element), true);
        // If still nothing pushed (no type info), push one int as fallback
        if (colTypes.length === 0) {
            ctx.pushInt(0);
        }
    });

    handlers.set(Opcodes.DB_GETFIELDCOUNT, (ctx) => {
        const tableColumnPacked = ctx.intStack[--ctx.intStackSize];
        const rowId = ctx.intStack[--ctx.intStackSize];

        const tableId = (tableColumnPacked >> 12) & 0xffff;
        const columnId = (tableColumnPacked >> 4) & 0x7f;

        let count = 0;

        if (ctx.dbRepository) {
            const rows = ctx.dbRepository.getRows(tableId);
            const row = rows.find((r) => r.id === rowId);
            if (row) {
                const col = row.getColumn(columnId);
                if (col && col.values && col.types.length > 0) {
                    // Return number of tuples, not total values
                    // Each tuple has col.types.length values
                    count = Math.floor(col.values.length / col.types.length);
                }
            }
        }

        ctx.pushInt(count);
    });

    handlers.set(Opcodes.DB_FINDALL_WITH_COUNT, (ctx) => {
        const tableId = ctx.intStack[--ctx.intStackSize];

        const rowQuery: number[] = [];

        if (ctx.dbRepository) {
            const rows = ctx.dbRepository.getRows(tableId);
            for (const row of rows) {
                rowQuery.push(row.id);
            }
        }

        ctx.setDbRowQuery(rowQuery);
        ctx.setDbRowIndex(-1);
        ctx.setDbTableId(tableId);
        ctx.pushInt(rowQuery.length);
    });

    // DB_FINDALL (7509) - Filter existing query by column value (no count push)
    // Note: Despite the name, this filters an existing query rather than getting all rows
    handlers.set(Opcodes.DB_FINDALL, (ctx) => {
        const isString = ctx.intStack[--ctx.intStackSize] === 2;
        let query: string | number;
        if (isString) {
            query = ctx.stringStack[--ctx.stringStackSize];
        } else {
            query = ctx.intStack[--ctx.intStackSize];
        }
        const tableColumnPacked = ctx.intStack[--ctx.intStackSize];

        const tableId = (tableColumnPacked >> 12) & 0xffff;
        const columnId = (tableColumnPacked >> 4) & 0x7f;

        // Verify table matches current query
        if (tableId !== ctx.dbTableId) {
            // Table mismatch - clear query
            ctx.setDbRowQuery([]);
            ctx.setDbRowIndex(-1);
            return;
        }

        // Find rows matching query value in the specified column
        const matchingRowIds = new Set<number>();
        if (ctx.dbRepository) {
            const rows = ctx.dbRepository.getRows(tableId);
            for (const row of rows) {
                if (columnHolds(ctx, tableId, tableColumnPacked, row, query)) {
                    matchingRowIds.add(row.id);
                }
            }
        }

        // Intersect with existing query (filter down to matching rows)
        const filtered = ctx.dbRowQuery.filter((id) => matchingRowIds.has(id));
        ctx.setDbRowQuery(filtered);
        ctx.setDbRowIndex(-1);
    });

    handlers.set(Opcodes.DB_GETROWTABLE, (ctx) => {
        const rowId = ctx.intStack[--ctx.intStackSize];
        // Look up the row and return its table ID
        if (ctx.dbRepository) {
            const row = ctx.dbRepository.getRowById(rowId);
            if (row) {
                ctx.pushInt(row.tableId);
                return;
            }
        }
        // Fallback: return -1 if row not found
        ctx.pushInt(-1);
    });

    handlers.set(Opcodes.DB_GETROW, (ctx) => {
        // Pop index from stack and return the row at that index in the query
        const index = ctx.intStack[--ctx.intStackSize];
        if (index >= 0 && index < ctx.dbRowQuery.length) {
            ctx.pushInt(ctx.dbRowQuery[index]);
        } else {
            ctx.pushInt(-1);
        }
    });

    // DB_FIND_FILTER_WITH_COUNT (7507) - Filter existing query by column value, push count
    // This filters an existing query (started by DB_FIND, DB_FINDALL_WITH_COUNT, etc.)
    handlers.set(Opcodes.DB_FIND_FILTER_WITH_COUNT, (ctx) => {
        const isString = ctx.intStack[--ctx.intStackSize] === 2;
        let query: string | number;
        if (isString) {
            query = ctx.stringStack[--ctx.stringStackSize];
        } else {
            query = ctx.intStack[--ctx.intStackSize];
        }
        const tableColumnPacked = ctx.intStack[--ctx.intStackSize];

        const tableId = (tableColumnPacked >> 12) & 0xffff;
        const columnId = (tableColumnPacked >> 4) & 0x7f;

        // Verify table matches current query
        if (tableId !== ctx.dbTableId) {
            // Table mismatch - clear query
            ctx.setDbRowQuery([]);
            ctx.setDbRowIndex(-1);
            ctx.pushInt(0);
            return;
        }

        // Find rows matching query value in the specified column
        const matchingRowIds = new Set<number>();
        if (ctx.dbRepository) {
            const rows = ctx.dbRepository.getRows(tableId);
            for (const row of rows) {
                if (columnHolds(ctx, tableId, tableColumnPacked, row, query)) {
                    matchingRowIds.add(row.id);
                }
            }
        }

        // Intersect with existing query (filter down to matching rows)
        const filtered = ctx.dbRowQuery.filter((id) => matchingRowIds.has(id));
        ctx.setDbRowQuery(filtered);
        ctx.setDbRowIndex(-1);
        ctx.pushInt(filtered.length);
    });

    // DB_FIND_FILTER (7510) - Get all rows from a table, initialize query (no count push)
    // Note: Despite the name suggesting filtering, this actually initializes a query with all rows
    handlers.set(Opcodes.DB_FIND_FILTER, (ctx) => {
        const tableId = ctx.intStack[--ctx.intStackSize];

        const rowQuery: number[] = [];

        if (ctx.dbRepository) {
            const rows = ctx.dbRepository.getRows(tableId);
            for (const row of rows) {
                rowQuery.push(row.id);
            }
        }

        ctx.setDbRowQuery(rowQuery);
        ctx.setDbRowIndex(-1);
        ctx.setDbTableId(tableId);
    });
}
