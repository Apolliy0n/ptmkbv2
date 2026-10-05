"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useDashboardStore } from "../../lib/store";

const plddtBand = (v: number) =>
    v > 90 ? ["Very high", "#0053D6"] : v > 70 ? ["Confident", "#65CBF3"] : v > 50 ? ["Low", "#FFDB13"] : ["Very low", "#FF7D45"];

const d = (v: any, u = "") => (v == null ? "–" : `${v}${u}`);

function Bar({ pct, color }: { pct: number; color: string }) {
    return (
        <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }} />
        </div>
    );
}

function Section({ title, children, tip }: { title: string; children: React.ReactNode; tip?: string }) {
    return (
        <div className="px-3 py-2.5 border-t border-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 flex items-center gap-1">
                {title}
                {tip && (
                    <span
                        title={tip}
                        className="cursor-help inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-slate-200 text-slate-500 text-[9px] font-bold normal-case tracking-normal"
                    >
                        ?
                    </span>
                )}
            </div>
            {children}
        </div>
    );
}

function Row({ k, v, tip }: { k: string; v: React.ReactNode; tip?: string }) {
    return (
        <div className="flex justify-between gap-3 text-xs py-0.5" title={tip}>
            <span className="text-slate-500">{k}</span>
            <span className="font-semibold text-slate-800 text-right">{v}</span>
        </div>
    );
}

const SS_NAME: Record<string, string> = {
    H: "α-helix", G: "3₁₀-helix", I: "π-helix", E: "β-strand", B: "β-bridge", T: "Turn", S: "Bend", C: "Coil",
};
const RAMA_NAME: Record<string, string> = {
    alpha: "α-helix region", beta: "β / PPII region", left: "Left-handed", gly: "Glycine", other: "Other",
};
const ROT_NAME: Record<string, string> = { p: "p (+60°)", t: "t (180°)", m: "m (−60°)" };

export default function ResidueSidebar({ uniprotId, sites, expanded }: { uniprotId: string; sites: any[]; expanded?: boolean }) {
    const pos = useDashboardStore((s) => s.selectedPosition);
    const setPos = useDashboardStore((s) => s.setSelectedPosition);

    const { data, isLoading, isError } = useQuery({
        queryKey: ["residue-features-all", uniprotId, pos],
        queryFn: async () => {
            const r = await fetch(`/api/v2/proteins/${uniprotId}/features?positions=${pos}`);
            if (!r.ok) throw new Error(String(r.status));
            return r.json();
        },
        enabled: !!uniprotId && pos != null,
        staleTime: Infinity,
        retry: 1,
    });

    if (pos == null) return null;

    const here = (sites ?? []).filter((s) => s.position === pos);
    const types = [...new Set(here.map((s) => s.ptm?.ptm_type).filter(Boolean))] as string[];
    const f = data?.residues?.[String(pos)];
    const aa = f?.aa ?? here[0]?.target_residue ?? "";
    const [band, bandColor] = f?.plddt != null ? plddtBand(f.plddt) : ["", "#cbd5e1"];
    const low = f?.plddt != null && f.plddt < 70;
    const rel = f?.rel_sasa;

    return (
        <div
            className={`${expanded ? "fixed left-3 top-14 bottom-3" : "absolute left-2 top-12 bottom-2"} w-64 flex flex-col rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-xl overflow-hidden`}
            style={{ zIndex: expanded ? 2147483647 : 10 }}
        >
            {/* header */}
            <div className="px-3 py-2.5 flex items-center justify-between bg-gradient-to-r from-indigo-600 to-indigo-500 text-white">
                <div className="flex items-baseline gap-2">
                    <span className="text-xl font-extrabold font-mono">{aa}{pos}</span>
                    {/* <span className="text-[11px] opacity-80">{here.length} site{here.length === 1 ? "" : "s"}</span> */}
                </div>
                <button onClick={() => setPos(null)} className="text-white/80 hover:text-white text-xl leading-none">&times;</button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* PTMs here */}
                {here.length > 0 && (
                    <Section title="Modifications">
                        <div className="flex flex-col gap-1">
                            {here.map((s) => (
                                <div key={s.site_id} className="flex items-center justify-between text-xs">
                                    <span className="font-semibold text-slate-800">{s.ptm?.ptm_type}</span>
                                    <span className="text-[10px] text-slate-500">{s.curation_status}</span>
                                </div>
                            ))}
                        </div>
                    </Section>
                )}

                {isLoading && <div className="px-3 py-4 text-xs text-slate-400">Computing…</div>}
                {isError && <div className="px-3 py-4 text-xs text-red-500">Features unavailable</div>}

                {f && (
                    <>
                        <Section title="Confidence">
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-slate-500">pLDDT</span>
                                <span className="font-semibold" style={{ color: bandColor === "#FFDB13" ? "#a16207" : bandColor }}>
                                    {f.plddt} · {band}
                                </span>
                            </div>
                            <Bar pct={f.plddt} color={bandColor} />
                            {/* {low && <div className="text-[10px] text-amber-600 mt-1">Geometry below is unreliable</div>} */}
                        </Section>

                        <div className={low ? "opacity-50" : ""}>
                            <Section title="Exposure">
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-slate-500">SASA</span>
                                    <span className="font-semibold text-slate-800">
                                        {f.sasa} Å² · {rel != null ? `${Math.round(rel * 100)}%` : "–"}
                                    </span>
                                </div>
                                <Bar pct={(rel ?? 0) * 100} color={rel == null ? "#cbd5e1" : rel < 0.2 ? "#6366f1" : rel > 0.5 ? "#10b981" : "#f59e0b"} />
                                <div className="text-[10px] text-slate-400 mt-1">
                                    {rel == null ? "" : rel < 0.2 ? "Buried" : rel > 0.5 ? "Exposed" : "Partly exposed"}
                                </div>
                            </Section>

                            <Section title="Backbone">
                                <Row k="Secondary structure" v={f.ss ? (SS_NAME[f.ss] ?? f.ss) : "–"} />
                                <Row k="Ramachandran" v={f.rama ? (RAMA_NAME[f.rama] ?? f.rama) : "–"} />
                                <Row k="φ" v={d(f.phi, "°")} tip="Phi torsion angle" />
                                <Row k="ψ" v={d(f.psi, "°")} tip="Psi torsion angle" />
                                <Row k="ω" v={`${d(f.omega, "°")}${f.peptide ? ` · ${f.peptide}` : ""}`} tip="Omega: ±180° = trans, 0° = cis" />
                            </Section>

                            <Section title="Contacts">
                                {f.contacts.length ? (
                                    <div className="flex flex-wrap gap-1">
                                        {f.contacts.map((c: number) => (
                                            <button
                                                key={c}
                                                onClick={() => setPos(c)}
                                                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600 font-mono"
                                            >
                                                {c}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="text-xs text-slate-400">None</span>
                                )}
                            </Section>

                            <Section
                                title="Environment"
                                tip={
                                    "Charge (8 Å): basic residues (K, R) minus acidic residues (D, E) whose Cβ lies within 8 Å in 3D, excluding sequence neighbours.\n\n" +
                                    "Salt bridges: oppositely charged side-chain groups within 4 Å. Click one to jump to it.\n\n" +
                                    "Disulfide: partner cysteine with S–S distance under 2.5 Å.\n\n" +
                                    "χ1 rotamer: side-chain orientation, p = +60°, t = 180°, m = −60°."
                                }
                            >
                                <Row
                                    k="Charge (8 Å)"
                                    v={`${f.env_charge > 0 ? "+" : ""}${f.env_charge}  (${f.env_basic}+ / ${f.env_acidic}−)`}
                                />
                                {f.rotamer && <Row k="χ1" v={`${f.chi1}° · ${ROT_NAME[f.rotamer]}`} />}
                                {f.disulfide != null && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        <button
                                            onClick={() => setPos(f.disulfide)}
                                            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 font-mono"
                                        >
                                            S–S · C{f.disulfide}
                                        </button>
                                    </div>
                                )}
                                {f.salt_bridges?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {f.salt_bridges.map((b: any) => (
                                            <button
                                                key={b.pos}
                                                onClick={() => setPos(b.pos)}
                                                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600 font-mono"
                                            >
                                                {b.aa}{b.pos} · {b.d} Å
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </Section>
                        </div>

                        <Section title="Local window">
                            <Row k="Hydrophobicity" v={d(f.window_gravy)} tip="Mean Kyte-Doolittle value" />
                            <Row k="Net charge" v={d(f.window_net_charge)} tip="K+R minus D+E" />
                            <Row k="Aromaticity" v={d(f.window_aromaticity)} tip="Fraction of F/W/Y" />
                            <Row k="Isoelectric point" v={d(f.window_pi)} tip="pI of the window peptide" />
                        </Section>

                        {types.length > 0 && (
                            <Section title="Propensity">
                                {types.map((t) => {
                                    const p = f.propensity?.[t];
                                    return (
                                        <div key={t} className="mb-2 last:mb-0">
                                            <div className="text-[11px] font-semibold text-slate-700">{t}</div>
                                            <Row k="Log Sum" v={p ? String(p.logSum) : "N/A"} tip="Closer to 0 = more typical of known sites" />
                                            <Row k="Log-Log Product" v={p ? String(p.logLogProduct) : "N/A"} />
                                        </div>
                                    );
                                })}
                            </Section>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}