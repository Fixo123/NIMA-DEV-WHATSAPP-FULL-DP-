/**
 * wa-dp-bot
 * ---------
 * Connects to YOUR OWN WhatsApp account using the official Baileys library
 * (@whiskeysockets/baileys@7.0.0-rc13) via a pairing code, and automatically
 * sets your profile picture from a local image file once the connection
 * is established.
 *
 * This script is intended to be used ONLY with a WhatsApp number that
 * belongs to you / that you have explicit permission to control. Do not
 * use it to pair or take control of other people's accounts.
 *
 * Usage:
 *   1. npm install
 *   2. Put your image at ./dp.jpg (or change DP_IMAGE_PATH below)
 *   3. Set your own WhatsApp number as an env var (with country code,
 *      digits only, e.g. 947XXXXXXXX):
 *        export WA_PHONE_NUMBER=947XXXXXXXX   (or heroku config:set ...)
 *   4. node index.js
 *   5. Open WhatsApp on your phone -> Linked Devices -> Link a device ->
 *      Link with phone number instead -> enter the pairing code shown
 *      in the logs/terminal.
 *   6. Once connected, your profile picture is updated automatically.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const AUTH_FOLDER = path.join(__dirname, 'auth_info');
const DP_IMAGE_PATH = path.join(__dirname, 'dp.jpg'); // fixed local image
const LOGGER = pino({ level: 'silent' }); // set to 'info' for verbose logs

// Heroku (and most PaaS hosts) has NO interactive terminal, so the phone
// number can't be typed in at runtime. Set it as a Config Var instead:
//   heroku config:set WA_PHONE_NUMBER=947XXXXXXXX
const PHONE_NUMBER = process.env.WA_PHONE_NUMBER;

// ---------------------------------------------------------------------------
// Tiny keep-alive HTTP server
// ---------------------------------------------------------------------------
// Only needed if this app is deployed as a Heroku "web" dyno, which requires
// binding to $PORT or Heroku's router reports "H10 App crashed". If you use
// a "worker" dyno instead (recommended for bots), you can remove this whole
// block and the Procfile's web line.
let keepAliveServerStarted = false;
function startKeepAliveServer() {
  const port = process.env.PORT;
  if (!port || keepAliveServerStarted) return; // not a web dyno, or already listening
  keepAliveServerStarted = true;
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('wa-dp-bot is running');
    })
    .listen(port, () => {
      console.log(`[dp-bot] Keep-alive HTTP server listening on port ${port}`);
    });
}

let dpUpdateAttempted = false;

async function updateProfilePicture(sock) {
  if (dpUpdateAttempted) return; // only do this once per run
  dpUpdateAttempted = true;

  if (!fs.existsSync(DP_IMAGE_PATH)) {
    console.log(
      `[dp-bot] No image found at ${DP_IMAGE_PATH}. Skipping DP update. ` +
        `Place an image there and restart to set it.`
    );
    return;
  }

  try {
    const imageBuffer = fs.readFileSync(DP_IMAGE_PATH);
    const myJid = sock.user.id;
    await sock.updateProfilePicture(myJid, imageBuffer);
    console.log('[dp-bot] Profile picture updated successfully.');
  } catch (err) {
    console.error('[dp-bot] Failed to update profile picture:', err);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function startBot() {
  startKeepAliveServer();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: LOGGER,
    printQRInTerminal: false, // we are using pairing code, not QR
    auth: state,
    browser: ['WA-DP-Bot', 'Chrome', '1.0.0'],
  });

  // If not registered yet, request a pairing code instead of a QR code
  if (!sock.authState.creds.registered) {
    if (!PHONE_NUMBER) {
      console.error(
        '[dp-bot] WA_PHONE_NUMBER env var is not set. On Heroku run:\n' +
          '  heroku config:set WA_PHONE_NUMBER=947XXXXXXXX'
      );
      process.exit(1);
    }
    try {
      const code = await sock.requestPairingCode(PHONE_NUMBER.replace(/[^0-9]/g, ''));
      console.log('\n=================================');
      console.log(`  Your pairing code: ${code}`);
      console.log('=================================');
      console.log(
        'On your phone: WhatsApp > Linked Devices > Link a device > ' +
          'Link with phone number instead, then enter this code.\n'
      );
    } catch (err) {
      console.error('[dp-bot] Failed to request pairing code:', err);
      process.exit(1);
    }
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('[dp-bot] Connected to WhatsApp.');
      await updateProfilePicture(sock);
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(
        `[dp-bot] Connection closed (status: ${statusCode}). ` +
          `${loggedOut ? 'Logged out - delete the auth_info folder to re-pair.' : 'Reconnecting...'}`
      );
      if (!loggedOut) {
        startBot();
      }
    }
  });
}

startBot().catch((err) => {
  console.error('[dp-bot] Fatal error:', err);
  process.exit(1);
});

