  { t: 'Tipos de IPERC', q: '¿Cuál es un tipo de IPERC utilizado para identificar peligros antes de realizar una actividad?', o: ['IPERC continuo', 'IPERC de línea base', 'IPERC inicial', 'IPERC documental'], c: 1 },
  { t: 'Seguridad y Salud en el Trabajo', q: '¿Cuál es el principal objetivo de la SST?', o: ['Aumentar las horas de trabajo', 'Prevenir accidentes y proteger la salud de los trabajadores', 'Reducir las capacitaciones', 'Eliminar los procedimientos de seguridad'], c: 1 },
  { t: 'Colores de seguridad', q: '¿Qué color se utiliza principalmente para advertir sobre un peligro o riesgo?', o: ['Amarillo', 'Verde', 'Azul', 'Blanco'], c: 0 },
  { t: 'Tipos de peligros', q: '¿Cuál de los siguientes es un peligro físico?', o: ['Ruido', 'Virus', 'Sustancia tóxica', 'Postura inadecuada'], c: 0 },
  { t: 'Tipos de peligros', q: '¿Cuál de los siguientes corresponde a un peligro biológico?', o: ['Ruido', 'Virus y bacterias', 'Electricidad', 'Temperatura elevada'], c: 1 },
  { t: 'Cilindros de gases', q: '¿Qué debe hacerse antes de utilizar un cilindro de gas?', o: ['Golpearlo para comprobar su contenido', 'Verificar su identificación, estado y condiciones de seguridad', 'Retirar sus etiquetas', 'Colocarlo horizontalmente siempre'], c: 1 },
  { t: 'Tipos de residuos', q: '¿Cuál es una característica de los residuos peligrosos?', o: ['No presentan ningún riesgo', 'Pueden presentar características como toxicidad o inflamabilidad', 'Siempre son residuos orgánicos', 'Solo contienen papel'], c: 1 },
  { t: 'Los 9 principios de SST', q: '¿Qué buscan principalmente los principios de Seguridad y Salud en el Trabajo?', o: ['Promover la prevención y protección de los trabajadores', 'Aumentar los riesgos laborales', 'Eliminar los controles de seguridad', 'Reducir el uso de señalización'], c: 0 },
  { t: 'SST', q: '¿Cuál de las siguientes acciones ayuda a prevenir accidentes laborales?', o: ['Ignorar los peligros', 'No utilizar EPP', 'Identificar peligros, evaluar riesgos y aplicar controles', 'Trabajar sin capacitación'], c: 2 },
];

// ---------- Estado compartido (en memoria) ----------
function newGame() {
  return {
    epoch: crypto.randomBytes(4).toString('hex'),
    phase: 'lobby', // lobby | question | reveal | finished
    q: -1,
    qEnd: 0,
    revealEnd: 0,
    players: new Map(), // token -> {name, score, time, answers: Map(qIndex -> {choice, ok})}
    names: new Set(),   // nombres en minúscula
  };
}
let game = newGame();

function nextQuestion() {
  if (game.q + 1 >= QUESTIONS.length) { game.phase = 'finished'; return; }
  game.q++;
  game.phase = 'question';
  game.qEnd = Date.now() + QUESTION_MS;
}

function tick() {
  const now = Date.now();
  if (game.phase === 'question' && now >= game.qEnd) {
    game.phase = 'reveal';
    game.revealEnd = now + REVEAL_MS;
  }
  if (game.phase === 'reveal' && now >= game.revealEnd) nextQuestion();
}
setInterval(tick, 250);

function leaderboard() {
  const list = [...game.players.values()].map(p => ({ name: p.name, score: p.score, time: Math.round(p.time * 10) / 10 }));
  list.sort((a, b) => b.score - a.score || a.time - b.time || a.name.localeCompare(b.name));
  list.forEach((p, i) => (p.rank = i + 1));
  return list;
}

function buildState(token, isAdmin) {
  tick();
  const now = Date.now();
  const lb = leaderboard();
  const s = {
    epoch: game.epoch,
    phase: game.phase,
    q: game.q,
    total: QUESTIONS.length,
    questionMs: QUESTION_MS,
    remainingMs: game.phase === 'question' ? Math.max(0, game.qEnd - now) : 0,
    playerCount: game.players.size,
    leaderboard: lb,
  };
  if (game.phase === 'question' || game.phase === 'reveal') {
    const Q = QUESTIONS[game.q];
    s.question = { topic: Q.t, text: Q.q, options: Q.o };
    let answered = 0;
    game.players.forEach(p => { if (p.answers.has(game.q)) answered++; });
    s.answeredCount = answered;
    if (game.phase === 'reveal' || isAdmin) s.correct = Q.c;
  }
  const p = token && game.players.get(token);
  if (p) {
    const a = p.answers.get(game.q);
    const me = lb.find(x => x.name === p.name);
    s.me = { name: p.name, score: p.score, time: Math.round(p.time * 10) / 10, rank: me ? me.rank : null, choice: a ? a.choice : null, ok: a ? a.ok : null };
  }
  return s;
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PUBLIC = path.join(__dirname, 'public');

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const isAdminReq = (req, url) => (req.headers['x-admin-pass'] || url.searchParams.get('admin')) === ADMIN_PASS;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p.startsWith('/api/')) {
    if (req.method === 'GET' && p === '/api/state') {
      const admin = url.searchParams.has('admin');
      if (admin && !isAdminReq(req, url)) return send(res, 401, { error: 'admin' });
      const token = url.searchParams.get('token');
      if (!admin && !game.players.has(token)) return send(res, 401, { error: 'noauth' });
      return send(res, 200, buildState(token, admin));
    }
    if (req.method === 'POST' && p === '/api/join') {
      const b = await readBody(req);
      if (String(b.code || '').trim() !== JOIN_CODE) return send(res, 403, { error: 'Código incorrecto.' });
      const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
      if (name.length < 2) return send(res, 400, { error: 'Escribe un nombre de al menos 2 letras.' });
      if (game.names.has(name.toLowerCase())) return send(res, 409, { error: 'Ese nombre ya está en uso. Elige otro.' });
      if (game.phase === 'finished') return send(res, 409, { error: 'La competencia ya terminó.' });
      const token = crypto.randomBytes(12).toString('hex');
      game.players.set(token, { name, score: 0, time: 0, answers: new Map() });
      game.names.add(name.toLowerCase());
      return send(res, 200, { token, name });
    }
    if (req.method === 'POST' && p === '/api/answer') {
      const b = await readBody(req);
      const pl = game.players.get(b.token);
      if (!pl) return send(res, 401, { error: 'noauth' });
      tick();
      const choice = Number(b.choice);
      if (game.phase !== 'question' || !(choice >= 0 && choice <= 3)) return send(res, 409, { error: 'Tiempo agotado.' });
      if (pl.answers.has(game.q)) return send(res, 409, { error: 'Ya respondiste.' });
      const secs = (QUESTION_MS - (game.qEnd - Date.now())) / 1000;
      const ok = choice === QUESTIONS[game.q].c;
      pl.answers.set(game.q, { choice, ok });
      if (ok) { pl.score += POINTS; pl.time += Math.max(0, secs); }
      return send(res, 200, { received: true });
    }
    if (req.method === 'POST' && p.startsWith('/api/admin/')) {
      if (!isAdminReq(req, url)) return send(res, 401, { error: 'Contraseña incorrecta.' });
      const action = p.split('/').pop();
      if (action === 'start' && game.phase === 'lobby') nextQuestion();
      else if (action === 'next' && (game.phase === 'question' || game.phase === 'reveal')) nextQuestion();
      else if (action === 'reset') game = newGame();
      return send(res, 200, buildState(null, true));
    }
    return send(res, 404, { error: 'No encontrado' });
  }

  // Archivos estáticos
  let file = p === '/' ? '/index.html' : p === '/admin' ? '/admin.html' : p;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Concurso SST en puerto ${PORT}`));
