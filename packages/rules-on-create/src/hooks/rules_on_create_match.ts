import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'

interface Rule {
  name: string
  globs: string[]
  body: string
}

function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern)
  const options = match?.[1]

  if (match === null || options === undefined) return [pattern]

  const prefix = pattern.slice(0, match.index)
  const suffix = pattern.slice(match.index + match[0].length)
  return options.split(',').flatMap((option) => expandBraces(prefix + option + suffix))
}

function parseRule(name: string, text: string): Rule | undefined {
  const end = text.startsWith('---') ? text.indexOf('\n---', 3) : -1
  if (end === -1) return undefined

  const globs: string[] = []
  let inPaths = false

  for (const raw of text.slice(3, end).split('\n')) {
    const line = raw.trimEnd()
    const property = /^(\w+):\s*(.*)$/.exec(line)

    if (property !== null) {
      inPaths = property[1] === 'paths'
      if (!inPaths) continue

      const scalar = property[2]?.trim().replace(/^["']+|["']+$/g, '')
      globs.length = 0
      if (scalar) globs.push(scalar)
    } else if (inPaths) {
      const item = /^\s*-\s+(.*)$/.exec(line)?.[1]
      if (item !== undefined) globs.push(item.trim().replace(/^["']+|["']+$/g, ''))
    }
  }

  return globs.length ? { name, globs, body: text.slice(end + 4).trim() } : undefined
}

export function loadRules(projectRoot: string): Rule[] {
  const rules: Rule[] = []

  for (const directory of [join(homedir(), '.claude', 'rules'), join(projectRoot, '.claude', 'rules')]) {
    if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) continue

    for (const entry of readdirSync(directory).sort()) {
      if (!entry.endsWith('.md')) continue

      const text = readFileSync(join(directory, entry), 'utf8').replace(/\r\n?/g, '\n')
      const rule = parseRule(entry.slice(0, -3), text)
      if (rule !== undefined) rules.push(rule)
    }
  }

  return rules
}

function globRegex(pattern: string): RegExp | undefined {
  let source = '^'

  // Rule globs use fnmatch semantics: a wildcard can consume path separators.
  for (let index = 0; index < pattern.length; index++) {
    const part = pattern.charAt(index)

    if (part === '[') {
      const negated = pattern[index + 1] === '!'
      const start = index + (negated ? 2 : 1)
      const end = pattern.indexOf(']', start + (pattern[start] === ']' ? 1 : 0))

      if (end !== -1) {
        const chars = pattern.slice(start, end).replace(/[\\\[\]^]/g, '\\$&')
        source += `[${negated ? '^' : ''}${chars}]`
        index = end
        continue
      }
    }

    if (pattern.startsWith('**/', index) && (index === 0 || pattern[index - 1] === '/')) {
      source += '(?:.*/)?'
      index += 2
    } else if (part === '*') {
      if (pattern[index - 1] !== '*') source += '.*'
    } else if (part === '?') {
      source += '.'
    } else {
      source += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }

  try {
    return new RegExp(`${source}(?![\\s\\S])`, 'su')
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

export function match(path: string, projectRoot: string, rules: Rule[]): Rule[] {
  const absolute = resolve(path)
  const candidates = [absolute, relative(projectRoot, absolute) || '.', basename(absolute)]

  return rules.filter((rule) =>
    rule.globs.some((glob) =>
      expandBraces(glob).some((pattern) => {
        const regex = globRegex(pattern)
        return regex !== undefined && candidates.some((candidate) => regex.test(candidate))
      }),
    ),
  )
}
