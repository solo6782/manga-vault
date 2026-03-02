// Cloudflare Pages Function — /api/vf?title=GE:+Good+Ending
// Runs server-side, no CORS issues with Nautiljon

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const title = url.searchParams.get("title");

  if (!title) {
    return new Response(JSON.stringify({ error: "title required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const result = { title, vf_volumes: null, vo_volumes: null, publisher: null, source: null };

  try {
    // Step 1: Search on Nautiljon
    const searchUrl = "https://www.nautiljon.com/mangas/?q=" + encodeURIComponent(title);
    const searchResp = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9"
      }
    });
    const searchHtml = await searchResp.text();

    // Find first manga detail link
    const linkMatch = searchHtml.match(/href="(\/mangas\/[^"?#]+\.html)"/);
    if (!linkMatch) {
      return jsonResponse(result);
    }

    const detailUrl = "https://www.nautiljon.com" + linkMatch[1];
    result.source = detailUrl;

    // Step 2: Fetch detail page
    const detailResp = await fetch(detailUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9"
      }
    });
    const detailHtml = await detailResp.text();

    // Parse VF volumes: "Nb volumes VF : 16" or "Nb volumes VF : 16 (Terminé)"
    const vfMatch = detailHtml.match(/Nb\s*volumes?\s*VF\s*:\s*(\d+)/i);
    if (vfMatch) result.vf_volumes = parseInt(vfMatch[1]);

    // Parse VO volumes
    const voMatch = detailHtml.match(/Nb\s*volumes?\s*VO\s*:\s*(\d+)/i);
    if (voMatch) result.vo_volumes = parseInt(voMatch[1]);

    // Parse publisher: "Éditeur VF : Kana"
    const pubMatch = detailHtml.match(/diteur\s*VF\s*:\s*<[^>]*>([^<]+)</i);
    if (pubMatch) result.publisher = pubMatch[1].trim();

  } catch (err) {
    result.error = err.message;
  }

  return jsonResponse(result);
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
