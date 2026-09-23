"""FastAPI application: project CRUD, transcript import, three-way merge."""
from __future__ import annotations

import json
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, importer, quality, rules
from .merge import merge_documents
from .schemas import (
    DocumentIn,
    MergeRequest,
    ProjectIn,
    ProjectUpdate,
    QualityCheckRequest,
    QualityScanCompareRequest,
    RuleIn,
    RulePreviewRequest,
)

app = FastAPI(title="访谈音频校注", version="1.0.0")

STATIC_DIR = os.environ.get("STATIC_DIR", "/app/static")


@app.on_event("startup")
def _startup() -> None:
    db.init()


def _doc(payload: DocumentIn | None) -> dict | None:
    if payload is None:
        return None
    return {"segments": payload.segments, "annotations": payload.annotations}


def _get_or_404(project_id: str) -> dict:
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


# ---------- projects ----------

@app.get("/api/projects")
def list_projects() -> list[dict]:
    return db.list_projects()


@app.post("/api/projects", status_code=201)
def create_project(payload: ProjectIn) -> dict:
    return db.create_project(payload.name.strip())


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict:
    return _get_or_404(project_id)


@app.put("/api/projects/{project_id}")
def save_project(project_id: str, payload: ProjectUpdate) -> dict:
    _get_or_404(project_id)
    name = payload.name.strip() if payload.name else None
    project = db.update_project(project_id, name, _doc(payload.document))
    return project


@app.delete("/api/projects/{project_id}", status_code=204)
def remove_project(project_id: str):
    if not db.delete_project(project_id):
        raise HTTPException(status_code=404, detail="项目不存在")
    return JSONResponse(status_code=204, content=None)


@app.get("/api/projects/{project_id}/export")
def export_project(project_id: str):
    from urllib.parse import quote

    project = _get_or_404(project_id)
    fname = quote(f"{project['name']}-annotations.json")
    return JSONResponse(
        content=project["document"],
        media_type="application/json",
        headers={
            "Content-Disposition":
                f"attachment; filename=annotations.json; filename*=UTF-8''{fname}"
        },
    )


# ---------- import ----------

def _run_import(content: Any) -> dict:
    try:
        return importer.parse_document(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _parse_uploaded(filename: str, raw: bytes) -> dict:
    text = raw.decode("utf-8-sig")
    if filename.lower().endswith((".txt", ".srt", ".vtt")):
        return _run_import(text)
    try:
        return _run_import(json.loads(text))
    except json.JSONDecodeError:
        return _run_import(text)


@app.post("/api/import")
async def import_transcript(request: Request) -> dict:
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        file = form.get("file")
        if file is None or not hasattr(file, "filename"):
            raise HTTPException(status_code=400, detail="表单中缺少 file")
        return _parse_uploaded(file.filename or "upload.txt",
                               await file.read())
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="请上传文件或提供 text/data")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return _run_import(body.decode("utf-8-sig"))
    if isinstance(payload, dict) and (payload.get("text")
                                      or payload.get("data") is not None):
        return _run_import(payload["data"] if payload.get("data") is not None
                           else payload["text"])
    return _run_import(payload)


@app.post("/api/projects/{project_id}/import")
async def import_into_project(project_id: str, request: Request) -> dict:
    project = _get_or_404(project_id)
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        file = form.get("file")
        if file is None or not hasattr(file, "filename"):
            raise HTTPException(status_code=400, detail="表单中缺少 file")
        doc = _parse_uploaded(file.filename or "upload.txt", await file.read())
    else:
        body = await request.body()
        if not body:
            raise HTTPException(status_code=400, detail="请上传文件或提供 text/data")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            doc = _run_import(body.decode("utf-8-sig"))
        else:
            if isinstance(payload, dict) and (payload.get("text")
                                              or payload.get("data") is not None):
                doc = _run_import(payload["data"]
                                  if payload.get("data") is not None
                                  else payload["text"])
            else:
                doc = _run_import(payload)
    # import replaces the transcript but preserves existing annotations
    doc["annotations"] = project["document"].get("annotations", [])
    return db.update_project(project_id, None, doc)


# ---------- rule-based batch annotation ----------

def _rule_dict(rule_row: dict) -> dict:
    """Convert a stored rule (camelCase API shape) to engine shape."""
    return {
        "name": rule_row["name"],
        "speaker": rule_row.get("speaker", ""),
        "pattern": rule_row.get("pattern", ""),
        "matchType": rule_row.get("matchType", "keyword"),
        "caseSensitive": rule_row.get("caseSensitive", False),
        "minDuration": rule_row.get("minDuration", 0.0),
        "topic": rule_row.get("topic", ""),
        "noteTemplate": rule_row.get("noteTemplate", ""),
        "color": rule_row.get("color", rules.DEFAULT_COLOR),
    }


def _preview(project_id: str, rule_config: dict, rule_id: str) -> dict:
    try:
        return rules.evaluate_rule(rule_config, rule_id,
                                   _get_or_404(project_id)["document"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/projects/{project_id}/rules")
def list_rules(project_id: str) -> list[dict]:
    _get_or_404(project_id)
    return db.list_rules(project_id)


@app.post("/api/projects/{project_id}/rules", status_code=201)
def create_rule(project_id: str, payload: RuleIn) -> dict:
    _get_or_404(project_id)
    data = payload.model_dump()
    try:
        rules.compile_matcher(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return db.create_rule(project_id, data)


@app.get("/api/rules/{rule_id}")
def get_rule(rule_id: str) -> dict:
    rule = db.get_rule(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="规则不存在")
    return rule


@app.put("/api/rules/{rule_id}")
def update_rule(rule_id: str, payload: RuleIn) -> dict:
    existing = db.get_rule(rule_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="规则不存在")
    data = payload.model_dump()
    try:
        rules.compile_matcher(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return db.update_rule(rule_id, data)


@app.delete("/api/rules/{rule_id}", status_code=204)
def remove_rule(rule_id: str):
    if not db.delete_rule(rule_id):
        raise HTTPException(status_code=404, detail="规则不存在")
    return JSONResponse(status_code=204, content=None)


@app.post("/api/projects/{project_id}/rules/preview")
def preview_unsaved_rule(project_id: str, payload: RulePreviewRequest) -> dict:
    """Preview a rule draft (no rule id yet) against the project."""
    if payload.rule is None:
        raise HTTPException(status_code=400, detail="缺少 rule")
    return _preview(project_id, payload.rule.model_dump(), "preview")


@app.post("/api/rules/{rule_id}/preview")
def preview_saved_rule(rule_id: str) -> dict:
    rule = db.get_rule(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="规则不存在")
    try:
        return rules.evaluate_rule(
            _rule_dict(rule), rule_id,
            _get_or_404(rule["projectId"])["document"],
            db.rule_tombstones(rule_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/rules/{rule_id}/apply")
def apply_rule(rule_id: str) -> dict:
    rule = db.get_rule(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="规则不存在")
    result = db.apply_rule_run(rule_id)
    return {"run": result["run"], "document": result["document"]}


@app.get("/api/projects/{project_id}/rule-runs")
def list_rule_runs(project_id: str) -> list[dict]:
    _get_or_404(project_id)
    return db.list_rule_runs(project_id)


@app.post("/api/rule-runs/{run_id}/undo")
def undo_rule_run(run_id: str) -> dict:
    run = db.get_rule_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="应用记录不存在")
    try:
        result = db.undo_rule_run(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"run": result["run"], "document": result["document"]}


# ---------- annotation quality check ----------

@app.post("/api/projects/{project_id}/quality-check")
def quality_check(project_id: str, payload: QualityCheckRequest | None = None) -> dict:
    """Scan the saved project document for annotation quality issues.

    Every scan (time window, statistics and the full issue snapshot) is
    stored in SQLite and returned as ``scan`` for later comparison.
    """
    project = _get_or_404(project_id)
    start = payload.start if payload is not None else None
    end = payload.end if payload is not None else None
    if start is not None and end is not None and end <= start:
        raise HTTPException(status_code=400,
                            detail="结束时间必须晚于开始时间")
    try:
        result = quality.check_document(project["document"], start, end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    result["projectId"] = project_id
    result["projectName"] = project["name"]
    scan = db.create_quality_scan(project_id, result)
    result["scanId"] = scan["id"]
    result["scannedAt"] = scan["createdAt"]
    return result


@app.get("/api/projects/{project_id}/quality-scans")
def list_quality_scans(project_id: str) -> list[dict]:
    """List the project's quality scans (newest first, summaries only)."""
    _get_or_404(project_id)
    return db.list_quality_scans(project_id)


@app.get("/api/projects/{project_id}/quality-scans/{scan_id}")
def get_quality_scan(project_id: str, scan_id: str) -> dict:
    """Fetch one stored scan with its full issue snapshot."""
    _get_or_404(project_id)
    scan = db.get_quality_scan(project_id, scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="扫描记录不存在")
    return scan


@app.post("/api/projects/{project_id}/quality-scans/compare")
def compare_quality_scans(project_id: str,
                          payload: QualityScanCompareRequest) -> dict:
    """Compare two scans by stable issueId (new / resolved / persistent).

    Scans with different time windows cannot be compared: the request is
    rejected with 400 before any diffing happens.
    """
    _get_or_404(project_id)
    if payload.scanIdA == payload.scanIdB:
        raise HTTPException(status_code=400,
                            detail="请选择两次不同的扫描进行比较")
    scan_a = db.get_quality_scan(project_id, payload.scanIdA)
    scan_b = db.get_quality_scan(project_id, payload.scanIdB)
    if scan_a is None or scan_b is None:
        raise HTTPException(status_code=404, detail="扫描记录不存在")
    # base = older scan, target = newer scan, regardless of request order
    base_scan, target_scan = sorted(
        [scan_a, scan_b], key=lambda s: (s["createdAt"], s["id"]))
    try:
        return quality.compare_scans(base_scan, target_scan)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------- three-way merge ----------

@app.post("/api/merge")
def merge(payload: MergeRequest) -> dict:
    base = _doc(payload.base) if payload.base is not None else None
    if base is None:
        if not payload.projectId:
            raise HTTPException(
                status_code=400,
                detail="需要提供 base 文档，或用 projectId 指定基准项目",
            )
        base = _get_or_404(payload.projectId)["document"]

    resolutions = None
    if payload.resolutions:
        resolutions = {k: v.model_dump() for k, v in payload.resolutions.items()}

    result = merge_documents(base, _doc(payload.a), _doc(payload.b), resolutions)

    if payload.saveAsProject:
        created = db.create_project(payload.saveAsProject.strip(),
                                    result["document"])
        result["savedProject"] = {"id": created["id"], "name": created["name"]}
    elif payload.projectId and not result["unresolved"] and not result["errors"]:
        # fully resolved merge writes back to the base project
        project = db.update_project(payload.projectId, None, result["document"])
        result["savedProject"] = {"id": project["id"], "name": project["name"]}
    return result


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# ---------- static frontend (served in the Docker image) ----------

if os.path.isdir(STATIC_DIR):
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        from fastapi.responses import FileResponse

        target = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(target):
            return FileResponse(target)
        # client-side routes (projects/:id/rules, merge, ...) -> index.html
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
