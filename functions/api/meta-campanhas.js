// Lista as campanhas da conta de anúncios para o filtro do dashboard de tráfego.
// GET /api/meta-campanhas  (protegido por JWT, middleware de /api)
// Ativas primeiro; dentro de cada grupo, as mais recentes primeiro.

const GRAPH = 'https://graph.facebook.com/v21.0';

export async function onRequestGet({ env }) {
  const token = env.META_ADS_TOKEN;
  const acct  = env.META_ADS_ACCOUNT_ID || '4038372153047790';
  if (!token) return json({ ok: false, error: 'META_ADS_TOKEN não configurado' }, 500);

  const campaigns = [];
  let next = `${GRAPH}/act_${acct}/campaigns?fields=name,effective_status,created_time&limit=200&access_token=${token}`;
  for (let i = 0; next && i < 10; i++) {
    let r;
    try { r = await (await fetch(next)).json(); }
    catch (e) { return json({ ok: false, error: e.message }, 400); }
    if (r.error) return json({ ok: false, error: r.error.message }, 400);
    (r.data || []).forEach(c => campaigns.push({
      id: c.id, name: c.name, active: c.effective_status === 'ACTIVE', created: c.created_time,
    }));
    next = r.paging?.next;
  }

  campaigns.sort((a, b) => (b.active - a.active) || (b.created || '').localeCompare(a.created || ''));

  let account = null;
  try { account = (await (await fetch(`${GRAPH}/act_${acct}?fields=name&access_token=${token}`)).json()).name || null; } catch {}

  return json({ ok: true, account, campaigns });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
