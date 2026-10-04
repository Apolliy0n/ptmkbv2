from typing import List, Optional, Dict
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict
from app.models import CurationStatusEnum


class PTMBase(BaseModel):
    ptm_id: int
    ptm_type: str
    target_residues: str
    model_config = ConfigDict(from_attributes=True)


class NeighborhoodBase(BaseModel):
    local_window: str
    window_size: int
    hydrophobicity: Optional[float] = None
    net_charge: Optional[float] = None
    aromaticity: Optional[float] = None
    isoelectric_point: Optional[float] = None
    model_config = ConfigDict(from_attributes=True)


class StructureBase(BaseModel):
    structure_id: int
    site_id: int
    pdb_id: str
    chain_id: Optional[str] = None
    resolution: Optional[float] = None
    modified_pdb_uri: Optional[str] = None
    atom_validation_score: Optional[float] = None
    model_config = ConfigDict(from_attributes=True)


class StructureWithSite(StructureBase):
    """Structure plus the residue position it is mapped to (for the 3D viewer)."""
    position: int


class PDBEntry(BaseModel):
    """One distinct PDB entry/chain for a protein, with how many sites map to it."""
    pdb_id: str
    chain_id: Optional[str] = None
    resolution: Optional[float] = None
    site_count: int


class EnzymeBase(BaseModel):
    enzyme_id: str
    enzyme_name: str
    uniprot_acc: Optional[str] = None
    ec_number: Optional[str] = None
    kinase_family: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class PropensityScoreBase(BaseModel):
    score_id: int
    evidence_score: Optional[float] = None
    matrix_version: str
    calculated_at: datetime
    enzyme: EnzymeBase
    model_config = ConfigDict(from_attributes=True)


class EnzymeSubstrateBase(BaseModel):
    site_id: int
    substrate_uniprot_id: str
    substrate_name: str
    modification: str
    target_residue: str
    position: int
    evidence_score: Optional[float] = None
    matrix_version: str
    curation_status: CurationStatusEnum
    model_config = ConfigDict(from_attributes=True)


class PaginatedSubstrates(BaseModel):
    total: int
    items: List[EnzymeSubstrateBase]


class SiteBase(BaseModel):
    site_id: int
    uniprot_id: str
    position: int
    target_residue: str
    curation_status: CurationStatusEnum
    raw_sources: Optional[str] = None
    eco_codes: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class SiteTrack(BaseModel):
    """Minimal per-site record for drawing the 1D sequence track."""
    site_id: int
    position: int
    target_residue: str
    ptm_type: str
    curation_status: CurationStatusEnum


class SiteSummary(SiteBase):
    """Site + PTM + neighborhood, without the heavy structures/scores lists."""
    ptm: PTMBase
    neighborhood: Optional[NeighborhoodBase] = None
    model_config = ConfigDict(from_attributes=True)


class SiteDetail(SiteSummary):
    structures: List[StructureBase] = []
    propensity_scores: List[PropensityScoreBase] = []
    model_config = ConfigDict(from_attributes=True)


class ProteinSummary(BaseModel):
    uniprot_id: str
    protein_name: str
    gene_name: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class ProteinDetail(ProteinSummary):
    organism: Optional[str] = None
    sequence: str
    last_updated: Optional[date] = None
    model_config = ConfigDict(from_attributes=True)


class GlobalSearchResponse(BaseModel):
    proteins: List[ProteinSummary]
    enzymes: List[EnzymeBase]
    ptms: List[PTMBase]


class ProteinDashboardSummary(BaseModel):
    uniprot_id: str
    total_sites: int
    by_curation: Dict[str, int]
    by_ptm: Dict[str, int]