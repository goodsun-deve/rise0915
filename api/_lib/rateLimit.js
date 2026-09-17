// IP당 하루 사용량 제한
// 기본: 서버 메모리(Map). 비용이 없지만 서버리스 인스턴스가 새로 뜨거나 여러 개면 횟수가 따로 세어질 수 있다.
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 이 있으면 Upstash Redis로 정확하게 센다.

const memory = new Map(); // key -> count

function todayKST() {
  // 한국 시간 기준 날짜 (자정에 초기화)
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff || '').split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

async function incrUpstash(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, 60 * 60 * 26],
    ]),
  });
  if (!res.ok) throw new Error('upstash ' + res.status);
  const data = await res.json();
  return Number(data[0].result);
}

function incrMemory(key) {
  const today = todayKST();
  // 지난 날짜 기록 정리
  for (const k of memory.keys()) if (!k.startsWith(`rl:${today}:`)) memory.delete(k);
  const n = (memory.get(key) || 0) + 1;
  memory.set(key, n);
  return n;
}

// 이번 요청을 1회로 세고, 한도를 넘었으면 false
async function consume(req) {
  const limit = Number.parseInt(process.env.DAILY_LIMIT, 10) || 20;
  const key = `rl:${todayKST()}:${getClientIp(req)}`;
  let count;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      count = await incrUpstash(key);
    } catch (e) {
      console.error('[rateLimit] Upstash 실패, 메모리 방식으로 대체:', e.message);
      count = incrMemory(key);
    }
  } else {
    count = incrMemory(key);
  }
  return count <= limit;
}

module.exports = { consume };
