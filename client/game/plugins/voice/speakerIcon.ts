import { IndexedSprite } from "../../../rs/sprite/IndexedSprite";

const rows = [
    "........................",
    "........................",
    "........................",
    "...................##...",
    "..................#ww#..",
    "...........##......#ww#.",
    "..........#ss#..##..#ww#",
    ".........#sss#.#ww#.#ww#",
    "........#ssss#..#ww#.#w#",
    "...#####sssss#..#ww#.#w#",
    "..#ssssssssss#...#w#.#w#",
    "..#ssssssssss#...#w#.#w#",
    "..#ssssssssss#...#w#.#w#",
    "..#ssssssssss#...#w#.#w#",
    "...#####sssss#..#ww#.#w#",
    "........#ssss#..#ww#.#w#",
    ".........#sss#.#ww#.#ww#",
    "..........#ss#..##..#ww#",
    "...........##......#ww#.",
    "..................#ww#..",
    "...................##...",
    "........................",
    "........................",
    "........................",
];

const speaker = new IndexedSprite();
speaker.width = speaker.subWidth = 24;
speaker.height = speaker.subHeight = 24;
speaker.xOffset = speaker.yOffset = 0;
speaker.palette = new Int32Array([0, 0x161616, 0xf0ead6, 0x63e69c]);
speaker.pixels = Uint8Array.from(rows.join(""), pixel => ".#sw".indexOf(pixel));

export const SPEAKER_HEAD_ICONS: readonly IndexedSprite[] = [speaker];
