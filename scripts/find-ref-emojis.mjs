import fs from 'node:fs';

const ref = fs.readFileSync('public/js/referee.js', 'utf8');
const lines = ref.split('\n');
const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
lines.forEach((l, i) => {
  if (emojiRegex.test(l)) {
    console.log(`${i + 1}: ${l}`);
  }
});
