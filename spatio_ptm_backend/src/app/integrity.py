import logging
from sqlalchemy import text
from app.database import engine

logger = logging.getLogger(__name__)

# A site whose residue letter doesn't match the sequence at its position is a data bug.
# A position beyond the sequence length yields '' and is flagged too.
_MISMATCH_FROM = (
    "FROM Site s JOIN Protein p ON s.uniprot_id = p.uniprot_id "
    "WHERE SUBSTRING(p.sequence, s.position, 1) <> s.target_residue"
)


async def run_integrity_check(sample_size: int = 50) -> int:
    """Returns the TOTAL number of mismatched sites (logs up to `sample_size` examples)."""
    async with engine.connect() as conn:
        total = (await conn.execute(text(f"SELECT COUNT(*) {_MISMATCH_FROM}"))).scalar() or 0
        if total == 0:
            logger.info("Integrity check: all sites align with their protein sequences.")
            return 0

        logger.error("Integrity check: %d sites do not match their protein sequence.", total)
        rows = (await conn.execute(
            text(
                "SELECT s.site_id, s.uniprot_id, s.position, s.target_residue, "
                "SUBSTRING(p.sequence, s.position, 1) AS actual "
                f"{_MISMATCH_FROM} LIMIT :n"
            ),
            {"n": sample_size},
        )).all()
        for r in rows:
            logger.error(
                "Site %s (%s pos %s): DB says '%s', sequence has '%s'",
                r.site_id, r.uniprot_id, r.position, r.target_residue, r.actual,
            )
        return total