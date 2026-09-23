"""Pydantic schemas for the API."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class DocumentIn(BaseModel):
    segments: list[dict[str, Any]] = []
    annotations: list[dict[str, Any]] = []


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    document: DocumentIn


class ImportPayload(BaseModel):
    text: str | None = None
    data: Any | None = None


class Resolution(BaseModel):
    choice: Literal["a", "b", "custom", "drop", "keep", "fields"]
    value: dict[str, Any] | None = None
    fields: dict[str, Literal["a", "b"]] | None = None


class MergeRequest(BaseModel):
    projectId: str | None = None
    base: DocumentIn | None = None
    a: DocumentIn
    b: DocumentIn
    resolutions: dict[str, Resolution] | None = None
    saveAsProject: str | None = None


# ---------- rule-based batch annotation ----------

class RuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    speaker: str = ""
    pattern: str = ""
    matchType: Literal["keyword", "regex", "none"] = "keyword"
    caseSensitive: bool = False
    minDuration: float = Field(default=0.0, ge=0)
    topic: str = ""
    noteTemplate: str = ""
    color: str = "#5b8def"


class RulePreviewRequest(BaseModel):
    """Preview an (optionally still unsaved) rule against a project."""
    rule: RuleIn | None = None


# ---------- annotation quality check ----------

class QualityCheckRequest(BaseModel):
    """Optional time window; omitted fields default to the document span."""
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, ge=0)


class QualityScanCompareRequest(BaseModel):
    """Two scans of the same project; they must share an identical window."""
    scanIdA: str
    scanIdB: str
