// GET /api/config — 브라우저에 공개해도 되는 설정만 내려준다.
// 카카오 JavaScript 키는 공개용 키이며 도메인 등록으로 보호된다. (Claude API 키는 절대 여기 넣지 않는다)
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ kakaoJsKey: process.env.KAKAO_JS_KEY || null });
};
