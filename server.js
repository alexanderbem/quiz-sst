// Concurso SST - servidor sin dependencias externas (solo Node.js 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const JOIN_CODE = process.env.JOIN_CODE || '1234';       // código de ingreso de participantes
const ADMIN_PASS = process.env.ADMIN_PASS || 'profe1234'; // contraseña del panel de la instructora
const QUESTION_MS = 30000; // 30 s por pregunta
const REVEAL_MS = 4000;    // pausa de 4 s mostrando la respuesta correcta
const POINTS = 100;        // puntos por respuesta correcta

// c = índice de la respuesta correcta (0=A, 1=B, 2=C, 3=D)
const QUESTIONS = [
  { t: 'Rombo NFPA 704', q: '¿Qué representa el color rojo en el rombo NFPA 704?', o: ['Riesgo especial', 'Inflamabilidad', 'Reactividad', 'Riesgo para la salud'], c: 1 },
  { t: 'Rombo NFPA 704', q: '¿Qué número indica un peligro más severo en la escala del rombo NFPA 704?', o: ['0', '1', '3', '4'], c: 3 },
  { t: 'Las 5S', q: '¿Cuál de las siguientes pertenece a la metodología 5S?', o: ['Seguridad', 'Seiri', 'Supervisión', 'Señalización'], c: 1 },
  { t: 'Las 5S', q: '¿Cuál es el objetivo principal de aplicar las 5S en el lugar de trabajo?', o: ['Aumentar los accidentes', 'Mantener orden, limpieza y organización', 'Eliminar los equipos de protección', 'Aumentar el tiempo de trabajo'], c: 1 },
  { t: 'ATS', q: '¿Qué significa ATS en Seguridad y Salud en el Trabajo?', o: ['Análisis de Trabajo Seguro', 'Área Técnica de Seguridad', 'Actividad de Trabajo Supervisado', 'Análisis Técnico de Servicios'], c: 0 },
  { t: 'ATS', q: '¿Cuál es uno de los objetivos principales de un ATS?', o: ['Identificar peligros antes de realizar una tarea', 'Reemplazar todos los EPP', 'Aumentar la velocidad del trabajo', 'Eliminar las capacitaciones'], c: 0 },
  { t: 'Señales y colores', q: '¿Qué color se utiliza generalmente para indicar prohibición o peligro?', o: ['Verde', 'Azul', 'Rojo', 'Blanco'], c: 2 },
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
