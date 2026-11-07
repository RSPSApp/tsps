import { ClientState } from "./ClientState";

/**
 * Chat lines another player's request leaves (a trade, a PvP Arena challenge or load-out share)
 * and the player option that answers each. Clicking the line, or the chatbox script's accept
 * op, sends that option to the sender.
 */
export interface ChatRequest {
    playerId: number;
    /** The player option's label; Trade is always option 2. */
    option: string;
}

const TRADE = "Trade";
const TRADE_SLOT = 2;

const REQUEST_LINES: ReadonlyArray<{ chatType: number; text: string; option: string }> = [
    { chatType: 101, text: "wishes to trade with you.", option: TRADE },
    { chatType: 101, text: "wishes to share load-outs with you.", option: "Load-outs" },
    { chatType: 103, text: "is inviting you to an unranked duel.", option: "Challenge" },
];

const plain = (text: string): string =>
    text
        .replace(/<[^>]*>/g, "")
        .trim()
        .toLowerCase();

/** The option a request line asks for, or undefined when the line is no request. */
export function chatRequestOption(chatType: number, text: string): string | undefined {
    const line = plain(text);
    return REQUEST_LINES.find((entry) => entry.chatType === chatType && line.endsWith(entry.text))
        ?.option;
}

/** Whether a rendered chat line's text is one of the request lines. */
export function isChatRequestLine(text: string): boolean {
    const line = plain(text);
    return REQUEST_LINES.some((entry) => line.includes(entry.text));
}

/** The player option slot that answers a request: Trade's, or the one now labelled as asked. */
export function chatRequestSlot(option: string): number | undefined {
    if (option === TRADE) return TRADE_SLOT;
    const wanted = option.toLowerCase();
    for (const [slot, entry] of ClientState.playerOptions) {
        if (plain(entry.option) === wanted) return slot;
    }
    return undefined;
}
