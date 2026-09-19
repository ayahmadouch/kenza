import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../../../../packages/db/pool";

const CreateClient = z.object({
  nom: z.string().trim().min(2).max(80),
  telephone: z.string().trim().regex(/^\+?[0-9 ]{8,16}$/, "téléphone invalide"),
  ville: z.string().trim().max(60).optional(),
  langue: z.enum(["fr", "ar", "darija"]).default("fr"),
});

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

export function registerDashboardRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ KPIs
  app.get("/api/kpis", async () => {
    const q = async <T = Record<string, number>>(sql: string): Promise<T> => (await pool.query(sql)).rows[0] as T;
    const [orders, agent, convs, escal, relances, open] = await Promise.all([
      q(`SELECT COUNT(*)::int n, COALESCE(SUM(total_mad),0)::int ca, COALESCE(AVG(total_mad),0)::int panier FROM orders`),
      q(`SELECT COUNT(*)::int n, COALESCE(SUM(total_mad),0)::int ca FROM orders WHERE created_by = 'agent'`),
      q(`SELECT COUNT(*)::int total,
                COUNT(*) FILTER (WHERE statut <> 'closed')::int actives,
                COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = c.id))::int converties,
                COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM escalations e WHERE e.conversation_id = c.id))::int escaladees,
                COUNT(*) FILTER (WHERE jsonb_array_length(cart) > 0)::int paniers
           FROM conversations c`),
      q(`SELECT COUNT(*)::int n FROM escalations`),
      q(`SELECT COUNT(*) FILTER (WHERE envoyee_a IS NOT NULL AND resultat IN ('sent','replied','converted'))::int envoyees,
                COUNT(*) FILTER (WHERE resultat = 'converted')::int converties FROM relances`),
      q(`SELECT COUNT(*)::int n FROM escalations WHERE statut IN ('NEEDS_HUMAN_REVIEW','IN_PROGRESS')`),
    ]);
    const ab = (await pool.query(
      `SELECT variante, COUNT(*) FILTER (WHERE resultat IN ('sent','replied','converted'))::int envoyees,
              COUNT(*) FILTER (WHERE resultat IN ('replied','converted'))::int reponses,
              COUNT(*) FILTER (WHERE resultat = 'converted')::int converties
         FROM relances GROUP BY variante ORDER BY variante`,
    )).rows as { variante: string; envoyees: number; reponses: number; converties: number }[];
    return {
      conversations_total: convs.total,
      conversations_actives: convs.actives,
      commandes_total: orders.n,
      chiffre_affaires_mad: orders.ca,
      panier_moyen_mad: orders.panier,
      ventes_agent: agent.n,
      ca_agent_mad: agent.ca,
      taux_conversion: ratio(convs.converties, convs.total),
      taux_escalade: ratio(convs.escaladees, convs.total),
      escalades_total: escal.n,
      escalades_ouvertes: open.n,
      paniers_en_cours: convs.paniers,
      relances_envoyees: relances.envoyees,
      relances_converties: relances.converties,
      taux_recuperation_panier: ratio(relances.converties, relances.envoyees),
      ab: ab.map((r) => ({ ...r, taux_reponse: ratio(r.reponses, r.envoyees), taux_conversion: ratio(r.converties, r.envoyees) })),
    };
  });

  // --------------------------------------------------------- Conversations
  app.get("/api/conversations", async () => {
    const { rows } = await pool.query(`
      SELECT c.id, c.telephone, c.langue, c.statut, c.needs_human, c.human_active, c.cart, c.ville, c.last_message_at, c.created_at,
             cl.nom AS client_nom, cl.client_id,
             (SELECT texte FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS dernier_message,
             (SELECT intention FROM messages m WHERE m.conversation_id = c.id AND m.intention IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS intention,
             (SELECT COUNT(*)::int FROM escalations e WHERE e.conversation_id = c.id AND e.statut IN ('NEEDS_HUMAN_REVIEW','IN_PROGRESS')) AS escalades_ouvertes
        FROM conversations c LEFT JOIN clients cl ON cl.client_id = c.client_id
       ORDER BY c.last_message_at DESC LIMIT 200`);
    return rows;
  });

  app.get("/api/conversations/:id/messages", async (req) => {
    const { id } = req.params as { id: string };
    const after = Number((req.query as { after?: string }).after ?? 0) || 0;
    const { rows } = await pool.query(
      `SELECT id, role, texte, intention, langue, tool_calls, guardrail, latency_ms, trace, created_at FROM messages WHERE conversation_id = $1 AND id > $2 ORDER BY id ASC`,
      [id, after],
    );
    return rows;
  });

  app.get("/api/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = (await pool.query(`SELECT c.*, cl.nom AS client_nom FROM conversations c LEFT JOIN clients cl ON cl.client_id = c.client_id WHERE c.id = $1`, [id])).rows[0];
    if (!conv) return reply.code(404).send({ error: "conversation introuvable" });
    const escalations = (await pool.query(`SELECT * FROM escalations WHERE conversation_id = $1 ORDER BY id DESC`, [id])).rows;
    return { ...conv, escalations };
  });

  // Reprise en main par le commerçant : l'agent est désactivé pour cette conversation.
  app.post("/api/conversations/:id/take-over", async (req) => {
    const { id } = req.params as { id: string };
    await pool.query(`UPDATE conversations SET human_active = true, needs_human = true, statut = 'needs_human' WHERE id = $1`, [id]);
    await pool.query(`UPDATE escalations SET statut = 'IN_PROGRESS' WHERE conversation_id = $1 AND statut = 'NEEDS_HUMAN_REVIEW'`, [id]);
    return { ok: true, human_active: true };
  });

  app.post("/api/conversations/:id/release", async (req) => {
    const { id } = req.params as { id: string };
    await pool.query(`UPDATE conversations SET human_active = false, needs_human = false, statut = 'active', last_message_at = now() WHERE id = $1`, [id]);
    await pool.query(`UPDATE escalations SET statut = 'RESOLVED', resolved_at = now() WHERE conversation_id = $1 AND statut IN ('NEEDS_HUMAN_REVIEW','IN_PROGRESS')`, [id]);
    return { ok: true, human_active: false };
  });

  app.post("/api/conversations/:id/human-message", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ texte: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "texte requis" });
    const conv = (await pool.query(`SELECT langue FROM conversations WHERE id = $1`, [id])).rows[0];
    if (!conv) return reply.code(404).send({ error: "conversation introuvable" });
    // synced=false : Kenza relira ce message quand elle reprendra la main.
    await pool.query(`INSERT INTO messages (conversation_id, role, texte, langue, synced) VALUES ($1,'humain',$2,$3,false)`, [id, body.data.texte, conv.langue]);
    await pool.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [id]);
    return { ok: true };
  });

  // --------------------------------------------------------- Catalogue / stock
  const PROMO_JOIN = `LEFT JOIN LATERAL (SELECT prix_promo_mad, fin, condition FROM promotions pr WHERE pr.ref = p.ref AND pr.debut <= CURRENT_DATE AND pr.fin >= CURRENT_DATE ORDER BY pr.id DESC LIMIT 1) pr ON true`;

  app.get("/api/catalogue", async () => {
    const { rows } = await pool.query(
      `SELECT p.ref, p.modele, p.famille, p.genre, p.couleur, p.taille, p.matiere, p.prix_mad, p.stock,
              pr.prix_promo_mad, pr.fin AS promo_fin, COALESCE(pr.prix_promo_mad, p.prix_mad) AS prix_effectif_mad, (p.stock > 0) AS disponible
         FROM products p ${PROMO_JOIN} ORDER BY p.ref`,
    );
    return rows;
  });

  app.get("/api/stock", async (req) => {
    const { famille, couleur, taille, statut } = req.query as Record<string, string | undefined>;
    const where: string[] = [];
    const params: unknown[] = [];
    if (famille) { params.push(famille); where.push(`p.famille = $${params.length}`); }
    if (couleur) { params.push(couleur); where.push(`p.couleur = $${params.length}`); }
    if (taille) { params.push(taille); where.push(`p.taille = $${params.length}`); }
    if (statut === "rupture") where.push(`p.stock = 0`);
    if (statut === "en_stock") where.push(`p.stock > 0`);
    const { rows } = await pool.query(
      `SELECT p.ref, p.modele, p.famille, p.couleur, p.taille, p.stock, CASE WHEN p.stock = 0 THEN 'rupture' WHEN p.stock <= 3 THEN 'faible' ELSE 'en_stock' END AS statut
         FROM products p ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.stock ASC, p.ref`,
      params,
    );
    return rows;
  });

  app.get("/api/stock/facets", async () => {
    const { rows } = await pool.query(`SELECT array_agg(DISTINCT famille ORDER BY famille) familles, array_agg(DISTINCT couleur ORDER BY couleur) couleurs, array_agg(DISTINCT taille ORDER BY taille) tailles FROM products`);
    return rows[0];
  });

  // --------------------------------------------------------------- Commandes
  app.get("/api/commandes", async () => {
    const { rows } = await pool.query(`
      SELECT o.commande_id, o.date, o.statut, o.total_articles_mad, o.frais_livraison_mad, o.total_mad, o.ville_livraison, o.paiement, o.created_by, o.conversation_id,
             cl.nom AS client_nom,
             COALESCE((SELECT json_agg(json_build_object('ref', oi.ref, 'modele', oi.modele, 'taille', oi.taille, 'quantite', oi.quantite, 'prix_unitaire_mad', oi.prix_unitaire_mad) ORDER BY oi.id) FROM order_items oi WHERE oi.commande_id = o.commande_id), '[]') AS items
        FROM orders o LEFT JOIN clients cl ON cl.client_id = o.client_id
       ORDER BY (o.created_by = 'agent') DESC, o.date DESC, o.commande_id DESC LIMIT 300`);
    return rows;
  });

  // --------------------------------------------------------------- Relances
  app.get("/api/relances", async () => {
    const { rows } = await pool.query(`
      SELECT r.id, r.conversation_id, r.variante, r.planifiee_a, r.envoyee_a, r.resultat, r.texte, r.converted_order_id,
             c.telephone, c.cart, c.last_message_at, cl.nom AS client_nom
        FROM relances r LEFT JOIN conversations c ON c.id = r.conversation_id LEFT JOIN clients cl ON cl.client_id = c.client_id
       ORDER BY r.id DESC LIMIT 100`);
    return rows;
  });

  // --------------------------------------------------------------- Escalades
  app.get("/api/escalations", async () => {
    const { rows } = await pool.query(`
      SELECT e.id, e.conversation_id, e.motif, e.contexte_resume, e.statut, e.created_at, e.resolved_at,
             c.telephone, c.human_active, c.langue, cl.nom AS client_nom
        FROM escalations e LEFT JOIN conversations c ON c.id = e.conversation_id LEFT JOIN clients cl ON cl.client_id = c.client_id
       ORDER BY (e.statut = 'RESOLVED'), e.created_at DESC LIMIT 100`);
    return rows;
  });

  // ----------------------------------------------------------------- Traces
  app.get("/api/traces", async (req) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 30) || 30, 100);
    const { rows } = await pool.query(
      `SELECT m.id, m.conversation_id, m.intention, m.langue, m.latency_ms, m.guardrail, m.trace, m.texte, m.created_at, cl.nom AS client_nom
         FROM messages m JOIN conversations c ON c.id = m.conversation_id LEFT JOIN clients cl ON cl.client_id = c.client_id
        WHERE m.role = 'agent' AND m.trace IS NOT NULL ORDER BY m.id DESC LIMIT $1`,
      [limit],
    );
    return rows;
  });

  // ------------------------------------------------------------------ Clients
  app.get("/api/clients", async (req) => {
    const { q } = req.query as { q?: string };
    const { rows } = await pool.query(
      `SELECT client_id, nom, telephone, ville, langue_preferee, nb_commandes, segment FROM clients
        WHERE $1::text IS NULL OR nom ILIKE '%' || $1 || '%' OR telephone ILIKE '%' || $1 || '%' OR client_id ILIKE '%' || $1 || '%'
        ORDER BY client_id LIMIT 200`,
      [q?.trim() || null],
    );
    return rows;
  });

  app.post("/api/clients", async (req, reply) => {
    const body = CreateClient.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join(", ") });
    const { nom, telephone, ville, langue } = body.data;
    const tel = telephone.replace(/\s+/g, "");
    const exist = (await pool.query(`SELECT * FROM clients WHERE telephone = $1`, [tel])).rows[0];
    if (exist) return exist;
    const id = `CLI-W${Date.now().toString(36).toUpperCase()}`;
    const { rows } = await pool.query(
      `INSERT INTO clients (client_id, nom, telephone, ville, langue_preferee, premier_achat, nb_commandes, segment) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,0,'nouveau') RETURNING *`,
      [id, nom, tel, ville ?? null, langue],
    );
    return rows[0];
  });
}
