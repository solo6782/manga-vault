const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SUPABASE_URL = "https://denhmucpuksiedfynokm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbmhtdWNwdWtzaWVkZnlub2ttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzkxNTYsImV4cCI6MjA4Nzk1NTE1Nn0.f25F82Z5nlds83KgI-W8fDsVQozvfALt_JUVT3MLkVU";

async function checkAndIncrementQuota(authToken) {
  if (!authToken) return { allowed: true, profile: null };

  // Fetch user profile
  const resp = await fetch(SUPABASE_URL + "/rest/v1/mv_profiles?select=*", {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": authToken,
      "Content-Type": "application/json"
    }
  });
  const profiles = await resp.json();
  if (!profiles || profiles.length === 0) return { allowed: true, profile: null };

  const profile = profiles[0];
  if (profile.plan === "admin") return { allowed: true, profile };

  // Check weekly reset
  const resetAt = new Date(profile.ai_calls_reset_at);
  const daysDiff = (Date.now() - resetAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff >= 7) {
    const now = new Date().toISOString();
    await fetch(SUPABASE_URL + "/rest/v1/mv_profiles?id=eq." + profile.id, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": authToken, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ ai_calls_used: 0, ai_calls_reset_at: now })
    });
    profile.ai_calls_used = 0;
  }

  // Check quota
  if (profile.ai_calls_used >= profile.ai_calls_limit) {
    return { allowed: false, profile, used: profile.ai_calls_used, limit: profile.ai_calls_limit };
  }

  return { allowed: true, profile };
}

async function incrementQuota(authToken, profile) {
  if (!authToken || !profile || profile.plan === "admin") return;
  await fetch(SUPABASE_URL + "/rest/v1/mv_profiles?id=eq." + profile.id, {
    method: "PATCH",
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": authToken, "Content-Type": "application/json", "Prefer": "return=minimal" },
    body: JSON.stringify({ ai_calls_used: (profile.ai_calls_used || 0) + 1 })
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/ai-recommend" && request.method === "POST") {
      try {
        const body = await request.json();
        const { collection, ignored, planned, type, genres, messages, authToken } = body;

        // Server-side quota check
        const quotaCheck = await checkAndIncrementQuota(authToken);
        if (!quotaCheck.allowed) {
          return new Response(JSON.stringify({ error: "quota_exceeded", used: quotaCheck.used, limit: quotaCheck.limit }), {
            status: 429,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
          });
        }

        const systemPrompt = `Tu es un expert en manga et anime. Tu connais parfaitement les oeuvres japonaises et tu recommandes des oeuvres adaptees aux gouts de l'utilisateur en te basant sur sa collection.

Regles ABSOLUES :
- Ne recommande JAMAIS une oeuvre deja presente dans la collection (vue, en cours, planifiee ou ignoree).
- Propose des oeuvres de type "${type}" uniquement.
${genres && genres.length > 0 ? `- Les genres demandes : ${genres.join(", ")}. Privilegies ces genres.` : ""}
- Base-toi sur les notes ET les commentaires personnels pour comprendre finement les gouts.
- Pour chaque recommandation, explique PRECISEMENT pourquoi elle correspond, en citant des oeuvres specifiques de la collection.
- Si une oeuvre est la suite DIRECTE d'une oeuvre de la collection, indique-le dans sequel_of avec le titre exact de l'oeuvre parente.
- Tiens compte des oeuvres ignorees et de leurs raisons pour affiner tes propositions.

Reponds UNIQUEMENT avec un tableau JSON valide, sans markdown ni texte autour. Format exact :
[{"title":"Titre romaji exact","explanation":"Explication 2-3 phrases","genres":["Genre1"],"year":2020,"sequel_of":null}]
sequel_of = null ou titre exact d'une oeuvre de la collection dont c'est la suite directe.
Propose exactement 3 oeuvres.`;

        const collectionSummary = (collection || []).map(function(w) {
          var parts = [w.title];
          if (w.rating) parts.push("note: " + w.rating + "/10");
          if (w.notes) parts.push('commentaire: "' + w.notes + '"');
          if (w.genres && w.genres.length) parts.push("genres: " + w.genres.join(", "));
          if (w.status === "termine") parts.push("(termine)");
          else if (w.status === "en_cours") parts.push("(en cours)");
          return "- " + parts.join(", ");
        }).join("\n");

        const ignoredSummary = (ignored || []).map(function(w) {
          var parts = [w.title];
          if (w.notes) parts.push('raison: "' + w.notes + '"');
          return "- " + parts.join(", ");
        }).join("\n");

        const plannedSummary = (planned || []).map(function(w) {
          return "- " + w.title;
        }).join("\n");

        var contextBlock = "Voici ma collection de " + type + "s (vues ou en cours) :\n" + (collectionSummary || "(vide)");
        if (ignoredSummary) contextBlock += "\n\nOeuvres que je ne veux PAS voir (ne jamais reproposer, comprends pourquoi) :\n" + ignoredSummary;
        if (plannedSummary) contextBlock += "\n\nOeuvres deja planifiees (ne pas reproposer) :\n" + plannedSummary;
        contextBlock += "\n\nProposes-moi 3 " + type + "s que je devrais decouvrir.";

        var claudeMessages = [];
        if (!messages || messages.length === 0) {
          claudeMessages = [{ role: "user", content: contextBlock }];
        } else {
          claudeMessages = [{ role: "user", content: contextBlock }, ...messages];
        }

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-5",
            max_tokens: 1500,
            system: systemPrompt,
            messages: claudeMessages,
          }),
        });

        const data = await response.json();
        const text = (data.content && data.content[0] && data.content[0].text) || "[]";

        // Increment quota after successful call
        await incrementQuota(authToken, quotaCheck.profile);

        return new Response(JSON.stringify({ text }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
