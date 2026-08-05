"use client";

import { useEffect, useState } from "react";
import { Radio, Search, Bell, Bot, Waves } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { oauthService } from "@/services/oauthService";
import { tradingService } from "@/services/tradingService";
import { TradingEvent } from "@/types/trading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TopBarProps {
  liveActive: boolean;
  title: string;
  subtitle?: string;
}

export default function TopBar({ liveActive, title, subtitle }: TopBarProps) {
  const { user } = useAuth();
  const [derivConnected, setDerivConnected] = useState(false);
  const [derivBalance, setDerivBalance] = useState<{ balance?: number; currency?: string } | null>(null);
  const label = (user?.user_metadata?.full_name as string) || user?.email as string || "Member";

  useEffect(() => {
    const unsub = tradingService.subscribe((data: TradingEvent) => {
      if (data.type === "connected") {
        setDerivConnected(true);
        setDerivBalance(data as unknown as { balance?: number; currency?: string });
      } else if (data.type === "disconnected" || data.type === "error") {
        setDerivConnected(false);
      }
    });

    if (oauthService.isAuthenticated() && tradingService.isConnected()) {
      setDerivConnected(true);
      setDerivBalance(tradingService.getBalance());
    }

    return () => unsub();
  }, []);

  const handleDerivLogin = () => {
    if (!oauthService.isConfigured()) {
      alert(
        "Deriv OAuth not configured — set NEXT_PUBLIC_DERIV_APP_ID on Vercel and register the redirect URI in your Deriv app settings:\n\n" +
          window.location.origin +
          "/oauth/callback"
      );
      return;
    }
    oauthService.login();
  };

  const handleDerivLogout = () => {
    tradingService.disconnect();
    oauthService.logout();
  };

  return (
    <header
      className="sticky top-0 z-20 flex h-[80px] items-center justify-between gap-6 border-b border-border-default px-8"
      style={{ background: "rgba(4,4,4,0.72)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}
    >
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-medium text-text-primary">{title}</h1>
        <p className="mt-0.5 truncate text-xs text-text-muted">
          {subtitle || "Real-time market intelligence"}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden xl:flex items-center gap-2 rounded-md border border-border-default bg-bg-elevated px-3 h-9 w-64 text-xs text-text-muted">
          <Search size={14} className="text-text-muted" />
          <span>Search markets, strategies, tokens…</span>
          <kbd className="ml-auto font-mono text-[10px] text-text-disabled border border-border-default rounded px-1">⌘K</kbd>
        </div>

        {liveActive && (
          <Badge variant="buy">
            <Radio size={11} className="animate-pulse" />
            LIVE
          </Badge>
        )}

        {derivConnected ? (
          <button
            onClick={handleDerivLogout}
            title="Click to disconnect Deriv"
            className="flex items-center gap-2 rounded-md border border-buy/30 bg-buy/[0.05] px-3 h-9 text-xs font-medium text-buy hover:border-buy/60 transition-colors cursor-pointer"
          >
            <Waves size={14} />
            DERIV {derivBalance?.balance?.toFixed(2)} {derivBalance?.currency}
          </button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDerivLogin}
            disabled={!oauthService.isConfigured()}
          >
            <Radio size={14} />
            {oauthService.isConfigured() ? "Connect Deriv" : "Deriv needs setup"}
          </Button>
        )}

        <button className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border-default text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
          <Bell size={15} />
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
        </button>

        <div className="flex items-center gap-2 rounded-md border border-border-default px-3 h-9">
          <Bot size={14} className="text-accent-glow" />
          <span className="text-xs text-text-secondary">AI ready</span>
        </div>

        <div className="font-mono text-xs text-text-muted">{label}</div>
      </div>
    </header>
  );
}