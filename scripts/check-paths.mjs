import fs from 'node:fs';

const svg = fs.readFileSync('حروف مع حسين layout.svg', 'utf8');
const pathRegex = /<path\s+class="cls-[^"]+"\s+d="([^"]+)"\/>/g;
const paths = [];
let match;
while ((match = pathRegex.exec(svg)) !== null) paths.push(match[1]);

console.log('Path 0 (d):', paths[0]);
console.log('Path 4 (d):', paths[4]);
console.log('Path 25 (selected):', paths[25]);
console.log('Path 26 (score A):', paths[26]);
