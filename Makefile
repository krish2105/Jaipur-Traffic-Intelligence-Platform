# PRAVAAH — see docs/08 §3 for the command contract.
SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help install dev api web worker seed test lint typecheck contracts \
        up down status migrate demo-reset train eval replay sim audit verify-security \
        pitch-pdf

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "  \033[1m%-24s\033[0m %s\n", $$1, $$2}'

install: ## Install all Python and Node dependencies
	uv sync --all-packages
	pnpm install

dev: up ## Start the local stack, then print where things live
	@echo "api → http://localhost:8001/api/v1/docs"
	@echo "web → http://localhost:3000"

up: ## Start the local stack (postgres+timescale, redis, minio). No Docker.
	bash scripts/dev_stack.sh up

down: ## Stop the local stack
	bash scripts/dev_stack.sh down

status: ## Show local stack status and installed Postgres extensions
	bash scripts/dev_stack.sh status

api: ## Run the API with reload
	uv run uvicorn pravaah.api.main:app --reload --port 8001

worker: ## Run the background worker
	uv run python -m pravaah.worker

web: ## Run the Next.js frontend
	pnpm --filter @pravaah/web dev

migrate: ## Apply database migrations
	uv run alembic -c apps/api/alembic.ini upgrade head

seed: ## Load seed data (docs/05 §5). Every row is_synthetic = true.
	uv run python -m scripts.seed

contracts: ## Regenerate TypeScript types from Pydantic (docs/03 §6)
	uv run python scripts/generate_ts_contracts.py

test: ## Run the full test suite
	uv run pytest
	pnpm --filter @pravaah/web test

lint: ## Lint Python and TypeScript
	uv run ruff check .
	uv run ruff format --check .
	pnpm --filter @pravaah/web lint

typecheck: ## Type-check Python and TypeScript
	uv run mypy packages apps/api/src apps/worker/src
	pnpm --filter @pravaah/web typecheck

audit: ## Security scan — dependencies, secrets, SAST, plate leakage
	uv run pip-audit
	uv run bandit -c pyproject.toml -r packages apps
	pnpm audit --audit-level high || true
	bash scripts/check_no_plates_in_logs.sh
	bash scripts/check_no_ultralytics.sh

verify-security: ## Prove the DB-level security controls hold (docs/07 §8)
	uv run python scripts/verify_security.py

demo-refresh: ## Fresh probe reading -> snapshot -> deploy. Run before a demo.
	bash scripts/demo_refresh.sh

probe-discover: ## Map corridor links to TomTom segments. Once, ~90 calls.
	uv run python scripts/fetch_probe_speeds.py --discover

probe: ## Sweep live probe speeds. 25 calls; run every 45 min, 06:00-22:00 IST.
	uv run python scripts/fetch_probe_speeds.py

replay: ## Replay a camera's video through GANANA. usage: make replay CAMERA=1
	uv run python -m pravaah.worker.ingest.replay --camera $(CAMERA)

train: ## Train a model. usage: make train MODEL=m1_detector
	uv run python ml/training/$(MODEL).py

eval: ## Evaluate a model and write its card. usage: make eval MODEL=m1_detector
	uv run python ml/evaluation/$(MODEL).py

sim: ## Run a SUMO scenario. usage: make sim SCENARIO=sim/scenarios/median.yaml
	uv run python -m pravaah.drishti.twin.run --scenario $(SCENARIO)

demo-reset: ## Restore pristine demo state (docs plan §9)
	bash scripts/demo_reset.sh

# Rebuild the pitch and script PDFs from their HTML. The PDFs are what gets
# handed to an official and the HTML is what gets edited; nothing connected the
# two, so a corrected claim once survived only in the HTML while both PDFs still
# argued the retracted version (ADR-064).
pitch-pdf: ## Rebuild docs/pitch/*.pdf from their HTML, and check the claims match
	bash scripts/build_pitch_pdfs.sh
