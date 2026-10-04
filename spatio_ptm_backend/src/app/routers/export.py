import csv
import io
from fastapi import APIRouter, Depends, Path, HTTPException
from fastapi.responses import StreamingResponse, PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from typing import Optional, List

from app.database import get_db
from app.deps import parse_status
from app.models import Protein, Site, CurationStatusEnum

router = APIRouter(prefix="/api/v2/export", tags=["Data Export"])

# Prevents HTTP Header Injection in Content-Disposition
UNIPROT_RE = r"^[A-Za-z0-9\-]{1,15}$"

def sanitize_csv(val):
    """Prevents CSV Formula Injection vulnerabilities in Excel/Calc"""
    if isinstance(val, str) and val.startswith(("=", "+", "-", "@")):
        return f"'{val}"
    return val if val is not None else ""

@router.get("/proteins/{uniprot_id}/sites.csv")
async def export_protein_sites_csv(
    uniprot_id: str = Path(..., pattern=UNIPROT_RE, description="Strict UniProt ID format"),
    statuses: Optional[List[CurationStatusEnum]] = Depends(parse_status),
    db: AsyncSession = Depends(get_db)
):
    check_stmt = select(Protein.uniprot_id).where(Protein.uniprot_id == uniprot_id)
    if not (await db.execute(check_stmt)).scalar_one_or_none():
        raise HTTPException(status_code=404, detail=f"Protein '{uniprot_id}' not found.")

    stmt = select(Site).where(Site.uniprot_id == uniprot_id)
    if statuses:
        stmt = stmt.where(Site.curation_status.in_(statuses))

    stmt = stmt.options(
        joinedload(Site.ptm),
        joinedload(Site.neighborhood)
    ).order_by(Site.position.asc(), Site.site_id.asc())
    
    result = await db.execute(stmt)
    sites_orm = result.unique().scalars().all()

    safe_data = []
    for site in sites_orm:
        safe_data.append([
            sanitize_csv(site.uniprot_id),
            site.position,
            sanitize_csv(site.target_residue),
            sanitize_csv(site.ptm.ptm_type if site.ptm else "Unknown"),
            sanitize_csv(site.curation_status.value),
            sanitize_csv(site.raw_sources),
            sanitize_csv(site.eco_codes),
            sanitize_csv(site.neighborhood.local_window if site.neighborhood else ""),
            site.neighborhood.hydrophobicity if site.neighborhood else "",
            site.neighborhood.net_charge if site.neighborhood else "",
            site.neighborhood.aromaticity if site.neighborhood else "",
            site.neighborhood.isoelectric_point if site.neighborhood else ""
        ])

    def iter_csv(data_rows):
        output = io.StringIO()
        writer = csv.writer(output)
        
        writer.writerow([
            "UniProt_ID", "Position", "Target_Residue", "PTM_Type", 
            "Curation_Status", "Raw_Sources", "ECO_Codes", 
            "Local_Window", "Hydrophobicity", "Net_Charge", "Aromaticity", "Isoelectric_Point"
        ])
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)
        
        for row in data_rows:
            writer.writerow(row)
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    # Added UTF-8 charset and strictly quoted filename
    response = StreamingResponse(iter_csv(safe_data), media_type="text/csv; charset=utf-8")
    response.headers["Content-Disposition"] = f'attachment; filename="{uniprot_id.upper()}_spatio_ptm_export.csv"'
    return response

@router.get("/proteins/{uniprot_id}/sequence.fasta")
async def export_protein_fasta(
    uniprot_id: str = Path(..., pattern=UNIPROT_RE), 
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Protein).where(Protein.uniprot_id == uniprot_id))
    protein = result.scalars().first()
    if not protein:
        raise HTTPException(status_code=404, detail="Protein not found")
    
    fasta_str = f">{protein.uniprot_id} | {protein.protein_name} | {protein.organism}\n{protein.sequence}\n"
    return PlainTextResponse(fasta_str)