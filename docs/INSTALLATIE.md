# ScoutIQ - installatie en gebruik, stap voor stap

Deze handleiding neemt je van niets tot een werkende ScoutIQ waarin je een
speler kunt opzoeken, vergelijken en er een PDF-rapport van kunt maken.

Je hoeft geen programmeur te zijn. Je typt commando's over en drukt op Enter.
Elke stap zegt wat je moet zien als het goed gaat, en wat je doet als het
misgaat.

> **Duurt ongeveer:** 30 minuten, waarvan het meeste wachten op downloads.

---

## Inhoud

- [Deel 1 - Wat je nodig hebt](#deel-1---wat-je-nodig-hebt)
- [Deel 2 - Docker installeren](#deel-2---docker-installeren)
- [Deel 3 - ScoutIQ ophalen](#deel-3---scoutiq-ophalen)
- [Deel 4 - Wachtwoorden instellen](#deel-4---wachtwoorden-instellen)
- [Deel 5 - Starten](#deel-5---starten)
- [Deel 6 - Je eigen account maken](#deel-6---je-eigen-account-maken)
- [Deel 7 - Demodata inladen](#deel-7---demodata-inladen)
- [Deel 8 - Inloggen en rondkijken](#deel-8---inloggen-en-rondkijken)
- [Deel 9 - Echte data inladen](#deel-9---echte-data-inladen)
- [Deel 10 - Dagelijks gebruik](#deel-10---dagelijks-gebruik)
- [Deel 11 - Back-ups](#deel-11---back-ups)
- [Deel 12 - Als er iets misgaat](#deel-12---als-er-iets-misgaat)

---

## Deel 1 - Wat je nodig hebt

**Een computer of virtuele machine met:**

| | Minimaal | Prettig |
| --- | --- | --- |
| Processor | 4 kernen | 8 kernen |
| Geheugen | 8 GB | 16 GB |
| Schijfruimte | 60 GB | 200 GB |
| Besturingssysteem | Debian 12, Ubuntu 22.04/24.04, of Windows 11 met Hyper-V | |

**Verder:**

- Een internetverbinding (alleen tijdens de installatie).
- Ongeveer 30 minuten.

Draai je Windows 11 met Hyper-V en wil je ScoutIQ in een eigen virtuele machine
zetten? Volg dan eerst
[docs/deployment/windows11-hyperv.md](deployment/windows11-hyperv.md) om die VM
te maken, en kom daarna hier terug.

> **Belangrijk:** ScoutIQ raakt bestaande virtuele machines nooit aan. Een
> Minecraft-VM op dezelfde host blijft ongemoeid.

---

## Deel 2 - Docker installeren

Docker is het enige dat je zelf hoeft te installeren. Alles wat ScoutIQ nodig
heeft - de database, de webserver, de rekenmachine - zit in Docker-pakketjes die
zichzelf opzetten.

Open een terminal en plak dit blok in zijn geheel:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

> Op **Ubuntu** vervang je in bovenstaand blok beide keren `debian` door
> `ubuntu`.

Zet jezelf in de docker-groep, zodat je niet steeds `sudo` hoeft te typen:

```bash
sudo usermod -aG docker $USER
```

**Log nu uit en weer in** (of herstart de machine). Dat is nodig, anders werkt
de vorige regel nog niet.

**Controleer:**

```bash
docker --version
docker compose version
```

✅ Je ziet twee versienummers.
❌ Zie je `permission denied`? Dan ben je nog niet opnieuw ingelogd.

---

## Deel 3 - ScoutIQ ophalen

```bash
cd ~
git clone https://github.com/patrickdekker82/ScoutIQ.git
cd ScoutIQ
```

**Controleer:**

```bash
ls
```

✅ Je ziet onder andere `docker-compose.yml`, `README.md` en `prisma`.

> Vanaf hier gaan alle commando's ervan uit dat je in de map `~/ScoutIQ` staat.
> Ben je het kwijt: `cd ~/ScoutIQ`.

---

## Deel 4 - Wachtwoorden instellen

ScoutIQ wordt geleverd **zonder** standaardwachtwoord. Dat is met opzet: een
standaardwachtwoord is een standaard inbraakroute.

Maak je instellingenbestand en laat de computer zelf twee sterke geheimen
verzinnen:

```bash
cp .env.example .env
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
```

**Controleer:**

```bash
grep -E "^(AUTH_SECRET|POSTGRES_PASSWORD)=" .env
```

✅ Achter beide staat een lange reeks letters en cijfers.
❌ Staat er `change-me` of iets dergelijks? Voer de twee `sed`-regels opnieuw uit.

> **Nooit doen:** het bestand `.env` in GitHub zetten of doorsturen. Het staat
> al in `.gitignore`, dus dat gebeurt niet per ongeluk.

---

## Deel 5 - Starten

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

De eerste keer duurt dit **10 tot 20 minuten**: Docker bouwt de pakketjes. De
keren daarna is het een halve minuut.

**Controleer:**

```bash
docker compose ps
```

✅ De regels `postgres`, `redis`, `web`, `worker` en `scheduler` staan op
`running` of `healthy`.

```bash
curl -s http://127.0.0.1:3000/api/health
```

✅ Je ziet een regel met `"status":"ok"`.
❌ Krijg je niets? Wacht een minuut en probeer opnieuw - de webserver start als
laatste. Blijft het stil, zie [Deel 12](#deel-12---als-er-iets-misgaat).

---

## Deel 6 - Je eigen account maken

Vul je eigen e-mailadres en een **sterk** wachtwoord in (minimaal 8 tekens, maar
neem er gerust 16):

```bash
docker compose run --rm \
  -e SEED_ADMIN_EMAIL=jij@voorbeeld.nl \
  -e SEED_ADMIN_PASSWORD='kies-hier-een-sterk-wachtwoord' \
  web seed
```

✅ Je ziet: `Seeded admin jij@voorbeeld.nl and 19 player roles.`

> Let op de **enkele aanhalingstekens** om het wachtwoord. Zonder die tekens
> gaat het mis bij tekens als `$` of `!`.

Dit account is beheerder: het mag alles, inclusief andere accounts aanmaken.

---

## Deel 7 - Demodata inladen

Voordat je echte data zoekt, is het prettig om te zien hoe alles eruitziet.
ScoutIQ heeft een verzonnen competitie ingebouwd: zes clubs, negentig spelers,
dertig wedstrijden, 27.000 gebeurtenissen. Geen internet of API-sleutel nodig.

```bash
docker compose run --rm web demo
docker compose run --rm web analytics
```

De eerste regel duurt ongeveer een halve minuut, de tweede ook.

✅ Na de eerste: `Events: 27000` en `Errors: 0`.
✅ Na de tweede: een regel met `analytics recomputed`.

> Alles uit deze demoliga is **verzonnen** en overal in het scherm gemarkeerd
> met een oranje label **DEMO DATA**. Er bestaat geen speler, club of wedstrijd
> uit deze competitie in het echt.

---

## Deel 8 - Inloggen en rondkijken

Open in je browser:

```
http://127.0.0.1:3000
```

Zit ScoutIQ op een andere machine in je netwerk? Gebruik dan het IP-adres van
die machine, bijvoorbeeld `http://192.168.1.50:3000`.

Log in met het e-mailadres en wachtwoord uit Deel 6.

### Een rondleiding van vijf minuten

Loop deze zes dingen door, dan heb je de hele app gezien:

**1. Zoek een speler.** Klik op **Players**. Zet een filter, bijvoorbeeld
"Progressive passes /90" groter dan 5. Klik op een naam.

**2. Lees de spelerspagina.** Je ziet:
- de **DNA-radar**: tien eigenschappen, elk 0-100. *Ga met je muis op een as
  staan* - dan zie je precies welke metrieken en gewichten dat cijfer maakten.
- de **percentielen**: hoe deze speler zich verhoudt tot spelers in dezelfde
  competitie, hetzelfde seizoen en dezelfde positiegroep.
- een **heatmap** die je kunt filteren op helft, minuutbereik en balbezit.
- **rollen**, **vergelijkbare spelers** en **clubfit**.
- **scoutbeoordelingen**: je eigen oordeel, dat bewust nooit met de
  berekende cijfers wordt vermengd.

**3. Vergelijk twee spelers.** Klik op **Compare** bovenin. Zoek twee spelers
op. Je ziet profielen, DNA over elkaar heen, metrieken, sterktes en zwaktes.

**4. Bekijk een wedstrijd.** Klik op **Matches** en kies er een. Onderin staat
het **passnetwerk**: spelers als bollen, passes als lijnen. Klik op *1H*, *2H*
of *Possession only* om te filteren.

**5. Maak een lijstje.** Klik op **Shortlists** → nieuwe lijst maken. Ga daarna
naar een speler en klik **Add to shortlist**. Op de lijst zet je per speler een
status, een prioriteit en een eigen cijfer.

**6. Maak een PDF.** Klik op een speler → **Generate PDF report**. Na een halve
minuut staat hij onder **Reports**. Het is een echte, doorzoekbare PDF met
methodeverantwoording, databronnen en datakwaliteit erin.

### Wat waar zit

| Menu | Wat je er doet |
| --- | --- |
| **Overview** | Wat er in de database zit |
| **Players** | Spelers zoeken op metrieken en percentielen |
| **Clubs** | Clubprofiel, tactische stijl, selectie |
| **Compare** | Twee tot vijf spelers of clubs naast elkaar |
| **Matches** | Wedstrijd, schotenkaart, passnetwerk, gebeurtenissen |
| **Shortlists** | Je scoutinglijsten |
| **Reports** | Gegenereerde rapporten en hun PDF's |
| **Roles** | Zelf een rol definiëren en zien wie erop past |
| **Data** | Data importeren, bestanden uploaden, providers |
| **SQL** | De database rechtstreeks bevragen (alleen lezen) |
| **Jobs** | Wat de achtergrondtaken aan het doen zijn |
| **Users** | Accounts beheren (alleen beheerders) |

---

## Deel 9 - Echte data inladen

De demoliga is verzonnen. Voor echte data heb je twee mogelijkheden.

### A. Open data (gratis, geen sleutel nodig)

StatsBomb geeft een deel van zijn data vrij: WK-finales, competities van
Messi, de FA Women's Super League en meer.

```bash
docker compose run --rm web npx tsx scripts/ingest.ts statsbomb
docker compose run --rm web analytics
```

Dit kan lang duren - er wordt veel van internet gehaald. Volg de voortgang in
het menu **Jobs**.

> **Let op de licentie.** Open beschikbaar is niet hetzelfde als vrij
> herbruikbaar. ScoutIQ toont bij elke provider wat wel en niet mag onder
> **Data → Provider registry**. Ga niet uit van commercieel gebruik zonder dat
> daar te hebben gekeken.

### B. Je eigen bestand (CSV of JSON)

1. Ga naar **Data**.
2. Klik onder **File upload** op **Choose a file**.
3. Kies je bestand. De naam bepaalt hoe het gelezen wordt:
   - `players.csv` → spelers
   - `teams.csv` → clubs
   - `events.csv` → gebeurtenissen
   - Een streepje erachter mag: `players-eredivisie.csv` werkt ook.
4. Klik **Inspect**. Je ziet de kolommen, drie voorbeeldregels, dubbele id's en
   lege kolommen. **Kijk hier even naar** - een fout in een spreadsheet vind je
   hier in tien seconden.
5. Klopt het? Kies bovenin bij **Import** de provider *CSV / JSON file import*
   en klik **Run import**.

Uploaden is nadrukkelijk niet hetzelfde als importeren. Je kunt een bestand
bekijken en weer weggooien zonder dat de database het ooit heeft gezien.

### C. Betaalde API's (Sportmonks, API-Football)

Heb je een abonnement? Zet je sleutel in `.env`:

```bash
nano .env
```

Vul in bij `SPORTMONKS_API_KEY=` of `API_FOOTBALL_KEY=`, sla op met
`Ctrl+O`, `Enter`, `Ctrl+X`, en herstart:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Ga daarna naar **Data → External API synchronisation** en maak een schema aan.
ScoutIQ haalt dan vanzelf periodiek nieuwe wedstrijden op, en vraagt alleen om
wat er sinds de vorige keer bij is gekomen.

> Sleutels horen **alleen** in `.env`, nooit in de database of in de browser.

---

## Deel 10 - Dagelijks gebruik

ScoutIQ blijft vanzelf draaien en start mee op na een herstart van de machine.
In de praktijk gebruik je maar een handvol commando's.

| Wat je wilt | Commando |
| --- | --- |
| Kijken of alles draait | `docker compose ps` |
| Meekijken met de logs | `docker compose logs -f web` |
| Herstarten | `docker compose restart` |
| Stoppen | `docker compose down` |
| Weer starten | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` |
| Analyses opnieuw laten rekenen | `docker compose run --rm web analytics` |
| Bijwerken naar de nieuwste versie | zie hieronder |

**Bijwerken:**

```bash
cd ~/ScoutIQ
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose run --rm web migrate
```

De laatste regel werkt de database bij als het schema is veranderd. Hij is
veilig om altijd uit te voeren; als er niets te doen is, doet hij niets.

### Iemand anders toegang geven

**Users → e-mail, naam, rol, wachtwoord → Create account.**

| Rol | Mag |
| --- | --- |
| **ADMIN** | Alles, inclusief accounts, providers, imports en back-ups |
| **ANALYST** | Analyses draaien, SQL-console, exports, rapporten, lijsten |
| **SCOUT** | Rapporten, lijsten en notities - geen SQL, geen exports |
| **VIEWER** | Alleen kijken |

Deactiveer je iemand, of verander je zijn wachtwoord, dan is hij op hetzelfde
moment overal uitgelogd. De laatste actieve beheerder kan zichzelf niet
degraderen of uitschakelen - promoveer eerst een vervanger.

---

## Deel 11 - Back-ups

ScoutIQ maakt elke nacht automatisch een back-up. Je hoeft niets te doen -
behalve één keer controleren dat het werkt.

**Nu handmatig een back-up maken:**

```bash
docker compose run --rm web backup
```

**Kijken wat er staat:**

```bash
ls -lh data/backups/
```

✅ Je ziet een `.dump`-bestand van vandaag, met daarnaast een `.sha256` -
dat is de controlesom waarmee je later kunt vaststellen dat het bestand
onbeschadigd is.

**Terugzetten** (alleen als het echt nodig is - dit overschrijft je database):

```bash
# Zonder bestandsnaam pakt hij de nieuwste en vraagt eerst om bevestiging:
./scripts/db-restore.sh

# Of noem er zelf een:
./scripts/db-restore.sh data/backups/scoutiq-scoutiq-20260903T072207Z.dump
```

Deze dump is een standaard PostgreSQL-bestand. Je kunt hem terugzetten op elke
PostgreSQL - op deze machine, op een nieuwe server, of later op een VPS.

> **Test je back-up minstens één keer.** Een back-up die je nooit hebt
> teruggezet, is een aanname en geen back-up. In
> [docs/deployment/backups.md](deployment/backups.md) staat hoe je dat veilig
> doet in een aparte testdatabase.

Heb je een NAS? Vul dan `NAS_BACKUP_PATH` in `.env` in, dan wordt elke back-up
er automatisch ook heen gekopieerd. Zet er wél alleen back-ups op, nooit de
levende database - zie [docs/deployment/nas.md](deployment/nas.md).

---

## Deel 12 - Als er iets misgaat

### De pagina laadt niet

```bash
docker compose ps
docker compose logs --tail 50 web
```

Staat `web` niet op `running`? De logregels onderaan zeggen waarom. De meest
voorkomende oorzaak is een ontbrekende waarde in `.env`; de foutmelding noemt
dan de naam ervan.

### "database not reachable"

De database heeft langer nodig dan de webserver. Wacht een minuut:

```bash
docker compose restart web
```

### Poort 3000 is al bezet

Zet in `.env` een andere poort, bijvoorbeeld `PORT=3100`, en start opnieuw op.

### Er staan geen spelers in

Dan is er nog geen data ingeladen, of de analyses zijn nog niet gerekend:

```bash
docker compose run --rm web demo
docker compose run --rm web analytics
```

### Ik ben mijn wachtwoord kwijt

Maak jezelf opnieuw aan met hetzelfde e-mailadres; het wachtwoord wordt
bijgewerkt:

```bash
docker compose run --rm \
  -e SEED_ADMIN_EMAIL=jij@voorbeeld.nl \
  -e SEED_ADMIN_PASSWORD='nieuw-sterk-wachtwoord' \
  web seed
```

### Een PDF komt niet

Kijk bij **Jobs** of de taak is mislukt, en waarom. Meestal ontbreekt de
browser die de PDF tekent. Het rapport zelf is niet weg: de HTML-versie staat
er altijd, en de PDF kun je later opnieuw laten maken.

### Helemaal opnieuw beginnen

⚠️ **Dit gooit alle data weg.**

```bash
docker compose down -v
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Daarna weer vanaf [Deel 6](#deel-6---je-eigen-account-maken).

---

## Wat je nooit moet doen

- `.env` delen, mailen of in GitHub zetten.
- PostgreSQL, Redis of pgAdmin rechtstreeks aan het internet hangen. Wil je van
  buiten erbij? Gebruik een VPN of SSH-tunnel -
  [docs/deployment/remote-access.md](deployment/remote-access.md).
- De levende database op een netwerkschijf (SMB/NFS) zetten. Back-ups mogen daar
  wel; de database zelf raakt beschadigd.
- Ervan uitgaan dat open data ook commercieel gebruikt mag worden. Kijk onder
  **Data → Provider registry** wat er per bron is toegestaan.
- Websites scrapen zonder toestemming.

---

## Verder lezen

| Onderwerp | Document |
| --- | --- |
| Alle mogelijkheden en commando's | [README.md](../README.md) |
| Windows 11 + Hyper-V | [deployment/windows11-hyperv.md](deployment/windows11-hyperv.md) |
| Debian/Ubuntu-server | [deployment/debian-vm.md](deployment/debian-vm.md) |
| Docker in detail | [deployment/docker.md](deployment/docker.md) |
| Back-up en herstel | [deployment/backups.md](deployment/backups.md) |
| NAS-opslag | [deployment/nas.md](deployment/nas.md) |
| Toegang van buiten | [deployment/remote-access.md](deployment/remote-access.md) |
| Later naar een VPS verhuizen | [deployment/migrate-home-to-vps.md](deployment/migrate-home-to-vps.md) |
| Hoe de database in elkaar zit | [database/erd.md](database/erd.md) |
| Voorbeeldqueries | [sql/README.md](sql/README.md) |
