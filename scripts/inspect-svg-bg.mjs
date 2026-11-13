import fs from 'node:fs';

const svg = fs.readFileSync('حروف مع حسين layout.svg', 'utf8');

// Find all rects and polygons in original SVG
const rectRegex = /<rect[^>]+>/g;
let m;
console.log('Rects:');
while ((m = rectRegex.exec(svg)) !== null) console.log(m[0]);

const polyRegex = /<polygon[^>]+>/g;
console.log('Polygons:');
while ((m = polyRegex.exec(svg)) !== null) console.log(m[0]);
