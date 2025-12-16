// server.js - FULL VERSION (keeps all your code)
require("dotenv").config(); // MUST be first

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

// Import route modules
const authRoutes = require("./routes/auth.routes");
const employeeRoutes = require("./routes/employee.routes");
const articleRoutes = require("./routes/article.routes");
const warehouseRoutes = require("./routes/warehouse.routes");
const reportRoutes = require("./routes/report.routes");
const salesRoutes = require("./routes/sales.routes"); // Analytics
const salesTransactionRoutes = require("./routes/sales-transactions.routes"); // Operations
const userRoutes = require("./routes/user.routes");
const invoicesRoutes = require("./routes/invoices.routes");
const clientsRoutes = require("./routes/clients.routes");
const recommendationsRoutes = require("./routes/recommendations.routes");
const advisorsRoutes = require("./routes/advisors.routes");
const stockAuditRoutes = require("./routes/stock-audit.routes"); // Trace

const app = express();

// Debug: Verify env variables (optional)
if ((process.env.NODE_ENV || "development") !== "production") {
  console.log("🔍 Environment Variables:");
  console.log("DB_NAME:", process.env.DB_NAME);
  console.log("DB_USER:", process.env.DB_USER);
  console.log("DB_PASSWORD:", process.env.DB_PASSWORD ? "***SET***" : "❌ NOT SET");
  console.log("PORT:", process.env.PORT);
  console.log("---");
}

// Middleware (order matters)
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS (dynamic origin + credentials) [web:453][web:606]
app.use(
  cors({
    origin: function (origin, callback) {
      // allow non-browser tools like Postman / curl
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
        process.env.FRONTEND_URL,
      ].filter(Boolean);

      // dev: allow all, but reflect origin so credentials work
      if (
        allowedOrigins.includes(origin) ||
        (process.env.NODE_ENV || "development") !== "production"
      ) {
        return callback(null, origin);
      }

      // production: block unknown origins
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Request logging middleware (extra debug; yes it duplicates morgan output)
app.use((req, res, next) => {
  console.log(`📝 ${req.method} ${req.url}`);
  next();
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "Server is running",
    timestamp: new Date().toISOString(),
    database: process.env.DB_NAME,
  });
});

// API Routes - Express matches in order [web:264]
app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/articles", articleRoutes);
app.use("/api/warehouse", warehouseRoutes);
app.use("/api/reports", reportRoutes);

// SALES ROUTES
app.use("/api/sales", salesRoutes);
app.use("/api/sales-transactions", salesTransactionRoutes);

// Recommendations
app.use("/api/recommendations", recommendationsRoutes);

// Advisors
app.use("/api/advisors", advisorsRoutes);

// Stock audit (Trace endpoints)
app.use("/api/stock-audit", stockAuditRoutes);

app.use("/api/users", userRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/clients", clientsRoutes);

// Error handling middleware (must have 4 args)
app.use((err, req, res, next) => {
  console.error("❌ Error:", err?.message, err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || "Internal Server Error",
      status: err.status || 500,
    },
  });
});

// 404 handler - Must be last
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({
    error: {
      message: "Route not found",
      status: 404,
      path: req.url,
      method: req.method,
    },
  });
});

// Start server
const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                      🚀 Server is running!                 ║
║   📍 Port: ${PORT}                                         ║
║   🌍 Environment: ${process.env.NODE_ENV || "development"}  ║
║   🌐 CORS: Enabled                                         ║
╚════════════════════════════════════════════════════════════╝
`);
  });
}

module.exports = app;
