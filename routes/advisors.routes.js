// routes/advisors.routes.js
const express = require("express");
const router = express.Router();
const { query } = require("../config/database");
const { authenticateToken, authorizeRole } = require("../middleware/auth.middleware");

router.use(authenticateToken);
router.use(authorizeRole("Controller", "Director"));

/**
 * IMPORTANT:
 * Put static routes BEFORE dynamic "/:id/..." routes,
 * otherwise "/flags/summary" may be captured as ":id = flags".
 * Express matches in declaration order. [web:8][web:149]
 */

// -----------------------------------------
// STATIC ROUTES (must be before /:id/...)
// -----------------------------------------

// GET /api/advisors/flags/summary?status=OPEN
router.get("/flags/summary", async (req, res) => {
  try {
    const { status = "OPEN" } = req.query;

    const result = await query(
      `SELECT COUNT(*)::int AS open_flags FROM sale_flags WHERE status = $1`,
      [status]
    );

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error("GET /advisors/flags/summary error:", error);
    res.status(500).json({ error: "Failed to fetch flags summary" });
  }
});

// GET /api/advisors/protocol/summary
// NOTE: only works if you add sales.used_recommendations BOOLEAN
router.get("/protocol/summary", async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)::int AS total_sales,
        COUNT(*) FILTER (WHERE used_recommendations = TRUE)::int AS compliant_sales
      FROM sales
    `);

    const total = Number(result.rows[0]?.total_sales || 0);
    const compliant = Number(result.rows[0]?.compliant_sales || 0);
    const percent = total > 0 ? Math.round((compliant / total) * 100) : 0;

    res.json({
      data: {
        total_sales: total,
        compliant_sales: compliant,
        compliance_percent: percent,
      },
    });
  } catch (error) {
    console.error("GET /advisors/protocol/summary error:", error);
    res.status(500).json({ error: "Failed to fetch protocol summary" });
  }
});

// PATCH /api/advisors/flags/:flagId/review
router.patch("/flags/:flagId/review", async (req, res) => {
  try {
    const { flagId } = req.params;

    const result = await query(
      `
      UPDATE sale_flags
      SET status = 'REVIEWED', reviewed_at = NOW(), reviewed_by = $1
      WHERE flag_id = $2
      RETURNING *
      `,
      [req.user.userId, flagId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Flag not found" });

    res.json({ message: "Flag reviewed", data: result.rows[0] });
  } catch (error) {
    console.error("PATCH /advisors/flags/:flagId/review error:", error);
    res.status(500).json({ error: "Failed to update flag" });
  }
});

// POST /api/advisors/:id/check-suspicious
router.post("/:id/check-suspicious", async (req, res) => {
  const advisorId = Number(req.params.id);
  const days = Number(req.body?.days || 30);

  if (!Number.isFinite(advisorId)) {
    return res.status(400).json({ error: "Invalid advisor id" });
  }

  try {
    // Load sales for advisor
    const salesRes = await query(
      `
      SELECT sale_id, created_at, updated_at, total_amount
      FROM sales
      WHERE created_by = $1
        AND created_at >= NOW() - ($2 || ' days')::interval
      ORDER BY created_at DESC
      `,
      [advisorId, days]
    );

    // Advisor average (for spike rule)
    const avgRes = await query(
      `
      SELECT COALESCE(AVG(total_amount), 0) AS avg_sale
      FROM sales
      WHERE created_by = $1
        AND created_at >= NOW() - ($2 || ' days')::interval
      `,
      [advisorId, days]
    );

    const sales = salesRes.rows || [];
    const avgSale = Number(avgRes.rows[0]?.avg_sale || 0);

    let inserted = 0;

    // Dedupe helper (because your table has no UNIQUE constraint for ON CONFLICT)
    const flagExists = async (saleId, title) => {
      const r = await query(
        `
        SELECT 1
        FROM sale_flags
        WHERE advisor_id = $1 AND sale_id = $2 AND title = $3
        LIMIT 1
        `,
        [advisorId, saleId, title]
      );
      return r.rows.length > 0;
    };

    const addFlag = async ({ saleId, severity, title, description }) => {
      if (await flagExists(saleId, title)) return;

      const r = await query(
        `
        INSERT INTO sale_flags (sale_id, advisor_id, severity, title, description, status, created_at)
        VALUES ($1, $2, $3, $4, $5, 'OPEN', NOW())
        RETURNING flag_id
        `,
        [saleId, advisorId, severity, title, description || null]
      );

      if (r.rowCount > 0) inserted += 1;
    };

    for (const s of sales) {
      const dt = new Date(s.created_at);
      const hour = dt.getHours();
      const total = Number(s.total_amount || 0);

      // Rule A: Off-hours (08:00–18:00)
      if (hour < 8 || hour >= 18) {
        await addFlag({
          saleId: s.sale_id,
          severity: "MEDIUM",
          title: "Sale created outside business hours",
          description: `Created at ${dt.toISOString()}`,
        });
      }

      // Rule B: Unusual high sale (3x avg and > 50k)
      if (avgSale > 0 && total > avgSale * 3 && total > 50000) {
        await addFlag({
          saleId: s.sale_id,
          severity: "HIGH",
          title: "Unusual high sale amount",
          description: `Total ${total} vs avg ${Math.round(avgSale)}`,
        });
      }

      // Rule C: Edited immediately (heuristic)
      if (s.updated_at) {
        const created = new Date(s.created_at).getTime();
        const updated = new Date(s.updated_at).getTime();
        const minutes = (updated - created) / 60000;

        if (minutes >= 0 && minutes <= 2 && total > 50000) {
          await addFlag({
            saleId: s.sale_id,
            severity: "LOW",
            title: "Sale edited shortly after creation",
            description: `Updated ${minutes.toFixed(1)} min after creation`,
          });
        }
      }
    }

    return res.json({
      success: true,
      checked_sales: sales.length,
      avg_sale: Math.round(avgSale),
      new_flags: inserted,
    });
  } catch (error) {
    console.error("POST /advisors/:id/check-suspicious error:", error);
    return res.status(500).json({ error: "Failed to run suspicious checks" });
  }
});

// -----------------------------------------
// DYNAMIC ROUTES (keep after statics)
// -----------------------------------------

// GET /api/advisors?search=
router.get("/", async (req, res) => {
  try {
    const { search = "" } = req.query;

    const result = await query(
      `
      SELECT
        u.user_id as id,
        u.first_name || ' ' || u.last_name as name,
        u.email,
        u.phone,
        COALESCE(COUNT(s.sale_id), 0)::int as sales,
        COALESCE(SUM(s.total_amount), 0) as revenue,
        COALESCE(AVG(s.total_amount), 0) as avg_sale,
        COALESCE(COUNT(f.flag_id) FILTER (WHERE f.status = 'OPEN'), 0)::int as alerts
      FROM users u
      LEFT JOIN sales s
        ON s.created_by = u.user_id
      LEFT JOIN sale_flags f
        ON f.advisor_id = u.user_id
      WHERE u.role = 'Advisor'
        AND (
          $1 = '' OR
          (u.first_name || ' ' || u.last_name) ILIKE $2 OR
          u.email ILIKE $2 OR
          COALESCE(u.phone, '') ILIKE $2
        )
      GROUP BY u.user_id, u.first_name, u.last_name, u.email, u.phone
      ORDER BY revenue DESC
      `,
      [search.trim(), `%${search.trim()}%`]
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error("GET /advisors error:", error);
    res.status(500).json({ error: "Failed to fetch advisors" });
  }
});

// GET /api/advisors/:id/summary
router.get("/:id/summary", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      SELECT
        u.user_id as id,
        u.first_name || ' ' || u.last_name as name,
        u.email,
        u.phone,
        COALESCE(COUNT(s.sale_id), 0)::int as total_sales,
        COALESCE(SUM(s.total_amount), 0) as total_revenue,
        COALESCE(AVG(s.total_amount), 0) as avg_sale,
        COALESCE(COUNT(f.flag_id) FILTER (WHERE f.status = 'OPEN'), 0)::int as suspicious_flags
      FROM users u
      LEFT JOIN sales s ON s.created_by = u.user_id
      LEFT JOIN sale_flags f ON f.advisor_id = u.user_id
      WHERE u.user_id = $1 AND u.role = 'Advisor'
      GROUP BY u.user_id, u.first_name, u.last_name, u.email, u.phone
      `,
      [id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Advisor not found" });

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error("GET /advisors/:id/summary error:", error);
    res.status(500).json({ error: "Failed to fetch advisor summary" });
  }
});

// GET /api/advisors/:id/flags?status=OPEN
router.get("/:id/flags", async (req, res) => {
  try {
    const { id } = req.params;
    const { status = "OPEN" } = req.query;

    const result = await query(
      `
      SELECT
        f.flag_id,
        f.sale_id,
        f.severity,
        f.title,
        f.description,
        f.status,
        f.created_at
      FROM sale_flags f
      WHERE f.advisor_id = $1
        AND ($2 = '' OR f.status = $2)
      ORDER BY
        CASE f.severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        f.created_at DESC
      `,
      [id, status || ""]
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error("GET /advisors/:id/flags error:", error);
    res.status(500).json({ error: "Failed to fetch advisor flags" });
  }
});

module.exports = router;
