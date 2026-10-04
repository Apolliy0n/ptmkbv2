from typing import List, Optional

from fastapi import HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CurationStatusEnum, Protein

# Strict UniProt accession / isoform format (also prevents header injection in filenames)
UNIPROT_RE = r"^[A-Za-z0-9\-]{1,15}$"


def parse_status(
    status: Optional[str] = Query(None, description="Comma-separated curation statuses")
) -> Optional[List[CurationStatusEnum]]:
    """Centralized parsing and validation for the curation status filter."""
    if not status:
        return None
    try:
        return [CurationStatusEnum(s.strip()) for s in status.split(",") if s.strip()]
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Invalid curation status provided. {e}")


async def ensure_protein_exists(db: AsyncSession, uniprot_id: str) -> None:
    """Raises 404 if the protein is not in the database."""
    stmt = select(Protein.uniprot_id).where(Protein.uniprot_id == uniprot_id)
    if (await db.execute(stmt)).scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Protein '{uniprot_id}' not found.")