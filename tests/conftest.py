import json
from pathlib import Path

import pytest

from contribution_spec.contracts import BlindPacket, JudgeAnswer, ModelProfile
from contribution_spec.store import connect, initialize

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def packet():
    return BlindPacket.model_validate_json((ROOT / "fixtures/blind_packet.json").read_text())


@pytest.fixture
def answer():
    return JudgeAnswer.model_validate_json((ROOT / "fixtures/judge_answer.json").read_text())


@pytest.fixture
def profile():
    return ModelProfile.model_validate_json((ROOT / "fixtures/model_profile.synthetic.json").read_text())


@pytest.fixture
def database(tmp_path):
    db = connect(tmp_path / "test.sqlite3")
    initialize(db, ROOT / "migrations/001_core.sql")
    db.execute("INSERT INTO members VALUES ('m1','Fixture Member','UTC',1,1)")
    db.execute("INSERT INTO members VALUES ('m2','Other Fixture Member','UTC',0,1)")
    db.execute("INSERT INTO policies VALUES ('p1',?,'[\"m1\",\"m2\"]',0)", (json.dumps({"fixture": True}),))
    yield db
    db.close()
