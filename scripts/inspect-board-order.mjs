import { cellCenter } from '../shared/engine.js';
import fs from 'node:fs';

const board = JSON.parse(fs.readFileSync('data/board.json', 'utf8'));

console.log('board.json Row 0 cells:');
board.cells.filter(c => c.r === 0).forEach(c => {
  const pt = cellCenter(c.r, c.c, 120);
  console.log(`id=${c.id}, col=${c.c}, letter=${c.letter}, x=${pt.x}`);
});

console.log('\nboard.json Row 1 cells:');
board.cells.filter(c => c.r === 1).forEach(c => {
  const pt = cellCenter(c.r, c.c, 120);
  console.log(`id=${c.id}, col=${c.c}, letter=${c.letter}, x=${pt.x}`);
});
