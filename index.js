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
 *   3. node index.js
 *   4. Enter your own WhatsApp number when prompted (with country code,
 *      digits only, e.g. 947XXXXXXXX)
 *   5. Open WhatsApp on your phone -> Linked Devices -> Link a device ->
 *      Link with phone number instead -> enter the pairing code shown
 *      in the terminal.
 *   6. Once connected, your profile picture is updated automatically.
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
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
    const phoneNumber = await askQuestion(
      'Enter your WhatsApp number with country code, digits only (e.g. 947XXXXXXXX): '
    );
    try {
      const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
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
