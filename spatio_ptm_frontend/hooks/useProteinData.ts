// src/hooks/useProteinData.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useDashboardStore } from "../lib/store";

export function useProteinBase(uniprotId: string) {
  return useQuery({
    queryKey: ["protein", uniprotId, "base"],
    queryFn: () => api.getProteinBase(uniprotId),
    staleTime: 1000 * 60 * 60, // Cache for 1 hour to prevent redundant fetching
  });
}

export function useProteinSites(uniprotId: string) {
  // Pull active filters from the Zustand store
  const activeStatuses = useDashboardStore((state) => state.activeCurationStatuses);
  const activePtm = useDashboardStore((state) => state.activePtmType);
  const minScore = useDashboardStore((state) => state.minEvidenceScore);

  return useQuery({
    // Adding filters to the queryKey ensures the hook automatically refetches when a filter changes
    queryKey: ["protein", uniprotId, "sites", { activeStatuses, activePtm, minScore }],
    queryFn: () => 
      api.getProteinSites(uniprotId, {
        statuses: activeStatuses,
        ptm_type: activePtm || undefined,
        min_score: minScore || undefined,
      }),
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}

export function useProteinStructures(uniprotId: string) {
  return useQuery({
    queryKey: ["protein", uniprotId, "structures"],
    queryFn: () => api.getProteinStructures(uniprotId),
    staleTime: 1000 * 60 * 60,
  });
}