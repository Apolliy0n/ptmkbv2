// src/lib/store.ts
import { create } from "zustand";
import { CurationStatus } from "../types";

export interface DashboardState {
  selectedPosition: number | null;
  hoveredPosition: number | null;
  activeCurationStatuses: CurationStatus[];
  activePtmType: string | null;
  minEvidenceScore: number | null;
  setSelectedPosition: (pos: number | null) => void;
  setHoveredPosition: (pos: number | null) => void;
  toggleCurationStatus: (status: CurationStatus) => void;
  setPtmFilter: (ptm: string | null) => void;
  setMinScore: (score: number | null) => void;
  resetFilters: () => void;
}

export const useDashboardStore = create<DashboardState>()((set) => ({
  // Initial State
  selectedPosition: null,
  hoveredPosition: null,
  activeCurationStatuses: [
    CurationStatus.VERIFIED,
    CurationStatus.CONSENSUS,
    CurationStatus.UNIPROT
    // PENDING is off by default
  ],
  activePtmType: null,
  minEvidenceScore: null,

  // Mutations
  setSelectedPosition: (pos) => set({ selectedPosition: pos }),
  setHoveredPosition: (pos) => set({ hoveredPosition: pos }),
  
  toggleCurationStatus: (status) =>
    set((state) => {
      const exists = state.activeCurationStatuses.includes(status);
      return {
        activeCurationStatuses: exists
          ? state.activeCurationStatuses.filter((s) => s !== status)
          : [...state.activeCurationStatuses, status],
      };
    }),

  setPtmFilter: (ptm) => set({ activePtmType: ptm }),
  setMinScore: (score) => set({ minEvidenceScore: score }),
  
  resetFilters: () => set({ 
    activeCurationStatuses: [
      CurationStatus.VERIFIED, 
      CurationStatus.CONSENSUS, 
      CurationStatus.UNIPROT
    ],
    activePtmType: null,
    minEvidenceScore: null,
    selectedPosition: null 
  }),
}));