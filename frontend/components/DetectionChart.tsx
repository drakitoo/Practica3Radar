"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartPoint = {
  hora: string;
  detecciones: number;
};

export default function DetectionChart({ data }: { data: ChartPoint[] }) {
  if (!data.length) {
    return <div className="chart-empty">Aún no hay estadísticas para mostrar.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid stroke="rgba(146, 169, 172, .12)" vertical={false} />
        <XAxis
          dataKey="hora"
          tick={{ fill: "#71868b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: "#71868b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: "#101e23",
            border: "1px solid rgba(163,255,111,.18)",
            borderRadius: 10,
            color: "#eaf2ef",
            fontSize: 12,
          }}
          labelStyle={{ color: "#9bb0b1" }}
        />
        <Line
          type="monotone"
          dataKey="detecciones"
          name="Detecciones"
          stroke="#a3ff6f"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#a3ff6f", stroke: "#071014", strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
