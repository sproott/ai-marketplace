import { Effect, FileSystem, Path, Record, Schema, String as Str } from 'effect';
import { Digest } from 'effect/crypto';

const ExactCountReason = Schema.TaggedUnion({
  SdkInitializationFailed: {},
  TokenRequestFailed: { status: Schema.optionalKey(Schema.Finite) },
});

class ExactCountFailed extends Schema.TaggedError<ExactCountFailed, { readonly brand: unique symbol }>()('ExactCountFailed', {
  reason: ExactCountReason,
}) {
  format(): string {
    return ExactCountReason.match(this.reason, {
      SdkInitializationFailed: () => 'Could not initialize the Anthropic SDK for exact counting.',
      TokenRequestFailed: ({ status }) => {
        const reason = status === undefined ? '' : ` (HTTP ${status})`;
        return `Exact counting failed${reason}. Check the model, network, and ANTHROPIC_API_KEY or \`ant auth login\` profile; drop --exact to estimate instead.`;
      },
    });
  }
}

const TokenCache = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Finite), { space: 2 });

export const exactCounter = Effect.fnUntraced(function* (root: string, model: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const digest = yield* Digest.Digest;
  const cacheDir = path.join(root, '.cache');
  const cacheFile = path.join(cacheDir, 'context-weight-tokens.json');
  const cache = yield* fs.readFileString(cacheFile).pipe(
    Effect.flatMap(Schema.decodeEffect(TokenCache)),
    Effect.map((value) => new Map(Record.toEntries(value))),
    Effect.orElseSucceed(() => new Map<string, number>()),
  );

  const client = yield* Effect.cached(Effect.tryPromise({
    try: () => import('@anthropic-ai/sdk').then(sdk => ({
      anthropic: new sdk.default({ logLevel: 'off' }), APIError: sdk.APIError,
    })),
    catch: () => ExactCountFailed.make({ reason: ExactCountReason.cases.SdkInitializationFailed.make({}) }),
  }));

  let dirty = false;
  const flush = Effect.gen(function* () {
    if (!dirty) return;

    yield* fs.makeDirectory(cacheDir, { recursive: true });
    const encoded = yield* Schema.encodeEffect(TokenCache)(Record.fromEntries(cache)).pipe(Effect.orDie);
    yield* fs.writeFileString(cacheFile, `${encoded}\n`);
  });

  const count = Effect.fnUntraced(function* (text: string) {
    if (Str.trim(text).length === 0) return 0;

    const hash = yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(text));
    const key = `${model}:${hash}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const { anthropic, APIError } = yield* client;
    const response = yield* Effect.tryPromise({
      try: (signal) => anthropic.messages.countTokens({ model, messages: [{ role: 'user', content: text }] }, { signal }),
      catch: (cause) => {
        const status = cause instanceof APIError ? cause.status : undefined;
        return ExactCountFailed.make({ reason: ExactCountReason.cases.TokenRequestFailed.make(status === undefined ? {} : { status }) });
      },
    });

    cache.set(key, response.input_tokens);
    dirty = true;

    return response.input_tokens;
  });

  return { count, flush };
});
