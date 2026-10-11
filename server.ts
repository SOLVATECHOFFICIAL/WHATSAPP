import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { sessionManager, whatsappManager } from './src/server/whatsapp.ts';
import { commandHandler, SOLVATECH_MENU } from './src/server/commands.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json());

  // Helper: Retrieve isolated per-user WhatsApp session based on request credentials
  const getSessionForReq = (req: express.Request) => {
    const userId =
      (req.query.userId as string) ||
      (req.body?.userId as string) ||
      (req.headers['x-user-id'] as string) ||
      '';
    const userEmail =
      (req.query.userEmail as string) ||
      (req.body?.userEmail as string) ||
      (req.headers['x-user-email'] as string) ||
      '';
    return sessionManager.getSession(userId, userEmail);
  };

  // Serve solva.webp from root folder or public folder
  app.get('/solva.webp', (_req, res) => {
    const rootPath = path.resolve(__dirname, 'solva.webp');
    const pubPath = path.resolve(__dirname, 'public', 'solva.webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (fs.existsSync(rootPath)) {
      res.setHeader('Content-Type', 'image/webp');
      return res.sendFile(rootPath);
    }
    if (fs.existsSync(pubPath)) {
      res.setHeader('Content-Type', 'image/webp');
      return res.sendFile(pubPath);
    }
    res.status(404).send('Not found');
  });

  // Sync user license with 24/7 heartbeat watchdog
  app.post('/api/whatsapp/sync-license', (req, res) => {
    try {
      const { expiresAt, isUnlimited, userId, userEmail } = req.body;
      const session = getSessionForReq(req);
      session.setSessionLicense(expiresAt || null, Boolean(isUnlimited));

      const cleanUid = userId || (req.query.userId as string) || (req.headers['x-user-id'] as string) || session.userId;
      if (cleanUid) {
        const store = getTrialStore();
        if (store[cleanUid]) {
          store[cleanUid].expiresAt = expiresAt || null;
          saveTrialStore(store);
        }
      }
      res.json({ success: true, message: 'Session license synchronized with 24/7 heartbeat watchdog' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin live multi-user status sync
  app.get('/api/admin/users-status', (_req, res) => {
    try {
      const allSessions = sessionManager.getAllSessions();
      const statusMap: Record<string, any> = {};
      for (const [uid, session] of allSessions.entries()) {
        const status = session.getStatus();
        statusMap[uid] = {
          isConnected: Boolean(status.isConnected),
          state: status.state,
          phone: status.user?.phone || status.targetPhone || null,
          isExpired: session.isLicenseExpired(),
          expiresAt: (session as any).sessionLicenseExpiresAt || null,
          isUnlimited: Boolean((session as any).isSessionUnlimited),
        };
      }
      res.json({ success: true, statuses: statusMap });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Global 5-minute worldwide synchronization endpoints
  app.post('/api/whatsapp/sync-all', async (_req, res) => {
    try {
      const stats = await sessionManager.runGlobal5MinSync();
      res.json({ success: true, message: 'Worldwide 5-minute synchronization completed', stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/whatsapp/sync-all/status', (_req, res) => {
    res.json({
      success: true,
      stats: sessionManager.getSyncStats(),
      serverTime: new Date().toISOString(),
    });
  });

  // WhatsApp Baileys API endpoints (per-user session)
  app.get('/api/whatsapp/status', (req, res) => {
    const userId = (req.query.userId as string) || (req.headers['x-user-id'] as string) || '';
    if (!userId) {
      // Unauthenticated / clean slate: do NOT leak previous account's status
      return res.json({
        success: true,
        botName: 'SOLVATECH',
        firebaseProject: 'solvatechbot',
        status: {
          state: 'disconnected',
          isConnected: false,
          pairingStage: 'idle',
        },
      });
    }
    const session = getSessionForReq(req);
    res.json({
      success: true,
      botName: 'SOLVATECH',
      firebaseProject: 'solvatechbot',
      status: session.getStatus(),
    });
  });

  app.get('/api/whatsapp/notifications', (req, res) => {
    const userId = (req.query.userId as string) || (req.headers['x-user-id'] as string) || '';
    if (!userId) {
      return res.json({ success: true, notifications: [] });
    }
    const session = getSessionForReq(req);
    res.json({
      success: true,
      notifications: session.getNotifications(),
    });
  });

  app.delete('/api/whatsapp/notifications', (req, res) => {
    const session = getSessionForReq(req);
    session.clearNotifications();
    res.json({ success: true, message: 'Notifications cleared' });
  });

  app.post('/api/whatsapp/pair-code', async (req, res) => {
    try {
      const { phoneNumber, isExpired = false, isUnlimited = false, force = false } = req.body;
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

      const session = getSessionForReq(req);
      session.setSessionLicense(req.body.licenseExpiresAt || null, Boolean(isUnlimited));

      const pairingCode = await session.requestPairingCode(phoneNumber, Boolean(force));
      res.json({
        success: true,
        pairingCode,
        targetPhone: session.getStatus().targetPhone || req.body.phoneNumber,
        status: session.getStatus(),
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

      const session = getSessionForReq(req);
      await session.sendMessage(to, message);
      res.json({ success: true, message: 'Message sent successfully' });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to send WhatsApp message',
      });
    }
  });

  app.post('/api/whatsapp/test-dm', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const status = session.getStatus();
      if (!status.isConnected) {
        return res.status(400).json({
          success: false,
          error: 'WhatsApp is not currently connected for this account. Please pair your WhatsApp account first.',
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
      await session.sendMessage(
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

  // Groups Management & Security Settings (Auto-Welcome & Auto-Goodbye UI Switches per user session)
  app.get('/api/groups', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const status = session.getStatus();
      if (!status.isConnected) {
        return res.json({
          success: true,
          connected: false,
          message: 'Link account first to show your groups that you are in.',
          groups: [],
        });
      }
      const adminOnly = req.query.adminOnly === 'true' || req.query.adminOnly === '1';
      const groups = await session.getGroupsWithSettings(adminOnly);
      res.json({ success: true, connected: true, groups });
    } catch (err: any) {
      console.error('Error fetching groups:', err);
      res.status(500).json({ success: false, error: err.message, groups: [] });
    }
  });

  app.post('/api/groups/sync', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const status = session.getStatus();
      if (!status.isConnected) {
        return res.json({
          success: true,
          connected: false,
          message: 'Link account first to show your groups that you are in.',
          groups: [],
        });
      }
      // STRICT USER REQUIREMENT: Only fetch groups where the account is an admin
      const groups = await session.getGroupsWithSettings(true);
      res.json({ success: true, connected: true, groups });
    } catch (err: any) {
      console.error('Error syncing groups:', err);
      res.status(500).json({ success: false, error: err.message, groups: [] });
    }
  });

  app.get('/api/groups/:gid/picture', async (req, res) => {
    try {
      const session = getSessionForReq(req);
      const { gid } = req.params;
      const pictureUrl = await session.getGroupPictureUrl(gid);
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
      const session = getSessionForReq(req);
      const { groupId, key, value } = req.body;
      if (!groupId || !key || typeof value !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'groupId, key (e.g. autowelcome, autogoodbye), and boolean value are required',
        });
      }

      // Security Check: Only group admins can change group protection
      const isGroupAdmin = await session.isBotAdminInGroupById(groupId);
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
      const session = getSessionForReq(req);
      const { groupId, enableAll } = req.body;
      if (!groupId || typeof enableAll !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'groupId and boolean enableAll required',
        });
      }

      // Security Check: Only group admins can change group protection
      const isGroupAdmin = await session.isBotAdminInGroupById(groupId);
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
      const session = getSessionForReq(req);
      const { groupId, limit } = req.body;
      if (!groupId || typeof limit !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'groupId and numeric limit required',
        });
      }

      // Security Check: Only group admins can change group protection
      const isGroupAdmin = await session.isBotAdminInGroupById(groupId);
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

  // User Anti-Delete Recovery Setting (isolated per user session)
  app.get('/api/user/anti-delete', (req, res) => {
    const session = getSessionForReq(req);
    res.json({
      success: true,
      enabled: session.getAntiDeleteEnabled(),
    });
  });

  app.post('/api/user/anti-delete', (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Boolean "enabled" field required' });
      }
      const session = getSessionForReq(req);
      session.setAntiDeleteEnabled(enabled);
      res.json({
        success: true,
        enabled: session.getAntiDeleteEnabled(),
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
  const getTrialStore = (): Record<string, { uid?: string; email?: string; hasUsedTrial: boolean; isReset?: boolean; lifetimeLocked?: boolean; expiresAt: string | null; claimedAt?: string; resetAt?: string }> => {
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
        hasUsedTrial: Boolean(userRecord.hasUsedTrial),
        isActive,
        expiresAt: userRecord.expiresAt,
        remainingMs,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Claim 30-Minute Trial (Once in a lifetime permanent lock per user/email)
  app.post('/api/trial/claim', (req, res) => {
    try {
      const { uid, email, currentExpiresAt } = req.body;
      if (!uid && !email) {
        return res.status(400).json({ success: false, message: 'User ID or Email is required.' });
      }

      const cleanEmail = (email || '').toLowerCase().trim();
      const cleanUid = uid || cleanEmail;
      const store = getTrialStore();

      const existing = store[cleanUid] || (cleanEmail && store[cleanEmail]);
      if (existing && existing.hasUsedTrial) {
        return res.status(400).json({
          success: false,
          message: 'The 30-minute test is strictly once in a lifetime per user. It is permanently linked to your email in Firebase and cannot be claimed again.',
        });
      }

      const now = Date.now();
      const existingExpiryMs = currentExpiresAt ? new Date(currentExpiresAt).getTime() : 0;
      const baseTime = existingExpiryMs > now ? existingExpiryMs : now;
      const newExpiryMs = baseTime + 30 * 60 * 1000;
      const newExpiresAt = new Date(newExpiryMs).toISOString();

      const record = {
        uid: cleanUid,
        email: cleanEmail,
        hasUsedTrial: true,
        lifetimeLocked: true,
        claimedAt: new Date(now).toISOString(),
        expiresAt: newExpiresAt,
      };

      store[cleanUid] = record;
      if (cleanEmail) store[cleanEmail] = record;
      saveTrialStore(store);

      // Immediately synchronize WhatsApp session with the new 30-minute expiry
      try {
        const session = sessionManager.getSession(cleanUid, cleanEmail);
        session.setSessionLicense(newExpiresAt, false);
      } catch {}

      return res.json({
        success: true,
        message: '🎉 30-minute test activated! Your countdown has begun.',
        expiresAt: newExpiresAt,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 3. Reset 30-Minute Trial (DISABLED: Once in a lifetime forever)
  app.post('/api/trial/reset', (_req, res) => {
    return res.status(403).json({
      success: false,
      message: 'The 30-minute trial is permanent and once in a lifetime per user email in Firebase. Admin cannot reset or return 30-minute trials.',
    });
  });

  // 4. Reset all trials (DISABLED: Once in a lifetime forever)
  app.post('/api/trial/reset-all', (_req, res) => {
    return res.status(403).json({
      success: false,
      message: 'The 30-minute trial is permanent and once in a lifetime per user email in Firebase. Admin cannot reset or return 30-minute trials.',
    });
  });

  // Execute bot command directly via Simulator / Web UI
  app.post('/api/commands/execute', async (req, res) => {
    try {
      const { text, isOwner = true } = req.body;
      if (!text) {
        return res.status(400).json({ success: false, error: 'Command text is required' });
      }

      const session = getSessionForReq(req);
      if (session.isLicenseExpired() && !isOwner) {
        return res.status(403).json({
          success: false,
          error: 'License expired! Your license duration has elapsed. Please renew your license key on the website to execute commands.',
        });
      }

      const cleanText = text.trim();
      const rawCmd = cleanText.startsWith('.') ? cleanText.slice(1) : cleanText;
      const parts = rawCmd.split(/\s+/);
      const command = parts[0]?.toLowerCase();
      const args = parts.slice(1);

      const status = session.getStatus();
      const isSimulatedGroup =
        req.body.isGroup ??
        (req.body.groupJid ||
          ['link', 'groupinfo', 'anti', 'autowelcome', 'autogoodbye', 'antilink', 'antibot', 'antistatus', 'antispam', 'warn', 'warnlimit', 'warns'].includes(command));
      const groupJid = req.body.groupJid || req.body.groupId || (isSimulatedGroup ? '1203630248491823@g.us' : undefined);
      const result = await commandHandler.handle({
        command,
        args,
        fullText: cleanText,
        senderJid: status.user?.phone ? `${status.user.phone.replace(/\D/g, '')}@s.whatsapp.net` : '2349049979183@s.whatsapp.net',
        senderNumber: status.user?.phone?.replace(/\D/g, '') || '2349049979183',
        isGroup: Boolean(isSimulatedGroup),
        groupJid,
        pushName: status.user?.name || 'Solvatech User',
        isOwner: isOwner ?? true,
        linkedSince: session.getConnectedAt(),
        linkedPhone: status.user?.phone || null,
        licenseExpiresAt: req.body.licenseExpiresAt || null,
        licensePlan: req.body.licensePlan || null,
        quotedParticipant: req.body.quotedParticipant || undefined,
        mentionedJids: req.body.mentionedJids || [],
        getTopChatted: (phone: string) => session.getTopChatted(phone),
      });

      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/whatsapp/logout', async (req, res) => {
    try {
      const userId = (req.body?.userId as string) || (req.query?.userId as string) || (req.headers['x-user-id'] as string) || '';
      await sessionManager.logoutSession(userId);
      res.json({ success: true, message: 'Session logged out and cleared for this user account' });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to logout session',
      });
    }
  });

  app.post('/api/whatsapp/disconnect', async (req, res) => {
    try {
      const userId = (req.body?.userId as string) || (req.query?.userId as string) || (req.headers['x-user-id'] as string) || '';
      await sessionManager.logoutSession(userId);
      res.json({ success: true, message: 'Bot disconnected successfully for this user account' });
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
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    const indexHtmlPath = path.resolve(distPath, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(indexHtmlPath);
      });
    } else {
      console.warn('[SOLVATECH] dist/index.html not found, falling back to Vite middleware');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          allowedHosts: true,
          ws: { server },
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SOLVATECH] Server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
