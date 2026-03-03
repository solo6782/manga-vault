// Cloudflare Worker — handles API routes + serves static assets

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/vf") {
      return handleVF(url);
    }
    return env.ASSETS.fetch(request);
  }
};

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9",
};

async function handleVF(url) {
  const title = url.searchParams.get("title");
  const debug = url.searchParams.get("debug") === "1";

  if (!title) {
    return jsonResponse({ error: "title required" }, 400);
  }

  const result = { title, vf_volumes: null, vo_volumes: null, publisher: null, source: null };

  // Strategy 1: Manga-News
  try {
    const found = await tryMangaNews(title, result, debug);
    if (found) return jsonResponse(result);
  } catch (err) {
    if (debug) result._mnError = err.message;
  }

  // Strategy 2: MangaUpdates API (for publisher info)
  try {
    const found = await tryMangaUpdates(title, result, debug);
    if (found) return jsonResponse(result);
  } catch (err) {
    if (debug) result._muError = err.message;
  }

  return jsonResponse(result);
}

async function tryMangaNews(title, result, debug) {
  const searchUrl = "https://www.manga-news.com/index.php/recherche?query=" + encodeURIComponent(title);
  const resp = await fetch(searchUrl, { headers: HEADERS });
  const html = await resp.text();

  if (debug) {
    result._mnStatus = resp.status;
    result._mnLength = html.length;
    result._mnTitle = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "no title";
    result._mnSnippet = html.substring(0, 500);
  }

  // Manga-News search results contain links to series pages
  // Look for a series link like /index.php/serie/GE-Good-Ending
  let seriesMatch = html.match(/href="(\/index\.php\/serie\/[^"]+)"/);
  if (!seriesMatch) {
    seriesMatch = html.match(/href='(\/index\.php\/serie\/[^']+)'/);
  }

  if (seriesMatch) {
    const seriesUrl = "https://www.manga-news.com" + seriesMatch[1];
    result.source = seriesUrl;

    const seriesResp = await fetch(seriesUrl, { headers: HEADERS });
    const seriesHtml = await seriesResp.text();

    if (debug) {
      result._mnSeriesStatus = seriesResp.status;
      result._mnSeriesLength = seriesHtml.length;
      const volIdx = seriesHtml.indexOf("olume");
      if (volIdx >= 0) result._mnVolContext = seriesHtml.substring(Math.max(0, volIdx - 100), volIdx + 150);
      const tomIdx = seriesHtml.indexOf("tome");
      if (tomIdx >= 0) result._mnTomeContext = seriesHtml.substring(Math.max(0, tomIdx - 100), tomIdx + 150);
    }

    // Look for volume count patterns
    // "X tomes" or "X / Y tomes"
    const patterns = [
      /(\d+)\s*(?:\/\s*\d+\s*)?tomes?\s*-\s*s.rie\s*termin/i,
      /(\d+)\s*(?:\/\s*\d+\s*)?tomes?\s*-\s*s.rie\s*en\s*cours/i,
      /(\d+)\s*\/\s*(\d+)\s*tomes?/i,
      /(\d+)\s*tomes?\s*(?:parus?|sortis?|VF)/i,
      /VF\s*[:\s]*(\d+)\s*tomes?/i,
    ];

    for (const pat of patterns) {
      const m = seriesHtml.match(pat);
      if (m) {
        // If pattern has 2 groups (X/Y), use the first (released)
        const vol = parseInt(m[1]);
        if (vol > 0 && vol < 500) {
          result.vf_volumes = vol;
          break;
        }
      }
    }

    // Try to find publisher
    const pubMatch = seriesHtml.match(/diteur[^:]*:\s*<[^>]*>([^<]+)</i);
    if (pubMatch) result.publisher = pubMatch[1].trim();

    if (result.vf_volumes) return true;
  }

  // Try to extract from search results page directly
  // Manga-News sometimes shows "Série (16 tomes)" in search
  const directMatch = html.match(/(\d+)\s*tomes?\)/);
  if (directMatch) {
    const vol = parseInt(directMatch[1]);
    if (vol > 0 && vol < 500) {
      result.vf_volumes = vol;
      result.source = searchUrl;
      return true;
    }
  }

  return false;
}

async function tryMangaUpdates(title, result, debug) {
  // MangaUpdates has a proper API - no CORS issue from server
  const searchResp = await fetch("https://api.mangaupdates.com/v1/series/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ search: title })
  });
  const searchData = await searchResp.json();

  if (debug) {
    result._muResults = (searchData.results || []).length;
    if (searchData.results && searchData.results[0]) {
      result._muFirstTitle = searchData.results[0].record.title;
    }
  }

  if (!searchData.results || searchData.results.length === 0) return false;

  const seriesId = searchData.results[0].record.series_id;
  const detailResp = await fetch("https://api.mangaupdates.com/v1/series/" + seriesId);
  const detail = await detailResp.json();

  if (debug) {
    result._muPublishers = (detail.publishers || []).map(p => p.publisher_name + " (" + p.type + ")");
  }

  // French publishers list
  const frNames = ["kana", "pika", "ki-oon", "kioon", "glenat", "glénat", "kurokawa",
    "kazé", "kaze", "delcourt", "tonkam", "soleil", "panini", "meian", "mangetsu",
    "akata", "doki-doki", "komikku", "ototo", "noeve", "mana books", "crunchyroll"];

  if (detail.publishers) {
    for (const p of detail.publishers) {
      const name = (p.publisher_name || "").toLowerCase();
      for (const fr of frNames) {
        if (name.indexOf(fr) >= 0) {
          result.publisher = p.publisher_name;
          result.source = "https://www.mangaupdates.com/series/" + seriesId;
          return true;
        }
      }
    }
  }

  return false;
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
