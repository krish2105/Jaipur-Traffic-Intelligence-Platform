"""PRAVAAH API.

docs/07 §5 application security: strict CORS, security headers, and a hard stop
on demo affordances in production.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core.db import dispose
from .core.settings import get_settings
from .routers import decisions, live, neeti, system, traffic

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    if settings.is_production and settings.demo_mode:
        # Fail to start rather than serve a production instance with the role
        # switcher live. A demo affordance in production is an auth bypass.
        msg = "DEMO_MODE must be false when PRAVAAH_ENV=production"
        raise RuntimeError(msg)
    yield
    await dispose()


app = FastAPI(
    title="PRAVAAH API",
    description=(
        "Traffic decision intelligence for Jaipur. Every measurement response "
        "carries its data quality; no naked numbers."
    ),
    version="0.1.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "X-Demo-Role", "X-Demo-Corridors"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


@app.exception_handler(Exception)
async def unhandled(_request: Request, exc: Exception) -> JSONResponse:
    # Never leak an internal error message to a client — it can carry schema or
    # connection detail. The real error still goes to the logs.
    return JSONResponse(status_code=500, content={"detail": "internal error"})


app.include_router(system.router, prefix="/api/v1")
app.include_router(traffic.router, prefix="/api/v1")
app.include_router(decisions.router, prefix="/api/v1")
app.include_router(neeti.router, prefix="/api/v1")
# No prefix: the WebSocket path is /ws/live, which clients hardcode.
app.include_router(live.router)
