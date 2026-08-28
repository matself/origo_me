# Sharemap and map state

Origo can restore a map to a previously shared state. The state is either encoded in the URL
fragment (the part after `#`) or stored on a server and referenced by a `mapStateId` query
parameter. This document describes the format of that state, which parameters exist and how
they behave, so that the URL can be used to control an Origo map from an embedding page.

The format was originally designed as an internal round-trip format for the `sharemap` control.
It is documented here because it is in practice used as a lightweight API, but note that it is
not a general purpose API — see [Alternatives to the URL](#alternatives-to-the-url).

## Where the state lives

Origo uses two storage methods, selected with the `storeMethod` option of the `sharemap` control:

| `storeMethod` | Link produced | Contents |
| --- | --- | --- |
| *(default)* | `<url>#layers=...&center=...&zoom=...` | The URL parameters listed below |
| `saveStateToServer` | `<url>?mapStateId=<id>` | The same parameters **plus** the state of the `draw` and `measure` controls |

Example configuration for the server variant:

```json
{
  "name": "sharemap",
  "options": {
    "storeMethod": "saveStateToServer",
    "serviceEndpoint": "https://example.com/api/mapstate",
    "loadMapStateIdMethod": "path"
  }
}
```

`loadMapStateIdMethod` controls how the state is read back: `path` (default) requests
`<serviceEndpoint>/<mapStateId>`, `query` requests `<serviceEndpoint>?mapStateId=<mapStateId>`.
Saving is always a `POST` of the state object as JSON to `serviceEndpoint`, and the response is
expected to contain a `mapStateId` property.

Note that the parameters are stored in the **fragment**, not in the query string. The only
query parameter Origo reads is `mapStateId`.

## URL parameters

Parameters are separated by `&` and written as `key=value`, for example:

```
https://example.com/index.html#map=origo&center=134966,6592356&zoom=5&layers=roads/v/1/s/1/o/100
```

Unknown keys are ignored.

| Parameter | Format | Description |
| --- | --- | --- |
| `map` | `origo` | Name of the map configuration without the `.json` suffix. Only written when the configured map name contains a `.` |
| `center` | `x,y` | Map centre in the map's projection, rounded to integers |
| `zoom` | `5` or `5.5` | Zoom level, may be fractional |
| `layers` | see [Layers](#layers) | Comma separated list of layers with their state |
| `feature` | `layername.id` | Feature to select and show a popup for. Only for `WFS`, `AGS_FEATURE`, `GEOJSON` and `TOPOJSON` layers |
| `pin` | `x,y` | Position of the featureinfo pin |
| `legend` | `expanded`, `visibleLayersViewActive` | Comma separated list of active legend states |
| `selection` | `Polygon/x!y/x!y` | Geometry type and coordinates of a selection. Parsed on startup but never written by the `sharemap` control |
| `controls` | JSON object | Only present in a server stored state, see [Control state](#control-state) |

### Layers

`layers` is a comma separated list. Each entry is a `/` separated list of key and value pairs
where the layer name comes first:

```
layers=roads/v/1/s/1/o/60,buildings/v/1/s/0/o/100/sn/2/th/Theme%20A~Theme%20B
```

| Key | Property | Format |
| --- | --- | --- |
| `v` | `visible` | `1` or `0` |
| `s` | `legend` | `1` or `0`, whether the layer is shown in the legend |
| `o` | `opacity` | `0`–`100`, divided by 100 when parsed |
| `sn` | `altStyleIndex` | Integer. Only written when the layer's style differs from its default style |
| `th` | `activeThemes` | Theme identifiers separated by `~`, URL encoded. Only written for layers with `thematicStyling` |

A layer is only included if it is visible or shown in the legend. The `measure` layer and draw
layers are never included, they are part of the control state instead.

### Control state

`controls` holds the state of controls that cannot be represented in a URL. It is only produced
by `saveStateToServer` and is therefore never present in a fragment based link.

* `controls.draw` — the drawn layers, each with `id`, `title`, `visible` and `features` as a
  GeoJSON `FeatureCollection`.
* `controls.measure` — the measure control's state, including active measurements for area,
  length, buffer and elevation.

### Adding your own parameters

A plugin or an application can add its own keys to the state:

```js
const sharemap = viewer.getControlByName('sharemap');
sharemap.addParamsToGetMapState('myKey', (state) => {
  state.myKey = 'myValue';
});
```

The callback receives the state object and may add properties to it. The same function is
available directly on the permalink module as `permalink.addParamsToGetMapState(key, callback)`.
Custom keys are passed through unchanged when a server stored state is read back.

## Startup behaviour

When Origo starts, the parameters found in the URL override the corresponding values in the map
configuration:

* `center` and `zoom` override the configured centre and zoom.
* If neither `zoom` nor `mapStateId` is present, a configured `startExtent` is used to fit the view.
* `layers` are merged with the configured layer properties.
* `pin`, `selection` and `feature` are applied after the layers have been added. For `feature`,
  Origo waits for the layer source to finish loading before the popup is shown.
* `map` selects which map configuration file to load.

## Changing the URL of a running map

Origo listens for `hashchange` and reloads the map when the hash changes, but **only if the new
hash contains a `map` parameter**:

```js
window.addEventListener('hashchange', (ev) => {
  const newParams = permalink.parsePermalink(ev.newURL);
  if (newParams.map) {
    initViewer();
  }
});
```

This matters when an Origo map is embedded in an `iframe` and controlled from the surrounding
page. Changing only `center`, `zoom` or `layers` in the fragment has no effect on a map that is
already running — the new hash must include `map=<map configuration>` for the viewer to be
recreated with the new state.

Also note that the map is recreated from the original configuration, not updated in place. Any
state that is not part of the URL parameters is lost.

## Alternatives to the URL

The URL only covers what the `sharemap` control needs. For anything beyond that, use the Origo
API on the viewer instance, for example `viewer.getMap()`, `viewer.getLayer(name)` or
`viewer.getControlByName(name)`. When the map is embedded in an `iframe` and the API is not
reachable from the surrounding page, a `postMessage` wrapper inside the embedded page is the
usual solution.

## Detecting an embedded map

Origo considers a map embedded when it is loaded in a frame, or when the map element is smaller
than the surrounding document. The viewer exposes this:

```js
if (viewer.isEmbedded()) {
  // ...
}
```

Two configuration options build on this:

* `hideWhenEmbedded` on a control hides that control when the map is embedded.
* `mapInteractions.embedded` (default `true`) enables the overlay that asks the user for two
  fingers or `ctrl` + scroll before the embedded map pans or zooms.
