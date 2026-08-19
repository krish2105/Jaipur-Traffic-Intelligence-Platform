"""Runtime configuration. Nothing secret is ever defaulted to a real value."""

from __future__ import annotations

from functools import lru_cache

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Settings reads .env by itself, but only into this object. The source adapters
# read os.environ directly, because they are a standalone package with no reason
# to depend on the API's configuration. So a key written to .env by
# scripts/set_keys.sh reached Settings and never reached the adapters, and the
# readiness panel stayed amber for a credential that was sitting right there.
# Nothing already exported is overwritten: a real environment still wins over a
# developer's file.
load_dotenv(".env", override=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    pravaah_env: str = "development"
    pravaah_source_mode: str = "replay"

    database_url: str = "postgresql+asyncpg://pravaah:pravaah@localhost:5433/pravaah"
    database_url_readonly: str = "postgresql+asyncpg://pravaah_ro:pravaah_ro@localhost:5433/pravaah"
    db_statement_timeout_ms: int = 5000
    db_row_cap: int = 10000

    redis_url: str = "redis://localhost:6379/0"

    #: docs plan §9 — every demo affordance is build-gated so none can exist in
    #: a production bundle. The role switcher especially.
    demo_mode: bool = True
    demo_role_switcher: bool = True

    cors_origins: str = "http://localhost:3000"

    @property
    def is_production(self) -> bool:
        return self.pravaah_env == "production"

    @property
    def async_dsn(self) -> str:
        return self.database_url

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
