// src/lib/api.ts
import axios from "axios";
import { 
  ProteinDetail, 
  SiteDetail, 
  ProteinDashboardSummary, 
  StructureBase,
  CurationStatus
} from "../types";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "/api/v2",
  headers: {
    "Content-Type": "application/json",
  },
});

export const api = {
  // --- Proteins & Sites ---
  getProteinBase: async (uniprotId: string): Promise<ProteinDetail> => {
    const { data } = await apiClient.get(`/proteins/${uniprotId}`);
    return data;
  },

  getProteinSummary: async (uniprotId: string): Promise<ProteinDashboardSummary> => {
    const { data } = await apiClient.get(`/proteins/${uniprotId}/summary`);
    return data;
  },

  getProteinSites: async (
    uniprotId: string,
    filters?: {
      statuses?: CurationStatus[];
      ptm_type?: string;
      min_score?: number;
    }
  ): Promise<SiteDetail[]> => {
    const params = new URLSearchParams();
    if (filters?.statuses?.length) {
      params.append("statuses", filters.statuses.join(","));
    }
    if (filters?.ptm_type) params.append("ptm_type", filters.ptm_type);
    if (filters?.min_score) params.append("min_score", filters.min_score.toString());

    const { data } = await apiClient.get(`/proteins/${uniprotId}/sites`, { params });
    return data;
  },

  getProteinStructures: async (uniprotId: string): Promise<StructureBase[]> => {
    const { data } = await apiClient.get(`/proteins/${uniprotId}/structures`);
    return data;
  },

  // --- Search & Meta ---
  getDatabaseStats: async () => {
    const { data } = await apiClient.get("/search/stats");
    return data;
  },
  
  getPtms: async () => {
    const { data } = await apiClient.get("/ptms");
    return data;
  }
};