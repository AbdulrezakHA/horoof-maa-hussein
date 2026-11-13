import fs from 'node:fs';

const svg = fs.readFileSync('حروف مع حسين layout.svg', 'utf8');

const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
if (styleMatch) {
  const css = styleMatch[1];
  ['cls-60', 'cls-62', 'cls-63', 'cls-31'].forEach(cls => {
    const reg = new RegExp(`\\.${cls}\\{([^}]+)\\}`, 'i');
    const m = css.match(reg);
    console.log(`${cls}: ${m ? m[1] : 'not found'}`);
  });
}
