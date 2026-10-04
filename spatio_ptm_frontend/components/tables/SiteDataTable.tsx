"use client";
import React, { useState, useMemo } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, flexRender, ColumnDef
} from "@tanstack/react-table";
import InfoTooltip from "../ui/InfoTooltip";
import { useDashboardStore } from "../../lib/store";

interface SiteDataTableProps {
  data: any[];
  sequence: string;
  isLoading: boolean;
}

export default function SiteDataTable({ data, sequence, isLoading }: SiteDataTableProps) {
  const [globalFilter, setGlobalFilter] = useState("");
  const [popup, setPopup] = useState<{ site: any; x: number; y: number } | null>(null);
  const selectedPosition = useDashboardStore((s) => s.selectedPosition);
  const setSelectedPosition = useDashboardStore((s) => s.setSelectedPosition);
  const [ptmFilter, setPtmFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const dragRef = React.useRef<{ dx: number; dy: number } | null>(null);

  const startDrag = (e: React.MouseEvent) => {
    if (!popup) return;
    if ((e.target as HTMLElement).closest("button")) return; // let × work
    dragRef.current = { dx: e.clientX - popup.x, dy: e.clientY - popup.y };
    e.preventDefault();

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const x = Math.max(0, Math.min(ev.clientX - dragRef.current.dx, window.innerWidth - 100));
      const y = Math.max(0, Math.min(ev.clientY - dragRef.current.dy, window.innerHeight - 40));
      setPopup((p) => (p ? { ...p, x, y } : p));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const columns = useMemo<ColumnDef<any, any>[]>(() => [
    { header: "Pos", accessorKey: "position" },
    { header: "Res", accessorKey: "target_residue" },
    { id: "ptm_type", header: "Mod Type", accessorFn: (s) => s.ptm?.ptm_type ?? "N/A" },
    { header: "Status", accessorKey: "curation_status" },
    {
      id: "enzyme",
      header: "Enzyme / Upstream",
      accessorFn: (s) => {
        const ps = [...(s.propensity_scores ?? [])].sort((a, b) => b.evidence_score - a.evidence_score);
        if (!ps.length) return "N/A";
        const top = ps[0].enzyme?.enzyme_name ?? "N/A";
        return ps.length > 1 ? `${top} +${ps.length - 1}` : top;
      },
    },
    { id: "source", header: "Source", accessorFn: (s) => cleanSources(s.raw_sources) },
    {
      id: "evidence_score",
      header: "Evidence Score",
      accessorFn: (s) => {
        const v = (s.propensity_scores ?? []).map((p: any) => p.evidence_score);
        return v.length ? Math.max(...v) : null;
      },
      cell: (i) => i.getValue() ?? "N/A",
    },
  ], []);

  const ptmOptions = useMemo(
    () => [...new Set((data ?? []).map((s: any) => s.ptm?.ptm_type).filter(Boolean))].sort(),
    [data]
  );
  const statusOptions = useMemo(
    () => [...new Set((data ?? []).map((s: any) => s.curation_status).filter(Boolean))].sort(),
    [data]
  );
  const filteredData = useMemo(
    () =>
      (data ?? []).filter(
        (s: any) =>
          (!ptmFilter || s.ptm?.ptm_type === ptmFilter) &&
          (!statusFilter || s.curation_status === statusFilter)
      ),
    [data, ptmFilter, statusFilter]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: { sorting: [{ id: "evidence_score", desc: true }] },
  });

  const renderLocalSequence = (pos: number) => {
    if (!sequence) return null;
    const start = Math.max(0, pos - 11);
    const end = Math.min(sequence.length, pos + 10);
    const pre = sequence.slice(start, pos - 1);
    const active = sequence.slice(pos - 1, pos);
    const post = sequence.slice(pos, end);

    return (
      <div className="flex items-center justify-center font-mono text-xl tracking-widest bg-slate-100 p-4 rounded-xl border border-slate-200">
        <span className="text-slate-500">{pre}</span>
        <span className="mx-1 bg-indigo-600 text-white rounded px-2 py-1 shadow-md font-bold">{active}</span>
        <span className="text-slate-500">{post}</span>
      </div>
    );
  };

  const cleanSources = (raw?: string | null) =>
    (raw ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x && x !== "PTMKB")
      .join(", ") || "N/A";

  const enzymeList = (s: any) =>
    (s.propensity_scores ?? [])
      .map((p: any) => p.enzyme?.enzyme_name)
      .filter(Boolean)
      .join(", ") || "N/A";

  const enzymeLines = (s: any) => {
    const ps = [...(s.propensity_scores ?? [])].sort(
      (a: any, b: any) => b.evidence_score - a.evidence_score
    );
    if (!ps.length) return "N/A";
    return ps.map((p: any, i: number) => {
      const name = p.enzyme?.enzyme_name ?? "N/A";
      const acc = p.enzyme?.uniprot_acc ?? p.enzyme?.enzyme_id;
      const url = acc
        ? `https://www.uniprot.org/uniprotkb/${acc}/entry`
        : `https://www.uniprot.org/uniprotkb?query=${encodeURIComponent(name)}`;
      return (
        <div key={i}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {name}
          </a>
          <span className="text-slate-500 font-normal"> ({p.evidence_score})</span>
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-white relative">

      <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col gap-2">
        <input
          type="text"
          value={globalFilter ?? ""}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search modifications, enzymes, evidence..."
          className="w-full p-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex gap-2">
          <select
            value={ptmFilter}
            onChange={(e) => setPtmFilter(e.target.value)}
            className="flex-1 p-2 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All PTM types</option>
            {ptmOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 p-2 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All statuses</option>
            {statusOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-4">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-slate-100 sticky top-0 z-[1] shadow-sm">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} className="p-3 font-semibold text-slate-700 border-b border-slate-300 bg-slate-100">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr
                key={row.id}
                onClick={(e) => {
                  setSelectedPosition(row.original.position);
                  setPopup((prev) => {
                    if (prev) return { ...prev, site: row.original }; // keep position + size
                    const W = 600, H = 640;
                    const x = Math.max(8, Math.min(e.clientX + 12, window.innerWidth - W - 8));
                    const y = Math.max(8, Math.min(e.clientY + 12, window.innerHeight - H - 8));
                    return { site: row.original, x, y };
                  });
                }}
                className={`border-b border-slate-100 hover:bg-indigo-50 cursor-pointer transition-colors ${selectedPosition === row.original.position ? "bg-indigo-100" : ""
                  }`}
              >
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="p-3 text-slate-600">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {popup && (() => {
        const s = popup.site;
        return (
          <div
            className="fixed z-50 overflow-auto resize bg-white rounded-xl border border-slate-300 shadow-2xl"
            style={{ left: popup.x, top: popup.y, width: 600, height: 640, minWidth: 380, minHeight: 260, maxWidth: "95vw", maxHeight: "95vh" }}
          >
            <div
              onMouseDown={startDrag}
              className="sticky top-0 bg-white px-4 py-2.5 border-b flex justify-between items-center cursor-move select-none"
            >
              <h3 className="font-bold text-sm text-slate-800">
                Local Sequence Window · {s.target_residue}{s.position}
              </h3>
              <button
                onClick={() => setPopup(null)}
                className="text-slate-400 hover:text-red-500 text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4">
              <div className="flex flex-col items-center gap-1">
                <div className="scale-90 origin-center">{renderLocalSequence(s.position)}</div>
                <span className="text-slate-500 text-xs font-semibold">Position - {s.position}</span>
              </div>

              <div className="rounded-lg border border-slate-200 overflow-hidden text-xs">
                <div className="grid grid-cols-3 bg-slate-100 font-bold text-slate-600 text-center">
                  <div className="p-2 border-r border-slate-200">Modification Type</div>
                  <div className="p-2 border-r border-slate-200">Enzyme(s)</div>
                  <div className="p-2">Source</div>
                </div>
                <div className="grid grid-cols-3 bg-blue-50/50 text-center">
                  <div className="p-2 font-semibold border-r border-slate-200">{s.ptm?.ptm_type}</div>
                  <div className="p-2 text-blue-600 font-bold border-r border-slate-200 text-left">{enzymeLines(s)}</div>
                  <div className="p-2 font-semibold">{cleanSources(s.raw_sources)}</div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 overflow-hidden text-xs">
                {[
                  ["PTM", <>{s.ptm?.ptm_type} <span className="text-slate-500">({s.target_residue}{s.position})</span></>],
                  ["Status", s.curation_status],
                  ["Evidence Codes", <span className="text-blue-500">{s.eco_codes || "N/A"}</span>],
                  ["Neighborhood", (
                    <div className="flex flex-col gap-0.5">
                      <span><strong>Hydrophobicity:</strong> {s.neighborhood?.hydrophobicity ?? "N/A"}</span>
                      <span><strong>Net charge:</strong> {s.neighborhood?.net_charge ?? "N/A"}</span>
                    </div>
                  )],
                ].map(([label, val], i, arr) => (
                  <div key={i} className={`grid grid-cols-12 ${i < arr.length - 1 ? "border-b border-slate-100" : ""}`}>
                    <div className="col-span-4 bg-slate-50 p-2.5 font-bold text-slate-600 text-right border-r border-slate-200">{label}</div>
                    <div className="col-span-8 p-2.5 text-slate-800">{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}