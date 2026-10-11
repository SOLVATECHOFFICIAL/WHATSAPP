import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { whatsappManager } from './src/server/whatsapp.ts';
import { commandHandler, SOLVATECH_MENU } from './src/server/commands.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
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
        targetPhone: req.body.phoneNumber,
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
      const adminOnly = req.query.adminOnly === 'true' || req.query.adminOnly === '1';
      const groups = await whatsappManager.getGroupsWithSettings(adminOnly);
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

  app.post('/api/groups/settings', (req, res) => {
    try {
      const { groupId, key, value } = req.body;
      if (!groupId || !key || typeof value !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'groupId, key (e.g. autowelcome, autogoodbye), and boolean value are required',
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

  app.post('/api/groups/toggle-all', (req, res) => {
    try {
      const { groupId, enableAll } = req.body;
      if (!groupId || typeof enableAll !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'groupId and boolean enableAll required',
        });
      }
      const updated = commandHandler.toggleAllForGroup(groupId, enableAll);
      res.json({ success: true, groupId, settings: updated });
    } catch (err: any) {
      console.error('Error toggling all group settings:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/groups/warn-limit', (req, res) => {
    try {
      const { groupId, limit } = req.body;
      if (!groupId || typeof limit !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'groupId and numeric limit required',
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
      const groups = await whatsappManager.getGroupsWithSettings();
      res.json({ success: true, groups, message: 'Synchronized with WhatsApp and Firebase' });
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
      const command = parts[0];
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
