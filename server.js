require("dotenv").config();

const http = require("node:http");
const express = require("express");
const { Pool } = require("pg");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 8080);
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.PGHOST || undefined,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE || undefined,
  user: process.env.PGUSER || undefined,
  password: process.env.PGPASSWORD || undefined,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined,
});
pool.on("error", (error) => {
  console.error("Error inesperado en el pool de PostgreSQL:", error.message);
});

const app = express();
const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ server: httpServer });
app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && FRONTEND_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

let esp32 = null;
let lastReading = null;
const connectedBrowsers = new Set();

function validReading(message) {
  return Number.isFinite(message.angulo) &&
    message.angulo >= 0 &&
    message.angulo <= 180 &&
    Number.isFinite(message.distancia) &&
    message.distancia >= 0 &&
    message.distancia <= 500;
}

function sendToBrowsers(message) {
  const payload = JSON.stringify(message);
  for (const browser of connectedBrowsers) {
    if (!browser.isEsp32 && browser.readyState === WebSocket.OPEN) {
      browser.send(payload);
    }
  }
}

async function getConfig() {
  const { rows } = await pool.query(
    "SELECT valor FROM configuracion WHERE clave = 'alertas'"
  );
  return rows[0]?.valor || {
    distancia_cm: 40,
    angulo_inicio: 0,
    angulo_fin: 180,
    led: true,
    buzzer: true,
  };
}

async function persistReading(reading) {
  const { rows } = await pool.query(
    `INSERT INTO detecciones (angulo, distancia_cm, detectado_en)
     VALUES ($1, $2, NOW()) RETURNING id, angulo, distancia_cm, detectado_en`,
    [reading.angulo, reading.distancia]
  );
  const detection = rows[0];
  const config = await getConfig();
  const alertActive =
    reading.distancia > 0 &&
    reading.distancia <= Number(config.distancia_cm) &&
    reading.angulo >= Number(config.angulo_inicio) &&
    reading.angulo <= Number(config.angulo_fin);

  if (alertActive) {
    const alert = await pool.query(
      `INSERT INTO alertas (deteccion_id, mensaje, distancia_cm, angulo, led, buzzer)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, mensaje, distancia_cm, angulo, creada_en`,
      [
        detection.id,
        `Objeto dentro de la zona de alerta (${reading.distancia} cm)`,
        reading.distancia,
        reading.angulo,
        config.led === true,
        config.buzzer === true,
      ]
    );
    sendToBrowsers({ tipo: "alerta", alerta: alert.rows[0] });
  }
  return { detection, config, alertActive };
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ estado: "ok", base_datos: "conectada" });
  } catch (error) {
    console.error("No se pudo consultar PostgreSQL:", error.message);
    res.status(503).json({ estado: "error", base_datos: "desconectada" });
  }
});

app.get("/api/status", (_req, res) => {
  res.json({
    servidor: "conectado",
    esp32: Boolean(esp32 && esp32.readyState === WebSocket.OPEN),
    navegadores: connectedBrowsers.size,
    ultima_lectura: lastReading,
  });
});

app.get("/api/detections", async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  try {
    const result = await pool.query(
      `SELECT id, angulo, distancia_cm, detectado_en
       FROM detecciones ORDER BY detectado_en DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ detecciones: result.rows, limit, offset });
  } catch (error) {
    console.error("Error consultando detecciones:", error.message);
    res.status(500).json({ error: "No se pudo consultar el historial." });
  }
});

app.get("/api/alerts", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, mensaje, distancia_cm, angulo, led, buzzer, creada_en
       FROM alertas ORDER BY creada_en DESC LIMIT 100`
    );
    res.json({ alertas: rows });
  } catch (error) {
    console.error("Error consultando alertas:", error.message);
    res.status(500).json({ error: "No se pudieron consultar las alertas." });
  }
});

app.get("/api/stats", async (_req, res) => {
  try {
    const [summary, chart, alerts] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
          COALESCE(AVG(distancia_cm), 0)::float AS distancia_media,
          MIN(distancia_cm)::float AS distancia_minima
         FROM detecciones WHERE detectado_en >= NOW() - INTERVAL '24 hours'`
      ),
      pool.query(
        `SELECT date_trunc('hour', detectado_en) AS hora, COUNT(*)::int AS detecciones
         FROM detecciones WHERE detectado_en >= NOW() - INTERVAL '24 hours'
         GROUP BY hora ORDER BY hora`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM alertas
         WHERE creada_en >= NOW() - INTERVAL '24 hours'`
      ),
    ]);
    res.json({
      resumen: { ...summary.rows[0], alertas: alerts.rows[0].total },
      grafica: chart.rows,
    });
  } catch (error) {
    console.error("Error consultando estadísticas:", error.message);
    res.status(500).json({ error: "No se pudieron consultar las estadísticas." });
  }
});

app.get("/api/config", async (_req, res) => {
  try {
    res.json({ alertas: await getConfig() });
  } catch (error) {
    console.error("Error consultando configuración:", error.message);
    res.status(500).json({ error: "No se pudo consultar la configuración." });
  }
});

app.put("/api/config", async (req, res) => {
  const config = req.body?.alertas;
  if (
    !config ||
    !Number.isFinite(config.distancia_cm) ||
    config.distancia_cm < 1 ||
    config.distancia_cm > 500 ||
    !Number.isInteger(config.angulo_inicio) ||
    !Number.isInteger(config.angulo_fin) ||
    config.angulo_inicio < 0 ||
    config.angulo_fin > 180 ||
    config.angulo_inicio > config.angulo_fin ||
    typeof config.led !== "boolean" ||
    typeof config.buzzer !== "boolean"
  ) {
    return res.status(400).json({ error: "Configuración de alerta inválida." });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO configuracion (clave, valor, actualizada_en)
       VALUES ('alertas', $1::jsonb, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizada_en = NOW()
       RETURNING valor`,
      [JSON.stringify(config)]
    );
    if (esp32 && esp32.readyState === WebSocket.OPEN) {
      esp32.send(JSON.stringify({ tipo: "alerta_configuracion", ...config }));
    }
    await pool.query(
      "INSERT INTO eventos (tipo, detalle) VALUES ($1, $2::jsonb)",
      ["configuracion_actualizada", JSON.stringify(config)]
    );
    res.json({ alertas: rows[0].valor });
  } catch (error) {
    console.error("Error guardando configuración:", error.message);
    res.status(500).json({ error: "No se pudo guardar la configuración." });
  }
});

app.post("/api/commands/servo", (req, res) => {
  const { angulo } = req.body || {};
  if (!Number.isInteger(angulo) || angulo < 0 || angulo > 180) {
    return res.status(400).json({ error: "El ángulo debe ser un entero entre 0 y 180." });
  }
  return sendServoCommand({ tipo: "servo", angulo }, res);
});

app.post("/api/commands/mode", (req, res) => {
  const { modo } = req.body || {};
  if (modo !== "automatico" && modo !== "manual") {
    return res.status(400).json({ error: "El modo debe ser 'automatico' o 'manual'." });
  }
  return sendServoCommand({ tipo: "modo", modo }, res);
});

function sendServoCommand(command, res) {
  if (!esp32 || esp32.readyState !== WebSocket.OPEN) {
    return res.status(503).json({ error: "ESP32 no conectado." });
  }
  esp32.send(JSON.stringify(command));
  pool.query("INSERT INTO eventos (tipo, detalle) VALUES ($1, $2::jsonb)", [
    "comando_hardware",
    JSON.stringify(command),
  ]).catch((error) => console.error("Error guardando evento de comando:", error.message));
  return res.json({ enviado: true, comando: command });
}

function isValidControlMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.tipo === "servo") {
    return Number.isInteger(message.angulo) && message.angulo >= 0 && message.angulo <= 180;
  }
  return message.tipo === "modo" &&
    (message.modo === "automatico" || message.modo === "manual");
}

wss.on("connection", (cliente, req) => {
  cliente.isEsp32 = false;
  connectedBrowsers.add(cliente);
  const remoteAddress = req.socket.remoteAddress;
  console.log("Nuevo cliente WebSocket:", remoteAddress);
  cliente.send(JSON.stringify({
    tipo: "estado",
    esp32: Boolean(esp32 && esp32.readyState === WebSocket.OPEN),
  }));

  cliente.on("message", async (datos) => {
    let mensaje;
    try {
      mensaje = JSON.parse(datos.toString());
    } catch {
      cliente.send(JSON.stringify({ tipo: "error", mensaje: "JSON inválido." }));
      return;
    }

    if (
      !cliente.isEsp32 &&
      mensaje.tipo === "identificacion" &&
      mensaje.dispositivo === "esp32"
    ) {
      if (esp32 && esp32 !== cliente && esp32.readyState === WebSocket.OPEN) {
        esp32.close(1008, "Dispositivo reemplazado");
      }
      cliente.isEsp32 = true;
      connectedBrowsers.delete(cliente);
      esp32 = cliente;
      console.log("ESP32 conectado usando el protocolo compatible actual");
      sendToBrowsers({
        tipo: "estado",
        esp32: true,
      });
      return;
    }

    if (cliente.isEsp32 && mensaje.tipo === "lectura") {
      if (!validReading(mensaje)) {
        cliente.send(JSON.stringify({ tipo: "error", mensaje: "Lectura inválida." }));
        return;
      }
      const reading = {
        tipo: "lectura",
        angulo: mensaje.angulo,
        distancia: mensaje.distancia,
        timestamp: new Date().toISOString(),
      };
      lastReading = reading;
      console.log(`Angulo: ${reading.angulo}° | Distancia: ${reading.distancia} cm`);
      sendToBrowsers(reading);
      try {
        const persisted = await persistReading(reading);
        sendToBrowsers({
          tipo: "deteccion_guardada",
          deteccion: persisted.detection,
          alerta_activa: persisted.alertActive,
        });
      } catch (error) {
        console.error("No se pudo guardar la lectura en PostgreSQL:", error.message);
        sendToBrowsers({ tipo: "error", mensaje: "No se pudo guardar una detección." });
      }
      return;
    }

    if (!cliente.isEsp32 && isValidControlMessage(mensaje)) {
      if (!esp32 || esp32.readyState !== WebSocket.OPEN) {
        cliente.send(JSON.stringify({ tipo: "error", mensaje: "ESP32 no conectado." }));
      } else {
        esp32.send(JSON.stringify(mensaje));
        cliente.send(JSON.stringify({ tipo: "comando_enviado", comando: mensaje }));
      }
      return;
    }

    cliente.send(JSON.stringify({ tipo: "error", mensaje: "Mensaje no válido." }));
  });

  cliente.on("close", () => {
    connectedBrowsers.delete(cliente);
    if (cliente === esp32) {
      esp32 = null;
      console.log("ESP32 desconectado");
      sendToBrowsers({ tipo: "estado", esp32: false });
    } else {
      console.log("Cliente WebSocket desconectado");
    }
  });
  cliente.on("error", (error) => console.error("Error de conexión:", error.message));
});

async function start() {
  await pool.query("SELECT 1");
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log("====================================");
    console.log("       RADAR WEBSOCKET SERVER       ");
    console.log("====================================");
    console.log(`API REST y WebSocket en puerto ${PORT}`);
    console.log("PostgreSQL conectado; esperando conexiones...");
  });
}

start().catch((error) => {
  console.error("No se pudo iniciar el servidor. Verifica PostgreSQL y el archivo .env:", error.message);
  process.exitCode = 1;
});

async function shutdown() {
  wss.close();
  httpServer.close();
  await pool.end();
}

process.on("SIGINT", () => shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => shutdown().finally(() => process.exit(0)));
