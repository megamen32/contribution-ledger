"""Pure reference rules: integer accounting, blind contracts, aggregation and lifecycle decisions."""
from __future__ import annotations

import hashlib
import json
from decimal import Decimal, ROUND_HALF_UP
from statistics import median
from typing import Any, Mapping, Sequence

from .contracts import BlindPacket, JudgeAnswer, ModelProfile, Report


def nonnegative_int(value: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{name} must be a nonnegative integer")
    return value


def gross_minor(seconds: int, hourly_rate_minor: int) -> int:
    nonnegative_int(seconds, "seconds")
    nonnegative_int(hourly_rate_minor, "hourly_rate_minor")
    return int((Decimal(seconds) * hourly_rate_minor / 3600).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def bucket_delta(old_seconds: int, added_seconds: int, rate_minor: int) -> int:
    """Round cumulative daily/rate-bucket totals, not individual tiny task fragments."""
    nonnegative_int(old_seconds, "old_seconds")
    nonnegative_int(added_seconds, "added_seconds")
    return gross_minor(old_seconds + added_seconds, rate_minor) - gross_minor(old_seconds, rate_minor)


def unpaid_minor(gross: int, already_paid: int) -> int:
    nonnegative_int(gross, "gross")
    nonnegative_int(already_paid, "already_paid")
    if already_paid > gross:
        raise ValueError("overpayment is a separate obligation; do not silently clamp it to zero")
    return gross - already_paid


def _normalize(value: Any) -> Any:
    """Project byte profile: no floats, sort object keys, preserve text and list ordering."""
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        raise ValueError("floating-point values are forbidden in hashed accounting packets")
    if isinstance(value, list):
        return [_normalize(v) for v in value]
    if isinstance(value, dict) and all(isinstance(k, str) for k in value):
        return {k: _normalize(v) for k, v in value.items()}
    raise ValueError("unsupported canonical JSON value")


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(_normalize(value), ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def validate_answer(packet: BlindPacket, answer: JudgeAnswer) -> None:
    if packet.packet_id != answer.packet_id:
        raise ValueError("answer belongs to a different packet")
    evidence = {e.evidence_id for e in packet.evidence}
    if not set(answer.evidence_ids) <= evidence:
        raise ValueError("unknown evidence reference")
    if answer.assessment == "assessable" and not answer.evidence_ids:
        raise ValueError("an assessment needs at least a labeled self-report or excerpt")
    if answer.rate_id is not None and answer.rate_id not in {r.rate_id for r in packet.rates}:
        raise ValueError("unknown rate; model-generated rates are not accepted")


def make_blind_packet(report: Report, *, packet_id: str, scope: str,
                      available_tools: list[str], constraints: list[str], rates: list,
                      rate_card_id: str, visual_review_required: bool = False) -> BlindPacket:
    """Allowlist projection only. Free-text identity review is REQUIRED separately."""
    return BlindPacket.model_validate({
        "schema_version": "2.0", "packet_id": packet_id, "scope": scope,
        "goal": report.goal, "constraints": constraints, "available_tools": available_tools,
        "outcome": report.result.text, "result_status": report.result_status,
        "evidence": [{"evidence_id": f"e{i:03}", "kind": e.kind, "text": e.text}
                     for i, e in enumerate(report.excerpts, start=1)],
        "limitations": report.limitations, "omitted_material": report.omitted_material,
        "visual_review_required": visual_review_required, "rate_card_id": rate_card_id,
        "rates": rates,
    })


def find_known_identifiers(packet: BlindPacket, identifiers: Sequence[str]) -> list[str]:
    """Flag known literal identifiers, not a claim of complete anonymization or NLP detection."""
    text = packet.model_dump_json().casefold()
    return [token for token in identifiers if token and token.casefold() in text]


def _hierarchical_median(values: Mapping[str, Sequence[int]]) -> int:
    if len(values) < 2 or any(len(v) != 3 for v in values.values()):
        raise ValueError("at least two models with three values each are required")
    return int(Decimal(str(median([median(v) for v in values.values()]))).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def aggregate(packet: BlindPacket, samples: Mapping[str, Sequence[JudgeAnswer]],
              profile: ModelProfile) -> dict:
    return aggregate_samples(packet, samples, {m.key for m in profile.models})


def aggregate_samples(packet: BlindPacket, samples: Mapping[str, Sequence[JudgeAnswer]],
                      expected: set[str]) -> dict:
    if len(expected) < 2:
        raise ValueError("at least two distinct requested model IDs are required")
    if set(samples) != expected or any(len(samples[k]) != 3 for k in expected):
        raise ValueError("one finalized answer in every required model/sample slot")
    rates = {r.rate_id: r for r in packet.rates}
    reasons: set[str] = set()
    per_model: dict[str, dict] = {}
    known = True
    basis_currencies: set[tuple[str, str, str, str]] = set()
    lows: dict[str, list[int]] = {}
    highs: dict[str, list[int]] = {}
    categories: list[str | None] = []
    for key in sorted(samples):
        answers = samples[key]
        lows[key], highs[key] = [], []
        counts: dict[str, int] = {}
        for a in answers:
            validate_answer(packet, a)
            counts[a.category] = counts.get(a.category, 0) + 1
            if a.price_status != "rate_available":
                known = False
                reasons.add("incomplete_price_information")
                continue
            r = rates[a.rate_id]
            basis_currencies.add((r.currency, r.basis, r.market, r.provenance))
            d = a.typical_duration
            lows[key].append(gross_minor(d.low_seconds, r.low_minor_per_hour))
            highs[key].append(gross_minor(d.high_seconds, r.high_minor_per_hour))
        majority = next((c for c, n in counts.items() if n >= 2), None)
        categories.append(majority)
        if majority is None:
            reasons.add("mixed_category")
        if len(lows[key]) == 3:
            lo, hi = int(median(lows[key])), int(median(highs[key]))
            per_model[key] = {"low_minor": lo, "high_minor": hi}
            centers = [lo_ + hi_ for lo_, hi_ in zip(lows[key], highs[key], strict=True)]
            if max(centers) > 2 * min(centers):
                reasons.add("within_model_disagreement")
        else:
            per_model[key] = {"low_minor": None, "high_minor": None}
    category_majority = next((c for c in categories if c is not None and categories.count(c) > len(expected) // 2), None)
    if category_majority is None:
        reasons.add("mixed_category")
    if len(basis_currencies) > 1:
        reasons.add("incomparable_rate_basis")
        known = False
    if packet.visual_review_required:
        reasons.add("visual_review_required")
        known = False
    lo = hi = currency = None
    if known:
        lo, hi = _hierarchical_median(lows), _hierarchical_median(highs)
        currency = next(iter(basis_currencies))[0]
        centers = [v["low_minor"] + v["high_minor"] for v in per_model.values()]
        if max(centers) > 2 * min(centers):
            reasons.add("between_model_disagreement")
    return {"collection_status": "complete", "price_status": "known" if known else "unknown",
            "low_minor": lo, "high_minor": hi, "currency": currency,
            "category": category_majority or "mixed", "needs_review": bool(reasons),
            "review_reasons": sorted(reasons), "per_model": per_model,
            "financial_effect_minor": 0}


class CaptureGate:
    """State-machine reference only, not an OS capture/stop implementation."""
    def __init__(self):
        self.state = "idle"
        self.epoch = 0
        self.inflight: set[int] = set()

    def start(self):
        if self.state not in {"idle", "paused"}:
            raise ValueError("cannot start in this state")
        self.epoch += 1
        self.state = "recording"

    def begin(self) -> int:
        if self.state != "recording" or self.inflight:
            raise ValueError("capture is not allowed or a frame is already in flight")
        ticket = self.epoch
        self.inflight.add(ticket)
        return ticket

    def request_stop(self):
        self.epoch += 1
        self.state = "stopping"

    def finish(self, ticket: int) -> bool:
        self.inflight.discard(ticket)
        return self.state == "recording" and ticket == self.epoch

    def acknowledge_stop(self):
        if self.state != "stopping" or self.inflight:
            raise ValueError("cannot claim stopped until capture has quiesced")
        self.state = "stopped"


def may_expire_raw(*, age_days: int, retention_days: int, pinned: bool,
                   held: bool, server_accepted: bool) -> bool:
    return age_days >= retention_days and not pinned and not held and server_accepted
