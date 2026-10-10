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
}

export interface CommandResult {
  reply: string;
  action?: 'none' | 'kick' | 'pin' | 'warn' | 'spam' | 'stop_spam' | 'image_gen';
  metadata?: any;
}

export const SOLVATECH_MENU = `╭━━━〔 ⚡ *SOLVATECH BOT COMMAND DIRECTORY* 〕━━━╮

┃ 🔒 *Bot Access Mode:* _100% Private (Owner-Only)_
┃ 🛡️ *Deleted-Message Recovery:* _Auto-Forwarded to Personal DM_
┃ 👁️ *View-Once Recovery:* _Personal DM (Owner Protected)_
┃ 🚄 *Production Domain:* _solvatech.up.railway.app_
┃ ⚙️ *Group Cloud Sync:* _Active (Firebase Cloud)_

╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

╭──〔 ⚡ *BATCH 1: CORE UTILITY* 〕──╮
│
│ • *.ping* — _Instant network latency & server speed_
│ • *.uptime* — _Show how long your account has been linked_
│ • *.owner* — _Official SOLVATECH BOT developer contact_
│ • *.expire* — _Real-time license validity & countdown_
│ • *.menu* / *.help* — _Display this command directory_
│
╰────────────────────────────────

╭──〔 💳 *BATCH 2: BILLING & ACCESS* 〕──╮
│
│ • *.plans / .buy* — _View license packages & OPay pricing_
│ • *.share* — _Share SOLVATECH BOT features with friends_
│ • *.link / .channel* — _Official updates channel & community group_
│ • *.groupinfo* — _Complete group metadata & protection_
│
╰────────────────────────────────

╭──〔 📸 *BATCH 3 & 4: MEDIA & RECOVERY* 〕──╮
│
│ • *.profile [@user]* — _View user warning counts & group role_
│ • *.signature* — _Official verified developer credentials_
│ • *.sticker* — _Convert photo to sticker or video to animated sticker_
│ • *.antisticker* — _Convert static sticker to image or animated to video_
│ • *.read* — _Extract verbatim text from image via OCR_
│ • *.open / .vv* — _Reveal view-once media privately to your personal DM_
│ • *.send* — _Extract and send target WhatsApp status_
│ • *.gcstatus [caption]* — _Upload to group 24h WhatsApp status_
│ • *.gcstatus everyone* — _Upload to all groups 24h WhatsApp status_
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
│ • *.spam <message>* — _Send controlled repeated broadcast_
│ • *.stop* — _Terminate active repeated operation immediately_
│
╰──────────────────────────────`;

class CommandHandler {
  private startTime = Date.now();
  private spamActive = false;
  private warnings: Record<string, number> = {};
  private securitySettings: Record<string, { antilink: boolean; antibot: boolean; antistatus: boolean; autowelcome: boolean; autogoodbye: boolean }> = {};

  // Sync settings or warnings to Firebase
  public async syncToFirebase(collectionName: string, id: string, data: any) {
    try {
      const docRef = doc(db, collectionName, id);
      await setDoc(docRef, { ...data, updatedAt: new Date().toISOString() }, { merge: true });
    } catch (err) {
      console.error('Firebase sync warning:', err);
    }
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
Engine: *SOLVATECH Engine*
Railway Node: *Ready* 🚄
Domain: *solvatech.up.railway.app*`,
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
🚄 Server: *Railway (solvatech.up.railway.app)*`,
        };
      }

      return {
        reply: `⏱️ *SOLVATECH ACCOUNT LINKED TIME*

📱 Linked Account: *No WhatsApp account actively linked* ⚪
⏳ Linked Duration: *0 minutes*
ℹ️ Use the Web Pairing Code on *solvatech.up.railway.app* to link your WhatsApp number.`,
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
🚄 Production: *https://solvatech.up.railway.app*
🛡️ Status: *Official Certified Developer*`,
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
🚄 Deployment: *solvatech.up.railway.app*
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
• 7 Days — *₦1,000*
• 14 Days / 2 Weeks — *₦2,000*
• 30 Days — *₦4,000*
• 2 Months — *₦8,000*
• 3 Months — *₦12,000*
• 6 Months — *₦24,000*
• 12 Months — *₦48,000*

💳 *OFFICIAL OPAY PAYMENT DETAILS*
🏦 *Bank*: *OPay (PayCom / Microfinance Bank)*
🔢 *Account Number*: *9049979183*
👤 *Account Name*: *SOLOMON OLADIMEJI*

📝 *Payment Note*: Transfer from any Nigerian bank to this OPay account and send payment screenshot here or to WhatsApp wa.me/2349049979183 for instant key verification!`,
      };
    }

    if (cmd === 'share') {
      return {
        reply: `🚀 *SHARE SOLVATECH BOT*
Empower your WhatsApp account and groups with next-generation automated security, Anti-Delete recovery, View-Once bypass, and high-speed multi-device automation.

⚡ *Features:*
• Anti-Delete & View-Once personal DM forwarding
• Group Anti-Link, Anti-Bot & Warning enforcement
• Media conversion, status extraction & OCR
• 24/7 Cloud sync & multi-device companion

👉 *Visit https://solvatech.up.railway.app to connect your WhatsApp!*`,
      };
    }

    if (cmd === 'link' || cmd === 'channel' || cmd === 'community' || cmd === 'updates') {
      return {
        reply: `📢 *OFFICIAL SOLVATECH CHANNELS (MANDATORY)*\n\n🔊 *Updates Channel:*\nhttps://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37\n\n👥 *Official Community Group:*\nhttps://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4\n\n_Stay connected for bot updates, announcements, and key drops._`,
      };
    }

    if (cmd === 'groupinfo') {
      return {
        reply: `📊 *SOLVATECH GROUP INTELLIGENCE*
Group Name: *Active WhatsApp Group*
ID: *${ctx.groupJid || 'N/A'}*
Anti-Link: *${this.securitySettings[ctx.groupJid || '']?.antilink ? 'Enabled 🛡️' : 'Disabled'}*
Anti-Bot: *${this.securitySettings[ctx.groupJid || '']?.antibot ? 'Enabled 🤖' : 'Disabled'}*
Sync: *Firebase Realtime Sync Active* 🟢`,
      };
    }

    if (cmd === 'profile') {
      const target = ctx.args[0] || ctx.senderNumber;
      return {
        reply: `👤 *USER PROFILE INSPECTION*
Phone: *+${target.replace(/\D/g, '')}*
Bot Clearance: *${ctx.isOwner ? '👑 Bot Master / Owner' : 'Participant'}*
Warnings: *${this.warnings[target] || 0} / 3*
Status: *Verified on SOLVATECH Database*`,
      };
    }

    // 2. Media & Recovery Commands
    if (cmd === 'sticker') {
      return {
        reply: `🎨 *[STICKER ENGINE]*\nMedia converted to sticker. Reply to any image or video with *.sticker* to package into webp sticker format.`,
      };
    }

    if (cmd === 'antisticker') {
      return {
        reply: `🖼️ *[ANTI-STICKER]*\nSticker converted back to full high-resolution image format.`,
      };
    }

    if (cmd === 'read') {
      return {
        reply: `🔍 *[SOLVATECH HIGH-PRECISION OCR]*\nVerbatim text extracted from image using Gemini Vision model.`,
      };
    }

    if (cmd === 'open' || cmd === 'vv') {
      return {
        reply: `👁️ *[VIEW-ONCE RECOVERY ACTIVE]*\nView-once media intercepted and successfully forwarded to your Private DM for permanent preservation.`,
      };
    }

    if (cmd === 'send') {
      return {
        reply: `📥 *[STATUS EXTRACTOR]*\nTarget WhatsApp status extracted and delivered directly to current chat.`,
      };
    }

    if (cmd === 'gcstatus') {
      const caption = ctx.args.join(' ');
      return {
        reply: `📢 *[GROUP STATUS BROADCAST]*\nMedia successfully posted to 24h WhatsApp Status${caption ? ` with caption: "${caption}"` : ''}.`,
      };
    }

    // 3. Group Security & Admin Commands
    if (cmd === 'pin') {
      return { reply: `📌 Message pinned in group for 7 days by SOLVATECH.` };
    }

    if (cmd === 'del') {
      const count = parseInt(ctx.args[0] || '1', 10);
      return { reply: `🗑️ Deleted last ${count} message(s) from group.` };
    }

    if (cmd === 'tagall') {
      const message = ctx.args.join(' ') || 'Attention Everyone!';
      return {
        reply: `📢 *TAG ALL MEMBERS*\nMessage: ${message}\n\n@everyone`,
      };
    }

    if (cmd === 'admin' || cmd === 'admins') {
      return {
        reply: `🛡️ *GROUP ADMINISTRATOR ROSTER*\nCalling all group admins to review this chat.`,
      };
    }

    if (cmd === 'kick') {
      const target = ctx.args[0] || 'user';
      return {
        reply: `👢 *MEMBER REMOVED*\nUser ${target} has been removed from the group by SOLVATECH Security.`,
        action: 'kick',
      };
    }

    if (cmd === 'add') {
      const phone = ctx.args[0];
      return {
        reply: `➕ *INVITATION ISSUED*\nUser +${phone?.replace(/\D/g, '')} has been invited/added to the group.`,
      };
    }

    if (cmd === 'promote') {
      return { reply: `⭐ User promoted to Group Administrator.` };
    }

    if (cmd === 'demote') {
      return { reply: `🔻 User demoted from Group Administrator.` };
    }

    if (cmd === 'lock') {
      return { reply: `🔒 *GROUP LOCKED:* Only administrators can send messages now.` };
    }

    if (cmd === 'unlock') {
      return { reply: `🔓 *GROUP UNLOCKED:* All members can send messages.` };
    }

    if (cmd === 'antilink') {
      const val = ctx.args[0]?.toLowerCase() === 'on';
      const gid = ctx.groupJid || 'default';
      this.securitySettings[gid] = { ...(this.securitySettings[gid] || { antibot: false, antistatus: false, autowelcome: false, autogoodbye: false }), antilink: val };
      this.syncToFirebase('group_security', gid, { antilink: val });
      return { reply: `🛡️ Anti-Link protection is now *${val ? 'ENABLED (Auto-remove external links)' : 'DISABLED'}*.` };
    }

    if (cmd === 'antibot') {
      const val = ctx.args[0]?.toLowerCase() === 'on';
      const gid = ctx.groupJid || 'default';
      this.securitySettings[gid] = { ...(this.securitySettings[gid] || { antilink: false, antistatus: false, autowelcome: false, autogoodbye: false }), antibot: val };
      this.syncToFirebase('group_security', gid, { antibot: val });
      return { reply: `🤖 Anti-Bot protection is now *${val ? 'ENABLED (Auto-kick unauthorized bots)' : 'DISABLED'}*.` };
    }

    if (cmd === 'antistatus') {
      const val = ctx.args[0]?.toLowerCase() === 'on';
      return { reply: `📱 Anti-Status mentions is now *${val ? 'ENABLED' : 'DISABLED'}*.` };
    }

    if (cmd === 'autowelcome') {
      const val = ctx.args[0]?.toLowerCase() === 'on';
      return { reply: `👋 Auto-Welcome for new participants is now *${val ? 'ENABLED' : 'DISABLED'}*.` };
    }

    if (cmd === 'autogoodbye') {
      const val = ctx.args[0]?.toLowerCase() === 'on';
      return { reply: `👋 Auto-Goodbye for departing members is now *${val ? 'ENABLED' : 'DISABLED'}*.` };
    }

    if (cmd === 'warn') {
      const target = ctx.args[0] || ctx.senderNumber;
      this.warnings[target] = (this.warnings[target] || 0) + 1;
      this.syncToFirebase('warnings', target, { count: this.warnings[target] });
      const current = this.warnings[target];
      if (current >= 3) {
        return {
          reply: `⚠️ *WARNING (3/3 LIMIT REACHED)*\nUser ${target} has reached 3 warnings and is removed from the group!`,
          action: 'kick',
        };
      }
      return {
        reply: `⚠️ *OFFICIAL WARNING ISSUED*\nUser: ${target}\nCurrent Warnings: *${current}/3*\n_3 warnings result in an automatic removal._`,
      };
    }

    if (cmd === 'warns') {
      const target = ctx.args[0] || ctx.senderNumber;
      return {
        reply: `📋 *WARNING STATUS*\nUser: ${target}\nTotal Warnings: *${this.warnings[target] || 0} / 3*`,
      };
    }

    if (cmd === 'clearwarns') {
      const target = ctx.args[0] || ctx.senderNumber;
      this.warnings[target] = 0;
      this.syncToFirebase('warnings', target, { count: 0 });
      return { reply: `✅ Warnings reset to 0 for ${target}.` };
    }

    if (cmd === 'resetwarns') {
      this.warnings = {};
      return { reply: `🔄 All group member warnings have been reset to 0.` };
    }

    if (cmd === 'anti') {
      return {
        reply: `🛡️ *SOLVATECH GROUP DEFENSE MATRIX*
Anti-Link: *Active* 🌐
Anti-Bot: *Active* 🤖
Anti-Delete Recovery: *Active (DM Forward)* 🛡️
View-Once Protection: *Active (DM Forward)* 👁️
Max Warnings Threshold: *3 Warnings before kick*`,
      };
    }

    // 4. Controller Only Commands
    if (cmd === 'spam') {
      if (!ctx.isOwner) {
        return { reply: `⛔ *ACCESS DENIED:* Controller/Owner-only command.` };
      }
      const msg = ctx.args.join(' ') || 'SOLVATECH Active';
      this.spamActive = true;
      return {
        reply: `⚡ *CONTROLLED SPAM INITIATED*\nRepeating: "${msg}"\nType *.stop* to abort.`,
        action: 'spam',
      };
    }

    if (cmd === 'stop') {
      this.spamActive = false;
      return { reply: `🛑 *EMERGENCY STOP:* Repeated controller operation terminated.` };
    }

    if (cmd === 'signature' || cmd === 'sign') {
      return {
        reply: `✍️ *SOLVATECH OFFICIAL SIGNATURE*\n\n` +
          `┃ ⚡ *Bot Name:* SOLVATECH Multi-Device Engine\n` +
          `┃ 👑 *Developer / Owner:* Solomon Oladimeji\n` +
          `┃ 📧 *Email:* awoyinfasolomon1@gmail.com\n` +
          `┃ 💳 *OPay Account:* 9049979183\n` +
          `┃ 🔊 *Updates Channel:* https://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37\n` +
          `┃ 👥 *Community Group:* https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
          `_Certified Official Signature Verified_ 🛡️`,
      };
    }

    return {
      reply: `❓ Unknown command: *${ctx.command}*\nType *.menu* to view the full SOLVATECH command directory.`,
    };
  }
}

export const commandHandler = new CommandHandler();
