from __future__ import annotations

import hashlib
import hmac
import sqlite3
import time
import uuid
from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from contribution_spec.contracts import LedgerCommand
from contribution_spec.rules import bucket_delta, digest
from contribution_spec.store import Conflict, post_entry

from . import __version__
from .config import Settings
from .db import database, initialize, transaction

Positive = Annotated[int, Field(gt=0, le=10**12, strict=True)]
NonNegative = Annotated[int, Field(ge=0, le=10**12, strict=True)]
Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(Input):
    token: str = Field(min_length=1, max_length=200)


class MemberInput(Input):
    name: str = Field(min_length=1, max_length=100)
    hourly_minor: NonNegative


class WorkInput(Input):
    id: Identifier
    member_id: Identifier
    title: str = Field(min_length=1, max_length=300)
    work_date: date
    seconds: Annotated[int, Field(gt=0, le=86400, strict=True)]
    effort_credit: bool = True
    result_minor: NonNegative | None = None
    notes: str = Field(default="", max_length=30000)


class MoneyInput(Input):
    id: Identifier
    member_id: Identifier
    kind: str = Field(pattern=r"^(cash|expense|settlement|reversal)$")
    amount_minor: Positive
    target_entry_id: str | None = None
    reason: str = Field(min_length=1, max_length=2000)


class TimerInput(Input):
    id: Identifier
    member_id: Identifier
    title: str = Field(min_length=1, max_length=300)


def create_app(settings: Settings) -> FastAPI:
    initialize(settings.data_dir)
    app = FastAPI(title="Вклад команды", version=__version__, docs_url=None, redoc_url=None)
    app.state.settings = settings
    cookie = hmac.new(settings.token.encode(), b"contribution-session-v1", hashlib.sha256).hexdigest()

    def authorize(request: Request):
        bearer = request.headers.get("authorization", "")
        bearer_ok = hmac.compare_digest(bearer.encode(), ("Bearer " + settings.token).encode())
        cookie_ok = hmac.compare_digest(request.cookies.get("contribution", "").encode(), cookie.encode())
        if not (bearer_ok or cookie_ok):
            raise HTTPException(401, "Нужен ключ команды")
        if cookie_ok and not bearer_ok and request.method not in {"GET", "HEAD"}:
            origin = request.headers.get("origin")
            if origin and origin != str(request.base_url).rstrip("/"):
                raise HTTPException(403, "Другой origin")

    protected = [Depends(authorize)]

    @app.exception_handler(Conflict)
    async def conflict_handler(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(sqlite3.IntegrityError)
    async def integrity_handler(request, exc):
        return JSONResponse({"detail": "Запись конфликтует с существующими данными"}, status_code=409)

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(Path(__file__).with_name("index.html"), headers={"Cache-Control": "no-store"})

    @app.get("/health")
    def health():
        with database(settings.data_dir) as db:
            db.execute("SELECT 1").fetchone()
        return {"status": "ok", "version": __version__}

    @app.post("/api/login")
    def login(body: Login, response: Response):
        if not hmac.compare_digest(body.token.encode(), settings.token.encode()):
            raise HTTPException(401, "Неверный ключ команды")
        response.set_cookie("contribution", cookie, httponly=True, secure=settings.secure_cookie,
                            samesite="strict", max_age=43200)
        return {"ok": True}

    @app.post("/api/logout", dependencies=protected)
    def logout(response: Response):
        response.delete_cookie("contribution")
        return {"ok": True}

    @app.get("/api/state", dependencies=protected)
    def state():
        with database(settings.data_dir) as db:
            members = [dict(r) for r in db.execute("""SELECT m.id,m.display_name,r.hourly_minor,
                COALESCE((SELECT SUM(amount_minor) FROM ledger_entries l WHERE l.member_id=m.id),0) total_minor
                FROM members m JOIN app_rates r ON r.member_id=m.id ORDER BY m.display_name""")]
            work = [dict(r) for r in db.execute("SELECT * FROM work_records ORDER BY created_at DESC,rowid DESC LIMIT 200")]
            entries = [dict(r) for r in db.execute("SELECT * FROM ledger_entries ORDER BY created_at DESC,rowid DESC LIMIT 300")]
            timers = [dict(r) for r in db.execute("SELECT * FROM live_timers")]
        return {"members": members, "work": work, "entries": entries, "timers": timers,
                "total_minor": sum(m["total_minor"] for m in members), "currency": "RUB",
                "effort_credit_default": True,
                "models": {"summary": settings.summary_model, "judges": settings.judge_models,
                           "repeats": settings.judge_repeats},
                "warning": "Доля в учтённом вкладе, не юридическая доля компании"}

    @app.post("/api/members", dependencies=protected, status_code=201)
    def member(body: MemberInput):
        name = body.name.strip()
        if not name:
            raise HTTPException(422, "Укажите имя")
        ident = uuid.uuid4().hex
        with database(settings.data_dir) as db, transaction(db):
            if db.execute("SELECT 1 FROM members WHERE display_name=?", (name,)).fetchone():
                raise HTTPException(409, "Участник с таким именем уже есть")
            db.execute("INSERT INTO members VALUES (?,?,'UTC',0,1)", (ident, name))
            db.execute("INSERT INTO app_rates VALUES (?,?)", (ident, body.hourly_minor))
        return {"id": ident}

    @app.put("/api/members/{member_id}/rate", dependencies=protected)
    def change_rate(member_id: str, body: MemberInput):
        with database(settings.data_dir) as db:
            cur = db.execute("UPDATE app_rates SET hourly_minor=? WHERE member_id=?", (body.hourly_minor, member_id))
            if not cur.rowcount:
                raise HTTPException(404, "Участник не найден")
        return {"ok": True, "note": "Ставка меняется только для новых записей"}

    @app.post("/api/work", dependencies=protected, status_code=201)
    def work(body: WorkInput):
        payload = body.model_dump(mode="json")
        fingerprint = digest(payload)
        with database(settings.data_dir) as db, transaction(db):
            old = db.execute("SELECT * FROM work_records WHERE id=?", (body.id,)).fetchone()
            if old:
                if old["payload_hash"] != fingerprint:
                    raise Conflict("ID уже использован для другой записи")
                return dict(old)
            rate = db.execute("SELECT hourly_minor FROM app_rates WHERE member_id=?", (body.member_id,)).fetchone()
            if not rate:
                raise HTTPException(404, "Участник не найден")
            if body.effort_credit and body.result_minor is not None:
                raise HTTPException(422, "Стоимость результата не прибавляется к стоимости тех же часов")
            if not body.effort_credit and body.result_minor is None:
                raise HTTPException(422, "Без зачёта стараний явно укажите согласованную стоимость результата")
            previous = db.execute("""SELECT COALESCE(SUM(seconds),0) FROM work_records
                WHERE member_id=? AND work_date=? AND hourly_minor=? AND effort_credit=1""",
                (body.member_id, body.work_date.isoformat(), rate[0])).fetchone()[0]
            credit = bucket_delta(previous, body.seconds, rate[0]) if body.effort_credit else body.result_minor
            db.execute("INSERT INTO work_records VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
                body.id, body.member_id, body.title, body.work_date.isoformat(), body.seconds,
                rate[0], int(body.effort_credit), credit, body.notes, fingerprint, int(time.time())))
            timer = db.execute("SELECT * FROM live_timers WHERE id=?", (body.id,)).fetchone()
            if timer:
                if timer["member_id"] != body.member_id or timer["stopped_at"] is None:
                    raise HTTPException(409, "Сначала остановите таймер этого участника")
                db.execute("DELETE FROM live_timers WHERE id=?", (body.id,))
            if credit:
                post_entry(db, LedgerCommand(member_id=body.member_id, kind="labor", amount_minor=credit,
                    currency="RUB", business_key="work:" + body.id, source_id=body.id, policy_id="honest-v1", target_entry_id=None,
                    reason=body.title + (" [время × ставка]" if body.effort_credit else " [согласованный результат]")))
            return dict(db.execute("SELECT * FROM work_records WHERE id=?", (body.id,)).fetchone())

    @app.post("/api/money", dependencies=protected, status_code=201)
    def money(body: MoneyInput):
        try:
            command = LedgerCommand(member_id=body.member_id, kind=body.kind, amount_minor=body.amount_minor,
                currency="RUB", business_key="money:" + body.id, source_id=body.id, policy_id="honest-v1",
                target_entry_id=body.target_entry_id, reason=body.reason)
            with database(settings.data_dir) as db:
                return post_entry(db, command)
        except ValueError as exc:
            if isinstance(exc, Conflict):
                raise
            raise HTTPException(422, str(exc)) from exc

    @app.post("/api/timers", dependencies=protected, status_code=201)
    def start_timer(body: TimerInput):
        with database(settings.data_dir) as db, transaction(db):
            old = db.execute("SELECT * FROM live_timers WHERE member_id=?", (body.member_id,)).fetchone()
            if old:
                if old["id"] == body.id and old["title"] == body.title:
                    return dict(old)
                raise HTTPException(409, "У этого участника уже идёт таймер")
            db.execute("INSERT INTO live_timers VALUES (?,?,?,?,NULL)", (body.member_id, body.id, body.title, int(time.time())))
            return dict(db.execute("SELECT * FROM live_timers WHERE id=?", (body.id,)).fetchone())

    @app.post("/api/timers/{timer_id}/stop", dependencies=protected)
    def stop_timer(timer_id: str):
        # Stop only returns a draft duration; the participant confirms/edits it before accounting.
        with database(settings.data_dir) as db, transaction(db):
            timer = db.execute("SELECT * FROM live_timers WHERE id=?", (timer_id,)).fetchone()
            if not timer:
                raise HTTPException(404, "Таймер уже остановлен")
            result = dict(timer)
            stopped_at = timer["stopped_at"] or int(time.time())
            result["seconds"] = max(1, stopped_at - timer["started_at"])
            result["stopped_at"] = stopped_at
            db.execute("UPDATE live_timers SET stopped_at=? WHERE id=?", (stopped_at, timer_id))
            return result

    from .ai_routes import install_ai_routes
    install_ai_routes(app, settings, protected)
    app.state.protected = protected
    return app
