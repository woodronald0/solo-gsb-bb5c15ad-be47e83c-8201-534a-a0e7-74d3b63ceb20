const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: options.body instanceof FormData
      ? undefined
      : { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error((data && data.detail) || `请求失败 (${res.status})`);
  }
  return data;
}

export const api = {
  listProjects: () => request('/projects'),
  createProject: (name) =>
    request('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  getProject: (id) => request(`/projects/${id}`),
  saveProject: (id, { name, document }) =>
    request(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, document }),
    }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  exportUrl: (id) => `${BASE}/projects/${id}/export`,

  importTranscript: async (payload) => {
    if (payload instanceof FormData) {
      return request('/import', { method: 'POST', body: payload });
    }
    return request('/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  importIntoProject: (id, formData) =>
    request(`/projects/${id}/import`, { method: 'POST', body: formData }),

  merge: (payload) =>
    request('/merge', { method: 'POST', body: JSON.stringify(payload) }),

  // ----- rule-based batch annotation -----
  listRules: (projectId) =>
    request(`/projects/${projectId}/rules`),
  createRule: (projectId, rule) =>
    request(`/projects/${projectId}/rules`, {
      method: 'POST', body: JSON.stringify(rule),
    }),
  updateRule: (ruleId, rule) =>
    request(`/rules/${ruleId}`, { method: 'PUT', body: JSON.stringify(rule) }),
  deleteRule: (ruleId) =>
    request(`/rules/${ruleId}`, { method: 'DELETE' }),
  previewDraftRule: (projectId, rule) =>
    request(`/projects/${projectId}/rules/preview`, {
      method: 'POST', body: JSON.stringify({ rule }),
    }),
  previewRule: (ruleId) =>
    request(`/rules/${ruleId}/preview`, { method: 'POST' }),
  applyRule: (ruleId) =>
    request(`/rules/${ruleId}/apply`, { method: 'POST' }),
  listRuleRuns: (projectId) =>
    request(`/projects/${projectId}/rule-runs`),
  undoRuleRun: (runId) =>
    request(`/rule-runs/${runId}/undo`, { method: 'POST' }),

  // ----- annotation quality check -----
  qualityCheck: (projectId, window = null) =>
    request(`/projects/${projectId}/quality-check`, {
      method: 'POST',
      body: JSON.stringify(window || {}),
    }),
  listQualityScans: (projectId) =>
    request(`/projects/${projectId}/quality-scans`),
  getQualityScan: (projectId, scanId) =>
    request(`/projects/${projectId}/quality-scans/${scanId}`),
  compareQualityScans: (projectId, scanIdA, scanIdB) =>
    request(`/projects/${projectId}/quality-scans/compare`, {
      method: 'POST',
      body: JSON.stringify({ scanIdA, scanIdB }),
    }),
};
