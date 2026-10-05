"use client";
import { useQuery } from "@tanstack/react-query";

const ROWS: [string, string, string?][] = [
  ["length", "Length", " aa"],
  ["mw", "Mol. weight", " Da"],
  ["pi", "pI"],
  ["charge_ph7", "Charge (pH 7)"],
  ["aromaticity", "Aromaticity"],
  ["gravy", "GRAVY"],
  ["instability_index", "Instability index"],
  ["helix_frac", "Helix fraction"],
  ["sheet_frac", "Sheet fraction"],
  ["turn_frac", "Turn fraction"],
  ["mean_plddt", "Mean pLDDT"],
  ["frac_plddt_gt70", "Fraction pLDDT > 70"],
  ["total_sasa", "Total SASA", " Å²"],
  ["radius_of_gyration", "Radius of gyration", " Å"],
  ["mean_contacts", "Mean contacts / residue"],
];

export default function ProteinFeatures({ uniprotId }: { uniprotId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["features", uniprotId],
    queryFn: async () => {
      const r = await fetch(`/api/v2/proteins/${uniprotId}/features?residues=false`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: Infinity,
    retry: 1,
  });

  if (isLoading) return <div className="text-sm text-slate-400">Computing protein features…</div>;
  if (isError || !data) return <div className="text-sm text-red-500">Protein features unavailable</div>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
      {ROWS.map(([k, label, unit]) => (
        <div key={k} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
          <div className="text-sm font-semibold text-slate-800">
            {data.protein[k] ?? "–"}{data.protein[k] != null && unit ? unit : ""}
          </div>
        </div>
      ))}
    </div>
  );
}