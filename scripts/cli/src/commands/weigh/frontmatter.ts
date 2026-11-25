import { Effect, Record, Schema, String as Str } from 'effect'
import { Yaml } from 'effect/encoding'

const fieldsSchema = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const readFields = Schema.decodeUnknownEffect(fieldsSchema)

const FrontmatterReason = Schema.TaggedUnion({
  InvalidYaml: { cause: Schema.Unknown },
  InvalidFields: { cause: Schema.Unknown },
})

class InvalidFrontmatter extends Schema.TaggedError<InvalidFrontmatter, { readonly brand: unique symbol }>()(
  'InvalidFrontmatter',
  {
    file: Schema.String,
    reason: FrontmatterReason,
  },
) {
  format(): string {
    const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
    return FrontmatterReason.match(this.reason, {
      InvalidYaml: ({ cause }) => `Invalid YAML frontmatter in ${this.file}: ${describe(cause)}`,
      InvalidFields: ({ cause }) => `Invalid frontmatter fields in ${this.file}: ${describe(cause)}`,
    })
  }
}

const invalidFrontmatter = (file: string, tag: InvalidFrontmatter['reason']['_tag']) => (cause: unknown) =>
  InvalidFrontmatter.make({ file, reason: FrontmatterReason.cases[tag].make({ cause }) })

export const decodeFrontmatter = Effect.fn('decodeFrontmatter')(function* (file: string, text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const source = match?.[1]

  if (match === null || source === undefined) return { fields: {}, body: text }

  const yaml = yield* Effect.try({ try: () => Yaml.parse(source), catch: invalidFrontmatter(file, 'InvalidYaml') })
  const decoded = yield* readFields(yaml ?? {}).pipe(Effect.mapError(invalidFrontmatter(file, 'InvalidFields')))

  const fields: Record<string, string> = {}

  for (const [key, value] of Record.toEntries(decoded)) {
    if (typeof value === 'string') fields[key] = Str.trim(value)
  }

  return { fields, body: Str.trim(Str.slice(match[0].length)(text)) }
})
