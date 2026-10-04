from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload, selectinload
from typing import List, Optional
import asyncio

from app.database import get_db
from app.deps import parse_status
from app.models import Protein, Site, Structure, PropensityScore, PTM, CurationStatusEnum
from app.schemas import (
    ProteinDetail, SiteDetail, SiteTrack, StructureWithSite, PDBEntry, ProteinDashboardSummary
)
from app.services.residue_features import NotFound, Upstream

router = APIRouter(prefix="/api/v2/proteins", tags=["Proteins & Sites"])


async def _require_protein(db: AsyncSession, uniprot_id: str) -> None:
    found = (await db.execute(
        select(Protein.uniprot_id).where(Protein.uniprot_id == uniprot_id)
    )).scalar_one_or_none()
    if not found:
        raise HTTPException(status_code=404, detail=f"Protein '{uniprot_id}' not found.")


def _site_conditions(
    uniprot_id: str,
    statuses: Optional[List[CurationStatusEnum]],
    ptm_type: Optional[str],
    start_pos: Optional[int],
    end_pos: Optional[int],
) -> list:
    if start_pos is not None and end_pos is not None and start_pos > end_pos:
        raise HTTPException(status_code=422, detail="start_pos must be <= end_pos.")
    conds = [Site.uniprot_id == uniprot_id]
    if statuses:
        conds.append(Site.curation_status.in_(statuses))
    if ptm_type:
        conds.append(Site.ptm.has(PTM.ptm_type == ptm_type))  # EXISTS; avoids a second join to PTM
    if start_pos is not None:
        conds.append(Site.position >= start_pos)
    if end_pos is not None:
        conds.append(Site.position <= end_pos)
    return conds


@router.get("/{uniprot_id}", response_model=ProteinDetail)
async def get_protein_base(uniprot_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Protein).where(Protein.uniprot_id == uniprot_id))
    protein = result.scalars().first()
    if not protein:
        raise HTTPException(status_code=404, detail=f"Protein '{uniprot_id}' not found.")
    return protein


@router.get("/{uniprot_id}/summary", response_model=ProteinDashboardSummary)
async def get_protein_summary(uniprot_id: str, db: AsyncSession = Depends(get_db)):
    """Charting metrics for the dashboard without loading heavy payloads."""
    await _require_protein(db, uniprot_id)

    cur_stmt = (
        select(Site.curation_status, func.count(Site.site_id))
        .where(Site.uniprot_id == uniprot_id)
        .group_by(Site.curation_status)
    )
    by_curation = {status.value: count for status, count in (await db.execute(cur_stmt)).all()}

    ptm_stmt = (
        select(PTM.ptm_type, func.count(Site.site_id))
        .join(Site, Site.ptm_id == PTM.ptm_id)
        .where(Site.uniprot_id == uniprot_id)
        .group_by(PTM.ptm_type)
    )
    by_ptm = {ptm: count for ptm, count in (await db.execute(ptm_stmt)).all()}

    return {
        "uniprot_id": uniprot_id,
        "total_sites": sum(by_curation.values()),
        "by_curation": by_curation,
        "by_ptm": by_ptm,
    }


@router.get("/{uniprot_id}/sites/track", response_model=List[SiteTrack])
async def get_protein_site_track(
    uniprot_id: str,
    statuses: Optional[List[CurationStatusEnum]] = Depends(parse_status),
    ptm_type: Optional[str] = Query(None, description="Exact PTM type string"),
    start_pos: Optional[int] = Query(None, ge=1),
    end_pos: Optional[int] = Query(None, ge=1),
    db: AsyncSession = Depends(get_db),
):
    """
    Lightweight, unpaginated list of every site (position, residue, PTM, status).
    Use this to draw the full 1D sequence track in one call, then lazy-load details
    per site from /sites.
    """
    await _require_protein(db, uniprot_id)
    conds = _site_conditions(uniprot_id, statuses, ptm_type, start_pos, end_pos)

    stmt = (
        select(Site.site_id, Site.position, Site.target_residue, PTM.ptm_type, Site.curation_status)
        .join(PTM, Site.ptm_id == PTM.ptm_id)
        .where(*conds)
        .order_by(Site.position.asc(), Site.site_id.asc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        SiteTrack(
            site_id=r.site_id, position=r.position, target_residue=r.target_residue,
            ptm_type=r.ptm_type, curation_status=r.curation_status,
        )
        for r in rows
    ]


@router.get("/{uniprot_id}/sites", response_model=List[SiteDetail])
async def get_protein_sites(
    uniprot_id: str,
    response: Response,
    statuses: Optional[List[CurationStatusEnum]] = Depends(parse_status),
    ptm_type: Optional[str] = Query(None, description="Exact PTM type string"),
    start_pos: Optional[int] = Query(None, ge=1, description="Start of position range"),
    end_pos: Optional[int] = Query(None, ge=1, description="End of position range"),
    min_score: Optional[float] = Query(
        None,
        description="Keep sites having at least one score >= this value. "
                    "Note: each returned site still lists ALL of its scores.",
    ),
    has_structure: Optional[bool] = Query(None, description="true = only sites with 3D structures, false = only without"),
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(100, ge=1, le=1000, description="Max results per page"),
    db: AsyncSession = Depends(get_db),
):
    """Paginated, filterable site details. Total match count is in the X-Total-Count header."""
    await _require_protein(db, uniprot_id)
    conds = _site_conditions(uniprot_id, statuses, ptm_type, start_pos, end_pos)

    if has_structure is True:
        conds.append(Site.structures.any())
    elif has_structure is False:
        conds.append(~Site.structures.any())
    if min_score is not None:
        conds.append(Site.propensity_scores.any(PropensityScore.evidence_score >= min_score))

    total = (await db.execute(select(func.count(Site.site_id)).where(*conds))).scalar() or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = (
        select(Site)
        .where(*conds)
        .options(
            joinedload(Site.ptm),
            joinedload(Site.neighborhood),
            selectinload(Site.structures),
            selectinload(Site.propensity_scores).joinedload(PropensityScore.enzyme),
        )
        .order_by(Site.position.asc(), Site.site_id.asc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.unique().scalars().all()


@router.get("/{uniprot_id}/structures", response_model=List[StructureWithSite])
async def get_protein_structures(uniprot_id: str, db: AsyncSession = Depends(get_db)):
    """
    Every structure row for the protein, tagged with its site_id and residue position.
    Best resolution first; structures without a resolution (e.g. NMR) come last.
    """
    await _require_protein(db, uniprot_id)
    stmt = (
        select(Structure, Site.position)
        .join(Site, Structure.site_id == Site.site_id)
        .where(Site.uniprot_id == uniprot_id)
        .order_by(Structure.resolution.is_(None), Structure.resolution.asc(), Structure.structure_id.asc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        StructureWithSite(
            structure_id=s.structure_id, site_id=s.site_id, pdb_id=s.pdb_id, chain_id=s.chain_id,
            resolution=s.resolution, modified_pdb_uri=s.modified_pdb_uri,
            atom_validation_score=s.atom_validation_score, position=pos,
        )
        for s, pos in rows
    ]


@router.get("/{uniprot_id}/pdb-entries", response_model=List[PDBEntry])
async def get_protein_pdb_entries(uniprot_id: str, db: AsyncSession = Depends(get_db)):
    """Distinct PDB entry/chain pairs for the protein, with the number of sites mapped to each."""
    await _require_protein(db, uniprot_id)
    best_res = func.min(Structure.resolution)
    stmt = (
        select(
            Structure.pdb_id,
            Structure.chain_id,
            best_res.label("resolution"),
            func.count(func.distinct(Structure.site_id)).label("site_count"),
        )
        .join(Site, Structure.site_id == Site.site_id)
        .where(Site.uniprot_id == uniprot_id)
        .group_by(Structure.pdb_id, Structure.chain_id)
        .order_by(best_res.is_(None), best_res.asc(), Structure.pdb_id.asc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        PDBEntry(pdb_id=r.pdb_id, chain_id=r.chain_id, resolution=r.resolution, site_count=r.site_count)
        for r in rows
    ]

@router.get("/{uniprot_id}/features")
async def get_features(
    uniprot_id: str, request: Request, response: Response,
    positions: Optional[str] = Query(None, max_length=4000),
    residues: bool = True,
    ptms: Optional[str] = Query(None, max_length=500, description="comma-separated PTM names"),
):
    try:
        full = await request.app.state.features.get(uniprot_id)
    except ValueError:
        raise HTTPException(400, "Invalid UniProt accession.")
    except NotFound:
        raise HTTPException(404, "No AlphaFold model for this accession.")
    except Upstream:
        raise HTTPException(502, "AlphaFold DB unreachable.")
    response.headers["Cache-Control"] = "public, max-age=86400"
    if not residues:
        return {"uniprot_id": full["uniprot_id"], "protein": full["protein"]}

    res = full["residues"]
    seq = "".join(res[k]["aa"] for k in sorted(res, key=int))
    if positions:
        want = {p.strip() for p in positions.split(",") if p.strip().isdigit()}
        res = {k: v for k, v in res.items() if k in want}
    only = {p.strip() for p in ptms.split(",") if p.strip()} if ptms else None
    tables = request.app.state.propensity

    def attach():
        return {k: {**v, "propensity": tables.for_residue(seq, int(k), only)} for k, v in res.items()}

    return {**full, "residues": await asyncio.to_thread(attach)}