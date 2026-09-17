#!/usr/bin/env bash
# Payload/response shapes shared by the authored rtk PreToolUse hooks. Sourced, not executed.
#
# APM deploys one hook descriptor to every target, so a hook cannot learn its host from its
# own registration — the schema is keyed off the payload instead:
#
#   nested     Claude Code, VS Code Copilot Chat, Copilot CLI's PascalCase registration:
#              snake_case `tool_input`, response nested under `hookSpecificOutput`.
#   args       Copilot CLI's camelCase registration: `toolArgs` as a JSON string, rewrite
#              returned as `modifiedArgs`.
#   deny-only  JetBrains Copilot: honors a top-level deny and nothing else, so a rewrite has
#              to travel as a denial whose reason names the command to re-run.
#   unknown    nothing recognizable: a deny goes out in every schema at once, a rewrite not
#              at all.

RTK_HOOK_EVENT_NAME="PreToolUse"
RTK_HOOK_REASON="RTK auto-rewrite"

hook_payload_format() {
  jq -r '
    if has("toolName") then
      if .toolName == "run_in_terminal" then "deny-only"
      elif .toolName == "bash" or .toolName == "powershell" then "args"
      else "unknown" end
    elif (.tool_input.command? // "") != "" then "nested"
    else "unknown" end
  ' 2>/dev/null <<<"$1" || printf 'unknown\n'
}

hook_command() {
  local format="$1" payload="$2"
  case "$format" in
    nested) jq -r '.tool_input.command // empty' <<<"$payload" ;;
    args | deny-only) jq -r 'try (.toolArgs | fromjson | .command) // empty' <<<"$payload" ;;
  esac
}

hook_rewrite_response() {
  local format="$1" payload="$2" rewritten="$3"
  case "$format" in
    nested)
      # updatedInput only applies alongside an explicit allow/ask decision.
      jq -c \
        --arg cmd "$rewritten" \
        --arg event "$RTK_HOOK_EVENT_NAME" \
        --arg reason "$RTK_HOOK_REASON" \
        '{
          systemMessage: ("⚡ RTK rewrite: `" + $cmd + "`"),
          hookSpecificOutput: {
            hookEventName: $event,
            permissionDecision: "allow",
            permissionDecisionReason: $reason,
            updatedInput: (.tool_input + {command: $cmd})
          }
        }' <<<"$payload"
      ;;
    args)
      # modifiedArgs replaces the whole argument object, so host-supplied fields
      # (description, mode, initial_wait, …) have to be carried over verbatim.
      jq -c \
        --arg cmd "$rewritten" \
        --arg reason "$RTK_HOOK_REASON" \
        '{
          permissionDecision: "allow",
          permissionDecisionReason: $reason,
          modifiedArgs: ((.toolArgs | fromjson) + {command: $cmd})
        }' <<<"$payload"
      ;;
    deny-only)
      jq -cn --arg cmd "$rewritten" '{
        permissionDecision: "deny",
        permissionDecisionReason: ("RTK token optimization: re-run this command as `" + $cmd + "` instead.")
      }'
      ;;
  esac
}

hook_deny_response() {
  local format="$1" reason="$2"
  case "$format" in
    nested)
      jq -cn --arg event "$RTK_HOOK_EVENT_NAME" --arg reason "$reason" '{
        hookSpecificOutput: {
          hookEventName: $event,
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
      }'
      ;;
    args | deny-only)
      jq -cn --arg reason "$reason" '{
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }'
      ;;
    *)
      jq -cn --arg event "$RTK_HOOK_EVENT_NAME" --arg reason "$reason" '{
        permissionDecision: "deny",
        permissionDecisionReason: $reason,
        hookSpecificOutput: {
          hookEventName: $event,
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
      }'
      ;;
  esac
}
