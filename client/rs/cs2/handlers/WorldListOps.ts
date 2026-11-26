/**
 * World list operations: the list the World Switcher's scripts build their rows from. The game
 * supplies it (Cs2Context.worldList; game/worldswitcher/worldList.ts); without one there are no
 * worlds, and the first, next and a specific world are all "none" (id -1).
 */
import { Opcodes } from "../Opcodes";
import type { Cs2World, HandlerContext, HandlerMap } from "./HandlerTypes";

/** A world: id, properties, activity, location, population, host. */
function pushWorld(ctx: HandlerContext, world: Cs2World | undefined): void {
    ctx.pushInt(world ? world.id : -1);
    ctx.pushInt(world ? world.properties : 0);
    ctx.pushString(world ? world.activity : "");
    ctx.pushInt(world ? world.location : 0);
    ctx.pushInt(world ? world.population : 0);
    ctx.pushString(world ? world.host : "");
}

export function registerWorldListOps(handlers: HandlerMap): void {
    handlers.set(Opcodes.WORLDLIST_FETCH, (ctx) => {
        ctx.pushInt(ctx.worldList?.fetch() ? 1 : 0); // fetched
    });

    handlers.set(Opcodes.WORLDLIST_START, (ctx) => pushWorld(ctx, ctx.worldList?.start()));
    handlers.set(Opcodes.WORLDLIST_NEXT, (ctx) => pushWorld(ctx, ctx.worldList?.next()));

    handlers.set(Opcodes.WORLDLIST_SPECIFIC, (ctx) => {
        const id = ctx.intStack[--ctx.intStackSize];
        pushWorld(ctx, ctx.worldList?.specific(id));
    });

    // Two (column, descending) pairs: the column to sort by, and the one that settles its ties.
    handlers.set(Opcodes.WORLDLIST_SORT, (ctx) => {
        ctx.intStackSize -= 4;
        const at = ctx.intStackSize;
        ctx.worldList?.sort(ctx.intStack[at], ctx.intStack[at + 1] === 1, ctx.intStack[at + 2], ctx.intStack[at + 3] === 1);
    });
}
