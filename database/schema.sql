CREATE TABLE IF NOT EXISTS detecciones (
    id BIGSERIAL PRIMARY KEY,
    angulo SMALLINT NOT NULL CHECK (angulo BETWEEN 0 AND 180),
    distancia_cm NUMERIC(7, 2) NOT NULL CHECK (distancia_cm BETWEEN 0 AND 500),
    detectado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS detecciones_detectado_en_idx
    ON detecciones (detectado_en DESC);

CREATE TABLE IF NOT EXISTS alertas (
    id BIGSERIAL PRIMARY KEY,
    deteccion_id BIGINT REFERENCES detecciones (id) ON DELETE SET NULL,
    mensaje TEXT NOT NULL,
    distancia_cm NUMERIC(7, 2) NOT NULL,
    angulo SMALLINT NOT NULL CHECK (angulo BETWEEN 0 AND 180),
    led BOOLEAN NOT NULL DEFAULT FALSE,
    buzzer BOOLEAN NOT NULL DEFAULT FALSE,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alertas_creada_en_idx
    ON alertas (creada_en DESC);

CREATE TABLE IF NOT EXISTS eventos (
    id BIGSERIAL PRIMARY KEY,
    tipo VARCHAR(80) NOT NULL,
    detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eventos_creado_en_idx
    ON eventos (creado_en DESC);

CREATE TABLE IF NOT EXISTS configuracion (
    clave VARCHAR(80) PRIMARY KEY,
    valor JSONB NOT NULL,
    actualizada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO configuracion (clave, valor)
VALUES (
    'alertas',
    '{"distancia_cm":40,"angulo_inicio":0,"angulo_fin":180,"led":true,"buzzer":true}'::jsonb
)
ON CONFLICT (clave) DO NOTHING;
