from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import joinedload
from typing import List, Optional

from app.database import get_db
from app.models import Enzyme, PropensityScore, Site
from app.schemas import EnzymeBase, PaginatedSubstrates

router = APIRouter(prefix="/api/v2/enzymes", tags=["Enzyme Networks"])

@router.get("", response_model=List[EnzymeBase])
async def get_all_enzymes(
    q: Optional[str] = Query(None, description="Search enzyme name"),
    family: Optional[str] = Query(None, description="Filter by kinase family"),
    skip: int = Query(0, description="Pagination offset"),
    limit: int = Query(100, le=500, description="Max results per page"),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Enzyme)
    if q:
        stmt = stmt.where(Enzyme.enzyme_name.contains(q, autoescape=True))
    if family:
        stmt = stmt.where(Enzyme.kinase_family == family)
        
    stmt = stmt.order_by(Enzyme.enzyme_name.asc(), Enzyme.enzyme_id.asc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

@router.get("/{enzyme_id}", response_model=EnzymeBase)
async def get_enzyme_details(enzyme_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Enzyme).where(Enzyme.enzyme_id == enzyme_id)
    result = await db.execute(stmt)
    enzyme = result.scalars().first()
    
    if not enzyme:
        raise HTTPException(status_code=404, detail=f"Enzyme '{enzyme_id}' not found.")
    return enzyme

@router.get("/{enzyme_id}/substrates", response_model=PaginatedSubstrates)
async def get_enzyme_substrates(
    enzyme_id: str, 
    matrix_version: Optional[str] = Query(None, description="Filter by matrix (e.g. iPTMnet_2026)"),
    min_score: Optional[float] = Query(None, description="Minimum evidence score"),
    skip: int = Query(0, description="Pagination offset"),
    limit: int = Query(100, le=1000, description="Max results per page"),
    db: AsyncSession = Depends(get_db)
):
    check_stmt = select(Enzyme.enzyme_id).where(Enzyme.enzyme_id == enzyme_id)
    if not (await db.execute(check_stmt)).scalar_one_or_none():
        raise HTTPException(status_code=404, detail=f"Enzyme '{enzyme_id}' not found.")

    where_clauses = [PropensityScore.enzyme_id == enzyme_id]
    if matrix_version:
        where_clauses.append(PropensityScore.matrix_version == matrix_version)
    if min_score is not None:
        where_clauses.append(PropensityScore.evidence_score >= min_score)
        
    # Total count for frontend table pagination
    count_stmt = select(func.count(PropensityScore.score_id)).where(and_(*where_clauses))
    total_count = (await db.execute(count_stmt)).scalar() or 0

    stmt = (
        select(PropensityScore)
        .where(and_(*where_clauses))
        .options(
            joinedload(PropensityScore.site).joinedload(Site.protein),
            joinedload(PropensityScore.site).joinedload(Site.ptm),
        )
        # Fixed tie-breaker logic
        .order_by(PropensityScore.evidence_score.desc(), PropensityScore.score_id.asc())
        .offset(skip)
        .limit(limit)
    )
    
    result = await db.execute(stmt)
    scores = result.unique().scalars().all()
    
    payload = []
    for score in scores:
        payload.append({
            "site_id": score.site_id,
            "substrate_uniprot_id": score.site.protein.uniprot_id,
            "substrate_name": score.site.protein.protein_name,
            "modification": score.site.ptm.ptm_type,
            "target_residue": score.site.target_residue,
            "position": score.site.position,
            "evidence_score": float(score.evidence_score) if score.evidence_score is not None else None,
            "matrix_version": score.matrix_version,
            "curation_status": score.site.curation_status.value
        })
        
    return {"total": total_count, "items": payload}