import type { FastifyInstance } from "fastify";
import { pool } from "../../../../packages/db/pool";

export function registerDashboardRoutes(app: FastifyInstance) {
  app.get("/api/kpis", async () => {
    const [conversationsActives, commandes, escalades, relancesEnvoyees, relancesConverties] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM conversations WHERE statut = 'active'`),
      pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_mad),0)::int AS ca, COALESCE(AVG(total_mad),0)::int AS panier_moyen FROM orders`),
      pool.query(`SELECT COUNT(*)::int AS n FROM escalations WHERE statut = 'NEEDS_HUMAN_REVIEW'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM relances WHERE envoyee_a IS NOT NULL`),
      pool.query(`SELECT COUNT(*)::int AS n FROM relances WHERE resultat = 'converted'`),
    ]);

    const ventesAgent = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_mad),0)::int AS ca FROM orders WHERE created_by = 'agent'`);
    const totalConvs = await pool.query(`SELECT COUNT(*)::int AS n FROM conversations`);
    const convsAvecCommande = await pool.query(
      `SELECT COUNT(DISTINCT c.id)::int AS n FROM conversations c JOIN orders o ON o.client_id = c.client_id`
    );

    const tauxConversion = totalConvs.rows[0].n > 0 ? convsAvecCommande.rows[0].n / totalConvs.rows[0].n : 0;
    const tauxEscalade = totalConvs.rows[0].n > 0 ? escalades.rows[0].n / totalConvs.rows[0].n : 0;
    const tauxRecuperationPanier = relancesEnvoyees.rows[0].n > 0 ? relancesConverties.rows[0].n / relancesEnvoyees.rows[0].n : 0;

    return {
      conversations_actives: conversationsActives.rows[0].n,
      commandes_total: commandes.rows[0].n,
      chiffre_affaires_mad: commandes.rows[0].ca,
      panier_moyen_mad: commandes.rows[0].panier_moyen,
      ventes_agent: ventesAgent.rows[0].n,
      ca_agent_mad: ventesAgent.rows[0].ca,
      taux_conversion: tauxConversion,
      taux_escalade: tauxEscalade,
      taux_recuperation_panier: tauxRecuperationPanier,
    };
  });

  app.get("/api/conversations", async () => {
    const { rows } = await pool.query(`
      SELECT c.id, c.telephone, c.langue, c.statut, c.needs_human, c.cart, c.last_message_at,
             cl.nom AS client_nom, cl.ville,
             (SELECT texte FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS dernier_message,
             (SELECT intention FROM messages m WHERE m.conversation_id = c.id AND role='agent' ORDER BY created_at DESC LIMIT 1) AS intention
      FROM conversations c
      LEFT JOIN clients cl ON cl.client_id = c.client_id
      ORDER BY c.last_message_at DESC
      LIMIT 100
    `);
    return rows;
  });

  app.get("/api/conversations/:id/messages", async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`, [id]);
    return rows;
  });

  app.post("/api/conversations/:id/resume-human", async (req) => {
    const { id } = req.params as { id: string };
    await pool.query(`UPDATE conversations SET needs_human = true, statut = 'needs_human' WHERE id = $1`, [id]);
    await pool.query(`UPDATE escalations SET statut = 'IN_PROGRESS' WHERE conversation_id = $1 AND statut = 'NEEDS_HUMAN_REVIEW'`, [id]);
    return { ok: true };
  });

  app.get("/api/catalogue", async () => {
    const { rows } = await pool.query(`
      SELECT p.*, pr.prix_promo_mad, pr.debut, pr.fin
      FROM products p
      LEFT JOIN promotions pr ON pr.ref = p.ref AND pr.debut <= CURRENT_DATE AND pr.fin >= CURRENT_DATE
      ORDER BY p.ref
    `);
    return rows;
  });

  app.get("/api/stock", async (req) => {
    const { famille, couleur, taille, statut } = req.query as Record<string, string | undefined>;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (famille) { conditions.push(`famille ILIKE $${i++}`); params.push(`%${famille}%`); }
    if (couleur) { conditions.push(`couleur ILIKE $${i++}`); params.push(`%${couleur}%`); }
    if (taille) { conditions.push(`taille = $${i++}`); params.push(taille); }
    if (statut === "rupture") conditions.push(`stock = 0`);
    if (statut === "en_stock") conditions.push(`stock > 0`);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(`SELECT ref, modele, famille, couleur, taille, stock FROM products ${where} ORDER BY stock ASC`, params);
    return rows;
  });

  app.get("/api/commandes", async () => {
    const { rows } = await pool.query(`
      SELECT o.commande_id, o.date, o.statut, o.total_mad, o.frais_livraison_mad, o.ville_livraison, o.paiement, o.created_by,
             cl.nom AS client_nom,
             (SELECT json_agg(oi) FROM order_items oi WHERE oi.commande_id = o.commande_id) AS items
      FROM orders o
      LEFT JOIN clients cl ON cl.client_id = o.client_id
      ORDER BY o.date DESC, o.commande_id DESC
      LIMIT 200
    `);
    return rows;
  });

  app.get("/api/relances", async () => {
    const { rows } = await pool.query(`
      SELECT r.*, c.telephone, cl.nom AS client_nom, c.cart
      FROM relances r
      LEFT JOIN conversations c ON c.id = r.conversation_id
      LEFT JOIN clients cl ON cl.client_id = c.client_id
      ORDER BY r.planifiee_a DESC
      LIMIT 100
    `);
    return rows;
  });

  app.get("/api/escalations", async () => {
    const { rows } = await pool.query(`
      SELECT e.*, cl.nom AS client_nom, c.telephone
      FROM escalations e
      LEFT JOIN conversations c ON c.id = e.conversation_id
      LEFT JOIN clients cl ON cl.client_id = c.client_id
      ORDER BY e.created_at DESC
      LIMIT 100
    `);
    return rows;
  });

  app.get("/api/clients/search", async (req) => {
    const { q } = req.query as { q?: string };
    const { rows } = await pool.query(
      `SELECT client_id, nom, telephone, ville, langue_preferee FROM clients WHERE nom ILIKE $1 OR telephone ILIKE $1 ORDER BY nom LIMIT 20`,
      [`%${q ?? ""}%`]
    );
    return rows;
  });
}
