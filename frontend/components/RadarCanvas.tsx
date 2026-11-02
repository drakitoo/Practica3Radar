"use client";

import { useEffect, useRef } from "react";

export type RadarTarget = {
  angle: number;
  distance: number;
  seenAt: number;
};

type Props = {
  targets: RadarTarget[];
};

export default function RadarCanvas({ targets }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetsRef = useRef(targets);

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let sweep = 0;
    let animation = 0;
    const resize = new ResizeObserver(() => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.max(1, Math.floor(width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    });
    resize.observe(canvas);

    const draw = (time: number) => {
      animation = requestAnimationFrame(draw);
      if (time - frame < 32) return;
      frame = time;

      context.clearRect(0, 0, width, height);
      const centerX = width / 2;
      const centerY = height - 22;
      const radius = Math.max(0, Math.min(width * 0.47, height - 34));
      if (!radius) return;

      context.lineWidth = 1;
      for (let ring = 1; ring <= 4; ring += 1) {
        const ringRadius = (radius * ring) / 4;
        context.beginPath();
        context.arc(centerX, centerY, ringRadius, Math.PI, Math.PI * 2);
        context.strokeStyle = "rgba(83, 217, 232, 0.17)";
        context.stroke();
        context.fillStyle = "rgba(160, 191, 194, 0.65)";
        context.font = "9px ui-monospace, monospace";
        context.fillText(`${ring * 25} cm`, centerX + 7, centerY - ringRadius + 12);
      }

      for (const tick of [0, 30, 60, 90, 120, 150, 180]) {
        const angle = Math.PI + (tick * Math.PI) / 180;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.lineTo(x, y);
        context.strokeStyle = tick === 90
          ? "rgba(163, 255, 111, 0.2)"
          : "rgba(83, 217, 232, 0.11)";
        context.stroke();
        context.fillStyle = "#71868b";
        context.font = "10px ui-monospace, monospace";
        context.textAlign = tick < 90 ? "left" : tick > 90 ? "right" : "center";
        context.fillText(`${tick}°`, centerX + Math.cos(angle) * (radius + 15), centerY + Math.sin(angle) * (radius + 15) + 3);
      }

      const sweepAngle = Math.PI + (sweep * Math.PI) / 180;
      const gradient = context.createRadialGradient(centerX, centerY, 8, centerX, centerY, radius);
      gradient.addColorStop(0, "rgba(163, 255, 111, 0.18)");
      gradient.addColorStop(1, "rgba(163, 255, 111, 0)");
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.arc(centerX, centerY, radius, Math.PI, sweepAngle);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(centerX + Math.cos(sweepAngle) * radius, centerY + Math.sin(sweepAngle) * radius);
      context.strokeStyle = "#a3ff6f";
      context.shadowColor = "#a3ff6f";
      context.shadowBlur = 12;
      context.lineWidth = 2;
      context.stroke();
      context.shadowBlur = 0;

      const now = Date.now();
      for (const target of targetsRef.current) {
        const age = now - target.seenAt;
        if (age > 12000 || target.distance <= 0) continue;
        const angle = Math.PI + (target.angle * Math.PI) / 180;
        const targetRadius = Math.min(target.distance, 100) / 100 * radius;
        const x = centerX + Math.cos(angle) * targetRadius;
        const y = centerY + Math.sin(angle) * targetRadius;
        const opacity = Math.max(0.25, 1 - age / 12000);
        context.beginPath();
        context.arc(x, y, 4, 0, Math.PI * 2);
        context.fillStyle = `rgba(255, 101, 111, ${opacity})`;
        context.shadowColor = "#ff656f";
        context.shadowBlur = 12;
        context.fill();
        context.shadowBlur = 0;
      }

      context.beginPath();
      context.arc(centerX, centerY, 4, 0, Math.PI * 2);
      context.fillStyle = "#a3ff6f";
      context.fill();
      sweep = (sweep + 1.15) % 181;
    };

    animation = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animation);
      resize.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="radar-canvas"
      role="img"
      aria-label="Radar semicircular animado de 180 grados"
    />
  );
}
