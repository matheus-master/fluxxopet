// Funil comercial: reuniões e fechamentos lidos da planilha publicada do Google.
// Protegido por JWT (middleware de /api).
//
// GET /api/comercial → { ok, reunioes: [{cliente, data}], fechMensal: [{ym, n}], erro }
//
// A planilha tem dois blocos:
//   • lista de reuniões: Cliente, Data, Status → conta a linha com data válida e status
//     "Concluída" (ou "Fechou"/"Fechado", que também foi reunião);
//   • resumo por mês: Mês, Reuniões, Fechamentos → os fechamentos vêm daqui (por mês,
//     sem data; célula em branco = mês ainda não informado, não é zero).
// O mês do resumo não tem ano: usa o ano das reuniões daquele mês (ou o ano corrente).
// URL pode ser trocada pela var COMERCIAL_SHEET_CSV.

const SHEET_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTtck_-1HSKf8Ril9eiogMBCHQ5mviihUWTNUmeLCrNe2Chex_kf2fKIo3_YPqbIRp5lPOFGRJXrdgJ/pub?output=csv';
const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ env }) {
  try {
    const res = await fetch(env.COMERCIAL_SHEET_CSV || SHEET_CSV, { cf: { cacheTtl: 120 } });
    if (!res.ok) return json({ ok: true, reunioes: [], fechMensal: [], erro: 'A planilha respondeu ' + res.status });
    const lines = parseCSV(await res.text());
    const head = (lines.shift() || []).map(s => norm(s));
    const col = name => head.indexOf(name);
    const iCli = col('cliente'), iData = col('data'), iSt = col('status');
    const iMes = col('mes'), iFech = col('fechamentos');
    if (iCli < 0 || iData < 0) return json({ ok: true, reunioes: [], fechMensal: [], erro: 'Planilha sem as colunas Cliente e Data' });

    // reuniões
    const reunioes = [];
    for (const l of lines) {
      const cliente = (l[iCli] || '').trim(), data = parseDate(l[iData]);
      const status = iSt >= 0 ? norm(l[iSt]) : 'concluida';
      if (cliente && data && /conclu|fech/.test(status)) reunioes.push({ cliente, data });
    }

    // fechamentos por mês (bloco de resumo)
    const fechMensal = [];
    if (iMes >= 0 && iFech >= 0) {
      const thisYear = new Date().getUTCFullYear(), thisMonth = new Date().getUTCMonth() + 1;
      for (const l of lines) {
        const m = MESES[norm(l[iMes]).slice(0, 3)];
        const raw = (l[iFech] || '').trim();
        if (!m || raw === '') continue;            // "Total" e meses em branco ficam de fora
        const n = Number(raw.replace(',', '.'));
        if (!isFinite(n)) continue;
        const fromMeetings = reunioes.find(r => +r.data.slice(5, 7) === m);
        const year = fromMeetings ? +fromMeetings.data.slice(0, 4) : (m > thisMonth ? thisYear - 1 : thisYear);
        fechMensal.push({ ym: year + '-' + pad(m), n });
      }
    }
    return json({ ok: true, reunioes, fechMensal, erro: null });
  } catch (e) {
    return json({ ok: true, reunioes: [], fechMensal: [], erro: 'Não consegui ler a planilha: ' + e.message });
  }
}

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// "04 jul. 2026", "4/7/2026" ou "2026-07-04" → "2026-07-04"
function parseDate(s) {
  s = norm(s);
  let m = s.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && MESES[m[2]]) return m[3] + '-' + pad(MESES[m[2]]) + '-' + pad(m[1]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  return YMD.test(s) ? s : null;
}
function pad(n) { return String(n).padStart(2, '0'); }

// CSV com aspas ("a, b") e aspas escapadas ("")
function parseCSV(text) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); out.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
