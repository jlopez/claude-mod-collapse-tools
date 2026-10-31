export const SUMMARIES_STORE_KEY = 'summaries'

// Built-in tools whose input `description` field is documented as a short statement of what the call is
// for (Bash: "Clear, concise description of what this command does"; Agent: "A short (3-5 word)
// description of the task"; Monitor: "Short human-readable description of what you are monitoring").
// Tools whose `description` is a task body or means something else (TaskCreate, TaskUpdate, MCP tools)
// are left out.
// 'Task' is the Agent tool's older name (matching KEEP_ENGINE_ROW in summary.ts).
const DESCRIBED_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Agent', 'Task', 'Monitor'])

const TRAILING = /[\s.,;:!?'‘’]+$/

export function cleanSummary(text: string): string {
  return text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/["`“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^['‘’]+/, '')
    .replace(TRAILING, '')
}

// unknown: `saved` is an unvalidated store read and `option` is a plugin-option union, so both are narrowed here.
export const resolveSummaries = (saved: unknown, option: unknown): boolean =>
  typeof saved === 'boolean' ? saved : typeof option === 'boolean' ? option : true

// The purpose line the model wrote for a call, or null when the tool is not on the allowlist or the
// input carries no usable description.
// unknown: the engine types a ToolUse input as unknown; it is narrowed to a plain object below.
export function describe(tool: string, input: unknown): string | null {
  if (!DESCRIBED_TOOLS.has(tool)) return null
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const description = (input as Record<string, unknown>).description
  if (typeof description !== 'string') return null
  const clean = cleanSummary(description)
  return clean === '' ? null : clean
}
