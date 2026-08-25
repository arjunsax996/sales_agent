// LangGraph Annotation helpers — graph-specific, so these stay here rather
// than in shared/util.ts (which holds the domain math both agents use).

// For a field that's always supplied by the caller at invoke time. No
// `default` key at all — LangGraph's channel type requires `default` (when
// present) to return T, not T | undefined, so "no sensible default" means
// omitting it rather than returning undefined.
export function overwriteNoDefault<T>() {
  return {
    reducer: (_old: T, next: T) => next,
  };
}

// For a field a node fills in as the graph runs, starting from
// `makeDefault()` and getting fully replaced (not merged) each time a node
// returns a new value for it.
export function overwriteWithDefault<T>(makeDefault: () => T) {
  return {
    reducer: (_old: T, next: T) => next,
    default: makeDefault,
  };
}
