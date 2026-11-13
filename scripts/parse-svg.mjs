import fs from 'node:fs';

const svg = fs.readFileSync('حروف مع حسين layout.svg', 'utf8');

// The 25 board cells are arranged in 5 rows:
// Row 0: y=191.96, indices in paths: 0, 1, 2, 3, 4
// Row 1: y=344.02, indices in paths: 15, 16, 17, 18, 19
// Row 2: y=496.08, indices in paths: 10, 11, 12, 13, 14
// Row 3: y=648.15, indices in paths: 20, 21, 22, 23, 24
// Row 4: y=800.21, indices in paths: 5, 6, 7, 8, 9

const pathRegex = /<path\s+class="cls-[^"]+"\s+d="([^"]+)"\/>/g;
const paths = [];
let match;
while ((match = pathRegex.exec(svg)) !== null) {
  paths.push(match[1]);
}

// Ellipses in Group 2:
// Look at lines 580-689 in SVG
const ellipseGroups = [];
const ellRegex = /<g>\s*(<ellipse[^>]+>\s*<ellipse[^>]+>)\s*<\/g>/g;
while ((match = ellRegex.exec(svg)) !== null) {
  ellipseGroups.push(match[1]);
}
console.log('Ellipse pairs found:', ellipseGroups.length);

// Let's verify row mapping:
// In the SVG, ellipse groups are:
// 0..4: Row 0 (y=177.26)
// 5..9: Row 1 (y=329.29)
// 10..14: Row 3 (y=633.34)
// 15..19: Row 2 (y=481.31)
// 20..24: Row 4 (y=785.37)
// 25: Selected letter hex (cx=1474.78)
// 26: Score hex 2 (cx=1585.06)
// 27: Score hex 3 (cx=1365.76)

const rowIndices = [
  { row: 0, pathIdxs: [0, 1, 2, 3, 4], ellIdxs: [0, 1, 2, 3, 4] },
  { row: 1, pathIdxs: [15, 16, 17, 18, 19], ellIdxs: [5, 6, 7, 8, 9] },
  { row: 2, pathIdxs: [10, 11, 12, 13, 14], ellIdxs: [15, 16, 17, 18, 19] },
  { row: 3, pathIdxs: [20, 21, 22, 23, 24], ellIdxs: [10, 11, 12, 13, 14] },
  { row: 4, pathIdxs: [5, 6, 7, 8, 9], ellIdxs: [20, 21, 22, 23, 24] }
];

// Text positions:
// Let's extract text elements
const textMatches = [...svg.matchAll(/<text class="cls-[^"]+" transform="translate\(([0-9.]+) ([0-9.]+)\)"><tspan[^>]*>(.*?)<\/tspan><\/text>/g)];
console.log('Text elements found:', textMatches.length);

const cellDefs = [];

rowIndices.forEach(({ row, pathIdxs, ellIdxs }) => {
  pathIdxs.forEach((pIdx, col) => {
    const d = paths[pIdx];
    const e = ellipseGroups[ellIdxs[col]];
    // cell id is r{row}c{col}
    // Let's find center of hex:
    const m = d.match(/^M([0-9.]+),([0-9.]+)/);
    const startX = parseFloat(m[1]);
    const startY = parseFloat(m[2]);
    const centerX = startX + 175.58 / 2;
    const centerY = startY + 156.55 / 2;
    cellDefs.push({
      id: `r${row}c${col}`,
      r: row,
      c: col,
      d,
      ellipses: e,
      centerX,
      centerY: startY + 87 // baseline for font
    });
  });
});

fs.writeFileSync('scripts/cell-defs.json', JSON.stringify({
  cells: cellDefs,
  selectedHex: {
    d: paths[25],
    ellipses: ellipseGroups[25],
    centerX: 1527.86,
    centerY: 320
  },
  scoreHexA: { // Purple
    d: paths[26],
    ellipses: ellipseGroups[26],
    centerX: 1638.15,
    centerY: 885
  },
  scoreHexB: { // Cyan
    d: paths[27],
    ellipses: ellipseGroups[27],
    centerX: 1418.84,
    centerY: 885
  }
}, null, 2));

console.log('Wrote scripts/cell-defs.json successfully!');
