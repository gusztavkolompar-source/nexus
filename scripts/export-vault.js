// Vault tartalom exportálása data/vault.json-ba (Vercel deployhoz)
// Használat: node scripts/export-vault.js

const fs = require('fs');
const path = require('path');

const VAULT = '/home/guszti/Obsidian_Vault';
const DIRS  = ['Vocabulary', 'Grammar', 'Journal'];
const OUT   = path.join(__dirname, '..', 'data', 'vault.json');

const files = {};

DIRS.forEach(dir => {
  const dirPath = path.join(VAULT, dir);
  try {
    fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.md'))
      .forEach(f => {
        files[`${dir}/${f}`] = fs.readFileSync(path.join(dirPath, f), 'utf8');
      });
  } catch (e) {
    console.warn(`[SKIP] ${dir}: ${e.message}`);
  }
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ files, exportedAt: new Date().toISOString() }, null, 2));

console.log(`✅ Exportálva: ${Object.keys(files).length} fájl → data/vault.json`);
Object.keys(files).forEach(k => console.log(`   ${k}`));
