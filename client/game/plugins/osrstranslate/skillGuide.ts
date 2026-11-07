import { cleanText, containsLetters, normalizeLookupText } from "./TranslationLookup";

/**
 * The skill guide (skill_guide_v2) keeps each guide's English as string constants in scripts
 * 9151-9174 and hands them, one body at a time, to script 9183, which splits the body into words
 * and lays out one component per word. Translating the body as 9183 starts lets the game wrap
 * the translation, size the scroll area and keep paragraphs apart, as it does for English.
 */
export const SKILL_GUIDE_BODY_SCRIPT = 9183;

/**
 * Body markup: segments split on "||". "::p" (and "::br") separate paragraphs, "::hl" / "::/hl"
 * style text, and every other segment with "::" is a link whose third field is its text:
 * "side_panel:0::300::Combat Options panel", "::131::Sword Shop", "tab:5::::Crossbows tab", and the
 * lead-in links that start a paragraph, "skill:2::<id>::Strength:::" ("Strength:" then the text).
 */
const SEPARATOR = "||";
const PARAGRAPH_BREAKS = new Set(["::p", "::br"]);
const TAG = /^::\/?[a-z]+$/;

const isTag = (segment: string) => TAG.test(segment);
const isLink = (segment: string) => !isTag(segment) && segment.includes("::");

function linkText(segment: string): string {
    return segment.split("::")[2] ?? "";
}

function withLinkText(segment: string, text: string): string {
    const fields = segment.split("::");
    if (fields.length < 3) return segment;
    fields[2] = text;
    return fields.join("::");
}

/** A sentence ends at ".", "!" or "?" followed by a space and a capital, digit or quote. */
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=["'(\p{Lu}\d])/u;

/**
 * The paragraph's translation: the whole paragraph when it is a key, otherwise sentence by
 * sentence (the dictionaries hold the guide's sentences one by one), leaving a sentence with no
 * key in English. Null when nothing in it translates.
 */
function translateText(text: string, translate: (text: string) => string | null): string | null {
    const whole = translate(text);
    if (whole !== null) return whole;
    const sentences = text.split(SENTENCE_BREAK);
    if (sentences.length < 2) return null;
    let any = false;
    const out = sentences.map((sentence) => {
        const translated = translate(sentence);
        if (translated === null) return sentence;
        any = true;
        return translated;
    });
    return any ? out.join(" ") : null;
}

/**
 * One paragraph's segments, translated. Links that lead the paragraph ("Strength:") stay in front;
 * the rest is read as plain text, other links counting as their text, and translated as a whole
 * or sentence by sentence. The translation becomes one plain segment followed by those other links,
 * still clickable, their text translated where it has a key. Style tags are dropped, since they no
 * longer line up with the words.
 */
function translateParagraph(segments: string[], translate: (text: string) => string | null): string[] {
    const linkFor = (segment: string) => {
        const text = translate(normalizeLookupText(cleanText(linkText(segment))));
        return text === null ? segment : withLinkText(segment, text);
    };
    let lead = 0;
    while (lead < segments.length && (isLink(segments[lead]) || isTag(segments[lead]) || !segments[lead].trim())) {
        if (!isLink(segments[lead]) && segments[lead].trim()) break;
        lead++;
    }
    const leading = segments.slice(0, lead);
    const body = segments.slice(lead);
    const plain = body.map((segment) => (isTag(segment) ? "" : isLink(segment) ? linkText(segment) : segment)).join("");
    const lookup = normalizeLookupText(cleanText(plain));
    if (!lookup || !containsLetters(lookup)) return segments;
    const translation = translateText(lookup, translate);
    if (translation === null) return segments;
    const out: string[] = leading.map((segment) => (isLink(segment) ? linkFor(segment) : segment));
    const links = body.filter(isLink).map(linkFor);
    // The guide's own text leaves a space after a lead-in link and before a link; the layout uses
    // it to keep the link's icon off the neighbouring word.
    out.push(`${leading.some(isLink) ? " " : ""}${translation}${links.length ? " " : ""}`);
    links.forEach((link, index) => {
        if (index > 0) out.push(" ");
        out.push(link);
    });
    return out;
}

/** A guide body with every paragraph that has a translation replaced; the rest are unchanged. */
export function translateGuideBody(body: string, translate: (text: string) => string | null): string {
    const out: string[] = [];
    let paragraph: string[] = [];
    const flush = () => {
        if (paragraph.length) out.push(...translateParagraph(paragraph, translate));
        paragraph = [];
    };
    for (const segment of body.split(SEPARATOR)) {
        if (PARAGRAPH_BREAKS.has(segment)) {
            flush();
            out.push(segment);
        } else {
            paragraph.push(segment);
        }
    }
    flush();
    return out.join(SEPARATOR);
}
