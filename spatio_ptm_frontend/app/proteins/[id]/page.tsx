// spatio_ptm_frontend/app/proteins/[id]/page.tsx
"use client";

import React, { use } from "react";
import dynamic from "next/dynamic";
import { useProteinBase, useProteinSites } from "../../../hooks/useProteinData";
import SiteDataTable from "../../../components/tables/SiteDataTable";
import InfoTooltip from "../../../components/ui/InfoTooltip";
import ProteinFeatures from "../../../components/ui/ProteinFeatures";

const MolstarViewer = dynamic(
  () => import("../../../components/visualizers/MoleStarViewer"),
  { ssr: false, loading: () => <div className="h-[500px] w-full bg-slate-100 animate-pulse rounded border" /> }
);
const NightingaleViewer = dynamic(
  () => import("../../../components/visualizers/NightinggaleViewer"),
  { ssr: false, loading: () => <div className="h-[200px] w-full bg-slate-100 animate-pulse rounded border" /> }
);

interface ProteinDashboardProps {
  params: Promise<{
    id: string;
  }>;
}

export default function ProteinDashboard({ params }: ProteinDashboardProps) {
  const { id: uniprotId } = use(params);

  const { data: baseData, isLoading: baseLoading } = useProteinBase(uniprotId);
  const { data: sitesData, isLoading: sitesLoading } = useProteinSites(uniprotId);

  if (baseLoading) return <div className="mt-20 text-center animate-pulse text-lg text-slate-500 font-medium">Assembling structural data matrices...</div>;
  if (!baseData) return <div className="mt-20 text-center text-red-600 font-medium bg-red-50 p-6 rounded border border-red-100">Failed to load protein {uniprotId}. Ensure your FastAPI backend is actively running.</div>;

  return (
    <div className="flex flex-col gap-8 p-4 md:p-8">

      {/* Header */}
      <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-sm">
        <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">
          {baseData.protein_name}
          <span className="text-indigo-500 font-mono text-xl ml-3 tracking-normal">(<a target="_blank" href={`https://www.uniprot.org/uniprotkb/${baseData.uniprot_id}/entry`}>{baseData.uniprot_id}</a>)</span>
        </h2>
        <p className="text-slate-500 font-medium mt-1">
          {baseData.organism} <span className="mx-2 text-slate-300">|</span> Gene: {baseData.gene_name || "Unknown"}
        </p>
      </div>

      <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-sm">
        <h3 className="text-sm font-bold text-slate-600 mb-3">Protein Features</h3>
        <ProteinFeatures uniprotId={uniprotId} />
      </div>

      {/* 1D Sequence */}
      <div className="w-full">
        <h3 className="text-xl font-bold mb-3 text-slate-700 flex items-center gap-2">
          <div className="w-1.5 h-6 bg-indigo-500 rounded-full"></div>
          Sequence Annotations
          <InfoTooltip text="Interactive 1D sequence mapping showing exact locations of all Post-Translational Modifications." />
        </h3>
        <NightingaleViewer sequence={baseData.sequence} sites={sitesData || []} />
      </div>

      {/* 3D & Data Table */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_1fr] gap-8 h-auto">

        {/* WebGL Canvas */}
        <div className="flex flex-col h-[650px]">
          <h3 className="text-xl font-bold mb-3 text-slate-700 flex items-center gap-2">
            <div className="w-1.5 h-6 bg-emerald-500 rounded-full"></div>
            Spatial Projection
            <InfoTooltip text="Asynchronously fetches the latest predicted 3D structure directly from the AlphaFold Database API." />
          </h3>
          <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl p-2 shadow-sm">
            <MolstarViewer uniprotId={uniprotId} sites={sitesData || []} />
          </div>
        </div>

        {/* Dynamic Data Table */}
        <div className="flex flex-col h-[650px]">
          <h3 className="text-xl font-bold mb-3 text-slate-700 flex items-center gap-2">
            <div className="w-1.5 h-6 bg-amber-500 rounded-full"></div>
            Modification Matrix
            <InfoTooltip text="Click any row to open the Local Sequence Window and view associated enzymes and evidence scores." />
          </h3>
          <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
            <SiteDataTable data={sitesData || []} sequence={baseData.sequence} isLoading={sitesLoading} />
          </div>
        </div>

      </div>
    </div>
  );
}