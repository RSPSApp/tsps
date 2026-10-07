/**
 * Stock market and trading post operations
 */
import { Opcodes } from "../Opcodes";
import type { HandlerContext, HandlerMap } from "./HandlerTypes";
import { PRICE_LOADING, PRICE_READY, guidePrice } from "../../../network/ServerConnection";

export function registerMarketOps(handlers: HandlerMap): void {
    const state = (ctx: HandlerContext, slot: number, field: number) =>
        ctx.varManager.getVarp(7900 + slot * 7 + field);
    const slot = (ctx: HandlerContext) => ctx.popInt();

    // === Stock Market ===
    // stockmarket_sellable(obj)(boolean): whether it can go on the Grand Exchange.
    handlers.set(Opcodes.STOCKMARKET_SELLABLE, (ctx) => {
        const itemId = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(ctx.objTypeLoader?.load(itemId)?.isTradable ? 1 : 0);
    });

    // stockmarket_value(obj)(status, long price), rev 241: the guide price. Status 2 is ready;
    // the GE scripts retry on a timer otherwise. Unquoted items show their store value, as
    // the server's GE charges them.
    handlers.set(Opcodes.STOCKMARKET_VALUE, (ctx) => {
        const itemId = ctx.popInt();
        const obj = ctx.objTypeLoader?.load(itemId);
        const unnoted = obj && obj.noteTemplate >= 0 && obj.note >= 0 ? obj.note : itemId;
        const price = guidePrice(unnoted);
        if (price === undefined) {
            ctx.pushInt(PRICE_LOADING);
            ctx.pushLong(0n);
            return;
        }
        const storeValue = ctx.objTypeLoader?.load(unnoted)?.price ?? 1;
        ctx.pushInt(PRICE_READY);
        ctx.pushLong(BigInt(Math.max(1, price || storeValue)));
    });

    handlers.set(Opcodes.STOCKMARKET_GETOFFERTYPE, (ctx) => {
        const index = slot(ctx);
        ctx.pushInt(state(ctx, index, 4));
    });

    handlers.set(Opcodes.STOCKMARKET_GETOFFERITEM, (ctx) => {
        const index = slot(ctx);
        ctx.pushInt(state(ctx, index, 6));
    });

    // Rev 241: offer prices and gold are longs (stockmarket_getofferprice/completedgold).
    handlers.set(Opcodes.STOCKMARKET_GETOFFERPRICE, (ctx) => {
        const index = slot(ctx);
        ctx.pushLong(BigInt(state(ctx, index, 0)));
    });

    handlers.set(Opcodes.STOCKMARKET_GETOFFERCOUNT, (ctx) => {
        const index = slot(ctx);
        ctx.pushInt(state(ctx, index, 1));
    });

    handlers.set(Opcodes.STOCKMARKET_GETOFFERCOMPLETEDCOUNT, (ctx) => {
        const index = slot(ctx);
        ctx.pushInt(state(ctx, index, 2));
    });

    handlers.set(Opcodes.STOCKMARKET_GETOFFERCOMPLETEDGOLD, (ctx) => {
        const index = slot(ctx);
        ctx.pushLong(BigInt(state(ctx, index, 3)));
    });

    handlers.set(Opcodes.STOCKMARKET_ISOFFEREMPTY, (ctx) => {
        const index = slot(ctx);
        ctx.pushInt(state(ctx, index, 5) === 0 ? 1 : 0);
    });

    handlers.set(Opcodes.STOCKMARKET_ISOFFERSTABLE, (ctx) => {
        const index = slot(ctx);
        ctx.pushInt(state(ctx, index, 5) === 2 ? 1 : 0);
    });

    handlers.set(Opcodes.STOCKMARKET_ISOFFERFINISHED, (ctx) => {
        const index = slot(ctx);
        ctx.pushInt(state(ctx, index, 5) === 5 ? 1 : 0);
    });

    handlers.set(Opcodes.STOCKMARKET_ISOFFERADDING, (ctx) => {
        const index = slot(ctx);
        ctx.pushInt(state(ctx, index, 5) === 1 ? 1 : 0);
    });

    // === Trading Post ===
    handlers.set(Opcodes.TRADINGPOST_SORTBY_NAME, (ctx) => {
        ctx.intStackSize--; // pop ascending
    });

    handlers.set(Opcodes.TRADINGPOST_SORTBY_PRICE, (ctx) => {
        ctx.intStackSize--; // pop ascending
    });

    handlers.set(Opcodes.TRADINGPOST_SORTFILTERBY_WORLD, (ctx) => {
        ctx.intStackSize -= 2; // pop world, ascending
    });

    handlers.set(Opcodes.TRADINGPOST_SORTBY_AGE, (ctx) => {
        ctx.intStackSize--; // pop ascending
    });

    handlers.set(Opcodes.TRADINGPOST_SORTBY_COUNT, (ctx) => {
        ctx.intStackSize--; // pop ascending
    });

    handlers.set(Opcodes.TRADINGPOST_GETTOTALOFFERS, (ctx) => {
        ctx.pushInt(0);
    });

    handlers.set(Opcodes.TRADINGPOST_GETOFFERWORLD, (ctx) => {
        ctx.intStackSize--; // pop index
        ctx.pushInt(0);
    });

    handlers.set(Opcodes.TRADINGPOST_GETOFFERNAME, (ctx) => {
        ctx.intStackSize--; // pop index
        ctx.pushString("");
    });

    handlers.set(Opcodes.TRADINGPOST_GETOFFERPREVIOUSNAME, (ctx) => {
        ctx.intStackSize--; // pop index
        ctx.pushString("");
    });

    handlers.set(Opcodes.TRADINGPOST_GETOFFERAGE, (ctx) => {
        ctx.intStackSize--; // pop index
        ctx.pushString("");
    });

    handlers.set(Opcodes.TRADINGPOST_GETOFFERCOUNT, (ctx) => {
        ctx.intStackSize--; // pop index
        ctx.pushInt(0);
    });

    handlers.set(Opcodes.TRADINGPOST_GETOFFERPRICE, (ctx) => {
        ctx.intStackSize--; // pop index
        ctx.pushLong(0n);
    });

    handlers.set(Opcodes.TRADINGPOST_GETOFFERITEM, (ctx) => {
        ctx.intStackSize--; // pop index
        ctx.pushInt(-1);
    });

    // === Hiscores ===
    handlers.set(Opcodes.HISCORE_GETSTATUS, (ctx) => {
        // Returns hiscores fetch status:
        // 0 = not fetched, 1 = loading, 2 = loaded
        // For now, return 0 (not fetched) as hiscores aren't implemented
        ctx.pushInt(0);
    });
}
