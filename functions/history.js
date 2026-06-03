// Cloudflare Pages Function: GET /history
// 気象庁の警報フィードから、刈谷市の「休園に関わる警報（暴風警報・大雨警報・特別警報など）」の
// 発表/解除の経緯（直近24時間・フィードにある範囲）を再構成して返す。

const FEED = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml';
const KARIYA_CODE = '2321000';
const XML_PATTERN = /https?:\/\/[^<"\s]*VPWW54_230000\.xml/g;
// 休園に関わる警報コード（暴風/暴風雪/大雨警報/各特別警報）
const CLOSURE = new Set(['05', '02', '03', '32', '33', '35', '36', '37', '38']);
const MAX_FETCH = 18;

function kariyaWarnings(xml) {
  const block = (xml.match(/気象警報・注意報（市町村等）[\s\S]*?<\/Warning>/) || [])[0];
  if (!block) return null;
  const item = block.split('<Item>').slice(1)
    .find(it => it.includes('<Code>' + KARIYA_CODE + '</Code>') && it.includes('刈谷市'));
  if (!item) return null; // この速報には刈谷の全体状況が無い（部分速報）
  const out = [];
  const re = /<Kind>\s*<Name>([^<]+)<\/Name>\s*<Code>([^<]+)<\/Code>(?:\s*<Status>([^<]+)<\/Status>)?/g;
  let k;
  while ((k = re.exec(item)) !== null) {
    const name = k[1], code = k[2], status = k[3] || '発表';
    if (status === '解除' || name.indexOf('発表警報・注意報はなし') >= 0) continue;
    out.push({ name, code });
  }
  return out;
}

export async function onRequestGet() {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'max-age=300',
    'Access-Control-Allow-Origin': '*'
  };
  try {
    const feed = await (await fetch(FEED, { cf: { cacheTtl: 120 } })).text();
    const entries = feed.split('<entry>').slice(1);
    const seen = new Set();
    let cand = [];
    for (const e of entries) {
      const m = e.match(XML_PATTERN);
      if (!m) continue;
      const url = m[0];
      if (seen.has(url)) continue;
      seen.add(url);
      const up = (e.match(/<updated>([^<]+)<\/updated>/) || [])[1] || '';
      cand.push({ url, t: Date.parse(up) || 0 });
    }
    const cutoff = Date.now() - 24 * 3600 * 1000;
    cand = cand.filter(c => c.t >= cutoff).sort((a, b) => b.t - a.t).slice(0, MAX_FETCH);

    // 各速報から刈谷の警報状況を取得
    const states = [];
    for (const c of cand) {
      let xml;
      try { xml = await (await fetch(c.url, { cf: { cacheTtl: 600 } })).text(); } catch (e) { continue; }
      const w = kariyaWarnings(xml);
      if (!w) continue;
      const report = (xml.match(/<ReportDateTime>([^<]+)<\/ReportDateTime>/) || [])[1] || new Date(c.t).toISOString();
      states.push({ time: report, warnings: w });
    }
    // 古い→新しい
    states.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

    // 「休園に関わる警報」の集合が変化した時点だけイベント化
    const events = [];
    let prevKey = null;
    for (const s of states) {
      const closure = s.warnings.filter(x => CLOSURE.has(x.code));
      const key = closure.map(x => x.code).sort().join(',');
      if (key !== prevKey) {
        events.push({ time: s.time, closure, warnings: s.warnings });
        prevKey = key;
      }
    }
    return new Response(JSON.stringify({ area: '刈谷市', events }), { headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }),
      { status: 502, headers });
  }
}
