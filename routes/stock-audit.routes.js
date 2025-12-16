const express = require("express");
const router = express.Router();
const { query } = require("../config/database");
const { authenticateToken, authorizeRole } = require("../middleware/auth.middleware");

router.use(authenticateToken);
router.use(authorizeRole("Controller", "Director"));

/**
 * TEMP Stock Audit (works with only `sales` table)
 * - List: groups sales by reference (acts like "product" placeholder)
 * - Trace: timeline of sales for a given reference
 *
 * GET /api/stock-audit/articles?q=&mode=all|variance|deadstock
 */
router.get("/articles", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const mode = String(req.query.mode || "all").toLowerCase();
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    // "product" == sales.reference (TEMP)
    const result = await query(
      `
      SELECT
        s.reference,
        COUNT(*)::int AS sales_count,
        COALESCE(SUM(s.total_amount), 0) AS total_revenue,
        MAX(s.created_at) AS last_time,
        MAX(u.first_name || ' ' || u.last_name) AS last_advisor
      FROM sales s
      LEFT JOIN users u ON u.user_id = s.created_by
      WHERE ($1 = '' OR s.reference ILIKE $2 OR s.client_name ILIKE $2)
      GROUP BY s.reference
      ORDER BY last_time DESC NULLS LAST
      LIMIT $3 OFFSET $4
      `,
      [q, `%${q}%`, limit, offset]
    );

    // TEMP filters:
    // - variance: show references with >= 2 sales (just to demonstrate filter)
    // - deadstock: show references with 0 sales (impossible here) => returns []
    let rows = result.rows;

    if (mode === "variance") {
      rows = rows.filter((r) => Number(r.sales_count || 0) >= 2);
    } else if (mode === "deadstock") {
      rows = []; // cannot compute deadstock without articles table
    }

    // Map to the UI keys expected by StockAudit.jsx
    const data = rows.map((r) => ({
      article_id: r.reference, // TEMP: use reference as id
      name: `Sales ref: ${r.reference}`,
      type: "N/A",
      service: "N/A",
      client_type: "N/A",
      stock: null,
      expected_qty: Number(r.sales_count || 0),
      variance: 0,
      advisor: r.last_advisor || "—",
      time: r.last_time,
      total_revenue: r.total_revenue,
    }));

    return res.json({ data, meta: { q, mode, limit, offset } });
  } catch (error) {
    console.error("GET /stock-audit/articles error:", error?.message, error);
    return res.status(500).json({ error: "Failed to fetch stock audit articles" });
  }
});

/**
 * GET /api/stock-audit/articles/:reference/trace
 * TEMP timeline based on sales rows
 */
router.get("/articles/:reference/trace", async (req, res) => {
  try {
    const reference = String(req.params.reference || "").trim();

    const salesRes = await query(
      `
      SELECT
        s.sale_id,
        s.reference,
        s.client_name,
        s.total_amount,
        s.status,
        s.created_at,
        (u.first_name || ' ' || u.last_name) AS advisor_name
      FROM sales s
      LEFT JOIN users u ON u.user_id = s.created_by
      WHERE s.reference = $1
      ORDER BY s.created_at DESC
      `,
      [reference]
    );

    if (salesRes.rows.length === 0) {
      return res.status(404).json({ error: "Reference not found" });
    }

    const timeline = salesRes.rows.map((s) => ({
      time: s.created_at,
      actor: s.advisor_name || "—",
      action: `Sale ${s.reference} (${s.status}) - ${s.client_name}`,
      qtyChange: -1, // TEMP: one sale treated as -1
      ref: s.sale_id,
      direction: "OUT",
    }));

    return res.json({
      data: {
        article_id: reference,
        name: `Sales ref: ${reference}`,
        expected: salesRes.rows.length,
        logical: null,
        variance: 0,
        timeline,
      },
    });
  } catch (error) {
    console.error("GET /stock-audit/articles/:reference/trace error:", error?.message, error);
    return res.status(500).json({ error: "Failed to trace article" });
  }
});

module.exports = router;
