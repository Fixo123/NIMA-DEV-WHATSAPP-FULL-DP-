# wa-dp-bot

ඔයාගේම WhatsApp account එකට, **official** `@whiskeysockets/baileys@7.0.0-rc13`
library එක පාවිච්චි කරලා, pairing code එකකින් connect වෙලා, connect වුනාම
ඔයාගේ profile picture (DP) එක local image file එකකින් automatically
update කරන simple script එකක්.

> ⚠️ මේ script එක ඔයාගේම (හෝ ඔයාට explicit permission තියෙන) WhatsApp
> number එකට විතරයි පාවිච්චි කරන්න ඕන. වෙන කෙනෙකුගේ account එකක් pair/link
> කරගන්න මේක පාවිච්චි කරන්න එපා.

## Setup

```bash
npm install
```

`dp.jpg` කියලා ඔයාට ඕන DP image එක project folder එකේ දාන්න
(`DP_IMAGE_PATH` එක `index.js` එකේදී වෙනස් කරගන්නත් පුළුවන්).

## Run

```bash
node index.js
```

1. Terminal එකේ ඔයාගේ WhatsApp number එක අහයි (country code එකත් සමග,
   උදා: `947XXXXXXXX`).
2. Pairing code එකක් print වෙනවා.
3. ඔයාගේ phone එකේ: **WhatsApp > Settings > Linked Devices > Link a device
   > Link with phone number instead** ගිහින් ඒ code එක enter කරන්න.
4. Connect වුනාම, `dp.jpg` එක automatically profile picture එකට set වෙනවා.

Session credentials `auth_info/` folder එකේ save වෙනවා, ඒ නිසා ආයෙත් run
කරද්දී pairing code අහන්නේ නෑ (session එක valid නම්).

## Server / VPS එකක deploy කරන්නේ කොහොමද

1. Node.js 18+ install කරගන්න.
2. මේ folder එක server එකට upload කරන්න (`git clone` හෝ `scp`).
3. `npm install` කරන්න.
4. Phone number එක environment variable එකක් විදිහට set කරන්න:
   ```bash
   export WA_PHONE_NUMBER=947XXXXXXXX
   ```
5. `node index.js` එකෙන් එක පාරක් manual run කරලා pair කරගන්න
   (terminal එකේ pairing code එක print වෙනවා).
6. Session එක save වුනාට පස්සේ, process එක persistent කරගන්න
   `pm2` වගේ tool එකකින්:

```bash
npm install -g pm2
pm2 start index.js --name wa-dp-bot
pm2 save
```

`auth_info/` folder එක git එකට commit කරන්න එපා - ඒකේ ඔයාගේ session
credentials තියෙන්නේ, leak වුනොත් ඕන කෙනෙකුට ඔයාගේ WhatsApp account එක
access කරගන්න පුළුවන්.

## Heroku එකේ deploy කරන්නේ කොහොමද (ඔයාට ආපු error එක fix කරන විදිය)

ඔයාට ආපු error දෙක:
- **`H10 App crashed`** — Heroku `web` dyno එකක් `$PORT` එකට bind වෙන HTTP
  server එකක් බලාපොරොත්තු වෙනවා. Bot එකට ඒක ඕන නෑ.
- **`Enter your WhatsApp number...` වලින් process එක hang වෙලා kill වෙනවා**
  — Heroku dyno එකේ interactive terminal (TTY) එකක් නෑ, ඒ නිසා `readline`
  එකෙන් type කරන්න බලාගෙන ඉන්න එකක් වැඩ කරන්නේ නෑ.

මේ update කරපු version එකේ දෙකම fix කරලා තියෙනවා: phone number එක
Config Var එකකින් දෙනවා, සහ `web` dyno එකට අවශ්‍ය නම් keep-alive HTTP
server එකකුත් දාලා තියෙනවා. නමුත් **bot එකක් නිසා `worker` dyno** එකක්
පාවිච්චි කරන එකයි recommend කරන්නේ (web dyno එකේ 30s request timeout
එකක් තියෙනවා, bot process එකට ඒක අදාළ නෑ).

### Steps

1. GitHub repo එකේ මේ files (`index.js`, `package.json`, `Procfile`) push
   කරන්න.
2. Heroku dashboard එකේ ඔයාගේ app එකට යන්න → **Settings** → **Config Vars**
   → **Reveal Config Vars** → add කරන්න:
   - `WA_PHONE_NUMBER` = `947XXXXXXXX` (ඔයාගේ number එක, country code එකත් සමග)
3. **Resources** tab එකට යන්න:
   - `web` dyno එක තියෙනවා නම් **disable** කරන්න (toggle off).
   - `worker` dyno එක **enable** කරන්න (toggle on). (`Procfile` එකේ
     `worker: node index.js` කියලා දැනටමත් දාලා තියෙනවා.)
4. Redeploy කරන්න (**Deploy** tab → **Deploy Branch**, හෝ push අලුත් commit
   එකක්).
5. Pairing code එක බලාගන්න: `heroku logs --tail` (CLI) හෝ dashboard
   **Activity/Logs** viewer එකෙන්.
6. Phone එකේ **Linked Devices > Link a device > Link with phone number
   instead** ගිහින් code එක type කරන්න.

> ⚠️ Heroku dynos වල filesystem එක **ephemeral** — dyno restart වුනොත්
> (dynos daily restart වෙනවා) `auth_info/` folder එකත් delete වෙනවා, ඒ
> කියන්නේ ආයෙත් pair වෙන්න ඕන. Long-term deploy එකකට, `auth_info` state
> එක persistent storage එකකට (S3 වගේ) save කරන logic එකක් දාන්න ඕන,
> නැත්නම් Heroku වෙනුවට persistent disk එකක් තියෙන VPS එකක් පාවිච්චි
> කරන්න.

## Notes

- `DisconnectReason.loggedOut` ආවොත් `auth_info/` folder එක delete කරලා
  ආයෙත් pair වෙන්න ඕන.
- DP එක එක පාරක් විතරයි update වෙන්නේ (connect එකෙන් පස්සේ), restart
  කරාම ආයෙත් run වෙනවා.
