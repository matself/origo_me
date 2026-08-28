# Origo Config Editor

Ett fristående HTML-verktyg för att redigera Origo-kartkonfigurationer (JSON) direkt i webbläsaren, utan byggsteg eller server. Öppna `config_editor.html` i Chrome eller Edge för bäst upplevelse.

## Vad gör det?

Verktyget läser in en Origo-konfigurationsfil (`.json`) och visar den på två sätt sida vid sida:

- **Rå JSON-panel** till höger — den redigerbara sanningskällan. Det som står här är det som sparas.
- **Formulär-flikar** till vänster — ett mer lättanvänt sätt att ändra samma data:
  - **Structure** — ett expanderbart träd som visar hela filens struktur, skrivskyddat.
  - **Basic Settings** — projektion, extent, center, zoom, resolutions, footer, source, färgpalett och `proj4Defs` (med ett inbyggt bibliotek av svenska SWEREF99-zoner och RT90 att lägga till med ett klick).
  - **Controls** — Origo-kontroller (t.ex. `home`, `zoom`, `legend`) med options som fritext-JSON.
  - **Layers** — lager med typ, grupp, källa, stil, synlighet m.m., inklusive nästlade grupper.
  - **Styles** — stilregler per namn, med sökfilter och en "endast oanvända"-vy.

Ändringar i formulären skrivs igenom till den råa JSON-panelen automatiskt, och tvärtom — redigerar du direkt i JSON-panelen uppdateras formulären så fort filen är giltig JSON.

## Kommentarer i JSON

Filen kan innehålla `//`- och `/* */`-kommentarer trots att det inte är giltig JSON i strikt mening. Verktyget:

- Tolererar dem vid inläsning.
- Bevarar dem i de delar av filen du *inte* rör.
- Skriver om (och tappar därmed kommentarer i) endast de toppnivånycklar du faktiskt ändrar via formulären.
- Varnar dig i gränssnittet om vilka sektioner som innehåller kommentarer.

Den råa JSON-panelen är alltid kommentarssäker — redigerar du bara där bevaras allt.

## Spara

- **Save** skriver tillbaka till filen på disk (kräver File System Access API, dvs. Chrome/Edge). I andra webbläsare laddas en ny fil ner istället.
- **Save As…** låter dig spara till en ny fil/plats.
- **Close without saving** återställer till senast sparade version.
- Osparade ändringar visas som en röd prick vid filnamnet i headern.

Det finns ingen "Ny fil"-knapp. Vill du starta en ny konfiguration, öppna en befintlig fil, rensa ut det du inte behöver, och spara med **Save As…** under ett nytt namn.

## Om proj4Defs

Origo har inga inbyggda projektionsdefinitioner — varje konfigurationsfil måste själv lista varje EPSG-kod (utöver `EPSG:3857`/`EPSG:4326`, som stöds direkt) den använder, i sin egen `proj4Defs`-array. Det gäller även EPSG-koder som bara används av en enskild källa eller ett enskilt lager, inte bara kartans egen `projectionCode`. Saknas definitionen misslyckas omprojicering tyst.

I **Basic Settings** kan du lägga till vanliga svenska projektioner (SWEREF99-zonerna och RT90 2.5 gon V) direkt från en rullista, istället för att leta upp proj4-strängar för hand.

## Kortkommandon

- `Ctrl/Cmd + S` — Spara
- `Alt + 1` till `Alt + 5` — växla mellan flikarna Structure, Basic Settings, Controls, Layers, Styles

## Köra lokalt

Ingen build behövs — öppna `config_editor.html` direkt i webbläsaren, eller kör den lilla statiska servern som ligger i `.claude/static-server.js` (se `.claude/launch.json` för portnummer) och gå till `/config_editor.html` — serverns rot letar efter `index.html` och ger 404.
