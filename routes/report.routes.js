// routes/report.routes.js
const express = require("express");
const router = express.Router();
const { query } = require("../config/database");
const { authenticateToken, authorizeRole } = require("../middleware/auth.middleware");

router.use(authenticateToken);

// ---- token helpers (users table id + role) ----
function getTokenUserId(req) {
  const u = req.user || {};
  return u.user_id || u.userId || u.id || null; // users.user_id
}
function getTokenRole(req) {
  const u = req.user || {};
  return String(u.role || "");
}

// ---- DB mapping: users.user_id -> employees.employee_id ----
async function getEmployeeForTokenUser(req) {
  const tokenUserId = getTokenUserId(req);
  if (!tokenUserId) return null;

  const r = await query(
    `SELECT employee_id, full_name, role
     FROM employees
     WHERE user_id = $1
     LIMIT 1`,
    [tokenUserId]
  );

  return r.rows[0] || null;
}

// Controllers always scoped; Directors only scoped if mine=true
function mustScopeToMine(req) {
  const role = getTokenRole(req);
  return role === "Controller" || req.query?.mine === "true";
}

// Helper: if scoping is required, get employee_id or return 400
async function requireEmployeeId(req, res) {
  const emp = await getEmployeeForTokenUser(req);
  if (!emp?.employee_id) {
    res.status(400).json({
      error: { message: "No employee record linked to this user. Please link users.user_id -> employees.user_id." },
    });
    return null;
  }
  return emp.employee_id;
}

// =====================================================
// STATIC ROUTES (must come before /:id) [web:8]
// =====================================================

// GET /api/reports/stats/summary
// Controller: own stats
// Director: global stats unless mine=true
router.get("/stats/summary", async (req, res) => {
  try {
    const role = getTokenRole(req);

    if (role === "Director" && req.query?.mine !== "true") {
      const result = await query(`
        SELECT 
          COUNT(*) as total_reports,
          COUNT(CASE WHEN is_read = false THEN 1 END) as unread_reports,
          COUNT(CASE WHEN priority = 'Urgent' THEN 1 END) as urgent_reports,
          COUNT(CASE WHEN priority = 'Urgent' AND is_read = false THEN 1 END) as urgent_unread
        FROM reports
      `);

      return res.json({ success: true, data: result.rows[0] });
    }

    const employeeId = await requireEmployeeId(req, res);
    if (!employeeId) return;

    const result = await query(
      `
      SELECT 
        COUNT(*) as total_reports,
        COUNT(CASE WHEN is_read = false THEN 1 END) as unread_reports,
        COUNT(CASE WHEN priority = 'Urgent' THEN 1 END) as urgent_reports,
        COUNT(CASE WHEN priority = 'Urgent' AND is_read = false THEN 1 END) as urgent_unread
      FROM reports
      WHERE author_id = $1
      `,
      [employeeId]
    );

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Get report stats error:", error?.message, error);
    return res.status(500).json({ error: { message: "Failed to fetch statistics" } });
  }
});

// GET /api/reports/urgent/unread
// Director: global urgent/unread unless mine=true
router.get("/urgent/unread", async (req, res) => {
  try {
    const role = getTokenRole(req);

    if (role === "Director" && req.query?.mine !== "true") {
      const result = await query(
        `SELECT * FROM reports
         WHERE priority = 'Urgent' AND is_read = false
         ORDER BY report_date DESC, report_time DESC`
      );

      return res.json({ success: true, count: result.rows.length, data: result.rows });
    }

    const employeeId = await requireEmployeeId(req, res);
    if (!employeeId) return;

    const result = await query(
      `SELECT * FROM reports 
       WHERE author_id = $1 AND priority = 'Urgent' AND is_read = false
       ORDER BY report_date DESC, report_time DESC`,
      [employeeId]
    );

    return res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("Get urgent reports error:", error?.message, error);
    return res.status(500).json({ error: { message: "Failed to fetch urgent reports" } });
  }
});

// GET /api/reports/departments/list
router.get("/departments/list", async (req, res) => {
  try {
    const role = getTokenRole(req);

    if (role === "Director" && req.query?.mine !== "true") {
      const result = await query("SELECT DISTINCT department FROM reports ORDER BY department");
      return res.json({ success: true, data: result.rows.map((row) => row.department) });
    }

    const employeeId = await requireEmployeeId(req, res);
    if (!employeeId) return;

    const result = await query(
      "SELECT DISTINCT department FROM reports WHERE author_id = $1 ORDER BY department",
      [employeeId]
    );

    return res.json({ success: true, data: result.rows.map((row) => row.department) });
  } catch (error) {
    console.error("Get departments error:", error?.message, error);
    return res.status(500).json({ error: { message: "Failed to fetch departments" } });
  }
});

// GET /api/reports/categories/list
router.get("/categories/list", async (req, res) => {
  try {
    const role = getTokenRole(req);

    if (role === "Director" && req.query?.mine !== "true") {
      const result = await query("SELECT DISTINCT category FROM reports ORDER BY category");
      return res.json({ success: true, data: result.rows.map((row) => row.category) });
    }

    const employeeId = await requireEmployeeId(req, res);
    if (!employeeId) return;

    const result = await query(
      "SELECT DISTINCT category FROM reports WHERE author_id = $1 ORDER BY category",
      [employeeId]
    );

    return res.json({ success: true, data: result.rows.map((row) => row.category) });
  } catch (error) {
    console.error("Get categories error:", error?.message, error);
    return res.status(500).json({ error: { message: "Failed to fetch categories" } });
  }
});

// PATCH /api/reports/mark-all-read
// Director: marks ALL as read unless mine=true
router.patch("/mark-all-read", async (req, res) => {
  try {
    const role = getTokenRole(req);

    if (role === "Director" && req.query?.mine !== "true") {
      const result = await query(
        `UPDATE reports
         SET is_read = true, updated_at = CURRENT_TIMESTAMP
         WHERE is_read = false
         RETURNING report_id`
      );

      return res.json({ success: true, message: "All reports marked as read", count: result.rows.length });
    }

    const employeeId = await requireEmployeeId(req, res);
    if (!employeeId) return;

    const result = await query(
      `UPDATE reports 
       SET is_read = true, updated_at = CURRENT_TIMESTAMP
       WHERE author_id = $1 AND is_read = false
       RETURNING report_id`,
      [employeeId]
    );

    return res.json({ success: true, message: "All your reports marked as read", count: result.rows.length });
  } catch (error) {
    console.error("Mark all read error:", error?.message, error);
    return res.status(500).json({ error: { message: "Failed to mark all reports as read" } });
  }
});

// PATCH /api/reports/:id/read   ✅ (fixes your 404)
router.patch("/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    const { isRead } = req.body;

    if (isRead === undefined) {
      return res.status(400).json({ error: { message: "isRead field is required" } });
    }

    const role = getTokenRole(req);

    if (role === "Director") {
      const result = await query(
        `UPDATE reports
         SET is_read = $1, updated_at = CURRENT_TIMESTAMP
         WHERE report_id = $2
         RETURNING *`,
        [Boolean(isRead), id]
      );

      if (!result.rows.length) return res.status(404).json({ error: { message: "Report not found" } });
      return res.json({ success: true, data: result.rows[0] });
    }

    const employeeId = await requireEmployeeId(req, res);
    if (!employeeId) return;

    const result = await query(
      `UPDATE reports
       SET is_read = $1, updated_at = CURRENT_TIMESTAMP
       WHERE report_id = $2 AND author_id = $3
       RETURNING *`,
      [Boolean(isRead), id, employeeId]
    );

    if (!result.rows.length) return res.status(404).json({ error: { message: "Report not found" } });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Mark report read error:", error?.message, error);
    return res.status(500).json({ error: { message: "Failed to update report status" } });
  }
});

// =====================================================
// LIST
// =====================================================

// GET /api/reports
router.get("/", async (req, res) => {
  try {
    const { priority, department, category, isRead, search, limit, offset } = req.query;
    const role = getTokenRole(req);

    let queryText = "SELECT * FROM reports WHERE 1=1";
    const params = [];
    let p = 1;

    // scope only when needed
    if (mustScopeToMine(req)) {
      const employeeId = await requireEmployeeId(req, res);
      if (!employeeId) return;

      queryText += ` AND author_id = $${p}`;
      params.push(employeeId);
      p++;
    }

    if (priority && priority !== "all") {
      queryText += ` AND priority = $${p}`;
      params.push(priority);
      p++;
    }

    if (department) {
      queryText += ` AND department = $${p}`;
      params.push(department);
      p++;
    }

    if (category) {
      queryText += ` AND category = $${p}`;
      params.push(category);
      p++;
    }

    // ✅ navbar uses /api/reports?isRead=false (no mine). This must work for Director.
    if (isRead === "true" || isRead === "false") {
      queryText += ` AND is_read = $${p}`;
      params.push(isRead === "true");
      p++;
    }

    if (search) {
      queryText += ` AND (
        title ILIKE $${p} OR
        summary ILIKE $${p} OR
        full_content ILIKE $${p} OR
        author_name ILIKE $${p} OR
        department ILIKE $${p} OR
        category ILIKE $${p}
      )`;
      params.push(`%${search}%`);
      p++;
    }

    queryText += " ORDER BY report_date DESC, report_time DESC";

    const lim = Math.min(Number(limit || 50), 200);
    const off = Math.max(Number(offset || 0), 0);

    queryText += ` LIMIT $${p}`;
    params.push(lim);
    p++;

    queryText += ` OFFSET $${p}`;
    params.push(off);

    const result = await query(queryText, params);

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
      meta: { limit: lim, offset: off, role },
    });
  } catch (error) {
    console.error("Get reports error:", error?.message, error);
    return res.status(500).json({ error: { message: "Failed to fetch reports" } });
  }
});

// =====================================================
// GET ONE
// =====================================================

// GET /api/reports/:id
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const role = getTokenRole(req);

    if (role === "Director") {
      const result = await query("SELECT * FROM reports WHERE report_id = $1", [id]);
      if (!result.rows.length) return res.status(404).json({ error: { message: "Report not found" } });
      return res.json({ success: true, data: result.rows[0] });
    }

    const employeeId = await requireEmployeeId(req, res);
    if (!employeeId) return;

    const result = await query("SELECT * FROM reports WHERE report_id = $1 AND author_id = $2", [
      id,
      employeeId,
    ]);

    if (!result.rows.length) return res.status(404).json({ error: { message: "Report not found" } });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Get report error:", error?.message, error);
    return res.status(500).json({ error: { message: "Failed to fetch report" } });
  }
});

// =====================================================
// CREATE
// =====================================================

// POST /api/reports
router.post("/", authorizeRole("Controller", "Director"), async (req, res) => {
  try {
    const { department, title, summary, fullContent, priority, category, reportDate, reportTime } = req.body;

    if (!department || !title || !summary || !category) {
      return res.status(400).json({ error: { message: "Missing required fields" } });
    }

    const validPriorities = ["Normal", "Urgent", "High", "Low"];
    const reportPriority = priority || "Normal";
    if (!validPriorities.includes(reportPriority)) {
      return res.status(400).json({ error: { message: "Invalid priority level" } });
    }

    // Author must be an employee_id (FK-safe)
    const employeeId = await requireEmployeeId(req, res);
    if (!employeeId) return;

    const emp = await getEmployeeForTokenUser(req);
    const finalAuthorId = employeeId;
    const finalAuthorName = emp?.full_name || "Unknown";
    const finalAuthorRole = emp?.role || getTokenRole(req) || "Controller";

    const result = await query(
      `INSERT INTO reports (
        author_id, author_name, author_role, department,
        title, summary, full_content, priority, category,
        is_read, report_date, report_time
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        finalAuthorId,
        finalAuthorName,
        finalAuthorRole,
        department,
        title,
        summary,
        fullContent ?? null,
        reportPriority,
        category,
        false,
        reportDate || new Date(),
        reportTime || new Date().toTimeString().split(" ")[0],
      ]
    );

    return res.status(201).json({ success: true, message: "Report created successfully", data: result.rows[0] });
  } catch (error) {
    console.error("Create report error:", error?.message, error);
    return res.status(500).json({ error: { message: "Failed to create report" } });
  }
});

module.exports = router;
