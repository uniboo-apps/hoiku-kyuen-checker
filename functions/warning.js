// Cloudflare Pages Function: GET /warning
// 気象庁の最新「気象警報・注意報」XML（愛知=VPWW54_230000）から刈谷市の警報を抽出してJSONで返す。
// bosai の警報JSONが更新停止しても、こちらのXMLフィードは最新なので確実に現況が取れる。

const FEED = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml';
const KARIYA_CODE = '2321000';
const XML_PATTERN = /https?:\/\/[^<"\s]*VPWW54_230000\.xml/g;

export async function onRequestGet() {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'max-age=60',
    'Access-Control-Allow-Origin': '*'
  };
  try {
    // 1) Atomフィードから愛知の警報XML（最新）のURLを特定
    const feed = await (await fetch(FEED, { cf: { cacheTtl: 60 } })).text();
    const entries = feed.split('<entry>').slice(1);
    let bestUrl = null, bestT = -1;
    for (const e of entries) {
      const m = e.match(XML_PATTERN);
      if (!m) continue;
      const up = (e.match(/<updated>([^<]+)<\/updated>/) || [])[1] || '';
      const t = Date.parse(up) || 0;
      if (t >= bestT) { bestT = t; bestUrl = m[0]; }
    }
    if (!bestUrl) throw new Error('愛知の警報XMLが見つかりません');

    // 2) 警報XMLを取得
    const xml = await (await fetch(bestUrl, { cf: { cacheTtl: 60 } })).text();
    const report = (xml.match(/<ReportDateTime>([^<]+)<\/ReportDateTime>/) || [])[1] || null;

    // 3) 「市町村等」のWarningブロックに絞って刈谷市のItemを取り出す
    const block = (xml.match(/気象警報・注意報（市町村等）[\s\S]*?<\/Warning>/) || [])[0] || xml;
    const item = block.split('<Item>').slice(1)
      .find(it => it.includes('<Code>' + KARIYA_CODE + '</Code>') && it.includes('刈谷市'));

    // 4) Kind（現在の警報・注意報）を抽出
    //    実XMLは整形済み（タグ間に改行あり）で、市町村等ブロックの Kind は
    //    <Name><Code> のみ（Status 無し）。Status 付きの形にも両対応。
    //    LastKind は <Kind> で始まらないので拾われない。
    const warnings = [];
    if (item) {
      const re = /<Kind>\s*<Name>([^<]+)<\/Name>\s*<Code>([^<]+)<\/Code>(?:\s*<Status>([^<]+)<\/Status>)?/g;
      let k;
      while ((k = re.exec(item)) !== null) {
        const name = k[1], code = k[2], status = k[3] || '発表';
        if (status === '解除' || name.indexOf('発表警報・注意報はなし') >= 0) continue;
        warnings.push({ name, code, status });
      }
    }

    // 5) 見通し（時系列）：刈谷市の「風危険度（陸上）」を3時間刻みで取り出す
    //    Code 00=注意報級未満 / 10=注意報級 / 20=警報級（暴風警報級）
    let forecast = null;
    const tsi = (xml.match(/<TimeSeriesInfo>[\s\S]*?<\/TimeSeriesInfo>/) || [])[0];
    if (tsi) {
      const tdBlock = (tsi.match(/<TimeDefines>[\s\S]*?<\/TimeDefines>/) || [])[0] || '';
      const times = [...tdBlock.matchAll(/<DateTime>([^<]+)<\/DateTime>/g)].map(m => m[1]);
      const fItem = tsi.split('<Item>').slice(1)
        .find(it => it.includes('<Code>' + KARIYA_CODE + '</Code>') && it.includes('刈谷市'));
      if (fItem && times.length) {
        // 陸上が先に現れるので、各 refID は最初の出現（=陸上）を採用
        const riskMap = {};
        const rre = /<Significancy refID="(\d+)" type="風危険度"><Name>[^<]*<\/Name><Code>(\d+)<\/Code>/g;
        let r;
        while ((r = rre.exec(fItem)) !== null) {
          if (!(r[1] in riskMap)) riskMap[r[1]] = r[2];
        }
        forecast = times.map((t, i) => ({ time: t, windRisk: riskMap[String(i + 1)] || '00' }));
      }
    }

    return new Response(JSON.stringify({
      source: 'jma-xml',
      area: '刈谷市',
      reportDatetime: report,
      warnings,
      forecast,
      xmlUrl: bestUrl
    }), { headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }),
      { status: 502, headers });
  }
}
