import sqlite3

import pytest

from contribution_spec.contracts import LedgerCommand
from contribution_spec.store import Conflict, claim_job, enqueue, finish_job, heartbeat, post_entry


def command(key="k1",kind="labor",amount=800000,target=None,member="m1",currency="RUB"):
    return LedgerCommand(member_id=member,kind=kind,amount_minor=amount,currency=currency,
       business_key=key,source_id="fixture-source",policy_id="p1",target_entry_id=target,reason="Synthetic test")


def test_double_click_posts_once(database):
    a=post_entry(database,command()); b=post_entry(database,command())
    assert a["id"]==b["id"]
    assert database.execute("SELECT COUNT(*) FROM ledger_entries").fetchone()[0]==1


def test_same_business_key_different_amount_conflicts(database):
    post_entry(database,command())
    with pytest.raises(Conflict):
        post_entry(database,command(amount=900000))


def test_settlement_reduces_outstanding(database):
    base=post_entry(database,command())
    post_entry(database,command(key="pay1",kind="settlement",amount=300000,target=base["id"]))
    assert database.execute("SELECT SUM(amount_minor) FROM ledger_entries").fetchone()[0]==500000


def test_overpayment_rejected(database):
    base=post_entry(database,command())
    with pytest.raises(ValueError):
        post_entry(database,command(key="pay1",kind="settlement",amount=800001,target=base["id"]))


def test_second_payment_cannot_overdraw(database):
    base=post_entry(database,command())
    post_entry(database,command(key="pay1",kind="settlement",amount=500000,target=base["id"]))
    with pytest.raises(ValueError):
        post_entry(database,command(key="pay2",kind="settlement",amount=400000,target=base["id"]))


def test_wrong_member_rejected(database):
    base=post_entry(database,command())
    with pytest.raises(ValueError):
        post_entry(database,command(key="pay1",kind="settlement",amount=100,target=base["id"],member="m2"))


def test_wrong_currency_rejected(database):
    base=post_entry(database,command())
    with pytest.raises(ValueError):
        post_entry(database,command(key="pay1",kind="settlement",amount=100,target=base["id"],currency="USD"))


def test_reversal_restores_zero_without_deletion(database):
    base=post_entry(database,command())
    post_entry(database,command(key="rev1",kind="reversal",target=base["id"]))
    assert database.execute("SELECT SUM(amount_minor) FROM ledger_entries").fetchone()[0]==0
    assert database.execute("SELECT COUNT(*) FROM ledger_entries").fetchone()[0]==2


def test_no_partial_full_reversal(database):
    base=post_entry(database,command())
    with pytest.raises(ValueError):
        post_entry(database,command(key="rev1",kind="reversal",amount=1,target=base["id"]))


def test_no_duplicate_reversal(database):
    base=post_entry(database,command())
    post_entry(database,command(key="rev1",kind="reversal",target=base["id"]))
    with pytest.raises(Conflict):
        post_entry(database,command(key="rev2",kind="reversal",target=base["id"]))


def test_reverse_settlement_then_parent(database):
    base=post_entry(database,command())
    paid=post_entry(database,command(key="pay1",kind="settlement",amount=100,target=base["id"]))
    with pytest.raises(ValueError):
        post_entry(database,command(key="rev1",kind="reversal",target=base["id"]))
    post_entry(database,command(key="revpay",kind="reversal",amount=100,target=paid["id"]))
    post_entry(database,command(key="revbase",kind="reversal",target=base["id"]))
    assert database.execute("SELECT SUM(amount_minor) FROM ledger_entries").fetchone()[0]==0


@pytest.mark.parametrize("statement",["UPDATE ledger_entries SET amount_minor=1", "DELETE FROM ledger_entries"])
def test_posted_entries_immutable(database,statement):
    post_entry(database,command())
    with pytest.raises(sqlite3.IntegrityError):
        database.execute(statement)


def test_failed_post_rolls_back(database):
    with pytest.raises(ValueError):
        post_entry(database,command(kind="settlement",target="nonexistent"))
    assert database.execute("SELECT COUNT(*) FROM ledger_entries").fetchone()[0]==0
    assert not database.in_transaction


def test_queue_idempotency(database):
    a=enqueue(database,"judge","j1",{"slot":1}); b=enqueue(database,"judge","j1",{"slot":1})
    assert a==b


def test_queue_key_conflict(database):
    enqueue(database,"judge","j1",{"slot":1})
    with pytest.raises(Conflict):
        enqueue(database,"judge","j1",{"slot":2})


def test_queue_no_duplicate_claim_before_expiry(database):
    enqueue(database,"judge","j1",{})
    assert claim_job(database,now=0)
    assert claim_job(database,now=1) is None


def test_stale_worker_cannot_finish_after_reclaim(database):
    enqueue(database,"judge","j1",{})
    first=claim_job(database,now=0,lease_seconds=10)
    second=claim_job(database,now=11,lease_seconds=10)
    assert second["lease_generation"]==first["lease_generation"]+1
    assert not finish_job(database,first["id"],first["lease_generation"],{},now=12)
    assert finish_job(database,second["id"],second["lease_generation"],{},now=12)


def test_expired_lease_cannot_finish_even_without_new_owner(database):
    enqueue(database,"judge","j1",{})
    first=claim_job(database,now=0,lease_seconds=10)
    assert not finish_job(database,first["id"],first["lease_generation"],{},now=10)


def test_heartbeat_extends_lease(database):
    enqueue(database,"judge","j1",{})
    first=claim_job(database,now=0,lease_seconds=10)
    assert heartbeat(database,first["id"],first["lease_generation"],now=9,lease_seconds=10)
    assert claim_job(database,now=11) is None


def test_attempt_budget_is_bounded(database):
    enqueue(database,"judge","j1",{})
    for t in [0,11,22]:
        assert claim_job(database,now=t,lease_seconds=10)
    assert claim_job(database,now=33) is None
    assert database.execute("SELECT state FROM jobs").fetchone()[0]=="failed"


def test_queue_done_jobs_not_reclaimed(database):
    enqueue(database,"judge","j1",{})
    first=claim_job(database,now=0)
    assert finish_job(database,first["id"],first["lease_generation"],{},now=1)
    assert claim_job(database,now=1000) is None


def test_delete_journal_and_full_sync(database):
    assert database.execute("PRAGMA journal_mode").fetchone()[0]=="delete"
    assert database.execute("PRAGMA synchronous").fetchone()[0]==2
    assert database.execute("PRAGMA foreign_keys").fetchone()[0]==1
