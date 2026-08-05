"use client";

import { useMemo, useState } from "react";
import Sidebar, { type ViewId } from "@/components/shell/sidebar";
import TopBar from "@/components/shell/top-bar";
import StatusBar from "@/components/shell/status-bar";
import CelestialBackground from "@/components/three/celestial-background";
import Dashboard from "@/components/views/dashboard";
import { Placeholder } from "@/components/views/placeholder";

const VIEW_META: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: "Market dashboard", subtitle: "Real-time market intelligence across every asset class" },
  markets: { title: "Markets", subtitle: "Forex, synthetics, stocks, crypto and commodities" },
  escape: { title: "APEX Escape Plan", subtitle: "Automated 90% payout trading engine" },
  ai_digit: { title: "AI Digit Trader", subtitle: "Neural digit prediction on trade outcomes" },
  hft: { title: "HFT Console", subtitle: "Low-latency execution and tick monitoring" },
  ldp: { title: "Last Digit Predictor", subtitle: "Statistical last-digit distribution modeling" },
  strategy: { title: "Strategy Playground", subtitle: "Design, backtest and compare strategies" },
  spike: { title: "Spike Detector", subtitle: "Volatility spike and breakout watch" },
};

export default function AppShell() {
  const [view, setView] = useState<ViewId>("dashboard");
  const meta = VIEW_META[view] ?? VIEW_META.dashboard;

  const body = useMemo(() => {
    if (view === "dashboard") return <Dashboard />;
    return <Placeholder view={view} />;
  }, [view]);

  return (
    <div className="relative">
      <CelestialBackground />
      <div className="relative z-10 shell">
        <Sidebar currentView={view} onViewChange={setView} />
        <div className="shell-main">
          <TopBar liveActive={true} title={meta.title} subtitle={meta.subtitle} />
          <main className="shell-body apex-scroll">{body}</main>
          <StatusBar />
        </div>
      </div>
    </div>
  );
}