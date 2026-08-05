"use client";

import Link from "next/link";
import {
  LayoutDashboard,
  LineChart,
  Bot,
  Zap,
  Activity,
  Blocks,
  Target,
  PieChart,
  BarChart3,
  Workflow,
  BookOpen,
  LogOut,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import BrandMark from "@/components/brand/brand-mark";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

export type ViewId =
  | "dashboard"
  | "markets"
  | "escape"
  | "ai_digit"
  | "hft"
  | "ldp"
  | "strategy"
  | "spike";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  section: string;
  disabled?: boolean;
}

const NAV: NavItem[] = [
  { id: "dashboard", label: "Market dashboard", icon: LayoutDashboard, section: "Overview" },
  { id: "markets", label: "Markets", icon: LineChart, section: "Overview" },
  { id: "escape", label: "APEX Escape Plan", icon: Target, section: "Trading" },
  { id: "ai_digit", label: "AI Digit Trader", icon: Bot, section: "Trading" },
  { id: "hft", label: "HFT Console", icon: Zap, section: "Trading" },
  { id: "ldp", label: "Last Digit Predictor", icon: Activity, section: "Trading" },
  { id: "strategy", label: "Strategy Playground", icon: Blocks, section: "Trading" },
  { id: "spike", label: "Spike Detector", icon: Activity, section: "Trading" },
];

const IGNORED_NAV: NavItem[] = [
  { id: "portfolio", label: "Portfolio", icon: PieChart, section: "Overview", disabled: true },
  { id: "analytics", label: "Analytics", icon: BarChart3, section: "Overview", disabled: true },
  { id: "automation", label: "Automation", icon: Workflow, section: "Overview", disabled: true },
  { id: "journal", label: "Journal", icon: BookOpen, section: "Overview", disabled: true },
];

interface SidebarProps {
  currentView: string;
  onViewChange: (view: ViewId) => void;
}

export default function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const { signOut, isCeo, user } = useAuth();
  const label = (user?.user_metadata?.full_name as string) || user?.email || "Member";
  const allNav = [...NAV, ...IGNORED_NAV];
  let lastSection = "";

  return (
    <aside className="hidden md:flex h-screen sticky top-0 flex-col bg-bg-root px-3 py-6">
      <div className="px-3 mb-8">
        <BrandMark />
      </div>

      <nav className="flex-1 overflow-y-auto apex-scroll">
        {allNav.map((item) => {
          const Icon = item.icon;
          const showSection = item.section !== lastSection;
          lastSection = item.section;
          return (
            <div key={item.id}>
              {showSection && (
                <div className="eyebrow-label px-3 mt-5 mb-1.5">{item.section}</div>
              )}
              <button
                type="button"
                onClick={() => !item.disabled && onViewChange(item.id as ViewId)}
                className={cn(
                  "sidebar-nav-item",
                  item.id === currentView && "active",
                  item.disabled && "opacity-40 cursor-not-allowed"
                )}
                aria-current={item.id === currentView ? "page" : undefined}
                disabled={item.disabled}
              >
                <Icon size={16} strokeWidth={1.75} className="shrink-0" />
                <span>{item.label}</span>
                {item.disabled && (
                  <span className="ml-auto text-[9px] font-mono uppercase tracking-wider text-text-disabled">
                    soon
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </nav>

      <div className="mb-2">
        {isCeo && (
          <Link href="/admin" className="block">
            <button type="button" className="sidebar-nav-item">
              <ShieldCheck size={16} strokeWidth={1.75} className="shrink-0" />
              <span>Access control</span>
            </button>
          </Link>
        )}
      </div>

      <div className="border-t border-border-default pt-4 px-3">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-8 w-8 rounded-full bg-accent/[0.15] border border-accent/40 flex items-center justify-center">
            <span className="kpi-value text-xs text-accent-glow">
              {label.slice(0, 1).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-text-primary">{label}</div>
            <div className="flex items-center gap-1.5 text-[10px] text-buy font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-buy animate-pulse" />
              System online
            </div>
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={signOut}
          type="button"
          className="flex w-full items-center gap-2 rounded-[6px] border border-border-default px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors cursor-pointer"
        >
          <LogOut size={14} />
          Sign out
        </motion.button>
      </div>
    </aside>
  );
}