import fs from 'node:fs';

const svg = fs.readFileSync('حروف مع حسين layout.svg', 'utf8');
const textRegex = /<text class="cls-([0-9]+)" transform="translate\(([0-9.]+) ([0-9.]+)\)"><tspan[^>]*>(.*?)<\/tspan><\/text>/g;
let m;
const texts = [];
while ((m = textRegex.exec(svg)) !== null) {
  texts.push({ cls: m[1], x: parseFloat(m[2]), y: parseFloat(m[3]), text: m[4] });
}
console.log('Total texts:', texts.length);
texts.forEach((t, i) => {
  console.log(`${i}: text="${t.text}" at x=${t.x}, y=${t.y}`);
});
