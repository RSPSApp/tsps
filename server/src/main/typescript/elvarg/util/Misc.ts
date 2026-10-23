// import { Location } from '../game/model/Location';
// import { Player } from '../game/entity/impl/player/Player';
import { RandomGen } from "../util/RandomGen";
import { Location } from "../game/model/Location";
import * as fs from "fs";
import { readFileSync, existsSync } from "fs";
import { readFile } from "fs/promises";
import * as path from "path";
import { resolve } from "path";
import * as zlib from "zlib";
type TimeUnit = "seconds" | "minutes";

export class Misc {
  static getTicks(seconds: number): number {
    return seconds / 0.6;
  }

  static getSeconds(ticks: number): number {
    return ticks * 0.6;
  }

  static readonly FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  static readonly HALF_A_DAY_IN_MILLIS = 43200000;
  static readonly VALID_PLAYER_CHARACTERS = [
    "_",
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "[",
    "]",
    "/",
    "-",
    " ",
  ];
  static readonly VALID_CHARACTERS = [
    "_",
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "!",
    "@",
    "#",
    "$",
    "%",
    "^",
    "&",
    "",
    "(",
    ")",
    "-",
    "+",
    "=",
    ":",
    ";",
    ".",
    ">",
    "<",
    ",",
    '"',
    "[",
    "]",
    "|",
    "?",
    "/",
    "`",
  ];
  private static RANDOM = new RandomGen();
  private static readonly BLOCKED_WORDS = [
    ".com",
    ".net",
    ".org",
    "<img",
    "@cr",
    "<img=",
    ":tradereq:",
    ":duelreq:",
    "<col=",
    "<shad=",
  ];
  static readonly DIRECTIONS = [
    [-1, 1],
    [0, 1],
    [1, 1],
    [-1, 0],
    [1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  static xlateDirectionToClient = { 1: 2, 4: 7, 6: 5, 3: 0 };
  public static xlateTable: string[] = [
    " ",
    "e",
    "t",
    "a",
    "o",
    "i",
    "h",
    "n",
    "s",
    "r",
    "d",
    "l",
    "u",
    "m",
    "w",
    "c",
    "y",
    "f",
    "g",
    "p",
    "b",
    "v",
    "k",
    "x",
    "j",
    "q",
    "z",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    " ",
    "!",
    "?",
    ".",
    ",",
    ":",
    ";",
    "(",
    ")",
    "-",
    "&",
    "*",
    "\\",
    "'",
    "@",
    "#",
    "+",
    "=",
    "£",
    "$",
    "%",
    '"',
    "[",
    "]",
  ];

  public static getRandom(length: number): number {
    return Math.floor(Math.random() * (length + 1));
  }

  public static getRandomDouble(length: number): number {
    return Math.random() * length;
  }

  public static getRandomInt(): number {
    return Math.floor(Math.random() * (length + 1));
  }

  public static getCurrentServerTime(): string {
    const now = new Date();
    let hour = now.getHours();
    let hourPrefix = hour < 10 ? "0" + hour + "" : "" + hour + "";
    let minute = now.getMinutes();
    let minutePrefix = minute < 10 ? "0" + minute + "" : "" + minute + "";
    return "" + hourPrefix + ":" + minutePrefix + "";
  }

  public static getTimePlayed(totalPlayTime: number): string {
    const sec = Math.floor(totalPlayTime / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec / 60) % 60);
    const s = sec % 60;
    return (
      (h < 10 ? "0" + h : h) +
      ":" +
      (m < 10 ? "0" + m : m) +
      ":" +
      (s < 10 ? "0" + s : s)
    );
  }

  public static getHoursPlayed(totalPlayTime: number): string {
    const sec = Math.floor(totalPlayTime / 1000);
    const h = Math.floor(sec / 3600);
    return (h < 10 ? "0" + h : h) + "h";
  }

  public static getMinutesPassed(t: number): number {
    const seconds = Math.floor((t / 1000) % 60);
    const minutes = Math.floor((t - seconds) / 1000 / 60);
    return minutes;
  }

  public static concat(a: any[], b: any[]): any[] {
    const aLen = a.length;
    const bLen = b.length;
    const c = new Array(aLen + bLen);
    c.push(...a, ...b);
    return c;
  }

  public static getCloseRandomPlayer(plrs: any[]): any {
    const index = Misc.getRandom(plrs.length - 1);
    if (index > 0) {
      return plrs[index];
    }
    return null;
  }

  public static getDirection(x: number, y: number): number {
    for (let i = 0; i < 8; i++) {
      if (Misc.DIRECTIONS[i][0] == x && Misc.DIRECTIONS[i][1] == y) return i;
    }
    return -1;
  }

  public static ucFirst(str: string): string {
    str = str.toLowerCase();
    if (str.length > 1) {
      str = str.substring(0, 1).toUpperCase() + str.substring(1);
    } else {
      return str.toUpperCase();
    }
    return str;
  }

  public static format(num: number): string {
    return num.toLocaleString();
  }

  public static formatText(s: string): string {
    for (let i = 0; i < s.length; i++) {
      if (i == 0) {
        s = `${s.charAt(0).toUpperCase()}${s.substring(1)}`;
      }
      if (!/[a-zA-Z0-9]/.test(s.charAt(i))) {
        if (i + 1 < s.length) {
          s = `${s.substring(0, i + 1)}${s
            .charAt(i + 1)
            .toUpperCase()}${s.substring(i + 2)}`;
        }
      }
    }
    return s.replace("_", " ");
  }

  public static getTotalAmount(j: number): string {
    if (j >= 10000 && j < 1000000) {
      return j / 1000 + "K";
    } else if (j >= 1000000 && j <= Number.MAX_SAFE_INTEGER) {
      return j / 1000000 + "M";
    } else {
      return "" + j;
    }
  }

  public static formatPlayerName(str: string): string {
    return this.formatText(str);
  }

  public static insertCommasToNumber(number: string): string {
    return number.length < 4
      ? number
      : this.insertCommasToNumber(number.substring(0, number.length - 3)) +
          "," +
          number.substring(number.length - 3, number.length);
  }

  public static textUnpack(packedData: number[], size: number): string {
    let decodeBuf: number[] = new Array(4096);
    let idx = 0,
      highNibble = -1;
    for (let i = 0; i < size * 2; i++) {
      let val = (packedData[i / 2] >> (4 - 4 * (i % 2))) & 0xf;
      if (highNibble == -1) {
        if (val < 13) {
          decodeBuf[idx++] = parseInt(Misc.xlateTable[val]);
        } else {
          highNibble = val;
        }
      } else {
        decodeBuf[idx++] = parseInt(
          Misc.xlateTable[(highNibble << 4) + val - 195]
        );
        highNibble = -1;
      }
    }
    return new TextDecoder().decode(new Uint8Array(decodeBuf.slice(0, idx)));
  }

  public static anOrAr(s: string): string {
    s = s.toLowerCase();
    if (
      s === "anchovies" ||
      s === "soft clay" ||
      s === "cheese" ||
      s === "ball of wool" ||
      s === "spice" ||
      s === "steel nails" ||
      s === "snape grass" ||
      s === "coal"
    ) {
      return "some";
    }
    if (
      s.startsWith("a") ||
      s.startsWith("e") ||
      s.startsWith("i") ||
      s.startsWith("o") ||
      s.startsWith("u")
    ) {
      return "an";
    }
    return "a";
  }

  public static anOrAs(s: string): string {
    s = s.toLowerCase();
    if (
      s === "anchovies" ||
      s === "soft clay" ||
      s === "cheese" ||
      s === "ball of wool" ||
      s === "spice" ||
      s === "steel nails" ||
      s === "snape grass" ||
      s === "coal"
    ) {
      return "some";
    }
    if (
      s.startsWith("a") ||
      s.startsWith("e") ||
      s.startsWith("i") ||
      s.startsWith("o") ||
      s.startsWith("u")
    ) {
      return "an";
    }
    return "a";
  }

  public static textPack(text: string): number[] {
    if (text.length > 80) {
      text = text.substring(0, 80);
    }

    let packedData: number[] = [];
    text = text.toLowerCase();
    let carryOverNibble = -1;
    let ofs = 0;
    for (let idx = 0; idx < text.length; idx++) {
      let c = text.charAt(idx);
      let tableIdx = 0;
      for (let i = 0; i < Misc.xlateTable.length; i++) {
        if (c === Misc.xlateTable[i]) {
          tableIdx = i;
          break;
        }
      }
      if (tableIdx > 12) {
        tableIdx += 195;
      }
      if (carryOverNibble === -1) {
        if (tableIdx < 13) {
          carryOverNibble = tableIdx;
        } else {
          packedData[ofs++] = tableIdx;
        }
      } else if (tableIdx < 13) {
        packedData[ofs++] = (carryOverNibble << 4) + tableIdx;
        carryOverNibble = -1;
      } else {
        packedData[ofs++] = (carryOverNibble << 4) + (tableIdx >> 4);
        carryOverNibble = tableIdx & 0xf;
      }
    }
    if (carryOverNibble != -1) {
      packedData[ofs++] = carryOverNibble << 4;
    }
    return packedData;
  }

  public static anOrA(s: string): string {
    s = s.toLowerCase();
    if (
      s.toLowerCase() === "anchovies" ||
      s.toLowerCase() === "soft clay" ||
      s.toLowerCase() === "cheese" ||
      s.toLowerCase() === "ball of wool" ||
      s.toLowerCase() === "spice" ||
      s.toLowerCase() === "steel nails" ||
      s.toLowerCase() === "snape grass" ||
      s.toLowerCase() === "coal"
    )
      return "some";
    if (
      s.startsWith("a") ||
      s.startsWith("e") ||
      s.startsWith("i") ||
      s.startsWith("o") ||
      s.startsWith("u")
    )
      return "an";
    return "a";
  }

  public static getClasses(packageName: string): Array<any> {
    let classList: Array<any> = [];
    // Add logic to get classes from package name
    return classList;
  }

  private static findClasses(directory: string, packageName: string): any[] {
    let classes = [];
    let files = fs.readdirSync(directory);
    for (let file of files) {
      let filePath = path.join(directory, file);
      let stat = fs.lstatSync(filePath);
      if (stat.isDirectory()) {
        classes = classes.concat(
          Misc.findClasses(filePath, packageName + "." + file)
        );
      } else if (file.endsWith(".class")) {
        classes.push(
          require(packageName + "." + file.substring(0, file.length - 6))
        );
      }
    }
    return classes;
  }

  public static removeSpaces(s: string): string {
    return s.replace(/ /g, "");
  }

  public static getMinutesElapsed(
    minute: number,
    hour: number,
    day: number,
    year: number
  ): number {
    let i = new Date();
    if (i.getFullYear() == year) {
      if (i.getDate() == day) {
        if (hour == i.getHours()) {
          return i.getMinutes() - minute;
        }
        return (i.getHours() - hour) * 60 + (59 - i.getMinutes());
      }
      let ela = (i.getDate() - day) * 24 * 60 * 60;
      return ela > 2147483647 ? 2147483647 : ela;
    }
    let ela = Misc.getElapsed(day, year) * 24 * 60 * 60;
    return ela > 2147483647 ? 2147483647 : ela;
  }

  public static getDayOfYear = (): number => {
    let c = new Date();
    let year = c.getFullYear();
    let month = c.getMonth();
    let days = 0;
    let daysOfTheMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if ((year % 4 == 0 && year % 100 != 0) || year % 400 == 0) {
      daysOfTheMonth[1] = 29;
    }
    days += c.getDate();
    for (let i = 0; i < daysOfTheMonth.length; i++) {
      if (i < month) {
        days += daysOfTheMonth[i];
      }
    }
    return days;
  };

  public static getYear = (): number => {
    let c = new Date();
    return c.getFullYear();
  };

  public static getElapsed = (day: number, year: number): number => {
    if (year < 2013) {
      return 0;
    }

    let elapsed = 0;
    let currentYear = Misc.getYear();
    let currentDay = Misc.getDayOfYear();

    if (currentYear == year) {
      elapsed = currentDay - day;
    } else {
      elapsed = currentDay;

      for (let i = 1; i < 5; i++) {
        if (currentYear - i == year) {
          elapsed += 365 - day;
          break;
        } else {
          elapsed += 365;
        }
      }
    }

    return elapsed;
  };

  public static async readFile(s: File): Promise<Uint8Array> {
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        let fis = new FileReader();
        fis.readAsArrayBuffer(s);
        fis.onloadend = function () {
          const fc = new Uint8Array(fis.result as ArrayBuffer);
          resolve(fc);
        };
        fis.onerror = reject;
      });
    } catch (e) {
      console.log("FILE : " + s.name + " missing.");
      return null;
    }
  }

  public static isWeekend(): boolean {
    let day = new Date().getDay();
    return day === 0 || day === 6 || day === 7;
  }

  public static randomTypeOfList<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
  }

  public static randomInclusive(min: number, max: number): number {
    return (
      Math.min(min, max) +
      Math.floor(Math.random() * (Math.max(min, max) - Math.min(min, max) + 1))
    );
  }

  public static async getBuffers(filePath: string): Promise<Uint8Array | null> {
    try {
      const buffer = await readFile(filePath);
      const inflated = await new Promise<Buffer>((resolve, reject) => {
        zlib.gunzip(buffer, (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
      if (inflated.length < 10) {
        return null;
      }
      return new Uint8Array(inflated);
    } catch (e) {
      console.log(`Error reading file "${filePath}":`, e);
      return null;
    }
  }

  // public static getFormattedPlayTime(player: Player): string {
  public static getFormattedPlayTime(player: any): string {
    const now = new Date().getTime();
    const creationDate = player.getCreationDate().getTime();
    const elapsed = now - creationDate;

    const secondsInMilli = 1000;
    const minutesInMilli = secondsInMilli * 60;
    const hoursInMilli = minutesInMilli * 60;
    const daysInMilli = hoursInMilli * 24;

    const elapsedDays = Math.floor(elapsed / daysInMilli);
    const elapsedHours = Math.floor((elapsed % daysInMilli) / hoursInMilli);
    const elapsedMinutes = Math.floor(
      (elapsed % hoursInMilli) / minutesInMilli
    );
    const elapsedSeconds = Math.floor(
      (elapsed % minutesInMilli) / secondsInMilli
    );

    return `${elapsedDays} day(s) : ${elapsedHours} hour(s) : ${elapsedMinutes} minute(s) : ${elapsedSeconds} second(s)`;
  }

  public static getTimeLeft = (
    start: number,
    timeAmount: number,
    timeUnit: TimeUnit
  ): number => {
    const unitToMs: Record<TimeUnit, number> = {
      seconds: 1000,
      minutes: 60 * 1000,
    };
    const elapsedMs = Date.now() - start;
    const totalMs = timeAmount * unitToMs[timeUnit];
    const remaining = (totalMs - elapsedMs) / unitToMs[timeUnit];
    return Math.max(remaining, 1);
  };

  public static hexToInt(data: number[]) {
    let value = 0;
    let n = 1000;
    for (let i = 0; i < data.length; i++) {
      let num = (data[i] & 0xff) * n;
      value += num;
      if (n > 1) {
        n = n / 1000;
      }
    }
    return value;
  }

  public static delta(a: Location, b: Location): Location {
    return new Location(b.getX() - a.getX(), b.getY() - a.getY(), b.getZ());
  }

  // Picks a random element out of any array type
  public static randomElements<T>(array: T[]) {
    return array[Math.floor(Math.random() * array.length)];
  }

  // Picks a random element out of any list type
  public static randomElement<T>(list: T[]) {
    return list[Math.floor(Math.random() * list.length)];
  }

  public static blockedWord(string: string): boolean {
    const BLOCKED_WORDS: string[] = [];
    for (const s of Misc.BLOCKED_WORDS) {
      if (string.includes(s)) {
        return true;
      }
    }
    return false;
  }

  public static capitalizeWords(name: string): string {
    let builder = "";
    const words = name.split(" ");
    let i; // mover a declaração da variável i para fora do loop
    for (i = 0; i < words.length; ++i) {
      if (i > 0) {
        builder += " ";
      }
      builder += words[i][0].toUpperCase() + words[i].substring(1);
    }
    return builder;
  }

  public static capitalize(name: string): string {
    if (name.length < 1) {
      return "";
    }
    let builder = "";
    builder += name[0].toUpperCase() + name.substring(1).toLowerCase();
    return builder;
  }

  public static getVowelFormat(name: string): string {
    let letter = name.charAt(0);
    let vowel =
      letter == "a" ||
      letter == "e" ||
      letter == "i" ||
      letter == "o" ||
      letter == "u";
    let other = vowel ? "an" : "a";
    return other + " " + name;
  }

  public static isValidName(name: string): boolean {
    return Misc.formatNameForProtocol(name).match(/^[a-z0-9_]+$/gi) !== null;
  }

  public static stringToLong(string: string): number {
    let l: number = 0;
    for (let i = 0; i < string.length && i < 12; i++) {
      let c = string.charAt(i);
      l *= 37;
      if (c >= "A" && c <= "Z") {
        l += 1 + c.charCodeAt(0) - 65;
      } else if (c >= "a" && c <= "z") {
        l += 1 + c.charCodeAt(0) - 97;
      } else if (c >= "0" && c <= "9") {
        l += 27 + c.charCodeAt(0) - 48;
      }
    }
    while (l % 37 === 0 && l !== 0) {
      l /= 37;
    }
    return l;
  }

  public static stringToLongBigInt(string: string): bigint {
    let l = 0n;
    for (let i = 0; i < string.length && i < 12; i++) {
      const c = string.charAt(i);
      l *= 37n;
      if (c >= "A" && c <= "Z") {
        l += BigInt(1 + c.charCodeAt(0) - 65);
      } else if (c >= "a" && c <= "z") {
        l += BigInt(1 + c.charCodeAt(0) - 97);
      } else if (c >= "0" && c <= "9") {
        l += BigInt(27 + c.charCodeAt(0) - 48);
      }
    }
    while (l !== 0n && l % 37n === 0n) {
      l /= 37n;
    }
    return l;
  }

  public static getBuffer(file: string): Uint8Array | null {
    try {
      if (!fs.existsSync(file)) {
        return null;
      }
      let buffer = new Uint8Array(readFileSync(file));
      return buffer;
    } catch (e) {
      console.error(e);
    }
    return null;
  }

  public static formatNameForProtocol(name: string): string {
    return name.toLowerCase().replace(/ /g, "_");
  }

  /** A typed login name as shown in game: capitals kept, underscores as spaces. */
  public static formatDisplayName(name: string): string {
    return name.trim().replace(/_/g, " ");
  }

  public static formatName(name: string): string {
    return Misc.fixName(name.replace(" ", "_"));
  }

  public static longToString(l: number | bigint): string {
    let value: bigint;
    if (typeof l === "bigint") {
      value = l;
    } else {
      if (!Number.isFinite(l)) {
        return "";
      }
      value = BigInt(Math.trunc(l));
    }

    if (value <= 0n) {
      return "";
    }

    const chars: string[] = [];
    while (value !== 0n && chars.length < 12) {
      const index = Number(value % 37n);
      chars.push(Misc.VALID_PLAYER_CHARACTERS[index] ?? "_");
      value /= 37n;
    }

    return chars.reverse().join("");
  }

  public static fixName(name: string): string {
    if (name.length > 0) {
      const ac = name.split("");
      for (let j = 0; j < ac.length; j++) {
        if (ac[j] === "_") {
          ac[j] = " ";
          if (j + 1 < ac.length && ac[j + 1] >= "a" && ac[j + 1] <= "z") {
            ac[j + 1] = String.fromCharCode(ac[j + 1].charCodeAt(0) + 65 - 97);
          }
        }
      }
      if (ac[0] >= "a" && ac[0] <= "z") {
        ac[0] = String.fromCharCode(ac[0].charCodeAt(0) + 65 - 97);
      }
      return ac.join("");
    } else {
      return name;
    }
  }

  public static wrapText(text: string, len: number): string[] {
    const EFFECTS: string[] = [
      "@gre@",
      "@cya@",
      "@red@",
      "chalreq",
      "tradereq",
      "@bro@",
      "@yel@",
      "@blu@",
      "@gr1@",
      "@gr2@",
      "@gr3@",
      "@str@",
      "@mag@",
      "@dre@",
      "@dbl@",
      "@or1@",
      "@or2@",
      "@or3@",
      "@whi@",
      "@bla@",
      "@cr",
      "<col",
      "<shad",
      "<str",
      "<u",
      "<br",
      "<trans",
      "duelreq",
      "<img",
      "@lre@",
      ":clan:",
      "]cr",
      "::summ",
      "<str",
    ];
    // Retorna um array vazio para o texto nulo
    if (text == null) {
      return [];
    }

    // Retorna o texto se len for zero ou menor
    if (len <= 0) {
      return [text];
    }

    // Retorna o texto se for menor ou igual ao comprimento
    if (text.length <= len) {
      return [text];
    }

    const chars = text.split("");
    const lines = [];
    let line = "";
    let word = "";

    // Efeitos de texto
    let effects = null;
    for (const effectCode of EFFECTS) {
      if (text.includes(effectCode)) {
        if (effects == null) {
          effects = "";
        }
        effects += effectCode;
      }
    }

    for (let i = 0; i < chars.length; i++) {
      word += chars[i];

      if (chars[i] == " ") {
        if (line.length + word.length > len) {
          let line_ = line;

          // Aplica os efeitos
          if (effects != null && !line_.startsWith(effects)) {
            line_ = effects + line_;
          }

          lines.push(line_);
          line = "";
        }

        line += word;
        word = "";
      }
    }

    // Lidar com quaisquer caracteres extras na palavra atual
    if (word.length > 0) {
      if (line.length + word.length > len) {
        let line_ = line;

        // Aplica os efeitos
        if (effects != null && !line_.startsWith(effects)) {
          line_ = effects + line_;
        }

        lines.push(line_);
        line = "";
      }
      line += word;
    }

    // Lidar com linha extra
    if (line.length > 0) {
      let line_ = line;

      // Aplica os efeitos
      if (effects != null && !line_.startsWith(effects)) {
        line_ = effects + line_;
      }

      lines.push(line_);
    }

    return lines;
  }

  public static hash(string: string): number {
    return Misc.hash(string.toUpperCase());
  }

  public static getUsersProjectRootDirectory(): string {
    const envRootDir = process.cwd();
    const rootDir = resolve(".");
    if (rootDir.startsWith(envRootDir)) {
      return rootDir;
    } else {
      throw new Error("Root dir not found in user directory.");
    }
  }

  public static randoms(range: number): number {
    return Math.floor(Math.random() * (range + 1));
  }

  public static random(minRange: number, maxRange: number): number {
    return minRange + Misc.randoms(maxRange - minRange);
  }

  /**
   * Get a random number between a range and exclude some numbers.
   * The excludes list MUST BE MODIFIABLE.
   *
   * @param start start number
   * @param end end number
   * @param excludes list of numbers to be excluded
   * @return value between `start` (inclusive) and `end` (inclusive)
   */
  public static getRandomExlcuding(
    start: number,
    end: number,
    excludes: number[]
  ): number {
    if (start > end) {
      [start, end] = [end, start];
    }

    const range = end - start + 1;
    let random = start + Math.floor(Math.random() * range);

    while (excludes.includes(random)) {
      random = start + Math.floor(Math.random() * range);
    }

    return random;
  }

  public static concatWithCollection<T>(array1: T[], array2: T[]): T[] {
    let resultList: T[] = [...array1, ...array2];
    return resultList;
  }
}
