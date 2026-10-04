from dotenv import load_dotenv
load_dotenv()

import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy.exc import OperationalError, TimeoutError as SATimeoutError
from sqlalchemy import text

from app.database import engine
from app.integrity import run_integrity_check
from app.routers import search, proteins, enzymes, export, ptms
from app.services.ptm_propensity import PropensityTables
from app.services.residue_features import ResidueFeatureService

# No-op if uvicorn/your launcher already configured logging handlers
logging.basicConfig(level=os.environ.get("PTM_LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.features = ResidueFeatureService()
    await app.state.features.start()
    app.state.propensity = PropensityTables()
    n = app.state.propensity.load(os.environ.get("PTM_TABLES_DIR", "ptm_tables"))
    if n == 0:
        logger.warning("No propensity tables found in PTM_TABLES_DIR; logSum/logLogProduct will be empty")
    # The integrity scan reads every site + sequence, so it is opt-in at startup.
    # Preferred: run `python -m scripts.check_integrity` after data loads.
    if os.environ.get("PTM_STARTUP_INTEGRITY_CHECK", "0") == "1":
        try:
            await run_integrity_check()
        except Exception:
            logger.exception("Startup integrity check failed to run")
    yield
    await app.state.features.close()
    await engine.dispose()


app = FastAPI(
    title="Spatio-PTM API",
    description="Asynchronous backend for spatially mapped Post-Translational Modifications.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

# Optional rate limiting: set PTM_RATE_LIMIT, e.g. "120/minute" (requires `pip install slowapi`)
RATE_LIMIT = os.environ.get("PTM_RATE_LIMIT")
if RATE_LIMIT:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware
    from slowapi.util import get_remote_address

    app.state.limiter = Limiter(key_func=get_remote_address, default_limits=[RATE_LIMIT])
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

FRONTEND_URLS = os.environ.get("PTM_CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
origins = [url.strip() for url in FRONTEND_URLS.split(",") if url.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials="*" not in origins,  # browsers reject '*' combined with credentials
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "Content-Disposition"],  # lets the browser frontend read pagination totals
)


@app.exception_handler(OperationalError)
async def db_connection_exception_handler(request: Request, exc: OperationalError):
    logger.error("Database connection error: %s", exc)
    return JSONResponse(
        status_code=503,
        content={"detail": "Service Unavailable: Database connection failed. Please try again."},
    )


@app.exception_handler(SATimeoutError)
async def db_pool_timeout_handler(request: Request, exc: SATimeoutError):
    logger.error("Database pool exhausted: %s", exc)
    return JSONResponse(
        status_code=503,
        content={"detail": "Service Unavailable: server is busy. Please retry shortly."},
    )


app.include_router(search.router)
app.include_router(proteins.router)
app.include_router(enzymes.router)
app.include_router(export.router)
app.include_router(ptms.router)


@app.get("/health", tags=["System"])
async def health_check():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Health check: database unreachable")
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "database": "disconnected", "version": "v2"},
        )
    return {"status": "online", "database": "connected", "version": "v2"}