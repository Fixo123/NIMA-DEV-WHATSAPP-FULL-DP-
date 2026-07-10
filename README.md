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
4. `node index.js` එකෙන් එක පාරක් manual run කරලා pair කරගන්න
   (interactive terminal එකක් ඕන, ඒ නිසා `screen`/`tmux` පාවිච්චි කරන්න).
5. Session එක save වුනාට පස්සේ, process එක persistent කරගන්න
   `pm2` වගේ tool එකකින්:

```bash
npm install -g pm2
pm2 start index.js --name wa-dp-bot
pm2 save
```

`auth_info/` folder එක git එකට commit කරන්න එපා - ඒකේ ඔයාගේ session
credentials තියෙන්නේ, leak වුනොත් ඕන කෙනෙකුට ඔයාගේ WhatsApp account එක
access කරගන්න පුළුවන්.

## Notes

- `DisconnectReason.loggedOut` ආවොත් `auth_info/` folder එක delete කරලා
  ආයෙත් pair වෙන්න ඕන.
- DP එක එක පාරක් විතරයි update වෙන්නේ (connect එකෙන් පස්සේ), restart
  කරාම ආයෙත් run වෙනවා.

