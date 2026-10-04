export enum CurationStatus {
  VERIFIED = "Experimentally-Verified",
  CONSENSUS = "Consensus-Predicted",
  UNIPROT = "UniProt-Predicted",
  PENDING = "Validation-Pending",
}

export interface PTMBase {
  ptm_id: number;
  ptm_type: string;
  target_residues: string;
}

export interface NeighborhoodBase {
  local_window: string;
  window_size: number; // FIXED: changed from int to number
  hydrophobicity: number | null;
  net_charge: number | null;
  aromaticity: number | null;
  isoelectric_point: number | null;
}

export interface StructureBase {
  structure_id: number;
  pdb_id: string;
  chain_id: string | null;
  resolution: number | null;
  modified_pdb_uri: string | null;
  atom_validation_score: number | null;
}

export interface EnzymeBase {
  enzyme_id: string;
  enzyme_name: string;
  uniprot_acc: string | null;
  ec_number: string | null;
  kinase_family: string | null;
}

export interface PropensityScoreBase {
  score_id: number; // FIXED: changed from int to number
  evidence_score: number | null;
  matrix_version: string;
  calculated_at: string;
  enzyme: EnzymeBase;
}

export interface SiteDetail {
  site_id: number;
  uniprot_id: string;
  position: number;
  target_residue: string;
  curation_status: CurationStatus;
  raw_sources: string | null;
  eco_codes: string | null;
  ptm: PTMBase;
  neighborhood: NeighborhoodBase | null;
  structures: StructureBase[];
  propensity_scores: PropensityScoreBase[];
}

export interface ProteinSummary {
  uniprot_id: string;
  protein_name: string;
  gene_name: string | null;
}

export interface ProteinDetail extends ProteinSummary {
  organism: string | null;
  sequence: string;
  last_updated: string | null;
}

export interface ProteinDashboardSummary {
  uniprot_id: string;
  total_sites: number;
  by_curation: Record<string, number>;
  by_ptm: Record<string, number>;
}