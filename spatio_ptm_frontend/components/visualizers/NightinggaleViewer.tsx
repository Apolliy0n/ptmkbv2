"use client";
import React, { useMemo } from "react";
import { useDashboardStore } from "../../lib/store";

const PTM_COLORS: Record<string, string> = {
  Phosphorylation: "#e11d48",
  Acetylation: "#16a34a",
  Ubiquitination: "#9333ea",
  Methylation: "#ea580c",
  Lactylation: "#db2777",
  Glutathionylation: "#0d9488",
  "S-nitrosylation": "#ca8a04",
  "O-linked Glycosylation": "#0891b2",
};
const DEFAULT_COLOR = "#111827";

interface Props {
  sequence: string;
  sites: any[];
}

export default function NightingaleViewer({ sequence, sites }: Props) {
  const selectedPosition = useDashboardStore((s) => s.selectedPosition);
  const setSelectedPosition = useDashboardStore((s) => s.setSelectedPosition);

  // position -> list of { type, status }
  const byPos = useMemo(() => {
    const m = new Map<number, { type: string; status: string }[]>();
    (sites || []).forEach((s) => {
      if (!Number.isInteger(s?.position)) return;
      const type = s.ptm?.ptm_type || "Other";
      const list = m.get(s.position) ?? [];
      if (!list.some((x) => x.type === type)) {
        list.push({ type, status: s.curation_status ?? "" });
      }
      m.set(s.position, list);
    });
    return m;
  }, [sites]);

  const typesPresent = useMemo(() => {
    const set = new Set<string>();
    byPos.forEach((l) => l.forEach((x) => set.add(x.type)));
    return [...set];
  }, [byPos]);

  if (!sequence) return null;

  return (
    <div className="w-full bg-white p-4 rounded-xl border border-slate-200 shadow-sm overflow-visible">
      <div className="flex flex-nowrap overflow-x-auto pb-2">
        {sequence.split("").map((aa, i) => {
          const pos = i + 1;
          const ptms = byPos.get(pos) ?? [];
          const showNum = pos === 1 || pos % 10 === 0;
          const selected = selectedPosition === pos;

          return (
            <div
              key={pos}
              className="flex flex-col items-center w-5 shrink-0 cursor-pointer"
              onClick={() => setSelectedPosition(pos)}
            >
              {/* number row */}
              <span className="h-3 text-[9px] leading-3 text-slate-400 font-mono">
                {showNum ? pos : ""}
              </span>

              {/* residue */}
              <span
                className={`w-5 text-center text-xs font-mono leading-5 rounded-sm ${
                  selected ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {aa}
              </span>

              {/* dots row */}
              <div className="flex flex-col items-center gap-0.5 pt-0.5">
                {ptms.map((p) => (
                  <span key={p.type} className="relative group">
                    <span
                      className="block w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: PTM_COLORS[p.type] ?? DEFAULT_COLOR }}
                    />
                    <span className="hidden group-hover:block absolute left-3 top-1/2 -translate-y-1/2 z-20 whitespace-nowrap rounded bg-slate-800 text-white text-[11px] px-2 py-1 shadow-lg pointer-events-none">
                      {p.type} · {aa}{pos}
                      {p.status ? ` · ${p.status}` : ""}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* legend */}
      {typesPresent.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-3 border-t border-slate-100 text-xs text-slate-600">
          {typesPresent.map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: PTM_COLORS[t] ?? DEFAULT_COLOR }}
              />
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}