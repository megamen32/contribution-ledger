// Client-side API fetch helpers. All routes are relative (same origin).
let activeProject: string | undefined
export function setApiProject(projectId: string) { activeProject = projectId }
export async function api<T = any>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, headers, ...rest } = init ?? {}
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(activeProject && !["/api/projects/switch", "/api/account/invite/accept"].includes(path) ? { "X-Vklad-Project": activeProject } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : (rest as any).body,
    credentials: "same-origin",
  })
  const text = await res.text()
  const data = text ? safeJson(text) : null
  if (!res.ok) {
    const msg = (data && (data as any).error) || res.statusText
    const err = new Error(typeof msg === "string" ? msg : "Request failed") as any
    err.status = res.status
    err.data = data
    throw err
  }
  return data as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
