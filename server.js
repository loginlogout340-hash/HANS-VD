import express from "express";
import cors from "cors";
import fs from "fs";
import pino from "pino";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  Browsers,
  delay,
} from "@whiskeysockets/baileys";

const app = express();
app.use(cors());

async function start(num, dir, res) {
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("Chrome"),
  });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      const creds = fs.readFileSync(`${dir}/creds.json`);
      await sock.sendMessage(sock.user.id, {
        text: "SESSION:" + Buffer.from(creds).toString("base64"),
      });
      await delay(2000);
      sock.end();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;
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
    res.status(500).json({ error: "Could not get code, try again" });
  }
});

app.listen(process.env.PORT || 3000);
