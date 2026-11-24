/**
 * The ordering OSRS's `compare` instruction gives two strings (English client):
 *  1. letter by letter, ignoring case and accents, with ligatures spelled out;
 *  2. then letter by letter ignoring case only, so an accent breaks a tie;
 *  3. then the shorter string first;
 *  4. then the exact characters, a lower-case letter before its capital.
 */

/** Accented Latin-1 letters and the plain letter each one sorts as. */
const PLAIN_LETTER = new Map<number, string>();
function fold(letters: string, plain: string): void {
    for (const letter of letters) PLAIN_LETTER.set(letter.charCodeAt(0), plain);
}
fold("ÀÁÂÃÄÅÆ", "A");
fold("Ç", "C");
fold("ÈÉÊË", "E");
fold("ÌÍÎÏ", "I");
fold("Ñ", "N");
fold("ÒÓÔÕÖŒ", "O");
fold("ÙÚÛÜ", "U");
fold("ÝŸ", "Y");
fold("ß", "s");
fold("àáâãäåæ", "a");
fold("ç", "c");
fold("èéêë", "e");
fold("ìíîï", "i");
fold("ñ", "n");
fold("òóôõöœ", "o");
fold("ùúûü", "u");
fold("ýÿ", "y");

/** A ligature's second letter: it counts as two letters in the first pass. */
const LIGATURE_TAIL = new Map<number, string>([
    [0xc6, "E"], [0xe6, "e"], [0xdf, "s"], [0x152, "E"], [0x153, "e"],
]);

/** Letters without accents, ligatures written as two letters. */
function plainLetters(text: string): string {
    let out = "";
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        out += PLAIN_LETTER.get(code) ?? text[i];
        const tail = LIGATURE_TAIL.get(code);
        if (tail !== undefined) out += tail;
    }
    return out;
}

/** Where a character sorts: by its lower-case form, the capital just after it. */
function sortKey(char: string): number {
    const lower = char.toLowerCase();
    return char !== lower && char === char.toUpperCase() ? (lower.charCodeAt(0) << 4) + 1 : char.charCodeAt(0) << 4;
}

const sameLetter = (a: string, b: string) => a === b || a.toUpperCase() === b.toUpperCase();

/** First difference between two strings ignoring case, as a sort-key difference; 0 when none. */
function firstCaselessDifference(a: string, b: string, length: number): number {
    for (let i = 0; i < length; i++) {
        if (sameLetter(a[i], b[i])) continue;
        const lowerA = a[i].toLowerCase();
        const lowerB = b[i].toLowerCase();
        if (lowerA !== lowerB) return sortKey(lowerA) - sortKey(lowerB);
    }
    return 0;
}

/** Negative, zero or positive as `a` sorts before, with or after `b`. */
export function compareStringsOsrs(a: string, b: string): number {
    const plainA = plainLetters(a);
    const plainB = plainLetters(b);
    const plainLength = Math.min(plainA.length, plainB.length);
    const byLetters = firstCaselessDifference(plainA, plainB, plainLength);
    if (byLetters !== 0) return byLetters;
    if (plainA.length !== plainB.length) return plainA.length < plainB.length ? -1 : 1;

    const length = Math.min(a.length, b.length);
    const byAccents = firstCaselessDifference(a, b, length);
    if (byAccents !== 0) return byAccents;
    if (a.length !== b.length) return a.length - b.length;
    for (let i = 0; i < length; i++) {
        if (a[i] !== b[i]) return sortKey(a[i]) - sortKey(b[i]);
    }
    return 0;
}
