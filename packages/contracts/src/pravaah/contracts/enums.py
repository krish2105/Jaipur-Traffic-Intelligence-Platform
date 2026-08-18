"""Closed vocabularies. Every one of these is mirrored into TypeScript.

Adding a member here is a contract change: regenerate types (`make contracts`)
and check the UI handles the new member before merging.
"""

from __future__ import annotations

from enum import StrEnum


class Direction(StrEnum):
    """Approach direction at a count line. docs/05 §1 `traffic_counts.direction`."""

    NB = "NB"
    SB = "SB"
    EB = "EB"
    WB = "WB"


class VehicleClass(StrEnum):
    """IRC-aligned classes. docs/04 §2 — twelve, and the split matters:
    two-wheeler performance is the whole ballgame in an Indian fleet."""

    TWO_WHEELER = "2W"
    AUTO_RICKSHAW = "AUTO"
    E_RICKSHAW = "ERIK"
    CAR = "CAR"
    TAXI = "TAXI"
    LCV = "LCV"
    BUS = "BUS"
    MINI_BUS = "MBUS"
    TRUCK_2_AXLE = "TRK2"
    TRUCK_MULTI_AXLE = "TRKM"
    TRACTOR = "TRAC"
    NON_MOTORISED = "NMV"


#: PCU factors on an IRC:106 basis (docs/04 §2). These are tuned to local
#: observation during calibration and the tuning is documented — never silently
#: adjusted, because every capacity number downstream depends on them.
PCU_FACTORS: dict[VehicleClass, float] = {
    VehicleClass.TWO_WHEELER: 0.25,
    VehicleClass.AUTO_RICKSHAW: 0.5,
    VehicleClass.E_RICKSHAW: 0.5,
    VehicleClass.CAR: 1.0,
    VehicleClass.TAXI: 1.0,
    VehicleClass.LCV: 1.5,
    VehicleClass.BUS: 3.0,
    VehicleClass.MINI_BUS: 2.0,
    VehicleClass.TRUCK_2_AXLE: 3.0,
    VehicleClass.TRUCK_MULTI_AXLE: 4.5,
    VehicleClass.TRACTOR: 4.0,
    VehicleClass.NON_MOTORISED: 0.5,
}


class QualityFlag(StrEnum):
    """Why a bin's quality score is what it is. Surfaced in the UI — docs/03 §3
    requires degradation to be shown, not hidden."""

    LOW_LIGHT = "low_light"
    RAIN = "rain"
    FOG = "fog"
    GLARE = "glare"
    DUST = "dust"
    OCCLUSION = "occlusion"
    UNCALIBRATED = "uncalibrated"
    PARTIAL_BIN = "partial_bin"
    CAMERA_MOVED = "camera_moved"


class SourceSystem(StrEnum):
    """Where a camera's feed comes from. docs/05 §1 `cameras.source_system`."""

    ABHAY = "abhay"
    ICCC = "iccc"
    JDA = "jda"
    DRONE = "drone"
    SURVEY = "survey"
    REPLAY = "replay"
    PUBLIC_DATASET = "public_dataset"


class IncidentType(StrEnum):
    CRASH = "crash"
    BREAKDOWN = "breakdown"
    CONGESTION_ANOMALY = "congestion_anomaly"
    OBSTRUCTION = "obstruction"
    WATERLOGGING = "waterlogging"
    EVENT = "event"


class Severity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ViolationType(StrEnum):
    RED_LIGHT = "red_light"
    SPEED = "speed"
    NO_HELMET = "no_helmet"
    TRIPLE_RIDING = "triple_riding"
    WRONG_SIDE = "wrong_side"
    NO_SEATBELT = "no_seatbelt"
    LANE = "lane"


class Role(StrEnum):
    """The seven roles from docs/07 §5. ABAC corridor scoping sits on top and is
    enforced in Postgres row-level security, never in application code."""

    VIEWER = "viewer"
    ANALYST = "analyst"
    TRAFFIC_OFFICER = "traffic_officer"
    ENFORCEMENT_OFFICER = "enforcement_officer"
    ENFORCEMENT_SUPERVISOR = "enforcement_supervisor"
    DATA_ADMIN = "data_admin"
    AUDITOR = "auditor"


class DataClass(StrEnum):
    """docs/07 §2. The architectural consequence worth saying out loud: GANANA's
    output is entirely P0 — the flagship module processes no personal data."""

    P0_NON_PERSONAL = "P0"
    P1_PSEUDONYMOUS = "P1"
    P2_PERSONAL = "P2"
    P3_SENSITIVE = "P3"


class AuditAction(StrEnum):
    """Every one of these writes to the append-only audit log BEFORE the
    response is returned (docs/07 §3)."""

    VIEW_PLATE = "view_plate"
    UNMASK_IDENTITY = "unmask_identity"
    EXPORT = "export"
    RUN_SCENARIO = "run_scenario"
    VERIFY_INCIDENT = "verify_incident"
    APPROVE_ACTION = "approve_action"
    LOGIN = "login"
    RETENTION_JOB = "retention_job"
    SALT_ROTATION = "salt_rotation"


class SourceMode(StrEnum):
    """docs/05 §4. `REPLAY` makes every adapter file-backed so the whole system
    runs with the network cable pulled."""

    REPLAY = "replay"
    LIVE = "live"
