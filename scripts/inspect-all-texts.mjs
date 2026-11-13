import fs from 'node:fs';

const svg = fs.readFileSync('حروف مع حسين layout.svg', 'utf8');

// find all <text> elements
const textRegex = /<text\s+class="cls-([^"]+)"\s+transform="translate\(([^)]+)\)">([\s\S]*?)<\/text>/g;
let m;
const allTexts = [];
while ((m = textRegex.exec(svg)) !== null) {
  const cls = m[1];
  const [x, y] = m[2].trim().split(/\s+/).map(Number);
  const content = m[3].replace(/<[^>]+>/g, '').trim();
  allTexts.push({ cls, x, y, content });
}

allTexts.sort((a, b) => {
  if (Math.abs(a.y - b.y) > 40) return a.y - b.y;
  return a.x - b.x;
});

allTexts.forEach(t => console.log(`y=${t.y.toFixed(1)}, x=${t.x.toFixed(1)}: "${t.content}"`));
