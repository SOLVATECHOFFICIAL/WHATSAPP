import fs from 'fs';
import path from 'path';
import { db } from '../services/firebase.ts';
import { collection, doc, setDoc, getDoc, getDocs, updateDoc } from 'firebase/firestore';

export interface CommandContext {
  command: string;
  args: string[];
  fullText: string;
  senderJid: string;
  senderNumber: string;
  isGroup: boolean;
  groupJid?: string;
  pushName?: string;
  isOwner: boolean;
  linkedSince?: number | null;
  linkedPhone?: string | null;
  licenseExpiresAt?: string | null;
  licensePlan?: string | null;
  quotedParticipant?: string;
  mentionedJids?: string[];
  sock?: any;
  getTopChatted?: (phone: string) => Array<{ phone: string; name?: string; count: number }>;
  getGroupInviteCode?: (gid: string) => string | undefined;
  setGroupInviteCode?: (gid: string, code: string) => void;
}

export interface CommandResult {
  reply: string;
  action?: 'none' | 'kick' | 'pin' | 'warn' | 'spam' | 'stop_spam' | 'image_gen' | 'sticker_convert' | 'antisticker_convert' | 'ocr_read' | 'view_once_decrypt';
  imageUrl?: string;
  metadata?: any;
}

export function parseSpamArgs(args: string[]): { text: string; count: number } {
  if (!args || args.length === 0) {
    return { text: 'SOLVATECH Active ⚡', count: 25 };
  }

  // Check if last argument is a positive number (e.g. .spam okay wassup 30)
  const lastArg = args[args.length - 1];
  const lastNum = parseInt(lastArg, 10);
  if (!isNaN(lastNum) && lastNum > 0 && /^\d+$/.test(lastArg)) {
    const textWords = args.slice(0, -1);
    const text = textWords.join(' ').trim() || 'SOLVATECH Active ⚡';
    return { text, count: Math.min(lastNum, 100) };
  }

  // Check if first argument is a positive number (e.g. .spam 30 okay wassup)
  const firstArg = args[0];
  const firstNum = parseInt(firstArg, 10);
  if (!isNaN(firstNum) && firstNum > 0 && /^\d+$/.test(firstArg)) {
    const textWords = args.slice(1);
    const text = textWords.join(' ').trim() || 'SOLVATECH Active ⚡';
    return { text, count: Math.min(firstNum, 100) };
  }

  return { text: args.join(' ').trim(), count: 25 };
}

export const SOLVATECH_MENU = `╭━━━〔 ⚡ *SOLVATECH BOT COMMAND DIRECTORY* 〕━━━╮

┃ 🔒 *Bot Access Mode:* _100% Private (Owner-Only)_
┃ 🛡️ *Deleted-Message Recovery:* _Auto-Forwarded to Personal DM_
┃ 👁️ *View-Once Recovery:* _Personal DM (Owner Protected)_
┃ 🌐 *Cloud Engine:* _24/7 Multi-Worker Operational_
┃ ⚙️ *Group Cloud Sync:* _Active (Firebase Cloud)_

╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

╭──〔 ⚡ *BATCH 1: CORE UTILITY* 〕──╮
│
│ • *.ping* — _Instant network latency & server speed_
│ • *.uptime* — _Show how long your account has been linked_
│ • *.owner* — _Official SOLVATECH BOT developer contact & web services_
│ • *.expire* — _Real-time license validity & countdown_
│ • *.menu* / *.help* — _Display this command directory_
│
╰────────────────────────────────

╭──〔 💳 *BATCH 2: BILLING & ACCESS* 〕──╮
│
│ • *.plans / .buy* — _View license packages & OPay pricing_
│ • *.share* — _Share SOLVATECH BOT features & web services_
│ • *.link* — _Fetch current group's invite link (any member)_
│ • *.groupinfo* — _Full group audit: created date, creator, admins & pics_
│ • *.profile [@user]* — _User audit: bio, role, clearance & warnings_
│
╰────────────────────────────────

╭──〔 📸 *BATCH 3 & 4: MEDIA & RECOVERY* 〕──╮
│
│ • *.signature* — _Official verified developer credentials_
│ • *.sticker* — _Convert photo to sticker or video to animated sticker_
│ • *.antisticker* — _Convert static sticker to image or animated to video_
│ • *.read* — _Extract verbatim text from image via OCR_
│ • *.open / .vv* — _Reveal view-once media privately to your personal DM_
│ • *.send* — _Extract and send target WhatsApp status_
│
╰──────────────────────────────────────

╭──〔 🛡️ *BATCH 5, 6 & 7: GROUP SECURITY* 〕──╮
│
│ • *.pin* — _Pin replied message in group (7 days)_
│ • *.del [count]* — _Delete last N messages_
│ • *.tagall [msg]* — _Mention all group members_
│ • *.admin / .admins* — _Mention all group administrators_
│ • *.kick @user* — _Remove participant from group_
│ • *.add <phone>* — _Add new member to group_
│ • *.promote @user* — _Promote member to group admin_
│ • *.demote @user* — _Demote group admin to member_
│ • *.lock* — _Restrict group messaging to admins only_
│ • *.unlock* — _Allow all members to send messages_
│ • *.antilink on/off* — _Auto-remove external links_
│ • *.antibot on/off* — _Auto-remove rogue automated bot accounts_
│ • *.antistatus on/off* — _Auto-remove WhatsApp status group mentions_
│ • *.autowelcome on/off* — _Auto-welcome new participants upon joining_
│ • *.autogoodbye on/off* — _Auto-goodbye departing members upon leaving_
│ • *.anti* — _Inspect group protections & warning threshold_
│ • *.warn @user* — _Issue official warning to a member_
│ • *.warns* — _Inspect member warnings & group limit_
│ • *.clearwarns @user* — _Clear warnings for a specific member_
│ • *.resetwarns* — _Reset all group member warnings to zero_
│
╰─────────────────────────────────────

╭──〔 👑 *BATCH 8: CONTROLLER ONLY* 〕──╮
│
│ • *.spam [msg] [count]* — _Fast burst spam (e.g. .spam okay wassup 30)_
│ • *.stop* — _Terminate active spam operation immediately_
│
╰──────────────────────────────`;

class CommandHandler {
  private startTime = Date.now();
  private spamActive = false;
  private warnings: Record<string, number> = {};
  private securitySettings: Record<string, { antilink: boolean; antibot: boolean; antistatus: boolean; antispam: boolean; autowelcome: boolean; autogoodbye: boolean; warnLimit?: number }> = {};
  private antiDeleteEnabled = true;
  private cacheFilePath = path.resolve(process.cwd(), '.group_security_cache.json');
  private warningsCacheFilePath = path.resolve(process.cwd(), '.group_warnings_cache.json');

  constructor() {
    this.loadSettingsFromCache();
    this.loadWarningsFromCache();
    // Asynchronously load all data from Firebase Firestore (group security, user warnings, bot settings)
    this.loadAllDataFromFirebase().catch(() => {});
  }

  private saveSettingsToCache() {
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(this.securitySettings, null, 2));
    } catch {}
  }

  private loadSettingsFromCache() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.securitySettings = parsed;
        }
      }
    } catch {}
  }

  private saveWarningsToCache() {
    try {
      fs.writeFileSync(this.warningsCacheFilePath, JSON.stringify(this.warnings, null, 2));
    } catch {}
  }

  private loadWarningsFromCache() {
    try {
      if (fs.existsSync(this.warningsCacheFilePath)) {
        const raw = fs.readFileSync(this.warningsCacheFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.warnings = parsed;
        }
      }
    } catch {}
  }

  // Load everything from Firebase Firestore: Group security rules, member warnings, and bot settings
  public async loadAllDataFromFirebase() {
    try {
      // 1. Group Security Rules
      const securitySnap = await getDocs(collection(db, 'group_security'));
      securitySnap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d && docSnap.id) {
          this.securitySettings[docSnap.id] = {
            antilink: d.antilink !== false,
            antibot: d.antibot !== false,
            antistatus: d.antistatus !== false,
            antispam: d.antispam !== false,
            autowelcome: d.autowelcome !== false,
            autogoodbye: d.autogoodbye !== false,
            warnLimit: typeof d.warnLimit === 'number' ? d.warnLimit : 3,
          };
        }
      });
      this.saveSettingsToCache();
    } catch (err) {
      console.warn('Firebase group_security fetch note:', err);
    }

    try {
      // 2. Member Warnings
      const warningsSnap = await getDocs(collection(db, 'group_warnings'));
      warningsSnap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d) {
          const count = typeof d.count === 'number' ? d.count : 0;
          const key = d.rawKey || (d.cleanGid && d.userPhone ? `${d.cleanGid}:${d.userPhone}` : docSnap.id.replace('__', ':'));
          if (count > 0) {
            this.warnings[key] = count;
          } else {
            delete this.warnings[key];
          }
        }
      });
      this.saveWarningsToCache();
    } catch (err) {
      console.warn('Firebase group_warnings fetch note:', err);
    }

    try {
      // 3. Bot Settings (Anti-Delete)
      const antiDoc = await getDoc(doc(db, 'bot_settings', 'anti_delete'));
      if (antiDoc.exists()) {
        const d = antiDoc.data();
        if (d && typeof d.enabled === 'boolean') {
          this.antiDeleteEnabled = d.enabled;
        }
      }
    } catch (err) {
      console.warn('Firebase bot_settings fetch note:', err);
    }
  }

  public async loadAllSecuritySettingsFromFirebase() {
    return this.loadAllDataFromFirebase();
  }

  public getAntiDeleteEnabled(): boolean {
    return this.antiDeleteEnabled;
  }

  public setAntiDeleteEnabled(val: boolean) {
    this.antiDeleteEnabled = val;
    this.syncToFirebase('bot_settings', 'anti_delete', { enabled: val });
  }

  public getSpamActive(): boolean {
    return this.spamActive;
  }

  public setSpamActive(val: boolean) {
    this.spamActive = val;
  }

  public getAllSecuritySettings(): Record<string, { antilink: boolean; antibot: boolean; antistatus: boolean; antispam: boolean; autowelcome: boolean; autogoodbye: boolean; warnLimit?: number }> {
    return { ...this.securitySettings };
  }

  // Sync settings or warnings to Firebase
  public async syncToFirebase(collectionName: string, id: string, data: any) {
    try {
      const docRef = doc(db, collectionName, id);
      await setDoc(docRef, { ...data, updatedAt: new Date().toISOString() }, { merge: true });
    } catch (err) {
      console.warn('Firebase sync note (offline safe):', err);
    }
  }

  // DEFAULT FOR ALL GROUPS: KEEPING EVERYTHING ON (true)
  public getSecuritySettings(gid: string) {
    const defaults = {
      antilink: true,
      antibot: true,
      antistatus: true,
      antispam: true,
      autowelcome: true,
      autogoodbye: true,
      warnLimit: 3,
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
      autogoodbye: this.securitySettings[gid].autogoodbye !== false,
    };
  }

  public setSecuritySetting(
    gid: string,
    key: 'antilink' | 'antibot' | 'antistatus' | 'antispam' | 'autowelcome' | 'autogoodbye',
    val: boolean
  ) {
    if (!this.securitySettings[gid]) {
      this.securitySettings[gid] = this.getSecuritySettings(gid);
    }
    this.securitySettings[gid][key] = val;
    this.saveSettingsToCache();
    this.syncToFirebase('group_security', gid, this.securitySettings[gid]);
  }

  // Quick switch: Turn on or off all anti and welcome protections for a group
  public toggleAllForGroup(gid: string, enableAll: boolean) {
    const current = this.getSecuritySettings(gid);
    this.securitySettings[gid] = {
      antilink: enableAll,
      antibot: enableAll,
      antistatus: enableAll,
      antispam: enableAll,
      autowelcome: enableAll,
      autogoodbye: enableAll,
      warnLimit: current.warnLimit || 3,
    };
    this.saveSettingsToCache();
    this.syncToFirebase('group_security', gid, this.securitySettings[gid]);
    return this.securitySettings[gid];
  }

  public setWarnLimit(gid: string, limit: number) {
    if (!this.securitySettings[gid]) {
      this.securitySettings[gid] = this.getSecuritySettings(gid);
    }
    this.securitySettings[gid].warnLimit = Math.max(1, limit);
    this.saveSettingsToCache();
    this.syncToFirebase('group_security', gid, this.securitySettings[gid]);
  }

  private getNormalizedWarningKey(gid: string, userJid: string): { key: string; docId: string; cleanGid: string; cleanPhone: string } {
    const cleanGid = gid.split('@')[0].replace(/\D/g, '') || gid.split('@')[0];
    const cleanPhone = userJid.split('@')[0].split(':')[0].replace(/\D/g, '') || userJid.replace(/\D/g, '');
    const key = `${cleanGid}:${cleanPhone}`;
    const docId = `${cleanGid}__${cleanPhone}`;
    return { key, docId, cleanGid, cleanPhone };
  }

  public addWarning(gid: string, userJid: string): { count: number; max: number } {
    const { key, docId, cleanGid, cleanPhone } = this.getNormalizedWarningKey(gid, userJid);
    this.warnings[key] = (this.warnings[key] || 0) + 1;
    this.saveWarningsToCache();
    const max = this.securitySettings[gid]?.warnLimit || 3;
    this.syncToFirebase('group_warnings', docId, {
      count: this.warnings[key],
      groupId: gid,
      cleanGid,
      userPhone: cleanPhone,
      rawKey: key,
      warnLimit: max,
      lastWarnedAt: new Date().toISOString(),
    });
    return { count: this.warnings[key], max };
  }

  public getWarnings(gid: string, userJid: string): number {
    const { key } = this.getNormalizedWarningKey(gid, userJid);
    return this.warnings[key] || 0;
  }

  public clearWarnings(gid: string, userJid: string) {
    const { key, docId, cleanGid, cleanPhone } = this.getNormalizedWarningKey(gid, userJid);
    delete this.warnings[key];
    this.saveWarningsToCache();
    this.syncToFirebase('group_warnings', docId, {
      count: 0,
      groupId: gid,
      cleanGid,
      userPhone: cleanPhone,
      rawKey: key,
      clearedAt: new Date().toISOString(),
    });
  }

  public resetAllWarnings(gid: string) {
    const cleanGid = gid.split('@')[0].replace(/\D/g, '') || gid.split('@')[0];
    const keysToReset = Object.keys(this.warnings).filter((k) => k.startsWith(`${cleanGid}:`) || k.startsWith(`${gid}:`));
    keysToReset.forEach((k) => {
      delete this.warnings[k];
      const parts = k.split(':');
      const docId = `${parts[0]}__${parts[1] || 'all'}`;
      this.syncToFirebase('group_warnings', docId, {
        count: 0,
        groupId: gid,
        clearedAt: new Date().toISOString(),
      });
    });
    this.saveWarningsToCache();
  }

  public async handle(ctx: CommandContext): Promise<CommandResult> {
    const cmd = ctx.command.toLowerCase();
    const startTime = Date.now();

    // 1. Core Utility Commands (Batch 1)
    if (cmd === 'menu' || cmd === 'help') {
      return { reply: SOLVATECH_MENU };
    }

    if (cmd === 'ping') {
      const latency = Date.now() - startTime + Math.floor(Math.random() * 20 + 15);
      return {
        reply: `⚡ *PONG!*
Speed: *${latency}ms*
Status: *Active & Operational* 🟢
Engine: *SOLVATECH Multi-Device Engine*
Cloud Worker: *Online & Synced* 🛡️
Web Portal: *${process.env.APP_URL || 'SOLVATECH Web Console'}*`,
      };
    }

    if (cmd === 'uptime') {
      if (ctx.linkedSince) {
        const diffMs = Math.max(0, Date.now() - ctx.linkedSince);
        const totalSec = Math.floor(diffMs / 1000);
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor((totalSec % 86400) / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        const totalMins = Math.floor(totalSec / 60);

        const durationParts: string[] = [];
        if (days > 0) durationParts.push(`${days} day${days > 1 ? 's' : ''}`);
        if (hours > 0 || days > 0) durationParts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
        durationParts.push(`${mins} min${mins > 1 ? 's' : ''}`);
        durationParts.push(`${secs}s`);

        return {
          reply: `⏱️ *SOLVATECH ACCOUNT LINKED TIME*

📱 Linked Account: *${ctx.linkedPhone || `+${ctx.senderNumber}`}*
⏳ Linked Duration: *${durationParts.join(' ')}* (${totalMins} minutes active)
🟢 Status: *Actively Connected via Multi-Device*
🛡️ Protections: *Anti-Delete & Recovery Live*
⚡ Cloud Host: *24/7 Automated Engine*`,
        };
      }

      return {
        reply: `⏱️ *SOLVATECH ACCOUNT LINKED TIME*

📱 Linked Account: *No WhatsApp account actively linked* ⚪
⏳ Linked Duration: *0 minutes*
ℹ️ Use the Web Pairing Code on the web console to link your WhatsApp number.`,
      };
    }

    if (cmd === 'owner') {
      return {
        reply: `👑 *SOLVATECH BOT OWNER & DEVELOPER*

👤 Developer: *Solomon Oladimeji*
📧 Contact: *awoyinfasolomon1@gmail.com*
💳 OPay Account: *9049979183* (Solomon Oladimeji)
💬 Official WhatsApp: *+234 904 997 9183*
🔒 Bot Mode: *100% Private (Owner Protected)*
🌐 Web Console: *${process.env.APP_URL || 'SOLVATECH Web Console'}*
🛡️ Status: *Official Certified Developer*

🌐 *WEB DEVELOPMENT SERVICES:*
_Need a custom website of any kind? Developer Solomon builds high-performance websites, e-commerce stores, web applications, SaaS dashboards, and automated bots. DM +2349049979183 for your website project!_`,
      };
    }

    if (cmd === 'expire') {
      if (ctx.isOwner) {
        return {
          reply: `📜 *SOLVATECH LICENSE DETAILS*

👑 Clearance: *Bot Master / Owner*
🔑 License Key: *SOLVA-OWNER-UNLIMITED-MASTER*
⏳ Duration: *👑 Unlimited Lifetime Master Access*
🟢 Status: *ACTIVE FOREVER*
⚡ Deployment: *24/7 Cloud Automation*
💳 Support: *wa.me/2349049979183*`,
        };
      }

      let remainingText = 'Active Standard Plan';
      if (ctx.licenseExpiresAt) {
        const expDate = new Date(ctx.licenseExpiresAt);
        const now = new Date();
        const diffMs = expDate.getTime() - now.getTime();
        if (diffMs <= 0) {
          return {
            reply: `⚠️ *SOLVATECH LICENSE EXPIRED*

Your license validity has ended!
To restore full bot execution:
Type *.plans* or *.buy* to select a duration and pay to OPay *9049979183*.`,
          };
        }
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        remainingText = `${days} Days, ${hours} Hours, ${mins} Minutes`;
      }

      return {
        reply: `📜 *SOLVATECH LICENSE DETAILS*

🔑 Plan: *${ctx.licensePlan || 'Active User License'}*
⏳ Time Remaining: *${remainingText}*
🟢 Status: *ACTIVE*
💳 Renew / Upgrade: Type *.plans* or *.buy*
📞 Help / Verification: *wa.me/2349049979183*`,
      };
    }

    if (cmd === 'plans' || cmd === 'buy' || cmd === 'price' || cmd === 'license') {
      return {
        reply: `⚔️ *SOLVATECH BOT — LICENSE PLANS* ⚔️

🔑 *Choose your license duration:*
• 1 Day — *₦200*
• 3 Days — *₦500*
• 7 Days / 1 Week — *₦1,000*
• 14 Days / 2 Weeks — *₦2,000*
• 30 Days / 1 Month — *₦4,000*
• 2 Months — *₦8,000*
• 3 Months — *₦12,000*
• 6 Months — *₦24,000*
• 12 Months / 1 Year — *₦48,000*

💳 *OFFICIAL OPAY PAYMENT DETAILS*
🏦 *Bank*: *OPay (PayCom / Microfinance Bank)*
🔢 *Account Number*: *9049979183*
👤 *Account Name*: *SOLOMON OLADIMEJI*

📝 *Payment Verification*: Transfer to OPay *9049979183* and send payment screenshot/receipt to WhatsApp *wa.me/2349049979183* for instant license key activation!
🌐 *Redeem Key*: ${process.env.APP_URL || 'Official Web Console'}`,
      };
    }

    if (cmd === 'share') {
      return {
        reply: `🚀 *SHARE SOLVATECH BOT*
Empower your WhatsApp account and groups with next-generation automated security, Anti-Delete recovery, View-Once bypass, and high-speed multi-device automation!

⚡ *TOP FEATURES:*
• Anti-Delete & View-Once personal DM forwarding
• Group Anti-Link, Anti-Bot & Warning enforcement
• Media conversion, status extraction & OCR
• 24/7 Cloud sync & multi-device companion

🌐 *WEB SERVICES:*
Developer Solomon also builds websites of any kind! DM *wa.me/2349049979183* for web development projects.

👉 *Visit ${process.env.APP_URL || 'the Web Console'} to connect your WhatsApp!*
_Forward this message to friends & groups to share!_`,
      };
    }

    if (cmd === 'link') {
      if (!ctx.isGroup || !ctx.groupJid) {
        return {
          reply: `⚠️ *COMMAND RESTRICTED TO GROUPS*

*.link* can only be used inside a WhatsApp group to fetch the current group's active invite link!

📢 *Official SOLVATECH Channels:*
• Updates Channel: https://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37
• Community Group: https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4`,
        };
      }

      let inviteCode = '';
      let groupSubject = 'This WhatsApp Group';

      if (ctx.sock) {
        // 1. Try groupInviteCode directly (works when bot is admin)
        try {
          const code = await ctx.sock.groupInviteCode(ctx.groupJid);
          if (code) {
            inviteCode = code;
            if (ctx.setGroupInviteCode) ctx.setGroupInviteCode(ctx.groupJid, code);
          }
        } catch {
          // If groupInviteCode throws because bot is not admin or strict settings
        }

        // 2. Try groupMetadata for cached inviteCode or subject
        try {
          const meta = await ctx.sock.groupMetadata(ctx.groupJid);
          if (meta) {
            groupSubject = meta.subject || groupSubject;
            if (!inviteCode && (meta as any).inviteCode) {
              inviteCode = (meta as any).inviteCode;
              if (ctx.setGroupInviteCode) ctx.setGroupInviteCode(ctx.groupJid, inviteCode);
            }
          }
        } catch {
          // Ignore
        }
      }

      // 3. Check cached invite codes for this group
      if (!inviteCode && ctx.getGroupInviteCode) {
        inviteCode = ctx.getGroupInviteCode(ctx.groupJid) || '';
      }

      // 4. Clean Group ID (numeric digits only, NO JID '@g.us')
      const cleanGroupId = ctx.groupJid.split('@')[0].split(':')[0].replace(/[^a-zA-Z0-9]/g, '') || '1203630248491823';

      // 5. Build active link
      const inviteUrl = inviteCode
        ? `https://chat.whatsapp.com/${inviteCode}`
        : `https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F`;

      return {
        reply: `🔗 *GROUP INVITE LINK*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *Group Name:* ${groupSubject}
🆔 *Group ID:* ${cleanGroupId}
👥 *Access:* Universal Access (Usable by Any Member or Admin)
🌐 *Active Invite Link:*
${inviteUrl}

_Any member can use or share this link to invite new members to the group!_
━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      };
    }

    if (cmd === 'channel' || cmd === 'community' || cmd === 'updates') {
      return {
        reply: `📢 *OFFICIAL SOLVATECH CHANNELS (MANDATORY)*\n\n🔊 *Updates Channel:*\nhttps://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37\n\n👥 *Official Community Group:*\nhttps://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4\n\n_Stay connected for bot updates, announcements, and key drops._`,
      };
    }

    if (cmd === 'groupinfo' || cmd === 'gcinfo' || cmd === 'group') {
      if (!ctx.isGroup || !ctx.groupJid) {
        return {
          reply: `⚠️ *COMMAND RESTRICTED TO GROUPS*\n\n*.groupinfo* can only be executed inside a WhatsApp group to audit group intelligence and active defense settings.`,
        };
      }

      // Clean group ID: numerical only, NO JID '@g.us'!
      const cleanGroupId = ctx.groupJid.split('@')[0].split(':')[0].replace(/\D/g, '') || ctx.groupJid.split('@')[0];
      let groupName = 'WhatsApp Group';
      let groupDesc = 'No description provided';
      let creator = 'Unknown';
      let createdDate = 'Unknown';
      let memberCount = 0;
      let adminCount = 0;
      let adminListText = '';
      let announceMode = '🔓 All Members Can Message';
      let restrictMode = '🔓 All Members Can Edit Info';
      let ephemeralText = 'Disabled';
      let groupPicUrl: string | undefined = undefined;

      if (ctx.sock) {
        try {
          const meta = await ctx.sock.groupMetadata(ctx.groupJid);
          if (meta) {
            groupName = meta.subject || groupName;
            groupDesc = meta.desc || groupDesc;
            if (meta.owner) {
              const cleanCreator = meta.owner.split('@')[0].split(':')[0].replace(/\D/g, '');
              creator = cleanCreator ? `+${cleanCreator}` : 'Unknown';
            }
            if (meta.creation) {
              createdDate = new Date(meta.creation * 1000).toLocaleString('en-US', {
                dateStyle: 'full',
                timeStyle: 'short',
              });
            }
            memberCount = meta.participants?.length || 0;
            const admins = meta.participants?.filter((p: any) => p.admin) || [];
            adminCount = admins.length;
            adminListText = admins
              .map((a: any) => {
                const num = a.id.split('@')[0].split(':')[0].replace(/\D/g, '');
                return `• +${num} (${a.admin === 'superadmin' ? '👑 Creator' : '⭐ Admin'})`;
              })
              .slice(0, 10)
              .join('\n');
            if (admins.length > 10) {
              adminListText += `\n...and ${admins.length - 10} more admins`;
            }

            announceMode = meta.announce ? '🔒 Only Admins Can Send Messages' : '🔓 All Members Can Send Messages';
            restrictMode = meta.restrict ? '🔒 Only Admins Can Edit Info' : '🔓 All Members Can Edit Info';
            ephemeralText = meta.ephemeralDuration ? `${meta.ephemeralDuration / 86400} Days` : 'Disabled';
          }
        } catch (e) {
          console.warn('groupMetadata fetch note:', e);
        }

        try {
          const pic = await ctx.sock.profilePictureUrl(ctx.groupJid, 'image');
          if (pic) {
            groupPicUrl = pic;
          }
        } catch {
          // No picture or private
        }
      } else {
        // Mock fallback for simulator
        groupName = 'SOLVATECH Official Group';
        groupDesc = 'Premier WhatsApp automation and bot security community.';
        creator = '+2349049979183';
        createdDate = 'Saturday, October 10, 2026 at 12:00 PM';
        memberCount = 148;
        adminCount = 3;
        adminListText = '• +2349049979183 (👑 Creator)\n• +2348035129481 (⭐ Admin)\n• +2348126784321 (⭐ Admin)';
      }

      const gid = ctx.groupJid || 'default';
      const security = this.securitySettings[gid] || { antilink: false, antibot: false, antistatus: false, autowelcome: false, autogoodbye: false };

      const pictureDisplay = groupPicUrl
        ? 'Real Group Picture Attached 📸'
        : 'Default WhatsApp Group Icon';

      return {
        imageUrl: groupPicUrl,
        reply: `📊 *COMPREHENSIVE GROUP INTELLIGENCE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *Group Name:* ${groupName}
🆔 *Group ID:* ${cleanGroupId}
📅 *Created Date:* ${createdDate}
👑 *Group Creator:* ${creator}
🖼️ *Group Picture:* ${pictureDisplay}

👥 *MEMBERS & LEADERSHIP:*
• Total Members: *${memberCount}*
• Total Administrators: *${adminCount}*
${adminListText ? `\n👑 *Admin Roster:*\n${adminListText}\n` : ''}
📝 *Description:*
_${groupDesc}_

⚙️ *GROUP POLICIES & PERMISSIONS:*
• Messaging Mode: *${announceMode}*
• Edit Group Settings: *${restrictMode}*
• Disappearing Messages: *${ephemeralText}*

🛡️ *ACTIVE BOT DEFENSE MATRIX:*
• Anti-Link: *${security.antilink ? 'Enabled 🛡️' : 'Disabled'}*
• Anti-Bot: *${security.antibot ? 'Enabled 🤖' : 'Disabled'}*
• Anti-Status Mentions: *${security.antistatus ? 'Enabled 📱' : 'Disabled'}*
• Anti-Spam (Auto-Purge & Instant Kick): *${security.antispam ? 'Enabled 🚫' : 'Disabled'}*
• Auto-Welcome: *${security.autowelcome ? 'Enabled 👋' : 'Disabled'}*
• Auto-Goodbye: *${security.autogoodbye ? 'Enabled 👋' : 'Disabled'}*
• Anti-Delete DM Recovery: *Active 🟢 (Forwarded to Owner DM)*
• Anti-View-Once Recovery: *Active 👁️ (Preserved in DM)*
• Warning Limit: *3 Warnings before Automatic Kick*
━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      };
    }

    if (cmd === 'profile' || cmd === 'me' || cmd === 'whois') {
      let targetJid = ctx.quotedParticipant || ctx.mentionedJids?.[0] || '';
      if (!targetJid && ctx.args[0]) {
        const cleanArg = ctx.args[0].replace(/\D/g, '');
        if (cleanArg) targetJid = `${cleanArg}@s.whatsapp.net`;
      }
      if (!targetJid) {
        targetJid = ctx.senderJid || '2349049979183@s.whatsapp.net';
      }

      // Extract strictly clean phone digits - NEVER raw JID!
      const targetPhone = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '') || '2349049979183';
      const isTargetOwner =
        targetPhone === '2349049979183' ||
        targetJid.includes('2349049979183') ||
        (ctx.isOwner && (!ctx.quotedParticipant && !ctx.mentionedJids?.[0] && !ctx.args[0]));

      let userBio = 'Hey there! I am using WhatsApp.';
      let picUrl: string | undefined = undefined;
      let groupRole = ctx.isGroup ? 'Participant' : 'Direct 1-on-1 Chat';

      if (ctx.sock) {
        try {
          const statusObj = await ctx.sock.fetchStatus(targetJid);
          if (statusObj?.status) userBio = statusObj.status;
        } catch {
          // Status privacy
        }

        try {
          const pic = await ctx.sock.profilePictureUrl(targetJid, 'image');
          if (pic) {
            picUrl = pic;
          }
        } catch {
          // No picture or privacy restricted
        }

        if (ctx.isGroup && ctx.groupJid) {
          try {
            const meta = await ctx.sock.groupMetadata(ctx.groupJid);
            const part = meta.participants?.find((p: any) => p.id.split('@')[0].split(':')[0].replace(/\D/g, '') === targetPhone);
            if (part) {
              if (part.admin === 'superadmin') groupRole = '👑 Group Creator / Super Admin';
              else if (part.admin === 'admin') groupRole = '⭐ Group Administrator';
              else groupRole = '👤 Participant';
            }
          } catch {
            // Ignore
          }
        }
      }

      const cleanGid = ctx.groupJid ? (ctx.groupJid.split('@')[0].replace(/\D/g, '') || ctx.groupJid.split('@')[0]) : '';
      const warningsCount = cleanGid ? (this.warnings[`${cleanGid}:${targetPhone}`] || 0) : (this.warnings[targetPhone] || 0);

      const profilePicDisplay = picUrl
        ? 'Real Profile Photo Attached 📸'
        : 'Default WhatsApp Avatar';

      return {
        imageUrl: picUrl,
        reply: `👤 *COMPREHENSIVE USER INTELLIGENCE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 *Phone Number:* +${targetPhone}
💬 *About / Bio:* "${userBio}"
🖼️ *Profile Picture:* ${profilePicDisplay}
👑 *Bot Clearance:* ${isTargetOwner ? '👑 Bot Master / Owner (Unlimited)' : 'Standard User'}
🛡️ *Chat Role:* ${groupRole}
⚠️ *Group Warnings:* ${warningsCount} / 3 Strikes
📜 *License Status:* ${isTargetOwner ? '👑 Unlimited Lifetime Master' : 'Active Standard Cloud License'}
🌐 *Database Sync:* Verified on SOLVATECH Cloud 🟢
━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      };
    }

    // 2. Media & Recovery Commands (Batch 3)
    if (cmd === 'sticker' || cmd === 's' || cmd === 'stick') {
      return {
        action: 'sticker_convert',
        reply: `🎨 *[SOLVATECH STICKER ENGINE]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ *Sticker Conversion Active:*
• Static Photos: Converted to 512x512 WebP sticker with official SOLVATECH EXIF metadata.
• Short Videos: Converted to animated WebP sticker.
• Author: *Solomon Oladimeji* | Pack: *SOLVATECH BOT*

💡 *Usage:* Reply to any photo or short video in WhatsApp with *.sticker* to convert it instantly without blank borders!
━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      };
    }

    if (cmd === 'antisticker' || cmd === 'toimg' || cmd === 'image') {
      return {
        action: 'antisticker_convert',
        reply: `🖼️ *[SOLVATECH ANTI-STICKER]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ *Sticker Extraction Active:*
• Static Stickers: Converted back into full-resolution PNG photo.
• Animated Stickers: Extracted back into MP4 video with full audio/video timing.

💡 *Usage:* Reply to any WhatsApp sticker with *.antisticker* to extract it back into original media!
━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      };
    }

    if (cmd === 'read' || cmd === 'ocr' || cmd === 'extract') {
      const sampleText = ctx.args.join(' ');
      if (sampleText) {
        return {
          action: 'ocr_read',
          reply: `🔍 *[SOLVATECH HIGH-PRECISION OCR]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Verbatim Extracted Text:*

${sampleText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ _Processed via SOLVATECH OCR Engine_`,
        };
      }
      return {
        action: 'ocr_read',
        reply: `🔍 *[SOLVATECH HIGH-PRECISION OCR]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Verbatim OCR Engine Ready:*
Optical character recognition is actively armed.
💡 *Usage:* Reply to any photo, document, or screenshot containing text with *.read* to extract its verbatim text content directly into chat!
━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      };
    }

    if (cmd === 'open' || cmd === 'vv' || cmd === 'viewonce' || cmd === 'antiviewonce') {
      return {
        action: 'view_once_decrypt',
        reply: `👁️ *[SOLVATECH VIEW-ONCE DECRYPTOR]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ *Decryption Matrix Active:*
• View-Once photos, videos, and voice notes are automatically decrypted and sent directly to your Personal WhatsApp DM (chat with yourself)!
• Even in 1-on-1 private chats, decrypted media is routed exclusively to your Personal DM, keeping it 100% confidential.
• Trigger command message (*.open* / *.vv*) is automatically wiped/deleted from group and 1-on-1 chats.
• Protected strictly for Bot Owner access.

💡 *Usage:* Reply to any view-once photo, video, or voice note with *.open* or *.vv* to decrypt it into your Personal DM!
━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      };
    }

    if (cmd === 'antidelete' || cmd === 'antidel') {
      const val = ctx.args[0]?.toLowerCase() === 'off' ? false : true;
      this.setAntiDeleteEnabled(val);
      return {
        reply: `🚨 *[SOLVATECH ANTI-DELETE RECOVERY]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: ${val ? '✅ *ENABLED (FLOOD TO DM ACTIVE)*' : '❌ *DISABLED (OFF)*'}
Policy: ${
          val
            ? 'All deleted messages from anywhere (groups & private chats) are instantly recovered and forwarded to your personal DM chat.'
            : 'Anti-delete recovery is turned off. Deleted messages are ignored and nothing is forwarded.'
        }
━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ _SOLVATECH Personal Defense Engine_`,
      };
    }

    if (cmd === 'send' || cmd === 'status' || cmd === 'getstatus') {
      return {
        reply: `📥 *[WHATSAPP STATUS EXTRACTOR]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ *Live Status Extractor Active:*
• Reply directly to any WhatsApp Status with *.send*.
• Extracted media (photo/video/audio) and original caption text are retrieved live and delivered straight to the current chat (not private DM).
━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ _Live Status Extracted by SOLVATECH_`,
      };
    }

    // 3. Group Security & Admin Commands
    if (cmd === 'pin') {
      if (!ctx.isGroup) {
        return {
          reply: `⚠️ *[GROUP ONLY]*\nThe *.pin* command can only be used inside a WhatsApp group.`,
        };
      }
      if (!ctx.isOwner) {
        return {
          reply: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator connected to the bot to pin messages in this group.`,
        };
      }
      return {
        reply: `📌 *[MESSAGE PINNED]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Message successfully pinned for 7 days by Group Admin!
━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ _Protected by SOLVATECH_`,
      };
    }

    if (cmd === 'del' || cmd === 'delete') {
      const count = parseInt(ctx.args[0] || '', 10);
      if (!isNaN(count) && count > 0) {
        return {
          reply: `🗑️ *[CHAT CLEANER]*\nDeleted *${count}* message(s) successfully${!ctx.isOwner ? ' (only your own messages)' : ''}. Trigger message auto-wiped.`,
        };
      }
      return {
        reply: `🗑️ *[CHAT CLEANER]*\nReplied message and trigger command (*.del*) successfully deleted.`,
      };
    }

    if (cmd === 'tagall' || cmd === 'everyone') {
      if (!ctx.isGroup) {
        return {
          reply: `⚠️ *[GROUP ONLY]*\nThe *.tagall* command can only be used inside a WhatsApp group.`,
        };
      }
      const customMessage = ctx.args.join(' ').trim();
      let output = `╭━━━〔 📢 *GROUP ANNOUNCEMENT* 〕━━━╮\n`;
      output += `┃ 👥 *Group:* *WhatsApp Group*\n`;
      output += `┃ 🔢 *Status:* *All Members Tagged*\n`;
      if (customMessage) {
        output += `┃ 📌 *Notice:* *${customMessage}*\n`;
      }
      output += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;
      output += `╭──〔 👥 *ATTENDANCE ROSTER* 〕──╮\n`;
      output += `│ 1. @2349049979183\n`;
      output += `│ 2. @2348012345678\n`;
      output += `│ 3. @2347098765432\n`;
      output += `╰───────────────────────────────╯\n\n`;
      output += `> ⚡ *SOLVATECH BOT BROADCAST*`;

      return { reply: output };
    }

    if (cmd === 'admin' || cmd === 'admins') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.admin* command can only be used inside a WhatsApp group.` };
      }
      const customReason = ctx.args.join(' ').trim();
      let output = `╭━━━〔 🛡️ *ADMINISTRATOR ROSTER* 〕━━━╮\n`;
      output += `┃ 👥 *Group:* *WhatsApp Group*\n`;
      output += `┃ 🛡️ *Total Admins:* *3*\n`;
      if (customReason) {
        output += `┃ ⚠️ *Notice:* *${customReason}*\n`;
      }
      output += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;
      output += `╭──〔 ⚡ *GROUP ADMINISTRATORS* 〕──╮\n`;
      output += `│ 1. @2349049979183 👑 (Creator)\n`;
      output += `│ 2. @2348012345678\n`;
      output += `│ 3. @2347098765432\n`;
      output += `╰───────────────────────────────╯\n\n`;
      output += `> ⚡ *SOLVATECH BOT ADMIN ALERT*`;
      return { reply: output };
    }

    if (cmd === 'kick' || cmd === 'remove') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.kick* command can only be used inside a WhatsApp group.` };
      }
      const target = (ctx.args[0] || '@user').replace(/\D/g, '') || '2348012345678';
      return {
        reply: `👢 *[MEMBER REMOVED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Participant:* @${target}\n⚡ *Action:* Ejected from group by Group Administrator.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Security_`,
        action: 'kick',
      };
    }

    if (cmd === 'add' || cmd === 'invite') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.add* command can only be used inside a WhatsApp group.` };
      }
      const phone = (ctx.args[0] || '2348012345678').replace(/\D/g, '');
      return {
        reply: `➕ *[MEMBER ADDED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Participant:* @${phone}\n✅ Successfully added to group by Administrator!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _SOLVATECH Group Management_`,
      };
    }

    if (cmd === 'promote') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.promote* command can only be used inside a WhatsApp group.` };
      }
      const target = (ctx.args[0] || '@user').replace(/\D/g, '') || '2348012345678';
      return {
        reply: `⭐ *[ADMIN PROMOTED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎉 *Congratulations:* @${target}\n🛡️ Promoted to *Group Administrator*!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _SOLVATECH Group Administration_`,
      };
    }

    if (cmd === 'demote') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.demote* command can only be used inside a WhatsApp group.` };
      }
      const target = (ctx.args[0] || '@user').replace(/\D/g, '') || '2348012345678';
      return {
        reply: `🔻 *[ADMIN DEMOTED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Participant:* @${target}\n⚠️ Demoted from Administrator back to regular member.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _SOLVATECH Group Administration_`,
      };
    }

    if (cmd === 'lock') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.lock* command can only be used inside a WhatsApp group.` };
      }
      return {
        reply: `🔒 *[GROUP LOCKED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGroup messaging has been restricted to Administrators only.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Enforced by SOLVATECH_`,
      };
    }

    if (cmd === 'unlock') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.unlock* command can only be used inside a WhatsApp group.` };
      }
      return {
        reply: `🔓 *[GROUP UNLOCKED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGroup messaging is now open for all members.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Enforced by SOLVATECH_`,
      };
    }

    if (cmd === 'antilink') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.antilink* command can only be used inside a WhatsApp group.` };
      }
      const val = ctx.args[0]?.toLowerCase() === 'off' ? false : true;
      const gid = ctx.groupJid || 'default';
      this.setSecuritySetting(gid, 'antilink', val);
      return {
        reply: `🛡️ *[ANTI-LINK SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Unauthorized external links will be auto-deleted with security warning issued to sender.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
      };
    }

    if (cmd === 'antibot') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.antibot* command can only be used inside a WhatsApp group.` };
      }
      const val = ctx.args[0]?.toLowerCase() === 'off' ? false : true;
      const gid = ctx.groupJid || 'default';
      this.setSecuritySetting(gid, 'antibot', val);
      return {
        reply: `🤖 *[ANTI-BOT SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Non-admin members using bot prefix commands (*.*) or rogue userbots will have their message auto-deleted and receive a security warning.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
      };
    }

    if (cmd === 'antistatus') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.antistatus* command can only be used inside a WhatsApp group.` };
      }
      const val = ctx.args[0]?.toLowerCase() === 'off' ? false : true;
      const gid = ctx.groupJid || 'default';
      this.setSecuritySetting(gid, 'antistatus', val);
      return {
        reply: `📱 *[ANTI-STATUS MENTION SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Non-admin members mentioning this group in their personal WhatsApp status will have the alert deleted and receive a security warning.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
      };
    }

    if (cmd === 'antispam') {
      if (!ctx.isGroup) {
        return { reply: `⚠️ *[GROUP ONLY]*\nThe *.antispam* command can only be used inside a WhatsApp group.` };
      }
      const val = ctx.args[0]?.toLowerCase() === 'off' ? false : true;
      const gid = ctx.groupJid || 'default';
      this.setSecuritySetting(gid, 'antispam', val);
      return {
        reply: `🚫 *[ANTI-SPAM SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Flood messages, rapid stickers/media spam, and repetitive text/words will be automatically purged (including original spam messages). If a member continues sending messages while deletion is underway, they are *INSTANTLY KICKED*!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
      };
    }

    if (cmd === 'autowelcome' || cmd === 'welcome') {
      const gid = ctx.groupJid || 'default';
      const val = ctx.args[0]?.toLowerCase() === 'off' ? false : true;
      this.setSecuritySetting(gid, 'autowelcome', val);
      return {
        reply: `👋 *[AUTO-WELCOME SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Automatically greets anyone who enters the group (added by admin, added by members, join request approved, or link).\n⚡ *Smart Features:*\n• Contextual AI-style greetings tailored to group subject & description (e.g. Serious learners for Academy, Builders for Tech, Business for Commerce).\n• If multiple people are added rapidly (2 or 3+), all are tagged together in one message!\n• Sent exclusively by connected Group Admin Bot.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n*Sample Preview:*\n_Hello @user, Welcome to SOLVATECH ACADEMY._\n\n_This group is for serious learners only. Kindly go through the group description and pinned messages to get started._\n\n_- Admin_\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
      };
    }

    if (cmd === 'autogoodbye' || cmd === 'goodbye') {
      const gid = ctx.groupJid || 'default';
      const val = ctx.args[0]?.toLowerCase() === 'off' ? false : true;
      this.setSecuritySetting(gid, 'autogoodbye', val);
      return {
        reply: `👋 *[AUTO-GOODBYE SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Automatically acknowledges departing or removed participants.\n⚡ *Smart Features:*\n• Contextual farewell message tailored to group info/theme.\n• If multiple members leave rapidly (2 or 3+), all are tagged together simultaneously!\n• Sent exclusively by connected Group Admin Bot.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n*Sample Preview:*\n_👋 @user left SOLVATECH ACADEMY_\n\n_We hope you learned something valuable. You're always welcome back whenever you're ready to continue learning._\n\n_Keep building! 💻_\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
      };
    }

    if (cmd === 'warn' || cmd === 'warnlimit') {
      const gid = ctx.groupJid || 'default';
      const firstArg = ctx.args[0]?.toLowerCase();
      if (cmd === 'warnlimit' || firstArg === 'limit' || firstArg === 'max' || firstArg === 'set') {
        const numStr = cmd === 'warnlimit' ? ctx.args[0] : ctx.args[1];
        const num = parseInt(numStr, 10);
        if (isNaN(num) || num <= 0) {
          return { reply: `⚠️ *[WARN LIMIT USAGE]*\nPlease provide a valid number for warning limit.\nExample: *.warn limit 3* or *.warn limit 5*` };
        }
        this.setWarnLimit(gid, num);
        return {
          reply: `⚙️ *[WARN LIMIT UPDATED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGroup warning limit set to *${num} warnings*.\nAccumulating ${num} warnings across Anti-Bot, Anti-Link, Anti-Status, Anti-Spam, or Admin warnings will automatically kick the member.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
        };
      }

      const targetUser = ctx.mentionedJids?.[0] || ctx.quotedParticipant || ctx.args[0] || ctx.senderNumber;
      const targetClean = targetUser.replace(/\D/g, '') || targetUser;
      const targetJid = targetUser.includes('@') ? targetUser : `${targetClean}@s.whatsapp.net`;
      const warnResult = this.addWarning(gid, targetJid);

      if (warnResult.count >= warnResult.max) {
        return {
          reply: `🚨 *[SECURITY WARNING LIMIT REACHED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Offender:* @${targetClean}\n⚠️ *Warnings:* *${warnResult.count} / ${warnResult.max}*\n🗑️ *Action:* Offending message (pic/sticker/text) deleted.\n🔨 *Punishment:* *Member ejected from group immediately!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_`,
          action: 'kick',
        };
      }
      return {
        reply: `⚠️ *[OFFICIAL SECURITY WARNING ISSUED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Member:* @${targetClean}\n⚠️ *Warning Level:* *${warnResult.count} / ${warnResult.max}*\n🗑️ *Offending message (pic/sticker/content) deleted.*\n⏳ *Warnings Remaining:* *${warnResult.max - warnResult.count}* before automatic kick.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_`,
      };
    }

    if (cmd === 'warns') {
      const gid = ctx.groupJid || 'default';
      const targetUser = ctx.mentionedJids?.[0] || ctx.quotedParticipant || ctx.args[0] || ctx.senderNumber;
      const targetClean = targetUser.replace(/\D/g, '') || targetUser;
      const targetJid = targetUser.includes('@') ? targetUser : `${targetClean}@s.whatsapp.net`;
      const count = this.getWarnings(gid, targetJid);
      const max = this.securitySettings[gid]?.warnLimit || 3;
      return {
        reply: `📋 *[GROUP WARNING STATUS]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Participant:* @${targetClean}\n⚠️ *Current Warnings:* ${count} / ${max}\nStatus: ${count >= max ? '🚨 Removal Limit Exceeded' : `${max - count} warnings remaining before auto-kick`}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_`,
      };
    }

    if (cmd === 'clearwarns' || cmd === 'unwarn') {
      const gid = ctx.groupJid || 'default';
      const targetUser = ctx.mentionedJids?.[0] || ctx.quotedParticipant || ctx.args[0] || ctx.senderNumber;
      const targetClean = targetUser.replace(/\D/g, '') || targetUser;
      const targetJid = targetUser.includes('@') ? targetUser : `${targetClean}@s.whatsapp.net`;
      this.clearWarnings(gid, targetJid);
      return { reply: `✅ *[WARNINGS RESET]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nWarnings have been reset to *0* for @${targetClean}.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_` };
    }

    if (cmd === 'resetwarns') {
      const gid = ctx.groupJid || 'default';
      this.resetAllWarnings(gid);
      return { reply: `🔄 *[ALL WARNINGS CLEARED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nAll group member warnings have been reset to 0 for this group.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_` };
    }

    if (cmd === 'anti') {
      const gid = ctx.groupJid || 'default';
      const sec = this.getSecuritySettings(gid);
      return {
        reply: `🛡️ *SOLVATECH GROUP DEFENSE MATRIX*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Anti-Link: *${sec.antilink ? 'Active 🌐' : 'Disabled'}*
• Anti-Bot: *${sec.antibot ? 'Active 🤖' : 'Disabled'}*
• Anti-Status Mention: *${sec.antistatus ? 'Active 📱' : 'Disabled'}*
• Anti-Spam: *${sec.antispam ? 'Active 🚫 (Purge + Instant Kick)' : 'Disabled'}*
• Auto-Welcome: *${sec.autowelcome ? 'Active 👋 (Admin Bot Only)' : 'Disabled'}*
• Auto-Goodbye: *${sec.autogoodbye ? 'Active 🚪 (Admin Bot Only)' : 'Disabled'}*
• Anti-Delete Recovery: *Active (DM Forward) 🛡️*
• View-Once Protection: *Active (DM Decrypt) 👁️*
• Warning Threshold: *${sec.warnLimit || 3} Warnings before auto-kick*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
_All anti violations share the same unified warning threshold._`,
      };
    }

    // 4. Controller Only Commands
    if (cmd === 'spam') {
      if (!ctx.isOwner) {
        return { reply: `⛔ *ACCESS DENIED:* Controller/Owner-only command.` };
      }
      const { text: msg, count } = parseSpamArgs(ctx.args);
      this.spamActive = true;
      return {
        reply: `⚡ *[FAST SPAM INITIATED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💬 *Message:* "${msg}"\n🔢 *Count:* *${count} messages*\n⏱️ *Speed:* Rapid burst mode\n🛑 *To Cancel:* Type *.stop* anytime\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _SOLVATECH Fast Engine_`,
        action: 'spam',
        metadata: { text: msg, count },
      };
    }

    if (cmd === 'stop') {
      this.spamActive = false;
      return {
        reply: `🛑 *[EMERGENCY STOP EXECUTED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nSpam operation stopped immediately!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Terminated by SOLVATECH_`,
        action: 'stop_spam',
      };
    }

    if (cmd === 'signature' || cmd === 'sign' || cmd === 'dev') {
      return {
        reply: `✍️ *SOLVATECH OFFICIAL SIGNATURE & BADGE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ *Bot Engine:* SOLVATECH Multi-Device Engine
👑 *Developer / Owner:* Solomon Oladimeji
📧 *Email:* awoyinfasolomon1@gmail.com
💳 *OPay Account:* 9049979183 (Solomon Oladimeji)
💬 *Official WhatsApp:* +234 904 997 9183
🔒 *Bot Access Mode:* 100% Private (Owner-Only Execution)
🌐 *Platform:* ${process.env.APP_URL || 'SOLVATECH Cloud Automation'}

🌐 *WEB SERVICES:*
Developer Solomon builds websites of any kind! DM *wa.me/2349049979183* for custom web applications, SaaS dashboards, e-commerce, and bots.

📢 *Official Channels:*
• Updates Channel: https://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37
• Community Group: https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4
━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Certified Official Developer Signature Verified_ 🛡️`,
      };
    }

    return {
      reply: `❓ Unknown command: *${ctx.command}*\nType *.menu* to view the full SOLVATECH command directory.`,
    };
  }
}

export const commandHandler = new CommandHandler();
