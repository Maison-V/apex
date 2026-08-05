"use client";

import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  Layers,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { tradingService } from "@/services/tradingService";
import { getAllQuotes, getMarketMovers } from "@/services/marketService";
import { formatPrice, formatPct, formatMoney } from "@/lib/utils";

export default function Dashboard() {
  const balance = tradingService.getBalance();

  const quotesQuery = useQuery({
    queryKey: ["quotes"],
    queryFn: getAllQuotes,
    refetchInterval: 15_000,
  });

  const moversQuery = useQuery({
    queryKey: ["movers"],
    queryFn: getMarketMovers,
    refetchInterval: 15_000,
  });

  const quotes = quotesQuery.data ?? {};
  const movers = moversQuery.data;
  const quoteList = Object.values(quotes).filter(Boolean);
  const gainers = movers?.gainers ?? [];
  const losers = movers?.losers ?? [];
  const topGainer = gainers[0];
  const upCount = quoteList.filter((q) => (q.change_pct ?? 0) >= 0).length;
  const breadth = quoteList.length ? Math.round((upCount / quoteList.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="text-xl font-medium tracking-tight text-text-primary">Overview</h2>
        <p className="mt-1 text-sm text-text-muted">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}{" "}
          — markets across synthetics, forex, crypto, stocks and commodities.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Deriv balance"
          value={balance.balance}
          formatter={(v) => formatMoney(v, balance.currency)}
          hint={balance.loginid ? balance.loginid : "demo"}
        />
        <KpiCard
          label="Top gainer"
          value={topGainer?.percent_change ?? 0}
          formatter={(v) => formatPct(v)}
          hint={topGainer?.symbol ?? "—"}
          status="up"
        />
        <KpiCard
          label="Market breadth"
          value={breadth}
          formatter={(v) => `${v}%`}
          hint={`${upCount}/${quoteList.length} symbols up`}
          status={breadth >= 50 ? "up" : "down"}
        />
        <KpiCard
          label="Tracked symbols"
          value={quoteList.length}
          hint="live feed"
        />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel heading="Quotes" icon={Layers}>
            <div className="apex-scroll max-h-[420px] overflow-y-auto pr-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg-surface">
                  <tr className="eyebrow-label text-left">
                    <th className="pb-2 font-normal">Symbol</th>
                    <th className="pb-2 text-right font-normal">Price</th>
                    <th className="pb-2 text-right font-normal">Change</th>
                    <th className="pb-2 text-right font-normal">High</th>
                    <th className="pb-2 text-right font-normal">Low</th>
                  </tr>
                </thead>
                <tbody>
                  {quoteList.map((q) => {
                    const pct = q.change_pct ?? 0;
                    return (
                      <tr key={q.symbol} className="border-t border-border-default">
                        <td className="py-2.5 font-mono text-xs text-text-primary">{q.symbol}</td>
                        <td className="py-2.5 text-right font-mono text-xs text-text-primary">
                          {formatPrice(q.price, q.price < 10 ? 4 : 2)}
                        </td>
                        <td className="py-2.5 text-right">
                          <span
                            className={`font-mono text-xs ${pct >= 0 ? "text-buy" : "text-sell"}`}
                          >
                            {formatPct(pct)}
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-mono text-xs text-text-muted">
                          {formatPrice(q.high, q.price < 10 ? 4 : 2)}
                        </td>
                        <td className="py-2.5 text-right font-mono text-xs text-text-muted">
                          {formatPrice(q.low, q.price < 10 ? 4 : 2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel heading="Top gainers" icon={TrendingUp}>
            <ul className="flex flex-col gap-2.5">
              {gainers.slice(0, 5).map((m) => (
                <li key={m.symbol} className="flex items-center justify-between">
                  <span className="font-mono text-xs text-text-secondary">{m.symbol}</span>
                  <Badge variant="buy">{formatPct(m.percent_change)}</Badge>
                </li>
              ))}
              {gainers.length === 0 && (
                <li className="text-xs text-text-muted">Loading movers…</li>
              )}
            </ul>
          </Panel>
          <Panel heading="Top losers" icon={TrendingDown}>
            <ul className="flex flex-col gap-2.5">
              {losers.slice(0, 5).map((m) => (
                <li key={m.symbol} className="flex items-center justify-between">
                  <span className="font-mono text-xs text-text-secondary">{m.symbol}</span>
                  <Badge variant="sell">{formatPct(m.percent_change)}</Badge>
                </li>
              ))}
              {losers.length === 0 && (
                <li className="text-xs text-text-muted">Loading movers…</li>
              )}
            </ul>
          </Panel>
        </div>
      </section>

      <section className="flex items-center gap-2 text-xs text-text-muted">
        <Activity size={12} className="text-info" />
        {quotesQuery.isFetching ? "Refreshing feed…" : "Feed live"} · data via Twelve Data + Deriv
      </section>
    </div>
  );
}

function Panel({
  heading,
  icon: Icon,
  children,
}: {
  heading: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card">
      <div className="rounded-[var(--card-radius)] border border-border-default bg-bg-surface/[0.45] p-6 h-full">
        <div className="mb-4 flex items-center gap-2">
          <Icon size={14} className="text-accent-glow" />
          <h3 className="text-sm font-medium text-text-primary">{heading}</h3>
        </div>
        {children}
      </div>
    </div>
  );
}