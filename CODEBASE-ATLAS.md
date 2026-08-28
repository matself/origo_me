# Codebase Atlas

A working map of this repository: what Origo is built from, how it boots, and where this
fork departs from upstream. Written as orientation for anyone — human or agent — picking up
work here without prior context.

Snapshot taken at commit `710d2f5` on `master`. Line counts cover `src/` only and exclude
build output and dependencies; they drift, the structure does not.

| | |
| --- | --- |
| Version | 2.11.0-dev |
| Core library | OpenLayers 10.6 |
| Source | 32,455 lines across 233 JS modules |
| Layer types | 15 (plus `GROUP`) |
| Controls | 26 |
| License | BSD-2-Clause |
| Remotes | `origin` → matself/origo_me · `upstream` → origo-map/origo |

## Contents

- [What this is](#what-this-is)
- [Fork vs upstream](#fork-vs-upstream)
- [Boot sequence](#boot-sequence)
- [Component model](#component-model)
- [Module map](#module-map)
- [Layers and sources](#layers-and-sources)
- [Controls](#controls)
- [Cross-cutting subsystems](#cross-cutting-subsystems)
- [Build and tooling](#build-and-tooling)
- [Things to watch](#things-to-watch)

## What this is

Origo is a configuration-driven framework for building web map applications on top of
OpenLayers, run and maintained by a group of Swedish municipalities. An application is not
written in code — it is a JSON file. `index.json` declares the projection, extent, sources,
layers, styles and the list of controls; `index.html` does nothing but load the bundle and
call `Origo('index.json')`.

That inversion explains most of the architecture. The framework's job is to turn declarative
config into a live OpenLayers map, so almost everything in `src/` is either a **type registry**
(layer types, style types, control names resolved by string) or a **lifecycle** that wires those
registries together in the right order.

Two entry points matter:

* `origo.js` (222 lines) — the public façade. Builds the config, resolves controls, creates the
  viewer, and re-exports the OpenLayers surface plus the Origo API for plugins.
* `src/viewer.js` (740 lines) — the runtime object everything else talks to.

## Fork vs upstream

The fork's changes are concentrated almost entirely outside the framework itself: **35 commits
ahead** of upstream, **0 behind**.

| What | Where | Size | Nature |
| --- | --- | --- | --- |
| Config editor | `admin-editor/index.html` | 1,957 ln | New standalone tool — no build step, File System Access API, form to raw-JSON two-way binding |
| Comment reformatter | `tools/reformat-config-comments.js` | 274 ln | New CLI — converts `//` comments in configs into JSON-legal `"//key"` entries |
| XYZ projection fix | `src/layer/xyz.js` | 1 ln | The only framework change: honour a layer's or source's own `projection` before falling back to the viewer's |
| Sharemap docs | `SHAREMAP.md` | 166 ln | New — documents the permalink / mapstate URL format |
| Dev servers | `.claude/` | 51 ln | Static servers for `build/` (port 9967) and `admin-editor/` (port 9968) |
| Rebuilt bundles | `build/js/*.js` | 11 MB | Regenerated output, committed; marked `linguist-generated` to collapse diffs |

The framework core is effectively untouched — one line in `xyz.js`. Everything else is *tooling
around* Origo: authoring and validating the JSON configs that Origo consumes. This is a fork
built to operate Origo, not to change it.

## Boot sequence

Startup is genuinely ordered, and several classes of bug here are ordering bugs, so it is worth
holding the sequence in mind.

1. **Config assembly** — `Origo(configPath, options)` merges caller options over defaults:
   target `#app-wrapper`, SVG sprite set, responsive breakpoints, and six default controls
   (localization, scaleline, zoom, rotate, attribution, fullscreen).
2. **Browser gate** — `supports()` runs first; on failure `renderError('browser')` paints a
   message and `Origo` returns `null`.
3. **Resource load** — `src/loadresources.js` fetches the config as text and strips `//`
   comments before parsing, loads SVG sprites, then resolves the saved map state: either
   `?mapStateId` from the server or the `#hash` via `permalink.parsePermalink`.
4. **Control resolution** — Localization is instantiated first (a `?loc` query param can
   override the locale), then each control is looked up by `titleCase(name)` against the
   built-ins and the caller's `options.controls`. Factories may be async, which is what makes
   lazy-loaded plugin controls possible.
5. **Viewer construction** — proj4 definitions are registered, the OL map is created, then
   `mergeSavedLayerProps` folds URL layer state into the configured layers before `addLayers`.
   Featureinfo, Selectionmanager, centre marker and logger are attached, then controls are added.
6. **State replay** — only after layers exist are `pin`, `selection` and `feature` applied.
   `feature` waits on the source's `featuresloadend` when the data has not arrived yet. If no
   zoom came from the URL, `startExtent` fits the view.
7. **Ready** — `viewer` dispatches `loaded`; `origo` dispatches `load` with the viewer, which is
   the hook plugins and host pages wait on. The service worker, if configured, registers here.

## Component model

Origo does not use a UI framework. `src/ui/component.js` implements a small object-composition
system derived from [ceeu](https://github.com/afogelberg/ceeu): every component is
`Object.assign(Eventer(), Base(), options)`, where `Base` supplies a `cuid` identity and a child
list, and `Eventer` supplies `on` / `un` / `dispatch`.

Components render themselves to HTML strings and are inserted into the DOM by their parent.
Four lifecycle hooks carry the whole system:

| Hook | When it fires |
| --- | --- |
| `onInit` | Immediately on construction, before any parent exists |
| `onAdd` | When added to a parent; `evt.target` is the parent. This is where controls capture the viewer |
| `onRender` | Auto-bound to the parent's `render` event when no `onAdd` is defined — DOM is live at this point |
| `render` | Returns the markup string. Parents concatenate children's output |

The UI kit built on this is deliberately small: `Button`, `Collapse`, `CollapseHeader`,
`Dropdown`, `Modal`, `PopupMenu`, `Slidenav`, `FloatingPanel`, `Input`, `InputRange`,
`InputFile`, `Textarea`, `ToggleGroup`, `Icon`, `Element`.

## Module map

Weight is heavily skewed toward controls — over half the source is in `src/controls/`, and a
third of *that* is the editor.

| Area | Files | Lines | Role |
| --- | ---: | ---: | --- |
| `src/controls/` | 93 | 17,727 | Every user-facing tool; each is an independently addable component |
| `src/` (root) | 27 | 6,338 | Viewer, featureinfo, selection, style, infowindow, resource loading |
| `src/utils/` | 37 | 2,693 | Leaf helpers — URL parsing, legend rendering, export, geometry formatting |
| `src/style/` | 10 | 1,815 | Style window, draw styles, style types and functions |
| `src/ui/` | 27 | 1,583 | The component base and widget kit |
| `src/layer/` | 22 | 1,455 | One module per layer type, plus the type registry and WFS source |
| `src/permalink/` | 3 | 384 | Map state to URL hash to server state |
| `src/components/` | 5 | 220 | Main, footer, centre marker, logger, spinner shells |
| `scss/` | 47 | 2,364 | One partial per control, compiled by Dart Sass to a single stylesheet |

The largest single files are worth knowing by name, because they concentrate the risk:

| File | Lines |
| --- | ---: |
| `src/controls/editor/edithandler.js` | 2,343 |
| `src/controls/measure.js` | 953 |
| `src/controls/legend.js` | 817 |
| `src/style/stylewindow.js` | 760 |
| `src/controls/search.js` | 747 |
| `src/controls/print/print-component.js` | 742 |
| `src/viewer.js` | 740 |

## Layers and sources

`src/layer.js` is a normalizer, not a constructor. It applies defaults, converts
`minScale`/`maxScale` into resolutions for the current projection, derives `id` from the part of
the name before `__`, strips the namespace after `:`, then hands off to `layerType[type]`. Group
layers are registered into the same table so nesting is uniform.

Registered types (`src/layer/layertype.js`): `WFS`, `WMS`, `WMTS`, `AGS_FEATURE`, `AGS_MAP`,
`AGS_TILE`, `GEOJSON`, `TOPOJSON`, `GPX`, `KML`, `XYZ`, `OSM`, `VECTORTILE`, `COG`, `FEATURE`,
and `GROUP` (registered from `layer.js` itself).

Sources are declared once under `source` in the config and referenced by name from layers. A
source carrying `capabilitiesURL` is fetched at viewer construction, so WMS/WMTS layers can
inherit server-declared metadata instead of repeating it per layer.

**The fork's one framework change lives here.** `xyz.js` previously forced
`sourceOptions.projection` to the viewer's projection code, which broke XYZ tiles published in
any other grid. It now prefers the layer's own `projection`, then the source's, before the
viewer's.

## Controls

Twenty-six controls are exported from `src/controls.js` and resolved by name from config. They
fall into five natural groups.

| Group | Controls |
| --- | --- |
| Navigation and view | `zoom`, `home`, `rotate`, `scale`, `scaleline`, `scalepicker`, `position`, `geoposition`, `fullscreen` |
| Finding and framing | `legend`, `search`, `mapmenu`, `bookmarks`, `splash`, `about`, `link`, `externalurl` |
| Creating and editing | `editor`, `draw`, `measure` |
| Data in and out | `print`, `sharemap`, `draganddrop`, `attribution` |
| Infrastructure | `localization`, `progressbar` |

`editor`, `draw` and `measure` are the three heaviest, each with its own subdirectory of
handlers, tools and shapes. Localization is always instantiated first and injected into every
other control's options.

The editor is a full WFS-T / ArcGIS Server transaction client: `edithandler` drives the
interactions, `editsstore` and `transactionhandler` queue changes, and `wfstransaction`,
`agstransaction` and `indexeddb` are the three backends it can commit to. Attachments and
related tables have their own forms.

## Cross-cutting subsystems

**Featureinfo and selection.** `src/featureinfo.js` (687 lines) resolves clicks across vector,
tile and image layers, then renders through `getfeatureinfo`, `getattributes` and the infowindow
trio (1,487 lines combined) for popup, sidebar and overlay presentation.
`src/selectionmanager.js` holds the multi-select set as `SelectedItem` models.

**Style.** `src/style.js` compiles config style arrays into OL styles, with a pluggable
`addStyleType` registry, a `stylefunction` escape hatch, thematic styling and scale-dependent
rules. `src/style/stylewindow.js` is the interactive editor for draw styles.

**Permalink.** Three modules split cleanly: `permalinkstore` serializes viewer state,
`permalinkparser` deserializes it, `permalink` is the façade that produces links and talks to a
state server. Format documented in [`SHAREMAP.md`](SHAREMAP.md).

**Localization.** Two locales ship — `sv_SE` and `en_US` — each covering 20 controls, keyed as
`controls.<name>.<key>`. Controls receive a localization instance and call `getStringByKeys`.

**Service worker.** `service-worker.js` is explicitly boilerplate: a cache-first preload of a
hardcoded asset list with a manual version bump, registered after `load` so it never competes
with startup.

**Plugins.** Plugins are external repos passed in through `options.controls`, resolved by the
same name lookup as built-ins and allowed to be async. `Origo.ol`, `Origo.ui` and `Origo.Style`
are re-exported so plugins share the host's OpenLayers instance. See [`PLUGINS.md`](PLUGINS.md).

## Build and tooling

Webpack 5 with a shared base and four merged configs; Dart Sass compiled separately; ESLint on
`airbnb-base` with a handful of relaxations (`max-len` off, import cycles allowed).

| Command | Config | Output |
| --- | --- | --- |
| `npm start` | `webpack.dev.js` | Dev server + Sass watch |
| `npm run build-js` | `webpack.prod.js` | `dist/origo.min.js` — Terser, global `Origo` var |
| `npm run copy` | `webpack.copy.js` | `build/` — unminified bundle plus css, img, data, examples and configs |
| `npm run build-js-analyze` | `webpack.analyze.js` | Bundle size report |
| `npm run lint-run` | `webpack.lint.dev.js` | Dev server with ESLint in the pipeline |
| `npm run reformat-config` | `tools/reformat-config-comments.js` | *Fork-local* — config comment conversion |

The library ships as a classic global, not a module: `library: { type: 'var', name: 'Origo' }`
with `chunkLoading: false`. That is deliberate — an Origo app is a plain `<script>` tag and a
JSON file, deployable to any static host.

Runtime dependencies beyond OpenLayers are few, and each maps to one feature:

| Dependency | Used for |
| --- | --- |
| `proj4` | Projections; injected globally via webpack `ProvidePlugin` |
| `jspdf` + `html2canvas` | Print and PDF export |
| `awesomplete` | Search autocomplete |
| `@glidejs/glide` | Image carousel in featureinfo |
| `cuid` | Component identities |
| `ol-mapbox-style` | Vector tile styling |
| `pepjs`, `elm-pep`, `drag-drop-touch` | Pointer and touch polyfills |
| `downloadjs` | Client-side file download |

## Things to watch

Observations from reading the tree, roughly in order of how likely they are to bite. Items
marked *left deliberately* are known and intentionally not acted on; the reasoning is given so
the decision does not have to be rediscovered.

**`src/controls/offline/` is orphaned.** *Left deliberately.* Five files covering a download
handler, an offline store and WFS/GeoJSON/TopoJSON adapters, imported by nothing and not
exported from `controls.js`. Its localization strings are still shipped in both locale files, which makes it
look like a half-landed feature rather than deliberate dead code. It is upstream's code, so
deleting it here would buy nothing and create a permanent merge conflict surface; the right
venue is an upstream issue asking whether it is staged work or dead weight.

**Built output is committed.** *Left deliberately.* `build/js/origo.js` (8.4 MB) and
`origo.min.js` (2.6 MB) are tracked. The `.gitattributes` `linguist-generated` marks keep them
out of PR diffs, but they still have to be rebuilt and committed in lockstep with any source
change, and they dominate clone size. This is what makes the fork directly deployable, so it
stays; the risk to watch is a source change shipping without a rebuild.

**Concentration risk in the editor.** *Left deliberately.* `edithandler.js` at 2,343 lines is
seven percent of the entire source in one file, and it owns interaction state, form binding,
geometry validation and transaction dispatch simultaneously. Any editing bug starts here.
Splitting it in a fork would make every future upstream merge painful for no functional gain.

**`hashchange` only reacts to `map=`.** The listener in `origo.js` re-initialises the viewer
only when the new hash contains a `map` parameter, so changing just `center`, `zoom` or `layers`
on an embedded map does nothing. This limits URL-driven control of an embedded map — see
[`SHAREMAP.md`](SHAREMAP.md). Changing it means changing framework behaviour, with real
regression risk for anyone whose page writes to the hash, so it belongs upstream as a discussion
rather than as a local patch.

### Recently addressed

* **core-js was undeclared** (fixed `710d2f5`). `tasks/webpack.common.js` lists `core-js/stable`
  as a webpack entry, but `core-js` was not in `package.json` — it resolved only because
  `jspdf` to `canvg` pulled it in transitively. Now declared directly at `^3.41.0`, the version
  already in the lockfile.
* **Eleven upstream commits behind** (fixed `9e67f17`). All were Dependabot bumps — `dompurify`,
  `ws`, `shell-quote`, `http-proxy-middleware` and others — touching only `package.json` and
  `package-lock.json`. Merged; no bundle rebuild was required.
* **The permalink surface was undocumented** (fixed by `SHAREMAP.md`). It was an internal
  round-trip format that municipalities began using as an embedding API.
