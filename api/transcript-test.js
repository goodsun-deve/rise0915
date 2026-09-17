// [임시] A1 리스크 검증용. 배포 환경에서 자막을 가져올 수 있는지 확인한 뒤 삭제한다.
// 사용법: https://<배포주소>/api/transcript-test?url=<유튜브 링크>
const { extractVideoId, fetchTranscript } = require('./_lib/youtube');

module.exports = async (req, res) => {
  const videoId = extractVideoId(req.query.url);
  if (!videoId) return res.status(400).json({ ok: false, error: 'INVALID_URL' });
  const started = Date.now();
  try {
    const t = await fetchTranscript(videoId);
    res.status(200).json({
      ok: true,
      videoId,
      language: t.languageCode,
      auto: t.auto,
      length: t.text.length,
      ms: Date.now() - started,
      preview: t.text.slice(0, 200),
    });
  } catch (e) {
    res.status(200).json({ ok: false, videoId, error: e.code || 'ERROR', detail: e.message, ms: Date.now() - started });
  }
};
