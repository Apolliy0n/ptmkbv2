from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload, selectinload
from typing import List, Optional

from app.database import get_db
from app.deps import parse_status
from app.models import PTM, Site, PropensityScore, CurationStatusEnum
from app.schemas import PTMBase, SiteDetail

router = APIRouter(prefix="/api/v2/ptms", tags=["Modifications"])

@router.get("", response_model=List[PTMBase])
async def get_all_ptms(db: AsyncSession = Depends(get_db)):
    stmt = select(PTM).order_by(PTM.ptm_type.asc())
    result = await db.execute(stmt)
    return result.scalars().all()

@router.get("/{ptm_type}/sites", response_model=List[SiteDetail])
async def get_sites_by_ptm(
    ptm_type: str,
    statuses: Optional[List[CurationStatusEnum]] = Depends(parse_status),
    skip: int = Query(0, description="Pagination offset"),
    limit: int = Query(100, le=1000, description="Max results per page"),
    db: AsyncSession = Depends(get_db)
):
    """Allows listing of all sites globally across a specific PTM type (e.g. all Acetylations)"""
    check_stmt = select(PTM.ptm_id).where(PTM.ptm_type == ptm_type)
    ptm_id = (await db.execute(check_stmt)).scalar_one_or_none()
    if not ptm_id:
        raise HTTPException(status_code=404, detail=f"PTM '{ptm_type}' not found.")

    stmt = select(Site).where(Site.ptm_id == ptm_id)
    if statuses:
        stmt = stmt.where(Site.curation_status.in_(statuses))

    stmt = stmt.options(
        joinedload(Site.ptm),
        joinedload(Site.neighborhood),
        selectinload(Site.structures),
        selectinload(Site.propensity_scores).joinedload(PropensityScore.enzyme)
    ).order_by(Site.site_id.asc()).offset(skip).limit(limit)

    result = await db.execute(stmt)
    return result.unique().scalars().all()