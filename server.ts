import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { whatsappManager } from './src/server/whatsapp.ts';
import { commandHandler, SOLVATECH_MENU } from './src/server/commands.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json());

  // WhatsApp Baileys API endpoints
  app.get('/api/whatsapp/status', (_req, res) => {
    res.json({
      success: true,
      botName: 'SOLVATECH',
      firebaseProject: 'solvatechbot',
      status: whatsappManager.getStatus(),
    });
  });

  app.get('/api/whatsapp/notifications', (_req, res) => {
    res.json({
      success: true,
      notifications: whatsappManager.getNotifications(),
    });
  });

  app.delete('/api/whatsapp/notifications', (_req, res) => {
    whatsappManager.clearNotifications();
    res.json({ success: true, message: 'Notifications cleared' });
  });

  app.post('/api/whatsapp/pair-code', async (req, res) => {
    try {
      const { phoneNumber, isExpired = false, isUnlimited = false } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: 'Phone number is required',
        });
      }

      // STRICT RULE: Never should a user be connected to bot while license is expired (except unlimited or active trial)
      if (isExpired && !isUnlimited) {
        return res.status(403).json({
          success: false,
          error: 'Cannot connect to bot: License key has expired! Please renew your license to connect.',
        });
      }

      const pairingCode = await whatsappManager.requestPairingCode(phoneNumber);
      res.json({
        success: true,
        pairingCode,
        targetPhone: whatsappManager.getStatus().targetPhone || req.body.phoneNumber,
        status: whatsappManager.getStatus(),
      });
    } catch (err: any) {
      console.error('Pairing code error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to generate pairing code',
      });
    }
  });

  app.post('/api/whatsapp/send-message', async (req, res) => {
    try {
      const { to, message } = req.body;
      if (!to || !message) {
        return res.status(400).json({
          success: false,
          error: 'Recipient number ("to") and "message" are required',
        });
      }

      await whatsappManager.sendMessage(to, message);
      res.json({ success: true, message: 'Message sent successfully' });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to send WhatsApp message',
      });
    }
  });

  app.post('/api/whatsapp/test-dm', async (_req, res) => {
    try {
      const status = whatsappManager.getStatus();
      if (!status.isConnected) {
        return res.status(400).json({
          success: false,
          error: 'WhatsApp is not currently connected. Please pair your WhatsApp account first.',
        });
      }
      const rawPhone = status.user?.phone || status.targetPhone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '');
      if (!cleanPhone) {
        return res.status(400).json({
          success: false,
          error: 'Could not determine connected WhatsApp number.',
        });
      }
      await whatsappManager.sendMessage(
        cleanPhone,
        `🔔 *[SOLVATECH NOTIFICATION TEST]* 🔔\n\n✅ Your WhatsApp connection and notification engine are LIVE and healthy!\n⏰ Time: *${new Date().toLocaleTimeString()}*\n\n🛡️ *Status:* Connected & Listening\n📱 *Number:* +${cleanPhone}\n\n💬 All Anti-Delete DM recovery, View-Once decryption, and 35+ commands are actively functioning on your account.\n\n> ⚡ _SOLVATECH Multi-Device Engine_`
      );
      res.json({
        success: true,
        message: `Test notification sent successfully to your WhatsApp DM (+${cleanPhone})!`,
      });
    } catch (err: any) {
      console.error('Test DM error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to send notification to WhatsApp',
      });
    }
  });

  // Groups Management & Security Settings (Auto-Welcome & Auto-Goodbye UI Switches)
  app.get('/api/groups', async (req, res) => {
    try {
      const status = whatsappManager.getStatus();
      if (!status.isConnected) {
        return res.json({
          success: true,
          connected: false,
          message: 'Link account first to show your groups that you are in.',
          groups: [],
        });
      }
      const adminOnly = req.query.adminOnly === 'true' || req.query.adminOnly === '1';
      const groups = await whatsappManager.getGroupsWithSettings(adminOnly);
      res.json({ success: true, connected: true, groups });
    } catch (err: any) {
      console.error('Error fetching groups:', err);
      res.status(500).json({ success: false, error: err.message, groups: [] });
    }
  });

  app.post('/api/groups/sync', async (req, res) => {
    try {
      const status = whatsappManager.getStatus();
      if (!status.isConnected) {
        return res.json({
          success: true,
          connected: false,
          message: 'Link account first to show your groups that you are in.',
          groups: [],
        });
      }
      // STRICT USER REQUIREMENT: Only fetch groups where the account is an admin
      // Remove all non-admin groups so regular members cannot view or modify protection
      const groups = await whatsappManager.getGroupsWithSettings(true);
      res.json({ success: true, connected: true, groups });
    } catch (err: any) {
      console.error('Error syncing groups:', err);
      res.status(500).json({ success: false, error: err.message, groups: [] });
    }
  });

  app.get('/api/groups/:gid/picture', async (req, res) => {
    try {
      const { gid } = req.params;
      const pictureUrl = await whatsappManager.getGroupPictureUrl(gid);
      if (pictureUrl) {
        return res.json({ success: true, pictureUrl });
      }
      return res.status(404).json({ success: false, error: 'No group picture available' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/groups/settings', async (req, res) => {
    try {
      const { groupId, key, value } = req.body;
      if (!groupId || !key || typeof value !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'groupId, key (e.g. autowelcome, autogoodbye), and boolean value are required',
        });
      }

      // Security Check: Only group admins can change group protection
      const isGroupAdmin = await whatsappManager.isBotAdminInGroupById(groupId);
      if (!isGroupAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You are not an admin of this group. Only group admins can configure protection settings.',
        });
      }

      commandHandler.setSecuritySetting(groupId, key as any, value);
      const updatedSettings = commandHandler.getSecuritySettings(groupId);
      res.json({ success: true, groupId, settings: updatedSettings });
    } catch (err: any) {
      console.error('Error updating group security setting:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/groups/toggle-all', async (req, res) => {
    try {
      const { groupId, enableAll } = req.body;
      if (!groupId || typeof enableAll !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'groupId and boolean enableAll required',
        });
      }

      // Security Check: Only group admins can change group protection
      const isGroupAdmin = await whatsappManager.isBotAdminInGroupById(groupId);
      if (!isGroupAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You are not an admin of this group. Only group admins can configure protection settings.',
        });
      }

      const updated = commandHandler.toggleAllForGroup(groupId, enableAll);
      res.json({ success: true, groupId, settings: updated });
    } catch (err: any) {
      console.error('Error toggling all group settings:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/groups/warn-limit', async (req, res) => {
    try {
      const { groupId, limit } = req.body;
      if (!groupId || typeof limit !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'groupId and numeric limit required',
        });
      }

      // Security Check: Only group admins can change group protection
      const isGroupAdmin = await whatsappManager.isBotAdminInGroupById(groupId);
      if (!isGroupAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You are not an admin of this group. Only group admins can configure protection settings.',
        });
      }

      commandHandler.setWarnLimit(groupId, limit);
      res.json({ success: true, groupId, settings: commandHandler.getSecuritySettings(groupId) });
    } catch (err: any) {
      console.error('Error updating group warn limit:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/groups/sync', async (_req, res) => {
    try {
      await commandHandler.loadAllSecuritySettingsFromFirebase();
      const groups = await whatsappManager.getGroupsWithSettings(true);
      res.json({ success: true, groups, message: 'Synchronized with WhatsApp and Firebase (Admin Groups Only)' });
    } catch (err: any) {
      console.error('Error syncing groups:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // User Anti-Delete Recovery Setting
  app.get('/api/user/anti-delete', (_req, res) => {
    res.json({
      success: true,
      enabled: commandHandler.getAntiDeleteEnabled(),
    });
  });

  app.post('/api/user/anti-delete', (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Boolean "enabled" field required' });
      }
      commandHandler.setAntiDeleteEnabled(enabled);
      res.json({
        success: true,
        enabled: commandHandler.getAntiDeleteEnabled(),
        message: enabled
          ? 'Anti-delete recovery is ON. Deleted messages will be forwarded to your personal WhatsApp DM.'
          : 'Anti-delete recovery is OFF. Deleted messages will be ignored.',
      });
    } catch (err: any) {
      console.error('Error setting anti-delete:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 30-Minute Free Test Management Store (server-authoritative & persistent across restarts/devices)
  const trialStorePath = path.resolve(process.cwd(), '.trial_store.json');
  const getTrialStore = (): Record<string, { uid?: string; email?: string; hasUsedTrial: boolean; isReset: boolean; expiresAt: string | null; claimedAt?: string; resetAt?: string }> => {
    try {
      if (fs.existsSync(trialStorePath)) {
        const raw = fs.readFileSync(trialStorePath, 'utf-8');
        return JSON.parse(raw) || {};
      }
    } catch {}
    return {};
  };

  const saveTrialStore = (data: Record<string, any>) => {
    try {
      fs.writeFileSync(trialStorePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {}
  };

  // 1. Check Trial Status
  app.get('/api/trial/status', (req, res) => {
    try {
      const uid = (req.query.uid as string) || '';
      const email = ((req.query.email as string) || '').toLowerCase().trim();
      const store = getTrialStore();

      let userRecord = (uid && store[uid]) || (email && store[email]);
      if (!userRecord && email) {
        // Check case-insensitively
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
          remainingMs: 0,
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
        remainingMs,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Claim 30-Minute Trial
  app.post('/api/trial/claim', (req, res) => {
    try {
      const { uid, email } = req.body;
      if (!uid && !email) {
        return res.status(400).json({ success: false, message: 'User ID or Email is required.' });
      }

      const cleanEmail = (email || '').toLowerCase().trim();
      const cleanUid = uid || cleanEmail;
      const store = getTrialStore();

      const existing = store[cleanUid] || (cleanEmail && store[cleanEmail]);
      if (existing && existing.hasUsedTrial && !existing.isReset) {
        return res.status(400).json({
          success: false,
          message: 'The 30-minute test has already been used on this Google account. It can only be claimed once in a lifetime.',
        });
      }

      const now = Date.now();
      const newExpiryMs = now + 30 * 60 * 1000;
      const newExpiresAt = new Date(newExpiryMs).toISOString();

      const record = {
        uid: cleanUid,
        email: cleanEmail,
        hasUsedTrial: true,
        isReset: false,
        claimedAt: new Date(now).toISOString(),
        expiresAt: newExpiresAt,
      };

      store[cleanUid] = record;
      if (cleanEmail) store[cleanEmail] = record;
      saveTrialStore(store);

      return res.json({
        success: true,
        message: '🎉 30-minute test activated! Your countdown has begun.',
        expiresAt: newExpiresAt,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 3. Reset 30-Minute Trial (Admin action)
  app.post('/api/trial/reset', (req, res) => {
    try {
      const { uid, email } = req.body;
      if (!uid && !email) {
        return res.status(400).json({ success: false, message: 'User ID or Email is required.' });
      }

      const cleanEmail = (email || '').toLowerCase().trim();
      const cleanUid = uid || cleanEmail;
      const store = getTrialStore();

      const record = {
        uid: cleanUid,
        email: cleanEmail,
        hasUsedTrial: false,
        isReset: true,
        expiresAt: null,
        resetAt: new Date().toISOString(),
      };

      if (cleanUid) store[cleanUid] = record;
      if (cleanEmail) store[cleanEmail] = record;

      // Also reset any keys in store matching this email or uid
      for (const k of Object.keys(store)) {
        if (
          (cleanEmail && (store[k].email?.toLowerCase() === cleanEmail || k.toLowerCase() === cleanEmail)) ||
          (cleanUid && (store[k].uid === cleanUid || k === cleanUid))
        ) {
          store[k] = { ...record };
        }
      }

      saveTrialStore(store);

      return res.json({
        success: true,
        message: `30-minute test reset for ${cleanEmail || cleanUid}! They can tap and claim it again.`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4. Reset all trials (Admin action)
  app.post('/api/trial/reset-all', (_req, res) => {
    try {
      const store = getTrialStore();
      for (const k of Object.keys(store)) {
        store[k].hasUsedTrial = false;
        store[k].isReset = true;
        store[k].expiresAt = null;
        store[k].resetAt = new Date().toISOString();
      }
      saveTrialStore(store);
      return res.json({ success: true, message: 'All user 30-minute trials have been reset!' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Execute bot command directly via Simulator / Web UI
  app.post('/api/commands/execute', async (req, res) => {
    try {
      const { text, isOwner = true } = req.body;
      if (!text) {
        return res.status(400).json({ success: false, error: 'Command text is required' });
      }

      const cleanText = text.trim();
      const rawCmd = cleanText.startsWith('.') ? cleanText.slice(1) : cleanText;
      const parts = rawCmd.split(/\s+/);
      const command = parts[0]?.toLowerCase();
      const args = parts.slice(1);

      const status = whatsappManager.getStatus();
      const isSimulatedGroup =
        req.body.isGroup ??
        (req.body.groupJid ||
          ['link', 'groupinfo', 'anti', 'autowelcome', 'autogoodbye', 'antilink', 'antibot', 'antistatus', 'antispam', 'warn', 'warnlimit', 'warns'].includes(command));
      const groupJid = req.body.groupJid || req.body.groupId || (isSimulatedGroup ? '1203630248491823@g.us' : undefined);
      const result = await commandHandler.handle({
        command,
        args,
        fullText: cleanText,
        senderJid: '2349049979183@s.whatsapp.net',
        senderNumber: status.user?.phone?.replace(/\D/g, '') || '2349049979183',
        isGroup: Boolean(isSimulatedGroup),
        groupJid,
        pushName: 'Solvatech Tester',
        isOwner: isOwner ?? true,
        linkedSince: whatsappManager.getConnectedAt(),
        linkedPhone: status.user?.phone || null,
        licenseExpiresAt: req.body.licenseExpiresAt || null,
        licensePlan: req.body.licensePlan || null,
        quotedParticipant: req.body.quotedParticipant || undefined,
        mentionedJids: req.body.mentionedJids || [],
        getTopChatted: (phone: string) => whatsappManager.getTopChatted(phone),
      });

      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/whatsapp/logout', async (_req, res) => {
    try {
      await whatsappManager.logout();
      res.json({ success: true, message: 'Session logged out and cleared' });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to logout session',
      });
    }
  });

  app.post('/api/whatsapp/disconnect', async (_req, res) => {
    try {
      await whatsappManager.logout();
      res.json({ success: true, message: 'Bot disconnected successfully due to expired license or user request' });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to disconnect session',
      });
    }
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      bot: 'SOLVATECH',
      firebase: 'solvatechbot',
      timestamp: new Date().toISOString()
    });
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SOLVATECH] Server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
