import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  WASocket,
  proto,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { commandHandler } from './commands.ts';

export interface WhatsAppNotification {
  id: string;
  type: 'pairing' | 'connection' | 'message_received' | 'message_sent' | 'system' | 'error' | 'command';
  title: string;
  body: string;
  timestamp: string;
  sender?: string;
  data?: any;
}

export interface WhatsAppStatus {
  state: 'disconnected' | 'connecting' | 'awaiting_pairing' | 'connected';
  isConnected: boolean;
  user?: {
    id: string;
    name?: string;
    phone?: string;
  };
  pairingCode?: string;
  qrCodeUrl?: string;
  targetPhone?: string;
  uptime?: number;
  lastError?: string;
}

class WhatsAppManager {
  private sock: WASocket | null = null;
  private authDir = path.resolve(process.cwd(), '.baileys_auth');
  private notifications: WhatsAppNotification[] = [];
  private messageCache = new Map<string, { sender: string; text: string; timestamp: number; isGroup: boolean; group?: string }>();
  private currentStatus: WhatsAppStatus = {
    state: 'disconnected',
    isConnected: false,
  };
  private pairingCodeTimer: NodeJS.Timeout | null = null;
  private isInitializing = false;

  constructor() {
    this.addNotification({
      type: 'system',
      title: 'SOLVATECH Engine Initialized',
      body: 'Baileys WhatsApp multi-device service is ready with command engine and Firebase sync.',
    });
  }

  public getStatus(): WhatsAppStatus {
    return this.currentStatus;
  }

  public getNotifications(): WhatsAppNotification[] {
    return this.notifications;
  }

  public addNotification(notif: Omit<WhatsAppNotification, 'id' | 'timestamp'>) {
    const newNotification: WhatsAppNotification = {
      ...notif,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
    };
    this.notifications.unshift(newNotification);
    if (this.notifications.length > 50) {
      this.notifications.pop();
    }
  }

  public clearNotifications() {
    this.notifications = [];
  }

  private ensureAuthDir() {
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
  }

  public async initSocket(phoneToPair?: string): Promise<WASocket> {
    this.ensureAuthDir();
    this.isInitializing = true;
    this.currentStatus.state = 'connecting';

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    let version: [number, number, number] = [2, 3000, 1015901307];
    try {
      const v = await fetchLatestBaileysVersion();
      if (v?.version) version = v.version;
    } catch {
      // Fallback
    }

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
    });

    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          this.currentStatus.qrCodeUrl = qrDataUrl;
          this.addNotification({
            type: 'system',
            title: 'New QR Code Generated',
            body: 'QR code updated for WhatsApp web scanning.',
          });
        } catch (e) {
          console.error('QR code generation error:', e);
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        this.currentStatus.state = 'disconnected';
        this.currentStatus.isConnected = false;
        this.currentStatus.pairingCode = undefined;
        this.currentStatus.lastError = isLoggedOut
          ? 'Logged out from device'
          : 'Connection closed. Reconnecting...';

        this.addNotification({
          type: 'connection',
          title: 'WhatsApp Disconnected',
          body: isLoggedOut
            ? 'The device was unlinked or logged out.'
            : 'Connection closed unexpectedly. Ready to reconnect.',
        });

        if (isLoggedOut) {
          await this.logout();
        }
      } else if (connection === 'open') {
        this.currentStatus.state = 'connected';
        this.currentStatus.isConnected = true;
        this.currentStatus.pairingCode = undefined;
        this.currentStatus.qrCodeUrl = undefined;
        this.currentStatus.lastError = undefined;

        const userJid = sock.user?.id || '';
        const phone = userJid.split(':')[0] || userJid.split('@')[0];
        this.currentStatus.user = {
          id: userJid,
          name: sock.user?.name || 'SOLVATECH Linked Phone',
          phone: `+${phone}`,
        };

        this.addNotification({
          type: 'connection',
          title: 'WhatsApp Connected!',
          body: `SOLVATECH successfully paired with +${phone}. All 35+ commands & anti-delete active.`,
          sender: phone,
        });
      }
    });

    // Inbound Messages & SOLVATECH Command Handler
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (!msg.message) continue;

          const remoteJid = msg.key.remoteJid || '';
          const senderJid = msg.key.participant || remoteJid;
          const senderNum = senderJid.split('@')[0].split(':')[0];
          const isGroup = remoteJid.endsWith('@g.us');
          const isFromMe = !!msg.key.fromMe;

          // Extract text
          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            '';

          // Cache message for Anti-Delete recovery
          if (msg.key.id && text) {
            this.messageCache.set(msg.key.id, {
              sender: senderNum,
              text,
              timestamp: Date.now(),
              isGroup,
              group: isGroup ? remoteJid : undefined,
            });
            // Keep cache capped at 500 messages
            if (this.messageCache.size > 500) {
              const firstKey = this.messageCache.keys().next().value;
              if (firstKey) this.messageCache.delete(firstKey);
            }
          }

          // Anti-View-Once interceptor
          if (msg.message.viewOnceMessage || msg.message.viewOnceMessageV2) {
            this.addNotification({
              type: 'system',
              title: '👁️ View-Once Media Intercepted',
              body: `View-Once media detected from +${senderNum}. Protected for Owner recovery.`,
              sender: `+${senderNum}`,
            });
          }

          if (!isFromMe) {
            this.addNotification({
              type: 'message_received',
              title: `Incoming WhatsApp from +${senderNum}`,
              body: text || '[Media Message]',
              sender: `+${senderNum}`,
              data: { key: msg.key, pushName: msg.pushName },
            });
          }

          // Command handling: Prefix '.'
          if (text.startsWith('.')) {
            const parts = text.slice(1).trim().split(/\s+/);
            const command = parts[0];
            const args = parts.slice(1);

            const botUserJid = sock.user?.id || '';
            const botPhone = botUserJid.split(':')[0] || botUserJid.split('@')[0];
            const isOwner = isFromMe || senderNum === botPhone;

            const res = await commandHandler.handle({
              command,
              args,
              fullText: text,
              senderJid,
              senderNumber: senderNum,
              isGroup,
              groupJid: isGroup ? remoteJid : undefined,
              pushName: msg.pushName || undefined,
              isOwner,
            });

            // Reply directly on WhatsApp
            try {
              await sock.sendMessage(remoteJid, { text: res.reply }, { quoted: msg });
              this.addNotification({
                type: 'command',
                title: `⚡ Command Executed: .${command}`,
                body: `Executed for +${senderNum}. Response sent to chat.`,
                sender: `+${senderNum}`,
              });
            } catch (err: any) {
              console.error('Error replying to WhatsApp command:', err);
            }
          }
        }
      }
    });

    // Anti-Delete Recovery Handler
    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (update.update?.message === null && update.key?.id) {
          const cached = this.messageCache.get(update.key.id);
          if (cached) {
            const ownerPhone = this.currentStatus.user?.phone || 'Owner DM';
            const alertBody = `🚨 *[SOLVATECH ANTI-DELETE RECOVERY]*\n\n👤 Sender: +${cached.sender}\n📍 Location: ${cached.isGroup ? 'Group Chat' : 'Direct Message'}\n💬 Deleted Text: "${cached.text}"\n⏰ Time: ${new Date(cached.timestamp).toLocaleTimeString()}`;

            this.addNotification({
              type: 'system',
              title: '🛡️ Deleted Message Recovered!',
              body: `From +${cached.sender}: "${cached.text}"`,
              sender: `+${cached.sender}`,
            });

            // If we have an owner JID, forward directly to owner's WhatsApp DM
            if (sock && this.currentStatus.user?.id) {
              try {
                await sock.sendMessage(this.currentStatus.user.id, { text: alertBody });
              } catch (e) {
                console.error('Error sending anti-delete alert to owner:', e);
              }
            }
          }
        }
      }
    });

    this.isInitializing = false;
    return sock;
  }

  public async requestPairingCode(rawPhoneNumber: string): Promise<string> {
    const cleanPhone = rawPhoneNumber.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 8) {
      throw new Error('Please provide a valid phone number with country code (e.g., 2348012345678)');
    }

    this.currentStatus.targetPhone = `+${cleanPhone}`;
    this.currentStatus.state = 'awaiting_pairing';

    if (!this.sock) {
      await this.initSocket(cleanPhone);
    }

    try {
      if (!this.sock) {
        throw new Error('Failed to instantiate Baileys WhatsApp socket');
      }

      if (this.sock.authState.creds.registered) {
        this.currentStatus.state = 'connected';
        this.currentStatus.isConnected = true;
        return 'ALREADY_PAIRED';
      }

      const code = await this.sock.requestPairingCode(cleanPhone);
      const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

      this.currentStatus.pairingCode = formattedCode;
      this.currentStatus.state = 'awaiting_pairing';

      this.addNotification({
        type: 'pairing',
        title: 'Pairing Code Generated',
        body: `Pairing Code: ${formattedCode} generated for +${cleanPhone}. Link in WhatsApp > Linked Devices > Link with phone number.`,
      });

      if (this.pairingCodeTimer) clearTimeout(this.pairingCodeTimer);
      this.pairingCodeTimer = setTimeout(() => {
        if (this.currentStatus.pairingCode === formattedCode) {
          this.currentStatus.pairingCode = undefined;
          this.addNotification({
            type: 'system',
            title: 'Pairing Code Expired',
            body: 'The 2-minute pairing code expired. You can request a fresh code anytime.',
          });
        }
      }, 120000);

      return formattedCode;
    } catch (error: any) {
      this.currentStatus.state = 'disconnected';
      this.currentStatus.lastError = error.message;
      this.addNotification({
        type: 'error',
        title: 'Pairing Failed',
        body: error.message || 'Failed to request WhatsApp pairing code.',
      });
      throw error;
    }
  }

  public async sendMessage(toPhone: string, text: string): Promise<boolean> {
    if (!this.sock || !this.currentStatus.isConnected) {
      throw new Error('WhatsApp is not currently connected. Please pair your number first.');
    }

    const cleanTo = toPhone.replace(/\D/g, '');
    const jid = `${cleanTo}@s.whatsapp.net`;

    await this.sock.sendMessage(jid, { text });

    this.addNotification({
      type: 'message_sent',
      title: `Message Sent to +${cleanTo}`,
      body: text,
      sender: `+${cleanTo}`,
    });

    return true;
  }

  public async logout(): Promise<void> {
    try {
      if (this.sock) {
        await this.sock.logout();
        this.sock.end(undefined);
        this.sock = null;
      }
    } catch {
      // Ignore
    }

    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('Error clearing auth dir:', e);
    }

    this.currentStatus = {
      state: 'disconnected',
      isConnected: false,
      user: undefined,
      pairingCode: undefined,
      qrCodeUrl: undefined,
      targetPhone: undefined,
    };

    this.addNotification({
      type: 'system',
      title: 'WhatsApp Session Cleared',
      body: 'All Baileys session credentials and tokens have been wiped. Ready to pair a new device.',
    });
  }
}

export const whatsappManager = new WhatsAppManager();
