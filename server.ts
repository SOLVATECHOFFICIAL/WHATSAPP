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
      const { phoneNumber } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: 'Phone number is required',
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

      const result = await commandHandler.handle({
        command,
        args,
        fullText: cleanText,
        senderJid: 'web-simulator@s.whatsapp.net',
        senderNumber: '2348000000000',
        isGroup: false,
        pushName: 'Solvatech Tester',
        isOwner: isOwner ?? true,
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
      server: { middlewareMode: true },
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
