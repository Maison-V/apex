"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Badge } from "@/components/ui/badge";

interface KpiCardProps {
  label: string;
  value: number;
  formatter?: (value: number) => string;
  delta?: number;
  deltaFormatter?: (value: number) => string;
  status?: "up" | "down" | "flat";
  hint?: string;
}

export function KpiCard({
  label,
  value,
  formatter,
  delta,
  deltaFormatter,
  status,
  hint,
}: KpiCardProps) {
  const s = status ?? (delta == null ? "flat" : delta >= 0 ? "up" : "down");
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className="glass-card"
    >
      <Card className="h-full">
        <CardHeader>
          <span className="eyebrow-label">{label}</span>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "kpi-value text-[28px] leading-tight text-text-primary",
              s === "up" && "text-buy",
              s === "down" && "text-sell"
            )}
          >
            <AnimatedNumber value={value} formatter={formatter} />
          </div>
          {(delta != null || hint) && (
            <div className="mt-2 flex items-center gap-2">
              {delta != null && (
                <Badge variant={s === "up" ? "buy" : s === "down" ? "sell" : "muted"}>
                  {deltaFormatter ? deltaFormatter(delta) : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`}
                </Badge>
              )}
              {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}