import fs from 'node:fs';

const svg = fs.readFileSync('حروف مع حسين layout.svg', 'utf8');

// Let's also check what Illustrator put in the original SVG for the text positions!
const textRegex = /<text[^>]*transform="matrix\([^)]+\)\s+translate\(([^)]+)\)"[^>]*>([^<]+)<\/text>/g;
let match;
console.log('Original SVG texts:');
while ((match = textRegex.exec(svg)) !== null) {
  console.log(`Text: "${match[2]}" translate: ${match[1]}`);
}

// Check other texts
const textRegex2 = /<text[^>]*>([\s\S]*?)<\/text>/g;
let m2;
let count = 0;
while ((m2 = textRegex2.exec(svg)) !== null && count < 10) {
  console.log('Text match:', m2[0]);
  count++;
}
