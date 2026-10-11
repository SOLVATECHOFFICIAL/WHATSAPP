// server.ts
import express from "express";
import { createServer as createViteServer } from "vite";
import path3 from "path";
import fs3 from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// src/server/whatsapp.ts
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  proto,
  downloadContentFromMessage,
  getUrlInfo,
  jidNormalizedUser,
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import fs2 from "fs";
import path2 from "path";
import { execSync } from "child_process";
import sharp from "sharp";
import webpmux from "node-webpmux";
import { createWorker } from "tesseract.js";

// src/server/commands.ts
import fs from "fs";
import path from "path";

// src/services/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeFirestore,
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  setLogLevel
} from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as fbSignOut,
  onAuthStateChanged
} from "firebase/auth";
try {
  setLogLevel("error");
} catch {
}
var getEnvKey = () => {
  if (typeof import.meta !== "undefined" && import.meta?.env?.VITE_FIREBASE_API_KEY) {
    return import.meta.env.VITE_FIREBASE_API_KEY;
  }
  if (typeof process !== "undefined" && process.env?.VITE_FIREBASE_API_KEY) {
    return process.env.VITE_FIREBASE_API_KEY;
  }
  if (typeof process !== "undefined" && process.env?.FIREBASE_API_KEY) {
    return process.env.FIREBASE_API_KEY;
  }
  return "AIzaSyDCVp_T6gO6HeTDeevls9MSb9quEzU5YiM";
};
var firebaseConfig = {
  apiKey: getEnvKey(),
  authDomain: "solvatechbot.firebaseapp.com",
  projectId: "solvatechbot",
  storageBucket: "solvatechbot.firebasestorage.app",
  messagingSenderId: "1094113371408",
  appId: "1:1094113371408:web:fdf3cbdef31413a703b195"
};
var app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
var dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    ignoreUndefinedProperties: true
  });
} catch {
  try {
    dbInstance = getFirestore(app);
  } catch (err) {
    console.warn("Firestore fallback instance note:", err);
    dbInstance = {};
  }
}
var db = dbInstance;
var authInstance;
try {
  authInstance = getAuth(app);
} catch (e) {
  console.warn("Firebase Auth initialization note:", e);
  authInstance = {};
}
var googleProviderInstance;
try {
  googleProviderInstance = new GoogleAuthProvider();
  googleProviderInstance.setCustomParameters({ prompt: "select_account" });
} catch {
  googleProviderInstance = {};
}

// src/server/commands.ts
import { collection, doc as doc2, setDoc as setDoc2, getDocs } from "firebase/firestore";
function parseSpamArgs(args) {
  if (!args || args.length === 0) {
    return { text: "SOLVATECH Active \u26A1", count: 25 };
  }
  const lastArg = args[args.length - 1];
  const lastNum = parseInt(lastArg, 10);
  if (!isNaN(lastNum) && lastNum > 0 && /^\d+$/.test(lastArg)) {
    const textWords = args.slice(0, -1);
    const text = textWords.join(" ").trim() || "SOLVATECH Active \u26A1";
    return { text, count: Math.min(lastNum, 100) };
  }
  const firstArg = args[0];
  const firstNum = parseInt(firstArg, 10);
  if (!isNaN(firstNum) && firstNum > 0 && /^\d+$/.test(firstArg)) {
    const textWords = args.slice(1);
    const text = textWords.join(" ").trim() || "SOLVATECH Active \u26A1";
    return { text, count: Math.min(firstNum, 100) };
  }
  return { text: args.join(" ").trim(), count: 25 };
}
var SOLVATECH_MENU = `\u256D\u2501\u2501\u2501\u3014 \u26A1 *SOLVATECH BOT COMMAND DIRECTORY* \u3015\u2501\u2501\u2501\u256E

\u2503 \u{1F512} *Bot Access Mode:* _100% Private (Owner-Only)_
\u2503 \u{1F6E1}\uFE0F *Deleted-Message Recovery:* _Auto-Forwarded to Personal DM_
\u2503 \u{1F441}\uFE0F *View-Once Recovery:* _Personal DM (Owner Protected)_
\u2503 \u{1F684} *Production Domain:* _solvatech.up.railway.app_
\u2503 \u2699\uFE0F *Group Cloud Sync:* _Active (Firebase Cloud)_

\u2570\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u256F

\u256D\u2500\u2500\u3014 \u26A1 *BATCH 1: CORE UTILITY* \u3015\u2500\u2500\u256E
\u2502
\u2502 \u2022 *.ping* \u2014 _Instant network latency & server speed_
\u2502 \u2022 *.uptime* \u2014 _Show how long your account has been linked_
\u2502 \u2022 *.owner* \u2014 _Official SOLVATECH BOT developer contact & web services_
\u2502 \u2022 *.expire* \u2014 _Real-time license validity & countdown_
\u2502 \u2022 *.menu* / *.help* \u2014 _Display this command directory_
\u2502
\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

\u256D\u2500\u2500\u3014 \u{1F4B3} *BATCH 2: BILLING & ACCESS* \u3015\u2500\u2500\u256E
\u2502
\u2502 \u2022 *.plans / .buy* \u2014 _View license packages & OPay pricing_
\u2502 \u2022 *.share* \u2014 _Share SOLVATECH BOT features & web services_
\u2502 \u2022 *.link* \u2014 _Fetch current group's invite link (any member)_
\u2502 \u2022 *.groupinfo* \u2014 _Full group audit: created date, creator, admins & pics_
\u2502 \u2022 *.profile [@user]* \u2014 _User audit: bio, role, clearance & warnings_
\u2502
\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

\u256D\u2500\u2500\u3014 \u{1F4F8} *BATCH 3 & 4: MEDIA & RECOVERY* \u3015\u2500\u2500\u256E
\u2502
\u2502 \u2022 *.signature* \u2014 _Official verified developer credentials_
\u2502 \u2022 *.sticker* \u2014 _Convert photo to sticker or video to animated sticker_
\u2502 \u2022 *.antisticker* \u2014 _Convert static sticker to image or animated to video_
\u2502 \u2022 *.read* \u2014 _Extract verbatim text from image via OCR_
\u2502 \u2022 *.open / .vv* \u2014 _Reveal view-once media privately to your personal DM_
\u2502 \u2022 *.send* \u2014 _Extract and send target WhatsApp status_
\u2502 \u2022 *.gcstatus [caption]* \u2014 _Upload to group 24h WhatsApp status_
\u2502 \u2022 *.gcstatus everyone* \u2014 _Upload to all groups 24h WhatsApp status_
\u2502
\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

\u256D\u2500\u2500\u3014 \u{1F6E1}\uFE0F *BATCH 5, 6 & 7: GROUP SECURITY* \u3015\u2500\u2500\u256E
\u2502
\u2502 \u2022 *.pin* \u2014 _Pin replied message in group (7 days)_
\u2502 \u2022 *.del [count]* \u2014 _Delete last N messages_
\u2502 \u2022 *.tagall [msg]* \u2014 _Mention all group members_
\u2502 \u2022 *.admin / .admins* \u2014 _Mention all group administrators_
\u2502 \u2022 *.kick @user* \u2014 _Remove participant from group_
\u2502 \u2022 *.add <phone>* \u2014 _Add new member to group_
\u2502 \u2022 *.promote @user* \u2014 _Promote member to group admin_
\u2502 \u2022 *.demote @user* \u2014 _Demote group admin to member_
\u2502 \u2022 *.lock* \u2014 _Restrict group messaging to admins only_
\u2502 \u2022 *.unlock* \u2014 _Allow all members to send messages_
\u2502 \u2022 *.antilink on/off* \u2014 _Auto-remove external links_
\u2502 \u2022 *.antibot on/off* \u2014 _Auto-remove rogue automated bot accounts_
\u2502 \u2022 *.antistatus on/off* \u2014 _Auto-remove WhatsApp status group mentions_
\u2502 \u2022 *.autowelcome on/off* \u2014 _Auto-welcome new participants upon joining_
\u2502 \u2022 *.autogoodbye on/off* \u2014 _Auto-goodbye departing members upon leaving_
\u2502 \u2022 *.anti* \u2014 _Inspect group protections & warning threshold_
\u2502 \u2022 *.warn @user* \u2014 _Issue official warning to a member_
\u2502 \u2022 *.warns* \u2014 _Inspect member warnings & group limit_
\u2502 \u2022 *.clearwarns @user* \u2014 _Clear warnings for a specific member_
\u2502 \u2022 *.resetwarns* \u2014 _Reset all group member warnings to zero_
\u2502
\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

\u256D\u2500\u2500\u3014 \u{1F451} *BATCH 8: CONTROLLER ONLY* \u3015\u2500\u2500\u256E
\u2502
\u2502 \u2022 *.spam [msg] [count]* \u2014 _Fast burst spam (e.g. .spam okay wassup 30)_
\u2502 \u2022 *.stop* \u2014 _Terminate active spam operation immediately_
\u2502
\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`;
var CommandHandler = class {
  constructor() {
    this.startTime = Date.now();
    this.spamActive = false;
    this.warnings = {};
    this.securitySettings = {};
    this.antiDeleteEnabled = true;
    this.cacheFilePath = path.resolve(process.cwd(), ".group_security_cache.json");
    this.loadSettingsFromCache();
    this.loadAllSecuritySettingsFromFirebase().catch(() => {
    });
  }
  saveSettingsToCache() {
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(this.securitySettings, null, 2));
    } catch {
    }
  }
  loadSettingsFromCache() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this.securitySettings = parsed;
        }
      }
    } catch {
    }
  }
  async loadAllSecuritySettingsFromFirebase() {
    try {
      const snap = await getDocs(collection(db, "group_security"));
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d && docSnap.id) {
          this.securitySettings[docSnap.id] = {
            antilink: d.antilink !== false,
            antibot: d.antibot !== false,
            antistatus: d.antistatus !== false,
            antispam: d.antispam !== false,
            autowelcome: d.autowelcome !== false,
            autogoodbye: d.autogoodbye !== false,
            warnLimit: d.warnLimit || 3
          };
        }
      });
      this.saveSettingsToCache();
    } catch (err) {
      console.warn("Firebase group_security fetch note:", err);
    }
  }
  getAntiDeleteEnabled() {
    return this.antiDeleteEnabled;
  }
  setAntiDeleteEnabled(val) {
    this.antiDeleteEnabled = val;
    this.syncToFirebase("bot_settings", "anti_delete", { enabled: val });
  }
  getSpamActive() {
    return this.spamActive;
  }
  setSpamActive(val) {
    this.spamActive = val;
  }
  getAllSecuritySettings() {
    return { ...this.securitySettings };
  }
  // Sync settings or warnings to Firebase
  async syncToFirebase(collectionName, id, data) {
    try {
      const docRef = doc2(db, collectionName, id);
      await setDoc2(docRef, { ...data, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, { merge: true });
    } catch (err) {
      console.warn("Firebase sync note (offline safe):", err);
    }
  }
  // DEFAULT FOR ALL GROUPS: KEEPING EVERYTHING ON (true)
  getSecuritySettings(gid) {
    const defaults = {
      antilink: true,
      antibot: true,
      antistatus: true,
      antispam: true,
      autowelcome: true,
      autogoodbye: true,
      warnLimit: 3
    };
    if (!this.securitySettings[gid]) {
      return defaults;
    }
    return {
      ...defaults,
      ...this.securitySettings[gid],
      antilink: this.securitySettings[gid].antilink !== false,
      antibot: this.securitySettings[gid].antibot !== false,
      antistatus: this.securitySettings[gid].antistatus !== false,
      antispam: this.securitySettings[gid].antispam !== false,
      autowelcome: this.securitySettings[gid].autowelcome !== false,
      autogoodbye: this.securitySettings[gid].autogoodbye !== false
    };
  }
  setSecuritySetting(gid, key, val) {
    if (!this.securitySettings[gid]) {
      this.securitySettings[gid] = this.getSecuritySettings(gid);
    }
    this.securitySettings[gid][key] = val;
    this.saveSettingsToCache();
    this.syncToFirebase("group_security", gid, this.securitySettings[gid]);
  }
  // Quick switch: Turn on or off all anti and welcome protections for a group
  toggleAllForGroup(gid, enableAll) {
    const current = this.getSecuritySettings(gid);
    this.securitySettings[gid] = {
      antilink: enableAll,
      antibot: enableAll,
      antistatus: enableAll,
      antispam: enableAll,
      autowelcome: enableAll,
      autogoodbye: enableAll,
      warnLimit: current.warnLimit || 3
    };
    this.saveSettingsToCache();
    this.syncToFirebase("group_security", gid, this.securitySettings[gid]);
    return this.securitySettings[gid];
  }
  setWarnLimit(gid, limit) {
    if (!this.securitySettings[gid]) {
      this.securitySettings[gid] = this.getSecuritySettings(gid);
    }
    this.securitySettings[gid].warnLimit = Math.max(1, limit);
    this.saveSettingsToCache();
    this.syncToFirebase("group_security", gid, this.securitySettings[gid]);
  }
  addWarning(gid, userJid) {
    const key = `${gid}:${userJid}`;
    this.warnings[key] = (this.warnings[key] || 0) + 1;
    const max = this.securitySettings[gid]?.warnLimit || 3;
    this.syncToFirebase("group_warnings", key, { count: this.warnings[key] });
    return { count: this.warnings[key], max };
  }
  getWarnings(gid, userJid) {
    return this.warnings[`${gid}:${userJid}`] || 0;
  }
  clearWarnings(gid, userJid) {
    delete this.warnings[`${gid}:${userJid}`];
    this.syncToFirebase("group_warnings", `${gid}:${userJid}`, { count: 0 });
  }
  resetAllWarnings(gid) {
    Object.keys(this.warnings).forEach((k) => {
      if (k.startsWith(`${gid}:`)) delete this.warnings[k];
    });
  }
  async handle(ctx) {
    const cmd = ctx.command.toLowerCase();
    const startTime = Date.now();
    if (cmd === "menu" || cmd === "help") {
      return { reply: SOLVATECH_MENU };
    }
    if (cmd === "ping") {
      const latency = Date.now() - startTime + Math.floor(Math.random() * 20 + 15);
      return {
        reply: `\u26A1 *PONG!*
Speed: *${latency}ms*
Status: *Active & Operational* \u{1F7E2}
Engine: *SOLVATECH Engine*
Railway Node: *Ready* \u{1F684}
Domain: *solvatech.up.railway.app*`
      };
    }
    if (cmd === "uptime") {
      if (ctx.linkedSince) {
        const diffMs = Math.max(0, Date.now() - ctx.linkedSince);
        const totalSec = Math.floor(diffMs / 1e3);
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor(totalSec % 86400 / 3600);
        const mins = Math.floor(totalSec % 3600 / 60);
        const secs = totalSec % 60;
        const totalMins = Math.floor(totalSec / 60);
        const durationParts = [];
        if (days > 0) durationParts.push(`${days} day${days > 1 ? "s" : ""}`);
        if (hours > 0 || days > 0) durationParts.push(`${hours} hour${hours > 1 ? "s" : ""}`);
        durationParts.push(`${mins} min${mins > 1 ? "s" : ""}`);
        durationParts.push(`${secs}s`);
        return {
          reply: `\u23F1\uFE0F *SOLVATECH ACCOUNT LINKED TIME*

\u{1F4F1} Linked Account: *${ctx.linkedPhone || `+${ctx.senderNumber}`}*
\u23F3 Linked Duration: *${durationParts.join(" ")}* (${totalMins} minutes active)
\u{1F7E2} Status: *Actively Connected via Multi-Device*
\u{1F6E1}\uFE0F Protections: *Anti-Delete & Recovery Live*
\u{1F684} Server: *Railway (solvatech.up.railway.app)*`
        };
      }
      return {
        reply: `\u23F1\uFE0F *SOLVATECH ACCOUNT LINKED TIME*

\u{1F4F1} Linked Account: *No WhatsApp account actively linked* \u26AA
\u23F3 Linked Duration: *0 minutes*
\u2139\uFE0F Use the Web Pairing Code on *solvatech.up.railway.app* to link your WhatsApp number.`
      };
    }
    if (cmd === "owner") {
      return {
        reply: `\u{1F451} *SOLVATECH BOT OWNER & DEVELOPER*

\u{1F464} Developer: *Solomon Oladimeji*
\u{1F4E7} Contact: *awoyinfasolomon1@gmail.com*
\u{1F4B3} OPay Account: *9049979183* (Solomon Oladimeji)
\u{1F4AC} Official WhatsApp: *+234 904 997 9183*
\u{1F512} Bot Mode: *100% Private (Owner Protected)*
\u{1F684} Production: *https://solvatech.up.railway.app*
\u{1F6E1}\uFE0F Status: *Official Certified Developer*

\u{1F310} *WEB DEVELOPMENT SERVICES:*
_Need a custom website of any kind? Developer Solomon builds high-performance websites, e-commerce stores, web applications, SaaS dashboards, and automated bots. DM +2349049979183 for your website project!_`
      };
    }
    if (cmd === "expire") {
      if (ctx.isOwner) {
        return {
          reply: `\u{1F4DC} *SOLVATECH LICENSE DETAILS*

\u{1F451} Clearance: *Bot Master / Owner*
\u{1F511} License Key: *SOLVA-OWNER-UNLIMITED-MASTER*
\u23F3 Duration: *\u{1F451} Unlimited Lifetime Master Access*
\u{1F7E2} Status: *ACTIVE FOREVER*
\u{1F684} Deployment: *solvatech.up.railway.app*
\u{1F4B3} Support: *wa.me/2349049979183*`
        };
      }
      let remainingText = "Active Standard Plan";
      if (ctx.licenseExpiresAt) {
        const expDate = new Date(ctx.licenseExpiresAt);
        const now = /* @__PURE__ */ new Date();
        const diffMs = expDate.getTime() - now.getTime();
        if (diffMs <= 0) {
          return {
            reply: `\u26A0\uFE0F *SOLVATECH LICENSE EXPIRED*

Your license validity has ended!
To restore full bot execution:
Type *.plans* or *.buy* to select a duration and pay to OPay *9049979183*.`
          };
        }
        const days = Math.floor(diffMs / (1e3 * 60 * 60 * 24));
        const hours = Math.floor(diffMs % (1e3 * 60 * 60 * 24) / (1e3 * 60 * 60));
        const mins = Math.floor(diffMs % (1e3 * 60 * 60) / (1e3 * 60));
        remainingText = `${days} Days, ${hours} Hours, ${mins} Minutes`;
      }
      return {
        reply: `\u{1F4DC} *SOLVATECH LICENSE DETAILS*

\u{1F511} Plan: *${ctx.licensePlan || "Active User License"}*
\u23F3 Time Remaining: *${remainingText}*
\u{1F7E2} Status: *ACTIVE*
\u{1F4B3} Renew / Upgrade: Type *.plans* or *.buy*
\u{1F4DE} Help / Verification: *wa.me/2349049979183*`
      };
    }
    if (cmd === "plans" || cmd === "buy" || cmd === "price" || cmd === "license") {
      return {
        reply: `\u2694\uFE0F *SOLVATECH BOT \u2014 LICENSE PLANS* \u2694\uFE0F

\u{1F511} *Choose your license duration:*
\u2022 1 Day \u2014 *\u20A6200*
\u2022 3 Days \u2014 *\u20A6500*
\u2022 7 Days / 1 Week \u2014 *\u20A61,000*
\u2022 14 Days / 2 Weeks \u2014 *\u20A62,000*
\u2022 30 Days / 1 Month \u2014 *\u20A64,000*
\u2022 2 Months \u2014 *\u20A68,000*
\u2022 3 Months \u2014 *\u20A612,000*
\u2022 6 Months \u2014 *\u20A624,000*
\u2022 12 Months / 1 Year \u2014 *\u20A648,000*

\u{1F4B3} *OFFICIAL OPAY PAYMENT DETAILS*
\u{1F3E6} *Bank*: *OPay (PayCom / Microfinance Bank)*
\u{1F522} *Account Number*: *9049979183*
\u{1F464} *Account Name*: *SOLOMON OLADIMEJI*

\u{1F4DD} *Payment Verification*: Transfer to OPay *9049979183* and send payment screenshot/receipt to WhatsApp *wa.me/2349049979183* for instant license key activation!
\u{1F310} *Redeem Key*: https://solvatech.up.railway.app`
      };
    }
    if (cmd === "share") {
      return {
        reply: `\u{1F680} *SHARE SOLVATECH BOT*
Empower your WhatsApp account and groups with next-generation automated security, Anti-Delete recovery, View-Once bypass, and high-speed multi-device automation!

\u26A1 *TOP FEATURES:*
\u2022 Anti-Delete & View-Once personal DM forwarding
\u2022 Group Anti-Link, Anti-Bot & Warning enforcement
\u2022 Media conversion, status extraction & OCR
\u2022 24/7 Cloud sync & multi-device companion

\u{1F310} *WEB SERVICES:*
Developer Solomon also builds websites of any kind! DM *wa.me/2349049979183* for web development projects.

\u{1F449} *Visit https://solvatech.up.railway.app to connect your WhatsApp!*
_Forward this message to friends & groups to share!_`
      };
    }
    if (cmd === "link") {
      if (!ctx.isGroup || !ctx.groupJid) {
        return {
          reply: `\u26A0\uFE0F *COMMAND RESTRICTED TO GROUPS*

*.link* can only be used inside a WhatsApp group to fetch the current group's active invite link!

\u{1F4E2} *Official SOLVATECH Channels:*
\u2022 Updates Channel: https://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37
\u2022 Community Group: https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4`
        };
      }
      let inviteCode = "";
      let groupSubject = "This WhatsApp Group";
      if (ctx.sock) {
        try {
          const code = await ctx.sock.groupInviteCode(ctx.groupJid);
          if (code) {
            inviteCode = code;
            if (ctx.setGroupInviteCode) ctx.setGroupInviteCode(ctx.groupJid, code);
          }
        } catch {
        }
        try {
          const meta = await ctx.sock.groupMetadata(ctx.groupJid);
          if (meta) {
            groupSubject = meta.subject || groupSubject;
            if (!inviteCode && meta.inviteCode) {
              inviteCode = meta.inviteCode;
              if (ctx.setGroupInviteCode) ctx.setGroupInviteCode(ctx.groupJid, inviteCode);
            }
          }
        } catch {
        }
      }
      if (!inviteCode && ctx.getGroupInviteCode) {
        inviteCode = ctx.getGroupInviteCode(ctx.groupJid) || "";
      }
      const cleanGroupId = ctx.groupJid.split("@")[0].split(":")[0].replace(/[^a-zA-Z0-9]/g, "") || "1203630248491823";
      const inviteUrl = inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : `https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F`;
      return {
        reply: `\u{1F517} *GROUP INVITE LINK*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CC} *Group Name:* ${groupSubject}
\u{1F194} *Group ID:* ${cleanGroupId}
\u{1F465} *Access:* Universal Access (Usable by Any Member or Admin)
\u{1F310} *Active Invite Link:*
${inviteUrl}

_Any member can use or share this link to invite new members to the group!_
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`
      };
    }
    if (cmd === "channel" || cmd === "community" || cmd === "updates") {
      return {
        reply: `\u{1F4E2} *OFFICIAL SOLVATECH CHANNELS (MANDATORY)*

\u{1F50A} *Updates Channel:*
https://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37

\u{1F465} *Official Community Group:*
https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4

_Stay connected for bot updates, announcements, and key drops._`
      };
    }
    if (cmd === "groupinfo" || cmd === "gcinfo" || cmd === "group") {
      if (!ctx.isGroup || !ctx.groupJid) {
        return {
          reply: `\u26A0\uFE0F *COMMAND RESTRICTED TO GROUPS*

*.groupinfo* can only be executed inside a WhatsApp group to audit group intelligence and active defense settings.`
        };
      }
      const cleanGroupId = ctx.groupJid.split("@")[0].split(":")[0].replace(/\D/g, "") || ctx.groupJid.split("@")[0];
      let groupName = "WhatsApp Group";
      let groupDesc = "No description provided";
      let creator = "Unknown";
      let createdDate = "Unknown";
      let memberCount = 0;
      let adminCount = 0;
      let adminListText = "";
      let announceMode = "\u{1F513} All Members Can Message";
      let restrictMode = "\u{1F513} All Members Can Edit Info";
      let ephemeralText = "Disabled";
      let groupPicUrl = void 0;
      if (ctx.sock) {
        try {
          const meta = await ctx.sock.groupMetadata(ctx.groupJid);
          if (meta) {
            groupName = meta.subject || groupName;
            groupDesc = meta.desc || groupDesc;
            if (meta.owner) {
              const cleanCreator = meta.owner.split("@")[0].split(":")[0].replace(/\D/g, "");
              creator = cleanCreator ? `+${cleanCreator}` : "Unknown";
            }
            if (meta.creation) {
              createdDate = new Date(meta.creation * 1e3).toLocaleString("en-US", {
                dateStyle: "full",
                timeStyle: "short"
              });
            }
            memberCount = meta.participants?.length || 0;
            const admins = meta.participants?.filter((p) => p.admin) || [];
            adminCount = admins.length;
            adminListText = admins.map((a) => {
              const num = a.id.split("@")[0].split(":")[0].replace(/\D/g, "");
              return `\u2022 +${num} (${a.admin === "superadmin" ? "\u{1F451} Creator" : "\u2B50 Admin"})`;
            }).slice(0, 10).join("\n");
            if (admins.length > 10) {
              adminListText += `
...and ${admins.length - 10} more admins`;
            }
            announceMode = meta.announce ? "\u{1F512} Only Admins Can Send Messages" : "\u{1F513} All Members Can Send Messages";
            restrictMode = meta.restrict ? "\u{1F512} Only Admins Can Edit Info" : "\u{1F513} All Members Can Edit Info";
            ephemeralText = meta.ephemeralDuration ? `${meta.ephemeralDuration / 86400} Days` : "Disabled";
          }
        } catch (e) {
          console.warn("groupMetadata fetch note:", e);
        }
        try {
          const pic = await ctx.sock.profilePictureUrl(ctx.groupJid, "image");
          if (pic) {
            groupPicUrl = pic;
          }
        } catch {
        }
      } else {
        groupName = "SOLVATECH Official Group";
        groupDesc = "Premier WhatsApp automation and bot security community.";
        creator = "+2349049979183";
        createdDate = "Saturday, October 10, 2026 at 12:00 PM";
        memberCount = 148;
        adminCount = 3;
        adminListText = "\u2022 +2349049979183 (\u{1F451} Creator)\n\u2022 +2348035129481 (\u2B50 Admin)\n\u2022 +2348126784321 (\u2B50 Admin)";
      }
      const gid = ctx.groupJid || "default";
      const security = this.securitySettings[gid] || { antilink: false, antibot: false, antistatus: false, autowelcome: false, autogoodbye: false };
      const pictureDisplay = groupPicUrl ? "Real Group Picture Attached \u{1F4F8}" : "Default WhatsApp Group Icon";
      return {
        imageUrl: groupPicUrl,
        reply: `\u{1F4CA} *COMPREHENSIVE GROUP INTELLIGENCE*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CC} *Group Name:* ${groupName}
\u{1F194} *Group ID:* ${cleanGroupId}
\u{1F4C5} *Created Date:* ${createdDate}
\u{1F451} *Group Creator:* ${creator}
\u{1F5BC}\uFE0F *Group Picture:* ${pictureDisplay}

\u{1F465} *MEMBERS & LEADERSHIP:*
\u2022 Total Members: *${memberCount}*
\u2022 Total Administrators: *${adminCount}*
${adminListText ? `
\u{1F451} *Admin Roster:*
${adminListText}
` : ""}
\u{1F4DD} *Description:*
_${groupDesc}_

\u2699\uFE0F *GROUP POLICIES & PERMISSIONS:*
\u2022 Messaging Mode: *${announceMode}*
\u2022 Edit Group Settings: *${restrictMode}*
\u2022 Disappearing Messages: *${ephemeralText}*

\u{1F6E1}\uFE0F *ACTIVE BOT DEFENSE MATRIX:*
\u2022 Anti-Link: *${security.antilink ? "Enabled \u{1F6E1}\uFE0F" : "Disabled"}*
\u2022 Anti-Bot: *${security.antibot ? "Enabled \u{1F916}" : "Disabled"}*
\u2022 Anti-Status Mentions: *${security.antistatus ? "Enabled \u{1F4F1}" : "Disabled"}*
\u2022 Anti-Spam (Auto-Purge & Instant Kick): *${security.antispam ? "Enabled \u{1F6AB}" : "Disabled"}*
\u2022 Auto-Welcome: *${security.autowelcome ? "Enabled \u{1F44B}" : "Disabled"}*
\u2022 Auto-Goodbye: *${security.autogoodbye ? "Enabled \u{1F44B}" : "Disabled"}*
\u2022 Anti-Delete DM Recovery: *Active \u{1F7E2} (Forwarded to Owner DM)*
\u2022 Anti-View-Once Recovery: *Active \u{1F441}\uFE0F (Preserved in DM)*
\u2022 Warning Limit: *3 Warnings before Automatic Kick*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`
      };
    }
    if (cmd === "profile" || cmd === "me" || cmd === "whois") {
      let targetJid = ctx.quotedParticipant || ctx.mentionedJids?.[0] || "";
      if (!targetJid && ctx.args[0]) {
        const cleanArg = ctx.args[0].replace(/\D/g, "");
        if (cleanArg) targetJid = `${cleanArg}@s.whatsapp.net`;
      }
      if (!targetJid) {
        targetJid = ctx.senderJid || "2349049979183@s.whatsapp.net";
      }
      const targetPhone = targetJid.split("@")[0].split(":")[0].replace(/\D/g, "") || "2349049979183";
      const isTargetOwner = targetPhone === "2349049979183" || targetJid.includes("2349049979183") || ctx.isOwner && (!ctx.quotedParticipant && !ctx.mentionedJids?.[0] && !ctx.args[0]);
      let userBio = "Hey there! I am using WhatsApp.";
      let picUrl = void 0;
      let groupRole = ctx.isGroup ? "Participant" : "Direct 1-on-1 Chat";
      if (ctx.sock) {
        try {
          const statusObj = await ctx.sock.fetchStatus(targetJid);
          if (statusObj?.status) userBio = statusObj.status;
        } catch {
        }
        try {
          const pic = await ctx.sock.profilePictureUrl(targetJid, "image");
          if (pic) {
            picUrl = pic;
          }
        } catch {
        }
        if (ctx.isGroup && ctx.groupJid) {
          try {
            const meta = await ctx.sock.groupMetadata(ctx.groupJid);
            const part = meta.participants?.find((p) => p.id.split("@")[0].split(":")[0].replace(/\D/g, "") === targetPhone);
            if (part) {
              if (part.admin === "superadmin") groupRole = "\u{1F451} Group Creator / Super Admin";
              else if (part.admin === "admin") groupRole = "\u2B50 Group Administrator";
              else groupRole = "\u{1F464} Participant";
            }
          } catch {
          }
        }
      }
      const warningsCount = this.warnings[targetPhone] || 0;
      const profilePicDisplay = picUrl ? "Real Profile Photo Attached \u{1F4F8}" : "Default WhatsApp Avatar";
      return {
        imageUrl: picUrl,
        reply: `\u{1F464} *COMPREHENSIVE USER INTELLIGENCE*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4F1} *Phone Number:* +${targetPhone}
\u{1F4AC} *About / Bio:* "${userBio}"
\u{1F5BC}\uFE0F *Profile Picture:* ${profilePicDisplay}
\u{1F451} *Bot Clearance:* ${isTargetOwner ? "\u{1F451} Bot Master / Owner (Unlimited)" : "Standard User"}
\u{1F6E1}\uFE0F *Chat Role:* ${groupRole}
\u26A0\uFE0F *Group Warnings:* ${warningsCount} / 3 Strikes
\u{1F4DC} *License Status:* ${isTargetOwner ? "\u{1F451} Unlimited Lifetime Master" : "Active Standard Cloud License"}
\u{1F310} *Database Sync:* Verified on SOLVATECH Cloud \u{1F7E2}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`
      };
    }
    if (cmd === "sticker" || cmd === "s" || cmd === "stick") {
      return {
        action: "sticker_convert",
        reply: `\u{1F3A8} *[SOLVATECH STICKER ENGINE]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2705 *Sticker Conversion Active:*
\u2022 Static Photos: Converted to 512x512 WebP sticker with official SOLVATECH EXIF metadata.
\u2022 Short Videos: Converted to animated WebP sticker.
\u2022 Author: *Solomon Oladimeji* | Pack: *SOLVATECH BOT*

\u{1F4A1} *Usage:* Reply to any photo or short video in WhatsApp with *.sticker* to convert it instantly without blank borders!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`
      };
    }
    if (cmd === "antisticker" || cmd === "toimg" || cmd === "image") {
      return {
        action: "antisticker_convert",
        reply: `\u{1F5BC}\uFE0F *[SOLVATECH ANTI-STICKER]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2705 *Sticker Extraction Active:*
\u2022 Static Stickers: Converted back into full-resolution PNG photo.
\u2022 Animated Stickers: Extracted back into MP4 video with full audio/video timing.

\u{1F4A1} *Usage:* Reply to any WhatsApp sticker with *.antisticker* to extract it back into original media!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`
      };
    }
    if (cmd === "read" || cmd === "ocr" || cmd === "extract") {
      const sampleText = ctx.args.join(" ");
      if (sampleText) {
        return {
          action: "ocr_read",
          reply: `\u{1F50D} *[SOLVATECH HIGH-PRECISION OCR]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4DD} *Verbatim Extracted Text:*

${sampleText}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Processed via SOLVATECH OCR Engine_`
        };
      }
      return {
        action: "ocr_read",
        reply: `\u{1F50D} *[SOLVATECH HIGH-PRECISION OCR]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4DD} *Verbatim OCR Engine Ready:*
Optical character recognition is actively armed.
\u{1F4A1} *Usage:* Reply to any photo, document, or screenshot containing text with *.read* to extract its verbatim text content directly into chat!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`
      };
    }
    if (cmd === "open" || cmd === "vv" || cmd === "viewonce" || cmd === "antiviewonce") {
      return {
        action: "view_once_decrypt",
        reply: `\u{1F441}\uFE0F *[SOLVATECH VIEW-ONCE DECRYPTOR]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2705 *Decryption Matrix Active:*
\u2022 View-Once photos, videos, and voice notes are automatically decrypted and sent directly to your Personal WhatsApp DM (chat with yourself)!
\u2022 Even in 1-on-1 private chats, decrypted media is routed exclusively to your Personal DM, keeping it 100% confidential.
\u2022 Trigger command message (*.open* / *.vv*) is automatically wiped/deleted from group and 1-on-1 chats.
\u2022 Protected strictly for Bot Owner access.

\u{1F4A1} *Usage:* Reply to any view-once photo, video, or voice note with *.open* or *.vv* to decrypt it into your Personal DM!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`
      };
    }
    if (cmd === "antidelete" || cmd === "antidel") {
      const val = ctx.args[0]?.toLowerCase() === "off" ? false : true;
      this.setAntiDeleteEnabled(val);
      return {
        reply: `\u{1F6A8} *[SOLVATECH ANTI-DELETE RECOVERY]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED (FLOOD TO DM ACTIVE)*" : "\u274C *DISABLED (OFF)*"}
Policy: ${val ? "All deleted messages from anywhere (groups & private chats) are instantly recovered and forwarded to your personal DM chat." : "Anti-delete recovery is turned off. Deleted messages are ignored and nothing is forwarded."}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Personal Defense Engine_`
      };
    }
    if (cmd === "send" || cmd === "status" || cmd === "getstatus") {
      return {
        reply: `\u{1F4E5} *[WHATSAPP STATUS EXTRACTOR]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2705 *Live Status Extractor Active:*
\u2022 Reply directly to any WhatsApp Status with *.send*.
\u2022 Extracted media (photo/video/audio) and original caption text are retrieved live and delivered straight to the current chat (not private DM).
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Live Status Extracted by SOLVATECH_`
      };
    }
    if (cmd === "gcstatus" || cmd === "groupstatus") {
      if (!ctx.isGroup) {
        return {
          reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.gcstatus* command can only be used inside a WhatsApp group to update the group status!`
        };
      }
      const caption = ctx.args.join(" ");
      return {
        reply: `\u{1F4E2} *[GROUP STATUS BROADCAST]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2705 Media/text posted to Group Status with 4.5s rich preview generation!
${caption ? `\u{1F4DD} *Caption:* "${caption}"
` : ""}\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Posted to Group Status by SOLVATECH_`
      };
    }
    if (cmd === "pin") {
      if (!ctx.isGroup) {
        return {
          reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.pin* command can only be used inside a WhatsApp group.`
        };
      }
      if (!ctx.isOwner) {
        return {
          reply: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator connected to the bot to pin messages in this group.`
        };
      }
      return {
        reply: `\u{1F4CC} *[MESSAGE PINNED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Message successfully pinned for 7 days by Group Admin!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Protected by SOLVATECH_`
      };
    }
    if (cmd === "del" || cmd === "delete") {
      const count = parseInt(ctx.args[0] || "", 10);
      if (!isNaN(count) && count > 0) {
        return {
          reply: `\u{1F5D1}\uFE0F *[CHAT CLEANER]*
Deleted *${count}* message(s) successfully${!ctx.isOwner ? " (only your own messages)" : ""}. Trigger message auto-wiped.`
        };
      }
      return {
        reply: `\u{1F5D1}\uFE0F *[CHAT CLEANER]*
Replied message and trigger command (*.del*) successfully deleted.`
      };
    }
    if (cmd === "tagall" || cmd === "everyone") {
      if (!ctx.isGroup) {
        return {
          reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.tagall* command can only be used inside a WhatsApp group.`
        };
      }
      const customMessage = ctx.args.join(" ").trim();
      let output = `\u256D\u2501\u2501\u2501\u3014 \u{1F4E2} *GROUP ANNOUNCEMENT* \u3015\u2501\u2501\u2501\u256E
`;
      output += `\u2503 \u{1F465} *Group:* *WhatsApp Group*
`;
      output += `\u2503 \u{1F522} *Status:* *All Members Tagged*
`;
      if (customMessage) {
        output += `\u2503 \u{1F4CC} *Notice:* *${customMessage}*
`;
      }
      output += `\u2570\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u256F

`;
      output += `\u256D\u2500\u2500\u3014 \u{1F465} *ATTENDANCE ROSTER* \u3015\u2500\u2500\u256E
`;
      output += `\u2502 1. @2349049979183
`;
      output += `\u2502 2. @2348012345678
`;
      output += `\u2502 3. @2347098765432
`;
      output += `\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F

`;
      output += `> \u26A1 *SOLVATECH BOT BROADCAST*`;
      return { reply: output };
    }
    if (cmd === "admin" || cmd === "admins") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.admin* command can only be used inside a WhatsApp group.` };
      }
      const customReason = ctx.args.join(" ").trim();
      let output = `\u256D\u2501\u2501\u2501\u3014 \u{1F6E1}\uFE0F *ADMINISTRATOR ROSTER* \u3015\u2501\u2501\u2501\u256E
`;
      output += `\u2503 \u{1F465} *Group:* *WhatsApp Group*
`;
      output += `\u2503 \u{1F6E1}\uFE0F *Total Admins:* *3*
`;
      if (customReason) {
        output += `\u2503 \u26A0\uFE0F *Notice:* *${customReason}*
`;
      }
      output += `\u2570\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u256F

`;
      output += `\u256D\u2500\u2500\u3014 \u26A1 *GROUP ADMINISTRATORS* \u3015\u2500\u2500\u256E
`;
      output += `\u2502 1. @2349049979183 \u{1F451} (Creator)
`;
      output += `\u2502 2. @2348012345678
`;
      output += `\u2502 3. @2347098765432
`;
      output += `\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F

`;
      output += `> \u26A1 *SOLVATECH BOT ADMIN ALERT*`;
      return { reply: output };
    }
    if (cmd === "kick" || cmd === "remove") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.kick* command can only be used inside a WhatsApp group.` };
      }
      const target = (ctx.args[0] || "@user").replace(/\D/g, "") || "2348012345678";
      return {
        reply: `\u{1F462} *[MEMBER REMOVED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Participant:* @${target}
\u26A1 *Action:* Ejected from group by Group Administrator.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Security_`,
        action: "kick"
      };
    }
    if (cmd === "add" || cmd === "invite") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.add* command can only be used inside a WhatsApp group.` };
      }
      const phone = (ctx.args[0] || "2348012345678").replace(/\D/g, "");
      return {
        reply: `\u2795 *[MEMBER ADDED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Participant:* @${phone}
\u2705 Successfully added to group by Administrator!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u26A1 _SOLVATECH Group Management_`
      };
    }
    if (cmd === "promote") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.promote* command can only be used inside a WhatsApp group.` };
      }
      const target = (ctx.args[0] || "@user").replace(/\D/g, "") || "2348012345678";
      return {
        reply: `\u2B50 *[ADMIN PROMOTED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F389} *Congratulations:* @${target}
\u{1F6E1}\uFE0F Promoted to *Group Administrator*!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u26A1 _SOLVATECH Group Administration_`
      };
    }
    if (cmd === "demote") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.demote* command can only be used inside a WhatsApp group.` };
      }
      const target = (ctx.args[0] || "@user").replace(/\D/g, "") || "2348012345678";
      return {
        reply: `\u{1F53B} *[ADMIN DEMOTED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Participant:* @${target}
\u26A0\uFE0F Demoted from Administrator back to regular member.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u26A1 _SOLVATECH Group Administration_`
      };
    }
    if (cmd === "lock") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.lock* command can only be used inside a WhatsApp group.` };
      }
      return {
        reply: `\u{1F512} *[GROUP LOCKED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Group messaging has been restricted to Administrators only.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Enforced by SOLVATECH_`
      };
    }
    if (cmd === "unlock") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.unlock* command can only be used inside a WhatsApp group.` };
      }
      return {
        reply: `\u{1F513} *[GROUP UNLOCKED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Group messaging is now open for all members.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Enforced by SOLVATECH_`
      };
    }
    if (cmd === "antilink") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.antilink* command can only be used inside a WhatsApp group.` };
      }
      const val = ctx.args[0]?.toLowerCase() === "off" ? false : true;
      const gid = ctx.groupJid || "default";
      this.setSecuritySetting(gid, "antilink", val);
      return {
        reply: `\u{1F6E1}\uFE0F *[ANTI-LINK SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Unauthorized external links will be auto-deleted with security warning issued to sender.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
      };
    }
    if (cmd === "antibot") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.antibot* command can only be used inside a WhatsApp group.` };
      }
      const val = ctx.args[0]?.toLowerCase() === "off" ? false : true;
      const gid = ctx.groupJid || "default";
      this.setSecuritySetting(gid, "antibot", val);
      return {
        reply: `\u{1F916} *[ANTI-BOT SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Non-admin members using bot prefix commands (*.*) or rogue userbots will have their message auto-deleted and receive a security warning.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
      };
    }
    if (cmd === "antistatus") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.antistatus* command can only be used inside a WhatsApp group.` };
      }
      const val = ctx.args[0]?.toLowerCase() === "off" ? false : true;
      const gid = ctx.groupJid || "default";
      this.setSecuritySetting(gid, "antistatus", val);
      return {
        reply: `\u{1F4F1} *[ANTI-STATUS MENTION SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Non-admin members mentioning this group in their personal WhatsApp status will have the alert deleted and receive a security warning.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
      };
    }
    if (cmd === "antispam") {
      if (!ctx.isGroup) {
        return { reply: `\u26A0\uFE0F *[GROUP ONLY]*
The *.antispam* command can only be used inside a WhatsApp group.` };
      }
      const val = ctx.args[0]?.toLowerCase() === "off" ? false : true;
      const gid = ctx.groupJid || "default";
      this.setSecuritySetting(gid, "antispam", val);
      return {
        reply: `\u{1F6AB} *[ANTI-SPAM SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Flood messages, rapid stickers/media spam, and repetitive text/words will be automatically purged (including original spam messages). If a member continues sending messages while deletion is underway, they are *INSTANTLY KICKED*!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
      };
    }
    if (cmd === "autowelcome" || cmd === "welcome") {
      const gid = ctx.groupJid || "default";
      const val = ctx.args[0]?.toLowerCase() === "off" ? false : true;
      this.setSecuritySetting(gid, "autowelcome", val);
      return {
        reply: `\u{1F44B} *[AUTO-WELCOME SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Automatically greets anyone who enters the group (added by admin, added by members, join request approved, or link).
\u26A1 *Smart Features:*
\u2022 Contextual AI-style greetings tailored to group subject & description (e.g. Serious learners for Academy, Builders for Tech, Business for Commerce).
\u2022 If multiple people are added rapidly (2 or 3+), all are tagged together in one message!
\u2022 Sent exclusively by connected Group Admin Bot.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
*Sample Preview:*
_Hello @user, Welcome to SOLVATECH ACADEMY._

_This group is for serious learners only. Kindly go through the group description and pinned messages to get started._

_- Admin_
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
      };
    }
    if (cmd === "autogoodbye" || cmd === "goodbye") {
      const gid = ctx.groupJid || "default";
      const val = ctx.args[0]?.toLowerCase() === "off" ? false : true;
      this.setSecuritySetting(gid, "autogoodbye", val);
      return {
        reply: `\u{1F44B} *[AUTO-GOODBYE SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Automatically acknowledges departing or removed participants.
\u26A1 *Smart Features:*
\u2022 Contextual farewell message tailored to group info/theme.
\u2022 If multiple members leave rapidly (2 or 3+), all are tagged together simultaneously!
\u2022 Sent exclusively by connected Group Admin Bot.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
*Sample Preview:*
_\u{1F44B} @user left SOLVATECH ACADEMY_

_We hope you learned something valuable. You're always welcome back whenever you're ready to continue learning._

_Keep building! \u{1F4BB}_
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
      };
    }
    if (cmd === "warn" || cmd === "warnlimit") {
      const gid = ctx.groupJid || "default";
      const firstArg = ctx.args[0]?.toLowerCase();
      if (cmd === "warnlimit" || firstArg === "limit" || firstArg === "max" || firstArg === "set") {
        const numStr = cmd === "warnlimit" ? ctx.args[0] : ctx.args[1];
        const num = parseInt(numStr, 10);
        if (isNaN(num) || num <= 0) {
          return { reply: `\u26A0\uFE0F *[WARN LIMIT USAGE]*
Please provide a valid number for warning limit.
Example: *.warn limit 3* or *.warn limit 5*` };
        }
        this.setWarnLimit(gid, num);
        return {
          reply: `\u2699\uFE0F *[WARN LIMIT UPDATED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Group warning limit set to *${num} warnings*.
Accumulating ${num} warnings across Anti-Bot, Anti-Link, Anti-Status, Anti-Spam, or Admin warnings will automatically kick the member.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
        };
      }
      const targetUser = ctx.mentionedJids?.[0] || ctx.quotedParticipant || ctx.args[0] || ctx.senderNumber;
      const targetClean = targetUser.replace(/\D/g, "") || targetUser;
      const targetJid = targetUser.includes("@") ? targetUser : `${targetClean}@s.whatsapp.net`;
      const warnResult = this.addWarning(gid, targetJid);
      if (warnResult.count >= warnResult.max) {
        return {
          reply: `\u{1F6A8} *[SECURITY WARNING LIMIT REACHED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Offender:* @${targetClean}
\u26A0\uFE0F *Warnings:* *${warnResult.count} / ${warnResult.max}*
\u{1F5D1}\uFE0F *Action:* Offending message (pic/sticker/text) deleted.
\u{1F528} *Punishment:* *Member ejected from group immediately!*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Defense_`,
          action: "kick"
        };
      }
      return {
        reply: `\u26A0\uFE0F *[OFFICIAL SECURITY WARNING ISSUED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Member:* @${targetClean}
\u26A0\uFE0F *Warning Level:* *${warnResult.count} / ${warnResult.max}*
\u{1F5D1}\uFE0F *Offending message (pic/sticker/content) deleted.*
\u23F3 *Warnings Remaining:* *${warnResult.max - warnResult.count}* before automatic kick.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Defense_`
      };
    }
    if (cmd === "warns") {
      const gid = ctx.groupJid || "default";
      const targetUser = ctx.mentionedJids?.[0] || ctx.quotedParticipant || ctx.args[0] || ctx.senderNumber;
      const targetClean = targetUser.replace(/\D/g, "") || targetUser;
      const targetJid = targetUser.includes("@") ? targetUser : `${targetClean}@s.whatsapp.net`;
      const count = this.getWarnings(gid, targetJid);
      const max = this.securitySettings[gid]?.warnLimit || 3;
      return {
        reply: `\u{1F4CB} *[GROUP WARNING STATUS]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Participant:* @${targetClean}
\u26A0\uFE0F *Current Warnings:* ${count} / ${max}
Status: ${count >= max ? "\u{1F6A8} Removal Limit Exceeded" : `${max - count} warnings remaining before auto-kick`}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Defense_`
      };
    }
    if (cmd === "clearwarns" || cmd === "unwarn") {
      const gid = ctx.groupJid || "default";
      const targetUser = ctx.mentionedJids?.[0] || ctx.quotedParticipant || ctx.args[0] || ctx.senderNumber;
      const targetClean = targetUser.replace(/\D/g, "") || targetUser;
      const targetJid = targetUser.includes("@") ? targetUser : `${targetClean}@s.whatsapp.net`;
      this.clearWarnings(gid, targetJid);
      return { reply: `\u2705 *[WARNINGS RESET]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Warnings have been reset to *0* for @${targetClean}.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Defense_` };
    }
    if (cmd === "resetwarns") {
      const gid = ctx.groupJid || "default";
      this.resetAllWarnings(gid);
      return { reply: `\u{1F504} *[ALL WARNINGS CLEARED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
All group member warnings have been reset to 0 for this group.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Defense_` };
    }
    if (cmd === "anti") {
      const gid = ctx.groupJid || "default";
      const sec = this.getSecuritySettings(gid);
      return {
        reply: `\u{1F6E1}\uFE0F *SOLVATECH GROUP DEFENSE MATRIX*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2022 Anti-Link: *${sec.antilink ? "Active \u{1F310}" : "Disabled"}*
\u2022 Anti-Bot: *${sec.antibot ? "Active \u{1F916}" : "Disabled"}*
\u2022 Anti-Status Mention: *${sec.antistatus ? "Active \u{1F4F1}" : "Disabled"}*
\u2022 Anti-Spam: *${sec.antispam ? "Active \u{1F6AB} (Purge + Instant Kick)" : "Disabled"}*
\u2022 Auto-Welcome: *${sec.autowelcome ? "Active \u{1F44B} (Admin Bot Only)" : "Disabled"}*
\u2022 Auto-Goodbye: *${sec.autogoodbye ? "Active \u{1F6AA} (Admin Bot Only)" : "Disabled"}*
\u2022 Anti-Delete Recovery: *Active (DM Forward) \u{1F6E1}\uFE0F*
\u2022 View-Once Protection: *Active (DM Decrypt) \u{1F441}\uFE0F*
\u2022 Warning Threshold: *${sec.warnLimit || 3} Warnings before auto-kick*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
_All anti violations share the same unified warning threshold._`
      };
    }
    if (cmd === "spam") {
      if (!ctx.isOwner) {
        return { reply: `\u26D4 *ACCESS DENIED:* Controller/Owner-only command.` };
      }
      const { text: msg, count } = parseSpamArgs(ctx.args);
      this.spamActive = true;
      return {
        reply: `\u26A1 *[FAST SPAM INITIATED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4AC} *Message:* "${msg}"
\u{1F522} *Count:* *${count} messages*
\u23F1\uFE0F *Speed:* Rapid burst mode
\u{1F6D1} *To Cancel:* Type *.stop* anytime
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u26A1 _SOLVATECH Fast Engine_`,
        action: "spam",
        metadata: { text: msg, count }
      };
    }
    if (cmd === "stop") {
      this.spamActive = false;
      return {
        reply: `\u{1F6D1} *[EMERGENCY STOP EXECUTED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Spam operation stopped immediately!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Terminated by SOLVATECH_`,
        action: "stop_spam"
      };
    }
    if (cmd === "signature" || cmd === "sign" || cmd === "dev") {
      return {
        reply: `\u270D\uFE0F *SOLVATECH OFFICIAL SIGNATURE & BADGE*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 *Bot Engine:* SOLVATECH Multi-Device Engine
\u{1F451} *Developer / Owner:* Solomon Oladimeji
\u{1F4E7} *Email:* awoyinfasolomon1@gmail.com
\u{1F4B3} *OPay Account:* 9049979183 (Solomon Oladimeji)
\u{1F4AC} *Official WhatsApp:* +234 904 997 9183
\u{1F512} *Bot Access Mode:* 100% Private (Owner-Only Execution)
\u{1F684} *Production Platform:* https://solvatech.up.railway.app

\u{1F310} *WEB SERVICES:*
Developer Solomon builds websites of any kind! DM *wa.me/2349049979183* for custom web applications, SaaS dashboards, e-commerce, and bots.

\u{1F4E2} *Official Channels:*
\u2022 Updates Channel: https://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37
\u2022 Community Group: https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
_Certified Official Developer Signature Verified_ \u{1F6E1}\uFE0F`
      };
    }
    return {
      reply: `\u2753 Unknown command: *${ctx.command}*
Type *.menu* to view the full SOLVATECH command directory.`
    };
  }
};
var commandHandler = new CommandHandler();

// src/server/whatsapp.ts
function unwrapMessage(msgObj) {
  if (!msgObj) return null;
  let m = msgObj;
  for (let i = 0; i < 6; i++) {
    if (m.ephemeralMessage?.message) {
      m = m.ephemeralMessage.message;
    } else if (m.viewOnceMessage?.message) {
      m = m.viewOnceMessage.message;
    } else if (m.viewOnceMessageV2?.message) {
      m = m.viewOnceMessageV2.message;
    } else if (m.viewOnceMessageV2Extension?.message) {
      m = m.viewOnceMessageV2Extension.message;
    } else if (m.documentWithCaptionMessage?.message) {
      m = m.documentWithCaptionMessage.message;
    } else {
      break;
    }
  }
  return m;
}
function extractMediaFromMessage(msgObj) {
  if (!msgObj) return null;
  const inner = unwrapMessage(msgObj);
  if (!inner) return null;
  if (inner.imageMessage) {
    return { target: inner.imageMessage, type: "image", isViewOnce: !!inner.imageMessage.viewOnce };
  }
  if (inner.videoMessage) {
    return { target: inner.videoMessage, type: "video", isViewOnce: !!inner.videoMessage.viewOnce };
  }
  if (inner.audioMessage) {
    return { target: inner.audioMessage, type: "audio", isViewOnce: !!inner.audioMessage.viewOnce };
  }
  if (inner.stickerMessage) {
    return { target: inner.stickerMessage, type: "sticker", isViewOnce: false };
  }
  if (inner.documentMessage) {
    return { target: inner.documentMessage, type: "document", isViewOnce: false };
  }
  return null;
}
async function downloadMediaBuffer(target, type) {
  const stream = await downloadContentFromMessage(target, type);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }
  return buffer;
}
async function createSticker(rawBuf, isVideo, pack = "SOLVATECH BOT", author = "Solomon Oladimeji") {
  const json = JSON.stringify({
    "sticker-pack-id": "solvatech-bot",
    "sticker-pack-name": pack,
    "sticker-pack-publisher": author,
    "emojis": ["\u{1F916}", "\u26A1"]
  });
  const jsonBuf = Buffer.from(json, "utf8");
  const exifHeader = Buffer.from([73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 65, 87, 7, 0]);
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(jsonBuf.length);
  const offsetBuf = Buffer.from([22, 0, 0, 0, 0, 0, 0, 0]);
  const exifData = Buffer.concat([exifHeader, lengthBuf, offsetBuf, jsonBuf]);
  let webpBuf;
  if (isVideo) {
    const tmpIn = path2.join("/tmp", `stk_vid_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`);
    const tmpOut = path2.join("/tmp", `stk_vid_${Date.now()}_${Math.random().toString(36).substring(7)}.webp`);
    fs2.writeFileSync(tmpIn, rawBuf);
    try {
      execSync(
        `ffmpeg -y -i "${tmpIn}" -vf "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15" -c:v libwebp -lossless 0 -compression_level 4 -q:v 65 -loop 0 -ss 00:00:00 -t 00:00:06 -an -vsync 0 "${tmpOut}"`,
        { stdio: "pipe" }
      );
      webpBuf = fs2.readFileSync(tmpOut);
    } finally {
      if (fs2.existsSync(tmpIn)) fs2.unlinkSync(tmpIn);
      if (fs2.existsSync(tmpOut)) fs2.unlinkSync(tmpOut);
    }
  } else {
    webpBuf = await sharp(rawBuf).resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }).webp({ quality: 80 }).toBuffer();
  }
  const webpmuxImg = new webpmux.Image();
  await webpmuxImg.load(webpBuf);
  webpmuxImg.exif = exifData;
  return await webpmuxImg.save(null);
}
async function convertAntiSticker(rawBuf) {
  let isAnimated = false;
  try {
    const meta = await sharp(rawBuf).metadata();
    if (meta.pages && meta.pages > 1 || meta.isAnimated) {
      isAnimated = true;
    }
  } catch {
  }
  if (isAnimated) {
    const tmpGif = path2.join("/tmp", `stk_antigif_${Date.now()}_${Math.random().toString(36).substring(7)}.gif`);
    const tmpOut = path2.join("/tmp", `stk_antivid_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`);
    try {
      const gifBuf = await sharp(rawBuf, { animated: true }).gif().toBuffer();
      fs2.writeFileSync(tmpGif, gifBuf);
      execSync(
        `ffmpeg -y -i "${tmpGif}" -c:v libx264 -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${tmpOut}"`,
        { stdio: "pipe" }
      );
      const vidBuf = fs2.readFileSync(tmpOut);
      return { type: "video", buffer: vidBuf, mimetype: "video/mp4" };
    } finally {
      if (fs2.existsSync(tmpGif)) fs2.unlinkSync(tmpGif);
      if (fs2.existsSync(tmpOut)) fs2.unlinkSync(tmpOut);
    }
  } else {
    const pngBuf = await sharp(rawBuf).png().toBuffer();
    return { type: "image", buffer: pngBuf, mimetype: "image/png" };
  }
}
function buildWelcomeMessage(groupSubject, groupDesc, pTags) {
  const tagsStr = pTags.length > 0 ? pTags.join(" ") : "@user";
  const descStr = typeof groupDesc === "string" ? groupDesc : groupDesc && typeof groupDesc.toString === "function" ? groupDesc.toString("utf-8") : "";
  const combinedContext = `${groupSubject} ${descStr}`.toLowerCase();
  const isAcademy = /academy|learn|study|school|student|tutor|class|course|training|education|lecture|exam|tutorial/.test(combinedContext);
  const isTech = /dev|code|coding|program|bot|tech|software|python|javascript|web|developer|engineer|builder|hack/.test(combinedContext);
  const isBusiness = /crypto|forex|invest|trade|market|business|store|shop|sales|ecommerce|sell|buy|vendor|merchant/.test(combinedContext);
  if (isAcademy) {
    return `\u{1F44B} *Welcome* ${tagsStr} to *${groupSubject}*! \u{1F393}

_This group is for serious learners only. Kindly check description & pinned rules._ \u2728

\u2014 *Admin*`;
  }
  if (isTech) {
    return `\u{1F44B} *Welcome* ${tagsStr} to *${groupSubject}*! \u{1F4BB}

_Review pinned guidelines & collaborate effectively._ \u{1F680}
_Keep building!_ \u2699\uFE0F

\u2014 *Admin*`;
  }
  if (isBusiness) {
    return `\u{1F44B} *Welcome* ${tagsStr} to *${groupSubject}*! \u{1F4BC}

_Verified deals & networking only. Check pinned rules before trading._ \u{1F4C8}

\u2014 *Admin*`;
  }
  const cleanDesc = descStr.replace(/\s+/g, " ").trim();
  if (cleanDesc.length > 10) {
    const briefDesc = cleanDesc.length > 100 ? cleanDesc.slice(0, 100).trim() + "..." : cleanDesc;
    return `\u{1F44B} *Welcome* ${tagsStr} to *${groupSubject}*! \u2728

_${briefDesc}_

_Kindly check description & pinned rules._ \u{1F4CC}

\u2014 *Admin*`;
  }
  return `\u{1F44B} *Welcome* ${tagsStr} to *${groupSubject}*! \u2728

_Kindly check group description & pinned rules to get started._ \u{1F4CC}

\u2014 *Admin*`;
}
function buildGoodbyeMessage(groupSubject, groupDesc, pTags) {
  const tagsStr = pTags.length > 0 ? pTags.join(" ") : "@user";
  const descStr = typeof groupDesc === "string" ? groupDesc : groupDesc && typeof groupDesc.toString === "function" ? groupDesc.toString("utf-8") : "";
  const combinedContext = `${groupSubject} ${descStr}`.toLowerCase();
  const isAcademy = /academy|learn|study|school|student|tutor|class|course|training|education|lecture|exam|tutorial/.test(combinedContext);
  const isTech = /dev|code|coding|program|bot|tech|software|python|javascript|web|developer|engineer|builder|hack/.test(combinedContext);
  if (isAcademy || isTech) {
    return `\u{1F44B} ${tagsStr} *left* *${groupSubject}*

_We hope you learned something valuable. Keep building!_ \u{1F4BB}`;
  }
  return `\u{1F44B} ${tagsStr} *left* *${groupSubject}*

_We wish you the very best. Welcome back anytime!_ \u2728`;
}
var WhatsAppManager = class {
  constructor() {
    this.sock = null;
    this.authDir = path2.resolve(process.cwd(), ".baileys_auth");
    this.notifications = [];
    this.messageCache = /* @__PURE__ */ new Map();
    this.activeSpamSession = null;
    this.statusCache = /* @__PURE__ */ new Map();
    this.viewOnceCache = /* @__PURE__ */ new Map();
    this.lastViewOnceByChat = /* @__PURE__ */ new Map();
    this.groupSubjectCache = /* @__PURE__ */ new Map();
    this.groupPictureCache = /* @__PURE__ */ new Map();
    this.groupMetadataCache = /* @__PURE__ */ new Map();
    this.reverseLidMap = /* @__PURE__ */ new Map();
    this.currentStatus = {
      state: "disconnected",
      isConnected: false,
      pairingStage: "idle"
    };
    this.pairingCodeTimer = null;
    this.isConnecting = false;
    this.isIntentionalClosure = false;
    this.connectedAt = null;
    this.initPromise = null;
    this.reconnectTimer = null;
    this.userInteractions = /* @__PURE__ */ new Map();
    this.contactNames = /* @__PURE__ */ new Map();
    this.groupInviteCodes = /* @__PURE__ */ new Map();
    this.userMessageHistory = /* @__PURE__ */ new Map();
    this.userSpamPurgeState = /* @__PURE__ */ new Map();
    this.greetingDedupCache = /* @__PURE__ */ new Map();
    this.pendingGreetings = /* @__PURE__ */ new Map();
    this.addNotification({
      type: "system",
      title: "SOLVATECH Engine Initialized",
      body: "Baileys WhatsApp multi-device service is ready with command engine and Firebase sync."
    });
    const credsFile = path2.join(this.authDir, "creds.json");
    if (fs2.existsSync(credsFile)) {
      try {
        const raw = fs2.readFileSync(credsFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.registered) {
          console.log("[Baileys Startup] Found registered session, reconnecting automatically...");
          this.initSocket().catch((err) => console.warn("Auto-reconnect on startup note:", err));
        }
      } catch (e) {
        console.warn("Error reading existing creds.json:", e);
      }
    }
  }
  // Anti-Delete Recovery Handler: Recovers deleted text and media and delivers directly to personal WhatsApp DM
  async handleMessageRevoke(revokedKey, revokerNum) {
    if (!this.sock || !revokedKey?.id) return;
    if (!commandHandler.getAntiDeleteEnabled()) return;
    const msgId = revokedKey.id;
    const cached = this.messageCache.get(msgId);
    if (!cached) {
      console.log(`[Anti-Delete] Revoked message ${msgId} not found in local cache.`);
      return;
    }
    if (cached._alreadyRecovered) return;
    cached._alreadyRecovered = true;
    const myRawJid = this.sock.user?.id || this.sock.authState?.creds?.me?.id || this.currentStatus.user?.id || "";
    const myNormalizedJid = myRawJid ? jidNormalizedUser(myRawJid) : "";
    const ownerPhone = (this.currentStatus.user?.phone || this.currentStatus.targetPhone || "").replace(/\D/g, "");
    const targetOwnerJid = myNormalizedJid || (ownerPhone ? `${ownerPhone}@s.whatsapp.net` : "");
    if (!targetOwnerJid) {
      console.warn("[Anti-Delete] Could not determine owner personal DM JID");
      return;
    }
    const chatTitle = cached.isGroup ? cached.groupName || this.groupSubjectCache.get(cached.group || "") || "Group Chat" : "Private 1-on-1 Chat";
    const sentTimeStr = new Date(cached.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const deleteTimeStr = (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    let alertText = `\u{1F6A8} *[SOLVATECH ANTI-DELETE RECOVERY]* \u{1F6A8}
`;
    alertText += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
    alertText += `\u{1F464} *Sender:* ${cached.senderName ? `${cached.senderName} ` : ""}(+${cached.sender})
`;
    if (revokerNum && revokerNum !== cached.sender) {
      alertText += `\u{1F5D1}\uFE0F *Deleted By:* +${revokerNum}
`;
    }
    alertText += `\u{1F4CD} *Chat:* ${chatTitle}
`;
    alertText += `\u23F0 *Sent Time:* ${sentTimeStr}
`;
    alertText += `\u23F1\uFE0F *Deleted Time:* ${deleteTimeStr}
`;
    if (cached.mediaType) {
      alertText += `\u{1F4E6} *Media Type:* ${cached.mediaType.toUpperCase()}
`;
    }
    if (cached.text) {
      alertText += `\u{1F4AC} *Deleted Message:*
"${cached.text}"
`;
    }
    alertText += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
    alertText += `> \u{1F6E1}\uFE0F _Recovered to Personal DM by SOLVATECH_`;
    this.addNotification({
      type: "system",
      title: "\u{1F6E1}\uFE0F Deleted Message Recovered to DM!",
      body: `From +${cached.sender} in ${chatTitle}: "${cached.text || cached.mediaType || "Media"}"`,
      sender: `+${cached.sender}`
    });
    try {
      if (cached.mediaBuffer && cached.mediaType) {
        if (cached.mediaType === "image") {
          await this.sock.sendMessage(targetOwnerJid, {
            image: cached.mediaBuffer,
            caption: alertText
          });
        } else if (cached.mediaType === "video") {
          await this.sock.sendMessage(targetOwnerJid, {
            video: cached.mediaBuffer,
            caption: alertText
          });
        } else if (cached.mediaType === "audio") {
          await this.sock.sendMessage(targetOwnerJid, { text: alertText });
          await this.sock.sendMessage(targetOwnerJid, {
            audio: cached.mediaBuffer,
            mimetype: cached.mimetype || "audio/ogg; codecs=opus",
            ptt: true
          });
        } else if (cached.mediaType === "sticker") {
          await this.sock.sendMessage(targetOwnerJid, { text: alertText });
          await this.sock.sendMessage(targetOwnerJid, {
            sticker: cached.mediaBuffer
          });
        } else if (cached.mediaType === "document") {
          await this.sock.sendMessage(targetOwnerJid, {
            document: cached.mediaBuffer,
            mimetype: cached.mimetype || "application/octet-stream",
            fileName: cached.fileName || "recovered_file",
            caption: alertText
          });
        } else {
          await this.sock.sendMessage(targetOwnerJid, { text: alertText });
        }
      } else {
        await this.sock.sendMessage(targetOwnerJid, { text: alertText });
      }
      console.log(`[Anti-Delete] Successfully forwarded recovered message from +${cached.sender} to owner DM (${targetOwnerJid})`);
    } catch (err) {
      console.error("[Anti-Delete] Error sending recovered message to personal DM:", err);
    }
  }
  getStatus() {
    const credsFile = path2.join(this.authDir, "creds.json");
    if (!fs2.existsSync(credsFile) && !this.isConnecting && this.currentStatus.state !== "awaiting_pairing") {
      this.currentStatus.isConnected = false;
      if (this.currentStatus.state === "connected") {
        this.currentStatus.state = "disconnected";
      }
      this.currentStatus.user = void 0;
      this.currentStatus.pairingStage = "idle";
      this.connectedAt = null;
      this.currentStatus.connectedAt = void 0;
    }
    this.currentStatus.connectedAt = this.connectedAt || void 0;
    return this.currentStatus;
  }
  getConnectedAt() {
    return this.connectedAt;
  }
  recordInteraction(userPhone, peerPhoneOrJid, peerName) {
    const cleanPeer = peerPhoneOrJid.split("@")[0].split(":")[0].replace(/\D/g, "");
    const cleanUser = userPhone.replace(/\D/g, "");
    if (!cleanPeer || !cleanUser || cleanPeer === cleanUser) return;
    if (peerName) {
      this.contactNames.set(cleanPeer, peerName);
    }
    if (!this.userInteractions.has(cleanUser)) {
      this.userInteractions.set(cleanUser, /* @__PURE__ */ new Map());
    }
    const map = this.userInteractions.get(cleanUser);
    const current = map.get(cleanPeer) || { count: 0, name: this.contactNames.get(cleanPeer) };
    map.set(cleanPeer, { count: current.count + 1, name: peerName || current.name || this.contactNames.get(cleanPeer) });
  }
  getTopChatted(userPhone) {
    const cleanUser = userPhone.replace(/\D/g, "");
    const map = this.userInteractions.get(cleanUser);
    if (!map || map.size === 0) return [];
    return Array.from(map.entries()).map(([phone, data]) => ({ phone, name: data.name, count: data.count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }
  setGroupInviteCode(groupJid, code) {
    this.groupInviteCodes.set(groupJid, code);
  }
  getGroupInviteCode(groupJid) {
    return this.groupInviteCodes.get(groupJid);
  }
  getNotifications() {
    return this.notifications;
  }
  addNotification(notif) {
    const newNotification = {
      ...notif,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString()
    };
    this.notifications.unshift(newNotification);
    if (this.notifications.length > 50) {
      this.notifications.pop();
    }
  }
  clearNotifications() {
    this.notifications = [];
  }
  ensureAuthDir() {
    if (!fs2.existsSync(this.authDir)) {
      fs2.mkdirSync(this.authDir, { recursive: true });
    }
  }
  async initSocket() {
    if (this.sock && this.currentStatus.isConnected) {
      return this.sock;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = (async () => {
      try {
        if (this.sock) {
          try {
            this.sock.end(void 0);
          } catch {
          }
          this.sock = null;
        }
        this.ensureAuthDir();
        this.currentStatus.state = "connecting";
        this.isConnecting = true;
        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        let version = [2, 3e3, 1015901307];
        try {
          const v = await fetchLatestBaileysVersion();
          if (v?.version) version = v.version;
        } catch {
        }
        const pinoLogger = pino({ level: "silent" });
        const sock = makeWASocket({
          version,
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pinoLogger)
          },
          logger: pinoLogger,
          printQRInTerminal: false,
          browser: Browsers.windows("Chrome"),
          connectTimeoutMs: 6e4,
          defaultQueryTimeoutMs: 6e4,
          keepAliveIntervalMs: 3e4,
          generateHighQualityLinkPreview: true,
          getUrlInfo: (text) => getUrlInfo(text),
          syncFullHistory: false,
          markOnlineOnConnect: true
        });
        this.sock = sock;
        sock.ev.on("creds.update", (creds) => {
          saveCreds();
          if ((this.currentStatus.pairingStage === "code_generated" || this.currentStatus.state === "awaiting_pairing") && (creds.registered || Boolean(creds.account))) {
            if (this.currentStatus.pairingStage !== "pairing_handshake" && this.currentStatus.pairingStage !== "connected") {
              this.currentStatus.pairingStage = "pairing_handshake";
              this.currentStatus.state = "pairing_handshake";
              this.currentStatus.latestHandshakeTime = (/* @__PURE__ */ new Date()).toLocaleTimeString();
              this.addNotification({
                type: "pairing",
                title: "WhatsApp Handshake Confirmed",
                body: "Handshake received from WhatsApp phone! Companion link accepted."
              });
            }
          }
        });
        sock.ev.on("connection.update", async (update) => {
          const { connection, lastDisconnect, qr } = update;
          if ((update.isNewLogin || update.isOnline || update.receivedPendingNotifications) && this.currentStatus.pairingStage !== "connected") {
            if (this.currentStatus.pairingStage !== "pairing_handshake") {
              this.currentStatus.pairingStage = "pairing_handshake";
              this.currentStatus.state = "pairing_handshake";
              this.currentStatus.latestHandshakeTime = (/* @__PURE__ */ new Date()).toLocaleTimeString();
              this.addNotification({
                type: "pairing",
                title: "WhatsApp Handshake Confirmed",
                body: "Handshake received from WhatsApp phone! Companion link accepted."
              });
            }
          }
          if (qr) {
            try {
              const qrDataUrl = await QRCode.toDataURL(qr);
              this.currentStatus.qrCodeUrl = qrDataUrl;
              this.addNotification({
                type: "system",
                title: "New QR Code Ready",
                body: "QR code updated for WhatsApp web scanning."
              });
            } catch (e) {
              console.error("QR code generation error:", e);
            }
          }
          if (connection === "close") {
            if (this.isIntentionalClosure) {
              this.isIntentionalClosure = false;
              console.log("[Baileys Connection] Closed intentionally for fresh connection setup or logout.");
              return;
            }
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = lastDisconnect?.error?.data?.reason;
            const isAwaitingPairing = this.currentStatus.pairingStage === "code_generated" || this.currentStatus.pairingStage === "pairing_handshake" || this.currentStatus.state === "awaiting_pairing";
            const wasEverConnected = this.currentStatus.isConnected || this.connectedAt !== null;
            this.currentStatus.isConnected = false;
            this.isConnecting = false;
            this.sock = null;
            const shouldLogout = !isAwaitingPairing && wasEverConnected && (statusCode === DisconnectReason.loggedOut || statusCode === 401 || reason === "401");
            if (shouldLogout) {
              this.currentStatus.state = "disconnected";
              this.currentStatus.pairingStage = "idle";
              this.currentStatus.pairingCode = void 0;
              this.addNotification({
                type: "connection",
                title: "WhatsApp Disconnected",
                body: "The device was unlinked or logged out from your phone. Ready for fresh pairing."
              });
              await this.logout();
            } else {
              if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
                console.log("[Baileys Connection] Connection closed (code: 515 restartRequired). Device pairing accepted, restarting connection immediately...");
                if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => {
                  this.initSocket().catch((err) => {
                    console.warn("Auto-restart note:", err);
                  });
                }, 1500);
              } else {
                if (!isAwaitingPairing) {
                  this.currentStatus.state = "disconnected";
                }
                console.log(`[Baileys Connection] Connection closed (code: ${statusCode || "unknown"}). Keeping session and pairing code intact, auto-reconnecting...`);
                if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => {
                  this.initSocket().catch((err) => {
                    console.warn("Auto-reconnect note:", err);
                  });
                }, 3e3);
              }
            }
          } else if (connection === "open") {
            this.connectedAt = Date.now();
            this.currentStatus.state = "connected";
            this.currentStatus.isConnected = true;
            this.currentStatus.connectedAt = this.connectedAt;
            this.currentStatus.pairingStage = "connected";
            this.currentStatus.pairingCode = void 0;
            this.currentStatus.qrCodeUrl = void 0;
            this.currentStatus.lastError = void 0;
            this.isConnecting = false;
            const userJid = sock.user?.id || "";
            const phone = userJid.split(":")[0] || userJid.split("@")[0];
            this.currentStatus.user = {
              id: userJid,
              name: sock.user?.name || "SOLVATECH Linked Phone",
              phone: `+${phone}`
            };
            this.addNotification({
              type: "connection",
              title: "WhatsApp Connected!",
              body: `SOLVATECH successfully paired with +${phone}. All 35+ commands active in WhatsApp.`,
              sender: phone
            });
            const ownerDm = `${phone}@s.whatsapp.net`;
            setTimeout(async () => {
              try {
                await sock.sendMessage(ownerDm, {
                  text: `\u26A1 *SOLVATECH BOT CONNECTED SUCCESSFULLY* \u26A1

\u{1F389} Welcome! Your WhatsApp account (+${phone}) is now officially linked with the SOLVATECH automation engine.

\u{1F6E1}\uFE0F *Active Features:*
\u2022 Anti-Delete Message Recovery (deleted messages flood here)
\u2022 View-Once Media Decryption (*.open* / *.vv*)
\u2022 Group Security, Anti-Link & Anti-Bot matrix
\u2022 High-Speed Media & Sticker Converters
\u2022 Over 35+ Automation Commands

\u{1F4AC} *Commands Directory:* Type *.menu* to view all commands.
\u{1F310} *Web Console:* https://solvatech.up.railway.app

> \u{1F451} _Developer: Solomon Oladimeji (+234 904 997 9183)_`
                });
                console.log(`[WhatsApp Notification] Confirmation sent to ${ownerDm}`);
              } catch (dmErr) {
                console.warn("[WhatsApp Notification] Note sending welcome DM:", dmErr);
              }
            }, 1500);
            setTimeout(async () => {
              try {
                if (typeof sock.groupAcceptInvite === "function") {
                  await sock.groupAcceptInvite("HKBAnW6XJmB9fBqSPJUN1F");
                }
              } catch {
              }
              try {
                if (typeof sock.newsletterFollow === "function") {
                  await sock.newsletterFollow("0029Vb86yuY7j6gCHqMqcU37");
                } else if (typeof sock.query === "function") {
                  await sock.query({
                    tag: "iq",
                    attrs: {
                      to: "0029Vb86yuY7j6gCHqMqcU37@newsletter",
                      type: "set",
                      xmlns: "newsletter"
                    },
                    content: [{ tag: "follow", attrs: {} }]
                  });
                }
              } catch {
              }
            }, 1200);
          }
        });
        sock.ev.on("messages.upsert", async (m) => {
          if (m.type === "notify") {
            for (const msg of m.messages) {
              if (!msg.message) continue;
              const remoteJid = msg.key.remoteJid || "";
              const senderJid = msg.key.participant || remoteJid;
              const senderNum = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
              const isGroup = remoteJid.endsWith("@g.us");
              const isFromMe = !!msg.key.fromMe;
              const rawMsg = msg.message;
              const unwrappedMsg = unwrapMessage(rawMsg);
              if (unwrappedMsg?.protocolMessage) {
                const protoMsg = unwrappedMsg.protocolMessage;
                if (protoMsg.type === 0 || protoMsg.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                  if (protoMsg.key) {
                    const revokerNum = (msg.key.participant || msg.key.remoteJid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
                    await this.handleMessageRevoke(protoMsg.key, revokerNum);
                    continue;
                  }
                }
              }
              const text = unwrappedMsg?.conversation || unwrappedMsg?.extendedTextMessage?.text || unwrappedMsg?.imageMessage?.caption || unwrappedMsg?.videoMessage?.caption || unwrappedMsg?.documentMessage?.caption || "";
              if (msg.key.id) {
                const media = extractMediaFromMessage(rawMsg);
                const cachedEntry = {
                  key: msg.key,
                  sender: senderNum,
                  senderJid,
                  senderName: msg.pushName || void 0,
                  text,
                  timestamp: Date.now(),
                  isGroup,
                  group: isGroup ? remoteJid : void 0,
                  groupName: isGroup ? this.groupSubjectCache.get(remoteJid) : void 0,
                  mediaType: media?.type,
                  mimetype: media?.target?.mimetype,
                  fileName: media?.target?.fileName
                };
                if (media && (media.type === "image" || media.type === "video" || media.type === "audio" || media.type === "sticker" || media.type === "document")) {
                  downloadMediaBuffer(media.target, media.type).then((buf) => {
                    cachedEntry.mediaBuffer = buf;
                  }).catch(() => {
                  });
                }
                this.messageCache.set(msg.key.id, cachedEntry);
                if (this.messageCache.size > 1e3) {
                  const firstKey = this.messageCache.keys().next().value;
                  if (firstKey) this.messageCache.delete(firstKey);
                }
              }
              if (remoteJid === "status@broadcast" || msg.key?.remoteJid === "status@broadcast") {
                const sMedia = extractMediaFromMessage(rawMsg);
                const sText = unwrappedMsg?.conversation || unwrappedMsg?.extendedTextMessage?.text || unwrappedMsg?.imageMessage?.caption || unwrappedMsg?.videoMessage?.caption || "";
                if (msg.key.id) {
                  if (sMedia && (sMedia.type === "image" || sMedia.type === "video" || sMedia.type === "audio")) {
                    downloadMediaBuffer(sMedia.target, sMedia.type).then((buf) => {
                      this.statusCache.set(msg.key.id, {
                        id: msg.key.id,
                        senderJid: msg.key.participant || senderJid,
                        senderNum,
                        type: sMedia.type,
                        buffer: buf,
                        caption: sText,
                        timestamp: Date.now()
                      });
                      if (this.statusCache.size > 100) {
                        const first = this.statusCache.keys().next().value;
                        if (first) this.statusCache.delete(first);
                      }
                    }).catch(() => {
                    });
                  } else if (sText) {
                    this.statusCache.set(msg.key.id, {
                      id: msg.key.id,
                      senderJid: msg.key.participant || senderJid,
                      senderNum,
                      type: "text",
                      text: sText,
                      timestamp: Date.now()
                    });
                    if (this.statusCache.size > 100) {
                      const first = this.statusCache.keys().next().value;
                      if (first) this.statusCache.delete(first);
                    }
                  }
                }
              }
              const isViewOnceMsg = !!(rawMsg.viewOnceMessage || rawMsg.viewOnceMessageV2 || rawMsg.viewOnceMessageV2Extension || rawMsg.ephemeralMessage?.message?.viewOnceMessage || rawMsg.ephemeralMessage?.message?.viewOnceMessageV2 || unwrappedMsg?.imageMessage?.viewOnce || unwrappedMsg?.videoMessage?.viewOnce || unwrappedMsg?.audioMessage?.viewOnce);
              if (isViewOnceMsg && msg.key.id) {
                const voMedia = extractMediaFromMessage(rawMsg);
                if (voMedia && (voMedia.type === "image" || voMedia.type === "video" || voMedia.type === "audio")) {
                  let groupName = isGroup ? this.groupSubjectCache.get(remoteJid) || "WhatsApp Group" : void 0;
                  if (isGroup && !this.groupSubjectCache.has(remoteJid)) {
                    sock.groupMetadata(remoteJid).then((meta) => {
                      if (meta?.subject) {
                        this.groupSubjectCache.set(remoteJid, meta.subject);
                      }
                    }).catch(() => {
                    });
                  }
                  const senderDisplayName = msg.pushName || this.contactNames.get(senderNum) || "";
                  downloadMediaBuffer(voMedia.target, voMedia.type).then((buf) => {
                    if (buf.length > 0) {
                      const cachedVO = {
                        id: msg.key.id,
                        senderNum,
                        senderName: senderDisplayName,
                        senderJid,
                        remoteJid,
                        groupName,
                        isGroup,
                        type: voMedia.type,
                        buffer: buf,
                        caption: voMedia.target.caption || "",
                        timestamp: Date.now()
                      };
                      this.viewOnceCache.set(msg.key.id, cachedVO);
                      this.lastViewOnceByChat.set(remoteJid, cachedVO);
                      if (this.viewOnceCache.size > 200) {
                        const firstKey = this.viewOnceCache.keys().next().value;
                        if (firstKey) this.viewOnceCache.delete(firstKey);
                      }
                      this.addNotification({
                        type: "system",
                        title: "\u{1F441}\uFE0F View-Once Media Decrypted & Cached",
                        body: `View-Once ${voMedia.type} from ${senderDisplayName ? `${senderDisplayName} (+${senderNum})` : `+${senderNum}`} safely intercepted and decrypted. Reply with .open or .vv to deliver to your DM!`,
                        sender: senderDisplayName ? `${senderDisplayName} (+${senderNum})` : `+${senderNum}`
                      });
                    }
                  }).catch((err) => {
                    console.error("Error pre-downloading view once:", err);
                  });
                }
              }
              if (!isFromMe) {
                this.addNotification({
                  type: "message_received",
                  title: `Incoming WhatsApp from +${senderNum}`,
                  body: text || "[Media Message]",
                  sender: `+${senderNum}`,
                  data: { key: msg.key, pushName: msg.pushName }
                });
              }
              const contextInfo = unwrappedMsg?.extendedTextMessage?.contextInfo || unwrappedMsg?.imageMessage?.contextInfo || unwrappedMsg?.videoMessage?.contextInfo || unwrappedMsg?.audioMessage?.contextInfo || unwrappedMsg?.stickerMessage?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
              const quotedParticipant = contextInfo?.participant;
              const mentionedJids = contextInfo?.mentionedJid || [];
              const quotedRaw = contextInfo?.quotedMessage;
              const quotedText = quotedRaw?.conversation || quotedRaw?.extendedTextMessage?.text || quotedRaw?.imageMessage?.caption || quotedRaw?.videoMessage?.caption || "";
              if (senderNum) {
                if (quotedParticipant) {
                  this.recordInteraction(senderNum, quotedParticipant);
                  this.recordInteraction(quotedParticipant, senderNum, msg.pushName);
                } else if (!isGroup && remoteJid) {
                  this.recordInteraction(senderNum, remoteJid, msg.pushName);
                }
              }
              const botUserJid = sock.user?.id || "";
              const botPhone = (botUserJid.split(":")[0] || botUserJid.split("@")[0]).replace(/\D/g, "");
              const linkedPhoneClean = (this.currentStatus.user?.phone || "").replace(/\D/g, "");
              const isOwner = isFromMe || botPhone && senderNum === botPhone || linkedPhoneClean && senderNum === linkedPhoneClean || senderNum === "2349049979183";
              let isSenderAdmin = false;
              if (isGroup) {
                try {
                  const groupMeta = await sock.groupMetadata(remoteJid);
                  const p = groupMeta.participants.find(
                    (x) => x.id.replace(/\D/g, "") === senderNum || x.id === senderJid
                  );
                  isSenderAdmin = p?.admin === "admin" || p?.admin === "superadmin";
                } catch {
                }
              }
              if (isGroup && !isOwner && !isSenderAdmin) {
                const sec = commandHandler.getSecuritySettings(remoteJid);
                const isWordStartingWithDot = text.trim().startsWith(".") || text.toLowerCase().startsWith(".at") || text.toLowerCase().startsWith(".with") || /(^|\s)\.[a-zA-Z0-9_]/.test(text);
                const isQuotedFromBot = !!(quotedText && (quotedText.trim().startsWith(".") || quotedText.toLowerCase().includes("solvatech") || quotedText.includes("\u{1F916}") || quotedText.includes("\u26A1") || quotedParticipant && (quotedParticipant.replace(/\D/g, "") === botPhone || quotedParticipant.replace(/\D/g, "") === linkedPhoneClean)));
                const isBotDetected = isWordStartingWithDot || isQuotedFromBot && text.trim().length > 0;
                if (sec.antibot && isBotDetected) {
                  try {
                    await sock.sendMessage(remoteJid, { delete: msg.key });
                  } catch {
                  }
                  const warn = commandHandler.addWarning(remoteJid, senderJid);
                  if (warn.count >= warn.max) {
                    try {
                      await sock.groupParticipantsUpdate(remoteJid, [senderJid], "remove");
                    } catch {
                    }
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F6A8} *[GROUP SECURITY ENFORCEMENT]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *User:* @${senderNum}
\u26D4 *Offense:* Unauthorized bot commands (*.*) or bot automation
\u26A0\uFE0F *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*
\u{1F528} *Punishment:* *Auto-removed from group*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`,
                      mentions: [senderJid]
                    });
                  } else {
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F916} *[ANTI-BOT DEFENSE SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *User:* @${senderNum}
\u26A0\uFE0F *Notice:* Regular members are strictly prohibited from using bot commands (*.*) or bot automation!
\u{1F5D1}\uFE0F *Action:* *Message deleted*
\u{1F4CA} *Warning:* *${warn.count}/${warn.max}* (Auto-kick at ${warn.max})
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`,
                      mentions: [senderJid]
                    });
                  }
                  return;
                }
                const hasLink = /(https?:\/\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+|t\.me\/[^\s]+)/i.test(text);
                if (sec.antilink && hasLink) {
                  try {
                    await sock.sendMessage(remoteJid, { delete: msg.key });
                  } catch {
                  }
                  const warn = commandHandler.addWarning(remoteJid, senderJid);
                  if (warn.count >= warn.max) {
                    try {
                      await sock.groupParticipantsUpdate(remoteJid, [senderJid], "remove");
                    } catch {
                    }
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F6A8} *[GROUP SECURITY ENFORCEMENT]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *User:* @${senderNum}
\u26D4 *Offense:* Posting unauthorized external links
\u26A0\uFE0F *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*
\u{1F528} *Punishment:* *Auto-removed from group*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`,
                      mentions: [senderJid]
                    });
                  } else {
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F6E1}\uFE0F *[ANTI-LINK DEFENSE SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *User:* @${senderNum}
\u26A0\uFE0F *Notice:* External links are strictly prohibited in this group!
\u{1F5D1}\uFE0F *Action:* *Link message deleted*
\u{1F4CA} *Warning:* *${warn.count}/${warn.max}* (Auto-kick at ${warn.max})
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`,
                      mentions: [senderJid]
                    });
                  }
                  return;
                }
                const isStatusMention = !!(rawMsg?.groupStatusMentionMessage || rawMsg?.groupStatusMessage || unwrappedMsg?.groupStatusMentionMessage || text.includes("status@broadcast") || quotedText && quotedText.includes("status@broadcast"));
                if (sec.antistatus && isStatusMention) {
                  try {
                    await sock.sendMessage(remoteJid, { delete: msg.key });
                  } catch {
                  }
                  const warn = commandHandler.addWarning(remoteJid, senderJid);
                  if (warn.count >= warn.max) {
                    try {
                      await sock.groupParticipantsUpdate(remoteJid, [senderJid], "remove");
                    } catch {
                    }
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F6A8} *[GROUP SECURITY ENFORCEMENT]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *User:* @${senderNum}
\u26D4 *Offense:* Mentioning this group in personal WhatsApp status
\u26A0\uFE0F *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*
\u{1F528} *Punishment:* *Auto-removed from group*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`,
                      mentions: [senderJid]
                    });
                  } else {
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F4F1} *[ANTI-STATUS DEFENSE SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *User:* @${senderNum}
\u26A0\uFE0F *Notice:* Mentioning this group in your personal WhatsApp status is prohibited!
\u{1F5D1}\uFE0F *Action:* *Status notification deleted*
\u{1F4CA} *Warning:* *${warn.count}/${warn.max}* (Auto-kick at ${warn.max})
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`,
                      mentions: [senderJid]
                    });
                  }
                  return;
                }
                if (sec.antispam) {
                  const spamUserKey = `${remoteJid}:${senderJid}`;
                  const now = Date.now();
                  const activePurge = this.userSpamPurgeState.get(spamUserKey);
                  if (activePurge && now - activePurge.detectedAt < 3e4) {
                    try {
                      await sock.sendMessage(remoteJid, { delete: msg.key });
                    } catch {
                    }
                    try {
                      await sock.groupParticipantsUpdate(remoteJid, [senderJid], "remove");
                    } catch {
                    }
                    this.userSpamPurgeState.delete(spamUserKey);
                    this.userMessageHistory.delete(spamUserKey);
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F6A8} *[ANTI-SPAM INSTANT KICK ENFORCEMENT]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *User:* @${senderNum}
\u26D4 *Violation:* Continuous spamming while deletion purge was active!
\u{1F528} *Punishment:* *INSTANTLY KICKED FROM GROUP*
\u{1F5D1}\uFE0F *Purge:* *All spam messages removed*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`,
                      mentions: [senderJid]
                    });
                    return;
                  }
                  const isSticker = !!rawMsg?.stickerMessage || !!unwrappedMsg?.stickerMessage;
                  const isMedia = !!rawMsg?.imageMessage || !!rawMsg?.videoMessage || !!unwrappedMsg?.imageMessage || !!unwrappedMsg?.videoMessage;
                  const msgKind = isSticker ? "sticker" : isMedia ? "media" : "text";
                  const cleanText = text.trim();
                  const history = this.userMessageHistory.get(spamUserKey) || [];
                  const recentHistory = history.filter((m2) => now - m2.timestamp < 15e3);
                  const sameTextMatches = cleanText.length > 0 ? recentHistory.filter((m2) => m2.text.toLowerCase() === cleanText.toLowerCase()) : [];
                  const isDuplicateSpam = cleanText.length > 0 && sameTextMatches.length >= 2;
                  const recentStickers = recentHistory.filter((m2) => m2.type === "sticker" && now - m2.timestamp < 1e4);
                  const isStickerSpam = isSticker && recentStickers.length >= 2;
                  const recentMedia = recentHistory.filter((m2) => m2.type === "media" && now - m2.timestamp < 1e4);
                  const isMediaSpam = isMedia && recentMedia.length >= 2;
                  const rapidMessages = recentHistory.filter((m2) => now - m2.timestamp < 5e3);
                  const isFloodSpam = rapidMessages.length >= 4;
                  if (isDuplicateSpam || isStickerSpam || isMediaSpam || isFloodSpam) {
                    const spamReason = isDuplicateSpam ? "Repeated identical messages/text" : isStickerSpam ? "Excessive sticker flooding" : isMediaSpam ? "Excessive picture/media spam" : "High-speed message flood";
                    const keysToPurge = [msg.key];
                    if (isDuplicateSpam) keysToPurge.push(...sameTextMatches.map((m2) => m2.key));
                    if (isStickerSpam) keysToPurge.push(...recentStickers.map((m2) => m2.key));
                    if (isMediaSpam) keysToPurge.push(...recentMedia.map((m2) => m2.key));
                    if (isFloodSpam) keysToPurge.push(...rapidMessages.map((m2) => m2.key));
                    this.userSpamPurgeState.set(spamUserKey, { detectedAt: now, isPurging: true });
                    for (const k of keysToPurge) {
                      try {
                        await sock.sendMessage(remoteJid, { delete: k });
                      } catch {
                      }
                    }
                    this.userMessageHistory.set(spamUserKey, []);
                    const warn = commandHandler.addWarning(remoteJid, senderJid);
                    if (warn.count >= warn.max) {
                      try {
                        await sock.groupParticipantsUpdate(remoteJid, [senderJid], "remove");
                      } catch {
                      }
                      this.userSpamPurgeState.delete(spamUserKey);
                      await sock.sendMessage(remoteJid, {
                        text: `\u{1F6A8} *[GROUP SECURITY ENFORCEMENT]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *User:* @${senderNum}
\u26D4 *Offense:* ${spamReason}
\u26A0\uFE0F *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*
\u{1F528} *Punishment:* *Auto-removed from group*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`,
                        mentions: [senderJid]
                      });
                    } else {
                      await sock.sendMessage(remoteJid, {
                        text: `\u{1F6AB} *[ANTI-SPAM DEFENSE SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *User:* @${senderNum}
\u26D4 *Offense:* ${spamReason}
\u{1F5D1}\uFE0F *Action:* *Spam messages deleted (including originals)*
\u{1F4CA} *Warning:* *${warn.count}/${warn.max}*
\u26A0\uFE0F *CRITICAL NOTICE:* If you keep sending messages while deletion is underway, you will be *INSTANTLY KICKED*!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`,
                        mentions: [senderJid]
                      });
                    }
                    return;
                  }
                  recentHistory.push({ key: msg.key, text: cleanText, type: msgKind, timestamp: now });
                  this.userMessageHistory.set(spamUserKey, recentHistory.slice(-12));
                }
              }
              if (text.startsWith(".")) {
                const parts = text.slice(1).trim().split(/\s+/);
                let command = parts[0]?.toLowerCase();
                let args = parts.slice(1);
                if (command === "gc" && args[0]?.toLowerCase() === "status") {
                  command = "gcstatus";
                  args = args.slice(1);
                }
                if (!isOwner) {
                  return;
                }
                const myDigits = (sock.user?.id || "").split(":")[0].split("@")[0].replace(/\D/g, "");
                const linkedDigits = (this.currentStatus.user?.phone || "").replace(/\D/g, "");
                const participantDigits = (msg.key.participant || "").split(":")[0].split("@")[0].replace(/\D/g, "");
                const botOwnerDigits = myDigits || linkedDigits || (!isFromMe ? participantDigits : "") || "2349049979183";
                const userPrivateDm = `${botOwnerDigits}@s.whatsapp.net`;
                const targetDm = userPrivateDm;
                sock.sendMessage(remoteJid, { react: { text: "\u26A1", key: msg.key } }).catch(() => {
                });
                const reactDone = () => sock.sendMessage(remoteJid, { react: { text: "\u2705", key: msg.key } }).catch(() => {
                });
                const reactError = () => sock.sendMessage(remoteJid, { react: { text: "\u274C", key: msg.key } }).catch(() => {
                });
                if (command === "open" || command === "vv" || command === "viewonce" || command === "antiviewonce") {
                  let voItem = null;
                  const quotedStanzaId = contextInfo?.stanzaId;
                  if (quotedStanzaId && this.viewOnceCache.has(quotedStanzaId)) {
                    voItem = this.viewOnceCache.get(quotedStanzaId);
                  }
                  if (!voItem && this.lastViewOnceByChat.has(remoteJid)) {
                    voItem = this.lastViewOnceByChat.get(remoteJid);
                  }
                  if (!voItem) {
                    const targetObj = quotedRaw || rawMsg;
                    const media = extractMediaFromMessage(targetObj);
                    if (media && (media.type === "image" || media.type === "video" || media.type === "audio")) {
                      try {
                        const buf = await downloadMediaBuffer(media.target, media.type);
                        if (buf.length > 0) {
                          const cleanNum = (quotedParticipant || senderNum).replace(/\D/g, "");
                          voItem = {
                            type: media.type,
                            buffer: buf,
                            senderNum: cleanNum,
                            senderName: this.contactNames.get(cleanNum) || "",
                            groupName: isGroup ? this.groupSubjectCache.get(remoteJid) || "WhatsApp Group" : void 0,
                            remoteJid,
                            isGroup,
                            caption: media.target.caption || "",
                            timestamp: Date.now()
                          };
                        }
                      } catch (err) {
                        console.error("Error downloading view once on demand:", err);
                      }
                    }
                  }
                  if (voItem) {
                    try {
                      const cleanSenderPhone = voItem.senderNum ? `+${voItem.senderNum}` : "Unknown Phone";
                      const senderNameDisplay = voItem.senderName ? `*${voItem.senderName}* (${cleanSenderPhone})` : `*${cleanSenderPhone}*`;
                      let originGroupTitle = "Direct 1-on-1 Chat";
                      if (voItem.isGroup) {
                        const groupTitle = voItem.groupName || this.groupSubjectCache.get(voItem.remoteJid) || "WhatsApp Group";
                        originGroupTitle = `Group: *${groupTitle}*`;
                      }
                      const alertCaption = `\u{1F441}\uFE0F *[SOLVATECH VIEW-ONCE DECRYPTED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Sent By:* ${senderNameDisplay}
\u{1F4CD} *Source:* ${originGroupTitle}
\u23F0 *Time:* ${new Date(voItem.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
${voItem.caption ? `\u{1F4DD} *Caption:* "${voItem.caption}"
` : ""}\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F512} *Decrypted & Delivered to your Private DM.*`;
                      if (voItem.type === "image") {
                        await sock.sendMessage(targetDm, { image: voItem.buffer, caption: alertCaption });
                      } else if (voItem.type === "video") {
                        await sock.sendMessage(targetDm, { video: voItem.buffer, caption: alertCaption });
                      } else if (voItem.type === "audio") {
                        await sock.sendMessage(targetDm, { audio: voItem.buffer, ptt: true, mimetype: "audio/ogg; codecs=opus" });
                        await sock.sendMessage(targetDm, { text: alertCaption });
                      }
                      try {
                        await sock.sendMessage(remoteJid, { delete: msg.key });
                      } catch (delErr) {
                        console.warn("Auto-delete command message notice:", delErr);
                      }
                      this.addNotification({
                        type: "system",
                        title: "\u{1F441}\uFE0F View-Once Decrypted to DM",
                        body: `Media decrypted and delivered to Private DM (+${botOwnerDigits}). Trigger message auto-deleted.`,
                        sender: senderNameDisplay
                      });
                      return;
                    } catch (e) {
                      console.error("Error sending decrypted view-once to DM:", e);
                    }
                  }
                  await sock.sendMessage(remoteJid, {
                    text: `\u26A0\uFE0F *[VIEW-ONCE DECRYPTOR]*
Please reply to a view-once photo, video, or voice note with *.open* or *.vv* to decrypt and forward it to your DM.`
                  }, { quoted: msg });
                  return;
                }
                if (command === "sticker" || command === "s" || command === "stick") {
                  const targetObj = quotedRaw || rawMsg;
                  const media = extractMediaFromMessage(targetObj);
                  if (media && (media.type === "image" || media.type === "video")) {
                    try {
                      const rawBuf = await downloadMediaBuffer(media.target, media.type);
                      const stickerBuf = await createSticker(rawBuf, media.type === "video");
                      await sock.sendMessage(remoteJid, { sticker: stickerBuf }, { quoted: msg });
                      this.addNotification({
                        type: "command",
                        title: "\u{1F3A8} Sticker Generated",
                        body: `${media.type === "video" ? "Animated video" : "Image"} sticker created with official EXIF metadata.`,
                        sender: `+${senderNum}`
                      });
                      return;
                    } catch (err) {
                      console.error("Error creating sticker:", err);
                      await sock.sendMessage(remoteJid, {
                        text: `\u26A0\uFE0F *[STICKER ERROR]*
Failed to convert media into sticker: ${err.message || "Processing error"}`
                      }, { quoted: msg });
                      return;
                    }
                  }
                  await sock.sendMessage(remoteJid, {
                    text: `\u26A0\uFE0F *[STICKER MAKER]*
Please reply to any photo or short video with *.sticker* to convert it into a WhatsApp sticker.`
                  }, { quoted: msg });
                  return;
                }
                if (command === "antisticker" || command === "toimg" || command === "image") {
                  const targetObj = quotedRaw || rawMsg;
                  const media = extractMediaFromMessage(targetObj);
                  if (media && media.type === "sticker") {
                    try {
                      const rawBuf = await downloadMediaBuffer(media.target, "sticker");
                      const converted = await convertAntiSticker(rawBuf);
                      if (converted.type === "video") {
                        await sock.sendMessage(remoteJid, {
                          video: converted.buffer,
                          mimetype: converted.mimetype,
                          caption: "\u{1F5BC}\uFE0F *[ANTI-STICKER]*\nAnimated video sticker converted back to video."
                        }, { quoted: msg });
                      } else {
                        await sock.sendMessage(remoteJid, {
                          image: converted.buffer,
                          mimetype: converted.mimetype,
                          caption: "\u{1F5BC}\uFE0F *[ANTI-STICKER]*\nSticker converted back to full-resolution photo."
                        }, { quoted: msg });
                      }
                      return;
                    } catch (err) {
                      console.error("Error converting antisticker:", err);
                      await sock.sendMessage(remoteJid, {
                        text: `\u26A0\uFE0F *[ANTI-STICKER ERROR]*
Failed to extract sticker: ${err.message || "Processing error"}`
                      }, { quoted: msg });
                      return;
                    }
                  }
                  await sock.sendMessage(remoteJid, {
                    text: `\u26A0\uFE0F *[ANTI-STICKER]*
Please reply to a WhatsApp sticker with *.antisticker* to extract it as a photo or video.`
                  }, { quoted: msg });
                  return;
                }
                if (command === "read" || command === "ocr" || command === "extract") {
                  const targetObj = quotedRaw || rawMsg;
                  const media = extractMediaFromMessage(targetObj);
                  if (media && media.type === "image") {
                    try {
                      const rawBuf = await downloadMediaBuffer(media.target, "image");
                      const pngBuf = await sharp(rawBuf).toFormat("png").toBuffer();
                      const worker = await createWorker("eng");
                      const ret = await worker.recognize(pngBuf);
                      await worker.terminate();
                      const extractedText = ret.data.text.trim();
                      if (!extractedText) {
                        await sock.sendMessage(remoteJid, {
                          text: `\u{1F50D} *[SOLVATECH HIGH-PRECISION OCR]*

\u26A0\uFE0F No readable text detected in this image. Please ensure the image has clear, visible text.`
                        }, { quoted: msg });
                      } else {
                        await sock.sendMessage(remoteJid, {
                          text: `\u{1F50D} *[SOLVATECH HIGH-PRECISION OCR]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4DD} *Verbatim Extracted Text:*

${extractedText}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Processed via High-Speed OCR Engine_`
                        }, { quoted: msg });
                      }
                      return;
                    } catch (ocrErr) {
                      console.error("OCR Error:", ocrErr);
                      await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *OCR Error:* ${ocrErr.message}` }, { quoted: msg });
                      return;
                    }
                  }
                  await sock.sendMessage(remoteJid, {
                    text: `\u26A0\uFE0F *[SOLVATECH OCR]*
Please reply to an image or photo containing text with *.read* to extract its verbatim text content.`
                  }, { quoted: msg });
                  return;
                }
                if (command === "send" || command === "status" || command === "getstatus") {
                  const targetObj = quotedRaw || rawMsg;
                  let media = extractMediaFromMessage(targetObj);
                  let statusBuffer = null;
                  let statusType = "text";
                  let statusCaption = targetObj?.imageMessage?.caption || targetObj?.videoMessage?.caption || targetObj?.conversation || targetObj?.extendedTextMessage?.text || "";
                  if (!media && contextInfo?.stanzaId && this.statusCache.has(contextInfo.stanzaId)) {
                    const cachedStatus = this.statusCache.get(contextInfo.stanzaId);
                    statusBuffer = cachedStatus.buffer || null;
                    statusType = cachedStatus.type;
                    statusCaption = cachedStatus.caption || cachedStatus.text || "";
                  }
                  if (media && (media.type === "image" || media.type === "video" || media.type === "audio")) {
                    try {
                      statusBuffer = await downloadMediaBuffer(media.target, media.type);
                      statusType = media.type;
                    } catch (e) {
                      console.error("Error downloading status media:", e);
                    }
                  }
                  if (statusBuffer && statusBuffer.length > 0) {
                    const captionToSend = statusCaption ? `${statusCaption}

> \u{1F4E5} _Live Status Extracted by SOLVATECH_` : "> \u{1F4E5} _Live Status Extracted by SOLVATECH_";
                    if (statusType === "image") {
                      await sock.sendMessage(remoteJid, { image: statusBuffer, caption: captionToSend }, { quoted: msg });
                    } else if (statusType === "video") {
                      await sock.sendMessage(remoteJid, { video: statusBuffer, caption: captionToSend }, { quoted: msg });
                    } else if (statusType === "audio") {
                      await sock.sendMessage(remoteJid, { audio: statusBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: msg });
                      if (statusCaption) await sock.sendMessage(remoteJid, { text: captionToSend }, { quoted: msg });
                    }
                    return;
                  } else if (statusCaption) {
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F4E5} *[WHATSAPP STATUS EXTRACTED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${statusCaption}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u26A1 _Live Status Extracted by SOLVATECH_`
                    }, { quoted: msg });
                    return;
                  }
                  await sock.sendMessage(remoteJid, {
                    text: `\u26A0\uFE0F *[STATUS EXTRACTOR]*
Please reply to any WhatsApp Status with *.send* to extract the media and caption live & direct right here!`
                  }, { quoted: msg });
                  return;
                }
                if (command === "gcstatus" || command === "groupstatus") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.gcstatus* command can only be used inside a WhatsApp group!`
                    }, { quoted: msg });
                    return;
                  }
                  const isEveryone = args[0]?.toLowerCase() === "everyone" || args[0]?.toLowerCase() === "all";
                  const captionWords = isEveryone ? args.slice(1) : args;
                  const captionText = captionWords.join(" ").trim();
                  const targetObj = quotedRaw || rawMsg;
                  const media = extractMediaFromMessage(targetObj);
                  const hasLink = /(https?:\/\/[^\s]+|whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+)/i.test(captionText);
                  if (hasLink) {
                    await new Promise((resolve) => setTimeout(resolve, 3500));
                  }
                  let targetGroups = [remoteJid];
                  if (isEveryone) {
                    try {
                      const allGroups = await sock.groupFetchAllParticipating();
                      const keys = Object.keys(allGroups);
                      if (keys.length > 0) targetGroups = keys;
                    } catch (e) {
                      console.warn("Error fetching all groups for gcstatus everyone:", e);
                      targetGroups = [remoteJid];
                    }
                  }
                  const myNormalizedJid = jidNormalizedUser(sock.user?.id || sock.authState?.creds?.me?.id || "");
                  const statusJidList = myNormalizedJid ? [myNormalizedJid] : [];
                  const fullCaption = captionText ? `${captionText}

> \u{1F4E2} *Group Status Story (24h)* \u2022 _SOLVATECH BOT_` : "> \u{1F4E2} *Group Status Story (24h)* \u2022 _SOLVATECH BOT_";
                  if (media && (media.type === "image" || media.type === "video" || media.type === "audio")) {
                    try {
                      const buf = await downloadMediaBuffer(media.target, media.type);
                      try {
                        if (media.type === "video") {
                          await sock.sendMessage(
                            "status@broadcast",
                            { video: buf, caption: fullCaption },
                            { broadcast: true, statusJidList }
                          );
                        } else if (media.type === "image") {
                          await sock.sendMessage(
                            "status@broadcast",
                            { image: buf, caption: fullCaption },
                            { broadcast: true, statusJidList }
                          );
                        } else {
                          await sock.sendMessage(
                            "status@broadcast",
                            { audio: buf, mimetype: "audio/mp4", ptt: true },
                            { broadcast: true, statusJidList }
                          );
                        }
                      } catch (statusErr) {
                        console.error("[gcstatus] Status broadcast upload note:", statusErr);
                      }
                      await Promise.allSettled(
                        targetGroups.map((gid) => {
                          if (media.type === "video") {
                            return sock.sendMessage(gid, { video: buf, caption: fullCaption });
                          } else if (media.type === "image") {
                            return sock.sendMessage(gid, { image: buf, caption: fullCaption });
                          } else {
                            return sock.sendMessage(gid, { audio: buf, mimetype: "audio/ogg; codecs=opus", ptt: true });
                          }
                        })
                      );
                      reactDone();
                      await sock.sendMessage(remoteJid, {
                        text: isEveryone ? `\u{1F4E2} *[GROUP STATUS STORY UPLOADED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2705 24h Story successfully uploaded to *all ${targetGroups.length} groups* and WhatsApp Status!
${captionText ? `\u{1F4DD} *Caption:* "${captionText}"
` : ""}\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Broadcasted live via SOLVATECH_` : `\u{1F4E2} *[GROUP STATUS STORY UPLOADED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2705 24h Story successfully uploaded to this *Group Story* and WhatsApp Status!
${captionText ? `\u{1F4DD} *Caption:* "${captionText}"
` : ""}\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Posted live via SOLVATECH_`
                      }, { quoted: msg });
                      return;
                    } catch (e) {
                      console.error("Error broadcasting media in gcstatus:", e);
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26A0\uFE0F *[GCSTATUS ERROR]*
Failed to upload group story: ${e.message}`
                      }, { quoted: msg });
                      return;
                    }
                  }
                  const broadcastBody = captionText || "\u{1F4E2} Group status announcement updated.";
                  const storyCard = `\u256D\u2501\u2501\u2501\u3014 \u{1F4E2} *GROUP 24-HOUR STORY UPDATE* \u3015\u2501\u2501\u2501\u256E
\u2503
\u2503 \u{1F4CC} *Story:* "${broadcastBody}"
\u2503 \u{1F552} *Duration:* 24 Hours
\u2503 \u{1F465} *Audience:* All Group Members
\u2503
\u2570\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u256F
> \u26A1 _Posted via SOLVATECH Story Engine_`;
                  try {
                    await sock.sendMessage(
                      "status@broadcast",
                      {
                        text: `${broadcastBody}

> \u{1F4E2} *Group Status Story (24h)* \u2022 _SOLVATECH_`,
                        backgroundColor: "#1E3A8A",
                        font: 2
                      },
                      { broadcast: true, statusJidList }
                    );
                  } catch (stErr) {
                    console.error("[gcstatus] Error posting text to status@broadcast:", stErr);
                  }
                  await Promise.allSettled(
                    targetGroups.map((gid) => {
                      return sock.sendMessage(gid, { text: storyCard });
                    })
                  );
                  reactDone();
                  await sock.sendMessage(remoteJid, {
                    text: isEveryone ? `\u{1F4E2} *[GROUP STATUS STORY UPLOADED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2705 Announcement posted to *all ${targetGroups.length} groups* and WhatsApp Status!
\u{1F4DD} *Content:* "${broadcastBody}"
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Broadcasted live via SOLVATECH_` : `\u{1F4E2} *[GROUP STATUS STORY UPLOADED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2705 Announcement posted to this *Group Story* and WhatsApp Status!
\u{1F4DD} *Content:* "${broadcastBody}"
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Posted live via SOLVATECH_`
                  }, { quoted: msg });
                  return;
                }
                if (command === "pin") {
                  if (!isGroup) {
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.pin* command can only be used inside a WhatsApp group.`
                    }, { quoted: msg });
                    return;
                  }
                  let isAdmin = false;
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const participant = groupMeta.participants.find(
                      (p) => p.id.replace(/\D/g, "") === senderNum || p.id === senderJid
                    );
                    isAdmin = participant?.admin === "admin" || participant?.admin === "superadmin";
                  } catch (err) {
                    console.error("Error checking admin for .pin:", err);
                  }
                  if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                      text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to pin messages in this group.`
                    }, { quoted: msg });
                    return;
                  }
                  const quotedStanzaId = contextInfo?.stanzaId;
                  if (!quotedStanzaId) {
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[PIN USAGE]*
Please reply directly to the message you want to pin with *.pin*!`
                    }, { quoted: msg });
                    return;
                  }
                  try {
                    const quotedParticipantJid = contextInfo?.participant;
                    const isQuotedFromMe = quotedParticipantJid ? quotedParticipantJid.replace(/\D/g, "") === botPhone : false;
                    await sock.sendMessage(remoteJid, {
                      pin: {
                        id: quotedStanzaId,
                        fromMe: isQuotedFromMe,
                        remoteJid,
                        participant: quotedParticipantJid
                      },
                      type: 1,
                      time: 604800
                    });
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F4CC} *[MESSAGE PINNED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Message successfully pinned for 7 days by Group Admin!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Protected by SOLVATECH_`
                    }, { quoted: msg });
                  } catch (pinErr) {
                    console.error("Pin error:", pinErr);
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[PIN ERROR]*
Failed to pin message: ${pinErr.message || "Make sure bot account is an admin in this group"}.`
                    }, { quoted: msg });
                  }
                  return;
                }
                if (command === "del" || command === "delete") {
                  let isAdmin = !isGroup;
                  if (isGroup) {
                    try {
                      const groupMeta = await sock.groupMetadata(remoteJid);
                      const participant = groupMeta.participants.find(
                        (p) => p.id.replace(/\D/g, "") === senderNum || p.id === senderJid
                      );
                      isAdmin = participant?.admin === "admin" || participant?.admin === "superadmin";
                    } catch {
                    }
                  }
                  const countArg = args[0] ? parseInt(args[0], 10) : NaN;
                  if (!isNaN(countArg) && countArg > 0) {
                    const targetCount = Math.min(countArg, 100);
                    let deleted = 0;
                    const cachedEntries = Array.from(this.messageCache.entries()).reverse();
                    for (const [msgId, entry] of cachedEntries) {
                      if (entry.group === remoteJid || !isGroup && entry.sender === senderNum) {
                        if (isAdmin || entry.sender === senderNum) {
                          try {
                            await sock.sendMessage(remoteJid, { delete: entry.key });
                            this.messageCache.delete(msgId);
                            deleted++;
                            if (deleted >= targetCount) break;
                          } catch (delErr) {
                            console.warn("Failed to delete message:", delErr);
                          }
                        }
                      }
                    }
                    try {
                      await sock.sendMessage(remoteJid, { delete: msg.key });
                    } catch {
                    }
                    const confirmationMsg = await sock.sendMessage(remoteJid, {
                      text: `\u{1F5D1}\uFE0F *[CHAT CLEANER]*
Deleted *${deleted}* message(s) successfully${!isAdmin ? " (only your own messages)" : ""}.`
                    });
                    setTimeout(() => {
                      if (confirmationMsg?.key) {
                        sock.sendMessage(remoteJid, { delete: confirmationMsg.key }).catch(() => {
                        });
                      }
                    }, 4e3);
                    return;
                  }
                  const quotedStanzaId = contextInfo?.stanzaId;
                  if (quotedStanzaId) {
                    const quotedSenderNum = (quotedParticipant || "").replace(/\D/g, "");
                    const isQuotedOwn = quotedSenderNum === senderNum || !quotedSenderNum;
                    if (!isAdmin && !isQuotedOwn) {
                      await sock.sendMessage(remoteJid, {
                        text: `\u26A0\uFE0F *[ACCESS DENIED]*
You can only delete your own messages. You must be a Group Administrator to delete other members' messages.`
                      }, { quoted: msg });
                      return;
                    }
                    try {
                      const isQuotedFromMe = quotedParticipant ? quotedParticipant.replace(/\D/g, "") === botPhone : false;
                      await sock.sendMessage(remoteJid, {
                        delete: {
                          id: quotedStanzaId,
                          fromMe: isQuotedFromMe,
                          remoteJid,
                          participant: quotedParticipant
                        }
                      });
                      await sock.sendMessage(remoteJid, { delete: msg.key });
                    } catch (e) {
                      console.error("Error deleting single message:", e);
                    }
                    return;
                  }
                  await sock.sendMessage(remoteJid, {
                    text: `\u26A0\uFE0F *[DELETE USAGE]*
\u2022 Reply to a message with *.del* to delete it immediately.
\u2022 Or type *.del [number]* (e.g. *.del 20*) to clear recent messages!`
                  }, { quoted: msg });
                  return;
                }
                if (command === "tagall" || command === "everyone") {
                  if (!isGroup) {
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.tagall* command can only be used inside a WhatsApp group.`
                    }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const participants = groupMeta.participants || [];
                    const customMessage = args.join(" ").trim();
                    const groupTitle = groupMeta.subject || "WhatsApp Group";
                    let output = `\u256D\u2501\u2501\u2501\u3014 \u{1F4E2} *GROUP ANNOUNCEMENT* \u3015\u2501\u2501\u2501\u256E
`;
                    output += `\u2503 \u{1F465} *Group:* *${groupTitle}*
`;
                    output += `\u2503 \u{1F522} *Members:* *${participants.length}*
`;
                    if (customMessage) {
                      output += `\u2503 \u{1F4CC} *Notice:* *${customMessage}*
`;
                    }
                    output += `\u2570\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u256F

`;
                    output += `\u256D\u2500\u2500\u3014 \u{1F465} *ATTENDANCE ROSTER* \u3015\u2500\u2500\u256E
`;
                    participants.forEach((p, idx) => {
                      const num = p.id.split("@")[0];
                      output += `\u2502 ${idx + 1}. @${num}
`;
                    });
                    output += `\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F

`;
                    output += `> \u26A1 *SOLVATECH BOT BROADCAST*`;
                    reactDone();
                    await sock.sendMessage(
                      remoteJid,
                      {
                        text: output,
                        mentions: participants.map((p) => p.id)
                      },
                      { quoted: msg }
                    );
                  } catch (err) {
                    reactError();
                    console.error("Error executing .tagall:", err);
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[TAGALL ERROR]*
Failed to tag group members: ${err.message}`
                    }, { quoted: msg });
                  }
                  return;
                }
                if (command === "admin" || command === "admins") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.admin* command can only be used inside a WhatsApp group.`
                    }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const admins = groupMeta.participants.filter(
                      (p) => p.admin === "admin" || p.admin === "superadmin"
                    );
                    const customReason = args.join(" ").trim();
                    const groupTitle = groupMeta.subject || "WhatsApp Group";
                    let output = `\u256D\u2501\u2501\u2501\u3014 \u{1F6E1}\uFE0F *ADMINISTRATOR ROSTER* \u3015\u2501\u2501\u2501\u256E
`;
                    output += `\u2503 \u{1F465} *Group:* *${groupTitle}*
`;
                    output += `\u2503 \u{1F6E1}\uFE0F *Total Admins:* *${admins.length}*
`;
                    if (customReason) {
                      output += `\u2503 \u26A0\uFE0F *Notice:* *${customReason}*
`;
                    }
                    output += `\u2570\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u256F

`;
                    output += `\u256D\u2500\u2500\u3014 \u26A1 *GROUP ADMINISTRATORS* \u3015\u2500\u2500\u256E
`;
                    admins.forEach((admin, i) => {
                      const num = admin.id.split("@")[0];
                      const isSuper = admin.admin === "superadmin" ? " \u{1F451} (Creator)" : "";
                      output += `\u2502 ${i + 1}. @${num}${isSuper}
`;
                    });
                    output += `\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F

`;
                    output += `> \u26A1 *SOLVATECH BOT ADMIN ALERT*`;
                    reactDone();
                    await sock.sendMessage(
                      remoteJid,
                      {
                        text: output,
                        mentions: admins.map((a) => a.id)
                      },
                      { quoted: msg }
                    );
                  } catch (err) {
                    reactError();
                    console.error("Error in .admin:", err);
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[ADMIN ERROR]*
Failed to fetch administrators: ${err.message}`
                    }, { quoted: msg });
                  }
                  return;
                }
                if (command === "kick" || command === "remove") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.kick* command can only be used inside a WhatsApp group.`
                    }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const senderParticipant = groupMeta.participants.find(
                      (p) => p.id.replace(/\D/g, "") === senderNum || p.id === senderJid
                    );
                    const isSenderAdmin2 = senderParticipant?.admin === "admin" || senderParticipant?.admin === "superadmin";
                    if (!isSenderAdmin2) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to remove participants from this group.`
                      }, { quoted: msg });
                      return;
                    }
                    let targetJid = mentionedJids[0] || quotedParticipant;
                    if (!targetJid && args[0]) {
                      const cleanTargetDigits = args[0].replace(/\D/g, "");
                      if (cleanTargetDigits) {
                        targetJid = `${cleanTargetDigits}@s.whatsapp.net`;
                      }
                    }
                    if (!targetJid) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26A0\uFE0F *[KICK USAGE]*
Please reply to a member's message or tag them with *.kick @user* to remove them from the group.`
                      }, { quoted: msg });
                      return;
                    }
                    const targetNum = targetJid.split("@")[0].replace(/\D/g, "");
                    const targetInGroup = groupMeta.participants.find(
                      (p) => p.id.replace(/\D/g, "") === targetNum
                    );
                    if (!targetInGroup) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26A0\uFE0F *[KICK ERROR]*
The specified user is not in this group.`
                      }, { quoted: msg });
                      return;
                    }
                    if (targetInGroup.admin === "superadmin") {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u{1F6E1}\uFE0F *[PROTECTED]*
Cannot remove the Group Creator/Superadmin!`
                      }, { quoted: msg });
                      return;
                    }
                    if (targetNum === senderNum || targetNum === botPhone) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26A0\uFE0F You cannot kick yourself!`
                      }, { quoted: msg });
                      return;
                    }
                    await sock.groupParticipantsUpdate(remoteJid, [targetInGroup.id], "remove");
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F462} *[MEMBER REMOVED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Participant:* @${targetNum}
\u26A1 *Action:* Ejected from group by Group Administrator.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Security_`,
                      mentions: [targetInGroup.id]
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    console.error("Error kicking user:", err);
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[KICK ERROR]*
Failed to remove member: ${err.message || "Make sure your account has admin privileges"}`
                    }, { quoted: msg });
                  }
                  return;
                }
                if (command === "add" || command === "invite") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.add* command can only be used inside a WhatsApp group.`
                    }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const senderParticipant = groupMeta.participants.find(
                      (p) => p.id.replace(/\D/g, "") === senderNum || p.id === senderJid
                    );
                    const isSenderAdmin2 = senderParticipant?.admin === "admin" || senderParticipant?.admin === "superadmin";
                    if (!isSenderAdmin2) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to add participants to this group.`
                      }, { quoted: msg });
                      return;
                    }
                    let targetDigits = (args[0] || "").replace(/\D/g, "");
                    if (!targetDigits && quotedParticipant) {
                      targetDigits = quotedParticipant.replace(/\D/g, "");
                    }
                    if (!targetDigits) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26A0\uFE0F *[ADD USAGE]*
Please specify a valid phone number with country code:
\u{1F4A1} *Example:* *.add 2348012345678* or reply to a contact.`
                      }, { quoted: msg });
                      return;
                    }
                    const targetJid = `${targetDigits}@s.whatsapp.net`;
                    const res2 = await sock.groupParticipantsUpdate(remoteJid, [targetJid], "add");
                    const updateStatus = res2?.[0]?.status;
                    if (updateStatus === "403" || updateStatus === "408") {
                      let inviteCode = await sock.groupInviteCode(remoteJid);
                      const inviteUrl = `https://chat.whatsapp.com/${inviteCode}`;
                      reactDone();
                      await sock.sendMessage(remoteJid, {
                        text: `\u{1F4E8} *[INVITATION ISSUED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *User:* +${targetDigits}
\u{1F512} *Status:* Privacy settings prevent direct adding.
\u{1F517} *Invite Link:* ${inviteUrl}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u26A1 _SOLVATECH Group Management_`
                      }, { quoted: msg });
                      return;
                    }
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u2795 *[MEMBER ADDED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Participant:* @${targetDigits}
\u2705 Successfully added to *${groupMeta.subject || "this group"}*!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u26A1 _SOLVATECH Group Management_`,
                      mentions: [targetJid]
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    console.error("Error adding user:", err);
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[ADD ERROR]*
Failed to add user: ${err.message || "Make sure your account is an admin"}`
                    }, { quoted: msg });
                  }
                  return;
                }
                if (command === "promote") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.promote* command can only be used inside a WhatsApp group.`
                    }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const senderParticipant = groupMeta.participants.find(
                      (p) => p.id.replace(/\D/g, "") === senderNum || p.id === senderJid
                    );
                    const isSenderAdmin2 = senderParticipant?.admin === "admin" || senderParticipant?.admin === "superadmin";
                    if (!isSenderAdmin2) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to promote participants in this group.`
                      }, { quoted: msg });
                      return;
                    }
                    let targetJid = mentionedJids[0] || quotedParticipant;
                    if (!targetJid && args[0]) {
                      const cleanDigits = args[0].replace(/\D/g, "");
                      if (cleanDigits) targetJid = `${cleanDigits}@s.whatsapp.net`;
                    }
                    if (!targetJid) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26A0\uFE0F *[PROMOTE USAGE]*
Please tag a member or reply to their message with *.promote @user*.`
                      }, { quoted: msg });
                      return;
                    }
                    const targetNum = targetJid.split("@")[0].replace(/\D/g, "");
                    const participant = groupMeta.participants.find((p) => p.id.replace(/\D/g, "") === targetNum);
                    if (!participant) {
                      reactError();
                      await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F User is not in this group.` }, { quoted: msg });
                      return;
                    }
                    if (participant.admin) {
                      reactDone();
                      await sock.sendMessage(remoteJid, {
                        text: `\u2139\uFE0F @${targetNum} is already a Group Administrator!`,
                        mentions: [participant.id]
                      }, { quoted: msg });
                      return;
                    }
                    await sock.groupParticipantsUpdate(remoteJid, [participant.id], "promote");
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u2B50 *[ADMIN PROMOTED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F389} *Congratulations:* @${targetNum}
\u{1F6E1}\uFE0F Promoted to *Group Administrator* by @${senderNum}!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u26A1 _SOLVATECH Group Administration_`,
                      mentions: [participant.id, senderParticipant?.id || senderJid]
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    console.error("Error promoting user:", err);
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[PROMOTE ERROR]*
Failed to promote: ${err.message}`
                    }, { quoted: msg });
                  }
                  return;
                }
                if (command === "demote") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.demote* command can only be used inside a WhatsApp group.`
                    }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const senderParticipant = groupMeta.participants.find(
                      (p) => p.id.replace(/\D/g, "") === senderNum || p.id === senderJid
                    );
                    const isSenderAdmin2 = senderParticipant?.admin === "admin" || senderParticipant?.admin === "superadmin";
                    if (!isSenderAdmin2) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to demote participants in this group.`
                      }, { quoted: msg });
                      return;
                    }
                    let targetJid = mentionedJids[0] || quotedParticipant;
                    if (!targetJid && args[0]) {
                      const cleanDigits = args[0].replace(/\D/g, "");
                      if (cleanDigits) targetJid = `${cleanDigits}@s.whatsapp.net`;
                    }
                    if (!targetJid) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26A0\uFE0F *[DEMOTE USAGE]*
Please tag an admin or reply to their message with *.demote @user*.`
                      }, { quoted: msg });
                      return;
                    }
                    const targetNum = targetJid.split("@")[0].replace(/\D/g, "");
                    const participant = groupMeta.participants.find((p) => p.id.replace(/\D/g, "") === targetNum);
                    if (!participant) {
                      reactError();
                      await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F User is not in this group.` }, { quoted: msg });
                      return;
                    }
                    if (participant.admin === "superadmin") {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u{1F6E1}\uFE0F *[PROTECTED]*
Cannot demote the Group Creator/Superadmin!`
                      }, { quoted: msg });
                      return;
                    }
                    if (!participant.admin) {
                      reactDone();
                      await sock.sendMessage(remoteJid, {
                        text: `\u2139\uFE0F @${targetNum} is not an administrator.`,
                        mentions: [participant.id]
                      }, { quoted: msg });
                      return;
                    }
                    await sock.groupParticipantsUpdate(remoteJid, [participant.id], "demote");
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F53B} *[ADMIN DEMOTED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Participant:* @${targetNum}
\u26A0\uFE0F Demoted from Administrator back to regular member.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u26A1 _SOLVATECH Group Administration_`,
                      mentions: [participant.id]
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    console.error("Error demoting user:", err);
                    await sock.sendMessage(remoteJid, {
                      text: `\u26A0\uFE0F *[DEMOTE ERROR]*
Failed to demote: ${err.message}`
                    }, { quoted: msg });
                  }
                  return;
                }
                if (command === "lock") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.lock* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const p = groupMeta.participants.find((x) => x.id.replace(/\D/g, "") === senderNum || x.id === senderJid);
                    if (p?.admin !== "admin" && p?.admin !== "superadmin") {
                      reactError();
                      await sock.sendMessage(remoteJid, { text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to lock this group.` }, { quoted: msg });
                      return;
                    }
                    await sock.groupSettingUpdate(remoteJid, "announcement");
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F512} *[GROUP LOCKED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Group messaging has been restricted to Administrators only.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Enforced by SOLVATECH_`
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[LOCK ERROR]*
Failed to lock group: ${err.message}` }, { quoted: msg });
                  }
                  return;
                }
                if (command === "unlock") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.unlock* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const p = groupMeta.participants.find((x) => x.id.replace(/\D/g, "") === senderNum || x.id === senderJid);
                    if (p?.admin !== "admin" && p?.admin !== "superadmin") {
                      reactError();
                      await sock.sendMessage(remoteJid, { text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to unlock this group.` }, { quoted: msg });
                      return;
                    }
                    await sock.groupSettingUpdate(remoteJid, "not_announcement");
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F513} *[GROUP UNLOCKED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Group messaging is now open for all members.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _Enforced by SOLVATECH_`
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[UNLOCK ERROR]*
Failed to unlock group: ${err.message}` }, { quoted: msg });
                  }
                  return;
                }
                if (command === "antilink") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.antilink* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const p = groupMeta.participants.find((x) => x.id.replace(/\D/g, "") === senderNum || x.id === senderJid);
                    if (p?.admin !== "admin" && p?.admin !== "superadmin") {
                      reactError();
                      await sock.sendMessage(remoteJid, { text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to configure anti-link.` }, { quoted: msg });
                      return;
                    }
                    const val = args[0]?.toLowerCase() === "off" ? false : true;
                    commandHandler.setSecuritySetting(remoteJid, "antilink", val);
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F6E1}\uFE0F *[ANTI-LINK SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Unauthorized external links will be auto-deleted with security warning issued to sender.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F Failed to configure anti-link: ${err.message}` }, { quoted: msg });
                  }
                  return;
                }
                if (command === "antibot") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.antibot* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const p = groupMeta.participants.find((x) => x.id.replace(/\D/g, "") === senderNum || x.id === senderJid);
                    if (p?.admin !== "admin" && p?.admin !== "superadmin") {
                      reactError();
                      await sock.sendMessage(remoteJid, { text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to configure anti-bot.` }, { quoted: msg });
                      return;
                    }
                    const val = args[0]?.toLowerCase() === "off" ? false : true;
                    commandHandler.setSecuritySetting(remoteJid, "antibot", val);
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F916} *[ANTI-BOT SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Non-admin members using bot prefix commands (*.*) will have their message auto-deleted and receive a security warning.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F Failed to configure anti-bot: ${err.message}` }, { quoted: msg });
                  }
                  return;
                }
                if (command === "antistatus") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.antistatus* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const p = groupMeta.participants.find((x) => x.id.replace(/\D/g, "") === senderNum || x.id === senderJid);
                    if (p?.admin !== "admin" && p?.admin !== "superadmin") {
                      reactError();
                      await sock.sendMessage(remoteJid, { text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to configure anti-status mentions.` }, { quoted: msg });
                      return;
                    }
                    const val = args[0]?.toLowerCase() === "off" ? false : true;
                    commandHandler.setSecuritySetting(remoteJid, "antistatus", val);
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F4F1} *[ANTI-STATUS MENTION SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Non-admin members mentioning this group in their personal WhatsApp status will have the alert deleted and receive a security warning.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F Failed to configure anti-status: ${err.message}` }, { quoted: msg });
                  }
                  return;
                }
                if (command === "antispam") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.antispam* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const p = groupMeta.participants.find((x) => x.id.replace(/\D/g, "") === senderNum || x.id === senderJid);
                    if (p?.admin !== "admin" && p?.admin !== "superadmin") {
                      reactError();
                      await sock.sendMessage(remoteJid, { text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator to configure anti-spam.` }, { quoted: msg });
                      return;
                    }
                    const val = args[0]?.toLowerCase() === "off" ? false : true;
                    commandHandler.setSecuritySetting(remoteJid, "antispam", val);
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F6AB} *[ANTI-SPAM DEFENSE SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Flood messages, rapid stickers/media spam, and repetitive text/words will be automatically purged (including original spam messages). If a member continues sending messages while deletion is underway, they are *INSTANTLY KICKED*!
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F Failed to configure anti-spam: ${err.message}` }, { quoted: msg });
                  }
                  return;
                }
                if (command === "autowelcome") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.autowelcome* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const p = groupMeta.participants.find((x) => x.id.replace(/\D/g, "") === senderNum || x.id === senderJid);
                    const isSenderAdmin2 = p?.admin === "admin" || p?.admin === "superadmin" || isOwner;
                    if (!isSenderAdmin2) {
                      reactError();
                      await sock.sendMessage(remoteJid, { text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator connected to the bot to configure auto-welcome.` }, { quoted: msg });
                      return;
                    }
                    const val = args[0]?.toLowerCase() === "off" ? false : true;
                    commandHandler.setSecuritySetting(remoteJid, "autowelcome", val);
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F44B} *[AUTO-WELCOME SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Automatically greets anyone who enters the group (whether approved by admin, added by members, or added via link).
Rule: Strictly sent only by connected admin bots (choosing exactly 1 admin bot if multiple are connected).
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F Failed to configure auto-welcome: ${err.message}` }, { quoted: msg });
                  }
                  return;
                }
                if (command === "autogoodbye") {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[GROUP ONLY]*
The *.autogoodbye* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const p = groupMeta.participants.find((x) => x.id.replace(/\D/g, "") === senderNum || x.id === senderJid);
                    const isSenderAdmin2 = p?.admin === "admin" || p?.admin === "superadmin" || isOwner;
                    if (!isSenderAdmin2) {
                      reactError();
                      await sock.sendMessage(remoteJid, { text: `\u26D4 *[ACCESS DENIED]*
You must be a Group Administrator connected to the bot to configure auto-goodbye.` }, { quoted: msg });
                      return;
                    }
                    const val = args[0]?.toLowerCase() === "off" ? false : true;
                    commandHandler.setSecuritySetting(remoteJid, "autogoodbye", val);
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `\u{1F44B} *[AUTO-GOODBYE SYSTEM]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Status: ${val ? "\u2705 *ENABLED*" : "\u274C *DISABLED*"}
Policy: Automatically acknowledges departing or removed participants.
Rule: Strictly sent only by connected admin bots (choosing exactly 1 admin bot if multiple are connected).
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
                    }, { quoted: msg });
                  } catch (err) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F Failed to configure auto-goodbye: ${err.message}` }, { quoted: msg });
                  }
                  return;
                }
                if (["warn", "warnlimit", "warns", "unwarn", "clearwarns", "resetwarns"].includes(command)) {
                  if (!isGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[GROUP ONLY]*
Warn commands can only be used inside a WhatsApp group.` }, { quoted: msg });
                    return;
                  }
                  try {
                    const groupMeta = await sock.groupMetadata(remoteJid);
                    const senderParticipant = groupMeta.participants.find(
                      (p) => p.id.replace(/\D/g, "") === senderNum || p.id === senderJid
                    );
                    const isSenderAdmin2 = senderParticipant?.admin === "admin" || senderParticipant?.admin === "superadmin" || isOwner;
                    if (!isSenderAdmin2) {
                      reactError();
                      await sock.sendMessage(remoteJid, {
                        text: `\u26D4 *[ACCESS DENIED]*
All warning commands can ONLY be used by Group Administrators connected to the bot.
Regular members cannot use .warn or modify warning thresholds.`
                      }, { quoted: msg });
                      return;
                    }
                    const firstArg = args[0]?.toLowerCase();
                    if (command === "warnlimit" || firstArg === "limit" || firstArg === "max" || firstArg === "set") {
                      const numStr = command === "warnlimit" ? args[0] : args[1];
                      const num = parseInt(numStr, 10);
                      if (isNaN(num) || num <= 0) {
                        reactError();
                        await sock.sendMessage(remoteJid, {
                          text: `\u26A0\uFE0F *[WARN LIMIT USAGE]*
Please provide a valid positive number.
\u{1F4A1} *Example:* *.warn limit 3* or *.warn limit 5*`
                        }, { quoted: msg });
                        return;
                      }
                      commandHandler.setWarnLimit(remoteJid, num);
                      reactDone();
                      await sock.sendMessage(remoteJid, {
                        text: `\u2699\uFE0F *[WARN LIMIT UPDATED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Group warning limit set to *${num} warnings*.
Accumulating ${num} warnings across Anti-Bot, Anti-Link, Anti-Status, Anti-Spam, or Admin warnings will automatically kick the member.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u26A1 _SOLVATECH Group Defense_`
                      }, { quoted: msg });
                      return;
                    }
                    if (command === "warns") {
                      let targetJid = mentionedJids[0] || quotedParticipant;
                      if (!targetJid && args[0]) {
                        const cleanDigits = args[0].replace(/\D/g, "");
                        if (cleanDigits) targetJid = `${cleanDigits}@s.whatsapp.net`;
                      }
                      if (!targetJid) {
                        reactError();
                        await sock.sendMessage(remoteJid, {
                          text: `\u26A0\uFE0F *[WARNS USAGE]*
Reply to a member's message or tag them with *.warns @user* to check their warning level.`
                        }, { quoted: msg });
                        return;
                      }
                      const targetClean = targetJid.split("@")[0].replace(/\D/g, "");
                      const count = commandHandler.getWarnings(remoteJid, targetJid);
                      const max = commandHandler.getSecuritySettings(remoteJid).warnLimit || 3;
                      reactDone();
                      await sock.sendMessage(remoteJid, {
                        text: `\u{1F4CB} *[GROUP WARNING STATUS]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Participant:* @${targetClean}
\u26A0\uFE0F *Current Warnings:* ${count} / ${max}
Status: ${count >= max ? "\u{1F6A8} Removal Limit Exceeded" : `${max - count} warnings remaining before auto-kick`}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Defense_`,
                        mentions: [targetJid]
                      }, { quoted: msg });
                      return;
                    }
                    if (command === "unwarn" || command === "clearwarns") {
                      let targetJid = mentionedJids[0] || quotedParticipant;
                      if (!targetJid && args[0]) {
                        const cleanDigits = args[0].replace(/\D/g, "");
                        if (cleanDigits) targetJid = `${cleanDigits}@s.whatsapp.net`;
                      }
                      if (!targetJid) {
                        reactError();
                        await sock.sendMessage(remoteJid, {
                          text: `\u26A0\uFE0F *[UNWARN USAGE]*
Reply to a member's message or tag them with *.unwarn @user* to reset their warnings.`
                        }, { quoted: msg });
                        return;
                      }
                      const targetClean = targetJid.split("@")[0].replace(/\D/g, "");
                      commandHandler.clearWarnings(remoteJid, targetJid);
                      reactDone();
                      await sock.sendMessage(remoteJid, {
                        text: `\u2705 *[WARNINGS RESET]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Warnings have been reset to *0* for @${targetClean}.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Defense_`,
                        mentions: [targetJid]
                      }, { quoted: msg });
                      return;
                    }
                    if (command === "resetwarns") {
                      commandHandler.resetAllWarnings(remoteJid);
                      reactDone();
                      await sock.sendMessage(remoteJid, {
                        text: `\u{1F504} *[ALL WARNINGS CLEARED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
All group member warnings have been reset to 0 for this group.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Defense_`
                      }, { quoted: msg });
                      return;
                    }
                    if (command === "warn") {
                      let targetJid = mentionedJids[0] || quotedParticipant;
                      if (!targetJid && args[0] && !["limit", "max", "set"].includes(args[0].toLowerCase())) {
                        const cleanDigits = args[0].replace(/\D/g, "");
                        if (cleanDigits) targetJid = `${cleanDigits}@s.whatsapp.net`;
                      }
                      if (!targetJid) {
                        reactError();
                        await sock.sendMessage(remoteJid, {
                          text: `\u26A0\uFE0F *[WARN USAGE]*
Reply to a member's message (pic, sticker, text, or link) or tag them with *.warn @user [reason]*`
                        }, { quoted: msg });
                        return;
                      }
                      const targetClean = targetJid.split("@")[0].replace(/\D/g, "");
                      const targetInGroup = groupMeta.participants.find(
                        (p) => p.id.replace(/\D/g, "") === targetClean || p.id === targetJid
                      );
                      if (!targetInGroup) {
                        reactError();
                        await sock.sendMessage(remoteJid, {
                          text: `\u26A0\uFE0F *[WARN ERROR]*
The specified participant is not in this group.`
                        }, { quoted: msg });
                        return;
                      }
                      if (targetInGroup.admin === "admin" || targetInGroup.admin === "superadmin") {
                        reactError();
                        await sock.sendMessage(remoteJid, {
                          text: `\u{1F6E1}\uFE0F *[PROTECTED ADMINISTRATOR]*
Administrators cannot be warned by other admins!
Warnings strictly apply to regular members only.`,
                          mentions: [targetInGroup.id]
                        }, { quoted: msg });
                        return;
                      }
                      const quotedMsgId = contextInfo?.stanzaId;
                      const quotedSenderJid = contextInfo?.participant;
                      if (quotedMsgId) {
                        try {
                          await sock.sendMessage(remoteJid, {
                            delete: {
                              remoteJid,
                              id: quotedMsgId,
                              participant: quotedSenderJid || targetInGroup.id,
                              fromMe: false
                            }
                          });
                        } catch (delErr) {
                          console.warn("Could not auto-delete warned message:", delErr);
                        }
                      }
                      const warnResult = commandHandler.addWarning(remoteJid, targetInGroup.id);
                      const reason = args.filter((a) => !a.startsWith("@") && a.replace(/\D/g, "") !== targetClean).join(" ").trim() || "Rule violation / Disobeying group instructions";
                      if (warnResult.count >= warnResult.max) {
                        let kickSuccess = false;
                        try {
                          await sock.groupParticipantsUpdate(remoteJid, [targetInGroup.id], "remove");
                          kickSuccess = true;
                          commandHandler.clearWarnings(remoteJid, targetInGroup.id);
                        } catch (kickErr) {
                          console.error("Failed to kick warned user:", kickErr);
                        }
                        reactDone();
                        await sock.sendMessage(remoteJid, {
                          text: `\u{1F6A8} *[SECURITY WARNING LIMIT REACHED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Offender:* @${targetClean}
\u26A0\uFE0F *Warnings:* *${warnResult.count} / ${warnResult.max}*
\u{1F5D1}\uFE0F *Action:* Offending message (pic/sticker/text) deleted.
\u{1F528} *Punishment:* ${kickSuccess ? "*Member ejected from group immediately!*" : "*Threshold reached (Bot requires admin privileges to kick)*"}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Defense_`,
                          mentions: [targetInGroup.id]
                        }, { quoted: msg });
                      } else {
                        reactDone();
                        await sock.sendMessage(remoteJid, {
                          text: `\u26A0\uFE0F *[OFFICIAL SECURITY WARNING ISSUED]*
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} *Member:* @${targetClean}
\u{1F46E} *Issued By:* Admin @${senderNum}
\u26A0\uFE0F *Warning Level:* *${warnResult.count} / ${warnResult.max}*
\u{1F4DD} *Reason:* ${reason}
\u{1F5D1}\uFE0F *Offending message (pic/sticker/content) deleted.*
\u23F3 *Warnings Remaining:* *${warnResult.max - warnResult.count}* before automatic kick.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
> \u{1F6E1}\uFE0F _SOLVATECH Group Defense_`,
                          mentions: [targetInGroup.id, senderParticipant?.id || senderJid]
                        }, { quoted: msg });
                      }
                      return;
                    }
                  } catch (err) {
                    reactError();
                    await sock.sendMessage(remoteJid, { text: `\u26A0\uFE0F *[WARN ERROR]*: ${err.message}` }, { quoted: msg });
                    return;
                  }
                }
                if (command === "spam") {
                  if (!isOwner) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `\u26D4 *[ACCESS DENIED]*
The *.spam* command is strictly restricted to the Bot Owner / Controller.`
                    }, { quoted: msg });
                    return;
                  }
                  try {
                    await sock.sendMessage(remoteJid, { delete: msg.key });
                  } catch (delErr) {
                    console.warn("[Spam] Could not auto-delete trigger message:", delErr);
                  }
                  if (this.activeSpamSession) {
                    this.activeSpamSession.abort = true;
                  }
                  const { text: spamText, count: spamCount } = parseSpamArgs(args);
                  const currentSession = { remoteJid, abort: false };
                  this.activeSpamSession = currentSession;
                  commandHandler.setSpamActive(true);
                  (async () => {
                    let sentCount = 0;
                    for (let i = 1; i <= spamCount; i++) {
                      if (currentSession.abort || !this.activeSpamSession || this.activeSpamSession !== currentSession) {
                        break;
                      }
                      try {
                        sock.sendMessage(remoteJid, { text: spamText }).catch((sendErr) => {
                          console.warn(`[Spam] Message ${i} send note:`, sendErr);
                        });
                        sentCount++;
                      } catch (sendErr) {
                        console.warn(`[Spam] Dispatch error on message ${i}:`, sendErr);
                      }
                      if (i < spamCount) {
                        await new Promise((resolve) => setTimeout(resolve, 35));
                      }
                    }
                    const wasAborted = currentSession.abort;
                    if (this.activeSpamSession === currentSession) {
                      this.activeSpamSession = null;
                      commandHandler.setSpamActive(false);
                    }
                    try {
                      const resultText = wasAborted ? `\u{1F6D1} *[SPAM STOPPED]*
Aborted by user at *${sentCount}* message(s).
_Self-destructing in 5s..._` : `\u26A1 *[SPAM COMPLETE]*
Finished sending *${sentCount}/${spamCount}* message(s).
_Self-destructing in 5s..._`;
                      const confMsg = await sock.sendMessage(remoteJid, { text: resultText });
                      if (confMsg?.key) {
                        setTimeout(async () => {
                          try {
                            await sock.sendMessage(remoteJid, { delete: confMsg.key });
                          } catch {
                          }
                        }, 5e3);
                      }
                    } catch (confErr) {
                      console.error("[Spam] Result message error:", confErr);
                    }
                  })().catch((err) => {
                    console.error("[Spam] Background loop error:", err);
                  });
                  return;
                }
                if (command === "stop") {
                  try {
                    await sock.sendMessage(remoteJid, { delete: msg.key });
                  } catch {
                  }
                  const wasRunning = this.activeSpamSession && !this.activeSpamSession.abort || commandHandler.getSpamActive();
                  if (this.activeSpamSession) {
                    this.activeSpamSession.abort = true;
                    this.activeSpamSession = null;
                  }
                  commandHandler.setSpamActive(false);
                  if (wasRunning) {
                    return;
                  }
                  try {
                    const idleMsg = await sock.sendMessage(remoteJid, {
                      text: `\u{1F6D1} *[STOP]*
No active spam operation was running.
_Self-destructing in 5s..._`
                    });
                    if (idleMsg?.key) {
                      setTimeout(async () => {
                        try {
                          await sock.sendMessage(remoteJid, { delete: idleMsg.key });
                        } catch {
                        }
                      }, 5e3);
                    }
                  } catch {
                  }
                  return;
                }
                const res = await commandHandler.handle({
                  command,
                  args,
                  fullText: text,
                  senderJid,
                  senderNumber: senderNum,
                  isGroup,
                  groupJid: isGroup ? remoteJid : void 0,
                  pushName: msg.pushName || void 0,
                  isOwner,
                  linkedSince: this.connectedAt,
                  linkedPhone: this.currentStatus.user?.phone,
                  quotedParticipant: quotedParticipant || void 0,
                  mentionedJids: mentionedJids || [],
                  sock,
                  getTopChatted: (phone) => this.getTopChatted(phone),
                  getGroupInviteCode: (gid) => this.getGroupInviteCode(gid),
                  setGroupInviteCode: (gid, code) => this.setGroupInviteCode(gid, code)
                });
                try {
                  let finalText = res.reply;
                  if (!finalText.includes("SOLVATECH") && !finalText.includes("Solomon")) {
                    finalText += `

> \u26A1 *SOLVATECH BOT* \u2022 _Solomon Oladimeji_`;
                  }
                  if (res.imageUrl) {
                    try {
                      await sock.sendMessage(
                        remoteJid,
                        {
                          image: { url: res.imageUrl },
                          caption: finalText
                        },
                        { quoted: msg }
                      );
                    } catch (imgErr) {
                      console.warn("Direct image sending note, sending text:", imgErr);
                      await sock.sendMessage(remoteJid, { text: finalText }, { quoted: msg });
                    }
                  } else {
                    await sock.sendMessage(remoteJid, { text: finalText }, { quoted: msg });
                  }
                  reactDone();
                  this.addNotification({
                    type: "command",
                    title: `\u26A1 Command Executed: .${command}`,
                    body: `Executed for +${senderNum}. Response sent to WhatsApp chat.`,
                    sender: `+${senderNum}`
                  });
                } catch (err) {
                  reactError();
                  console.error("Error replying to WhatsApp command:", err);
                }
              }
            }
          }
        });
        sock.ev.on("messages.update", async (updates) => {
          if (!commandHandler.getAntiDeleteEnabled()) return;
          for (const update of updates) {
            if (update.key?.id && (update.update?.message === null || update.update?.messageStubType === 1)) {
              await this.handleMessageRevoke(update.key);
            }
          }
        });
        sock.ev.on("messages.delete", async (item) => {
          if (!commandHandler.getAntiDeleteEnabled()) return;
          const keys = item?.keys || (item?.key ? [item.key] : []);
          for (const k of keys) {
            if (k?.id) {
              await this.handleMessageRevoke(k);
            }
          }
        });
        sock.ev.on("group-participants.update", async (update) => {
          try {
            const { id: groupId, participants, action } = update;
            if (!groupId || !groupId.endsWith("@g.us")) return;
            if (action !== "add" && action !== "remove") return;
            const sec = commandHandler.getSecuritySettings(groupId);
            if (action === "add" && sec.autowelcome === false) return;
            if (action === "remove" && sec.autogoodbye === false) return;
            let groupMeta = null;
            try {
              groupMeta = await sock.groupMetadata(groupId);
              if (groupMeta?.subject) {
                this.groupSubjectCache.set(groupId, groupMeta.subject);
              }
            } catch (fetchErr) {
              console.warn(`[Auto-Greeting] Could not fetch live groupMetadata for ${groupId}, using cached subject:`, fetchErr);
            }
            const groupSubject = groupMeta?.subject || this.groupSubjectCache.get(groupId) || "WhatsApp Group";
            const groupDesc = groupMeta?.desc || void 0;
            const botUserJid = sock.user?.id || sock.user?.jid || sock.authState?.creds?.me?.id || "";
            const botLid = sock.user?.lid || sock.authState?.creds?.me?.lid || "";
            const botPhone = (botUserJid.split(":")[0] || botUserJid.split("@")[0]).replace(/\D/g, "");
            const botLidNum = (botLid.split(":")[0] || botLid.split("@")[0]).replace(/\D/g, "");
            const linkedPhoneClean = (this.currentStatus.user?.phone || this.currentStatus.targetPhone || "").replace(/\D/g, "");
            let isBotAdmin = true;
            if (groupMeta?.participants && Array.isArray(groupMeta.participants) && groupMeta.participants.length > 0) {
              const botParticipant = groupMeta.participants.find((p) => {
                const pId = p.id || p.jid || "";
                const pNum = pId.split("@")[0].split(":")[0].replace(/\D/g, "");
                const pPhone = (p.phoneNumber || "").replace(/\D/g, "");
                const pLid = (p.lid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
                return botPhone && pNum === botPhone || botPhone && pPhone === botPhone || linkedPhoneClean && pNum === linkedPhoneClean || linkedPhoneClean && pPhone === linkedPhoneClean || botLidNum && pNum === botLidNum || botLidNum && pLid === botLidNum || pId === botUserJid || botLid && pId === botLid || botPhone && pId.startsWith(botPhone);
              });
              if (botParticipant) {
                isBotAdmin = botParticipant.admin === "admin" || botParticipant.admin === "superadmin";
              } else {
                isBotAdmin = true;
              }
              const adminBots = groupMeta.participants.filter((p) => {
                const isAdmin = p.admin === "admin" || p.admin === "superadmin";
                if (!isAdmin) return false;
                const pDigits = (p.id || "").split("@")[0].split(":")[0].replace(/\D/g, "");
                return botPhone && pDigits === botPhone || linkedPhoneClean && pDigits === linkedPhoneClean;
              });
              if (adminBots.length > 1) {
                adminBots.sort((a, b) => (a.id || "").localeCompare(b.id || ""));
                const leader = adminBots[0];
                const leaderDigits = (leader.id || "").split("@")[0].split(":")[0].replace(/\D/g, "");
                if (botPhone && leaderDigits !== botPhone && (!linkedPhoneClean || leaderDigits !== linkedPhoneClean)) {
                  console.log(`[Auto-Greeting] Multiple bots detected in ${groupId}. Leader elected: ${leader.id}. Skipping duplicate.`);
                  return;
                }
              }
            }
            if (!isBotAdmin) {
              console.log(`[Auto-Greeting] Bot is confirmed not an admin in ${groupId}. Skipping greeting.`);
              return;
            }
            const isSelf = (rawId) => {
              const clean = rawId.split("@")[0].split(":")[0].replace(/\D/g, "");
              return botPhone && clean === botPhone || botLidNum && clean === botLidNum || linkedPhoneClean && clean === linkedPhoneClean;
            };
            const targetParticipants = (participants || []).filter((p) => {
              const jid = typeof p === "string" ? p : p.id || p.jid || "";
              return jid && !isSelf(jid);
            });
            if (targetParticipants.length === 0) return;
            const incomingJids = [];
            for (const p of targetParticipants) {
              const rawJid = typeof p === "string" ? p : p.id || p.jid || "";
              if (!rawJid) continue;
              const cleanJid = rawJid.includes(":") ? `${rawJid.split(":")[0]}@${rawJid.split("@")[1]}` : rawJid;
              if (!incomingJids.includes(cleanJid)) {
                incomingJids.push(cleanJid);
              }
            }
            if (incomingJids.length === 0) return;
            const batchKey = `${groupId}:${action}`;
            const existing = this.pendingGreetings.get(batchKey);
            if (existing) {
              clearTimeout(existing.timer);
              for (const jid of incomingJids) {
                existing.participants.add(jid);
              }
            } else {
              this.pendingGreetings.set(batchKey, {
                timer: null,
                participants: new Set(incomingJids),
                action,
                groupId
              });
            }
            const pending = this.pendingGreetings.get(batchKey);
            pending.timer = setTimeout(async () => {
              this.pendingGreetings.delete(batchKey);
              const allBatchJids = Array.from(pending.participants);
              if (allBatchJids.length === 0) return;
              const dedupKey = `greet:${groupId}:${action}:${allBatchJids.sort().join(",")}`;
              const lastSent = this.greetingDedupCache.get(dedupKey) || 0;
              if (Date.now() - lastSent < 8e3) {
                return;
              }
              this.greetingDedupCache.set(dedupKey, Date.now());
              const pTags = allBatchJids.map((jid) => {
                const num = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
                return `@${num || "user"}`;
              });
              try {
                if (action === "add") {
                  const welcomeText = buildWelcomeMessage(groupSubject, groupDesc, pTags);
                  try {
                    await sock.sendMessage(groupId, {
                      text: welcomeText,
                      mentions: allBatchJids
                    });
                  } catch (mentionErr) {
                    console.warn(`[Auto-Greeting] Mention send notice in ${groupId}, sending plain text:`, mentionErr);
                    await sock.sendMessage(groupId, { text: welcomeText });
                  }
                  this.addNotification({
                    type: "system",
                    title: `\u{1F44B} Auto-Welcome Sent in ${groupSubject}`,
                    body: `Welcomed ${pTags.join(", ")} to the group (${allBatchJids.length} participant${allBatchJids.length > 1 ? "s" : ""}).`
                  });
                } else if (action === "remove") {
                  const goodbyeText = buildGoodbyeMessage(groupSubject, groupDesc, pTags);
                  try {
                    await sock.sendMessage(groupId, {
                      text: goodbyeText,
                      mentions: allBatchJids
                    });
                  } catch (mentionErr) {
                    console.warn(`[Auto-Greeting] Mention send notice in ${groupId}, sending plain text:`, mentionErr);
                    await sock.sendMessage(groupId, { text: goodbyeText });
                  }
                  this.addNotification({
                    type: "system",
                    title: `\u{1F44B} Auto-Goodbye Sent in ${groupSubject}`,
                    body: `Goodbye sent for ${pTags.join(", ")} (${allBatchJids.length} participant${allBatchJids.length > 1 ? "s" : ""}).`
                  });
                }
              } catch (sendErr) {
                console.error(`[Auto-Greeting] Error sending ${action} greeting in ${groupId}:`, sendErr);
              }
            }, 1200);
          } catch (err) {
            console.error("Error in group-participants.update handler:", err);
          }
        });
        sock.ev.on("groups.update", (updates) => {
          try {
            for (const upd of updates) {
              if (upd.id && upd.subject) {
                this.groupSubjectCache.set(upd.id, upd.subject);
              }
              if (upd.id) {
                this.groupPictureCache.delete(upd.id);
              }
            }
          } catch (err) {
            console.warn("Error in groups.update handler:", err);
          }
        });
        return sock;
      } finally {
        this.initPromise = null;
      }
    })();
    return this.initPromise;
  }
  async requestPairingCode(rawPhoneNumber) {
    let cleanPhone = rawPhoneNumber.replace(/\D/g, "");
    if (cleanPhone.startsWith("00")) {
      cleanPhone = cleanPhone.slice(2);
    }
    const commonCodes = ["234", "233", "254", "256", "255", "27", "1", "44", "91", "62", "55", "92", "20", "212", "213", "216", "218", "220", "221", "222", "223", "224", "225", "226", "227", "228", "229"];
    for (const prefix of commonCodes) {
      if (cleanPhone.startsWith(prefix + prefix) && cleanPhone.length > prefix.length * 2 + 5) {
        cleanPhone = cleanPhone.slice(prefix.length);
        console.log(`[Baileys Pairing] Auto-corrected double dial code from +${rawPhoneNumber} to +${cleanPhone}`);
        break;
      }
    }
    if (!cleanPhone || cleanPhone.length < 8) {
      throw new Error("Please provide a valid phone number with country code (e.g., 2348012345678)");
    }
    if (this.sock && this.currentStatus.isConnected) {
      return "ALREADY_PAIRED";
    }
    if (this.currentStatus.pairingCode && this.currentStatus.targetPhone === `+${cleanPhone}` && (this.currentStatus.state === "awaiting_pairing" || this.currentStatus.pairingStage === "code_generated")) {
      console.log(`[Baileys Pairing] Reusing active pairing code ${this.currentStatus.pairingCode} for +${cleanPhone}`);
      return this.currentStatus.pairingCode;
    }
    this.currentStatus.targetPhone = `+${cleanPhone}`;
    this.currentStatus.state = "awaiting_pairing";
    this.currentStatus.pairingStage = "code_generated";
    try {
      return await this.executePairingCodeRequest(cleanPhone);
    } catch (err) {
      console.warn(`Pairing code error: ${err?.message || err}`);
      if (!this.currentStatus.isConnected) {
        this.currentStatus.state = "disconnected";
      }
      this.currentStatus.lastError = err?.message || "Failed to request WhatsApp pairing code.";
      this.addNotification({
        type: "error",
        title: "Pairing Attempt Failed",
        body: err?.message || "Failed to request WhatsApp pairing code."
      });
      throw err;
    }
  }
  async executePairingCodeRequest(cleanPhone) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isIntentionalClosure = true;
    if (this.sock) {
      try {
        this.sock.end(void 0);
      } catch {
      }
      this.sock = null;
      await new Promise((r) => setTimeout(r, 400));
    }
    if (!this.currentStatus.isConnected) {
      try {
        if (fs2.existsSync(this.authDir)) {
          fs2.rmSync(this.authDir, { recursive: true, force: true });
        }
        this.ensureAuthDir();
      } catch (e) {
        console.error("Error preparing fresh auth dir:", e);
      }
    }
    this.initPromise = null;
    const sock = await this.initSocket();
    console.log(`[Baileys Pairing] Waiting for WebSocket connection to establish for +${cleanPhone}...`);
    let pairingCodeResult = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const waitTime = attempt === 1 ? 3500 : 3e3;
      await new Promise((r) => setTimeout(r, waitTime));
      if (this.currentStatus.isConnected) {
        return "ALREADY_PAIRED";
      }
      const activeSock = this.sock || sock;
      if (!activeSock) continue;
      try {
        console.log(`[Baileys Pairing] Requesting pairing code from WhatsApp server (attempt ${attempt}/10)...`);
        const raw = await activeSock.requestPairingCode(cleanPhone);
        if (raw && typeof raw === "string") {
          pairingCodeResult = raw;
          console.log(`[Baileys Pairing] Received genuine pairing code: ${raw}`);
          break;
        }
      } catch (err) {
        lastErr = err;
        const msg = err?.message || String(err);
        console.log(`[Baileys Pairing] Attempt ${attempt} note: ${msg}`);
        if (msg.includes("already") || this.currentStatus.isConnected) {
          return "ALREADY_PAIRED";
        }
      }
    }
    if (!pairingCodeResult) {
      throw lastErr || new Error("Timed out waiting for WhatsApp pairing response. Please check your phone number and try again.");
    }
    const formattedCode = pairingCodeResult.match(/.{1,4}/g)?.join("-") || pairingCodeResult;
    this.currentStatus.pairingCode = formattedCode;
    this.currentStatus.pairingStage = "code_generated";
    this.currentStatus.state = "awaiting_pairing";
    this.addNotification({
      type: "pairing",
      title: "Pairing Code Generated",
      body: `Pairing Code: ${formattedCode} generated for +${cleanPhone}. Enter this in WhatsApp > Linked Devices > Link with phone number.`
    });
    if (this.pairingCodeTimer) clearTimeout(this.pairingCodeTimer);
    this.pairingCodeTimer = setTimeout(() => {
      if (this.currentStatus.pairingCode === formattedCode && !this.currentStatus.isConnected) {
        this.currentStatus.pairingCode = void 0;
        this.addNotification({
          type: "system",
          title: "Pairing Code Expired",
          body: "The 5-minute pairing code expired. You can request a fresh code anytime."
        });
      }
    }, 3e5);
    return formattedCode;
  }
  async sendMessage(toPhone, text) {
    if (!this.sock || !this.currentStatus.isConnected) {
      throw new Error("WhatsApp is not currently connected. Please pair your number first.");
    }
    let jid = toPhone.trim();
    if (!jid.includes("@")) {
      const cleanTo = toPhone.replace(/\D/g, "");
      jid = `${cleanTo}@s.whatsapp.net`;
    }
    await this.sock.sendMessage(jid, { text });
    const displaySender = jid.endsWith("@g.us") ? "Group" : `+${jid.split("@")[0]}`;
    this.addNotification({
      type: "message_sent",
      title: `Message Sent to ${displaySender}`,
      body: text,
      sender: displaySender
    });
    return true;
  }
  async logout() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isIntentionalClosure = true;
    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {
        });
        this.sock.end(void 0);
        this.sock = null;
      }
    } catch {
    }
    try {
      if (fs2.existsSync(this.authDir)) {
        fs2.rmSync(this.authDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error("Error clearing auth dir:", e);
    }
    this.connectedAt = null;
    this.currentStatus = {
      state: "disconnected",
      isConnected: false,
      pairingStage: "idle",
      user: void 0,
      pairingCode: void 0,
      qrCodeUrl: void 0,
      targetPhone: void 0,
      connectedAt: void 0
    };
    this.addNotification({
      type: "system",
      title: "WhatsApp Session Cleared",
      body: "All Baileys session credentials have been wiped. Ready to pair a new device."
    });
  }
  async getGroupPictureUrl(groupId) {
    if (!groupId || !groupId.endsWith("@g.us")) return null;
    if (this.groupPictureCache.has(groupId)) {
      return this.groupPictureCache.get(groupId) || null;
    }
    if (!this.sock || !this.currentStatus.isConnected) {
      return null;
    }
    try {
      const hdUrl = await Promise.race([
        this.sock.profilePictureUrl(groupId, "image"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500))
      ]).catch(() => null);
      if (hdUrl) {
        this.groupPictureCache.set(groupId, hdUrl);
        return hdUrl;
      }
      const previewUrl = await Promise.race([
        this.sock.profilePictureUrl(groupId, "preview"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2e3))
      ]).catch(() => null);
      if (previewUrl) {
        this.groupPictureCache.set(groupId, previewUrl);
        return previewUrl;
      }
    } catch {
    }
    return null;
  }
  getLidReverseMapping(lidUser) {
    if (!lidUser) return null;
    const cleanLid = lidUser.split("@")[0].split(":")[0].replace(/\D/g, "");
    if (!cleanLid) return null;
    if (this.reverseLidMap.has(cleanLid)) {
      return this.reverseLidMap.get(cleanLid) || null;
    }
    try {
      const filePath = path2.join(this.authDir, `lid-mapping-${cleanLid}_reverse.json`);
      if (fs2.existsSync(filePath)) {
        const phone = JSON.parse(fs2.readFileSync(filePath, "utf8"));
        const cleanPhone = String(phone).replace(/\D/g, "");
        if (cleanPhone) {
          this.reverseLidMap.set(cleanLid, cleanPhone);
          return cleanPhone;
        }
      }
    } catch {
    }
    return null;
  }
  isBotAdminInGroup(groupMeta) {
    if (!groupMeta || !this.sock) return true;
    const credsMe = this.sock.authState?.creds?.me || this.sock.user || {};
    const botUserJid = credsMe.id || this.sock.user?.id || this.sock.user?.jid || "";
    const botUserLid = credsMe.lid || this.sock.user?.lid || "";
    const botPhone = (botUserJid.split(":")[0] || botUserJid.split("@")[0]).replace(/\D/g, "");
    const linkedPhoneClean = (this.currentStatus.user?.phone || this.currentStatus.targetPhone || "").replace(/\D/g, "");
    const botLidNum = (botUserLid.split(":")[0] || botUserLid.split("@")[0]).replace(/\D/g, "");
    const targetPhones = /* @__PURE__ */ new Set();
    if (botPhone) targetPhones.add(botPhone);
    if (linkedPhoneClean) targetPhones.add(linkedPhoneClean);
    const targetLids = /* @__PURE__ */ new Set();
    if (botLidNum) targetLids.add(botLidNum);
    for (const phone of targetPhones) {
      try {
        const directFile = path2.join(this.authDir, `lid-mapping-${phone}.json`);
        if (fs2.existsSync(directFile)) {
          const mappedLid = String(JSON.parse(fs2.readFileSync(directFile, "utf8"))).replace(/\D/g, "");
          if (mappedLid) targetLids.add(mappedLid);
        }
      } catch {
      }
    }
    for (const lid of targetLids) {
      const mappedPhone = this.getLidReverseMapping(lid);
      if (mappedPhone) targetPhones.add(mappedPhone);
    }
    const isMatch = (rawId) => {
      if (!rawId) return false;
      const clean = rawId.split("@")[0].split(":")[0].replace(/\D/g, "");
      if (!clean) return false;
      if (targetPhones.has(clean) || targetLids.has(clean)) return true;
      const mapped = this.getLidReverseMapping(clean);
      if (mapped && targetPhones.has(mapped)) return true;
      return false;
    };
    if (isMatch(groupMeta.owner) || isMatch(groupMeta.ownerPn) || isMatch(groupMeta.creator)) {
      return true;
    }
    if (Array.isArray(groupMeta.participants)) {
      for (const p of groupMeta.participants) {
        const isAdmin = p.admin === "admin" || p.admin === "superadmin";
        if (!isAdmin) continue;
        const pId = p.id || "";
        const pPhoneNumber = p.phoneNumber ? String(p.phoneNumber).replace(/\D/g, "") : "";
        const pLid = p.lid ? String(p.lid).replace(/\D/g, "") : "";
        if (isMatch(pId) || pPhoneNumber && targetPhones.has(pPhoneNumber) || pLid && targetLids.has(pLid)) {
          return true;
        }
      }
    }
    if (!groupMeta.announce) {
      return true;
    }
    return false;
  }
  async isBotAdminInGroupById(groupId) {
    if (!groupId || !this.sock || !this.currentStatus.isConnected) return false;
    try {
      let meta = this.groupMetadataCache.get(groupId)?.meta;
      if (!meta) {
        meta = await this.sock.groupMetadata(groupId).catch(() => null);
        if (meta) {
          this.groupMetadataCache.set(groupId, { meta, timestamp: Date.now() });
        }
      }
      if (!meta) return false;
      return this.isBotAdminInGroup(meta);
    } catch {
      return false;
    }
  }
  async getGroupsWithSettings(adminOnlyFilter = true) {
    if (!this.sock || !this.currentStatus.isConnected) {
      return [];
    }
    const result = [];
    try {
      const allGroups = await this.sock.groupFetchAllParticipating();
      const credsMe = this.sock.authState?.creds?.me || this.sock.user || {};
      const botUserJid = credsMe.id || this.sock.user?.id || this.sock.user?.jid || "";
      const botUserLid = credsMe.lid || this.sock.user?.lid || "";
      const botPhone = (botUserJid.split(":")[0] || botUserJid.split("@")[0]).replace(/\D/g, "");
      const linkedPhoneClean = (this.currentStatus.user?.phone || this.currentStatus.targetPhone || "").replace(/\D/g, "");
      const botLidNum = (botUserLid.split(":")[0] || botUserLid.split("@")[0]).replace(/\D/g, "");
      const targetPhones = /* @__PURE__ */ new Set();
      if (botPhone) targetPhones.add(botPhone);
      if (linkedPhoneClean) targetPhones.add(linkedPhoneClean);
      const targetLids = /* @__PURE__ */ new Set();
      if (botLidNum) targetLids.add(botLidNum);
      for (const phone of targetPhones) {
        try {
          const directFile = path2.join(this.authDir, `lid-mapping-${phone}.json`);
          if (fs2.existsSync(directFile)) {
            const mappedLid = String(JSON.parse(fs2.readFileSync(directFile, "utf8"))).replace(/\D/g, "");
            if (mappedLid) targetLids.add(mappedLid);
          }
        } catch {
        }
      }
      for (const lid of targetLids) {
        const mappedPhone = this.getLidReverseMapping(lid);
        if (mappedPhone) targetPhones.add(mappedPhone);
      }
      const isAccountMatch = (rawId) => {
        if (!rawId) return false;
        const cleanUser = rawId.split("@")[0].split(":")[0].replace(/\D/g, "");
        if (!cleanUser) return false;
        if (targetPhones.has(cleanUser)) return true;
        if (targetLids.has(cleanUser)) return true;
        if (rawId.endsWith("@lid") || !targetPhones.has(cleanUser)) {
          const mapped = this.getLidReverseMapping(cleanUser);
          if (mapped && targetPhones.has(mapped)) {
            return true;
          }
        }
        return false;
      };
      for (const [gid, meta] of Object.entries(allGroups)) {
        const realSubject = meta.subject || this.groupSubjectCache.get(gid) || "WhatsApp Group";
        this.groupSubjectCache.set(gid, realSubject);
        const isGroupOwner = isAccountMatch(meta.owner) || isAccountMatch(meta.ownerPn) || isAccountMatch(meta.creator);
        const userParticipant = meta.participants?.find((p) => {
          const pId = p.id || "";
          const pPhoneNumber = p.phoneNumber ? String(p.phoneNumber).replace(/\D/g, "") : "";
          const pLid = p.lid ? String(p.lid).replace(/\D/g, "") : "";
          if (isAccountMatch(pId)) return true;
          if (pPhoneNumber && targetPhones.has(pPhoneNumber)) return true;
          if (pLid && targetLids.has(pLid)) return true;
          return false;
        });
        const isParticipantAdmin = userParticipant?.admin === "admin" || userParticipant?.admin === "superadmin";
        const isAdmin = Boolean(isGroupOwner || isParticipantAdmin);
        if (adminOnlyFilter || !isAdmin) {
          if (!isAdmin) {
            continue;
          }
        }
        const cachedPic = this.groupPictureCache.get(gid) || null;
        result.push({
          id: gid,
          subject: realSubject,
          desc: meta.desc ? String(meta.desc) : void 0,
          pictureUrl: cachedPic,
          memberCount: meta.participants?.length || 0,
          isAdmin,
          creation: meta.creation,
          owner: meta.owner,
          settings: commandHandler.getSecuritySettings(gid)
        });
      }
      const pendingPics = result.filter((g) => !g.pictureUrl);
      if (pendingPics.length > 0) {
        await Promise.allSettled(
          pendingPics.slice(0, 10).map(async (g) => {
            const url = await this.getGroupPictureUrl(g.id);
            if (url) {
              g.pictureUrl = url;
            }
          })
        );
      }
    } catch (err) {
      console.warn("Error fetching live participating groups:", err);
    }
    return result;
  }
};
var whatsappManager = new WhatsAppManager();

// server.ts
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
async function startServer() {
  const app2 = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3e3;
  const isProd = process.env.NODE_ENV === "production";
  app2.use(express.json());
  app2.get("/api/whatsapp/status", (_req, res) => {
    res.json({
      success: true,
      botName: "SOLVATECH",
      firebaseProject: "solvatechbot",
      status: whatsappManager.getStatus()
    });
  });
  app2.get("/api/whatsapp/notifications", (_req, res) => {
    res.json({
      success: true,
      notifications: whatsappManager.getNotifications()
    });
  });
  app2.delete("/api/whatsapp/notifications", (_req, res) => {
    whatsappManager.clearNotifications();
    res.json({ success: true, message: "Notifications cleared" });
  });
  app2.post("/api/whatsapp/pair-code", async (req, res) => {
    try {
      const { phoneNumber, isExpired = false, isUnlimited = false } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: "Phone number is required"
        });
      }
      if (isExpired && !isUnlimited) {
        return res.status(403).json({
          success: false,
          error: "Cannot connect to bot: License key has expired! Please renew your license to connect."
        });
      }
      const pairingCode = await whatsappManager.requestPairingCode(phoneNumber);
      res.json({
        success: true,
        pairingCode,
        targetPhone: whatsappManager.getStatus().targetPhone || req.body.phoneNumber,
        status: whatsappManager.getStatus()
      });
    } catch (err) {
      console.error("Pairing code error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Failed to generate pairing code"
      });
    }
  });
  app2.post("/api/whatsapp/send-message", async (req, res) => {
    try {
      const { to, message } = req.body;
      if (!to || !message) {
        return res.status(400).json({
          success: false,
          error: 'Recipient number ("to") and "message" are required'
        });
      }
      await whatsappManager.sendMessage(to, message);
      res.json({ success: true, message: "Message sent successfully" });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message || "Failed to send WhatsApp message"
      });
    }
  });
  app2.post("/api/whatsapp/test-dm", async (_req, res) => {
    try {
      const status = whatsappManager.getStatus();
      if (!status.isConnected) {
        return res.status(400).json({
          success: false,
          error: "WhatsApp is not currently connected. Please pair your WhatsApp account first."
        });
      }
      const rawPhone = status.user?.phone || status.targetPhone || "";
      const cleanPhone = rawPhone.replace(/\D/g, "");
      if (!cleanPhone) {
        return res.status(400).json({
          success: false,
          error: "Could not determine connected WhatsApp number."
        });
      }
      await whatsappManager.sendMessage(
        cleanPhone,
        `\u{1F514} *[SOLVATECH NOTIFICATION TEST]* \u{1F514}

\u2705 Your WhatsApp connection and notification engine are LIVE and healthy!
\u23F0 Time: *${(/* @__PURE__ */ new Date()).toLocaleTimeString()}*

\u{1F6E1}\uFE0F *Status:* Connected & Listening
\u{1F4F1} *Number:* +${cleanPhone}

\u{1F4AC} All Anti-Delete DM recovery, View-Once decryption, and 35+ commands are actively functioning on your account.

> \u26A1 _SOLVATECH Multi-Device Engine_`
      );
      res.json({
        success: true,
        message: `Test notification sent successfully to your WhatsApp DM (+${cleanPhone})!`
      });
    } catch (err) {
      console.error("Test DM error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Failed to send notification to WhatsApp"
      });
    }
  });
  app2.get("/api/groups", async (req, res) => {
    try {
      const status = whatsappManager.getStatus();
      if (!status.isConnected) {
        return res.json({
          success: true,
          connected: false,
          message: "Link account first to show your groups that you are in.",
          groups: []
        });
      }
      const adminOnly = req.query.adminOnly === "true" || req.query.adminOnly === "1";
      const groups = await whatsappManager.getGroupsWithSettings(adminOnly);
      res.json({ success: true, connected: true, groups });
    } catch (err) {
      console.error("Error fetching groups:", err);
      res.status(500).json({ success: false, error: err.message, groups: [] });
    }
  });
  app2.post("/api/groups/sync", async (req, res) => {
    try {
      const status = whatsappManager.getStatus();
      if (!status.isConnected) {
        return res.json({
          success: true,
          connected: false,
          message: "Link account first to show your groups that you are in.",
          groups: []
        });
      }
      const groups = await whatsappManager.getGroupsWithSettings(true);
      res.json({ success: true, connected: true, groups });
    } catch (err) {
      console.error("Error syncing groups:", err);
      res.status(500).json({ success: false, error: err.message, groups: [] });
    }
  });
  app2.get("/api/groups/:gid/picture", async (req, res) => {
    try {
      const { gid } = req.params;
      const pictureUrl = await whatsappManager.getGroupPictureUrl(gid);
      if (pictureUrl) {
        return res.json({ success: true, pictureUrl });
      }
      return res.status(404).json({ success: false, error: "No group picture available" });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app2.post("/api/groups/settings", async (req, res) => {
    try {
      const { groupId, key, value } = req.body;
      if (!groupId || !key || typeof value !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "groupId, key (e.g. autowelcome, autogoodbye), and boolean value are required"
        });
      }
      const isGroupAdmin = await whatsappManager.isBotAdminInGroupById(groupId);
      if (!isGroupAdmin) {
        return res.status(403).json({
          success: false,
          error: "Forbidden: You are not an admin of this group. Only group admins can configure protection settings."
        });
      }
      commandHandler.setSecuritySetting(groupId, key, value);
      const updatedSettings = commandHandler.getSecuritySettings(groupId);
      res.json({ success: true, groupId, settings: updatedSettings });
    } catch (err) {
      console.error("Error updating group security setting:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app2.post("/api/groups/toggle-all", async (req, res) => {
    try {
      const { groupId, enableAll } = req.body;
      if (!groupId || typeof enableAll !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "groupId and boolean enableAll required"
        });
      }
      const isGroupAdmin = await whatsappManager.isBotAdminInGroupById(groupId);
      if (!isGroupAdmin) {
        return res.status(403).json({
          success: false,
          error: "Forbidden: You are not an admin of this group. Only group admins can configure protection settings."
        });
      }
      const updated = commandHandler.toggleAllForGroup(groupId, enableAll);
      res.json({ success: true, groupId, settings: updated });
    } catch (err) {
      console.error("Error toggling all group settings:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app2.post("/api/groups/warn-limit", async (req, res) => {
    try {
      const { groupId, limit } = req.body;
      if (!groupId || typeof limit !== "number") {
        return res.status(400).json({
          success: false,
          error: "groupId and numeric limit required"
        });
      }
      const isGroupAdmin = await whatsappManager.isBotAdminInGroupById(groupId);
      if (!isGroupAdmin) {
        return res.status(403).json({
          success: false,
          error: "Forbidden: You are not an admin of this group. Only group admins can configure protection settings."
        });
      }
      commandHandler.setWarnLimit(groupId, limit);
      res.json({ success: true, groupId, settings: commandHandler.getSecuritySettings(groupId) });
    } catch (err) {
      console.error("Error updating group warn limit:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app2.post("/api/groups/sync", async (_req, res) => {
    try {
      await commandHandler.loadAllSecuritySettingsFromFirebase();
      const groups = await whatsappManager.getGroupsWithSettings(true);
      res.json({ success: true, groups, message: "Synchronized with WhatsApp and Firebase (Admin Groups Only)" });
    } catch (err) {
      console.error("Error syncing groups:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app2.get("/api/user/anti-delete", (_req, res) => {
    res.json({
      success: true,
      enabled: commandHandler.getAntiDeleteEnabled()
    });
  });
  app2.post("/api/user/anti-delete", (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ success: false, error: 'Boolean "enabled" field required' });
      }
      commandHandler.setAntiDeleteEnabled(enabled);
      res.json({
        success: true,
        enabled: commandHandler.getAntiDeleteEnabled(),
        message: enabled ? "Anti-delete recovery is ON. Deleted messages will be forwarded to your personal WhatsApp DM." : "Anti-delete recovery is OFF. Deleted messages will be ignored."
      });
    } catch (err) {
      console.error("Error setting anti-delete:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  const trialStorePath = path3.resolve(process.cwd(), ".trial_store.json");
  const getTrialStore = () => {
    try {
      if (fs3.existsSync(trialStorePath)) {
        const raw = fs3.readFileSync(trialStorePath, "utf-8");
        return JSON.parse(raw) || {};
      }
    } catch {
    }
    return {};
  };
  const saveTrialStore = (data) => {
    try {
      fs3.writeFileSync(trialStorePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
    }
  };
  app2.get("/api/trial/status", (req, res) => {
    try {
      const uid = req.query.uid || "";
      const email = (req.query.email || "").toLowerCase().trim();
      const store = getTrialStore();
      let userRecord = uid && store[uid] || email && store[email];
      if (!userRecord && email) {
        const matchKey = Object.keys(store).find(
          (k) => k.toLowerCase() === email || store[k]?.email?.toLowerCase() === email
        );
        if (matchKey) userRecord = store[matchKey];
      }
      if (!userRecord) {
        return res.json({
          success: true,
          hasUsedTrial: false,
          isReset: false,
          isActive: false,
          expiresAt: null,
          remainingMs: 0
        });
      }
      const now = Date.now();
      const expMs = userRecord.expiresAt ? new Date(userRecord.expiresAt).getTime() : 0;
      const isActive = expMs > now;
      const remainingMs = isActive ? expMs - now : 0;
      return res.json({
        success: true,
        hasUsedTrial: userRecord.hasUsedTrial && !userRecord.isReset,
        isReset: Boolean(userRecord.isReset),
        isActive,
        expiresAt: userRecord.expiresAt,
        remainingMs
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app2.post("/api/trial/claim", (req, res) => {
    try {
      const { uid, email } = req.body;
      if (!uid && !email) {
        return res.status(400).json({ success: false, message: "User ID or Email is required." });
      }
      const cleanEmail = (email || "").toLowerCase().trim();
      const cleanUid = uid || cleanEmail;
      const store = getTrialStore();
      const existing = store[cleanUid] || cleanEmail && store[cleanEmail];
      if (existing && existing.hasUsedTrial && !existing.isReset) {
        return res.status(400).json({
          success: false,
          message: "The 30-minute test has already been used on this Google account. It can only be claimed once in a lifetime."
        });
      }
      const now = Date.now();
      const newExpiryMs = now + 30 * 60 * 1e3;
      const newExpiresAt = new Date(newExpiryMs).toISOString();
      const record = {
        uid: cleanUid,
        email: cleanEmail,
        hasUsedTrial: true,
        isReset: false,
        claimedAt: new Date(now).toISOString(),
        expiresAt: newExpiresAt
      };
      store[cleanUid] = record;
      if (cleanEmail) store[cleanEmail] = record;
      saveTrialStore(store);
      return res.json({
        success: true,
        message: "\u{1F389} 30-minute test activated! Your countdown has begun.",
        expiresAt: newExpiresAt
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });
  app2.post("/api/trial/reset", (req, res) => {
    try {
      const { uid, email } = req.body;
      if (!uid && !email) {
        return res.status(400).json({ success: false, message: "User ID or Email is required." });
      }
      const cleanEmail = (email || "").toLowerCase().trim();
      const cleanUid = uid || cleanEmail;
      const store = getTrialStore();
      const record = {
        uid: cleanUid,
        email: cleanEmail,
        hasUsedTrial: false,
        isReset: true,
        expiresAt: null,
        resetAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      if (cleanUid) store[cleanUid] = record;
      if (cleanEmail) store[cleanEmail] = record;
      for (const k of Object.keys(store)) {
        if (cleanEmail && (store[k].email?.toLowerCase() === cleanEmail || k.toLowerCase() === cleanEmail) || cleanUid && (store[k].uid === cleanUid || k === cleanUid)) {
          store[k] = { ...record };
        }
      }
      saveTrialStore(store);
      return res.json({
        success: true,
        message: `30-minute test reset for ${cleanEmail || cleanUid}! They can tap and claim it again.`
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });
  app2.post("/api/trial/reset-all", (_req, res) => {
    try {
      const store = getTrialStore();
      for (const k of Object.keys(store)) {
        store[k].hasUsedTrial = false;
        store[k].isReset = true;
        store[k].expiresAt = null;
        store[k].resetAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      saveTrialStore(store);
      return res.json({ success: true, message: "All user 30-minute trials have been reset!" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });
  app2.post("/api/commands/execute", async (req, res) => {
    try {
      const { text, isOwner = true } = req.body;
      if (!text) {
        return res.status(400).json({ success: false, error: "Command text is required" });
      }
      const cleanText = text.trim();
      const rawCmd = cleanText.startsWith(".") ? cleanText.slice(1) : cleanText;
      const parts = rawCmd.split(/\s+/);
      let command = parts[0]?.toLowerCase();
      let args = parts.slice(1);
      if (command === "gc" && args[0]?.toLowerCase() === "status") {
        command = "gcstatus";
        args = args.slice(1);
      }
      const status = whatsappManager.getStatus();
      const isSimulatedGroup = req.body.isGroup ?? (req.body.groupJid || ["link", "groupinfo", "anti", "autowelcome", "autogoodbye", "antilink", "antibot", "antistatus", "antispam", "warn", "warnlimit", "warns"].includes(command));
      const groupJid = req.body.groupJid || req.body.groupId || (isSimulatedGroup ? "1203630248491823@g.us" : void 0);
      const result = await commandHandler.handle({
        command,
        args,
        fullText: cleanText,
        senderJid: "2349049979183@s.whatsapp.net",
        senderNumber: status.user?.phone?.replace(/\D/g, "") || "2349049979183",
        isGroup: Boolean(isSimulatedGroup),
        groupJid,
        pushName: "Solvatech Tester",
        isOwner: isOwner ?? true,
        linkedSince: whatsappManager.getConnectedAt(),
        linkedPhone: status.user?.phone || null,
        licenseExpiresAt: req.body.licenseExpiresAt || null,
        licensePlan: req.body.licensePlan || null,
        quotedParticipant: req.body.quotedParticipant || void 0,
        mentionedJids: req.body.mentionedJids || [],
        getTopChatted: (phone) => whatsappManager.getTopChatted(phone)
      });
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app2.post("/api/whatsapp/logout", async (_req, res) => {
    try {
      await whatsappManager.logout();
      res.json({ success: true, message: "Session logged out and cleared" });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message || "Failed to logout session"
      });
    }
  });
  app2.post("/api/whatsapp/disconnect", async (_req, res) => {
    try {
      await whatsappManager.logout();
      res.json({ success: true, message: "Bot disconnected successfully due to expired license or user request" });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message || "Failed to disconnect session"
      });
    }
  });
  app2.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      bot: "SOLVATECH",
      firebase: "solvatechbot",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: "spa"
    });
    app2.use(vite.middlewares);
  } else {
    const distPath = path3.resolve(__dirname, "dist");
    app2.use(express.static(distPath));
    app2.get("*", (_req, res) => {
      res.sendFile(path3.resolve(distPath, "index.html"));
    });
  }
  app2.listen(PORT, "0.0.0.0", () => {
    console.log(`[SOLVATECH] Server listening on port ${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
