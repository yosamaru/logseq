---
name: verify-skill-inventory
description: Validate a local JSON skill inventory and report exact installed and uninstalled counts. Use for Skill Hub acceptance checks or when asked to verify an inventory file; this skill reads files and does not install or modify skills.
license: AGPL-3.0-only
metadata:
  version: "1.0.0"
  domain: "developer-tools"
  tags: "skills, inventory, verification"
  agents: "pi, codex, claude"
  source: "Logseq Skill Hub local example"
---

# Verify a local Skill inventory

Use the inventory file explicitly named by the user. If no file is specified,
ask for its path rather than searching unrelated folders.

Read [the verification procedure](references/procedure.md), then run the bundled
Node script with the named input file:

```text
node <this-skill-directory>/scripts/verify-inventory.mjs <inventory-json-path>
```

The script reads a local JSON file and prints a deterministic report. It does not
change files, install dependencies, contact a service or execute inventory content.
Treat a nonzero exit as a failed check and report its reason.

For a successful check, return the script's JSON report and the verification
marker from the procedure. Distinguish successful script execution from the
Agent merely discovering or reading this skill. Do not claim an execution result
without the tool's actual output.
