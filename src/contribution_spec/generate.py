"""Generate normative JSON Schemas and a DESIGN contract, not running API endpoints."""
from __future__ import annotations

import json
from pathlib import Path

from .contracts import EXPORTS



def obj(properties=None, required=None):
    p = properties or {}
    return {"type":"object","additionalProperties":False,"properties":p,"required":required or list(p)}


def ref(name):
    return {"$ref":"#/components/schemas/"+name}


def build_openapi():
    components = {}
    for name, cls in EXPORTS.items():
        value = cls.model_json_schema(ref_template="#/components/schemas/{model}")
        for child, schema in value.pop("$defs",{}).items():
            if child in components and components[child] != schema:
                raise ValueError("schema collision")
            components[child] = schema
        components[name] = value
    string={"type":"string"}; integer={"type":"integer","minimum":1}
    components.update({
        "Error":obj({"error":obj({"code":string,"message":string,"retryable":{"type":"boolean"},"current_revision":{"type":["integer","null"]},"request_id":string})}),
        "JobAccepted":obj({"job_id":string,"state":{"enum":["queued","running","done"]}}),
        "RecordRef":obj({"id":string,"revision":integer}),
        "Health":obj({"core_writable":{"type":"boolean"},"features":obj({"uploads":{"type":"boolean"},"summarization":{"type":"boolean"},"judges":{"type":"boolean"}})}),
        "TaskWrite":obj({"title":string,"scope":string,"status":{"enum":["planned","in_progress","done","abandoned"]},"parent_id":{"type":["string","null"]}}),
        "TaskView":obj({"id":string,"revision":integer,"task":ref("TaskWrite"),"active_report_id":{"type":["string","null"]},"active_round_id":{"type":["string","null"]}}),
        "SessionView":obj({"manifest":ref("SessionManifest"),"ingest_state":{"enum":["metadata","uploading","accepted"]},"missing_artifacts":{"type":"array","items":string}}),
        "ArtifactReceipt":obj({"artifact_id":string,"stored":{"type":"boolean"},"sha256":string}),
        "MemberView":obj({"id":string,"display_name":string,"timezone":string,"is_admin":{"type":"boolean"}}),
        "LedgerView":obj({"currency":string,"entries":{"type":"array","items":obj({"id":string,"member_id":string,"kind":string,"amount_minor":{"type":"integer"},"source_id":string,"policy_id":string,"target_entry_id":{"type":["string","null"]}})},"pending_unpriced_seconds":{"type":"integer","minimum":0}}),
        "JobView":obj({"id":string,"kind":string,"state":string,"attempt_count":{"type":"integer"},"error":{"type":["string","null"]}}),
        "RoundView":obj({"id":string,"packet_id":string,"collection_status":{"enum":["queued","running","partial","complete","cancelled"]},"slots":{"type":"array","minItems":9,"maxItems":9,"items":obj({"model_key":string,"sample_index":{"type":"integer","minimum":1,"maximum":3},"answer":{"anyOf":[ref("JudgeAnswer"),{"type":"null"}]},"attempt_count":{"type":"integer"}})},"aggregate":{"type":["object","null"],"additionalProperties":True}}),
    })
    expected=obj({"expected_revision":integer})
    paths={}
    def endpoint(method,path,operation,body=None,response=None,status="200",scope="owner",binary=False,idem=False):
        parameters=[]
        for part in path.split("/"):
            if part.startswith("{"):
                parameters.append({"name":part[1:-1],"in":"path","required":True,"schema":string})
        if idem:
            parameters.append({"name":"Idempotency-Key","in":"header","required":True,"schema":{"type":"string","minLength":1,"maxLength":128}})
        if method=="patch":
            parameters.append({"name":"If-Match","in":"header","required":True,"schema":string,"description":"Quoted integer revision; missing=428, mismatch=409."})
        op={"operationId":operation,"x-required-scope":scope,"parameters":parameters,
            "summary":operation.replace("_"," "),"responses":{},
            "security":[] if scope=="public" else [{"deviceBearer":[]},{"browserCookie":[]}]}
        if body is not None:
            op["requestBody"]={"required":True,"content":{"application/octet-stream" if binary else "application/json":{"schema":body}}}
        op["responses"][status]={"description":"Success"}
        if response is not None:
            content_type="application/zip" if operation=="export_assessment" else "application/json"
            op["responses"][status]["content"]={content_type:{"schema":response}}
        for code in ["400","401","403","404","409","413","422","428","503","507"]:
            op["responses"][code]={"description":"See the error-code policy in ULTIMATE_SPEC.md","content":{"application/json":{"schema":ref("Error")}}}
        paths.setdefault(path,{})[method]=op
    endpoint("get","/health/live","liveness",response=obj({"alive":{"type":"boolean"}}),scope="public")
    endpoint("get","/health/ready","core_readiness",response=ref("Health"),scope="public")
    endpoint("post","/api/login","login",obj({"code":string}),ref("MemberView"),scope="public")
    endpoint("post","/api/logout","logout",obj(),status="204")
    endpoint("get","/api/me","my_profile",response=ref("MemberView"))
    endpoint("post","/api/tasks","create_task",ref("TaskWrite"),ref("RecordRef"),"201",idem=True)
    endpoint("get","/api/tasks/{id}","read_task",response=ref("TaskView"),scope="team_published_or_owner")
    endpoint("patch","/api/tasks/{id}","edit_task",ref("TaskWrite"),ref("RecordRef"))
    endpoint("put","/api/sessions/{id}","accept_session_manifest",ref("SessionManifest"),ref("SessionView"))
    endpoint("get","/api/sessions/{id}","read_own_session",response=ref("SessionView"))
    endpoint("post","/api/artifacts","declare_artifact",ref("ArtifactDeclaration"),ref("ArtifactReceipt"),"201",idem=True)
    endpoint("put","/api/artifacts/{id}/bytes","upload_artifact",{"type":"string","format":"binary"},ref("ArtifactReceipt"),binary=True)
    endpoint("get","/api/artifacts/{id}/bytes","read_artifact",response={"type":"string","format":"binary"},scope="owner_or_published_excerpt")
    # Override binary download type.
    paths["/api/artifacts/{id}/bytes"]["get"]["responses"]["200"]["content"]={"application/octet-stream":{"schema":{"type":"string","format":"binary"}}}
    endpoint("post","/api/sessions/{id}/finalize","finalize_session",obj({"revision":integer,"manifest_sha256":string}),ref("SessionView"),idem=True)
    endpoint("post","/api/tasks/{id}/summarize","summarize_task",obj({"session_ids":{"type":"array","items":string}}),ref("JobAccepted"),"202",idem=True)
    endpoint("get","/api/reports/{id}","read_report",response=ref("Report"),scope="owner_or_published")
    endpoint("put","/api/reports/{id}","save_report_draft",ref("Report"),ref("RecordRef"))
    endpoint("post","/api/reports/{id}/approve","approve_report",expected,ref("RecordRef"),idem=True)
    endpoint("post","/api/reports/{id}/packets","publish_reviewed_blind_packet",ref("BlindPacket"),ref("RecordRef"),"201",idem=True)
    endpoint("post","/api/tasks/{id}/assess","start_assessment_round",ref("RoundRequest"),ref("JobAccepted"),"202",scope="team_published_or_owner",idem=True)
    endpoint("get","/api/assessments/{id}","read_assessment",response=ref("RoundView"),scope="team_published_or_owner")
    endpoint("post","/api/assessments/{id}/recalculate","recalculate_without_models",obj(),ref("RoundView"),scope="team_published_or_owner")
    endpoint("get","/api/assessments/{id}/export","export_assessment",response={"type":"string","format":"binary"},scope="team_published_or_owner")
    endpoint("post","/api/tasks/{id}/active-assessment","select_reference_round",obj({"round_id":string,"reason":string}),ref("RecordRef"),idem=True)
    endpoint("post","/api/ledger/entries","post_contribution",ref("LedgerCommand"),ref("RecordRef"),"201",idem=True)
    endpoint("get","/api/ledger","read_team_contributions",response=ref("LedgerView"),scope="team")
    endpoint("get","/api/jobs","read_accessible_jobs",response={"type":"array","items":ref("JobView")},scope="filtered_by_owner_or_admin")
    endpoint("post","/api/jobs/{id}/retry","retry_failed_operation",obj({"reason":string}),ref("JobAccepted"),"202",idem=True)
    endpoint("post","/api/jobs/{id}/cancel","cancel_future_work",obj(),ref("JobView"),idem=True)
    return {"openapi":"3.1.0","info":{"title":"Contribution v2 — normative future API contract","version":"2.0.0","description":"No production endpoints are implemented by this specification pack."},
            "paths":paths,"components":{"schemas":components,"securitySchemes":{
                "deviceBearer":{"type":"http","scheme":"bearer"},
                "browserCookie":{"type":"apiKey","in":"cookie","name":"contribution_session"}}}}


def generate(root: Path):
    schemas=root/"contracts/schemas"; schemas.mkdir(parents=True,exist_ok=True)
    for name,cls in EXPORTS.items():
        schema=cls.model_json_schema(); schema["$schema"]="https://json-schema.org/draft/2020-12/schema"
        (schemas/(name+".schema.json")).write_text(json.dumps(schema,ensure_ascii=False,indent=2)+"\n")
    (root/"contracts/openapi.json").write_text(json.dumps(build_openapi(),ensure_ascii=False,indent=2)+"\n")


if __name__=="__main__":
    generate(Path(__file__).resolve().parents[2])
