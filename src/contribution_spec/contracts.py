"""Normative JSON contracts. Generate schemas; do not edit generated JSON by hand."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")]
NonEmpty = Annotated[str, Field(min_length=1, max_length=20000)]
Minor = Annotated[int, Field(ge=0, le=9_000_000_000_000_000, strict=True)]
Seconds = Annotated[int, Field(ge=0, le=31_622_400, strict=True)]
Sha256 = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Evidence(Contract):
    evidence_id: Identifier
    kind: Literal["artifact_excerpt", "participant_statement", "inference"]
    text: NonEmpty


class SourceExcerpt(Contract):
    evidence_id: Identifier
    artifact_id: Identifier | None
    locator: NonEmpty | None
    kind: Literal["artifact_excerpt", "participant_statement", "inference"]
    text: NonEmpty

    @model_validator(mode="after")
    def provenance(self):
        if self.kind == "artifact_excerpt" and (self.artifact_id is None or self.locator is None):
            raise ValueError("artifact_excerpt requires a resolvable artifact_id and locator")
        return self


class Claim(Contract):
    text: NonEmpty
    basis: Literal["artifact_excerpt", "participant_statement", "inference"]
    evidence_ids: list[Identifier] = Field(min_length=1)


class Report(Contract):
    schema_version: Literal["2.0"] = "2.0"
    task_id: Identifier
    author_id: Identifier
    revision: Annotated[int, Field(ge=1, strict=True)]
    goal: NonEmpty
    actions: list[Claim]
    result: Claim
    result_status: Literal["complete", "partial", "negative_research", "learning", "unknown"]
    excerpts: list[SourceExcerpt] = Field(min_length=1)
    omitted_material: list[NonEmpty]
    limitations: list[NonEmpty]
    suggested_task_split: list[NonEmpty]

    @model_validator(mode="after")
    def references(self):
        by_id = {e.evidence_id: e for e in self.excerpts}
        if len(by_id) != len(self.excerpts):
            raise ValueError("duplicate evidence IDs")
        for claim in [*self.actions, self.result]:
            if not set(claim.evidence_ids) <= by_id.keys():
                raise ValueError("unknown evidence reference")
            if claim.basis == "artifact_excerpt" and not any(
                by_id[e].kind == "artifact_excerpt" for e in claim.evidence_ids
            ):
                raise ValueError("an inference or self-report cannot be relabeled artifact evidence")
        return self


class MarketRate(Contract):
    rate_id: Identifier
    category: NonEmpty
    grade: Literal["junior", "middle", "senior", "expert", "unspecified"]
    currency: Currency
    low_minor_per_hour: Minor
    high_minor_per_hour: Minor
    basis: Literal["contractor_hour"] = "contractor_hour"
    market: NonEmpty
    provenance: Literal["external_reference", "team_assumption", "synthetic_fixture"]
    source: NonEmpty
    checked_on: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]

    @model_validator(mode="after")
    def ordered(self):
        if self.high_minor_per_hour < self.low_minor_per_hour:
            raise ValueError("unordered rate range")
        return self


class BlindPacket(Contract):
    schema_version: Literal["2.0"] = "2.0"
    packet_id: Identifier
    scope: NonEmpty
    goal: NonEmpty
    constraints: list[NonEmpty]
    available_tools: list[NonEmpty]
    outcome: NonEmpty
    result_status: Literal["complete", "partial", "negative_research", "learning", "unknown"]
    evidence: list[Evidence] = Field(min_length=1)
    limitations: list[NonEmpty]
    omitted_material: list[NonEmpty]
    visual_review_required: bool
    rate_card_id: Identifier
    rates: list[MarketRate]

    @model_validator(mode="after")
    def unique_references(self):
        for values in ([e.evidence_id for e in self.evidence], [r.rate_id for r in self.rates]):
            if len(set(values)) != len(values):
                raise ValueError("duplicate reference ID")
        return self


class DurationRange(Contract):
    low_seconds: Seconds
    high_seconds: Seconds

    @model_validator(mode="after")
    def ordered(self):
        if self.high_seconds < self.low_seconds:
            raise ValueError("unordered duration range")
        return self


class JudgeAnswer(Contract):
    schema_version: Literal["2.0"] = "2.0"
    packet_id: Identifier
    assessment: Literal["assessable", "needs_information"]
    category: NonEmpty
    grade: Literal["junior", "middle", "senior", "expert", "unknown"]
    complexity: Annotated[int, Field(ge=1, le=5, strict=True)] | None
    typical_duration: DurationRange | None
    price_status: Literal["rate_available", "no_price_data"]
    rate_id: Identifier | None
    evidence_ids: list[Identifier]
    limitations: list[NonEmpty]
    missing_information: list[NonEmpty]
    rationale: NonEmpty

    @model_validator(mode="after")
    def coherent(self):
        if len(self.evidence_ids) != len(set(self.evidence_ids)):
            raise ValueError("duplicate evidence references")
        if self.assessment == "needs_information":
            if self.typical_duration is not None or self.price_status != "no_price_data":
                raise ValueError("insufficient information cannot silently yield a price")
            if not self.missing_information:
                raise ValueError("explain which information is missing")
        if self.price_status == "rate_available":
            if self.rate_id is None or self.typical_duration is None:
                raise ValueError("a price needs both a rate and duration")
        elif self.rate_id is not None:
            raise ValueError("no_price_data requires a null rate_id")
        return self


class Segment(Contract):
    segment_id: Identifier
    # UTC Unix seconds annotate human chronology; duration is confirmed, not inferred from wall time.
    start_utc: Annotated[int, Field(ge=0, strict=True)]
    end_utc: Annotated[int, Field(ge=0, strict=True)]
    confirmed_seconds: Seconds
    source: Literal["timer_confirmed", "manual", "corrected"]

    @model_validator(mode="after")
    def chronology(self):
        if self.end_utc < self.start_utc:
            raise ValueError("reversed wall interval")
        return self


class Allocation(Contract):
    task_id: Identifier
    seconds: Seconds


class SessionManifest(Contract):
    schema_version: Literal["2.0"] = "2.0"
    session_id: Identifier
    device_id: Identifier
    revision: Annotated[int, Field(ge=1, strict=True)]
    timezone: NonEmpty
    segments: list[Segment]
    allocations: list[Allocation]
    artifacts: list[Identifier]
    note: str = Field(max_length=20000)

    @model_validator(mode="after")
    def consistent(self):
        if sum(a.seconds for a in self.allocations) > sum(s.confirmed_seconds for s in self.segments):
            raise ValueError("allocated time exceeds confirmed time")
        for values in ([s.segment_id for s in self.segments], self.artifacts):
            if len(values) != len(set(values)):
                raise ValueError("duplicate session reference")
        return self


class LedgerCommand(Contract):
    member_id: Identifier
    kind: Literal["cash", "expense", "labor", "bonus", "settlement", "reversal"]
    amount_minor: Annotated[int, Field(ge=1, le=9_000_000_000_000_000, strict=True)]
    currency: Currency
    business_key: Identifier
    source_id: Identifier
    policy_id: Identifier
    target_entry_id: Identifier | None
    reason: NonEmpty

    @model_validator(mode="after")
    def target(self):
        requires = self.kind in {"settlement", "reversal"}
        if requires != (self.target_entry_id is not None):
            raise ValueError("only a settlement or full reversal must target an entry")
        return self


class RoundRequest(Contract):
    packet_id: Identifier
    model_profile_id: Identifier
    reason: NonEmpty


class ArtifactDeclaration(Contract):
    artifact_id: Identifier
    session_id: Identifier
    sha256: Sha256
    bytes: Annotated[int, Field(ge=1, le=20_971_520, strict=True)]
    mime: Literal["image/webp", "image/png", "image/jpeg", "text/plain", "text/markdown", "application/json", "application/x-ndjson", "text/csv", "text/x-diff", "application/octet-stream"]
    original_name: Annotated[str, Field(min_length=1, max_length=255)]


class ModelSpec(Contract):
    key: Identifier
    family: Identifier
    tag: NonEmpty
    digest: Sha256
    runtime_version: NonEmpty
    quantization: NonEmpty


class ModelProfile(Contract):
    profile_id: Identifier
    models: list[ModelSpec] = Field(min_length=3, max_length=3)
    samples_per_model: Literal[3] = 3
    temperature: Annotated[float, Field(ge=0, le=2)] = 0.2
    seeds: list[Annotated[int, Field(ge=0, strict=True)]] = Field(min_length=3, max_length=3)
    max_output_tokens: Annotated[int, Field(ge=128, le=16384)] = 1536

    @model_validator(mode="after")
    def distinct(self):
        for attr in ("key", "family", "digest"):
            if len({getattr(m, attr) for m in self.models}) != 3:
                raise ValueError(f"three distinct model {attr} values are required")
        if len(set(self.seeds)) != 3:
            raise ValueError("three declared distinct sampling seeds are required")
        return self


EXPORTS = {c.__name__: c for c in (Report, BlindPacket, JudgeAnswer, SessionManifest,
           LedgerCommand, RoundRequest, ArtifactDeclaration, ModelProfile)}
