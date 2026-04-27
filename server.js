const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const VAULT = '/home/guszti/Obsidian_Vault';

// Vercel: vault.json-ból olvas; lokálisan: fájlrendszerből
const IS_VERCEL = !!process.env.VERCEL;
let vaultData = null;
if (IS_VERCEL) {
  try {
    vaultData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'vault.json'), 'utf8'));
    console.log(`Vault betöltve: ${Object.keys(vaultData.files).length} fájl (${vaultData.exportedAt})`);
  } catch (e) {
    console.error('HIBA: data/vault.json nem található –', e.message);
  }
}

app.use(express.json());
app.use(express.static(__dirname));

// ── Segédfüggvények ────────────────────────────────────────────────────────────

function readFile(filePath) {
  if (IS_VERCEL && vaultData) {
    const key = path.relative(VAULT, filePath).replace(/\\/g, '/');
    return vaultData.files[key] || '';
  }
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return ''; }
}

function listMdFiles(dir) {
  if (IS_VERCEL && vaultData) {
    const rel = path.relative(VAULT, dir).replace(/\\/g, '/');
    return Object.keys(vaultData.files)
      .filter(k => k.startsWith(rel + '/') && !k.slice(rel.length + 1).includes('/') && k.endsWith('.md'))
      .map(k => path.basename(k))
      .filter(f => !/^(sablon|SABLON)/i.test(f));
  }
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md') && !/^(sablon|SABLON)/i.test(f));
  } catch { return []; }
}

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  m[1].split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  return out;
}

// Q:/A: és "word :: meaning — example" flashcardok kinyerése
function parseFlashcards(content, source) {
  const cards = [];
  const lines = content.split('\n');
  let q = null;
  for (const line of lines) {
    // Q:/A: formátum
    if (line.startsWith('Q: ')) { q = line.slice(3).trim(); continue; }
    if (line.startsWith('A: ') && q) {
      const aFull = line.slice(3).trim();
      const parts = aFull.split(' — ');
      cards.push({ q, a: aFull, meaning: parts[0].trim(), example: parts[1] ? parts[1].trim() : '', source });
      q = null;
      continue;
    }
    // Obsidian SR formátum: "word :: meaning — example"
    if (line.includes(' :: ') && !line.startsWith('|') && !line.startsWith('#') && !line.startsWith('-')) {
      const [wordPart, rest] = line.split(' :: ');
      if (wordPart && rest) {
        const parts = rest.split(' — ');
        cards.push({ q: wordPart.trim(), a: rest.trim(), meaning: parts[0].trim(), example: parts[1] ? parts[1].trim() : '', source });
      }
    }
  }
  return cards;
}

// Markdown táblázat sorai (fejléc és elválasztó kihagyva)
function parseTableRows(block) {
  return block.split('\n')
    .filter(r => r.startsWith('|') && !r.includes('---'))
    .map(r => r.split('|').filter(c => c.trim()).map(c => c.trim()))
    .filter(cols => cols.length >= 2);
}

// Markdown szekció kinyerése (## Cím ... ## Következő)
function extractSection(content, headingPattern) {
  const re = new RegExp(`${headingPattern}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n## |<!-- |$)`);
  const m = content.match(re);
  return m ? m[1].trim() : '';
}

// ── API végpontok ─────────────────────────────────────────────────────────────

// Minden flashcard a Vocabulary mappából
app.get('/api/vocabulary', (req, res) => {
  const dir = path.join(VAULT, 'Vocabulary');
  const cards = [];
  listMdFiles(dir).forEach(file => {
    if (file === 'master-lista.md') return;
    const content = readFile(path.join(dir, file));
    const fm = parseFrontmatter(content);
    const topic = (fm.topic || file.replace('.md', '')).replace(/[\[\]]/g, '');
    parseFlashcards(content, topic).forEach(c => cards.push(c));
  });
  res.json({ cards, total: cards.length });
});

// Grammar leckék (legújabb elöl)
app.get('/api/grammar', (req, res) => {
  const dir = path.join(VAULT, 'Grammar');
  const lessons = listMdFiles(dir).map(file => {
    const content = readFile(path.join(dir, file));
    const fm = parseFrontmatter(content);
    const titleM = content.match(/^# (.+)$/m);
    return {
      file,
      title: titleM ? titleM[1] : (fm.topic || file),
      date: fm.date || '',
      topic: (fm.topic || '').replace(/[\[\]]/g, ''),
      rule:     extractSection(content, '## Szabály'),
      when:     extractSection(content, '## Mikor'),
      forms:    extractSection(content, '## Alakok'),
      examples: extractSection(content, '## Példák'),
      mistakes: extractSection(content, '## Gyakori hibák'),
      practice: extractSection(content, '## Gyakorlat'),
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
  res.json({ lessons });
});

// Hibák az utolsó 10 Journal bejegyzésből
app.get('/api/mistakes', (req, res) => {
  const dir = path.join(VAULT, 'Journal');
  const mistakes = [];
  listMdFiles(dir).sort().reverse().slice(0, 10).forEach(file => {
    const content = readFile(path.join(dir, file));
    const section = extractSection(content, '## 4\\.');
    parseTableRows(section).forEach(cols => {
      if (cols[0] !== 'Szó / Kifejezés') {
        mistakes.push({
          wrong:   cols[0] || '',
          correct: (cols[1] || '').replace(/\*\*/g, ''),
          reason:  cols[2] || '',
          date:    file.replace('.md', '')
        });
      }
    });
  });
  res.json({ mistakes });
});

// Mai / holnapi terv a legutóbbi Journalból
app.get('/api/plan', (req, res) => {
  const dir = path.join(VAULT, 'Journal');
  const files = listMdFiles(dir).sort().reverse();
  if (!files.length) return res.json({ plan: '' });
  const content = readFile(path.join(dir, files[0]));
  const plan = extractSection(content, '## 6\\.');
  const date = files[0].replace('.md', '');
  res.json({ plan, date });
});

// Kvíz: 6 multiple-choice kérdés, angol → magyar irány
app.get('/api/quiz', (req, res) => {
  const dir = path.join(VAULT, 'Vocabulary');
  const all = [];
  listMdFiles(dir).forEach(file => {
    if (file === 'master-lista.md') return;
    const content = readFile(path.join(dir, file));
    const fm = parseFrontmatter(content);
    const topic = (fm.topic || file.replace('.md', '')).replace(/[\[\]]/g, '');
    parseFlashcards(content, topic).forEach(c => all.push(c));
  });
  if (all.length < 4) return res.json({ questions: [] });

  const shuffled = [...all].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(6, all.length));

  const questions = selected.map((card, i) => {
    const correct = card.meaning;
    const distractors = all
      .filter(c => c.meaning !== correct)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(c => c.meaning);
    const options = [correct, ...distractors].sort(() => Math.random() - 0.5);
    return { id: i, question: card.q, example: card.example, options, correct, source: card.source };
  });
  res.json({ questions });
});

// Haladás adatok a Journal fájlokból
app.get('/api/progress', (req, res) => {
  const dir = path.join(VAULT, 'Journal');
  const data = listMdFiles(dir).sort().map(file => {
    const content = readFile(path.join(dir, file));
    const date = file.replace('.md', '');

    // Új szavak száma
    const wordsMatch = content.match(/Hány új szó:\s*(\d+)/);
    const newWords = wordsMatch ? parseInt(wordsMatch[1]) : 0;

    // Kvíz eredmények kinyerése a "Gyakorlás" táblázatból
    const practiceSection = extractSection(content, '## 2\\.');
    const quizScores = parseTableRows(practiceSection)
      .filter(cols => cols[0] && /kvíz/i.test(cols[0]) && cols[1])
      .map(cols => { const m = cols[1].match(/(\d+)%/); return m ? parseInt(m[1]) : null; })
      .filter(v => v !== null);
    const avgQuiz = quizScores.length
      ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length) : null;

    // Mai átlag szint (1-10)
    const levelMatch = content.match(/Mai átlag:\s*(\d+)\/10/);
    const level = levelMatch ? parseInt(levelMatch[1]) : null;

    return { date, newWords, avgQuiz, quizScores, level };
  });
  res.json({ data });
});

// Elérhető Ollama modellek
app.get('/api/models', (req, res) => {
  const opts = { hostname: 'localhost', port: 11434, path: '/api/tags', method: 'GET' };
  const r = http.request(opts, r2 => {
    let d = '';
    r2.on('data', c => d += c);
    r2.on('end', () => {
      try {
        const parsed = JSON.parse(d);
        const models = (parsed.models || []).map(m => m.name);
        res.json({ models: models.length ? models : ['llama3:8b'] });
      } catch { res.json({ models: ['llama3:8b'] }); }
    });
  });
  r.on('error', () => res.json({ models: ['llama3:8b'] }));
  r.end();
});

// AI tutor – dinamikus Ollama modell
app.post('/api/chat', (req, res) => {
  const { message, model: chosenModel } = req.body;
  if (!message) return res.status(400).json({ error: 'Üres üzenet' });

  const modelToUse = chosenModel || 'llama3:8b';

  const system = `You are a friendly English tutor for Gusztáv, a Hungarian adult learner at A2 level.
Rules:
- Keep answers SHORT (max 5 sentences).
- Use simple A2-level English.
- Add Hungarian translation for new words in (parentheses).
- Be encouraging and patient.
- When correcting mistakes, always show: WRONG ❌ → CORRECT ✅
- Current topics: "have got", "can/can't", emotions vocabulary, body parts vocabulary.
- Known weak points: "she have got" → "she HAS got"; "exited" → "excited"; "nerveus" → "nervous".`;

  const fullPrompt = `${system}\n\nStudent: ${message}\nTutor:`;

  const body = JSON.stringify({ model: modelToUse, prompt: fullPrompt, stream: false });

  const opts = {
    hostname: 'localhost', port: 11434, path: '/api/generate', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };

  const req2 = http.request(opts, r2 => {
    let data = '';
    r2.on('data', c => data += c);
    r2.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        res.json({ response: parsed.response || 'Sajnálom, próbáld újra!' });
      } catch {
        res.json({ response: 'Ollama válasz hiba. Próbáld újra.' });
      }
    });
  });

  req2.on('error', e => {
    res.json({ response: `⚠️ Ollama nem elérhető: ${e.message}\nFuttasd: ollama serve` });
  });

  req2.write(body);
  req2.end();
});

// Ollama állapot ellenőrzés
app.get('/api/status', (req, res) => {
  const opts = { hostname: 'localhost', port: 11434, path: '/', method: 'GET' };
  const r = http.request(opts, r2 => {
    res.json({ ollama: true });
    r2.resume();
  });
  r.on('error', () => res.json({ ollama: false }));
  r.end();
});

app.listen(PORT, () => {
  console.log(`\n📚 Angol Tanulás App – http://localhost:${PORT}`);
  console.log(`📁 Vault: ${VAULT}`);
  console.log(`🤖 Ollama: http://localhost:11434 (llama3:8b)\n`);
});
