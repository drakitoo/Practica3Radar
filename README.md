# RADAR CENTINELA IoT

Backend Express/WebSocket para el radar ESP32 y dashboard Next.js. El backend
usa PostgreSQL; no guarda detecciones en memoria como sustituto de la base.

## Backend

1. Copia `.env.example` a `.env` y ajusta la conexión a PostgreSQL.
2. Ejecuta `database/schema.sql` en la base `radar_centinela` desde pgAdmin 4.
3. Ejecuta `npm install` y `npm start`.

La API REST y WebSocket comparten el puerto `8080`. `GET /api/health` informa
del estado de PostgreSQL.

**No hay registro ni inicio de sesión.** El dashboard, la API y los comandos
del servo son públicos para cualquier equipo que pueda alcanzar el servidor.
Limita el puerto con un firewall o mantenlo en una red privada de confianza;
`FRONTEND_ORIGINS` configura CORS, pero no es un mecanismo de autenticación ni
impide llamadas directas.

El hardware esperado es ESP32, sensor HC-SR04 (TRIG GPIO 26 y ECHO GPIO 27,
con divisor de voltaje en ECHO) y servo SG90 en GPIO 18.

## Protocolo del ESP32

El protocolo WebSocket actual permanece compatible:

- Identificación: `{"tipo":"identificacion","dispositivo":"esp32"}`
- Lectura: `{"tipo":"lectura","angulo":90,"distancia":42.5}`
- El servidor retransmite cada lectura a todos los navegadores conectados.
- Los comandos `{"tipo":"servo","angulo":90}` y
  `{"tipo":"modo","modo":"manual"}` conservan su forma y son reenviados al ESP32.

No se requiere autenticación para el dashboard, WebSocket ni API. Un navegador
puede enviar los comandos de servo/mode directamente. Publica el servidor solo
en una red donde todos los usuarios puedan controlar el hardware.

**Limitación de compatibilidad:** el protocolo legado no autentica al ESP32.
Por tanto, el servidor conserva la conexión actual y valida el formato/rangos
de sus lecturas, pero un cliente que imite la identificación aún podría
suplantar el dispositivo. Para autenticarlo hace falta actualizar el firmware
con un secreto/token dedicado y validarlo durante la identificación; no se
puede añadir autenticación del dispositivo sin cambiar ese protocolo.

La configuración persistida de alertas incluye distancia, sector angular, LED y
buzzer. El backend envía al dispositivo el mensaje adicional
`{"tipo":"alerta_configuracion","distancia_cm":40,"angulo_inicio":0,"angulo_fin":180,"led":true,"buzzer":true}`.
El firmware actual puede ignorarlo sin afectar las lecturas ni el servo. Para
que el LED/buzzer físicos sigan esa configuración, el firmware debe procesar
ese mensaje y activar las salidas correspondientes.

## Frontend

En `frontend`, copia `.env.example` a `.env.local`, ejecuta `npm install` y usa
`npm run dev`. Para producción, configura `NEXT_PUBLIC_API_URL` con la URL
pública del backend y `NEXT_PUBLIC_WS_URL` con su URL WebSocket. Ambas son URLs
públicas; no configures credenciales en variables `NEXT_PUBLIC_*`.
