export async function onRequestGet(context) {
  const { env, request } = context;

  const token     = env.META_ADS_TOKEN;
  const accountId = env.META_ADS_ACCOUNT_ID || '1118060079685162';

  if (!token) return json({ ok: false, error: 'META_ADS_TOKEN não configurado' }, 500);

  const url    = new URL(request.url);
  const preset = url.searchParams.get('preset') || 'last_30d';

  const fields = [
    'reach', 'frequency', 'spend', 'impressions', 'cpm',
    'clicks', 'cpc', 'ctr', 'actions', 'cost_per_action_type',
    'video_play_actions', 'video_p25_watched_actions',
    'video_p75_watched_actions', 'video_thruplay_watched_actions',
  ].join(',');

  const apiUrl = `https://graph.facebook.com/v21.0/act_${accountId}/insights` +
    `?fields=${fields}&date_preset=${preset}&level=account&access_token=${token}`;

  let raw;
  try {
    const r = await fetch(apiUrl);
    raw = await r.json();
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }

  if (raw.error) return json({ ok: false, error: raw.error.message }, 400);

  const d = (raw.data || [])[0];
  if (!d)  return json({ ok: true, metrics: null });

  const act   = (key) => parseFloat((d.actions              || []).find(a => a.action_type === key)?.value || 0);
  const video = (arr) => parseFloat((arr                    || []).find(a => a.action_type === 'video_view')?.value || 0);

  const impressions = parseFloat(d.impressions || 0);
  const linkClicks  = act('link_click');
  const lpv         = act('landing_page_view');
  const leads       = act('lead');
  const spend       = parseFloat(d.spend || 0);
  const videoPlays  = video(d.video_play_actions);
  const p25         = video(d.video_p25_watched_actions);
  const p75         = video(d.video_p75_watched_actions);
  const thruPlays   = video(d.video_thruplay_watched_actions);

  const metrics = {
    reach:       parseFloat(d.reach       || 0),
    frequency:   parseFloat(d.frequency   || 0),
    spend,
    impressions,
    cpm:         parseFloat(d.cpm         || 0),
    clicks:      parseFloat(d.clicks      || 0),
    cpcLink:     linkClicks  ? spend / linkClicks  : 0,
    ctrLink:     impressions ? linkClicks / impressions * 100 : 0,
    linkClicks,
    lpv,
    costLpv:     lpv         ? spend / lpv         : 0,
    leads,
    cpl:         leads       ? spend / leads        : 0,
    connectRate: linkClicks  ? lpv / linkClicks * 100 : 0,
    regRate:     lpv         ? leads / lpv * 100   : 0,
    videoPlays,
    thruPlays,
    hookRate:    impressions ? p25 / impressions * 100 : 0,
    holdRate:    impressions ? p75 / impressions * 100 : 0,
  };

  return json({ ok: true, metrics });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
