const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // AI Recommendation endpoint
    if (url.pathname === "/api/ai-recommend" && request.method === "POST") {
      try {
        const body = await request.json();
        const { collection, type, genres, messages } = body;

        // Build system prompt
        const systemPrompt = `Tu es un expert en manga et anime. Tu connais parfaitement les œuvres japonaises et tu recommandes des œuvres adaptées aux goûts de l'utilisateur en te basant sur sa collection.

Règles importantes :
- Ne recommande JAMAIS une œuvre déjà présente dans la collection de l'utilisateur.
- Base-toi sur les notes (1-10) et les commentaires personnels pour comprendre ses goûts.
- Propose des œuvres de type "${type}" uniquement.
${genres && genres.length > 0 ? `- Les genres demandés sont : ${genres.join(", ")}. Privilégie ces genres.` : ""}
- Pour chaque recommandation, explique PRÉCISÉMENT pourquoi elle correspond à ses goûts, en citant des œuvres spécifiques de sa collection.

Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown ni texte autour. Format exact :
[
  {
    "title": "Titre romaji exact (tel que sur MyAnimeList)",
    "explanation": "Explication personnalisée de 2-3 phrases pourquoi cette œuvre lui correspond, en citant sa collection",
    "genres": ["Genre1", "Genre2"],
    "year": 2020
  }
]
Propose exactement 3 œuvres.`;

        // Build collection summary
        const collectionSummary = collection.map(function(w) {
          var parts = [w.title];
          if (w.rating) parts.push("note: " + w.rating + "/10");
          if (w.notes) parts.push("commentaire: \"" + w.notes + "\"");
          if (w.genres && w.genres.length) parts.push("genres: " + w.genres.join(", "));
          if (w.status === "termine") parts.push("(terminé)");
          else if (w.status === "en_cours") parts.push("(en cours)");
          return "- " + parts.join(", ");
        }).join("\n");

        // Build messages for Claude
        var claudeMessages = [];

        if (!messages || messages.length === 0) {
          // First call: send collection
          claudeMessages = [{
            role: "user",
            content: `Voici ma collection de ${type}s :\n${collectionSummary}\n\nProposes-moi 3 ${type}s que je devrais découvrir.`
          }];
        } else {
          // Debate: send full history including collection context
          claudeMessages = [{
            role: "user",
            content: `Voici ma collection de ${type}s :\n${collectionSummary}\n\nProposes-moi 3 ${type}s que je devrais découvrir.`
          }, ...messages];
        }

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-opus-4-5",
            max_tokens: 1500,
            system: systemPrompt,
            messages: claudeMessages,
          }),
        });

        const data = await response.json();
        const text = data.content && data.content[0] && data.content[0].text || "[]";

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

    // Serve static assets
    return env.ASSETS.fetch(request);
  }
};
