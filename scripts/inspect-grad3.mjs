import fs from 'node:fs';
const svg = fs.readFileSync('حروف مع حسين layout.svg', 'utf8');
const m = svg.match(/<linearGradient id="linear-gradient-3"[\s\S]*?<\/linearGradient>/);
console.log(m ? m[0] : 'not found');
