from copy import deepcopy

import pytest
from pydantic import ValidationError

from contribution_spec.contracts import BlindPacket, JudgeAnswer, ModelProfile, Report, SessionManifest
from contribution_spec.rules import (CaptureGate, aggregate, bucket_delta, canonical_bytes,
                                     digest, find_known_identifiers, gross_minor, make_blind_packet,
                                     may_expire_raw, unpaid_minor, validate_answer)


@pytest.mark.parametrize("seconds,rate,expected", [(0,100000,0),(3600,100000,100000),(28800,100000,800000),(1,1800,1),(1,1799,0),(1,3600,1)])
def test_rounding(seconds,rate,expected):
    assert gross_minor(seconds,rate)==expected


@pytest.mark.parametrize("bad", [True,-1,1.2,None,"2"])
def test_invalid_time(bad):
    with pytest.raises(ValueError):
        gross_minor(bad,100)


def test_split_invariance():
    for rate in [1,1799,1800,100001]:
        previous = 0
        total = 0
        for size in [1,3,7,67,300,2222]:
            total += bucket_delta(previous,size,rate)
            previous += size
        assert total == gross_minor(previous,rate)


def test_settled_labor():
    assert unpaid_minor(800000,300000)==500000


def test_overpayment_not_silently_hidden():
    with pytest.raises(ValueError):
        unpaid_minor(100,101)


def test_unknown_rate_is_not_zero():
    with pytest.raises(ValueError):
        gross_minor(3600,None)


def test_canonical_key_order():
    assert digest({"b":2,"a":1}) == digest({"a":1,"b":2})


def test_hash_changes_when_evidence_changes():
    assert digest({"evidence":"A"}) != digest({"evidence":"B"})


def test_hash_preserves_list_order():
    assert digest([1,2]) != digest([2,1])


def test_no_floating_money_in_hashes():
    with pytest.raises(ValueError):
        canonical_bytes({"money":0.1})


def test_stopping_discards_inflight_capture():
    gate=CaptureGate(); gate.start(); ticket=gate.begin(); gate.request_stop()
    assert not gate.finish(ticket)
    gate.acknowledge_stop()
    assert gate.state=="stopped"
    with pytest.raises(ValueError):
        gate.begin()


def test_stop_ack_waits_for_inflight():
    gate=CaptureGate(); gate.start(); gate.begin(); gate.request_stop()
    with pytest.raises(ValueError):
        gate.acknowledge_stop()


def test_active_capture_can_commit():
    gate=CaptureGate(); gate.start()
    assert gate.finish(gate.begin())


@pytest.mark.parametrize("pinned,held,accepted,expected", [(False,False,True,True),(True,False,True,False),(False,True,True,False),(False,False,False,False)])
def test_retention(pinned,held,accepted,expected):
    assert may_expire_raw(age_days=91,retention_days=90,pinned=pinned,held=held,server_accepted=accepted)==expected


def test_young_raw_not_expired():
    assert not may_expire_raw(age_days=89,retention_days=90,pinned=False,held=False,server_accepted=True)


def test_reference_must_exist(packet,answer):
    answer.evidence_ids=["invented"]
    with pytest.raises(ValueError):
        validate_answer(packet,answer)


def test_rate_must_exist(packet,answer):
    answer.rate_id="invented"
    with pytest.raises(ValueError):
        validate_answer(packet,answer)


def test_schema_forbids_identity_fields(packet):
    d=packet.model_dump(); d["member_id"]="m1"
    with pytest.raises(ValidationError):
        BlindPacket.model_validate(d)


def test_schema_forbids_actual_hours(packet):
    d=packet.model_dump(); d["actual_hours"]=8
    with pytest.raises(ValidationError):
        BlindPacket.model_validate(d)


def test_text_identity_is_flagged_not_claimed_redacted(packet):
    packet.outcome="Prepared by Fixture Person"
    assert find_known_identifiers(packet,["Fixture Person"])==["Fixture Person"]


def test_projection_removes_owner_and_paths():
    report=Report.model_validate({"task_id":"task1","author_id":"m1","revision":1,
        "goal":"Investigate interface","actions":[],
        "result":{"text":"Limitation documented","basis":"artifact_excerpt","evidence_ids":["author-name-src"]},
        "result_status":"negative_research",
        "excerpts":[{"evidence_id":"author-name-src","artifact_id":"private-file-id","locator":"/home/private-name/note.md:1",
        "kind":"artifact_excerpt","text":"The documented API lacks this operation."}],
        "omitted_material":[],"limitations":[],"suggested_task_split":[]})
    packet=make_blind_packet(report,packet_id="p",scope="API check",available_tools=[],constraints=[],rates=[],rate_card_id="r")
    output=packet.model_dump_json()
    for secret in ["author-name-src","private-file-id","private-name","author_id"]:
        assert secret not in output
    assert packet.evidence[0].evidence_id=="e001"


def test_report_does_not_promote_self_report_to_artifact():
    from pathlib import Path
    import json
    d=json.loads((Path(__file__).parents[1]/"fixtures/report.json").read_text())
    d["excerpts"][0]["kind"]="participant_statement"
    with pytest.raises(ValidationError):
        Report.model_validate(d)


def test_session_allocations_cannot_exceed_confirmed_time():
    data={"session_id":"s1","device_id":"d1","revision":1,"timezone":"UTC",
          "segments":[{"segment_id":"sg1","start_utc":0,"end_utc":3600,"confirmed_seconds":3600,"source":"timer_confirmed"}],
          "allocations":[{"task_id":"t1","seconds":3601}],"artifacts":[],"note":""}
    with pytest.raises(ValidationError):
        SessionManifest.model_validate(data)


def samples_for(answer):
    return {key:[answer.model_copy(deep=True) for _ in range(3)] for key in ["a","b","c"]}


def test_consensus_known_and_no_financial_effect(packet,answer,profile):
    result=aggregate(packet,samples_for(answer),profile)
    assert result["price_status"]=="known"
    assert (result["low_minor"],result["high_minor"])==(100000,400000)
    assert result["financial_effect_minor"]==0


def test_8_of_9_is_not_complete(packet,answer,profile):
    s=samples_for(answer); s["c"].pop()
    with pytest.raises(ValueError):
        aggregate(packet,s,profile)


def test_missing_model_not_replaced(packet,answer,profile):
    s=samples_for(answer); s["d"]=s.pop("c")
    with pytest.raises(ValueError):
        aggregate(packet,s,profile)


def test_unknown_answer_is_final_but_price_unknown(packet,answer,profile):
    s=samples_for(answer)
    d=s["a"][0].model_dump(); d.update(assessment="needs_information",typical_duration=None,price_status="no_price_data",rate_id=None,missing_information=["Result not included"])
    s["a"][0]=JudgeAnswer.model_validate(d)
    result=aggregate(packet,s,profile)
    assert result["collection_status"]=="complete"
    assert result["price_status"]=="unknown" and result["low_minor"] is None


def test_visual_work_requires_review(packet,answer,profile):
    packet.visual_review_required=True
    assert aggregate(packet,samples_for(answer),profile)["price_status"]=="unknown"


def test_rerun_same_saved_answers_same_result(packet,answer,profile):
    assert aggregate(packet,samples_for(answer),profile)==aggregate(packet,samples_for(answer),profile)


def test_duplicate_family_not_independent(profile):
    d=profile.model_dump(); d["models"][1]["family"]=d["models"][0]["family"]
    with pytest.raises(ValidationError):
        ModelProfile.model_validate(d)


def test_mixed_currency_not_aggregated(packet,answer,profile):
    second=packet.rates[0].model_copy(deep=True); second.rate_id="usd"; second.currency="USD"
    packet.rates.append(second)
    s=samples_for(answer); s["b"][0].rate_id="usd"
    assert aggregate(packet,s,profile)["price_status"]=="unknown"


def test_between_model_disagreement(packet,answer,profile):
    s=samples_for(answer)
    for a in s["c"]:
        a.typical_duration.high_seconds=360000
        a.typical_duration.low_seconds=180000
    result=aggregate(packet,s,profile)
    assert result["needs_review"] and "between_model_disagreement" in result["review_reasons"]


def test_expected_median_does_not_multiply_averaged_rates(packet,answer,profile):
    s=samples_for(answer)
    s["a"][0].typical_duration.high_seconds=14400
    assert aggregate(packet,s,profile)["high_minor"]==400000


def test_capture_has_only_one_frame_inflight():
    gate = CaptureGate()
    gate.start()
    gate.begin()
    with pytest.raises(ValueError):
        gate.begin()
