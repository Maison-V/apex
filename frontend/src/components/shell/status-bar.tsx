"use client";

import { useEffect, useState } from "react";
import { Wifi, GitBranch, Server, Activity } from "lucide-react";
import { tradingService } from "@/services/tradingService";
import { useAuth } from "@/context/AuthContext";

export default function StatusBar() {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [latency, setLatency] = useState(0);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const start = performance.now();
    const unsub = tradingService.subscribe((data) => {
      if (data.type === "connected") {
        setConnected(true);
        setLatency(Math.round(performance.now() - start));
      } else if (data.type === "disconnected" || data.type === "error") {
        setConnected(false);
      }
    });

    if (tradingService.isConnected()) setConnected(true);

    const tick = () => setClock(new Date().toLocaleTimeString("en-US", { hour12: false }));
    tick();
    const t = setInterval(tick, 1000);

    return () => {
      unsub();
      clearInterval(t);
    };
  }, []);

  const account = user?.email?.slice(0, 12) ?? "guest";

  return (
    <footer className="flex h-[36px] items-center justify-between border-t border-border-default bg-bg-surface px-6 font-mono text-[10px] uppercase tracking-wider text-text-muted">
      <div className="flex items-center gap-5">
        <span className="flex items-center gap-1.5">
          <Wifi size={11} className={connected ? "text-buy" : "text-text-disabled"} />
          {connected ? "ws connected" : "ws idle"}
        </span>
        <span className="flex items-center gap-1.5">
          <Server size={11} className="text-accent-glow" />
          {connected ? `${latency}ms` : "—"}
        </span>
        <span className="flex items-center gap-1.5">
          <GitBranch size={11} />
          {account}
        </span>
      </div>
      <div className="flex items-center gap-5">
        <span className="hidden sm:flex items-center gap-1.5">
          <Activity size={11} className="text-info" />
          deriv
        </span>
        <span>{clock}</span>
      </div>
    </footer>
  );
}