/** The pattern letters java.text.SimpleDateFormat knows; any other letter makes a pattern invalid. */
const JAVA_LETTERS = new Set("GyYMLwWDdFEuaHkKhmsSzZX");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
    "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Part = { letter: string; count: number } | { text: string };

/**
 * A java.text.SimpleDateFormat pattern for the fields a chat timestamp uses: years (y), months
 * (M), days (d), weekdays (E), hours (H, h, k, K), minutes (m), seconds (s), milliseconds (S) and
 * AM/PM (a), with 'quoted' text. It throws, as SimpleDateFormat does, on a letter that isn't a
 * pattern letter or an unterminated quote; Java letters this port has no use for are kept as
 * text.
 */
export class SimpleDateFormat {
    private readonly parts: Part[] = [];

    constructor(pattern: string) {
        for (let i = 0; i < pattern.length;) {
            const c = pattern[i];
            if (c === "'") {
                if (pattern[i + 1] === "'") {
                    this.parts.push({ text: "'" });
                    i += 2;
                    continue;
                }
                let text = "";
                let j = i + 1;
                for (; j < pattern.length; j++) {
                    if (pattern[j] !== "'") text += pattern[j];
                    else if (pattern[j + 1] === "'") text += pattern[j++];
                    else break;
                }
                if (j >= pattern.length) throw new Error(`Unterminated quote in "${pattern}"`);
                this.parts.push({ text });
                i = j + 1;
            } else if (/[A-Za-z]/.test(c)) {
                if (!JAVA_LETTERS.has(c)) throw new Error(`Illegal pattern character '${c}'`);
                let count = 1;
                while (pattern[i + count] === c) count++;
                this.parts.push({ letter: c, count });
                i += count;
            } else {
                this.parts.push({ text: c });
                i++;
            }
        }
    }

    format(date: Date): string {
        return this.parts.map((part) => ("text" in part ? part.text : field(date, part.letter, part.count))).join("");
    }
}

function pad(value: number, count: number): string {
    return String(value).padStart(count, "0");
}

function field(date: Date, letter: string, count: number): string {
    const hours = date.getHours();
    switch (letter) {
        case "y":
            return count === 2 ? pad(date.getFullYear() % 100, 2) : pad(date.getFullYear(), count);
        case "M":
            if (count >= 4) return MONTHS[date.getMonth()];
            if (count === 3) return MONTHS[date.getMonth()].slice(0, 3);
            return pad(date.getMonth() + 1, count);
        case "d":
            return pad(date.getDate(), count);
        case "E":
            return count >= 4 ? DAYS[date.getDay()] : DAYS[date.getDay()].slice(0, 3);
        case "H":
            return pad(hours, count);
        case "k":
            return pad(hours === 0 ? 24 : hours, count);
        case "K":
            return pad(hours % 12, count);
        case "h":
            return pad(hours % 12 === 0 ? 12 : hours % 12, count);
        case "m":
            return pad(date.getMinutes(), count);
        case "s":
            return pad(date.getSeconds(), count);
        case "S":
            return pad(date.getMilliseconds(), count);
        case "a":
            return hours < 12 ? "AM" : "PM";
        default:
            return letter.repeat(count);
    }
}
