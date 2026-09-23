"""End-to-end API tests for quality-check scan history & scan comparison.

Run with: python3 test_quality_history_api.py  (or via pytest).
"""
import os
import shutil
import tempfile

os.environ.setdefault("STATIC_DIR", "/nonexistent")
_TMP = tempfile.mkdtemp(prefix="quality-history-api-")
os.environ["DATA_DIR"] = _TMP

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app import quality  # noqa: E402


def _doc(*, oob_end=30, include_speaker_issue=True, extra_ann=None):
    annotations = [
        {"id": "ann-oob", "start": 18, "end": oob_end,
         "speaker": "受访者", "topic": "越界条"},
        {"id": "ann-a", "start": 0, "end": 5,
         "speaker": "访谈者", "topic": "重叠甲"},
        {"id": "ann-b", "start": 1, "end": 4,
         "speaker": "访谈者", "topic": "重叠乙"},
    ]
    if include_speaker_issue:
        annotations.append(
            {"id": "ann-sp", "start": 15, "end": 18,
             "speaker": "访谈者", "topic": "说错话人"})
    if extra_ann:
        annotations.append(extra_ann)
    return {
        "segments": [
            {"id": "s1", "start": 0, "end": 5,
             "speaker": "访谈者", "text": "开场"},
            {"id": "s2", "start": 5, "end": 10,
             "speaker": "访谈者", "text": "提问"},
            {"id": "s3", "start": 15, "end": 20,
             "speaker": "受访者", "text": "改制"},
        ],
        "annotations": annotations,
    }


def run():
    with TestClient(app) as c:
        assert c.get("/api/health").json()["status"] == "ok"
        pid = c.post("/api/projects", json={"name": "质检历史访谈"}).json()["id"]
        c.put(f"/api/projects/{pid}",
              json={"name": "质检历史访谈", "document": _doc()})

        # every scan is persisted and echoed with a scanId / scannedAt
        r1 = c.post(f"/api/projects/{pid}/quality-check")
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["scanId"]
        assert d1["scannedAt"]
        assert d1["summary"]["total"] == 3
        scan1_id = d1["scanId"]

        # fix the out-of-bounds annotation, scan again over the SAME explicit
        # window (0..30) so the two scans remain comparable by issueId
        c.put(f"/api/projects/{pid}",
              json={"name": "质检历史访谈",
                    "document": _doc(oob_end=20, include_speaker_issue=False)})
        r2 = c.post(f"/api/projects/{pid}/quality-check",
                    json={"start": 0, "end": 30})
        d2 = r2.json()
        scan2_id = d2["scanId"]
        assert scan2_id != scan1_id
        # the resolved window coincides with scan 1 even though the document
        # span shrank (fixed annotations now end at 20s)
        assert d1["window"] == d2["window"] == {"start": 0.0, "end": 30.0}
        assert d1["explicitWindow"] is False
        assert d2["explicitWindow"] is True

        # history lists both scans, newest first, with stats but no issues
        hist = c.get(f"/api/projects/{pid}/quality-scans").json()
        assert [s["id"] for s in hist] == [scan2_id, scan1_id]
        for s in hist:
            assert s["projectId"] == pid
            assert s["window"] == {"start": 0.0, "end": 30.0}
            assert "summary" in s and "total" in s["summary"]
            assert "issues" not in s
            assert s["createdAt"]

        # detail endpoint returns the full issue snapshot
        detail = c.get(f"/api/quality-scans/{scan1_id}").json()
        assert {q["issueId"] for q in detail["issues"]} == {
            "qc:overlap:ann-a|ann-b",
            "qc:speaker_mismatch:ann-sp",
            "qc:out_of_bounds:ann-oob",
        }
        assert detail["summary"] == d1["summary"]
        assert c.get("/api/quality-scans/scan-nope").status_code == 404

        # compare same-window scans: overlap persisted, two resolved
        cmp = c.post(
            f"/api/projects/{pid}/quality-scans/compare",
            json={"baseScanId": scan1_id, "targetScanId": scan2_id},
        ).json()
        assert cmp["window"] == {"start": 0.0, "end": 30.0}
        assert cmp["counts"]["persisted"] == 1
        assert cmp["counts"]["resolved"] == 2
        assert cmp["counts"]["new"] == 0
        assert cmp["persisted"][0]["base"]["issueId"] == \
            cmp["persisted"][0]["target"]["issueId"] == \
            "qc:overlap:ann-a|ann-b"
        assert {q["issueId"] for q in cmp["resolved"]} == {
            "qc:out_of_bounds:ann-oob",
            "qc:speaker_mismatch:ann-sp",
        }
        assert cmp["baseScan"]["id"] == scan1_id
        assert cmp["targetScan"]["id"] == scan2_id

        # third scan: introduce a fresh annotation creating a new overlap
        c.put(f"/api/projects/{pid}",
              json={"name": "质检历史访谈",
                    "document": _doc(
                        oob_end=20, include_speaker_issue=False,
                        extra_ann={"id": "ann-c", "start": 2, "end": 3,
                                   "speaker": "访谈者", "topic": "重叠丙"})})
        d3 = c.post(f"/api/projects/{pid}/quality-check",
                    json={"start": 0, "end": 30}).json()
        scan3_id = d3["scanId"]
        new_ids = {
            "qc:overlap:ann-a|ann-c",
            "qc:overlap:ann-b|ann-c",
        }
        cmp3 = c.post(
            f"/api/projects/{pid}/quality-scans/compare",
            json={"baseScanId": scan2_id, "targetScanId": scan3_id},
        ).json()
        assert {q["issueId"] for q in cmp3["new"]} == new_ids
        assert cmp3["counts"]["new"] == 2
        assert [p["target"]["issueId"] for p in cmp3["persisted"]] == \
            ["qc:overlap:ann-a|ann-b"]
        assert cmp3["counts"]["resolved"] == 0
        assert cmp3["counts"]["newBySeverity"]["error"] >= 1

        # windows differing -> comparison is explicitly refused with 400
        dw = c.post(f"/api/projects/{pid}/quality-check",
                    json={"start": 0, "end": 10}).json()
        bad = c.post(
            f"/api/projects/{pid}/quality-scans/compare",
            json={"baseScanId": scan1_id, "targetScanId": dw["scanId"]},
        )
        assert bad.status_code == 400, bad.text
        assert "时间窗口不同" in bad.json()["detail"]

        # comparing a scan with itself -> 400
        same = c.post(
            f"/api/projects/{pid}/quality-scans/compare",
            json={"baseScanId": scan1_id, "targetScanId": scan1_id},
        )
        assert same.status_code == 400

        # missing scan -> 404
        missing = c.post(
            f"/api/projects/{pid}/quality-scans/compare",
            json={"baseScanId": scan1_id, "targetScanId": "scan-nope"},
        )
        assert missing.status_code == 404

        # scans of another project cannot be compared here
        pid2 = c.post("/api/projects", json={"name": "别的项目"}).json()["id"]
        c.put(f"/api/projects/{pid2}",
              json={"name": "别的项目", "document": _doc()})
        other = c.post(f"/api/projects/{pid2}/quality-check").json()
        foreign = c.post(
            f"/api/projects/{pid}/quality-scans/compare",
            json={"baseScanId": scan1_id, "targetScanId": other["scanId"]},
        )
        assert foreign.status_code == 400

        # deleting a project wipes its scan history (FK cascade)
        assert c.delete(f"/api/projects/{pid}").status_code == 204
        assert c.get(f"/api/projects/{pid}/quality-scans").status_code == 404
        assert c.get(f"/api/quality-scans/{scan1_id}").status_code == 404
        # the other project's history survives
        assert len(c.get(f"/api/projects/{pid2}/quality-scans").json()) == 1

        # pure helper sanity: same_window tolerance & mismatch
        assert quality.same_window({"start": 0.0, "end": 10.0},
                                   {"start": 1e-12, "end": 10.0})
        assert not quality.same_window({"start": 0.0, "end": 10.0},
                                       {"start": 0.0, "end": 11.0})

        print("ALL QUALITY HISTORY API TESTS PASSED")


if __name__ == "__main__":
    run()
    shutil.rmtree(_TMP, ignore_errors=True)
