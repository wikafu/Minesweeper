export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    return res.status(500).json({ error: 'missing upstash env vars' });
  }

  function getTodayUTCDateString() {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async function redisGet(key) {
    const r = await fetch(
      `${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`,
      {
        headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      }
    );
    const j = await r.json();
    return j.result ? JSON.parse(j.result) : null;
  }

  async function redisSet(key, value) {
    await fetch(
      `${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(
        key
      )}/${encodeURIComponent(JSON.stringify(value))}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      }
    );
  }

  const date = getTodayUTCDateString();
  const key = `daily:${date}`;

  if (req.method === 'GET') {
    const best = await redisGet(key);
    return res.status(200).json({ date, best: best || null });
  }

  if (req.method === 'POST') {
    const { fid, username, timeMs } = req.body || {};
    const time = Number(timeMs);

    if (!Number.isFinite(time) || time <= 0) {
      return res.status(400).json({ error: 'invalid time' });
    }

    const current = await redisGet(key);
    if (current && current.timeMs <= time) {
      return res.status(200).json({ date, updated: false, best: current });
    }

    const newBest = {
      fid: Number(fid) || 0,
      username: username || 'player',
      timeMs: time,
    };

    await redisSet(key, newBest);
    return res.status(200).json({ date, updated: true, best: newBest });
  }

  res.status(405).json({ error: 'method not allowed' });
}
