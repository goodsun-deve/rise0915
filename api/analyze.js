// POST /api/analyze  { input: string }
// 성공: { verdict, confidence, summary, reasons }
// 실패: { error: { code, message } }
const MESSAGES = require('./_lib/messages');
const { consume } = require('./_lib/rateLimit');
const { isYouTubeUrl, extractVideoId, fetchTranscript } = require('./_lib/youtube');
const { judge } = require('./_lib/judge');

const MAX_INPUT = 3000;
const MAX_TRANSCRIPT = 15000;
const SERVER_BUDGET_MS = 28000; // Vercel maxDuration(30초) 안에서 끝내기
const CLAUDE_TIMEOUT_MS = 25000;

function fail(res, status, code) {
  return res.status(status).json({ error: { code, message: MESSAGES[code] } });
}

module.exports = async (req, res) => {
  const startedAt = Date.now();
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'METHOD', message: 'POST만 사용할 수 있어요.' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const input = typeof body?.input === 'string' ? body.input.trim() : '';

  // 1) 입력 검증 (사용량에 세지 않음)
  if (!input) return fail(res, 400, 'F1-E1');
  if (input.length > MAX_INPUT) return fail(res, 400, 'TOO_LONG');

  // 2) IP당 하루 사용량 제한
  if (!(await consume(req))) return fail(res, 429, 'RATE_LIMIT');

  // 3) 유튜브 링크면 자막 가져오기
  let content = input;
  let sourceType = 'text';
  if (isYouTubeUrl(input)) {
    sourceType = 'youtube';
    const videoId = extractVideoId(input);
    if (!videoId) return fail(res, 400, 'F2-E2');
    try {
      const t = await fetchTranscript(videoId);
      content = t.text.slice(0, MAX_TRANSCRIPT);
    } catch (e) {
      console.error('[analyze] 자막 오류:', e.code || 'ERROR', e.message);
      if (e.code === 'NO_CAPTIONS') return fail(res, 422, 'F2-E1');
      if (e.code === 'INVALID_VIDEO') return fail(res, 400, 'F2-E2');
      return fail(res, 502, 'F2-E3');
    }
  }

  // 4) Claude 판정 + 5) 응답 검증
  const remaining = SERVER_BUDGET_MS - (Date.now() - startedAt);
  if (remaining < 3000) return fail(res, 504, 'F1-E3');
  try {
    const result = await judge({
      content,
      sourceType,
      timeoutMs: Math.min(CLAUDE_TIMEOUT_MS, remaining),
    });
    return res.status(200).json(result);
  } catch (e) {
    const code = MESSAGES[e.code] ? e.code : 'F1-E2';
    const status = code === 'F1-E3' ? 504 : 502;
    console.error('[analyze] 판정 오류:', code, e.message);
    return fail(res, status, code);
  }
};
