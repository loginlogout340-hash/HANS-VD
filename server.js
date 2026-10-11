import express from "express";
import cors from "cors";
import fs from "fs";
import pino from "pino";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  Browsers,
  delay,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";

const app = express();
app.use(cors());
app.use(express.static("."));

async function start(num, dir, res) {
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("Chrome"),
  });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    console.log("connection:", connection);

    if (connection === "open") {
      try {
        await delay(3000);
        const creds = fs.readFileSync(`${dir}/creds.json`);
        const me = jidNormalizedUser(sock.user.id);
        await sock.sendMessage(me, {
          text: "SESSION:" + Buffer.from(creds).toString("base64"),
        });
        console.log("session sent");
        await delay(3000);
      } catch (e) {
        console.log("send error:", e.message);
      }
      sock.end();
      fs.rmSync(dir, { recursive: true, force: true });
    }

    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;
      console.log("closed, status:", status);
      if (status !== 401 && fs.existsSync(dir)) start(num, dir);
    }
  });

  if (res && !state.creds.registered) {
    await delay(1500);
    res.json({ code: await sock.requestPairingCode(num) });
    setTimeout(() => {
      sock.end();
      fs.rmSync(dir, { recursive: true, force: true });
    }, 180000);
  }
}

app.get("/pair", async (req, res) => {
  const num = String(req.query.number || "").replace(/\D/g, "");
  if (num.length < 8) return res.status(400).json({ error: "Invalid number" });
  try {
    await start(num, `./sessions/${num}-${Date.now()}`, res);
  } catch (e) {
    console.log("pair error:", e.message);
    res.status(500).json({ error: "Could not get code, try again" });
  }
});

app.listen(process.env.PORT || 3000);
