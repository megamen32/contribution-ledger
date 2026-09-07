import uuid

import pytest
from fastapi.testclient import TestClient

from contribution.app import create_app
from contribution.config import Settings
from contribution.db import database, transaction
from contribution_spec.contracts import LedgerCommand
from contribution_spec.store import post_entry


@pytest.fixture
def client(tmp_path):
    settings = Settings(tmp_path, "x" * 32)
    app = create_app(settings)
    with TestClient(app, headers={"Authorization": "Bearer " + settings.token}) as c:
        c.settings = settings
        c.member = c.post("/api/members", json={"name": "Synthetic", "hourly_minor": 100000}).json()["id"]
        yield c


def work(c, **kw):
    return dict(id=uuid.uuid4().hex, member_id=c.member, title="Research", work_date="2026-09-07",
                seconds=3600, **kw)


def test_auth_and_no_secret_in_health(client):
    with TestClient(create_app(client.settings)) as c:
        assert c.get("/api/state").status_code == 401
        assert c.get("/health").json() == {"status": "ok", "version": "0.1.0"}
        assert c.post("/api/login", json={"token": "wrong"}).status_code == 401
        assert c.post("/api/login", json={"token": "x"*32}).status_code == 200
        assert c.get("/api/state").status_code == 200
        assert c.post("/api/members", json={"name": "Evil", "hourly_minor": 1},
                      headers={"Origin": "https://different.example"}).status_code == 403


def test_effort_default_work_and_money(client):
    r = client.post("/api/work", json=work(client))
    assert r.status_code == 201, r.text
    assert r.json()["effort_credit"] == 1
    assert r.json()["credited_minor"] == 100000
    r = client.post("/api/money", json=dict(id="disk", member_id=client.member, kind="expense",
                                           amount_minor=250000, reason="Synthetic disk"))
    assert r.status_code == 201, r.text
    assert client.get("/api/state").json()["total_minor"] == 350000


def test_double_click_and_conflict(client):
    b = work(client)
    assert client.post("/api/work", json=b).status_code == 201
    assert client.post("/api/work", json=b).status_code == 201
    b["seconds"] = 500
    assert client.post("/api/work", json=b).status_code == 409
    assert client.get("/api/state").json()["total_minor"] == 100000


def test_opt_out_requires_explicit_result(client):
    r = client.post("/api/work", json=work(client, effort_credit=False))
    assert r.status_code == 422
    assert client.get("/api/state").json()["work"] == []
    r = client.post("/api/work", json=work(client, effort_credit=False, result_minor=25000))
    assert r.status_code == 201
    assert r.json()["credited_minor"] == 25000
    assert client.post("/api/work", json=work(client, result_minor=100)).status_code == 422


def test_rate_snapshots_and_no_task_split_gain(client):
    client.put(f"/api/members/{client.member}/rate", json={"name": "Unused", "hourly_minor": 1})
    for _ in range(2):
        b=work(client); b["seconds"]=1800
        assert client.post("/api/work", json=b).status_code == 201
    assert client.get("/api/state").json()["total_minor"] == 1
    client.put(f"/api/members/{client.member}/rate", json={"name": "Unused", "hourly_minor": 200})
    assert all(w["hourly_minor"] == 1 for w in client.get("/api/state").json()["work"])


def test_restarts_preserve_data(client):
    client.post("/api/work", json=work(client))
    with TestClient(create_app(client.settings), headers=client.headers) as other:
        assert other.get("/api/state").json()["total_minor"] == 100000


def test_timer_stop_is_durable_and_idempotent(client):
    ident = uuid.uuid4().hex
    body = dict(id=ident, member_id=client.member, title="Research")
    assert client.post("/api/timers", json=body).status_code == 201
    assert client.post("/api/timers", json=dict(body, id="other")).status_code == 409
    r=client.post(f"/api/timers/{ident}/stop"); assert r.status_code == 200
    assert client.post(f"/api/timers/{ident}/stop").json() == r.json()
    with TestClient(create_app(client.settings), headers=client.headers) as other:
        assert other.get("/api/state").json()["timers"][0]["stopped_at"]
        b=work(client); b["id"]=ident
        assert other.post("/api/work", json=b).status_code == 201
        assert other.get("/api/state").json()["timers"] == []


def test_posting_does_not_commit_outer_transaction(client):
    with database(client.settings.data_dir) as db:
        with pytest.raises(RuntimeError):
            with transaction(db):
                post_entry(db, LedgerCommand(member_id=client.member, kind="cash", amount_minor=100,
                           currency="RUB", business_key="atomic", source_id="test", policy_id="honest-v1", target_entry_id=None, reason="test"))
                raise RuntimeError("simulated crash before application record commit")
        assert db.execute("SELECT COUNT(*) FROM ledger_entries").fetchone()[0] == 0


def test_payment_and_reversal(client):
    posted = client.post("/api/money", json=dict(id="cash", member_id=client.member, kind="cash",
                                           amount_minor=20000, reason="Deposit")).json()
    r=client.post("/api/money", json=dict(id="pay", member_id=client.member, kind="settlement",
                 amount_minor=5000,target_entry_id=posted["id"],reason="Return part"))
    assert r.status_code == 201
    assert client.get("/api/state").json()["total_minor"] == 15000
