// The Diary of Randas, from Transcript:The Diary of Randas on the OSRS Wiki (the 25 July 2019
// copy, matching the Crazed scribbles book). Koftik at the bridge opens it from his
// "What does it say?" choice. The book widget (392) gives a page 15 lines, so the paragraphs
// are wrapped to its width here and the text runs over the first spread (left page, then right).
const TITLE = "The Diary of Randas";
const WIDTH = 36;

const PARAGRAPHS = [
  "It began as a whisper in my ears. Dismissing the sounds as the whistling of the wind, I steeled myself against these forces, and continued on my way.",
  "But the whispers became moans...",
  "At once fearsome and enticing like the call of some beautiful siren.",
  "Join us!",
  "Our greatness lies within you, but only Zamorak can unlock your potential...",
];

function wrap(text) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= WIDTH) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const LINES = PARAGRAPHS.flatMap((paragraph, index) => (index ? ["", ...wrap(paragraph)] : wrap(paragraph)));
if (LINES.length > 30) throw new Error("The Diary of Randas no longer fits one book spread");

// Book 392 maps text components 44-58 to the left page's lines and 60-74 to the right page's.
const PAGES = [Object.fromEntries(LINES.map((line, index) => [index < 15 ? 44 + index : 60 + index - 15, line]))];

module.exports = { title: TITLE, pages: PAGES };
