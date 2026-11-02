"use client";

import {
  Activity,
  AlertTriangle,
  AudioLines,
  BellRing,
  ChevronDown,
  CircleHelp,
  Crosshair,
  Gauge,
  LayoutDashboard,
  Radar,
  Radio,
  Save,
  Settings2,
  SlidersHorizontal,
  Target,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import DetectionChart, { ChartPoint } from "../components/DetectionChart";
import RadarCanvas, { RadarTarget } from "../components/RadarCanvas";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(/\/$/, "");
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";

type Detection = {
  id: string | number;
  angulo: number;
  distancia_cm: number | string;
  detectado_en: string;
};

type Alert = {
  id: string | number;
  mensaje: string;
  distancia_cm: number | string;
  angulo: number;
  led: boolean;
  buzzer: boolean;
  creada_en: string;
};

type AlertConfig = {
  distancia_cm: number;
  angulo_inicio: number;
  angulo_fin: number;
  led: boolean;
  buzzer: boolean;
};

type Reading = {
  tipo: "lectura";
  angulo: number;
  distancia: number;
  timestamp?: string;
};

type Stats = {
  resumen: {
    total: number;
    distancia_media: number;
    distancia_minima: number | null;
    alertas: number;
  };
  grafica: { hora: string; detecciones: number }[];
};

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Error del servidor (${response.status}).`);
  }
  return body as T;
}

function formatTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDistance(value: number | string) {
  const distance = Number(value);
  return Number.isFinite(distance) ? `${distance.toFixed(1)} cm` : "—";
}

export default function DashboardPage() {
  const [error, setError] = useState("");
  const [serverOnline, setServerOnline] = useState(false);
  const [databaseOnline, setDatabaseOnline] = useState(false);
  const [esp32Online, setEsp32Online] = useState(false);
  const [socketOnline, setSocketOnline] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [targets, setTargets] = useState<RadarTarget[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<AlertConfig>({
    distancia_cm: 40,
    angulo_inicio: 0,
    angulo_fin: 180,
    led: true,
    buzzer: true,
  });
  const [manualAngle, setManualAngle] = useState(90);
  const [requestedMode, setRequestedMode] = useState<"automatico" | "manual" | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  const chartData = useMemo<ChartPoint[]>(
    () =>
      (stats?.grafica || []).map((point) => ({
        hora: new Date(point.hora).toLocaleTimeString("es", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        detecciones: point.detecciones,
      })),
    [stats],
  );

  const refreshDashboard = useCallback(async () => {
    try {
      const [healthResponse, status, history, statsResponse, alertsResponse, configResponse] =
        await Promise.all([
          fetch(`${API_URL}/api/health`, { cache: "no-store" }),
          request<{ esp32: boolean }>("/api/status"),
          request<{ detecciones: Detection[] }>("/api/detections?limit=8"),
          request<Stats>("/api/stats"),
          request<{ alertas: Alert[] }>("/api/alerts"),
          request<{ alertas: AlertConfig }>("/api/config"),
        ]);
      const health = await healthResponse.json();
      setServerOnline(healthResponse.ok);
      setDatabaseOnline(health.base_datos === "conectada");
      setEsp32Online(status.esp32);
      setDetections(history.detecciones);
      setStats(statsResponse);
      setAlerts(alertsResponse.alertas);
      setConfig(configResponse.alertas);
      setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo actualizar el panel.";
      setError(message);
    }
  }, []);

  useEffect(() => {
    void refreshDashboard();
    const timer = window.setInterval(() => void refreshDashboard(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshDashboard]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (!active) return;
      socket = new WebSocket(WS_URL);
      socket.onopen = () => {
        setSocketOnline(true);
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.tipo === "estado") {
            setEsp32Online(Boolean(message.esp32));
          } else if (message.tipo === "lectura") {
            const liveReading = message as Reading;
            setReading(liveReading);
            setTargets((current) => [
              ...current.filter(
                (target) => Date.now() - target.seenAt < 12000,
              ),
              {
                angle: liveReading.angulo,
                distance: liveReading.distancia,
                seenAt: Date.now(),
              },
            ].slice(-24));
          } else if (message.tipo === "alerta" && message.alerta) {
            setAlerts((current) => [message.alerta as Alert, ...current].slice(0, 100));
          } else if (message.tipo === "error") {
            setActionMessage(message.mensaje || "Error en la conexión en tiempo real.");
          }
        } catch {
          setActionMessage("Se recibió un mensaje WebSocket con formato inválido.");
        }
      };
      socket.onclose = () => {
        setSocketOnline(false);
        if (active) reconnectTimer = window.setTimeout(connect, 2500);
      };
      socket.onerror = () => {
        setSocketOnline(false);
        socket?.close();
      };
    };

    connect();
    return () => {
      active = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  async function sendCommand(path: string, payload: object, success: string): Promise<boolean> {
    setActionMessage("");
    try {
      await request(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setActionMessage(success);
      return true;
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : "No se pudo enviar el comando.");
      return false;
    }
  }

  async function updateMode(mode: "automatico" | "manual") {
    if (await sendCommand("/api/commands/mode", { modo: mode }, `Modo ${mode} solicitado.`)) {
      setRequestedMode(mode);
    }
  }

  async function saveAlertConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionMessage("");
    try {
      const result = await request<{ alertas: AlertConfig }>("/api/config", {
        method: "PUT",
        body: JSON.stringify({ alertas: config }),
      });
      setConfig(result.alertas);
      setActionMessage("Configuración de alerta guardada.");
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : "No se pudo guardar la configuración.");
    }
  }

  return (
    <main className="dashboard-shell">
      <aside className={`sidebar ${navOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Radar size={23} /></div>
          <div><strong>RADAR</strong><span>CENTINELA IoT</span></div>
          <button className="mobile-close" onClick={() => setNavOpen(false)} aria-label="Cerrar navegación">×</button>
        </div>
        <div className="workspace-label">PLATAFORMA</div>
        <nav className="side-nav">
          <a className="nav-item active" href="#overview" onClick={() => setNavOpen(false)}><LayoutDashboard size={17} /> Vista general</a>
          <a className="nav-item" href="#radar-panel" onClick={() => setNavOpen(false)}><Crosshair size={17} /> Radar en vivo</a>
          <a className="nav-item" href="#history" onClick={() => setNavOpen(false)}><Activity size={17} /> Historial</a>
          <a className="nav-item" href="#alert-settings" onClick={() => setNavOpen(false)}><Settings2 size={17} /> Configuración</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="system-card">
            <div className="system-card-title"><span className={`status-dot ${serverOnline ? "online" : ""}`} /> Estado del sistema</div>
            <div className="system-row"><span>Servidor API</span><strong>{serverOnline ? "En línea" : "Sin conexión"}</strong></div>
            <div className="system-row"><span>Base de datos</span><strong>{databaseOnline ? "Conectada" : "Sin conexión"}</strong></div>
            <div className="system-row"><span>Canal WebSocket</span><strong>{socketOnline ? "Activo" : "Inactivo"}</strong></div>
          </div>
          <div className="sidebar-version">RADAR OS <span>v1.0.0</span></div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setNavOpen(true)} aria-label="Abrir navegación">☰</button>
          <div className="breadcrumb">Plataforma <span>/</span> <strong>Vista general</strong></div>
          <div className="topbar-right">
            <div className="live-indicator"><span className={`status-dot ${socketOnline ? "online" : ""}`} /> {socketOnline ? "EN TIEMPO REAL" : "SINCRONIZANDO"}</div>
            <div className="avatar">RC</div>
            <ChevronDown size={14} className="muted-icon" />
          </div>
        </header>

        <div className="dashboard-content" id="overview">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CENTRO DE MONITOREO <span>·</span> {new Date().toLocaleDateString("es", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase()}</p>
              <h1>Vista general</h1>
              <p className="subheading">Lecturas y estado operativo del radar en tiempo real.</p>
            </div>
            <div className={`device-pill ${esp32Online ? "device-connected" : ""}`}>
              <span className={`status-dot ${esp32Online ? "online" : ""}`} />
              <div><strong>ESP32</strong><small>{esp32Online ? "Dispositivo conectado" : "Esperando dispositivo"}</small></div>
              <Wifi size={16} />
            </div>
          </div>

          {(error || actionMessage) && (
            <div className={`notice ${error ? "notice-error" : ""}`} role="status">
              {error ? <AlertTriangle size={16} /> : <CircleHelp size={16} />}
              <span>{error || actionMessage}</span>
              <button onClick={() => { setError(""); setActionMessage(""); }} aria-label="Cerrar aviso">×</button>
            </div>
          )}

          <section className="stats-grid" aria-label="Estadísticas">
            <article className="stat-card">
              <div className="stat-top"><span>Detecciones · 24 h</span><div className="stat-icon green"><Target size={17} /></div></div>
              <div className="stat-value">{stats?.resumen.total ?? "—"}</div>
              <div className="stat-foot"><span className="stat-caption">Registros en PostgreSQL</span><span className="stat-unit">EVENTOS</span></div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Distancia mínima</span><div className="stat-icon cyan"><Gauge size={17} /></div></div>
              <div className="stat-value">{stats?.resumen.total ? <>{Number(stats.resumen.distancia_minima).toFixed(1)}<small> cm</small></> : "—"}</div>
              <div className="stat-foot"><span className="stat-caption">Últimas 24 horas</span><span className="stat-unit">RANGO</span></div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Alertas activadas · 24 h</span><div className="stat-icon amber"><BellRing size={17} /></div></div>
              <div className="stat-value">{stats?.resumen.alertas ?? "—"}</div>
              <div className="stat-foot"><span className="stat-caption">Según zona configurada</span><span className="stat-unit">ALERTAS</span></div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Último objetivo</span><div className="stat-icon red"><Radio size={17} /></div></div>
              <div className="stat-value">{reading ? `${reading.angulo}°` : "—"}</div>
              <div className="stat-foot"><span className="stat-caption">{reading ? formatDistance(reading.distancia) : "Sin telemetría recibida"}</span><span className="stat-unit">{reading ? formatTime(reading.timestamp) : "EN ESPERA"}</span></div>
            </article>
          </section>

          <section className="primary-grid">
            <article className="panel radar-panel" id="radar-panel">
              <div className="panel-heading">
                <div><div className="panel-title-row"><Crosshair size={17} /><h2>Radar en vivo</h2></div><p>Exploración del campo · 0° — 180°</p></div>
                <span className={`live-tag ${socketOnline ? "" : "live-tag-muted"}`}><i /> {socketOnline ? "EN DIRECTO" : "DESCONECTADO"}</span>
              </div>
              <div className="radar-stage"><RadarCanvas targets={targets} /></div>
              <div className="radar-readout">
                <div><span className="readout-label">ÁNGULO</span><strong>{reading ? `${reading.angulo}°` : "—"}</strong></div>
                <div><span className="readout-label">DISTANCIA</span><strong>{reading ? formatDistance(reading.distancia) : "—"}</strong></div>
                <div><span className="readout-label">SEÑAL</span><strong className={socketOnline ? "signal-good" : "signal-off"}>{socketOnline ? "ESTABLE" : "SIN SEÑAL"}</strong></div>
              </div>
            </article>

            <article className="panel controls-panel">
              <div className="panel-heading">
                <div><div className="panel-title-row"><SlidersHorizontal size={17} /><h2>Control del servo</h2></div><p>Control remoto del barrido</p></div>
                <span className="control-chip"><Zap size={13} /> {requestedMode ? `SOLICITADO: ${requestedMode.toUpperCase()}` : "MODO SIN CONFIRMAR"}</span>
              </div>
              <div className="mode-label">MODO DE OPERACIÓN</div>
              <div className="mode-switch">
                <button className={requestedMode === "automatico" ? "mode-active" : ""} onClick={() => void updateMode("automatico")} disabled={!esp32Online}>Automático</button>
                <button className={requestedMode === "manual" ? "mode-active" : ""} onClick={() => void updateMode("manual")} disabled={!esp32Online}>Manual</button>
              </div>
              <div className="servo-heading"><span>Posición manual</span><strong>{manualAngle}°</strong></div>
              <input className="angle-slider" aria-label="Ángulo del servo de 0 a 180 grados" type="range" min="0" max="180" value={manualAngle} onChange={(event) => setManualAngle(Number(event.target.value))} disabled={!esp32Online || requestedMode !== "manual"} />
              <div className="slider-marks"><span>0°</span><span>90°</span><span>180°</span></div>
              <button className="primary-button servo-button" disabled={!esp32Online || requestedMode !== "manual"} onClick={() => void sendCommand("/api/commands/servo", { angulo: manualAngle }, `Posición ${manualAngle}° solicitada.`)}>
                <Crosshair size={15} /> Aplicar posición
              </button>
              <div className="control-foot"><AlertTriangle size={13} /> Control sin login: limita el acceso a una red privada.</div>
            </article>
          </section>

          <section className="secondary-grid">
            <article className="panel chart-panel" id="history">
              <div className="panel-heading">
                <div><div className="panel-title-row"><Activity size={17} /><h2>Actividad de detección</h2></div><p>Conteo de detecciones · últimas 24 horas</p></div>
                <span className="period-chip">24 HORAS <ChevronDown size={13} /></span>
              </div>
              <div className="chart-area"><DetectionChart data={chartData} /></div>
              <div className="chart-source"><span className="source-dot" /> Datos históricos de PostgreSQL</div>
            </article>

            <article className="panel alerts-panel">
              <div className="panel-heading">
                <div><div className="panel-title-row"><BellRing size={17} /><h2>Alertas recientes</h2></div><p>Actividad dentro de zona crítica</p></div>
                <span className="alert-count">{alerts.length}</span>
              </div>
              <div className="alert-list">
                {alerts.slice(0, 5).map((alert) => (
                  <div className="alert-item" key={alert.id}>
                    <div className="alert-symbol"><AlertTriangle size={15} /></div>
                    <div className="alert-content"><strong>{alert.mensaje}</strong><span>{formatDistance(alert.distancia_cm)} <i /> {alert.angulo}°</span></div>
                    <time>{formatTime(alert.creada_en)}</time>
                  </div>
                ))}
                {!alerts.length && <div className="empty-state"><BellRing size={21} /><span>No hay alertas registradas.</span></div>}
              </div>
            </article>
          </section>

          <section className="bottom-grid">
            <article className="panel history-panel">
              <div className="panel-heading">
                <div><div className="panel-title-row"><Radio size={17} /><h2>Historial de detecciones</h2></div><p>Últimos registros persistidos</p></div>
                <span className="table-count">{detections.length} registros</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>OBJETO</th><th>DISTANCIA</th><th>ÁNGULO</th><th>HORA</th><th>ESTADO</th></tr></thead>
                  <tbody>
                    {detections.map((detection) => (
                      <tr key={detection.id}>
                        <td><span className="object-cell"><span className="object-dot" /> Objetivo detectado</span></td>
                        <td>{formatDistance(detection.distancia_cm)}</td>
                        <td>{detection.angulo}°</td>
                        <td>{formatTime(detection.detectado_en)}</td>
                        <td><span className="detected-badge">REGISTRADO</span></td>
                      </tr>
                    ))}
                    {!detections.length && <tr><td colSpan={5} className="table-empty">No hay detecciones almacenadas todavía.</td></tr>}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel settings-panel" id="alert-settings">
              <div className="panel-heading">
                <div><div className="panel-title-row"><Settings2 size={17} /><h2>Zona de alerta</h2></div><p>Umbrales y periféricos</p></div>
                <span className="settings-badge">CONFIGURABLE</span>
              </div>
              <form className="settings-form" onSubmit={saveAlertConfig}>
                <label className="field-label" htmlFor="distance-limit">Distancia de activación <strong>{config.distancia_cm} cm</strong></label>
                <input id="distance-limit" className="angle-slider" type="range" min="1" max="200" value={config.distancia_cm} onChange={(event) => setConfig({ ...config, distancia_cm: Number(event.target.value) })} />
                <div className="range-pair">
                  <label>Ángulo inicial<input type="number" min="0" max="180" value={config.angulo_inicio} onChange={(event) => setConfig({ ...config, angulo_inicio: Number(event.target.value) })} /></label>
                  <label>Ángulo final<input type="number" min="0" max="180" value={config.angulo_fin} onChange={(event) => setConfig({ ...config, angulo_fin: Number(event.target.value) })} /></label>
                </div>
                <label className="toggle-row"><span><Zap size={15} /> Indicador LED</span><input type="checkbox" checked={config.led} onChange={(event) => setConfig({ ...config, led: event.target.checked })} /><i /></label>
                <label className="toggle-row"><span><AudioLines size={15} /> Buzzer de alerta</span><input type="checkbox" checked={config.buzzer} onChange={(event) => setConfig({ ...config, buzzer: event.target.checked })} /><i /></label>
                <button className="primary-button save-button" type="submit"><Save size={14} /> Guardar configuración</button>
              </form>
              <p className="settings-note"><CircleHelp size={13} /> La activación física requiere soporte en el firmware del ESP32.</p>
            </article>
          </section>

          <footer className="footer-note"><span>RADAR CENTINELA IoT</span><i /> Telemetría mostrada únicamente cuando llega desde el dispositivo <span className="footer-spacer" /> <WifiOff size={13} /> Puerto de gateway: 8080</footer>
        </div>
      </div>
      {navOpen && <button className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-label="Cerrar menú" />}
    </main>
  );
}
