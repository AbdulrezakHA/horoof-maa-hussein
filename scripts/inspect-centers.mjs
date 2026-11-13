import fs from 'node:fs';

const svg = fs.readFileSync('حروف مع حسين layout.svg', 'utf8');
const pathRegex = /<path\s+class="cls-[^"]+"\s+d="([^"]+)"\/>/g;
const paths = [];
let match;
while ((match = pathRegex.exec(svg)) !== null) paths.push(match[1]);

paths.forEach((d, i) => {
  const m = d.match(/^M([0-9.]+),([0-9.]+)/);
  if (m) {
    const sx = parseFloat(m[1]);
    const sy = parseFloat(m[2]);
    const cx = (sx + 175.59 / 2).toFixed(1);
    const cy = (sy + 39.135).toFixed(1); // mid of vertical line (which is vertical center of hex!)
    console.log(`Path ${i}: start=(${sx}, ${sy}) -> center=(${cx}, ${cy})`);
  }
});
