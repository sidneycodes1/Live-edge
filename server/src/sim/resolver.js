export async function resolveMarketSim(db, marketId, outcome) {
  const { rows } = await db.query('select * from markets where id=$1', [marketId]);
  if (rows.length === 0) throw new Error('market not found');
  const m = rows[0];
  if (m.status === 'resolved') return m;
  await db.query(`update markets set status='resolved', outcome=$1 where id=$2`, [outcome, marketId]);
  return { ...m, status: 'resolved', outcome };
}
