import time
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from typing import Dict

from app.database import get_db
from app.models import Protein, Site, Enzyme, PTM
from app.schemas import GlobalSearchResponse, ProteinSummary

router = APIRouter(prefix="/api/v2/search", tags=["Global Search"])

_STATS_CACHE = {"data": None, "timestamp": 0}

@router.get("/stats", response_model=Dict[str, int])
async def get_database_statistics(db: AsyncSession = Depends(get_db)):
    current_time = time.time()
    if _STATS_CACHE["data"] and (current_time - _STATS_CACHE["timestamp"] < 3600):
        return _STATS_CACHE["data"]

    prot_res = await db.execute(select(func.count(Protein.uniprot_id)))
    site_res = await db.execute(select(func.count(Site.site_id)))
    enz_res = await db.execute(select(func.count(Enzyme.enzyme_id)))

    data = {
        "total_proteins": prot_res.scalar() or 0,
        "total_sites": site_res.scalar() or 0,
        "total_enzymes": enz_res.scalar() or 0
    }
    
    _STATS_CACHE["data"] = data
    _STATS_CACHE["timestamp"] = current_time
    return data

@router.get("", response_model=GlobalSearchResponse)
async def search_global(
    q: str = Query(..., min_length=2, description="Search Accession, Gene, Protein, Enzyme, or PTM"),
    limit: int = Query(10, le=50, description="Max results per category"),
    db: AsyncSession = Depends(get_db)
):
    # Ranks exact matches first, then prefix matches, then substrings
    exact_match = case((Protein.uniprot_id == q, 1), (Protein.gene_name == q, 2), else_=4)
    prefix_match = case((Protein.uniprot_id.startswith(q, autoescape=True), 1), (Protein.gene_name.startswith(q, autoescape=True), 2), else_=4)
    
    prot_stmt = (
        select(Protein.uniprot_id, Protein.protein_name, Protein.gene_name)
        .where(
            Protein.uniprot_id.contains(q, autoescape=True) |
            Protein.protein_name.contains(q, autoescape=True) |
            Protein.gene_name.contains(q, autoescape=True)
        )
        .order_by(exact_match, prefix_match, Protein.uniprot_id)
        .limit(limit)
    )
    prot_res = await db.execute(prot_stmt)
    proteins = [ProteinSummary(uniprot_id=r.uniprot_id, protein_name=r.protein_name, gene_name=r.gene_name) for r in prot_res.all()]

    enz_stmt = (
        select(Enzyme)
        .where(
            Enzyme.enzyme_id.contains(q, autoescape=True) |
            Enzyme.enzyme_name.contains(q, autoescape=True) |
            Enzyme.kinase_family.contains(q, autoescape=True)
        )
        .order_by(Enzyme.enzyme_name)
        .limit(limit)
    )
    enzymes = (await db.execute(enz_stmt)).scalars().all()

    ptm_stmt = (
        select(PTM)
        .where(PTM.ptm_type.contains(q, autoescape=True))
        .order_by(PTM.ptm_type)
        .limit(limit)
    )
    ptms = (await db.execute(ptm_stmt)).scalars().all()

    return {"proteins": proteins, "enzymes": enzymes, "ptms": ptms}