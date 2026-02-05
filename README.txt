Money Rush (Offline Local Server)
================================

This build runs WITHOUT npm install. No external dependencies.

Requirements
- Node.js 18+ installed (your Node is fine)

How to run
1) Open PowerShell in this folder
2) Run:
   node server.js

Open in browser
- Main control UI: http://localhost:3000
- Projector display: http://localhost:3000/display
- Printable results page: http://localhost:3000/api/print

Default logins (you can change later inside server.js)
- Admin PIN: 0000
- Agent usernames: AG_GOV, AG_NPS, AG_IT, AG_AUTO, AG_PHARMA, AG_GOLD, AG_SILVER, AG_CRYPTO, AG_BANK, AG_MF1, AG_MF2
- Agent PIN for all: 1234

Game flow (recommended)
1) Tab 1: Register teams (Team size 2)
2) Admin login and approve teams
3) Tab 3: Add market conditions and add up to 12 wheel events for each condition
4) Tab 4:
   a) Market Scan (random condition picked)
   b) Show Effect and Open Wheel
   c) Spin Event (repeat as you like, then)
   d) Open Trading Window (agents invest/withdraw/transfer)
   e) Close Trading and Next Round
5) End Game (Apply Tax)
6) Open printable results and Print/Save as PDF

Notes
- Trading is allowed only when Phase = Trading Window
- Event acceptance is done by the affected agent, then the event impact is applied instantly to all teams' holdings in that avenue.
- Mutual funds are hardcoded baskets and their event impacts are derived from underlying avenues.
- PDF generation is via browser Print -> Save as PDF on the printable results page.

Assets
- Replace logos:
  public/assets/university.png
  public/assets/event.png
- Optional: put MP3 files under public/audio and modify the UI if needed.
