export async function onRequestPatch(context) {
  const { env, request, params } = context;
  const id   = params.id;
  const body = await request.json();

  const fields = [];
  const values = [];

  if (body.etapa        !== undefined) { fields.push('etapa = ?');        values.push(body.etapa); }
  if (body.ult_contato  !== undefined) { fields.push('ult_contato = ?');  values.push(body.ult_contato); }
  if (body.prox_contato !== undefined) { fields.push('prox_contato = ?'); values.push(body.prox_contato); }
  if (body.comentarios  !== undefined) { fields.push('comentarios = ?');  values.push(body.comentarios); }
  if (body.faturamento  !== undefined) { fields.push('faturamento = ?');  values.push(body.faturamento); }

  if (fields.length) {
    fields.push("updated_at = datetime('now')");
    values.push(id);
    await env.DB.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values).run();
  }

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
