# Origo Tools

Standalone utilities for working with Origo configs.

## reformat-config-comments.js

Convert Origo config files from `//`- and `/* */`-style comments to JSON-compliant `"//"`-key comments.

This preserves all commented-out blocks and inline annotations as real JSON data that survives form editing in the config editor, instead of being stripped away.

### Usage

```bash
node tools/reformat-config-comments.js <input.json> [output.json]
```

**Examples:**

```bash
# Convert tomelilla.json, write to tomelilla-reformatted.json
node tools/reformat-config-comments.js path/to/tomelilla.json

# Convert and specify output path
node tools/reformat-config-comments.js path/to/karlstad.json path/to/karlstad-clean.json
```

### What it does

**Before (not JSON-safe):**
```jsonc
//"projectionExtent": [120000, 6556000, 291000, 6900000],
"projectionExtent": [-72234.21, 6092807.47, 832132.7, 7702218.01],

/* {
  "name": "webbkartan:vy_mf_buf_hogstadium_2024",
  "title": "Garantiskolor högstadium 2024",
  ...
} */

"filter": "[typ] == 'Parkeringsområde'",  // basic string comparison
```

**After (valid JSON, editor-safe):**
```json
"//projectionExtent_alt": [120000, 6556000, 291000, 6900000],
"projectionExtent": [-72234.21, 6092807.47, 832132.7, 7702218.01],

"//parkerade_lager": [
  {
    "name": "webbkartan:vy_mf_buf_hogstadium_2024",
    "title": "Garantiskolor högstadium 2024",
    ...
  }
],

{
  "//": "basic string comparison",
  "filter": "[typ] == 'Parkeringsområde'",
  ...
}
```

### Why use this?

- **Commented-out blocks in `layers` or `groups` are converted to `"//parkerade_lager"` and `"//parkerade_grupper"` keys** — they're inert to Origo (not part of the schema) but valid JSON.
- **Inline filter annotations become `"//"`-keyed entries in style rules** — they survive form editing.
- **Alternative values (like old `projectionExtent`) become `"//<key>_alt"` siblings** — keep both versions without mutual clobbering.
- **Everything that was in comments lives as real data**, so editing via the config editor won't silently drop it.

### Output

The utility prints a report:

```
✓ Reformatted config written to: path/to/output.json

--- Conversions ---
✓ Style-rule block → //motionovandring_parkerade_regler (3 rule-array(s))
✓ Layer block → //parkerade_lager (7 layers)
✓ Group block → //parkerade_grupper (1 group)

Summary:
  Parked layers:  7
  Parked groups:  1
  Parked style keys: 2
  Filter annotations added: 5
  Live layers: 216 | Live styles: 210

✓ Output re-parses as valid JSON
```

### Notes

- The tool detects the difference between commented-out **layers** (have `type`, `source`), **groups** (have `title` but no `source`), and **style-rule blocks** (live inside the `styles` object).
- It classifies by structure, not filename or position, so it's robust to different comment styles.
- All conversions preserve the full original structure — nothing is modified or lost.
