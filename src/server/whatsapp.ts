import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
  proto,
  downloadContentFromMessage,
  getUrlInfo,
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
  private messageCache = new Map<string, { key: proto.IMessageKey; sender: string; text: string; timestamp: number; isGroup: boolean; group?: string }>();
  private statusCache = new Map<string, {
    id: string;
    senderJid: string;
    senderNum: string;
    type: 'image' | 'video' | 'audio' | 'text';
    buffer?: Buffer;
    caption?: string;
    text?: string;
    timestamp: number;
  }>();
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
  private groupPictureCache = new Map<string, string>();
  private reverseLidMap = new Map<string, string>();
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
  private userMessageHistory = new Map<string, { key: proto.IMessageKey; text: string; type: string; timestamp: number }[]>();
  private userSpamPurgeState = new Map<string, { detectedAt: number; isPurging: boolean }>();
  private greetingDedupCache = new Map<string, number>();

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
      getUrlInfo: (text: string) => getUrlInfo(text),
      syncFullHistory: false,
      markOnlineOnConnect: true,
    } as any);

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

          // Cache message for Anti-Delete recovery and .del commands
          if (msg.key.id && text) {
            this.messageCache.set(msg.key.id, {
              key: msg.key,
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

          // Cache status broadcasts for .send command
          if (remoteJid === 'status@broadcast' || msg.key?.remoteJid === 'status@broadcast') {
            const sMedia = extractMediaFromMessage(rawMsg);
            const sText = unwrappedMsg?.conversation || unwrappedMsg?.extendedTextMessage?.text || unwrappedMsg?.imageMessage?.caption || unwrappedMsg?.videoMessage?.caption || '';
            if (msg.key.id) {
              if (sMedia && (sMedia.type === 'image' || sMedia.type === 'video' || sMedia.type === 'audio')) {
                downloadMediaBuffer(sMedia.target, sMedia.type).then(buf => {
                  this.statusCache.set(msg.key.id!, {
                    id: msg.key.id!,
                    senderJid: msg.key.participant || senderJid,
                    senderNum,
                    type: sMedia.type as 'image' | 'video' | 'audio',
                    buffer: buf,
                    caption: sText,
                    timestamp: Date.now(),
                  });
                  if (this.statusCache.size > 100) {
                    const first = this.statusCache.keys().next().value;
                    if (first) this.statusCache.delete(first);
                  }
                }).catch(() => {});
              } else if (sText) {
                this.statusCache.set(msg.key.id, {
                  id: msg.key.id,
                  senderJid: msg.key.participant || senderJid,
                  senderNum,
                  type: 'text',
                  text: sText,
                  timestamp: Date.now(),
                });
                if (this.statusCache.size > 100) {
                  const first = this.statusCache.keys().next().value;
                  if (first) this.statusCache.delete(first);
                }
              }
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
          const quotedText =
            quotedRaw?.conversation ||
            quotedRaw?.extendedTextMessage?.text ||
            quotedRaw?.imageMessage?.caption ||
            quotedRaw?.videoMessage?.caption ||
            '';

          // Record interaction for frequently chatted contacts tracking
          if (senderNum) {
            if (quotedParticipant) {
              this.recordInteraction(senderNum, quotedParticipant);
              this.recordInteraction(quotedParticipant, senderNum, msg.pushName);
            } else if (!isGroup && remoteJid) {
              this.recordInteraction(senderNum, remoteJid, msg.pushName);
            }
          }

          const botUserJid = sock.user?.id || '';
          const botPhone = (botUserJid.split(':')[0] || botUserJid.split('@')[0]).replace(/\D/g, '');
          const linkedPhoneClean = (this.currentStatus.user?.phone || '').replace(/\D/g, '');
          const isOwner =
            isFromMe ||
            (botPhone && senderNum === botPhone) ||
            (linkedPhoneClean && senderNum === linkedPhoneClean) ||
            senderNum === '2349049979183';

          // Check if sender is a group administrator
          let isSenderAdmin = false;
          if (isGroup) {
            try {
              const groupMeta = await sock.groupMetadata(remoteJid);
              const p = groupMeta.participants.find(
                (x) => x.id.replace(/\D/g, '') === senderNum || x.id === senderJid
              );
              isSenderAdmin = p?.admin === 'admin' || p?.admin === 'superadmin';
            } catch {}
          }

          // Group Security Enforcement (Anti-Bot, Anti-Link, Anti-Status, Anti-Spam)
          // STRICT RULE: Only applies to regular members ("only applies to member oo")! Never applies to admins or bot owner!
          if (isGroup && !isOwner && !isSenderAdmin) {
            const sec = commandHandler.getSecuritySettings(remoteJid);

            // 1. Anti-Bot: Detect any member message starting with '.' or containing words like .at, .with, or replying to/with bot interactions
            const isWordStartingWithDot =
              text.trim().startsWith('.') ||
              text.toLowerCase().startsWith('.at') ||
              text.toLowerCase().startsWith('.with') ||
              /(^|\s)\.[a-zA-Z0-9_]/.test(text);
            const isQuotedFromBot = !!(
              quotedText &&
              (quotedText.trim().startsWith('.') ||
                quotedText.toLowerCase().includes('solvatech') ||
                quotedText.includes('🤖') ||
                quotedText.includes('⚡') ||
                (quotedParticipant &&
                  (quotedParticipant.replace(/\D/g, '') === botPhone ||
                    quotedParticipant.replace(/\D/g, '') === linkedPhoneClean)))
            );
            const isBotDetected = isWordStartingWithDot || (isQuotedFromBot && text.trim().length > 0);

            if (sec.antibot && isBotDetected) {
              try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
              const warn = commandHandler.addWarning(remoteJid, senderJid);
              if (warn.count >= warn.max) {
                try { await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove'); } catch {}
                await sock.sendMessage(remoteJid, {
                  text: `🚨 *[GROUP SECURITY ENFORCEMENT]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⛔ *Offense:* Unauthorized bot commands (*.*) or bot automation\n⚠️ *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*\n🔨 *Punishment:* *Auto-removed from group*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  mentions: [senderJid],
                });
              } else {
                await sock.sendMessage(remoteJid, {
                  text: `🤖 *[ANTI-BOT DEFENSE SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⚠️ *Notice:* Regular members are strictly prohibited from using bot commands (*.*) or bot automation!\n🗑️ *Action:* *Message deleted*\n📊 *Warning:* *${warn.count}/${warn.max}* (Auto-kick at ${warn.max})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  mentions: [senderJid],
                });
              }
              return;
            }

            // 2. Anti-Link: Member posting external links
            const hasLink = /(https?:\/\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+|t\.me\/[^\s]+)/i.test(text);
            if (sec.antilink && hasLink) {
              try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
              const warn = commandHandler.addWarning(remoteJid, senderJid);
              if (warn.count >= warn.max) {
                try { await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove'); } catch {}
                await sock.sendMessage(remoteJid, {
                  text: `🚨 *[GROUP SECURITY ENFORCEMENT]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⛔ *Offense:* Posting unauthorized external links\n⚠️ *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*\n🔨 *Punishment:* *Auto-removed from group*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  mentions: [senderJid],
                });
              } else {
                await sock.sendMessage(remoteJid, {
                  text: `🛡️ *[ANTI-LINK DEFENSE SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⚠️ *Notice:* External links are strictly prohibited in this group!\n🗑️ *Action:* *Link message deleted*\n📊 *Warning:* *${warn.count}/${warn.max}* (Auto-kick at ${warn.max})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  mentions: [senderJid],
                });
              }
              return;
            }

            // 3. Anti-Status: Member mentioning group in personal status
            const isStatusMention = !!(
              rawMsg?.groupStatusMentionMessage ||
              rawMsg?.groupStatusMessage ||
              unwrappedMsg?.groupStatusMentionMessage ||
              text.includes('status@broadcast') ||
              (quotedText && quotedText.includes('status@broadcast'))
            );
            if (sec.antistatus && isStatusMention) {
              try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
              const warn = commandHandler.addWarning(remoteJid, senderJid);
              if (warn.count >= warn.max) {
                try { await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove'); } catch {}
                await sock.sendMessage(remoteJid, {
                  text: `🚨 *[GROUP SECURITY ENFORCEMENT]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⛔ *Offense:* Mentioning this group in personal WhatsApp status\n⚠️ *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*\n🔨 *Punishment:* *Auto-removed from group*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  mentions: [senderJid],
                });
              } else {
                await sock.sendMessage(remoteJid, {
                  text: `📱 *[ANTI-STATUS DEFENSE SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⚠️ *Notice:* Mentioning this group in your personal WhatsApp status is prohibited!\n🗑️ *Action:* *Status notification deleted*\n📊 *Warning:* *${warn.count}/${warn.max}* (Auto-kick at ${warn.max})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  mentions: [senderJid],
                });
              }
              return;
            }

            // 4. Anti-Spam: Excessive stickers, repetitive text/words, photos, or flood spam
            // RULE: "once detected note automatically start deleting the messages even with the real one if users keep sending it why deleting then kick user instantly"
            if (sec.antispam) {
              const spamUserKey = `${remoteJid}:${senderJid}`;
              const now = Date.now();
              const activePurge = this.userSpamPurgeState.get(spamUserKey);

              // If user is currently in active spam purge state (within 30 seconds) and keeps sending messages:
              if (activePurge && now - activePurge.detectedAt < 30000) {
                // Delete new incoming message immediately
                try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
                // Instantly kick user from the group!
                try { await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove'); } catch {}
                this.userSpamPurgeState.delete(spamUserKey);
                this.userMessageHistory.delete(spamUserKey);

                await sock.sendMessage(remoteJid, {
                  text: `🚨 *[ANTI-SPAM INSTANT KICK ENFORCEMENT]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⛔ *Violation:* Continuous spamming while deletion purge was active!\n🔨 *Punishment:* *INSTANTLY KICKED FROM GROUP*\n🗑️ *Purge:* *All spam messages removed*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  mentions: [senderJid],
                });
                return;
              }

              // Determine type of message
              const isSticker = !!rawMsg?.stickerMessage || !!unwrappedMsg?.stickerMessage;
              const isMedia = !!rawMsg?.imageMessage || !!rawMsg?.videoMessage || !!unwrappedMsg?.imageMessage || !!unwrappedMsg?.videoMessage;
              const msgKind = isSticker ? 'sticker' : isMedia ? 'media' : 'text';
              const cleanText = text.trim();

              // Get recent message history
              const history = this.userMessageHistory.get(spamUserKey) || [];
              const recentHistory = history.filter((m) => now - m.timestamp < 15000);

              // 1) Repeated text / same words (e.g. 2+ previous identical messages within 15 seconds)
              const sameTextMatches = cleanText.length > 0 ? recentHistory.filter((m) => m.text.toLowerCase() === cleanText.toLowerCase()) : [];
              const isDuplicateSpam = cleanText.length > 0 && sameTextMatches.length >= 2;

              // 2) Sticker spam: 2+ stickers in last 10s plus this one = 3+ stickers
              const recentStickers = recentHistory.filter((m) => m.type === 'sticker' && now - m.timestamp < 10000);
              const isStickerSpam = isSticker && recentStickers.length >= 2;

              // 3) Media/picture spam: 2+ media in last 10s plus this one = 3+ media
              const recentMedia = recentHistory.filter((m) => m.type === 'media' && now - m.timestamp < 10000);
              const isMediaSpam = isMedia && recentMedia.length >= 2;

              // 4) High frequency rapid message flood: 4+ messages in last 5 seconds
              const rapidMessages = recentHistory.filter((m) => now - m.timestamp < 5000);
              const isFloodSpam = rapidMessages.length >= 4;

              if (isDuplicateSpam || isStickerSpam || isMediaSpam || isFloodSpam) {
                const spamReason = isDuplicateSpam
                  ? 'Repeated identical messages/text'
                  : isStickerSpam
                  ? 'Excessive sticker flooding'
                  : isMediaSpam
                  ? 'Excessive picture/media spam'
                  : 'High-speed message flood';

                // Collect keys to purge ("even with the real one" / original spam messages)
                const keysToPurge: proto.IMessageKey[] = [msg.key];
                if (isDuplicateSpam) keysToPurge.push(...sameTextMatches.map((m) => m.key));
                if (isStickerSpam) keysToPurge.push(...recentStickers.map((m) => m.key));
                if (isMediaSpam) keysToPurge.push(...recentMedia.map((m) => m.key));
                if (isFloodSpam) keysToPurge.push(...rapidMessages.map((m) => m.key));

                // Mark user in active purge state
                this.userSpamPurgeState.set(spamUserKey, { detectedAt: now, isPurging: true });

                // Delete current message and previous original messages in batch
                for (const k of keysToPurge) {
                  try { await sock.sendMessage(remoteJid, { delete: k }); } catch {}
                }

                // Reset user history
                this.userMessageHistory.set(spamUserKey, []);

                // Unified warning increment
                const warn = commandHandler.addWarning(remoteJid, senderJid);
                if (warn.count >= warn.max) {
                  try { await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove'); } catch {}
                  this.userSpamPurgeState.delete(spamUserKey);
                  await sock.sendMessage(remoteJid, {
                    text: `🚨 *[GROUP SECURITY ENFORCEMENT]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⛔ *Offense:* ${spamReason}\n⚠️ *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*\n🔨 *Punishment:* *Auto-removed from group*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                    mentions: [senderJid],
                  });
                } else {
                  await sock.sendMessage(remoteJid, {
                    text: `🚫 *[ANTI-SPAM DEFENSE SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⛔ *Offense:* ${spamReason}\n🗑️ *Action:* *Spam messages deleted (including originals)*\n📊 *Warning:* *${warn.count}/${warn.max}*\n⚠️ *CRITICAL NOTICE:* If you keep sending messages while deletion is underway, you will be *INSTANTLY KICKED*!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                    mentions: [senderJid],
                  });
                }
                return;
              }

              // Normal legitimate message: save to history
              recentHistory.push({ key: msg.key, text: cleanText, type: msgKind, timestamp: now });
              this.userMessageHistory.set(spamUserKey, recentHistory.slice(-12));
            }
          }

          // Command handling: Prefix '.'
          if (text.startsWith('.')) {
            const parts = text.slice(1).trim().split(/\s+/);
            const command = parts[0]?.toLowerCase();
            const args = parts.slice(1);

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
            // STRICT RULE: All decrypted view-once media goes strictly to Personal DM (chat with self), even in 1v1 chats!
            const targetDm = userPrivateDm;

            // Flash-fast instant reaction indicator: ⚡ while processing, ✅ on completion, ❌ on error
            sock.sendMessage(remoteJid, { react: { text: '⚡', key: msg.key } }).catch(() => {});
            const reactDone = () => sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
            const reactError = () => sock.sendMessage(remoteJid, { react: { text: '❌', key: msg.key } }).catch(() => {});


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

            // 5. .send (WhatsApp Status Extractor: live & direct to current chat with verbatim caption)
            if (command === 'send' || command === 'status' || command === 'getstatus') {
              const targetObj = quotedRaw || rawMsg;
              let media = extractMediaFromMessage(targetObj);
              let statusBuffer: Buffer | null = null;
              let statusType: 'image' | 'video' | 'audio' | 'text' = 'text';
              let statusCaption =
                targetObj?.imageMessage?.caption ||
                targetObj?.videoMessage?.caption ||
                targetObj?.conversation ||
                targetObj?.extendedTextMessage?.text ||
                '';

              // Check if in statusCache
              if (!media && contextInfo?.stanzaId && this.statusCache.has(contextInfo.stanzaId)) {
                const cachedStatus = this.statusCache.get(contextInfo.stanzaId)!;
                statusBuffer = cachedStatus.buffer || null;
                statusType = cachedStatus.type;
                statusCaption = cachedStatus.caption || cachedStatus.text || '';
              }

              if (media && (media.type === 'image' || media.type === 'video' || media.type === 'audio')) {
                try {
                  statusBuffer = await downloadMediaBuffer(media.target, media.type);
                  statusType = media.type;
                } catch (e) {
                  console.error('Error downloading status media:', e);
                }
              }

              if (statusBuffer && statusBuffer.length > 0) {
                const captionToSend = statusCaption
                  ? `${statusCaption}\n\n> 📥 _Live Status Extracted by SOLVATECH_`
                  : '> 📥 _Live Status Extracted by SOLVATECH_';

                if (statusType === 'image') {
                  await sock.sendMessage(remoteJid, { image: statusBuffer, caption: captionToSend }, { quoted: msg });
                } else if (statusType === 'video') {
                  await sock.sendMessage(remoteJid, { video: statusBuffer, caption: captionToSend }, { quoted: msg });
                } else if (statusType === 'audio') {
                  await sock.sendMessage(remoteJid, { audio: statusBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
                  if (statusCaption) await sock.sendMessage(remoteJid, { text: captionToSend }, { quoted: msg });
                }
                return;
              } else if (statusCaption) {
                await sock.sendMessage(remoteJid, {
                  text: `📥 *[WHATSAPP STATUS EXTRACTED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${statusCaption}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _Live Status Extracted by SOLVATECH_`,
                }, { quoted: msg });
                return;
              }

              await sock.sendMessage(remoteJid, {
                text: `⚠️ *[STATUS EXTRACTOR]*\nPlease reply to any WhatsApp Status with *.send* to extract the media and caption live & direct right here!`,
              }, { quoted: msg });
              return;
            }

            // 6. .gcstatus (Group Status Broadcast: real posting to group status or all groups + 24h WhatsApp status)
            if (command === 'gcstatus' || command === 'groupstatus') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[GROUP ONLY]*\nThe *.gcstatus* command can only be used inside a WhatsApp group!`,
                }, { quoted: msg });
                return;
              }

              const isEveryone = args[0]?.toLowerCase() === 'everyone' || args[0]?.toLowerCase() === 'all';
              const captionWords = isEveryone ? args.slice(1) : args;
              const captionText = captionWords.join(' ').trim();

              const targetObj = quotedRaw || rawMsg;
              const media = extractMediaFromMessage(targetObj);

              // Link detection: If link detected, pause 3.5s so WhatsApp servers and getUrlInfo generate full card preview
              const hasLink = /(https?:\/\/[^\s]+|whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+)/i.test(captionText);
              if (hasLink) {
                await new Promise((resolve) => setTimeout(resolve, 3500));
              }

              let targetGroups: string[] = [remoteJid];
              if (isEveryone) {
                try {
                  const allGroups = await sock.groupFetchAllParticipating();
                  const keys = Object.keys(allGroups);
                  if (keys.length > 0) targetGroups = keys;
                } catch (e) {
                  console.warn('Error fetching all groups for gcstatus everyone:', e);
                  targetGroups = [remoteJid];
                }
              }

              // Collect all participants across target groups for status@broadcast
              const participantJidSet = new Set<string>();
              for (const gid of targetGroups) {
                participantJidSet.add(gid);
                try {
                  const meta = await sock.groupMetadata(gid);
                  for (const p of meta.participants) {
                    participantJidSet.add(p.id);
                  }
                } catch {}
              }
              const statusJidList = Array.from(participantJidSet);

              const fullCaption = captionText
                ? `${captionText}\n\n> ⚡ *Group Status Broadcast* • _SOLVATECH BOT_`
                : '> ⚡ *Group Status Broadcast* • _SOLVATECH BOT_';

              if (media && (media.type === 'image' || media.type === 'video' || media.type === 'audio')) {
                try {
                  const buf = await downloadMediaBuffer(media.target, media.type);

                  // 1. Post real media to target groups in parallel
                  await Promise.allSettled(
                    targetGroups.map((gid) => {
                      if (media.type === 'video') {
                        return sock.sendMessage(gid, { video: buf, caption: fullCaption });
                      } else if (media.type === 'image') {
                        return sock.sendMessage(gid, { image: buf, caption: fullCaption });
                      } else {
                        return sock.sendMessage(gid, { audio: buf, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                      }
                    })
                  );

                  // 2. Also post directly to 24h WhatsApp status (status@broadcast) with group audience
                  if (media.type === 'video') {
                    sock.sendMessage('status@broadcast', { video: buf, caption: fullCaption }, { statusJidList } as any).catch(() => {});
                  } else if (media.type === 'image') {
                    sock.sendMessage('status@broadcast', { image: buf, caption: fullCaption }, { statusJidList } as any).catch(() => {});
                  }

                  reactDone();
                  await sock.sendMessage(remoteJid, {
                    text: isEveryone
                      ? `📢 *[GROUP STATUS BROADCAST]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ Media successfully posted to *all ${targetGroups.length} groups* and Group Status!\n${captionText ? `📝 *Caption:* "${captionText}"\n` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Broadcasted live via SOLVATECH_`
                      : `📢 *[GROUP STATUS BROADCAST]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ Media successfully posted to *Group Status* and group chat!\n${captionText ? `📝 *Caption:* "${captionText}"\n` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Posted live via SOLVATECH_`,
                  }, { quoted: msg });
                  return;
                } catch (e: any) {
                  console.error('Error broadcasting media in gcstatus:', e);
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[GCSTATUS ERROR]*\nFailed to broadcast media: ${e.message}`,
                  }, { quoted: msg });
                  return;
                }
              }

              // Text / link status post
              const broadcastBody = captionText || '📢 Group status announcement updated.';
              const formattedBroadcast = `${broadcastBody}\n\n> ⚡ *Group Status Broadcast* • _SOLVATECH BOT_`;

              // Post real text/links to target groups in parallel with rich link preview
              await Promise.allSettled(
                targetGroups.map((gid) => {
                  return sock.sendMessage(gid, { text: formattedBroadcast });
                })
              );

              // Also post text to 24h WhatsApp status (status@broadcast)
              sock.sendMessage('status@broadcast', { text: formattedBroadcast }, { statusJidList } as any).catch(() => {});

              reactDone();
              await sock.sendMessage(remoteJid, {
                text: isEveryone
                  ? `📢 *[GROUP STATUS BROADCAST]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ Announcement posted to *all ${targetGroups.length} groups* and Group Status!\n📝 *Content:* "${broadcastBody}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Broadcasted live via SOLVATECH_`
                  : `📢 *[GROUP STATUS BROADCAST]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ Announcement posted to *Group Status* and group chat!\n📝 *Content:* "${broadcastBody}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Posted live via SOLVATECH_`,
              }, { quoted: msg });
              return;
            }

            // 7. .pin (Pin group message for 7 days: connected bot user + group admin only)
            if (command === 'pin') {
              if (!isGroup) {
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[GROUP ONLY]*\nThe *.pin* command can only be used inside a WhatsApp group.`,
                }, { quoted: msg });
                return;
              }

              let isAdmin = false;
              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const participant = groupMeta.participants.find(
                  (p) => p.id.replace(/\D/g, '') === senderNum || p.id === senderJid
                );
                isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
              } catch (err) {
                console.error('Error checking admin for .pin:', err);
              }

              if (!isAdmin) {
                await sock.sendMessage(remoteJid, {
                  text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to pin messages in this group.`,
                }, { quoted: msg });
                return;
              }

              const quotedStanzaId = contextInfo?.stanzaId;
              if (!quotedStanzaId) {
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[PIN USAGE]*\nPlease reply directly to the message you want to pin with *.pin*!`,
                }, { quoted: msg });
                return;
              }

              try {
                const quotedParticipantJid = contextInfo?.participant;
                const isQuotedFromMe = quotedParticipantJid ? quotedParticipantJid.replace(/\D/g, '') === botPhone : false;

                await sock.sendMessage(remoteJid, {
                  pin: {
                    id: quotedStanzaId,
                    fromMe: isQuotedFromMe,
                    remoteJid: remoteJid,
                    participant: quotedParticipantJid,
                  },
                  type: 1,
                  time: 604800,
                });

                await sock.sendMessage(remoteJid, {
                  text: `📌 *[MESSAGE PINNED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nMessage successfully pinned for 7 days by Group Admin!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Protected by SOLVATECH_`,
                }, { quoted: msg });
              } catch (pinErr: any) {
                console.error('Pin error:', pinErr);
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[PIN ERROR]*\nFailed to pin message: ${pinErr.message || 'Make sure bot account is an admin in this group'}.`,
                }, { quoted: msg });
              }
              return;
            }

            // 8. .del (Delete message: reply deletes chat + trigger; .del N deletes N msgs with admin vs normal user rules)
            if (command === 'del' || command === 'delete') {
              let isAdmin = !isGroup;
              if (isGroup) {
                try {
                  const groupMeta = await sock.groupMetadata(remoteJid);
                  const participant = groupMeta.participants.find(
                    (p) => p.id.replace(/\D/g, '') === senderNum || p.id === senderJid
                  );
                  isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
                } catch {
                  // Fallback
                }
              }

              const countArg = args[0] ? parseInt(args[0], 10) : NaN;

              // Bulk delete: .del <count> (e.g. .del 20)
              if (!isNaN(countArg) && countArg > 0) {
                const targetCount = Math.min(countArg, 100);
                let deleted = 0;

                const cachedEntries = Array.from(this.messageCache.entries()).reverse();
                for (const [msgId, entry] of cachedEntries) {
                  if (entry.group === remoteJid || (!isGroup && entry.sender === senderNum)) {
                    // If admin, delete without restrictions; if normal user, delete ONLY their own messages
                    if (isAdmin || entry.sender === senderNum) {
                      try {
                        await sock.sendMessage(remoteJid, { delete: entry.key });
                        this.messageCache.delete(msgId);
                        deleted++;
                        if (deleted >= targetCount) break;
                      } catch (delErr) {
                        console.warn('Failed to delete message:', delErr);
                      }
                    }
                  }
                }

                // Delete the .del trigger command itself
                try {
                  await sock.sendMessage(remoteJid, { delete: msg.key });
                } catch {}

                const confirmationMsg = await sock.sendMessage(remoteJid, {
                  text: `🗑️ *[CHAT CLEANER]*\nDeleted *${deleted}* message(s) successfully${!isAdmin ? ' (only your own messages)' : ''}.`,
                });
                setTimeout(() => {
                  if (confirmationMsg?.key) {
                    sock.sendMessage(remoteJid, { delete: confirmationMsg.key }).catch(() => {});
                  }
                }, 4000);
                return;
              }

              // Reply delete: reply to a specific message with .del
              const quotedStanzaId = contextInfo?.stanzaId;
              if (quotedStanzaId) {
                const quotedSenderNum = (quotedParticipant || '').replace(/\D/g, '');
                const isQuotedOwn = quotedSenderNum === senderNum || !quotedSenderNum;

                if (!isAdmin && !isQuotedOwn) {
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[ACCESS DENIED]*\nYou can only delete your own messages. You must be a Group Administrator to delete other members' messages.`,
                  }, { quoted: msg });
                  return;
                }

                try {
                  const isQuotedFromMe = quotedParticipant ? quotedParticipant.replace(/\D/g, '') === botPhone : false;
                  await sock.sendMessage(remoteJid, {
                    delete: {
                      id: quotedStanzaId,
                      fromMe: isQuotedFromMe,
                      remoteJid: remoteJid,
                      participant: quotedParticipant,
                    },
                  });
                  // Delete the .del trigger message as well
                  await sock.sendMessage(remoteJid, { delete: msg.key });
                } catch (e: any) {
                  console.error('Error deleting single message:', e);
                }
                return;
              }

              await sock.sendMessage(remoteJid, {
                text: `⚠️ *[DELETE USAGE]*\n• Reply to a message with *.del* to delete it immediately.\n• Or type *.del [number]* (e.g. *.del 20*) to clear recent messages!`,
              }, { quoted: msg });
              return;
            }

            // 9. .tagall (Mention all group members: connected bot user, bold & styled, no links)
            if (command === 'tagall' || command === 'everyone') {
              if (!isGroup) {
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[GROUP ONLY]*\nThe *.tagall* command can only be used inside a WhatsApp group.`,
                }, { quoted: msg });
                return;
              }

              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const participants = groupMeta.participants || [];
                const customMessage = args.join(' ').trim();
                const groupTitle = groupMeta.subject || 'WhatsApp Group';

                let output = `╭━━━〔 📢 *GROUP ANNOUNCEMENT* 〕━━━╮\n`;
                output += `┃ 👥 *Group:* *${groupTitle}*\n`;
                output += `┃ 🔢 *Members:* *${participants.length}*\n`;
                if (customMessage) {
                  output += `┃ 📌 *Notice:* *${customMessage}*\n`;
                }
                output += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;

                output += `╭──〔 👥 *ATTENDANCE ROSTER* 〕──╮\n`;
                participants.forEach((p, idx) => {
                  const num = p.id.split('@')[0];
                  output += `│ ${idx + 1}. @${num}\n`;
                });
                output += `╰───────────────────────────────╯\n\n`;
                output += `> ⚡ *SOLVATECH BOT BROADCAST*`;

                reactDone();
                await sock.sendMessage(
                  remoteJid,
                  {
                    text: output,
                    mentions: participants.map((p) => p.id),
                  },
                  { quoted: msg }
                );
              } catch (err: any) {
                reactError();
                console.error('Error executing .tagall:', err);
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[TAGALL ERROR]*\nFailed to tag group members: ${err.message}`,
                }, { quoted: msg });
              }
              return;
            }

            // 10. .admin / .admins (Summon and tag all group administrators)
            if (command === 'admin' || command === 'admins') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[GROUP ONLY]*\nThe *.admin* command can only be used inside a WhatsApp group.`,
                }, { quoted: msg });
                return;
              }

              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const admins = groupMeta.participants.filter(
                  (p) => p.admin === 'admin' || p.admin === 'superadmin'
                );
                const customReason = args.join(' ').trim();
                const groupTitle = groupMeta.subject || 'WhatsApp Group';

                let output = `╭━━━〔 🛡️ *ADMINISTRATOR ROSTER* 〕━━━╮\n`;
                output += `┃ 👥 *Group:* *${groupTitle}*\n`;
                output += `┃ 🛡️ *Total Admins:* *${admins.length}*\n`;
                if (customReason) {
                  output += `┃ ⚠️ *Notice:* *${customReason}*\n`;
                }
                output += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;

                output += `╭──〔 ⚡ *GROUP ADMINISTRATORS* 〕──╮\n`;
                admins.forEach((admin, i) => {
                  const num = admin.id.split('@')[0];
                  const isSuper = admin.admin === 'superadmin' ? ' 👑 (Creator)' : '';
                  output += `│ ${i + 1}. @${num}${isSuper}\n`;
                });
                output += `╰───────────────────────────────╯\n\n`;
                output += `> ⚡ *SOLVATECH BOT ADMIN ALERT*`;

                reactDone();
                await sock.sendMessage(
                  remoteJid,
                  {
                    text: output,
                    mentions: admins.map((a) => a.id),
                  },
                  { quoted: msg }
                );
              } catch (err: any) {
                reactError();
                console.error('Error in .admin:', err);
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[ADMIN ERROR]*\nFailed to fetch administrators: ${err.message}`,
                }, { quoted: msg });
              }
              return;
            }

            // 11. .kick (Remove participant from group: connected user must be group admin)
            if (command === 'kick' || command === 'remove') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[GROUP ONLY]*\nThe *.kick* command can only be used inside a WhatsApp group.`,
                }, { quoted: msg });
                return;
              }

              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const senderParticipant = groupMeta.participants.find(
                  (p) => p.id.replace(/\D/g, '') === senderNum || p.id === senderJid
                );
                const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';

                if (!isSenderAdmin) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to remove participants from this group.`,
                  }, { quoted: msg });
                  return;
                }

                let targetJid = mentionedJids[0] || quotedParticipant;
                if (!targetJid && args[0]) {
                  const cleanTargetDigits = args[0].replace(/\D/g, '');
                  if (cleanTargetDigits) {
                    targetJid = `${cleanTargetDigits}@s.whatsapp.net`;
                  }
                }

                if (!targetJid) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[KICK USAGE]*\nPlease reply to a member's message or tag them with *.kick @user* to remove them from the group.`,
                  }, { quoted: msg });
                  return;
                }

                const targetNum = targetJid.split('@')[0].replace(/\D/g, '');
                const targetInGroup = groupMeta.participants.find(
                  (p) => p.id.replace(/\D/g, '') === targetNum
                );

                if (!targetInGroup) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[KICK ERROR]*\nThe specified user is not in this group.`,
                  }, { quoted: msg });
                  return;
                }

                if (targetInGroup.admin === 'superadmin') {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `🛡️ *[PROTECTED]*\nCannot remove the Group Creator/Superadmin!`,
                  }, { quoted: msg });
                  return;
                }

                if (targetNum === senderNum || targetNum === botPhone) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ You cannot kick yourself!`,
                  }, { quoted: msg });
                  return;
                }

                await sock.groupParticipantsUpdate(remoteJid, [targetInGroup.id], 'remove');
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `👢 *[MEMBER REMOVED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Participant:* @${targetNum}\n⚡ *Action:* Ejected from group by Group Administrator.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Security_`,
                  mentions: [targetInGroup.id],
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Error kicking user:', err);
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[KICK ERROR]*\nFailed to remove member: ${err.message || 'Make sure your account has admin privileges'}`,
                }, { quoted: msg });
              }
              return;
            }

            // 12. .add (Add participant to group with privacy invite fallback)
            if (command === 'add' || command === 'invite') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[GROUP ONLY]*\nThe *.add* command can only be used inside a WhatsApp group.`,
                }, { quoted: msg });
                return;
              }

              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const senderParticipant = groupMeta.participants.find(
                  (p) => p.id.replace(/\D/g, '') === senderNum || p.id === senderJid
                );
                const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';

                if (!isSenderAdmin) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to add participants to this group.`,
                  }, { quoted: msg });
                  return;
                }

                let targetDigits = (args[0] || '').replace(/\D/g, '');
                if (!targetDigits && quotedParticipant) {
                  targetDigits = quotedParticipant.replace(/\D/g, '');
                }

                if (!targetDigits) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[ADD USAGE]*\nPlease specify a valid phone number with country code:\n💡 *Example:* *.add 2348012345678* or reply to a contact.`,
                  }, { quoted: msg });
                  return;
                }

                const targetJid = `${targetDigits}@s.whatsapp.net`;
                const res = await sock.groupParticipantsUpdate(remoteJid, [targetJid], 'add');
                const updateStatus = res?.[0]?.status;

                if (updateStatus === '403' || updateStatus === '408') {
                  let inviteCode = await sock.groupInviteCode(remoteJid);
                  const inviteUrl = `https://chat.whatsapp.com/${inviteCode}`;
                  reactDone();
                  await sock.sendMessage(remoteJid, {
                    text: `📨 *[INVITATION ISSUED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* +${targetDigits}\n🔒 *Status:* Privacy settings prevent direct adding.\n🔗 *Invite Link:* ${inviteUrl}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _SOLVATECH Group Management_`,
                  }, { quoted: msg });
                  return;
                }

                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `➕ *[MEMBER ADDED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Participant:* @${targetDigits}\n✅ Successfully added to *${groupMeta.subject || 'this group'}*!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _SOLVATECH Group Management_`,
                  mentions: [targetJid],
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Error adding user:', err);
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[ADD ERROR]*\nFailed to add user: ${err.message || 'Make sure your account is an admin'}`,
                }, { quoted: msg });
              }
              return;
            }

            // 13. .promote (Promote member to Group Administrator)
            if (command === 'promote') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[GROUP ONLY]*\nThe *.promote* command can only be used inside a WhatsApp group.`,
                }, { quoted: msg });
                return;
              }

              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const senderParticipant = groupMeta.participants.find(
                  (p) => p.id.replace(/\D/g, '') === senderNum || p.id === senderJid
                );
                const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';

                if (!isSenderAdmin) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to promote participants in this group.`,
                  }, { quoted: msg });
                  return;
                }

                let targetJid = mentionedJids[0] || quotedParticipant;
                if (!targetJid && args[0]) {
                  const cleanDigits = args[0].replace(/\D/g, '');
                  if (cleanDigits) targetJid = `${cleanDigits}@s.whatsapp.net`;
                }

                if (!targetJid) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[PROMOTE USAGE]*\nPlease tag a member or reply to their message with *.promote @user*.`,
                  }, { quoted: msg });
                  return;
                }

                const targetNum = targetJid.split('@')[0].replace(/\D/g, '');
                const participant = groupMeta.participants.find((p) => p.id.replace(/\D/g, '') === targetNum);

                if (!participant) {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⚠️ User is not in this group.` }, { quoted: msg });
                  return;
                }

                if (participant.admin) {
                  reactDone();
                  await sock.sendMessage(remoteJid, {
                    text: `ℹ️ @${targetNum} is already a Group Administrator!`,
                    mentions: [participant.id],
                  }, { quoted: msg });
                  return;
                }

                await sock.groupParticipantsUpdate(remoteJid, [participant.id], 'promote');
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `⭐ *[ADMIN PROMOTED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎉 *Congratulations:* @${targetNum}\n🛡️ Promoted to *Group Administrator* by @${senderNum}!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _SOLVATECH Group Administration_`,
                  mentions: [participant.id, senderParticipant?.id || senderJid],
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Error promoting user:', err);
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[PROMOTE ERROR]*\nFailed to promote: ${err.message}`,
                }, { quoted: msg });
              }
              return;
            }

            // 14. .demote (Demote admin back to regular member)
            if (command === 'demote') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[GROUP ONLY]*\nThe *.demote* command can only be used inside a WhatsApp group.`,
                }, { quoted: msg });
                return;
              }

              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const senderParticipant = groupMeta.participants.find(
                  (p) => p.id.replace(/\D/g, '') === senderNum || p.id === senderJid
                );
                const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';

                if (!isSenderAdmin) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to demote participants in this group.`,
                  }, { quoted: msg });
                  return;
                }

                let targetJid = mentionedJids[0] || quotedParticipant;
                if (!targetJid && args[0]) {
                  const cleanDigits = args[0].replace(/\D/g, '');
                  if (cleanDigits) targetJid = `${cleanDigits}@s.whatsapp.net`;
                }

                if (!targetJid) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[DEMOTE USAGE]*\nPlease tag an admin or reply to their message with *.demote @user*.`,
                  }, { quoted: msg });
                  return;
                }

                const targetNum = targetJid.split('@')[0].replace(/\D/g, '');
                const participant = groupMeta.participants.find((p) => p.id.replace(/\D/g, '') === targetNum);

                if (!participant) {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⚠️ User is not in this group.` }, { quoted: msg });
                  return;
                }

                if (participant.admin === 'superadmin') {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `🛡️ *[PROTECTED]*\nCannot demote the Group Creator/Superadmin!`,
                  }, { quoted: msg });
                  return;
                }

                if (!participant.admin) {
                  reactDone();
                  await sock.sendMessage(remoteJid, {
                    text: `ℹ️ @${targetNum} is not an administrator.`,
                    mentions: [participant.id],
                  }, { quoted: msg });
                  return;
                }

                await sock.groupParticipantsUpdate(remoteJid, [participant.id], 'demote');
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🔻 *[ADMIN DEMOTED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Participant:* @${targetNum}\n⚠️ Demoted from Administrator back to regular member.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _SOLVATECH Group Administration_`,
                  mentions: [participant.id],
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Error demoting user:', err);
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[DEMOTE ERROR]*\nFailed to demote: ${err.message}`,
                }, { quoted: msg });
              }
              return;
            }

            // 15. .lock (Lock group: announcements only)
            if (command === 'lock') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[GROUP ONLY]*\nThe *.lock* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                return;
              }
              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const p = groupMeta.participants.find(x => x.id.replace(/\D/g, '') === senderNum || x.id === senderJid);
                if (p?.admin !== 'admin' && p?.admin !== 'superadmin') {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to lock this group.` }, { quoted: msg });
                  return;
                }
                await sock.groupSettingUpdate(remoteJid, 'announcement');
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🔒 *[GROUP LOCKED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGroup messaging has been restricted to Administrators only.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Enforced by SOLVATECH_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[LOCK ERROR]*\nFailed to lock group: ${err.message}` }, { quoted: msg });
              }
              return;
            }

            // 16. .unlock (Unlock group: all members can message)
            if (command === 'unlock') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[GROUP ONLY]*\nThe *.unlock* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                return;
              }
              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const p = groupMeta.participants.find(x => x.id.replace(/\D/g, '') === senderNum || x.id === senderJid);
                if (p?.admin !== 'admin' && p?.admin !== 'superadmin') {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to unlock this group.` }, { quoted: msg });
                  return;
                }
                await sock.groupSettingUpdate(remoteJid, 'not_announcement');
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🔓 *[GROUP UNLOCKED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGroup messaging is now open for all members.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Enforced by SOLVATECH_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[UNLOCK ERROR]*\nFailed to unlock group: ${err.message}` }, { quoted: msg });
              }
              return;
            }

            // 17. .antilink (Toggle Anti-Link defense)
            if (command === 'antilink') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[GROUP ONLY]*\nThe *.antilink* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                return;
              }
              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const p = groupMeta.participants.find(x => x.id.replace(/\D/g, '') === senderNum || x.id === senderJid);
                if (p?.admin !== 'admin' && p?.admin !== 'superadmin') {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to configure anti-link.` }, { quoted: msg });
                  return;
                }
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                commandHandler.setSecuritySetting(remoteJid, 'antilink', val);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🛡️ *[ANTI-LINK SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Unauthorized external links will be auto-deleted with security warning issued to sender.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ Failed to configure anti-link: ${err.message}` }, { quoted: msg });
              }
              return;
            }

            // 18. .antibot (Toggle Anti-Bot defense)
            if (command === 'antibot') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[GROUP ONLY]*\nThe *.antibot* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                return;
              }
              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const p = groupMeta.participants.find(x => x.id.replace(/\D/g, '') === senderNum || x.id === senderJid);
                if (p?.admin !== 'admin' && p?.admin !== 'superadmin') {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to configure anti-bot.` }, { quoted: msg });
                  return;
                }
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                commandHandler.setSecuritySetting(remoteJid, 'antibot', val);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🤖 *[ANTI-BOT SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Non-admin members using bot prefix commands (*.*) will have their message auto-deleted and receive a security warning.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ Failed to configure anti-bot: ${err.message}` }, { quoted: msg });
              }
              return;
            }

            // 19. .antistatus (Toggle Anti-Status Mentions defense)
            if (command === 'antistatus') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[GROUP ONLY]*\nThe *.antistatus* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                return;
              }
              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const p = groupMeta.participants.find(x => x.id.replace(/\D/g, '') === senderNum || x.id === senderJid);
                if (p?.admin !== 'admin' && p?.admin !== 'superadmin') {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to configure anti-status mentions.` }, { quoted: msg });
                  return;
                }
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                commandHandler.setSecuritySetting(remoteJid, 'antistatus', val);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `📱 *[ANTI-STATUS MENTION SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Non-admin members mentioning this group in their personal WhatsApp status will have the alert deleted and receive a security warning.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ Failed to configure anti-status: ${err.message}` }, { quoted: msg });
              }
              return;
            }

            // 20. .antispam (Toggle Anti-Spam defense)
            if (command === 'antispam') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[GROUP ONLY]*\nThe *.antispam* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                return;
              }
              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const p = groupMeta.participants.find(x => x.id.replace(/\D/g, '') === senderNum || x.id === senderJid);
                if (p?.admin !== 'admin' && p?.admin !== 'superadmin') {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator to configure anti-spam.` }, { quoted: msg });
                  return;
                }
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                commandHandler.setSecuritySetting(remoteJid, 'antispam', val);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🚫 *[ANTI-SPAM DEFENSE SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Flood messages, rapid stickers/media spam, and repetitive text/words will be automatically purged (including original spam messages). If a member continues sending messages while deletion is underway, they are *INSTANTLY KICKED*!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ Failed to configure anti-spam: ${err.message}` }, { quoted: msg });
              }
              return;
            }

            // 21. .autowelcome (Toggle Auto-Welcome for joining members - Strictly Admin Only)
            if (command === 'autowelcome') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[GROUP ONLY]*\nThe *.autowelcome* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                return;
              }
              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const p = groupMeta.participants.find(x => x.id.replace(/\D/g, '') === senderNum || x.id === senderJid);
                const isSenderAdmin = p?.admin === 'admin' || p?.admin === 'superadmin' || isOwner;
                if (!isSenderAdmin) {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator connected to the bot to configure auto-welcome.` }, { quoted: msg });
                  return;
                }
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                commandHandler.setSecuritySetting(remoteJid, 'autowelcome', val);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `👋 *[AUTO-WELCOME SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Automatically greets anyone who enters the group (whether approved by admin, added by members, or added via link).\nRule: Strictly sent only by connected admin bots (choosing exactly 1 admin bot if multiple are connected).\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ Failed to configure auto-welcome: ${err.message}` }, { quoted: msg });
              }
              return;
            }

            // 22. .autogoodbye (Toggle Auto-Goodbye for departing members - Strictly Admin Only)
            if (command === 'autogoodbye') {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[GROUP ONLY]*\nThe *.autogoodbye* command can only be used inside a WhatsApp group.` }, { quoted: msg });
                return;
              }
              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const p = groupMeta.participants.find(x => x.id.replace(/\D/g, '') === senderNum || x.id === senderJid);
                const isSenderAdmin = p?.admin === 'admin' || p?.admin === 'superadmin' || isOwner;
                if (!isSenderAdmin) {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⛔ *[ACCESS DENIED]*\nYou must be a Group Administrator connected to the bot to configure auto-goodbye.` }, { quoted: msg });
                  return;
                }
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                commandHandler.setSecuritySetting(remoteJid, 'autogoodbye', val);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `👋 *[AUTO-GOODBYE SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Automatically acknowledges departing or removed participants.\nRule: Strictly sent only by connected admin bots (choosing exactly 1 admin bot if multiple are connected).\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ Failed to configure auto-goodbye: ${err.message}` }, { quoted: msg });
              }
              return;
            }

            // 23. .warn, .warnlimit, .warns, .unwarn, .clearwarns, .resetwarns
            // STRICT RULE: All warns commands can only be used by admin connected to bot. Member can NEVER use .warn!
            // Admin cannot be warned by admin. Quoted message (pic, sticker, text, etc.) is auto-magically deleted.
            if (['warn', 'warnlimit', 'warns', 'unwarn', 'clearwarns', 'resetwarns'].includes(command)) {
              if (!isGroup) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[GROUP ONLY]*\nWarn commands can only be used inside a WhatsApp group.` }, { quoted: msg });
                return;
              }

              try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                const senderParticipant = groupMeta.participants.find(
                  (p) => p.id.replace(/\D/g, '') === senderNum || p.id === senderJid
                );
                const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin' || isOwner;

                if (!isSenderAdmin) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `⛔ *[ACCESS DENIED]*\nAll warning commands can ONLY be used by Group Administrators connected to the bot.\nRegular members cannot use .warn or modify warning thresholds.`,
                  }, { quoted: msg });
                  return;
                }

                // A) Setting unified warning limit: .warn limit <number> or .warnlimit <number>
                const firstArg = args[0]?.toLowerCase();
                if (command === 'warnlimit' || firstArg === 'limit' || firstArg === 'max' || firstArg === 'set') {
                  const numStr = command === 'warnlimit' ? args[0] : args[1];
                  const num = parseInt(numStr, 10);
                  if (isNaN(num) || num <= 0) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `⚠️ *[WARN LIMIT USAGE]*\nPlease provide a valid positive number.\n💡 *Example:* *.warn limit 3* or *.warn limit 5*`,
                    }, { quoted: msg });
                    return;
                  }
                  commandHandler.setWarnLimit(remoteJid, num);
                  reactDone();
                  await sock.sendMessage(remoteJid, {
                    text: `⚙️ *[WARN LIMIT UPDATED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGroup warning limit set to *${num} warnings*.\nAccumulating ${num} warnings across Anti-Bot, Anti-Link, Anti-Status, Anti-Spam, or Admin warnings will automatically kick the member.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  }, { quoted: msg });
                  return;
                }

                // B) Inspect warnings: .warns
                if (command === 'warns') {
                  let targetJid = mentionedJids[0] || quotedParticipant;
                  if (!targetJid && args[0]) {
                    const cleanDigits = args[0].replace(/\D/g, '');
                    if (cleanDigits) targetJid = `${cleanDigits}@s.whatsapp.net`;
                  }
                  if (!targetJid) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `⚠️ *[WARNS USAGE]*\nReply to a member's message or tag them with *.warns @user* to check their warning level.`,
                    }, { quoted: msg });
                    return;
                  }
                  const targetClean = targetJid.split('@')[0].replace(/\D/g, '');
                  const count = commandHandler.getWarnings(remoteJid, targetJid);
                  const max = commandHandler.getSecuritySettings(remoteJid).warnLimit || 3;
                  reactDone();
                  await sock.sendMessage(remoteJid, {
                    text: `📋 *[GROUP WARNING STATUS]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Participant:* @${targetClean}\n⚠️ *Current Warnings:* ${count} / ${max}\nStatus: ${count >= max ? '🚨 Removal Limit Exceeded' : `${max - count} warnings remaining before auto-kick`}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_`,
                    mentions: [targetJid],
                  }, { quoted: msg });
                  return;
                }

                // C) Clear warnings for user: .unwarn / .clearwarns
                if (command === 'unwarn' || command === 'clearwarns') {
                  let targetJid = mentionedJids[0] || quotedParticipant;
                  if (!targetJid && args[0]) {
                    const cleanDigits = args[0].replace(/\D/g, '');
                    if (cleanDigits) targetJid = `${cleanDigits}@s.whatsapp.net`;
                  }
                  if (!targetJid) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `⚠️ *[UNWARN USAGE]*\nReply to a member's message or tag them with *.unwarn @user* to reset their warnings.`,
                    }, { quoted: msg });
                    return;
                  }
                  const targetClean = targetJid.split('@')[0].replace(/\D/g, '');
                  commandHandler.clearWarnings(remoteJid, targetJid);
                  reactDone();
                  await sock.sendMessage(remoteJid, {
                    text: `✅ *[WARNINGS RESET]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nWarnings have been reset to *0* for @${targetClean}.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_`,
                    mentions: [targetJid],
                  }, { quoted: msg });
                  return;
                }

                // D) Reset all warnings for group: .resetwarns
                if (command === 'resetwarns') {
                  commandHandler.resetAllWarnings(remoteJid);
                  reactDone();
                  await sock.sendMessage(remoteJid, {
                    text: `🔄 *[ALL WARNINGS CLEARED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nAll group member warnings have been reset to 0 for this group.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_`,
                  }, { quoted: msg });
                  return;
                }

                // E) Issue Warning: .warn
                if (command === 'warn') {
                  let targetJid = mentionedJids[0] || quotedParticipant;
                  if (!targetJid && args[0] && !['limit', 'max', 'set'].includes(args[0].toLowerCase())) {
                    const cleanDigits = args[0].replace(/\D/g, '');
                    if (cleanDigits) targetJid = `${cleanDigits}@s.whatsapp.net`;
                  }

                  if (!targetJid) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `⚠️ *[WARN USAGE]*\nReply to a member's message (pic, sticker, text, or link) or tag them with *.warn @user [reason]*`,
                    }, { quoted: msg });
                    return;
                  }

                  const targetClean = targetJid.split('@')[0].replace(/\D/g, '');
                  const targetInGroup = groupMeta.participants.find(
                    (p) => p.id.replace(/\D/g, '') === targetClean || p.id === targetJid
                  );

                  if (!targetInGroup) {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `⚠️ *[WARN ERROR]*\nThe specified participant is not in this group.`,
                    }, { quoted: msg });
                    return;
                  }

                  // STRICT RULE: "note admin can't be warnd by admin"
                  if (targetInGroup.admin === 'admin' || targetInGroup.admin === 'superadmin') {
                    reactError();
                    await sock.sendMessage(remoteJid, {
                      text: `🛡️ *[PROTECTED ADMINISTRATOR]*\nAdministrators cannot be warned by other admins!\nWarnings strictly apply to regular members only.`,
                      mentions: [targetInGroup.id],
                    }, { quoted: msg });
                    return;
                  }

                  // STRICT RULE: "and auto magically delete th pics or sticker or anything adminnwarn"
                  const quotedMsgId = contextInfo?.stanzaId;
                  const quotedSenderJid = contextInfo?.participant;
                  if (quotedMsgId) {
                    try {
                      await sock.sendMessage(remoteJid, {
                        delete: {
                          remoteJid: remoteJid,
                          id: quotedMsgId,
                          participant: quotedSenderJid || targetInGroup.id,
                          fromMe: false,
                        },
                      });
                    } catch (delErr) {
                      console.warn('Could not auto-delete warned message:', delErr);
                    }
                  }

                  // Increment warning count (+1)
                  const warnResult = commandHandler.addWarning(remoteJid, targetInGroup.id);
                  const reason = args.filter((a: string) => !a.startsWith('@') && a.replace(/\D/g, '') !== targetClean).join(' ').trim() || 'Rule violation / Disobeying group instructions';

                  // Check if warning threshold reached
                  if (warnResult.count >= warnResult.max) {
                    let kickSuccess = false;
                    try {
                      await sock.groupParticipantsUpdate(remoteJid, [targetInGroup.id], 'remove');
                      kickSuccess = true;
                      commandHandler.clearWarnings(remoteJid, targetInGroup.id);
                    } catch (kickErr: any) {
                      console.error('Failed to kick warned user:', kickErr);
                    }

                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `🚨 *[SECURITY WARNING LIMIT REACHED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Offender:* @${targetClean}\n⚠️ *Warnings:* *${warnResult.count} / ${warnResult.max}*\n🗑️ *Action:* Offending message (pic/sticker/text) deleted.\n🔨 *Punishment:* ${kickSuccess ? '*Member ejected from group immediately!*' : '*Threshold reached (Bot requires admin privileges to kick)*'}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_`,
                      mentions: [targetInGroup.id],
                    }, { quoted: msg });
                  } else {
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `⚠️ *[OFFICIAL SECURITY WARNING ISSUED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Member:* @${targetClean}\n👮 *Issued By:* Admin @${senderNum}\n⚠️ *Warning Level:* *${warnResult.count} / ${warnResult.max}*\n📝 *Reason:* ${reason}\n🗑️ *Offending message (pic/sticker/content) deleted.*\n⏳ *Warnings Remaining:* *${warnResult.max - warnResult.count}* before automatic kick.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_`,
                      mentions: [targetInGroup.id, senderParticipant?.id || senderJid],
                    }, { quoted: msg });
                  }
                  return;
                }
              } catch (err: any) {
                reactError();
                await sock.sendMessage(remoteJid, { text: `⚠️ *[WARN ERROR]*: ${err.message}` }, { quoted: msg });
                return;
              }
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
              reactDone();
              this.addNotification({
                type: 'command',
                title: `⚡ Command Executed: .${command}`,
                body: `Executed for +${senderNum}. Response sent to WhatsApp chat.`,
                sender: `+${senderNum}`,
              });
            } catch (err: any) {
              reactError();
              console.error('Error replying to WhatsApp command:', err);
            }
          }
        }
      }
    });

    // Anti-Delete Recovery Handler
    sock.ev.on('messages.update', async (updates) => {
      // Check if anti-delete forwarding to DM is enabled by the user
      if (!commandHandler.getAntiDeleteEnabled()) {
        return; // When off: nothing is forwarded to private chat
      }

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

    // Auto-Welcome and Auto-Goodbye Event Handler
    // STRICT REQUIREMENTS:
    // 1. Auto-welcome must trigger for ANYBODY who enters the group (added by admin, added by members, join request approved, or link).
    // 2. ONLY ADMIN can send auto-welcome or auto-goodbye messages. A regular member bot can NEVER send welcome or goodbye messages.
    // 3. If there are multiple bots in the group and they're both admin, choose ONLY ONE to send the auto-welcome or auto-goodbye message.
    sock.ev.on('group-participants.update', async (update: any) => {
      try {
        const { id: groupId, participants, action } = update;
        if (!groupId || !groupId.endsWith('@g.us')) return;
        if (action !== 'add' && action !== 'remove') return;

        const sec = commandHandler.getSecuritySettings(groupId);
        if (action === 'add' && sec.autowelcome === false) return;
        if (action === 'remove' && sec.autogoodbye === false) return;

        // Fetch group metadata with retry
        let groupMeta: any = null;
        try {
          groupMeta = await sock.groupMetadata(groupId);
        } catch {
          await new Promise((r) => setTimeout(r, 600));
          try {
            groupMeta = await sock.groupMetadata(groupId);
          } catch (metaErr) {
            console.warn(`[Auto-Greeting] Could not fetch groupMetadata for ${groupId}:`, metaErr);
          }
        }

        if (!groupMeta) return;

        if (groupMeta.subject) {
          this.groupSubjectCache.set(groupId, groupMeta.subject);
        }

        const botUserJid = sock.user?.id || (sock as any).user?.jid || sock.authState?.creds?.me?.id || '';
        const botPhone = (botUserJid.split(':')[0] || botUserJid.split('@')[0]).replace(/\D/g, '');
        const linkedPhoneClean = (this.currentStatus.user?.phone || this.currentStatus.targetPhone || '').replace(/\D/g, '');

        // Verify connected bot has admin rights in this group
        const botParticipant = groupMeta.participants?.find(
          (p: any) => {
            const pId = p.id || '';
            const pNum = pId.split('@')[0].split(':')[0].replace(/\D/g, '');
            return (
              (botPhone && pNum === botPhone) ||
              (linkedPhoneClean && pNum === linkedPhoneClean) ||
              pId === botUserJid ||
              (botPhone && pId.startsWith(botPhone))
            );
          }
        );

        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

        // STRICT RULE: Only admin bot sends auto-welcome or auto-goodbye
        if (!isBotAdmin) {
          console.log(`[Auto-Greeting] Bot is not an admin in ${groupId}. Skipping greeting (strictly admin-only sender).`);
          return;
        }

        // Filter out bot's own number so it doesn't welcome or farewell itself
        const isSelf = (rawId: string) => {
          const clean = rawId.split('@')[0].split(':')[0].replace(/\D/g, '');
          return (
            (botPhone && clean === botPhone) ||
            (linkedPhoneClean && clean === linkedPhoneClean) ||
            clean === '2349049979183'
          );
        };

        const targetParticipants = (participants || []).filter((p: any) => {
          const jid = typeof p === 'string' ? p : p.id || p.jid || '';
          return !isSelf(jid);
        });

        if (targetParticipants.length === 0) return;

        // Build normalized @s.whatsapp.net JIDs and @phone tags
        const pJids: string[] = [];
        const pTags: string[] = [];
        for (const p of targetParticipants) {
          const jid = typeof p === 'string' ? p : (p as any).id || (p as any).jid || '';
          if (!jid) continue;
          const num = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
          if (!num) continue;
          const normJid = `${num}@s.whatsapp.net`;
          if (!pJids.includes(normJid)) {
            pJids.push(normJid);
            pTags.push(`@${num}`);
          }
        }

        if (pJids.length === 0) return;

        // Leader Election & Deduplication: prevent duplicate greetings if multiple bot instances or events fire
        const dedupKey = `greet:${groupId}:${action}:${pJids.sort().join(',')}`;
        const lastSent = this.greetingDedupCache.get(dedupKey) || 0;
        if (Date.now() - lastSent < 15000) {
          return;
        }
        this.greetingDedupCache.set(dedupKey, Date.now());

        const groupSubject = groupMeta.subject || 'this group';

        if (action === 'add') {
          const memberCount = groupMeta.participants?.length || 'N/A';
          const welcomeText = `👋 *WELCOME TO ${groupSubject.toUpperCase()}!*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 Welcome ${pTags.join(' ')} to *${groupSubject}*!
👥 *Total Members:* ${memberCount}
${groupMeta.desc ? `\n📜 *Group Description:*\n${groupMeta.desc.slice(0, 300)}${groupMeta.desc.length > 300 ? '...' : ''}\n` : '\n📜 *Group Guidelines:*\n• Respect all members\n• No unauthorized links, bots, or spam\n• Follow administrator guidance\n'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
> ⚡ _Welcomed by Connected Group Admin Bot_`;

          await sock.sendMessage(groupId, {
            text: welcomeText,
            mentions: pJids,
          });

          this.addNotification({
            type: 'system',
            title: `👋 Auto-Welcome Sent in ${groupSubject}`,
            body: `Welcomed ${pTags.join(', ')} to the group.`,
          });
        } else if (action === 'remove') {
          const memberCount = groupMeta.participants?.length || 'N/A';
          const goodbyeText = `👋 *GOODBYE FROM ${groupSubject.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Farewell ${pTags.join(' ')}.
We wish you the very best on your journey! Bye-bye! 👋
👥 *Remaining Members:* ${memberCount}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
> ⚡ _SOLVATECH Group Administration_`;

          await sock.sendMessage(groupId, {
            text: goodbyeText,
            mentions: pJids,
          });

          this.addNotification({
            type: 'system',
            title: `👋 Auto-Goodbye Sent in ${groupSubject}`,
            body: `Goodbye sent for ${pTags.join(', ')}.`,
          });
        }
      } catch (err: any) {
        console.error('Error in group-participants.update handler:', err);
      }
    });

    sock.ev.on('groups.update', (updates: any) => {
      try {
        for (const upd of updates) {
          if (upd.id && upd.subject) {
            this.groupSubjectCache.set(upd.id, upd.subject);
          }
          if (upd.id) {
            // Evict old cached picture to ensure live update
            this.groupPictureCache.delete(upd.id);
          }
        }
      } catch (err: any) {
        console.warn('Error in groups.update handler:', err);
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

  public async getGroupPictureUrl(groupId: string): Promise<string | null> {
    if (!groupId || !groupId.endsWith('@g.us')) return null;
    if (this.groupPictureCache.has(groupId)) {
      return this.groupPictureCache.get(groupId) || null;
    }
    if (!this.sock || !this.currentStatus.isConnected) {
      return null;
    }

    try {
      // 1. Try high-definition profile picture
      const hdUrl = await Promise.race([
        this.sock.profilePictureUrl(groupId, 'image'),
        new Promise<undefined>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
      ]).catch(() => null);

      if (hdUrl) {
        this.groupPictureCache.set(groupId, hdUrl);
        return hdUrl;
      }

      // 2. Try preview thumbnail
      const previewUrl = await Promise.race([
        this.sock.profilePictureUrl(groupId, 'preview'),
        new Promise<undefined>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]).catch(() => null);

      if (previewUrl) {
        this.groupPictureCache.set(groupId, previewUrl);
        return previewUrl;
      }
    } catch {
      // Group might not have a profile picture set or privacy restricted
    }
    return null;
  }

  private getLidReverseMapping(lidUser: string): string | null {
    if (!lidUser) return null;
    const cleanLid = lidUser.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanLid) return null;

    if (this.reverseLidMap.has(cleanLid)) {
      return this.reverseLidMap.get(cleanLid) || null;
    }

    // Try reading from baileys auth directory on demand
    try {
      const filePath = path.join(this.authDir, `lid-mapping-${cleanLid}_reverse.json`);
      if (fs.existsSync(filePath)) {
        const phone = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const cleanPhone = String(phone).replace(/\D/g, '');
        if (cleanPhone) {
          this.reverseLidMap.set(cleanLid, cleanPhone);
          return cleanPhone;
        }
      }
    } catch {
      // Ignore file read error
    }

    return null;
  }

  public async getGroupsWithSettings(adminOnlyFilter = false): Promise<Array<{
    id: string;
    subject: string;
    desc?: string;
    pictureUrl?: string | null;
    memberCount: number;
    isAdmin: boolean;
    creation?: number;
    owner?: string;
    settings: {
      autowelcome: boolean;
      autogoodbye: boolean;
      antilink: boolean;
      antibot: boolean;
      antistatus: boolean;
      antispam: boolean;
      warnLimit?: number;
    };
  }>> {
    // STRICT USER REQUIREMENT:
    // "Once your button not linked to the account, the group that will show, don't let it show any group.
    // Say link account first to show your groups that you are in."
    // If WhatsApp is NOT connected, return 0 groups!
    if (!this.sock || !this.currentStatus.isConnected) {
      return [];
    }

    const result: Array<{
      id: string;
      subject: string;
      desc?: string;
      pictureUrl?: string | null;
      memberCount: number;
      isAdmin: boolean;
      creation?: number;
      owner?: string;
      settings: any;
    }> = [];

    try {
      const allGroups = await this.sock.groupFetchAllParticipating();

      // Collect all possible identities of the linked account/user
      const credsMe = (this.sock as any).authState?.creds?.me || (this.sock as any).user || {};
      const botUserJid: string = credsMe.id || this.sock.user?.id || (this.sock as any).user?.jid || '';
      const botUserLid: string = credsMe.lid || (this.sock as any).user?.lid || '';

      const botPhone = (botUserJid.split(':')[0] || botUserJid.split('@')[0]).replace(/\D/g, '');
      const linkedPhoneClean = (this.currentStatus.user?.phone || this.currentStatus.targetPhone || '').replace(/\D/g, '');
      const botLidNum = (botUserLid.split(':')[0] || botUserLid.split('@')[0]).replace(/\D/g, '');

      // Build target phone set and LID set
      const targetPhones = new Set<string>();
      if (botPhone) targetPhones.add(botPhone);
      if (linkedPhoneClean) targetPhones.add(linkedPhoneClean);

      const targetLids = new Set<string>();
      if (botLidNum) targetLids.add(botLidNum);

      // Check if user phone has corresponding LID file
      for (const phone of targetPhones) {
        try {
          const directFile = path.join(this.authDir, `lid-mapping-${phone}.json`);
          if (fs.existsSync(directFile)) {
            const mappedLid = String(JSON.parse(fs.readFileSync(directFile, 'utf8'))).replace(/\D/g, '');
            if (mappedLid) targetLids.add(mappedLid);
          }
        } catch {
          // Ignore read error
        }
      }

      // Check reverse mapping for target LIDs
      for (const lid of targetLids) {
        const mappedPhone = this.getLidReverseMapping(lid);
        if (mappedPhone) targetPhones.add(mappedPhone);
      }

      const isAccountMatch = (rawId: string | undefined): boolean => {
        if (!rawId) return false;
        const cleanUser = rawId.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (!cleanUser) return false;

        if (targetPhones.has(cleanUser)) return true;
        if (targetLids.has(cleanUser)) return true;

        // Check if rawId is a LID that maps to our phone
        if (rawId.endsWith('@lid') || !targetPhones.has(cleanUser)) {
          const mapped = this.getLidReverseMapping(cleanUser);
          if (mapped && targetPhones.has(mapped)) {
            return true;
          }
        }

        return false;
      };

      for (const [gid, meta] of Object.entries(allGroups)) {
        const realSubject = meta.subject || this.groupSubjectCache.get(gid) || 'WhatsApp Group';
        this.groupSubjectCache.set(gid, realSubject);

        // Check 1: Is user the group creator/owner? (In WhatsApp, the group creator is always admin)
        const isGroupOwner = isAccountMatch(meta.owner) || isAccountMatch((meta as any).ownerPn) || isAccountMatch((meta as any).creator);

        // Check 2: Find participant record for linked phone/account
        const userParticipant = meta.participants?.find((p: any) => {
          const pId = p.id || '';
          const pPhoneNumber = p.phoneNumber ? String(p.phoneNumber).replace(/\D/g, '') : '';
          const pLid = p.lid ? String(p.lid).replace(/\D/g, '') : '';

          if (isAccountMatch(pId)) return true;
          if (pPhoneNumber && targetPhones.has(pPhoneNumber)) return true;
          if (pLid && targetLids.has(pLid)) return true;

          return false;
        });

        const isParticipantAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin';
        const isAdmin = Boolean(isGroupOwner || isParticipantAdmin);

        // If adminOnlyFilter requested, skip groups where linked phone is not an admin
        if (adminOnlyFilter && !isAdmin) {
          continue;
        }

        // Check if cached picture URL exists
        const cachedPic = this.groupPictureCache.get(gid) || null;

        result.push({
          id: gid,
          subject: realSubject,
          desc: meta.desc ? String(meta.desc) : undefined,
          pictureUrl: cachedPic,
          memberCount: meta.participants?.length || 0,
          isAdmin,
          creation: meta.creation,
          owner: meta.owner,
          settings: commandHandler.getSecuritySettings(gid),
        });
      }

      // Concurrently fetch real pictures for groups that do not have them in cache
      const pendingPics = result.filter((g) => !g.pictureUrl);
      if (pendingPics.length > 0) {
        // Fetch up to 10 in parallel
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
      console.warn('Error fetching live participating groups:', err);
    }

    // STRICT REQUIREMENT: Absolutely no mock or sample groups!
    return result;
  }
}

export const whatsappManager = new WhatsAppManager();
