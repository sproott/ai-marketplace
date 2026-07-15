---
name: writing-tests
description: Conventions for how a test is named and shaped — "should … when …" case names, feature grouping, one behaviour per case, Arrange–Act–Assert, per-assertion failure messages, per-case isolation, and FIRST. Use when writing or reviewing test cases, deciding what to name a test, or when test names are vague ("works", "handles errors") or a case asserts several unrelated behaviours. Covers the test's name and structure, not the red-green process.
---

# Writing Tests

## Overview

A test's name and shape are its specification. From the name alone a reader should know
which behaviour broke; from the failure message alone they should know what was expected —
without opening the test body. This skill is about that surface: how to **name** and
**structure** a test. It says nothing about when to write tests or the red-green cycle.

## Naming

Every case name states an **observable behaviour** and the **condition** that triggers it:

```
should <observable behaviour> when <condition>
```

```fsharp
testCase "should accumulate value when metric is incremented twice"
testCase "should overwrite metric-set value when set twice"
testCase "should return RequestFailed error when the upstream call times out"
```

- **The group names the unit; the case names the behaviour.** Never repeat the
  function/type under test in the case name — the enclosing group already carries it.
- **Name the behaviour, not the mechanism.** `should return stored value when set then
  read`, not `should call setMetricValueIn`. A name tied to the implementation lies the
  moment you refactor.
- **Name the concrete error case, and mark it as an error.** When a case asserts one
  specific error, write the error case in its own casing and append the word `error`:
  `should return RequestFailed error when the upstream call times out`. Not the run-together
  prose form `should return request failed when the upstream call times out` — lowercased
  and flowing into the sentence, it's ambiguous whether `request failed` is the returned
  error case or just narration. Not a generic `should fail when …` either — that hides
  *which* error is asserted, and a later case returning a different error under the same
  condition then collides with it.
- **The `when` clause is the distinguishing input**, not restated setup. If two cases
  differ only by their `when`, the reader sees the axis being varied at a glance.
- **Banned names:** `works`, `handles errors`, `test 3`, `happy path`, or anything that
  survives a change in behaviour unchanged.

### Grouping

Group by feature; nest for facets. Two levels is typical — a feature list holding
behaviour lists:

```fsharp
testList "State" [
    testList "State metric values" [
        testCase "should return stored value when metric is set then read" <| fun _ -> ...
        testCase "should accumulate value when metric is incremented twice" <| fun _ -> ...
    ]
    testList "State histograms" [
        testCase "should compute expected counts and sum after observations" <| fun _ -> ...
    ]
]
```

The group path plus the case name should read as a sentence: *State › State metric values ›
should accumulate value when incremented twice.*

## Structure

### Arrange–Act–Assert

Three parts, in order, separated by blank lines. The blank lines carry the structure — no
`// Arrange` comment labels; the shape already shows it.

```fsharp
testCase "should accumulate value when metric is incremented twice" <| fun _ ->
    let reg = Registry.create ()
    let name = MetricName.createOrFail "state_increment"

    State.incrementMetricValueIn reg (Int 2) name |> ignore
    State.incrementMetricValueIn reg (Int 3) name |> ignore

    match State.getMetricIn reg name with
    | None -> failtest "Metric should exist"
    | Some metric ->
        Expect.equal (Metric.singleValue metric) (Some (Int 5)) "Incremented value mismatch"
```

### One behaviour per case

A case proves one behaviour. Multiple assertions are allowed **only when they check facets
of the same outcome** — e.g. a histogram's counts, sum, and count after one set of
observations:

```fsharp
Expect.equal counts [ 1; 2 ] "Histogram counts mismatch"
Expect.equal dataSet.Sum 2.5 "Histogram sum mismatch"
Expect.equal dataSet.Count 2 "Histogram count mismatch"
```

If the assertions check **independent** behaviours (rejects empty title; trims whitespace;
enforces max length), split them into separate cases — each with its own `should … when …`.

### Every assertion carries its expected fact

An assertion's message states what should hold, so a failure reads as a sentence without
opening the code:

```fsharp
Expect.equal (Metric.singleValue metric) (Some (Int 20)) "Set overwrites previous value"
Expect.stringEnds line " 1" "Service should be enabled"
Expect.isFalse (formatted.Contains "res_svc_zone") "Common resource must not have zone label"
```

### Fail explicitly on impossible branches

When arranging or acting produces an `option`/`Result`/nullable that *must* be present for
the assertion to run, fail loudly on the absent branch — never let a guard fall through to a
silent pass:

```fsharp
match State.getMetricIn reg name with
| None -> failtest "Metric should exist"
| Some metric -> Expect.equal (Metric.singleValue metric) (Some (Int 10)) "Single value mismatch"
```

```fsharp
match ResourceAvailability.enableIn reg instance resource with
| Error e -> failtestf "Enable should succeed, got %A" e
| Ok _ -> ...
```

Push the unwrap into a named helper (`createOrFail`, `okOrFail`) when it is pure mechanical
noise — but the *failure* of an expected-success step is still a test failure with a message,
never a swallowed `None`.

### Isolation

Each case builds its own world and shares no mutable state with any other. A fresh registry,
fresh names, fresh inputs — so cases can run in any order, alone or together, and one case's
writes never leak into another:

```fsharp
let reg = Registry.create ()
let name = MetricName.createOrFail "state_set_get"
```

### DAMP over DRY

A test reads top to bottom without chasing shared helpers. Duplication of the arrange/act/
assert *story* is acceptable — it keeps each case independently understandable. Factor out
only mechanical noise (unwrap helpers, a small builder for an awkward fixture), never the
narrative that shows what this case actually exercises.

## FIRST

The properties every test should hold:

- **Fast** — milliseconds. In-memory; no real I/O, network, or disk in a unit test.
- **Isolated** — independent of every other test and of order; owns its setup and teardown.
- **Repeatable** — deterministic. No dependence on wall-clock, randomness, or ambient
  environment; inject those so the test controls them.
- **Self-validating** — the assertions decide pass or fail. No reading console output or
  eyeballing a dump to judge the result.
- **Timely** — written alongside the code it covers, while the behaviour is fresh — not
  bolted on much later.

## Smells

| Smell | Fix |
|---|---|
| Name restates the unit or the function called | Name the behaviour; the group already names the unit |
| Name survives a behaviour change unchanged (`works`, `handles errors`) | State the specific behaviour + `when` condition |
| Error case named as prose (`should fail when …`, `should return request failed when …`) | Name the concrete error case + `error` (`should return RequestFailed error when …`) |
| One case asserts several unrelated behaviours | Split into one case per behaviour |
| Assertion with no message | Add a message stating the expected fact |
| `option`/`Result` guard falls through to a silent pass | `failtest`/`failtestf` on the impossible branch |
| Cases share mutable fixture state | Fresh setup per case; no cross-case state |
| Shared helper hides what the case exercises | DAMP — inline the story, extract only mechanical noise |
