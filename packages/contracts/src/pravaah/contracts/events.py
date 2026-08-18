"""Event schemas carried on the bus. docs/05 §2.

Two rules that are not negotiable:

1. **Topics are versioned in the name.** Never mutate a schema in place —
   publish `.v2` and dual-write.
2. **Raw plate strings never travel on the bus.** The edge encrypts the plate,
   writes ciphertext directly to the database over TLS, and puts only the
   salted hash on the bus. This limits blast radius if the broker is ever
   compromised (docs/07 §3).
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import ClassVar, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .enums import Direction, QualityFlag, ViolationType

SCHEMA_VERSION: Final = "1.0"

#: An Indian registration number, in the shapes that actually occur: two letters
#: for the state, one or two digits for the RTO, up to three letters for the
#: series and up to four digits, optionally separated by spaces or hyphens.
#: Deliberately written as a pattern and never as an example value — literal
#: plates in source are what scripts/check_no_plates_in_logs.sh exists to catch.
#: Used only to refuse data, never to parse it.
PLATE_PATTERN = re.compile(r"[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{1,4}")
HEX64_PATTERN = re.compile(r"[0-9a-f]{64}")


class Topic:
    """Bus topic names. Versioned; see docs/05 §2 for producers and retention."""

    COUNTS = "ganana.counts.v1"
    TURNING = "ganana.turning.v1"
    VIOLATIONS = "ganana.violations.v1"
    CONGESTION = "drishti.congestion.v1"
    INCIDENTS = "drishti.incidents.v1"
    FORECASTS = "drishti.forecasts.v1"
    ALERTS = "system.alerts.v1"
    AUDIT = "system.audit.v1"


class ClassCount(BaseModel):
    """Counts for one vehicle class within one bin, one direction."""

    model_config = ConfigDict(frozen=True)

    class_code: str
    vehicle_count: int = Field(ge=0)
    pcu: float = Field(ge=0)
    mean_speed_kmh: float | None = Field(default=None, ge=0, le=200)
    p85_speed_kmh: float | None = Field(default=None, ge=0, le=200)


class CountEvent(BaseModel):
    """Emitted once per 5-minute bin, per camera, per direction.

    `quality_score` drives suppression: bins below the policy threshold are
    excluded from policy outputs *and the suppression is shown in the UI*
    rather than hidden (docs/03 §3).
    """

    model_config = ConfigDict(frozen=True)

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    event_id: str
    camera_id: int
    link_id: int | None = None
    bucket_start: datetime
    bucket_seconds: int = 300
    direction: Direction
    counts: list[ClassCount]
    total_pcu: float = Field(ge=0)
    occupancy_pct: float | None = Field(default=None, ge=0, le=100)
    queue_length_m: float | None = Field(default=None, ge=0)
    quality_score: float = Field(ge=0, le=1)
    quality_flags: list[QualityFlag] = Field(default_factory=list)
    is_synthetic: bool = False
    model_version: str
    edge_node_id: str
    emitted_at: datetime

    @model_validator(mode="after")
    def pcu_must_match_class_sum(self) -> CountEvent:
        """A total that disagrees with its parts is a bug we want to find at the
        boundary, not three joins downstream in a policy brief."""
        expected = sum(c.pcu for c in self.counts)
        if abs(expected - self.total_pcu) > 0.05:
            msg = f"total_pcu {self.total_pcu} != sum of class pcu {expected:.2f}"
            raise ValueError(msg)
        return self


class TurningMovementEvent(BaseModel):
    """Entry-leg x exit-leg matrix for a junction. docs/04 §3 — this is what JDA
    actually needs for junction redesign, and most ITS deployments never
    produce it."""

    model_config = ConfigDict(frozen=True)

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    event_id: str
    junction_id: int
    bucket_start: datetime
    bucket_seconds: int = 300
    #: approach -> exit_leg -> class_code -> count
    matrix: dict[str, dict[str, dict[str, int]]]
    quality_score: float = Field(ge=0, le=1)
    is_synthetic: bool = False
    model_version: str
    emitted_at: datetime


class ViolationEvent(BaseModel):
    """A detected violation. Note what is absent: the plate itself.

    `requires_review` is True whenever OCR confidence is below the gate. A wrong
    challan is worse than a missed one — it generates a grievance, a news story,
    and a loss of trust that costs more than the fine (docs/04 §4).
    """

    model_config = ConfigDict(frozen=True)

    OCR_CONFIDENCE_GATE: ClassVar[float] = 0.85

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    event_id: str
    camera_id: int
    link_id: int | None = None
    occurred_at: datetime
    violation_type: ViolationType
    plate_hash: str
    ocr_confidence: float = Field(ge=0, le=1)
    detection_confidence: float = Field(ge=0, le=1)
    evidence_uri: str
    requires_review: bool
    is_synthetic: bool = False
    model_version: str
    emitted_at: datetime

    @model_validator(mode="after")
    def enforce_confidence_gate(self) -> ViolationEvent:
        """The 0.85 gate is a hard threshold, not a tunable (docs/04 §4).
        Below it, the event must be routed to human review."""
        if self.ocr_confidence < self.OCR_CONFIDENCE_GATE and not self.requires_review:
            msg = (
                f"ocr_confidence {self.ocr_confidence} is below the "
                f"{self.OCR_CONFIDENCE_GATE} gate but requires_review is False"
            )
            raise ValueError(msg)
        return self

    @field_validator("plate_hash", mode="before")
    @classmethod
    def must_be_an_hmac_digest(cls, value: object) -> str:
        """Defence in depth against a raw plate reaching the bus (docs/07 §3).

        The join key is an HMAC-SHA256 of the plate, salted with a key held in
        the edge keystore — so it is exactly 64 lowercase hex characters. Two
        checks, deliberately in this order: the plate-shaped one first, because
        its error message is the one an engineer needs to read.
        """
        if not isinstance(value, str):
            msg = "plate_hash must be a string"
            raise ValueError(msg)
        if PLATE_PATTERN.search(value):
            msg = (
                "plate_hash contains something plate-shaped; "
                "never put a raw registration number on the bus"
            )
            raise ValueError(msg)
        if not HEX64_PATTERN.fullmatch(value):
            msg = "plate_hash must be a 64-character lowercase hex HMAC-SHA256 digest"
            raise ValueError(msg)
        return value


class CongestionEvent(BaseModel):
    """Per-link congestion index. The formula is published (docs/03 §3) — a
    black-box index is unusable in a policy file; a published one becomes the
    number everyone quotes."""

    model_config = ConfigDict(frozen=True)

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    event_id: str
    link_id: int
    bucket_start: datetime
    congestion_index: float = Field(ge=0, le=100)
    vc_ratio: float | None = Field(default=None, ge=0)
    speed_ratio: float | None = Field(default=None, ge=0)
    queue_persistence: float | None = Field(default=None, ge=0, le=1)
    probe_delay_s: float | None = Field(default=None, ge=0)
    source_mix: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    emitted_at: datetime


class ForecastEvent(BaseModel):
    """A forecast is not decision-support without its uncertainty (docs/04 §5),
    so the 80% interval is required, not optional."""

    model_config = ConfigDict(frozen=True)

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    event_id: str
    link_id: int
    issued_at: datetime
    horizon_min: Literal[15, 30, 60]
    predicted_index: float = Field(ge=0, le=100)
    lower_80: float = Field(ge=0, le=100)
    upper_80: float = Field(ge=0, le=100)
    model_version: str

    @model_validator(mode="after")
    def interval_must_contain_point(self) -> ForecastEvent:
        if not (self.lower_80 <= self.predicted_index <= self.upper_80):
            msg = "predicted_index must lie inside its own 80% interval"
            raise ValueError(msg)
        return self


class AlertEvent(BaseModel):
    """Pushed to the dashboard over WebSocket within 2s (docs/03 §4)."""

    model_config = ConfigDict(frozen=True)

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    event_id: str
    alert_type: str
    severity: str
    link_id: int | None = None
    junction_id: int | None = None
    #: i18n key, never a rendered sentence — the client renders in the user's
    #: language (docs/06 §5: no hardcoded user-facing string, ever).
    message_key: str
    message_params: dict[str, str | int | float] = Field(default_factory=dict)
    occurred_at: datetime
    is_synthetic: bool = False


class AuditEvent(BaseModel):
    """Append-only. docs/07 §5: app roles hold INSERT only — no UPDATE, no
    DELETE grant. `reason_code` is required for sensitive actions."""

    model_config = ConfigDict(frozen=True)

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    event_id: str
    occurred_at: datetime
    actor_id: str
    actor_role: str
    action: str
    resource_type: str
    resource_id: str | None = None
    reason_code: str | None = None
    case_ref: str | None = None
    ip_address: str | None = None
    request_id: str | None = None
