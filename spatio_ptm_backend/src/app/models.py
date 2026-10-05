import enum
from datetime import date, datetime
from typing import List, Optional
from sqlalchemy import (
    String, Integer, Text, Date, DateTime, Numeric,
    ForeignKey, UniqueConstraint, Enum, func, Index
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class CurationStatusEnum(str, enum.Enum):
    EXPERIMENTALLY_VERIFIED = "Experimentally-Verified"
    CONSENSUS_PREDICTED = "Consensus-Predicted"
    UNIPROT_PREDICTED = "UniProt-Predicted"
    VALIDATION_PENDING = "Validation-Pending"


class Protein(Base):
    __tablename__ = "Protein"

    uniprot_id: Mapped[str] = mapped_column(String(15), primary_key=True)
    protein_name: Mapped[str] = mapped_column(String(255), nullable=False)
    gene_name: Mapped[Optional[str]] = mapped_column(String(100))
    organism: Mapped[Optional[str]] = mapped_column(String(512), default="Homo sapiens")
    sequence: Mapped[str] = mapped_column(Text, nullable=False)
    last_updated: Mapped[Optional[date]] = mapped_column(Date)

    sites: Mapped[List["Site"]] = relationship(
        "Site", back_populates="protein", cascade="all, delete-orphan", passive_deletes=True
    )
    # FK is ON DELETE SET NULL, so let the database handle it
    enzymes: Mapped[List["Enzyme"]] = relationship(
        "Enzyme", back_populates="protein_record", passive_deletes=True
    )


class PTM(Base):
    __tablename__ = "PTM"

    ptm_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ptm_type: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    target_residues: Mapped[str] = mapped_column(String(64), nullable=False)

    sites: Mapped[List["Site"]] = relationship("Site", back_populates="ptm")


class Enzyme(Base):
    __tablename__ = "Enzyme"

    enzyme_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    enzyme_name: Mapped[str] = mapped_column(String(255), nullable=False)
    uniprot_acc: Mapped[Optional[str]] = mapped_column(String(15), ForeignKey("Protein.uniprot_id", ondelete="SET NULL"))
    ec_number: Mapped[Optional[str]] = mapped_column(String(20))
    kinase_family: Mapped[Optional[str]] = mapped_column(String(100))

    protein_record: Mapped[Optional["Protein"]] = relationship("Protein", back_populates="enzymes")
    propensity_scores: Mapped[List["PropensityScore"]] = relationship(
        "PropensityScore", back_populates="enzyme", cascade="all, delete-orphan", passive_deletes=True
    )


class Site(Base):
    __tablename__ = "Site"
    __table_args__ = (UniqueConstraint("uniprot_id", "position", "ptm_id", name="unique_protein_site_ptm"),)

    site_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uniprot_id: Mapped[str] = mapped_column(String(15), ForeignKey("Protein.uniprot_id", ondelete="CASCADE"), nullable=False)
    ptm_id: Mapped[int] = mapped_column(Integer, ForeignKey("PTM.ptm_id", ondelete="RESTRICT"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    target_residue: Mapped[str] = mapped_column(String(1), nullable=False)

    # values_callable guarantees exact string matching for the MySQL ENUM mapping
    curation_status: Mapped[CurationStatusEnum] = mapped_column(
        Enum(CurationStatusEnum, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False
    )

    raw_sources: Mapped[Optional[str]] = mapped_column(String(255))
    eco_codes: Mapped[Optional[str]] = mapped_column(Text)
    evidence_ids: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    protein: Mapped["Protein"] = relationship("Protein", back_populates="sites")
    ptm: Mapped["PTM"] = relationship("PTM", back_populates="sites")
    neighborhood: Mapped[Optional["Neighborhood"]] = relationship(
        "Neighborhood", back_populates="site", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )
    structures: Mapped[List["Structure"]] = relationship(
        "Structure", back_populates="site", cascade="all, delete-orphan", passive_deletes=True
    )
    propensity_scores: Mapped[List["PropensityScore"]] = relationship(
        "PropensityScore", back_populates="site", cascade="all, delete-orphan", passive_deletes=True
    )


class Neighborhood(Base):
    __tablename__ = "Neighborhood"

    site_id: Mapped[int] = mapped_column(Integer, ForeignKey("Site.site_id", ondelete="CASCADE"), primary_key=True)
    local_window: Mapped[str] = mapped_column(String(150), nullable=False)
    window_size: Mapped[int] = mapped_column(Integer, default=10, nullable=False)

    # asdecimal=False returns native floats instead of Decimal
    hydrophobicity: Mapped[Optional[float]] = mapped_column(Numeric(6, 3, asdecimal=False))
    net_charge: Mapped[Optional[float]] = mapped_column(Numeric(6, 3, asdecimal=False))
    aromaticity: Mapped[Optional[float]] = mapped_column(Numeric(6, 3, asdecimal=False))
    isoelectric_point: Mapped[Optional[float]] = mapped_column(Numeric(6, 3, asdecimal=False))

    site: Mapped["Site"] = relationship("Site", back_populates="neighborhood")


class Structure(Base):
    __tablename__ = "Structure"

    structure_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(Integer, ForeignKey("Site.site_id", ondelete="CASCADE"), nullable=False)
    pdb_id: Mapped[str] = mapped_column(String(10), nullable=False)
    chain_id: Mapped[Optional[str]] = mapped_column(String(2))
    resolution: Mapped[Optional[float]] = mapped_column(Numeric(4, 2, asdecimal=False))
    modified_pdb_uri: Mapped[Optional[str]] = mapped_column(String(512))
    atom_validation_score: Mapped[Optional[float]] = mapped_column(Numeric(6, 3, asdecimal=False))

    site: Mapped["Site"] = relationship("Site", back_populates="structures")


class PropensityScore(Base):
    __tablename__ = "PropensityScore"
    __table_args__ = (
        UniqueConstraint("site_id", "enzyme_id", "matrix_version", name="unique_site_enzyme_matrix"),
        # Serves: WHERE enzyme_id = ? ORDER BY evidence_score DESC
        Index("idx_propensity_enzyme_score", "enzyme_id", "evidence_score"),
    )

    score_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(Integer, ForeignKey("Site.site_id", ondelete="CASCADE"), nullable=False)
    enzyme_id: Mapped[str] = mapped_column(String(50), ForeignKey("Enzyme.enzyme_id", ondelete="CASCADE"), nullable=False)
    evidence_score: Mapped[Optional[float]] = mapped_column(Numeric(10, 4, asdecimal=False))
    matrix_version: Mapped[str] = mapped_column(String(100), nullable=False)
    calculated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    site: Mapped["Site"] = relationship("Site", back_populates="propensity_scores")
    enzyme: Mapped["Enzyme"] = relationship("Enzyme", back_populates="propensity_scores")