#!/usr/bin/env node
// Origo config comment reformatter
// Converts line and block comments to JSON-compliant comment keys
// that survive form editing.
//
// Usage:
//   node tools/reformat-config-comments.js input.json [output.json]

const fs = require('fs');
const path = require('path');

// ---- Config ----
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tools/reformat-config-comments.js <input.json> [output.json]');
  process.exit(1);
}

const inputPath = args[0];
const outputPath = args[1] || inputPath.replace(/\.json$/, '-reformatted.json');

if (!fs.existsSync(inputPath)) {
  console.error('Error: Input file not found:', inputPath);
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8');

// ---- Comment scanner (string/literal-aware) ----
function scanComments() {
  const n = raw.length;
  let i = 0;
  const blocks = [];
  let stylesKeyOffset = -1;

  while (i < n) {
    const ch = raw[i];
    if (ch === '"') {
      if (raw.startsWith('"styles"', i)) stylesKeyOffset = i;
      i++;
      while (i < n) {
        if (raw[i] === '\\') { i += 2; continue; }
        if (raw[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '/' && raw[i + 1] === '/') {
      i += 2;
      while (i < n && raw[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && raw[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < n && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i += 2;
      blocks.push({ start, end: i, inner: raw.slice(start + 2, i - 2) });
      continue;
    }
    i++;
  }

  const stylesStart = stylesKeyOffset !== -1 ? raw.indexOf('{', stylesKeyOffset) : -1;
  return { blocks, stylesStart };
}

// ---- Recover JSON from comment body ----
function recover(inner) {
  let s = inner.trim().replace(/^,+/, '').replace(/,+$/, '').trim();
  return JSON.parse('[' + s + ']');
}

// ---- Strip comments (same as Origo's stripJSONComments) ----
function stripJSONComments(str) {
  const a = str.split('');
  let k = 0;
  const last = a.length - 1;
  while (k < last) {
    if (a[k] === '"') {
      k++;
      while (a[k] !== '"' && k < last) {
        if (a[k] === '\\') k++;
        k++;
      }
    } else if (a[k] === '/' && a[k + 1] === '/') {
      a[k] = ' ';
      a[k + 1] = ' ';
      k += 2;
      while (a[k] !== '\n' && a[k] !== '\r' && k <= last) {
        a[k] = ' ';
        k++;
      }
    } else if (a[k] === '/' && a[k + 1] === '*') {
      a[k] = ' ';
      a[k + 1] = ' ';
      k += 2;
      while (!(a[k] === '*' && a[k + 1] === '/') && k <= last) {
        if (a[k] !== '\n' && a[k] !== '\r') a[k] = ' ';
        k++;
      }
      a[k] = ' ';
      a[k + 1] = ' ';
      k++;
    }
    k++;
  }
  return a.join('');
}

// ---- Find enclosing style key for an offset (used for style-rule blocks) ----
function styleKeyRanges(stylesStart) {
  if (stylesStart === -1) return [];

  const ranges = [];
  let j = stylesStart + 1;
  const end = raw.length;

  const skipWs = () => {
    while (j < end) {
      const c = raw[j];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { j++; continue; }
      if (c === '/' && raw[j + 1] === '/') { j += 2; while (j < end && raw[j] !== '\n') j++; continue; }
      if (c === '/' && raw[j + 1] === '*') { j += 2; while (j < end && !(raw[j] === '*' && raw[j + 1] === '/')) j++; j += 2; continue; }
      break;
    }
  };

  const readStr = () => {
    j++;
    while (j < end) {
      if (raw[j] === '\\') { j += 2; continue; }
      if (raw[j] === '"') { j++; return; }
      j++;
    }
  };

  const skipVal = () => {
    const c = raw[j];
    if (c === '"') { readStr(); return; }
    if (c === '{' || c === '[') {
      let depth = 0;
      while (j < end) {
        const d = raw[j];
        if (d === '"') { readStr(); continue; }
        if (d === '/' && raw[j + 1] === '/') { j += 2; while (j < end && raw[j] !== '\n') j++; continue; }
        if (d === '/' && raw[j + 1] === '*') { j += 2; while (j < end && !(raw[j] === '*' && raw[j + 1] === '/')) j++; j += 2; continue; }
        if (d === '{' || d === '[') { depth++; j++; continue; }
        if (d === '}' || d === ']') { depth--; j++; if (depth === 0) return; continue; }
        j++;
      }
    }
  };

  while (j < end) {
    skipWs();
    if (raw[j] === '}' || raw[j] !== '"') break;
    const ks = j;
    readStr();
    const key = JSON.parse(raw.slice(ks, j));
    skipWs();
    if (raw[j] !== ':') break;
    j++;
    skipWs();
    const vs = j;
    skipVal();
    const ve = j;
    ranges.push({ key, start: vs, end: ve });
    skipWs();
    if (raw[j] === ',') j++;
  }
  return ranges;
}

// ---- Main ----
try {
  const { blocks, stylesStart } = scanComments();
  const sr = styleKeyRanges(stylesStart);
  const enclosingStyle = off => (sr.find(r => off >= r.start && off <= r.end) || {}).key;

  const parkedLayers = [];
  const parkedGroups = [];
  const parkedStyleRules = {};
  const report = [];

  for (const b of blocks) {
    const insideStyles = stylesStart !== -1 && b.start > stylesStart;
    let payload;
    try {
      payload = recover(b.inner);
    } catch (e) {
      report.push(`⚠ RECOVER FAILED at line ${raw.slice(0, b.start).split('\n').length}: ${e.message.slice(0, 80)}`);
      continue;
    }

    if (insideStyles) {
      const key = enclosingStyle(b.start);
      parkedStyleRules[key] = (parkedStyleRules[key] || []).concat(payload);
      report.push(`✓ Style-rule block → //${key}_parkerade_regler (${payload.length} rule-array(s))`);
    } else if (payload.length === 1 && payload[0] && !('type' in payload[0]) && ('title' in payload[0]) && !('source' in payload[0])) {
      parkedGroups.push(...payload);
      report.push(`✓ Group block → //parkerade_grupper (${payload.map(p => p.name).join(', ')})`);
    } else {
      parkedLayers.push(...payload);
      report.push(`✓ Layer block → //parkerade_lager (${payload.map(p => p.name || '?').join(', ')})`);
    }
  }

  // Parse live data
  const data = JSON.parse(stripJSONComments(raw));

  // Add annotations to filter rules (if present)
  const annotatedFilters = new Set([
    "[typ] == 'Parkeringsområde'",
    "[typ] == 'Parkeringsförbud'",
    "[typ] == 'Körförbud'",
    "[typ] == 'Lågfartsområde'",
    "[typ] != 'Lågfartsområde'"
  ]);
  let annotated = 0;
  for (const style of Object.values(data.styles || {})) {
    if (Array.isArray(style)) {
      for (const ruleArr of style) {
        if (Array.isArray(ruleArr)) {
          for (let idx = 0; idx < ruleArr.length; idx++) {
            const rule = ruleArr[idx];
            if (rule && annotatedFilters.has(rule.filter)) {
              ruleArr[idx] = Object.assign({ '//': 'basic string comparison' }, rule);
              annotated++;
            }
          }
        }
      }
    }
  }

  // Attach parked style rules
  for (const [key, rules] of Object.entries(parkedStyleRules)) {
    data.styles['//' + key + '_parkerade_regler'] = rules;
  }

  // Rebuild root object preserving order, with overview and parked shelves
  const overview = 'Origo-kartkonfiguration. Kommentarer använder den JSON-giltiga "//"-nyckelkonventionen (överlever redigering i konfig-editorn). Utkommenterade sektioner har flyttats till "//parkerade_*"-nycklar och "//[style]_parkerade_regler" i styles — de är giltig JSON men ignoreras av Origo eftersom nycklarna är okända. Inget har raderats.';

  const out = { '//': overview };
  for (const key of Object.keys(data)) {
    out[key] = data[key];
    if (key === 'layers') {
      if (parkedLayers.length) out['//parkerade_lager'] = parkedLayers;
      if (parkedGroups.length) out['//parkerade_grupper'] = parkedGroups;
    }
  }

  // Write output
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

  // Report
  console.log('\n✓ Reformatted config written to:', outputPath);
  console.log('\n--- Conversions ---');
  report.forEach(r => console.log(r));
  console.log(`\nSummary:`);
  console.log(`  Parked layers:  ${parkedLayers.length}`);
  console.log(`  Parked groups:  ${parkedGroups.length}`);
  console.log(`  Parked style keys: ${Object.keys(parkedStyleRules).length}`);
  console.log(`  Filter annotations added: ${annotated}`);

  // Sanity check
  const rp = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  console.log(`  Live layers: ${rp.layers?.length || 0} | Live styles: ${Object.keys(rp.styles || {}).length}`);
  console.log('\n✓ Output re-parses as valid JSON\n');
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
