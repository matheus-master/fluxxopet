export async function onRequestGet(context) {
  const { env, request } = context;

  const token     = env.META_ADS_TOKEN;
  const accountId = env.META_ADS_ACCOUNT_ID || '1118060079685162';

  if (!token) return json({ ok: false, error: 'META_ADS_TOKEN não configurado' }, 500);

  const url   = new URL(request.url);
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');

  if (!since || !until) return json({ ok: false, error: 'Parâmetros since/until obrigatórios' }, 400);

  const fields = [
    'reach', 'frequency', 'spend', 'impressions', 'cpm',
    'clicks', 'cpc', 'ctr', 'actions', 'cost_per_action_type',
    'video_play_actions', 'video_p25_watched_actions',
    'video_p75_watched_actions', 'video_thruplay_watched_actions',
  ].join(',');

  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));

  // Busca dados diários (time_increment=1) e totais ao mesmo tempo
  const [rawDaily, rawTotal] = await Promise.all([
    fetchMeta(`https://graph.facebook.com/v21.0/act_${accountId}/insights?fields=${fields}&time_range=${timeRange}&time_increment=1&level=account&access_token=${token}`),
    fetchMeta(`https://graph.facebook.com/v21.0/act_${accountId}/insights?fields=${fields}&time_range=${timeRange}&level=account&access_token=${token}`),
  ]);

  if (rawDaily.error) return json({ ok: false, error: rawDaily.error.message }, 400);
  if (rawTotal.error) return json({ ok: false, error: rawTotal.error.message }, 400);

  const d = (rawTotal.data || [])[0];
  if (!d) return json({ ok: true, metrics: null, daily: [], crmDaily: [] });

  // Helpers
  const act   = (row, key) => parseFloat((row.actions || []).find(a => a.action_type === key)?.value || 0);
  const video = (arr)      => parseFloat((arr         || []).find(a => a.action_type === 'video_view')?.value || 0);

  // Totais agregados
  const impressions = parseFloat(d.impressions || 0);
  const linkClicks  = act(d, 'link_click');
  const lpv         = act(d, 'landing_page_view');
  const spend       = parseFloat(d.spend || 0);
  const p25         = video(d.video_p25_watched_actions);
  const p75         = video(d.video_p75_watched_actions);

  // Leads no CRM pelo período
  let crmLeads = 0;
  let crmDailyRows = [];
  if (env.DB) {
    const [crmRow, crmDailyResult] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) as total FROM leads WHERE created_at >= ? AND created_at < datetime(?, '+1 day')`
      ).bind(since, until).first(),
      env.DB.prepare(
        `SELECT DATE(created_at) as day, COUNT(*) as total FROM leads WHERE created_at >= ? AND created_at < datetime(?, '+1 day') GROUP BY day ORDER BY day`
      ).bind(since, until).all(),
    ]);
    crmLeads = crmRow?.total || 0;
    crmDailyRows = crmDailyResult?.results || [];
  }

  // Dados diários do Meta para o gráfico
  const daily = (rawDaily.data || []).map(row => ({
    date:       row.date_start,
    spend:      parseFloat(row.spend || 0),
    metaLeads:  act(row, 'lead'),
    linkClicks: act(row, 'link_click'),
    lpv:        act(row, 'landing_page_view'),
  }));

  const metrics = {
    reach:       parseFloat(d.reach     || 0),
    frequency:   parseFloat(d.frequency || 0),
    spend,
    impressions,
    cpm:         parseFloat(d.cpm   || 0),
    clicks:      parseFloat(d.clicks || 0),
    cpcLink:     linkClicks  ? spend / linkClicks            : 0,
    ctrLink:     impressions ? linkClicks / impressions * 100 : 0,
    linkClicks,
    lpv,
    costLpv:     lpv         ? spend / lpv                   : 0,
    crmLeads,
    cpl:         crmLeads    ? spend / crmLeads              : 0,
    connectRate: linkClicks  ? lpv / linkClicks * 100        : 0,
    regRate:     lpv         ? crmLeads / lpv * 100          : 0,
    hookRate:    impressions ? p25 / impressions * 100       : 0,
    holdRate:    impressions ? p75 / impressions * 100       : 0,
    videoPlays:  video(d.video_play_actions),
    thruPlays:   video(d.video_thruplay_watched_actions),
  };

  return json({ ok: true, metrics, daily, crmDaily: crmDailyRows });
}

async function fetchMeta(url) {
  try {
    const r = await fetch(url);
    return r.json();
  } catch (e) {
    return { error: { message: e.message } };
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
