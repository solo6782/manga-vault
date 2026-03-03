// Cloudflare Worker — handles API routes + serves static assets

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API: VF search via Nautiljon
    if (url.pathname === "/api/vf") {
      return handleVF(url);
    }

    // Everything else: serve static files
    return env.ASSETS.fetch(request);
  }
};

async function handleVF(url) {
  const title = url.searchParams.get("title");
  const debug = url.searchParams.get("debug") === "1";

  if (!title) {
    return jsonResponse({ error: "title required" }, 400);
  }

  const result = { title, vf_volumes: null, vo_volumes: null, publisher: null, source: null };

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
    "Referer": "https://www.nautiljon.com/",
    "Connection": "keep-alive"
  };

  try {
    // Step 1: Search on Nautiljon
    const searchUrl = "https://www.nautiljon.com/mangas/?q=" + encodeURIComponent(title);
    const searchResp = await fetch(searchUrl, { headers });
    const searchHtml = await searchResp.text();

    if (debug) {
      result._searchUrl = searchUrl;
      result._searchStatus = searchResp.status;
      result._searchLength = searchHtml.length;
      result._searchTitle = (searchHtml.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "no title";
      result._searchSnippet = searchHtml.substring(0, 500);
    }

    // Find first manga detail link
    let linkMatch = searchHtml.match(/href="(\/mangas\/[^"?#]+\.html)"/);
    if (!linkMatch) {
      linkMatch = searchHtml.match(/href='(\/mangas\/[^'?#]+\.html)'/);
    }

    if (!linkMatch) {
      if (debug) result._noLinkFound = true;
      return jsonResponse(result);
    }

    const detailUrl = "https://www.nautiljon.com" + linkMatch[1];
    result.source = detailUrl;

    // Step 2: Fetch detail page
    const detailResp = await fetch(detailUrl, { headers });
    const detailHtml = await detailResp.text();

    if (debug) {
      result._detailStatus = detailResp.status;
      result._detailLength = detailHtml.length;
      result._detailTitle = (detailHtml.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "no title";
      const volIdx = detailHtml.indexOf("olumes");
      if (volIdx >= 0) result._volContext = detailHtml.substring(Math.max(0, volIdx - 80), volIdx + 120);
    }

    // Parse VF volumes
    const vfMatch = detailHtml.match(/Nb\s*volumes?\s*VF\s*:\s*(\d+)/i);
    if (vfMatch) result.vf_volumes = parseInt(vfMatch[1]);

    // Parse VO volumes
    const voMatch = detailHtml.match(/Nb\s*volumes?\s*VO\s*:\s*(\d+)/i);
    if (voMatch) result.vo_volumes = parseInt(voMatch[1]);

    // Parse publisher
    const pubMatch = detailHtml.match(/diteur\s*VF\s*:\s*<[^>]*>([^<]+)</i);
    if (pubMatch) result.publisher = pubMatch[1].trim();

  } catch (err) {
    result.error = err.message;
  }

  return jsonResponse(result);
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
