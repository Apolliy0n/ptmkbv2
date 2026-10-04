import os
from urllib.parse import quote_plus
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base

DB_HOST = os.environ.get("PTM_DB_HOST", "localhost")
DB_PORT = os.environ.get("PTM_DB_PORT", "3306")
DB_USER = os.environ.get("PTM_DB_USER", "root")

try:
    DB_PASS = os.environ["PTM_DB_PASS"]
except KeyError:
    raise RuntimeError("CRITICAL: PTM_DB_PASS environment variable is missing.")

DB_NAME = os.environ.get("PTM_DB_NAME", "PTMUpdate")

# Added port and utf8mb4 charset
DATABASE_URL = f"mysql+aiomysql://{DB_USER}:{quote_plus(DB_PASS)}@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4"

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,
    pool_pre_ping=True
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session