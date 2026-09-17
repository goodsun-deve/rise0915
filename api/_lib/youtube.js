// 유튜브 링크 판별 · 영상 ID 추출 · 자막 가져오기
// 외부 라이브러리 없이 YouTube 내부(Innertube) API를 직접 호출한다.

const YT_PATTERN =
  /^(https?:\/\/)?((www|m)\.)?(youtube\.com\/(watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)\S*$/i;

// 입력 전체가 유튜브 링크 형태인지 (앞뒤 공백 제거 후)
function isYouTubeUrl(input) {
  return YT_PATTERN.test(String(input || '').trim());
}

// 영상 ID(11자) 추출. 실패 시 null
function extractVideoId(input) {
  let raw = String(input || '').trim();
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

class TranscriptError extends Error {
  // code: 'NO_CAPTIONS' | 'INVALID_VIDEO' | 'FETCH_FAILED'
  constructor(code, detail) {
    super(detail || code);
    this.code = code;
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchWithTimeout(url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// 자막 트랙 우선순위: 한국어 수동 > 한국어 자동 > 기타 수동 > 기타 자동
function pickTrack(tracks) {
  const isKo = (t) => (t.languageCode || '').toLowerCase().startsWith('ko');
  const isAuto = (t) => t.kind === 'asr';
  return (
    tracks.find((t) => isKo(t) && !isAuto(t)) ||
    tracks.find((t) => isKo(t)) ||
    tracks.find((t) => !isAuto(t)) ||
    tracks[0]
  );
}

async function fetchTranscript(videoId) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' };

  // 1) 영상 페이지에서 API 키 가져오기
  let html;
  try {
    const res = await fetchWithTimeout(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { ...headers, Cookie: 'CONSENT=YES+cb; SOCS=CAI' },
    });
    html = await res.text();
  } catch (e) {
    throw new TranscriptError('FETCH_FAILED', 'watch page: ' + e.message);
  }
  if (html.includes('class="g-recaptcha"')) {
    throw new TranscriptError('FETCH_FAILED', 'blocked (recaptcha)');
  }
  const keyMatch = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
  if (!keyMatch) throw new TranscriptError('FETCH_FAILED', 'api key not found');

  // 2) 플레이어 정보(자막 목록) 요청
  let player;
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/youtubei/v1/player?key=${keyMatch[1]}`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
          videoId,
        }),
      }
    );
    player = await res.json();
  } catch (e) {
    throw new TranscriptError('FETCH_FAILED', 'player: ' + e.message);
  }

  const status = player?.playabilityStatus?.status;
  if (status && status !== 'OK') {
    const reason = String(player.playabilityStatus.reason || '');
    // 봇 차단/로그인 요구 = 서버에서 못 가져온 것(E3), 그 외 = 열 수 없는 영상(E2)
    if (status === 'LOGIN_REQUIRED' || /bot|sign in|로그인/i.test(reason)) {
      throw new TranscriptError('FETCH_FAILED', 'playability: ' + status);
    }
    throw new TranscriptError('INVALID_VIDEO', 'playability: ' + status);
  }

  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) throw new TranscriptError('NO_CAPTIONS');

  // 3) 자막 XML 받기
  const track = pickTrack(tracks);
  let xml;
  try {
    const res = await fetchWithTimeout(track.baseUrl.replace('&fmt=srv3', ''), { headers });
    xml = await res.text();
  } catch (e) {
    throw new TranscriptError('FETCH_FAILED', 'caption: ' + e.message);
  }

  const parts = [];
  const re = /<(?:text|p)\b[^>]*>([\s\S]*?)<\/(?:text|p)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const t = decodeEntities(m[1].replace(/<[^>]+>/g, '')).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  }
  const text = parts.join(' ').trim();
  if (!text) throw new TranscriptError('FETCH_FAILED', 'empty caption body');
  return { text, languageCode: track.languageCode, auto: track.kind === 'asr' };
}

module.exports = { isYouTubeUrl, extractVideoId, fetchTranscript, TranscriptError };
