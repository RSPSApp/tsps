/**
 * World list operations. This client has no world list: the first, next and a specific world
 * are all "none" (id -1).
 */
import { Opcodes } from "../Opcodes";
import type { HandlerContext, HandlerMap } from "./HandlerTypes";

/** A world: id, properties, host, population, location, activity. */
function pushNoWorld(ctx: HandlerContext): void {
    ctx.pushInt(-1);
    ctx.pushInt(0);
    ctx.pushString("");
    ctx.pushInt(0);
    ctx.pushInt(0);
    ctx.pushString("");
}

export function registerWorldListOps(handlers: HandlerMap): void {
    handlers.set(Opcodes.WORLDLIST_FETCH, (ctx) => {
        ctx.pushInt(0); // fetched
    });

    handlers.set(Opcodes.WORLDLIST_START, pushNoWorld);
    handlers.set(Opcodes.WORLDLIST_NEXT, pushNoWorld);

    handlers.set(Opcodes.WORLDLIST_SPECIFIC, (ctx) => {
        ctx.intStackSize--; // world id
        pushNoWorld(ctx);
    });

    handlers.set(Opcodes.WORLDLIST_SORT, (ctx) => {
        ctx.intStackSize -= 4; // two (column, ascending) pairs
    });
}
