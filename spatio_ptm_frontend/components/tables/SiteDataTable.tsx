"use client";
import React, { useState, useMemo } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender, ColumnDef, SortingState
} from "@tanstack/react-table";
import { useDashboardStore } from "../../lib/store";
import { useQuery } from "@tanstack/react-query";

interface SiteDataTableProps {
  data: any[];
  sequence: string;
  isLoading: boolean;
}

// Accepts "123,456", "123; 456", "PMID:123", or an array; keeps numeric IDs only, de-duplicated.
const parsePmids = (raw: unknown): string[] => {
  const items = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;\s]+/);
  const ids = items
    .map((x) => String(x).trim().replace(/^PMID:?\s*/i, ""))
    .filter((x) => /^\d{1,9}$/.test(x));
  return [...new Set(ids)];
};

function PmidLinks({
  value, limit = 3, className = "",
}: { value: unknown; limit?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const ids = parsePmids(value);
  if (!ids.length) return <span className="text-slate-400">N/A</span>;
  const shown = open ? ids : ids.slice(0, limit);

  return (
    <div className={`flex flex-wrap items-center gap-x-1 ${className}`}>
      {shown.map((id, i) => (
        <span key={id}>
          <a
            href={`https://pubmed.ncbi.nlm.nih.gov/${id}/`}
            target="_blank"
            rel="noopener noreferrer"
            title={`PubMed ${id}`}
            className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium"
            onClick={(e) => e.stopPropagation()} // do not open the row popup
          >
            {id}
          </a>
          {i < shown.length - 1 && <span className="text-slate-400">,</span>}
        </span>
      ))}
      {ids.length > limit && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          className="text-xs text-slate-500 hover:text-slate-800 underline"
        >
          {open ? "less" : `+${ids.length - limit} more`}
        </button>
      )}
    </div>
  );
}

function ResidueFeatures({
  uniprotId, position, ptmType,
}: { uniprotId: string; position: number; ptmType?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["residue-features", uniprotId, position, ptmType],
    queryFn: async () => {
      const r = await fetch(
        `/api/v2/proteins/${uniprotId}/features?positions=${position}&ptms=${encodeURIComponent(ptmType ?? "")}`
      );
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    enabled: !!uniprotId && Number.isInteger(position),
    staleTime: Infinity,
    retry: 1,
  });

  if (isLoading) return <span className="text-slate-400">Computing&hellip;</span>;
  if (isError) return <span className="text-red-500">Unavailable</span>;

  const f = data?.residues?.[String(position)];
  if (!f) return <span className="text-slate-400">N/A</span>;
  const pr = f.propensity?.[ptmType ?? ""];
  const low = f.plddt != null && f.plddt < 70;
  const d = (v: any, u = "") => (v == null ? "\u2013" : `${v}${u}`);

  const rows: [string, any, string?][] = [
    ["Hydrophobicity", d(f.window_gravy), "Mean Kyte-Doolittle value of the 21-residue window"],
    ["Net charge", d(f.window_net_charge), "K+R minus D+E in the 21-residue window"],
    ["Aromaticity", d(f.window_aromaticity), "Fraction of F/W/Y in the 21-residue window"],
    ["Isoelectric point", d(f.window_pi), "pI of the 21-residue window peptide"],
    ["Log Sum", pr ? String(pr.logSum) : "N/A", "Log-likelihood of the window under this PTM's profile; closer to 0 = more typical"],
    ["Log-Log Product", pr ? String(pr.logLogProduct) : "N/A", "PTMKB log of product of log values"],
    ["pLDDT", d(f.plddt) + (low ? " (low)" : ""), "AlphaFold confidence; below 70 = unreliable geometry"],
    ["Phi / Psi / Omega", `${d(f.phi, "\u00B0")} / ${d(f.psi, "\u00B0")} / ${d(f.omega, "\u00B0")}`, "Backbone torsion angles"],
    ["SASA", f.sasa != null ? `${f.sasa} \u00C5\u00B2 (${Math.round((f.rel_sasa ?? 0) * 100)}%)` : "\u2013", "Solvent-accessible surface area, % of maximum for this residue"],
    ["Contacts", f.n_contacts ? `${f.n_contacts}: ${f.contacts.join(", ")}` : "0", "Residues within 4.5 \u00C5, excluding sequence neighbours"],
  ];

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {rows.map(([k, v, tip]) => (
        <React.Fragment key={k}>
          <span className="font-semibold text-slate-600" title={tip}>{k}</span>
          <span className={low && ["Phi / Psi / Omega", "SASA", "Contacts"].includes(k) ? "text-slate-400" : ""}>{v}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ---------- Main component ---------- */

export default function SiteDataTable({ data, sequence, isLoading }: SiteDataTableProps) {
  // Default: position ascending, with PTM type as a tiebreaker for sites at the same residue
  const [sorting, setSorting] = useState<SortingState>([
    { id: "position", desc: false },
    { id: "ptm_type", desc: false },
  ]);

  const [popup, setPopup] = useState<{ site: any; x: number; y: number } | null>(null);
  const selectedPosition = useDashboardStore((s) => s.selectedPosition);
  const setSelectedPosition = useDashboardStore((s) => s.setSelectedPosition);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [ptmFilter, setPtmFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const dragRef = React.useRef<{ dx: number; dy: number } | null>(null);

  const startDrag = (e: React.MouseEvent) => {
    if (!popup) return;
    if ((e.target as HTMLElement).closest("button")) return;
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

  const cleanSources = (raw?: string | null) =>
    (raw ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x && x !== "PTMKB")
      .join(", ") || "N/A";

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
        return ps.length > 1 ? `${top} (+${ps.length - 1})` : top;
      },
    },
    {
      id: "evidence_score",
      header: "Evidence Score",
      accessorFn: (s) => {
        const v = (s.propensity_scores ?? []).map((p: any) => p.evidence_score);
        return v.length ? Math.max(...v) : null;
      },
      cell: (i) => i.getValue() ?? "N/A",
    },
    {
      id: "evidence_ids",
      header: "PMIDs",
      accessorFn: (s) => parsePmids(s.evidence_ids).length, // sorts by number of papers
      cell: (info) => (
        <PmidLinks value={info.row.original.evidence_ids} limit={3} className="max-w-[160px]" />
      ),
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
    state: { sorting },
    onSortingChange: setSorting,
    enableSortingRemoval: false, // header clicks toggle asc/desc only
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
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

  const selSite = (data ?? []).find((s: any) => s.site_id === selectedSiteId);
  const exactSelection = !!selSite && selSite.position === selectedPosition;
  const isSelected = (s: any) =>
    exactSelection ? s.site_id === selectedSiteId : s.position === selectedPosition;

  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col h-full bg-white relative">

      <div className="p-4 border-b border-slate-200 bg-slate-50 flex gap-2">
        <select
          aria-label="Filter by PTM type"
          value={ptmFilter}
          onChange={(e) => setPtmFilter(e.target.value)}
          className="flex-1 p-2.5 text-sm border border-slate-300 rounded-lg bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All PTM types</option>
          {ptmOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="flex-1 p-2.5 text-sm border border-slate-300 rounded-lg bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All statuses</option>
          {statusOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-4">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-slate-100 sticky top-0 z-[1] shadow-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const dir = header.column.getIsSorted(); // false | "asc" | "desc"
                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                      className="p-3 font-semibold text-slate-700 border-b border-slate-300 bg-slate-100 cursor-pointer select-none hover:bg-slate-200 transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span className="text-indigo-500 text-xs w-3">
                          {dir === "asc" ? "\u25B2" : dir === "desc" ? "\u25BC" : null}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="p-8 text-center text-slate-500">
                  Loading modifications&hellip;
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-8 text-center text-slate-500">
                  No matching modifications found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={(e) => {
                    setSelectedPosition(row.original.position);
                    setSelectedSiteId(row.original.site_id);
                    setPopup((prev) => {
                      if (prev) return { ...prev, site: row.original };
                      const W = 600, H = 640;
                      const x = Math.max(8, Math.min(e.clientX + 12, window.innerWidth - W - 8));
                      const y = Math.max(8, Math.min(e.clientY + 12, window.innerHeight - H - 8));
                      return { site: row.original, x, y };
                    });
                  }}
                  className={`border-b border-slate-100 hover:bg-indigo-50 cursor-pointer transition-colors ${isSelected(row.original) ? "bg-indigo-100" : ""
                    }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-3 text-slate-600">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
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
                Local Sequence Window &middot; {s.target_residue}{s.position}
              </h3>
              <button
                aria-label="Close"
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
                  ["PMIDs", <PmidLinks value={s.evidence_ids} limit={Infinity} />],
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