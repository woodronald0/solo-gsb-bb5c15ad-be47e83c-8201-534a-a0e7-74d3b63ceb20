import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.js'
import Timeline from '../components/Timeline.jsx'
import { downloadJson, fmtDateTime, fmtTime, round3 } from '../utils.js'

const SEV_LABEL = { error: '严重', warning: '警告', info: '提示' }
const SEV_CLASS = { error: 'sev-error', warning: 'sev-warning', info: 'sev-info' }

const TYPE_META = {
  out_of_bounds: { label: '校注越界', icon: '🔹' },
  overlap: { label: '时间重叠', icon: '🔸' },
  speaker_mismatch: { label: '说话人不一致', icon: '🎤' },
  speaker_missing: { label: '说话人缺失', icon: '❔' },
}

const windowsEqual = (a, b) =>
  !!a && !!b
  && Math.abs(Number(a.start) - Number(b.start)) < 1e-6
  && Math.abs(Number(a.end) - Number(b.end)) < 1e-6

const windowText = (w) =>
  w ? `${fmtTime(w.start)} – ${fmtTime(w.end)}` : '--'

export default function QualityPage() {
  const { id: projectId } = useParams()
  const [project, setProject] = useState(null)
  const [result, setResult] = useState(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [winInput, setWinInput] = useState({ start: '', end: '' })
  const [sevFilter, setSevFilter] = useState(() => new Set())
  const [typeFilter, setTypeFilter] = useState(() => new Set())
  const [activeIssue, setActiveIssue] = useState(null) // issue object
  const [scans, setScans] = useState([])
  const [picked, setPicked] = useState([]) // up to two scan ids
  const [view, setView] = useState('live') // live | history | compare
  const [historyResult, setHistoryResult] = useState(null)
  const [compare, setCompare] = useState(null)
  const [comparing, setComparing] = useState(false)
  const timelineRef = useRef(null)

  const doc = project?.document || { segments: [], annotations: [] }

  const duration = useMemo(() => {
    const ends = [...doc.segments, ...doc.annotations].map((x) => x.end || 0)
    return round3(Math.max(0, ...ends))
  }, [doc])

  const displayedResult =
    view === 'history' ? historyResult
      : view === 'live' ? result
        : null

  const flash = (msg) => {
    setOk(msg)
    setTimeout(() => setOk(''), 3500)
  }

  const refreshScans = useCallback(async () => {
    try {
      setScans(await api.listQualityScans(projectId))
    } catch (e) {
      setError(e.message)
    }
  }, [projectId])

  const runCheck = async (keepWindow) => {
    setChecking(true); setError('')
    const body = {}
    if (keepWindow) {
      const s = Number(winInput.start)
      const e = Number(winInput.end)
      if (winInput.start !== '' && Number.isFinite(s) && s >= 0) body.start = s
      if (winInput.end !== '' && Number.isFinite(e) && e >= 0) body.end = e
    }
    try {
      const data = await api.qualityCheck(projectId, Object.keys(body).length ? body : null)
      setResult(data)
      setView('live')
      setHistoryResult(null)
      setCompare(null)
      setActiveIssue(null)
      await refreshScans()
      return data
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    api.getProject(projectId).then((p) => {
      setProject(p)
    }).catch((e) => setError(e.message))
    refreshScans()
  }, [projectId, refreshScans])

  const resetWindow = () => setWinInput({ start: '', end: '' })

  const toggle = (set, setter, value) => {
    const next = new Set(set)
    next.has(value) ? next.delete(value) : next.add(value)
    setter(next)
  }

  const locate = (issue) => {
    setActiveIssue(issue)
    setTimeout(() => timelineRef.current?.scrollIntoView(
      { behavior: 'smooth', block: 'center' }), 0)
  }

  const filtered = useMemo(() => {
    if (!displayedResult) return []
    return displayedResult.issues.filter((q) =>
      (sevFilter.size === 0 || sevFilter.has(q.severity)) &&
      (typeFilter.size === 0 || typeFilter.has(q.type)))
  }, [displayedResult, sevFilter, typeFilter])

  const focusRange = activeIssue
    ? { start: activeIssue.start, end: activeIssue.end }
    : null
  const highlightIds = activeIssue?.annotationIds || []

  /** One-click trim of a fixable out-of-bounds annotation, then save. */
  const applyFix = async (issue) => {
    const fix = issue.fix
    const annId = issue.annotationId
    if (!fix || !annId) return
    const target = doc.annotations.find((a) => a.id === annId)
    if (!target) {
      setError('待裁剪的校注已不存在，请重新运行质检')
      return
    }
    const nextAnnotations = doc.annotations.map((a) => {
      if (a.id !== annId) return a
      const fixed = { ...a, start: fix.start, end: fix.end }
      // clipping a rule-generated annotation detaches it, mirroring the
      // editor: from now on re-running that rule won't overwrite the trim
      if (fixed.source === 'rule') {
        delete fixed.source
        delete fixed.ruleName
      }
      return fixed
    })
    const nextDoc = { ...doc, annotations: nextAnnotations }
    setError('')
    try {
      const saved = await api.saveProject(projectId, {
        name: project.name, document: nextDoc,
      })
      setProject(saved)
      flash(`已裁剪校注「${target.topic || annId}」到 ` +
        `${fmtTime(fix.start)} – ${fmtTime(fix.end)} 并保存`)
      const rechecked = await runCheck(true)
      if (rechecked) {
        const still = rechecked.issues.find((q) => q.issueId === issue.issueId)
        setActiveIssue(still || null)
      }
    } catch (e) {
      setError(`裁剪保存失败：${e.message}`)
    }
  }

  const exportResult = () => {
    if (!displayedResult) return
    downloadJson(`${project?.name || 'project'}-quality-check.json`, {
      kind: 'annotation-quality-check',
      projectId,
      projectName: project?.name || '',
      exportedAt: new Date().toISOString(),
      result: displayedResult,
    })
  }

  // ----- scan history -----

  const pickedScans = useMemo(
    () => picked
      .map((sid) => scans.find((s) => s.id === sid))
      .filter(Boolean),
    [picked, scans],
  )
  const windowsDiffer = pickedScans.length === 2
    && !windowsEqual(pickedScans[0].window, pickedScans[1].window)

  const togglePick = (scanId) => {
    setPicked((p) => {
      if (p.includes(scanId)) return p.filter((x) => x !== scanId)
      if (p.length >= 2) return p
      return [...p, scanId]
    })
  }

  const openScan = async (scanId) => {
    setError('')
    try {
      const detail = await api.getQualityScan(scanId)
      setHistoryResult(detail)
      setCompare(null)
      setActiveIssue(null)
      setView('history')
    } catch (e) {
      setError(e.message)
    }
  }

  const backToLive = () => {
    setView('live')
    setHistoryResult(null)
    setActiveIssue(null)
  }

  const runCompare = async () => {
    if (pickedScans.length !== 2 || windowsDiffer) return
    setComparing(true)
    setError('')
    // older scan is the baseline, newer scan is the target so that
    // 新增 / 已解决 follow the forward direction in time
    const [older, newer] =
      [...pickedScans].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    try {
      const data = await api.compareQualityScans(
        projectId, older.id, newer.id)
      setCompare(data)
      setView('compare')
      setActiveIssue(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setComparing(false)
    }
  }

  if (!project && !error) return <div className="page">加载中…</div>

  return (
    <div className="page quality-page">
      <div className="page-head">
        <div className="title-line">
          <Link to={`/projects/${projectId}`} className="back">
            ← 返回校注
          </Link>
          <h2>校注质检 · {project?.name}</h2>
        </div>
        <div className="head-actions">
          <Link className="btn" to={`/projects/${projectId}`}>
            打开时间轴校注
          </Link>
          <button
            className="btn"
            disabled={!displayedResult}
            onClick={exportResult}
          >
            ⬇️ 导出质检 JSON
          </button>
          <button
            className="btn primary"
            disabled={checking}
            onClick={() => runCheck(true)}
          >
            {checking ? '扫描中…' : '🔎 开始质检'}
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="panel qc-controls">
        <div className="qc-window-row">
          <label>
            时间区间（秒，留空 = 整条转写）
            <div className="qc-window-inputs">
              <input
                type="number" min="0" step="0.1" placeholder="开始"
                value={winInput.start}
                onChange={(e) => setWinInput((w) => ({ ...w, start: e.target.value }))}
              />
              <span className="muted">–</span>
              <input
                type="number" min="0" step="0.1" placeholder="结束"
                value={winInput.end}
                onChange={(e) => setWinInput((w) => ({ ...w, end: e.target.value }))}
              />
              <button className="btn small" onClick={resetWindow}>
                重置为全部
              </button>
            </div>
          </label>
          <div className="muted small qc-window-hint">
            扫描线沿时间轴建立，检测校注越界、校注重叠与说话人不一致。
            当前文档时长 {fmtTime(duration)}。
          </div>
        </div>
      </div>

      <ScanHistoryPanel
        scans={scans}
        picked={picked}
        currentScanId={displayedResult?.id || result?.scanId}
        onTogglePick={togglePick}
        onClearPicks={() => setPicked([])}
        onOpen={openScan}
        onCompare={runCompare}
        comparing={comparing}
        windowsDiffer={windowsDiffer}
      />

      {view === 'history' && historyResult && (
        <div className="panel qc-history-banner">
          <span>
            🕘 正在查看历史扫描：<strong>{fmtDateTime(historyResult.createdAt)}</strong>
            {' '}· 时间窗口 {windowText(historyResult.window)}
            {!historyResult.explicitWindow && '（整条转写）'}
          </span>
          <button className="btn small" onClick={backToLive}>
            返回当前扫描结果
          </button>
        </div>
      )}

      {view === 'compare' && compare && (
        <CompareView
          compare={compare}
          onExit={() => { setView('live'); setCompare(null) }}
          projectId={projectId}
        />
      )}

      {view !== 'compare' && displayedResult && (
        <SummaryBar result={displayedResult} />
      )}

      {view !== 'compare' && displayedResult && (
        <div className="panel qc-timeline-panel" ref={timelineRef}>
          <Timeline
            duration={duration}
            segments={doc.segments}
            annotations={doc.annotations}
            highlightIds={activeIssue ? highlightIds : null}
            focusRange={focusRange}
            readOnly
            onSelect={() => {}}
            onBackgroundClick={() => setActiveIssue(null)}
            onClickItem={(annId) => {
              const issue = displayedResult.issues.find(
                (q) => q.annotationId === annId
                  || q.annotationIds.includes(annId))
              if (issue) locate(issue)
            }}
          />
          {activeIssue && (
            <div className={`qc-focus-hint ${SEV_CLASS[activeIssue.severity]}`}>
              <strong>
                {TYPE_META[activeIssue.type].icon}{' '}
                {TYPE_META[activeIssue.type].label} ·{' '}
                {SEV_LABEL[activeIssue.severity]}
              </strong>
              <span>
                定位 {fmtTime(activeIssue.start)} – {fmtTime(activeIssue.end)}
              </span>
              <button className="btn small" onClick={() => setActiveIssue(null)}>
                取消定位
              </button>
            </div>
          )}
        </div>
      )}

      {view !== 'compare' && displayedResult && (
        <FilterBar
          result={displayedResult}
          sevFilter={sevFilter}
          typeFilter={typeFilter}
          onToggleSev={(v) => toggle(sevFilter, setSevFilter, v)}
          onToggleType={(v) => toggle(typeFilter, setTypeFilter, v)}
          shownCount={filtered.length}
        />
      )}

      {view !== 'compare' && displayedResult && filtered.length === 0 && (
        <div className="panel empty-hint">
          {displayedResult.issues.length === 0
            ? '🎉 未发现问题：所有校注都在转写范围内、互不重叠且说话人一致。'
            : '当前筛选条件下没有问题。'}
        </div>
      )}

      {view !== 'compare' && (
        <div className="qc-issue-list">
          {filtered.map((q) => (
            <IssueCard
              key={q.issueId}
              issue={q}
              active={activeIssue?.issueId === q.issueId}
              onLocate={() => locate(q)}
              onFix={view === 'live' ? () => applyFix(q) : null}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ScanHistoryPanel({
  scans, picked, currentScanId, onTogglePick, onClearPicks, onOpen,
  onCompare, comparing, windowsDiffer,
}) {
  const pickedScans = picked
    .map((sid) => scans.find((s) => s.id === sid))
    .filter(Boolean)
  const canCompare = pickedScans.length === 2 && !windowsDiffer
  return (
    <div className="panel qc-history">
      <div className="qc-history-head">
        <h3>扫描历史</h3>
        <span className="muted small">
          勾选两次时间窗口相同的扫描，按 issueId 比较新增 / 已解决 / 仍存在的问题
        </span>
      </div>
      {scans.length === 0 ? (
        <div className="muted small qc-history-empty">
          暂无扫描记录，点击「🔎 开始质检」后会在此保存时间窗口、扫描时间、统计与问题快照。
        </div>
      ) : (
        <table className="run-table qc-history-table">
          <thead>
            <tr>
              <th className="qc-pick-col">比较</th>
              <th>扫描时间</th>
              <th>时间窗口</th>
              <th>问题</th>
              <th>严重</th>
              <th>警告</th>
              <th>提示</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {scans.map((s) => {
              const checked = picked.includes(s.id)
              const disabled = !checked && picked.length >= 2
              return (
                <tr
                  key={s.id}
                  className={s.id === currentScanId ? 'qc-scan-current' : ''}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onTogglePick(s.id)}
                      title={disabled ? '一次最多选择两次扫描' : '选择用于比较'}
                    />
                  </td>
                  <td>{fmtDateTime(s.createdAt)}</td>
                  <td>
                    {windowText(s.window)}
                    {!s.explicitWindow && (
                      <span className="muted small">（整条转写）</span>
                    )}
                  </td>
                  <td>{s.summary.total}</td>
                  <td className="sev-error">{s.summary.error}</td>
                  <td className="sev-warning">{s.summary.warning}</td>
                  <td className="muted">{s.summary.info}</td>
                  <td>
                    <button
                      className="btn small"
                      onClick={() => onOpen(s.id)}
                    >
                      查看快照
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {pickedScans.length > 0 && (
        <div className="qc-compare-bar">
          {pickedScans.length === 2 ? (
            windowsDiffer ? (
              <span className="error qc-compare-msg">
                ⚠️ 两次扫描的时间窗口不同（
                {windowText(pickedScans[0].window)} 与{' '}
                {windowText(pickedScans[1].window)}
                ），问题快照无法对应，禁止比较；请选择窗口相同的两次扫描。
              </span>
            ) : (
              <span className="ok qc-compare-msg">
                已选择 {fmtDateTime(pickedScans[0].createdAt)} 与{' '}
                {fmtDateTime(pickedScans[1].createdAt)}
                （窗口均为 {windowText(pickedScans[0].window)}）
              </span>
            )
          ) : (
            <span className="muted small qc-compare-msg">
              已选择 {fmtDateTime(pickedScans[0].createdAt)}，请再选择一次扫描
            </span>
          )}
          <div className="qc-compare-actions">
            {picked.length > 0 && (
              <button
                className="btn small"
                onClick={onClearPicks}
                title="清空已选择的扫描"
              >
                清空选择
              </button>
            )}
            <button
              className="btn small primary"
              disabled={!canCompare || comparing}
              onClick={onCompare}
              title={windowsDiffer ? '时间窗口不同，不能比较' : ''}
            >
              {comparing ? '比较中…' : '🔍 比较两次扫描'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CompareView({ compare, onExit, projectId }) {
  const { counts } = compare
  const boxes = [
    ['新增问题', counts.new, 'qc-diff-new'],
    ['已解决', counts.resolved, 'qc-diff-resolved'],
    ['仍存在', counts.persisted, 'qc-diff-persisted'],
  ]
  return (
    <div className="qc-compare">
      <div className="panel qc-compare-head">
        <div>
          <h3>扫描结果对比</h3>
          <div className="muted small">
            基准（较早）{fmtDateTime(compare.baseScan.createdAt)}
            {' '}→ 较新扫描 {fmtDateTime(compare.targetScan.createdAt)}
            {' '}· 时间窗口 {windowText(compare.window)}
          </div>
        </div>
        <button className="btn small" onClick={onExit}>退出比较</button>
      </div>
      <div className="stats-grid qc-summary">
        {boxes.map(([label, value, cls]) => (
          <div key={label} className={`stat-box ${cls}`}>
            <strong>{label}</strong>
            <span>{value}</span>
          </div>
        ))}
      </div>

      <DiffGroup
        title="🆕 新增问题"
        hint="较新扫描中出现、基准扫描没有的问题"
        issues={compare.new}
        tag="新增"
        tagClass="qc-diff-new"
        projectId={projectId}
      />
      <DiffGroup
        title="✅ 已解决"
        hint="基准扫描中存在、较新扫描已消失的问题"
        issues={compare.resolved}
        tag="已解决"
        tagClass="qc-diff-resolved"
        projectId={projectId}
      />
      <DiffGroup
        title="➡️ 仍存在"
        hint="两次扫描都存在的问题（按较新扫描的快照展示）"
        entries={compare.persisted}
        tag="仍存在"
        tagClass="qc-diff-persisted"
        projectId={projectId}
      />
      {counts.new + counts.resolved + counts.persisted === 0 && (
        <div className="panel empty-hint">两次扫描的问题完全一致。</div>
      )}
    </div>
  )
}

function DiffGroup({
  title, hint, issues, entries, tag, tagClass, projectId,
}) {
  const list = entries
    ? entries.map((e) => ({
        issue: e.target,
        severityChanged: e.base.severity !== e.target.severity,
        oldSeverity: e.base.severity,
      }))
    : issues.map((issue) => ({ issue, severityChanged: false }))
  if (list.length === 0) return null
  return (
    <section className="qc-diff-group">
      <h4>
        {title}
        <span className="qc-diff-count">{list.length}</span>
        <span className="muted small"> {hint}</span>
      </h4>
      <div className="qc-issue-list">
        {list.map(({ issue, severityChanged, oldSeverity }) => (
          <IssueCard
            key={`${tag}-${issue.issueId}`}
            issue={issue}
            tag={tag}
            tagClass={tagClass}
            severityChanged={severityChanged}
            oldSeverity={oldSeverity}
            projectId={projectId}
          />
        ))}
      </div>
    </section>
  )
}

function SummaryBar({ result }) {
  const s = result.summary
  const boxes = [
    ['问题总数', s.total, ''],
    ['严重', s.error, 'sev-error'],
    ['警告', s.warning, 'sev-warning'],
    ['提示', s.info, 'sev-info'],
    ['可一键裁剪', s.fixable, ''],
    ['扫描线', s.scanLines, 'muted'],
  ]
  return (
    <div className="stats-grid qc-summary">
      {boxes.map(([label, value, cls]) => (
        <div key={label} className={`stat-box ${cls || ''}`}>
          <strong>{label}</strong>
          <span>{value}</span>
        </div>
      ))}
    </div>
  )
}

function FilterBar({
  result, sevFilter, typeFilter, onToggleSev, onToggleType, shownCount,
}) {
  const s = result.summary
  const sevItems = [
    ['error', `严重 ${s.error}`],
    ['warning', `警告 ${s.warning}`],
    ['info', `提示 ${s.info}`],
  ]
  const typeItems = [
    ['out_of_bounds', `🔹 越界 ${s.outOfBounds}`],
    ['overlap', `🔸 重叠 ${s.overlap}`],
    ['speaker_mismatch', `🎤 说话人不一致 ${s.speakerMismatch}`],
    ['speaker_missing', `❔ 说话人缺失 ${s.speakerMissing}`],
  ]
  return (
    <div className="panel qc-filters">
      <div className="qc-filter-group">
        <span className="muted small">级别：</span>
        {sevItems.map(([v, label]) => (
          <button
            key={v}
            className={`filter-chip ${SEV_CLASS[v]} ${
              sevFilter.has(v) ? 'on' : ''}`}
            onClick={() => onToggleSev(v)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="qc-filter-group">
        <span className="muted small">类型：</span>
        {typeItems.map(([v, label]) => (
          <button
            key={v}
            className={`filter-chip type ${typeFilter.has(v) ? 'on' : ''}`}
            onClick={() => onToggleType(v)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="muted small qc-filter-count">显示 {shownCount} / {s.total}</div>
    </div>
  )
}

function IssueCard({
  issue, active, onLocate, onFix, projectId, tag, tagClass,
  severityChanged, oldSeverity,
}) {
  const meta = TYPE_META[issue.type] || { label: issue.type, icon: '⚠️' }
  const editorUrl = `/projects/${projectId}?ann=${
    issue.annotationIds[0] || issue.annotationId || ''
  }&focusStart=${issue.start}&focusEnd=${issue.end}`
  return (
    <div
      className={`card qc-issue ${SEV_CLASS[issue.severity]} ${
        active ? 'active' : ''}`}
    >
      <div className="qc-issue-head">
        {tag && (
          <span className={`qc-diff-tag ${tagClass}`}>{tag}</span>
        )}
        <span className={`qc-sev-badge ${SEV_CLASS[issue.severity]}`}>
          {SEV_LABEL[issue.severity]}
        </span>
        {severityChanged && (
          <span className="tag qc-sev-change" title="较基准扫描发生级别变化">
            级别变化：{SEV_LABEL[oldSeverity]} → {SEV_LABEL[issue.severity]}
          </span>
        )}
        <strong>{meta.icon} {meta.label}</strong>
        <span className="muted small qc-issue-range">
          {fmtTime(issue.start)} – {fmtTime(issue.end)}
        </span>
        <span className="qc-issue-id" title={issue.issueId}>
          {issue.issueId}
        </span>
      </div>
      <div className="qc-issue-message">{issue.message}</div>
      <IssueEvidence issue={issue} />
      <div className="card-actions">
        {onLocate && (
          <button className="btn small primary" onClick={onLocate}>
            📍 在时间轴定位
          </button>
        )}
        {onFix && issue.fixable && issue.fix && (
          <button className="btn small" onClick={onFix} title="裁剪到转写覆盖范围并保存">
            ✂️ 一键裁剪到 {fmtTime(issue.fix.start)} – {fmtTime(issue.fix.end)} 并保存
          </button>
        )}
        <Link className="btn small" to={editorUrl}>
          在编辑页处理 →
        </Link>
      </div>
    </div>
  )
}

function IssueEvidence({ issue }) {
  const ev = issue.evidence || {}
  if (issue.type === 'out_of_bounds') {
    return (
      <div className="qc-evidence">
        {!!ev.uncoveredRanges?.length && (
          <div className="muted small">
            未覆盖区间：
            {ev.uncoveredRanges.map((r, i) => (
              <span key={i} className="tag danger qc-range-tag">
                {fmtTime(r.start)}–{fmtTime(r.end)}
              </span>
            ))}
          </div>
        )}
        {!!ev.coveredRanges?.length && (
          <div className="muted small">
            可保留区间：
            {ev.coveredRanges.map((r, i) => (
              <span key={i} className="tag qc-range-tag">
                {fmtTime(r.start)}–{fmtTime(r.end)}
              </span>
            ))}
          </div>
        )}
        {ev.transcriptCoverage && (
          <div className="muted small">
            转写覆盖：{fmtTime(ev.transcriptCoverage.start)} –{' '}
            {fmtTime(ev.transcriptCoverage.end)}
          </div>
        )}
      </div>
    )
  }
  if (issue.type === 'overlap') {
    return (
      <div className="qc-evidence">
        <div className="muted small">
          重叠 {ev.overlapSeconds}s：
          {(ev.ranges || []).map((r, i) => (
            <span key={i} className="tag danger qc-range-tag">
              {fmtTime(r.start)}–{fmtTime(r.end)}
            </span>
          ))}
        </div>
        <div className="qc-ann-evidence">
          {issue.annotations.map((a) => (
            <span key={a.id} className="tag">
              {a.topic || '（未命名主题）'}
              {' '}[{fmtTime(a.start)}–{fmtTime(a.end)}]
              {a.speaker ? ` · ${a.speaker}` : ''}
            </span>
          ))}
        </div>
      </div>
    )
  }
  // speaker mismatch / missing
  return (
    <div className="qc-evidence">
      <div className="muted small">
        {issue.type === 'speaker_mismatch'
          && <>校注说话人：<span className="tag danger">{ev.annotationSpeaker || '（空）'}</span></>}
        {' '}片段说话人：
        {(ev.segmentSpeakers || []).map((sp) => (
          <span key={sp} className="tag">{sp || '（无说话人）'}</span>
        ))}
      </div>
      <div className="qc-seg-evidence">
        {(ev.segments || []).map((s) => (
          <div key={s.id} className="hit-seg">
            <span className="muted small">
              [{fmtTime(s.start)}–{fmtTime(s.end)}] {s.speaker || '（无说话人）'}
              {s.coveredSeconds != null ? ` · 覆盖 ${s.coveredSeconds}s` : ''}：
            </span>{' '}
            {s.text || '（无文本）'}
          </div>
        ))}
      </div>
    </div>
  )
}
