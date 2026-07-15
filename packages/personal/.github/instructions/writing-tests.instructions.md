---
description: Test naming and structure conventions — "should … when …" case names, one behaviour per case, Arrange–Act–Assert, a failure message on every assertion, fresh setup per case, FIRST.
applyTo: "**/*.{test,spec}.*,**/*{Test,Tests,Spec}.{fs,cs,ts,tsx,js,jsx,java,kt,scala},**/*_test.{go,py,rb,exs},**/test_*.py,**/*_spec.rb"
---

# Writing tests

Name each case `should <observable behaviour> when <condition>` — the enclosing group
names the unit under test, so the case never restates it. Name a failure case for the
concrete error (`should return RequestFailed error when …`). Group by feature; nest for facets.

Structure each case Arrange–Act–Assert, the three parts separated by blank lines (no comment
labels). One behaviour per case; multiple assertions are fine only when they check facets of
the same outcome. Give every assertion a failure message stating the expected fact, and fail
explicitly on impossible branches — never let a guard silently pass.

Each case builds its own world (fresh fixtures, own inputs) and shares no mutable state with
any other. Tests are FIRST: Fast, Isolated, Repeatable, Self-validating, Timely.

Fuller guidance and worked examples: the `writing-tests` skill.
