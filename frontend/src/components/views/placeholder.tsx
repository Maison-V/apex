"use client";

import { motion } from "framer-motion";
import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PlaceholderProps {
  view: string;
}

export function Placeholder({ view }: PlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col items-center gap-4"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border-default bg-bg-elevated">
          <Wrench size={22} className="text-text-muted" />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-center gap-2">
            <Badge variant="info">
              {view.replace(/_/g, " ")}
            </Badge>
          </div>
          <h2 className="text-lg font-medium text-text-primary">Module under construction</h2>
          <p className="mt-1 max-w-sm text-sm text-text-muted">
            The shell is live — this panel will be wired to its engine next.
          </p>
        </div>
      </motion.div>
    </div>
  );
}