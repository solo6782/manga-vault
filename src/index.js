const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/ai-recommend" && request.method === "POST") {
      try {
        const body = await request.json();
        const { collection, ignored, planned, type, genres, messages } = body;

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
