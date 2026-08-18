# ESSEC Global Circular Economy Chair — site refresh

A static, modern rebuild of [circular-economy-chair.essec.edu](https://circular-economy-chair.essec.edu/), keeping the Chair’s architecture and core copy while dropping outdated homepage items (2021 press release, 2022 Grand Jury, founding announcements).

This is a front-end prototype for review. It does not replace the live Google Site until someone publishes it.

## Preview

```bash
cd essec-circular-chair
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## What changed

- Homepage rebuilt around the Chair, the Executive Certificate, eligible programs, 2026 applications (link forthcoming), recent impact (Brussels, Final Jury 2025, site visits), partners, and student portraits.
- 2026 slots ready for the next cohort photos, LinkedIn profiles, and new Brussels materials.
- Inner pages retained: program, education, study trips, site visits, events, apply, students, testimonies, team, partners, content, publications, Circular CAC 40.

Student portraits and partner logos are loaded from the current public Google Site (googleusercontent). If an image fails to load, the layout still holds.

## Regenerate HTML

```bash
python3 generate.py
```

## Note

The live Google Site was not edited from this repository (no login to ESSEC accounts). Publish by copying this design into Google Sites, or hosting these files on ESSEC web infrastructure.
