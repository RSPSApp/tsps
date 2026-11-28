import { CachePipeline } from "../../cache/CachePipeline";
import { CacheIndexDat2 } from "../../cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../../cache/codec/rs/cache/IndexType";
import { Misc } from "../../../util/Misc";

/**
 * How the chatbox lays out a line of speech: the client draws chat_left/chat_right/objectbox text
 * (231:6, 217:6, 193:2) in font 497 inside 380 pixels, breaking at spaces, and a box holds four
 * lines. The font's advances come from the cache (fonts index, a 257-byte metrics file: 256
 * advances and the ascent), so a page holds what live's holds. Against the Plague City capture
 * (rsprox 20261110T113734-5ab63b4) this reproduces every one of its 151 chat and item box line
 * breaks; a fixed character count (53) split some four-line boxes into two pages.
 */
export class ChatTextLayout {
    static readonly FONT_ID = 497;
    static readonly WIDTH = 380;
    static readonly LINES_PER_PAGE = 4;
    /** The old character wrap, used when the cache has no font (tests without a cache). */
    private static readonly FALLBACK_CHARACTERS = 53;

    private static advances: number[] | null | undefined;

    private static loadAdvances(): number[] | null {
        if (ChatTextLayout.advances !== undefined) return ChatTextLayout.advances;
        ChatTextLayout.advances = null;
        try {
            if (!CachePipeline.isInitialized()) return null;
            const fonts = CacheIndexDat2.fromStore(IndexType.DAT2.fonts, CachePipeline.getStore());
            const fileIds = fonts.getFileIds(ChatTextLayout.FONT_ID);
            const file = fileIds?.length ? fonts.getFile(ChatTextLayout.FONT_ID, fileIds[0]) : null;
            if (!file) return null;
            const data = new Int8Array(file.data);
            if (data.length < 256) return null;
            const advances = new Array<number>(256);
            for (let i = 0; i < 256; i++) advances[i] = data[i] & 0xff;
            ChatTextLayout.advances = advances;
        } catch {
            ChatTextLayout.advances = null;
        }
        return ChatTextLayout.advances;
    }

    /** The drawn width of `text`; tags (<col=...>, </col>, <img=...>) draw nothing here. */
    static width(text: string): number {
        const advances = ChatTextLayout.loadAdvances();
        if (!advances) return text.length;
        let width = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text.charAt(i);
            if (ch === "<") {
                const end = text.indexOf(">", i);
                if (end > i) {
                    i = end;
                    continue;
                }
            }
            const code = text.charCodeAt(i);
            width += advances[(code === 160 ? 32 : code) & 0xff] ?? 0;
        }
        return width;
    }

    /** The lines the client draws `text` on; "<br>" always breaks. */
    static wrap(text: string): string[] {
        return ChatTextLayout.layout(text).map(([line]) => line);
    }

    /**
     * The chatbox pages `text` takes, four lines each: lines of one paragraph are joined by a
     * space (the client wraps them again the same way), a "<br>" the text had is kept.
     */
    static pages(text: string): string[] {
        const lines = ChatTextLayout.carryColour(ChatTextLayout.layout(text));
        const pages: string[] = [];
        for (let start = 0; start < lines.length; start += ChatTextLayout.LINES_PER_PAGE) {
            const page = lines.slice(start, start + ChatTextLayout.LINES_PER_PAGE);
            // A line broken after a hyphen joins the next without a space (the word goes on).
            pages.push(page.map(([line], i) => i === 0 ? line : (page[i - 1][1] ? "<br>" : page[i - 1][2] ? "" : " ") + line).join(""));
        }
        return pages;
    }

    /**
     * How many lines the client draws `text` on in a text component `width` pixels wide in font 497:
     * every "<br>" starts a line (an empty one too) and a line too wide breaks at a space. Without
     * the cache's font, only the "<br>"s count.
     */
    static lineCount(text: string, width: number): number {
        const paragraphs = String(text ?? "").split(/<br\s*\/?>/i);
        if (!ChatTextLayout.loadAdvances()) return paragraphs.length;
        return paragraphs.reduce((total, paragraph) => total + Math.max(1, ChatTextLayout.wrapParagraph(paragraph, width).length), 0);
    }

    /**
     * A colour still open at the end of a line starts the next line again: live repeats the tag on
     * every line of a coloured passage (Client of Kourend's possessed Veos, rsprox local 1001998
     * ticks 2109-2121: "<col=000080>...<br><col=000080>..."), and a page is a new chatbox.
     */
    private static carryColour(lines: Array<[string, boolean, boolean]>): Array<[string, boolean, boolean]> {
        let open: string | null = null;
        return lines.map(([line, br, hyphen]) => {
            const shown: string = open && !/^<col=[0-9a-f]{6}>/i.test(line) ? `${open}${line}` : line;
            for (const [tag] of shown.matchAll(/<col=[0-9a-f]{6}>|<\/col>/gi)) open = tag.startsWith("</") ? null : tag;
            return [shown, br, hyphen];
        });
    }

    /** Each line, whether a "<br>" ends it, and whether it was broken just after a hyphen. */
    private static layout(text: string): Array<[string, boolean, boolean]> {
        if (!ChatTextLayout.loadAdvances()) {
            return Misc.wrapText(String(text ?? ""), ChatTextLayout.FALLBACK_CHARACTERS).map((line) => [line, false, false]);
        }
        const lines: Array<[string, boolean, boolean]> = [];
        const paragraphs = String(text ?? "").split(/<br\s*\/?>/i);
        for (let p = 0; p < paragraphs.length; p++) {
            const first = lines.length;
            for (const [line, hyphen] of ChatTextLayout.breakParagraph(paragraphs[p], ChatTextLayout.WIDTH)) lines.push([line, false, hyphen]);
            if (p < paragraphs.length - 1 && lines.length > first) lines[lines.length - 1][1] = true;
        }
        return lines;
    }

    /** One paragraph's lines, broken to fit `width`; none for an empty paragraph. */
    private static wrapParagraph(paragraph: string, width: number): string[] {
        return ChatTextLayout.breakParagraph(paragraph, width).map(([line]) => line);
    }

    /**
     * One paragraph's lines, and whether each was broken just after a hyphen. The client breaks at a space
     * or after a hyphen: live sends "much in-<br>fighting" (Family Crest, local recording 1002252 tick 168),
     * "extra-<br>planar" and "great-<br>grandfather", and keeps "ill-bred" whole where it fits.
     */
    private static breakParagraph(paragraph: string, width: number): Array<[string, boolean]> {
        const lines: Array<[string, boolean]> = [];
        let line = "";
        for (const word of paragraph.split(" ")) {
            if (!word) continue;
            const pieces = word.split(/(?<=-)(?=.)/);
            for (let k = 0; k < pieces.length; k++) {
                const candidate = line ? `${line}${k === 0 ? " " : ""}${pieces[k]}` : pieces[k];
                if (line && ChatTextLayout.width(candidate) > width) {
                    lines.push([line, k > 0]);
                    line = pieces[k];
                } else {
                    line = candidate;
                }
            }
        }
        if (line) lines.push([line, false]);
        return lines;
    }
}
