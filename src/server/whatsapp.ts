import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
  proto,
  downloadContentFromMessage,
  getUrlInfo,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import webpmux from 'node-webpmux';

const execFileAsync = promisify(execFile);
import { createWorker } from 'tesseract.js';
import { commandHandler, parseSpamArgs, GROUP_ONLY_COMMANDS, ADMIN_ONLY_GROUP_COMMANDS } from './commands.ts';
import { isFirestoreQuotaExhausted, reportFirestoreError } from '../services/firestore-status.ts';
import { db, doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch } from './firebase-admin.ts';
import { isOwnerEmail } from '../services/admin-config.ts';
import { findActiveLicenseByUser, getAllLicenseRecords } from './license-store.ts';

// 🛡️ SIGNAL CRYPTO ERROR GUARDIAN:
// Intercepts transient libsignal console errors (e.g. "Bad MAC", "Failed to decrypt message with any known session")
// so that transient decryption re-handshakes in multi-device WhatsApp groups do not pollute stderr as fatal unhandled errors.
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  const fullText = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message + ' ' + (a.stack || '') : a ? JSON.stringify(a) : ''))
    .join(' ');
  if (
    fullText.includes('Failed to decrypt message with any known session') ||
    fullText.includes('Session error:Error: Bad MAC') ||
    fullText.includes('Error: Bad MAC') ||
    fullText.includes('No matching sessions found for message')
  ) {
    console.warn('[Signal Crypto Guardian] Transient Signal session decryption mismatch intercepted (Bad MAC). Background session auto-repair and pre-key retry active.');
    return;
  }
  originalConsoleError.apply(console, args);
};

// Shared greeting lock across all bot sessions to prevent multiple admin bots from welcoming the same user
const globalAdminGreetingLock = new Map<string, number>();

// Prevent sharp/libvips from hoarding unmanaged memory in Node (essential for Railway 512MB RAM stability)
sharp.cache(false);

const MAX_PROCESS_MEDIA_CACHE_BYTES = 64 * 1024 * 1024;
const processMediaCache = new Map<string, { size: number; evict: () => void }>();
let processMediaCacheBytes = 0;

function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

const hashSessionContent = (content: string) =>
  createHash('sha256').update(content, 'utf8').digest('hex');

const isSafeAuthFileName = (filename: string) =>
  Boolean(filename) &&
  filename !== '.' &&
  filename !== '..' &&
  path.basename(filename) === filename &&
  !filename.includes('\\') &&
  filename.endsWith('.json');

// Essential auth files for cloud backup:
// Tier 1: creds.json (master paired phone credentials)
// Tier 2: app-state-sync-key-* (chat app state encryption keys)
// Chat versions (app-state-sync-version-*) and volatile keys (session-*, pre-key-*, sender-key-*)
// remain strictly on local disk to protect Firestore free-tier daily quota (20,000 writes/day).
export const isEssentialCloudAuthFile = (filename: string): boolean => {
  if (filename === 'creds.json') return true;
  if (filename.startsWith('app-state-sync-key-')) return true;
  return false;
};

// Helper: Cached brand buffer for instant responses without disk/compression overhead
let cachedSolvaBrandJpeg: Buffer | null = null;

// Helper: Retrieve official SOLVATECH brand image as buffer for WhatsApp messages (.menu, welcome, etc.)
export async function getSolvaBrandBuffer(): Promise<Buffer | null> {
  if (cachedSolvaBrandJpeg) return cachedSolvaBrandJpeg;
  const candidatePaths = [
    path.resolve(process.cwd(), 'public', 'solva.webp'),
    path.resolve(process.cwd(), 'solva.webp'),
    path.resolve(process.cwd(), 'dist', 'solva.webp'),
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p);
        try {
          cachedSolvaBrandJpeg = await sharp(raw).jpeg({ quality: 85 }).toBuffer();
          return cachedSolvaBrandJpeg;
        } catch {
          return raw;
        }
      } catch (err) {
        console.warn('Could not read solva brand image at', p, err);
      }
    }
  }
  return null;
}

// Pre-warm brand JPEG buffer in memory on boot for instant responses
void getSolvaBrandBuffer().catch(() => {});

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
  isGif?: boolean;
  isPtv?: boolean;
} | null {
  if (!msgObj) return null;
  const inner = unwrapMessage(msgObj);
  if (!inner) return null;

  if (inner.imageMessage) {
    return { target: inner.imageMessage, type: 'image', isViewOnce: !!inner.imageMessage.viewOnce };
  }
  if (inner.videoMessage) {
    return {
      target: inner.videoMessage,
      type: 'video',
      isViewOnce: !!inner.videoMessage.viewOnce,
      isGif: !!inner.videoMessage.gifPlayback,
    };
  }
  if (inner.ptvMessage) {
    return {
      target: inner.ptvMessage,
      type: 'video',
      isViewOnce: false,
      isPtv: true,
    };
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
  // Interactive message headers
  const header = inner.interactiveMessage?.header || inner.templateMessage?.hydratedTemplate;
  if (header?.imageMessage) {
    return { target: header.imageMessage, type: 'image', isViewOnce: false };
  }
  if (header?.videoMessage) {
    return { target: header.videoMessage, type: 'video', isViewOnce: false, isGif: !!header.videoMessage.gifPlayback };
  }
  if (header?.documentMessage) {
    return { target: header.documentMessage, type: 'document', isViewOnce: false };
  }
  return null;
}

// Helper: Download Baileys media stream to buffer
export async function downloadMediaBuffer(target: any, type: any): Promise<Buffer> {
  const stream = await downloadContentFromMessage(target, type);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  const buf = Buffer.concat(chunks);
  if (!buf || buf.length === 0) {
    throw new Error('Downloaded empty media buffer');
  }
  return buf;
}

// Helper: Download media buffer with automatic retries for maximum reliability
export async function downloadMediaBufferWithRetry(target: any, type: any, maxRetries = 3): Promise<Buffer> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const buf = await downloadMediaBuffer(target, type);
      if (buf && buf.length > 0) return buf;
    } catch (err: any) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, attempt * 600));
      }
    }
  }
  throw lastErr || new Error(`Failed to download media after ${maxRetries} attempts`);
}

// Helper: Sanitize and reformat video for 100% WhatsApp mobile playback (+faststart, H.264 Baseline, AAC)
// Fixes WhatsApp error: "Can't view this video" / "Error: can't view"
export async function sanitizeVideoForWhatsApp(inputBuf: Buffer): Promise<{ buffer: Buffer; mimetype: string }> {
  if (!inputBuf || inputBuf.length === 0) {
    return { buffer: inputBuf, mimetype: 'video/mp4' };
  }
  const tmpIn = path.join('/tmp', `v_in_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`);
  const tmpOut = path.join('/tmp', `v_out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`);

  try {
    await fs.promises.writeFile(tmpIn, inputBuf);

    // Attempt 1: Ultra-fast stream-copy with +faststart (puts moov atom at beginning in ~15ms with 0 recompression)
    try {
      await execFileAsync('ffmpeg', [
        '-y', '-v', 'error', '-i', tmpIn, '-c', 'copy', '-movflags', '+faststart', tmpOut
      ], { timeout: 8000 });
      if (fs.existsSync(tmpOut) && (await fs.promises.stat(tmpOut)).size > 0) {
        const outBuf = await fs.promises.readFile(tmpOut);
        return { buffer: outBuf, mimetype: 'video/mp4' };
      }
    } catch {
      // Stream-copy failed: codecs or container require transcoding
    }

    // Attempt 2: High-speed transcode to universal H.264 Baseline (yuv420p) + AAC with +faststart
    try {
      if (fs.existsSync(tmpOut)) await fs.promises.unlink(tmpOut).catch(() => {});
      await execFileAsync('ffmpeg', [
        '-y', '-v', 'error', '-i', tmpIn, '-c:v', 'libx264', '-preset', 'ultrafast',
        '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmpOut
      ], { timeout: 25000 });
      if (fs.existsSync(tmpOut) && (await fs.promises.stat(tmpOut)).size > 0) {
        const outBuf = await fs.promises.readFile(tmpOut);
        return { buffer: outBuf, mimetype: 'video/mp4' };
      }
    } catch (encodeErr) {
      console.warn('[Anti-Delete] Video transcoding fallback warning:', encodeErr);
    }

    return { buffer: inputBuf, mimetype: 'video/mp4' };
  } catch (err) {
    console.warn('[Anti-Delete] Error preparing compatible video:', err);
    return { buffer: inputBuf, mimetype: 'video/mp4' };
  } finally {
    try {
      if (fs.existsSync(tmpIn)) await fs.promises.unlink(tmpIn).catch(() => {});
      if (fs.existsSync(tmpOut)) await fs.promises.unlink(tmpOut).catch(() => {});
    } catch {}
  }
}

// Helper: Sanitize image for WhatsApp delivery (auto-orients EXIF rotation and ensures standard JPEG)
export async function sanitizeImageForWhatsApp(inputBuf: Buffer): Promise<{ buffer: Buffer; mimetype: string }> {
  if (!inputBuf || inputBuf.length === 0) {
    return { buffer: inputBuf, mimetype: 'image/jpeg' };
  }
  try {
    const cleanJpg = await sharp(inputBuf)
      .rotate() // auto-orient based on EXIF
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return { buffer: cleanJpg, mimetype: 'image/jpeg' };
  } catch {
    return { buffer: inputBuf, mimetype: 'image/jpeg' };
  }
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
    await fs.promises.writeFile(tmpIn, rawBuf);
    try {
      await execFileAsync('ffmpeg', [
        '-y', '-i', tmpIn,
        '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15',
        '-c:v', 'libwebp', '-lossless', '0', '-compression_level', '4',
        '-q:v', '65', '-loop', '0', '-ss', '00:00:00', '-t', '00:00:06',
        '-an', '-vsync', '0', tmpOut
      ], { timeout: 15000 });
      webpBuf = await fs.promises.readFile(tmpOut);
    } finally {
      if (fs.existsSync(tmpIn)) await fs.promises.unlink(tmpIn).catch(() => {});
      if (fs.existsSync(tmpOut)) await fs.promises.unlink(tmpOut).catch(() => {});
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
      await fs.promises.writeFile(tmpGif, gifBuf);

      // Step 2: FFmpeg converts standard GIF to MP4 video
      await execFileAsync('ffmpeg', [
        '-y', '-i', tmpGif, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', tmpOut
      ], { timeout: 20000 });
      const vidBuf = await fs.promises.readFile(tmpOut);
      return { type: 'video', buffer: vidBuf, mimetype: 'video/mp4' };
    } finally {
      if (fs.existsSync(tmpGif)) await fs.promises.unlink(tmpGif).catch(() => {});
      if (fs.existsSync(tmpOut)) await fs.promises.unlink(tmpOut).catch(() => {});
    }
  } else {
    const pngBuf = await sharp(rawBuf).png().toBuffer();
    return { type: 'image', buffer: pngBuf, mimetype: 'image/png' };
  }
}

export interface WhatsAppNotification {
  id: string;
  type: 'pairing' | 'connection' | 'message_received' | 'message_sent' | 'system' | 'error' | 'command' | 'warning';
  title: string;
  body: string;
  timestamp: string;
  sender?: string;
  data?: any;
}

export type PairingStage = 'idle' | 'code_generated' | 'pairing_handshake' | 'connected' | 'expired';

export interface WhatsAppStatus {
  state: 'disconnected' | 'connecting' | 'awaiting_pairing' | 'pairing_handshake' | 'connected' | 'expired';
  isConnected: boolean;
  isPaired?: boolean;
  pairingStage: PairingStage;
  pairingCode?: string;
  qrCodeUrl?: string;
  targetPhone?: string;
  uptime?: number;
  connectedAt?: number;
  lastError?: string;
  latestHandshakeTime?: string;
  isExpired?: boolean;
  licenseExpiresAt?: string | null;
  reconnectRemainingSeconds?: number | null;
  user?: {
    id: string;
    name?: string;
    phone?: string;
  };
}

// Helper: Generate short, fancy, bold & italic WhatsApp-formatted welcome messages
export function buildWelcomeMessage(
  groupSubject: string,
  groupDesc: string | undefined,
  pTags: string[]
): string {
  const tagsStr = pTags.length > 0 ? pTags.join(' ') : '@user';
  const descStr = typeof groupDesc === 'string'
    ? groupDesc
    : (groupDesc && typeof (groupDesc as any).toString === 'function')
    ? (groupDesc as any).toString('utf-8')
    : '';
  const combinedContext = `${groupSubject} ${descStr}`.toLowerCase();

  const isAcademy = /academy|learn|study|school|student|tutor|class|course|training|education|lecture|exam|tutorial/.test(combinedContext);
  const isTech = /dev|code|coding|program|bot|tech|software|python|javascript|web|developer|engineer|builder|hack/.test(combinedContext);
  const isBusiness = /crypto|forex|invest|trade|market|business|store|shop|sales|ecommerce|sell|buy|vendor|merchant/.test(combinedContext);

  if (isAcademy) {
    return `👋 *Welcome* ${tagsStr} to *${groupSubject}*! 🎓\n\n_This group is for serious learners only. Kindly check description & pinned rules._ ✨\n\n— *Admin*`;
  }

  if (isTech) {
    return `👋 *Welcome* ${tagsStr} to *${groupSubject}*! 💻\n\n_Review pinned guidelines & collaborate effectively._ 🚀\n_Keep building!_ ⚙️\n\n— *Admin*`;
  }

  if (isBusiness) {
    return `👋 *Welcome* ${tagsStr} to *${groupSubject}*! 💼\n\n_Verified deals & networking only. Check pinned rules before trading._ 📈\n\n— *Admin*`;
  }

  const cleanDesc = descStr.replace(/\s+/g, ' ').trim();
  if (cleanDesc.length > 10) {
    const briefDesc = cleanDesc.length > 100 ? cleanDesc.slice(0, 100).trim() + '...' : cleanDesc;
    return `👋 *Welcome* ${tagsStr} to *${groupSubject}*! ✨\n\n_${briefDesc}_\n\n_Kindly check description & pinned rules._ 📌\n\n— *Admin*`;
  }

  return `👋 *Welcome* ${tagsStr} to *${groupSubject}*! ✨\n\n_Kindly check group description & pinned rules to get started._ 📌\n\n— *Admin*`;
}

// Helper: Generate short, fancy, bold & italic WhatsApp-formatted goodbye messages
export function buildGoodbyeMessage(
  groupSubject: string,
  groupDesc: string | undefined,
  pTags: string[]
): string {
  const tagsStr = pTags.length > 0 ? pTags.join(' ') : '@user';
  const descStr = typeof groupDesc === 'string'
    ? groupDesc
    : (groupDesc && typeof (groupDesc as any).toString === 'function')
    ? (groupDesc as any).toString('utf-8')
    : '';
  const combinedContext = `${groupSubject} ${descStr}`.toLowerCase();

  const isAcademy = /academy|learn|study|school|student|tutor|class|course|training|education|lecture|exam|tutorial/.test(combinedContext);
  const isTech = /dev|code|coding|program|bot|tech|software|python|javascript|web|developer|engineer|builder|hack/.test(combinedContext);

  if (isAcademy || isTech) {
    return `👋 ${tagsStr} *left* *${groupSubject}*\n\n_We hope you learned something valuable. Keep building!_ 💻`;
  }

  return `👋 ${tagsStr} *left* *${groupSubject}*\n\n_We wish you the very best. Welcome back anytime!_ ✨`;
}

export class WhatsAppManager {
  public readonly userId: string;
  public userEmail: string;
  public readonly sanitizedUserId: string;
  private sock: WASocket | null = null;
  private authDir: string;
  private antiDeleteEnabled = true;
  private notifications: WhatsAppNotification[] = [];
  private mediaCacheDir: string;
  private reconnectingStartedAt: number | null = null;
  public reconnectTimedOut = false;
  private reconnectTimeoutTimer: NodeJS.Timeout | null = null;
  private recoveringMessageIds = new Set<string>();
  private lastDecryptionRepair = new Map<string, number>();
  private messageCache = new Map<string, {
    key: proto.IMessageKey;
    sender: string;
    senderJid?: string;
    senderName?: string;
    text: string;
    rawMessage?: proto.IMessage;
    timestamp: number;
    isGroup: boolean;
    isStatus?: boolean;
    fromMe?: boolean;
    group?: string;
    groupName?: string;
    mediaType?: 'image' | 'video' | 'audio' | 'sticker' | 'document';
    mediaTarget?: any;
    mediaBuffer?: Buffer;
    mediaFilePath?: string;
    mediaPromise?: Promise<Buffer | null>;
    mimetype?: string;
    fileName?: string;
    isGif?: boolean;
    isPtv?: boolean;
    _alreadyRecovered?: boolean;
  }>();
  private activeSpamSession: { remoteJid: string; abort: boolean } | null = null;
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
  private groupMetadataCache = new Map<string, { meta: any; timestamp: number }>();
  private reverseLidMap = new Map<string, string>();
  private currentStatus: WhatsAppStatus = {
    state: 'disconnected',
    isConnected: false,
    pairingStage: 'idle',
  };
  private pairingCodeTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private firebaseSyncTimer: NodeJS.Timeout | null = null;
  private firebaseSyncPromise: Promise<void> | null = null;
  private credentialsSavePromise: Promise<void> = Promise.resolve();
  private firebaseSyncPending = false;
  private firebaseAuthFilesLoaded = false;
  private firebaseAuthFileIds = new Map<string, string>();
  private firebaseAuthFileHashes = new Map<string, string>();
  private lastPersistedBundleHash: string | null = null;
  private isIntentionalClosure = false;
  private connectedAt: number | null = null;
  private initPromise: Promise<WASocket> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isFreshNewPairing = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  public sessionLicenseExpiresAt: string | null = null;
  public sessionLicenseKey: string | null = null;
  public sessionLicensePlan: string | null = null;
  public isSessionUnlimited: boolean = false;
  public lastPruneTime: number = 0;
  private lastAutoReconnectTime = 0;
  private lastFirebaseSyncTime = 0;
  private lastPersistedState = '';
  private lastPersistedIsConnected: boolean | null = null;
  private lastPersistedPhone = '';
  private lastLicenseFirestoreCheckTime = 0;
  private cachedGroups: any[] = [];
  private lastGroupFetchTime = 0;
  private userInteractions = new Map<string, Map<string, { count: number; name?: string }>>();
  private contactNames = new Map<string, string>();
  private groupInviteCodes = new Map<string, string>();
  private userMessageHistory = new Map<string, { key: proto.IMessageKey; text: string; type: string; timestamp: number }[]>();
  private userSpamPurgeState = new Map<string, { detectedAt: number; isPurging: boolean }>();
  private greetingDedupCache = new Map<string, number>();
  private pendingGreetings = new Map<string, { timer: NodeJS.Timeout; participants: Set<string>; action: 'add' | 'remove'; groupId: string }>();
  private mediaCache = new Map<string, string>();
  private consecutive401Count = 0;
  private recentAdminGroupCommands = new Map<string, {
    command: string;
    rawText: string;
    issuedAt: number;
    messageKeyId: string;
    senderJid: string;
    senderNum: string;
  }>();

  private rememberMediaBuffer(key: string, buffer: Buffer, evict: () => void): boolean {
    if (!buffer.length || buffer.length > MAX_PROCESS_MEDIA_CACHE_BYTES) return false;
    this.forgetMediaBuffer(key);
    while (processMediaCacheBytes + buffer.length > MAX_PROCESS_MEDIA_CACHE_BYTES && processMediaCache.size > 0) {
      const oldestGlobalKey = processMediaCache.keys().next().value;
      if (!oldestGlobalKey) break;
      const oldest = processMediaCache.get(oldestGlobalKey);
      processMediaCache.delete(oldestGlobalKey);
      if (oldest) {
        processMediaCacheBytes = Math.max(0, processMediaCacheBytes - oldest.size);
        oldest.evict();
      }
    }
    const globalKey = `${this.userId}\u0000${key}`;
    this.mediaCache.set(key, globalKey);
    processMediaCache.set(globalKey, {
      size: buffer.length,
      evict: () => {
        this.mediaCache.delete(key);
        evict();
      },
    });
    processMediaCacheBytes += buffer.length;
    return true;
  }

  private forgetMediaBuffer(key: string) {
    const globalKey = this.mediaCache.get(key);
    if (!globalKey) return;
    this.mediaCache.delete(key);
    const cached = processMediaCache.get(globalKey);
    if (!cached) return;
    processMediaCache.delete(globalKey);
    processMediaCacheBytes = Math.max(0, processMediaCacheBytes - cached.size);
    cached.evict();
  }

  private deleteCachedMessage(id: string) {
    this.forgetMediaBuffer(`message:${id}`);
    this.messageCache.delete(id);
  }

  private deleteCachedStatus(id: string) {
    this.forgetMediaBuffer(`status:${id}`);
    this.statusCache.delete(id);
  }

  constructor(userId: string = 'default', userEmail: string = '') {
    this.userId = userId || 'default';
    this.userEmail = userEmail || '';
    this.sanitizedUserId = (userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    this.authDir = path.resolve(process.cwd(), '.baileys_auth', `session_${this.sanitizedUserId}`);
    this.mediaCacheDir = path.resolve(process.cwd(), '.media_cache', `session_${this.sanitizedUserId}`);
    this.ensureAuthDir();
    try {
      if (!fs.existsSync(this.mediaCacheDir)) {
        fs.mkdirSync(this.mediaCacheDir, { recursive: true });
      }
    } catch {}
    this.cleanupOldMediaCache();
    this.loadSessionLicense();
    this.loadAntiDeleteSetting();

    this.addNotification({
      type: 'system',
      title: 'SOLVATECH Engine Initialized',
      body: `Baileys WhatsApp service initialized for user account ${this.userEmail || this.userId}.`,
    });

  }

  // 🛡️ Auto-repair Signal sessions when Bad MAC or decryption failures occur
  public async handleDecryptionFailure(remoteJid: string, participantJid?: string | null, msgId?: string | null) {
    const targetJid = participantJid || remoteJid;
    if (!targetJid) return;
    const cacheKey = `${remoteJid}__${targetJid}`;
    const now = Date.now();
    // Throttle repairs to at most once per 6 seconds per peer to avoid excessive disk I/O
    if (now - (this.lastDecryptionRepair.get(cacheKey) || 0) < 6000) {
      return;
    }
    this.lastDecryptionRepair.set(cacheKey, now);

    console.warn(`[Signal Crypto Repair (${this.userId})] Decryption session desynchronization (Bad MAC / CIPHERTEXT) detected for ${targetJid} in ${remoteJid}. Initiating auto-recovery...`);

    try {
      const cleanTargetPhone = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      const filesToPurge: string[] = [];

      if (fs.existsSync(this.authDir)) {
        const allFiles = fs.readdirSync(this.authDir);
        for (const file of allFiles) {
          if (!file.endsWith('.json')) continue;
          // 1. Purge 1-on-1 session files matching target phone or JID
          if (file.startsWith('session-') && cleanTargetPhone && file.includes(cleanTargetPhone)) {
            filesToPurge.push(file);
          }
          // 2. Purge sender-key files for group messages involving this sender
          if (remoteJid.endsWith('@g.us') && file.startsWith('sender-key-')) {
            const cleanGroup = remoteJid.split('@')[0];
            if (file.includes(cleanGroup) && (!cleanTargetPhone || file.includes(cleanTargetPhone))) {
              filesToPurge.push(file);
            }
          }
        }

        for (const f of filesToPurge) {
          try {
            const fullPath = path.join(this.authDir, f);
            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
            }
          } catch {}
        }
      }

      // 3. Clear from in-memory Signal Key Store cache so libsignal does not reuse stale ratchets
      if (this.sock?.authState?.keys) {
        try {
          const keysStore = this.sock.authState.keys as any;
          const clearPayload: any = {};
          if (cleanTargetPhone) {
            clearPayload.session = {
              [`${cleanTargetPhone}.0`]: null,
              [`${cleanTargetPhone}:0`]: null,
              [`${cleanTargetPhone}_1.0`]: null,
            };
            if (remoteJid.endsWith('@g.us')) {
              clearPayload['sender-key'] = {
                [`${remoteJid}::${cleanTargetPhone}::0`]: null,
                [`${remoteJid}::${cleanTargetPhone}:0`]: null,
              };
            }
            await keysStore.set(clearPayload);
          }
        } catch {}
      }

      console.log(`[Signal Crypto Repair (${this.userId})] Auto-recovery complete: cleared ${filesToPurge.length} desynced session/sender keys for ${cleanTargetPhone || targetJid}. Ready for fresh Signal pre-key exchange.`);
    } catch (err: any) {
      console.warn(`[Signal Crypto Repair (${this.userId})] Error during auto-recovery:`, err?.message || err);
    }
  }

  public repairCorruptedSessions(): number {
    let repaired = 0;
    if (!fs.existsSync(this.authDir)) return repaired;
    try {
      const files = fs.readdirSync(this.authDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        if (file === 'creds.json') continue; // Never delete master credentials
        const fullPath = path.join(this.authDir, file);
        try {
          const stats = fs.statSync(fullPath);
          if (stats.size === 0) {
            fs.unlinkSync(fullPath);
            repaired++;
            continue;
          }
          // Validate JSON syntax for session and sender-key files
          if (file.startsWith('session-') || file.startsWith('sender-key-')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const parsed = JSON.parse(content);
            if (!parsed || typeof parsed !== 'object') {
              fs.unlinkSync(fullPath);
              repaired++;
              continue;
            }
            if (file.startsWith('session-') && parsed._sessions && Object.keys(parsed._sessions).length === 0) {
              fs.unlinkSync(fullPath);
              repaired++;
              continue;
            }
          }
        } catch {
          // File is empty or has invalid JSON: delete corrupt file to allow Signal clean renegotiation
          try {
            fs.unlinkSync(fullPath);
            repaired++;
          } catch {}
        }
      }
    } catch {}
    return repaired;
  }

  public pruneStaleSessionFiles(): { prunedKeys: number; prunedMedia: number } {
    let prunedKeys = 0;
    let prunedMedia = 0;
    try {
      // 1. Repair and remove any corrupted 0-byte or invalid JSON session files
      prunedKeys += this.repairCorruptedSessions();

      // 2. Auth directory: strictly preserve creds.json, pre-keys, identity-keys, and sessions
      // NEVER delete pre-key-*.json or identity-key-*.json — doing so causes "Bad MAC" and "Failed to decrypt message" errors!
      if (fs.existsSync(this.authDir)) {
        const files = fs.readdirSync(this.authDir);
        const now = Date.now();
        const maxTransientKeyAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days retention only for transient group memory

        for (const file of files) {
          // Only prune stale group memory keys older than 7 days
          if (file.startsWith('sender-key-memory-')) {
            const fullPath = path.join(this.authDir, file);
            try {
              const stats = fs.statSync(fullPath);
              if (now - stats.mtimeMs > maxTransientKeyAgeMs) {
                fs.unlinkSync(fullPath);
                prunedKeys++;
              }
            } catch {}
          }
        }
      }

      // 2. Prune media cache directory: delete downloaded audio, voice notes, stickers older than 2 hours
      if (fs.existsSync(this.mediaCacheDir)) {
        const files = fs.readdirSync(this.mediaCacheDir);
        const now = Date.now();
        const maxMediaAgeMs = 2 * 60 * 60 * 1000; // 2 hours
        for (const file of files) {
          const fullPath = path.join(this.mediaCacheDir, file);
          try {
            const stats = fs.statSync(fullPath);
            if (now - stats.mtimeMs > maxMediaAgeMs) {
              fs.unlinkSync(fullPath);
              prunedMedia++;
            }
          } catch {}
        }
      }

      // 3. Prune in-memory buffers and maps to prevent memory exhaustion
      if (this.mediaCache.size > 80) {
        this.mediaCache.clear();
      }
      if (this.recentAdminGroupCommands.size > 100) {
        this.recentAdminGroupCommands.clear();
      }
      if (this.userMessageHistory.size > 50) {
        this.userMessageHistory.clear();
      }
      if (this.groupPictureCache.size > 150) {
        this.groupPictureCache.clear();
      }
    } catch (err) {
      console.warn(`[Auto-Prune] Maintenance note for ${this.sanitizedUserId}:`, err);
    }
    return { prunedKeys, prunedMedia };
  }

  private cleanupOldMediaCache() {
    this.pruneStaleSessionFiles();
  }

  public getAntiDeleteEnabled(): boolean {
    return this.antiDeleteEnabled;
  }

  public setAntiDeleteEnabled(val: boolean) {
    this.antiDeleteEnabled = val;
    try {
      if (this.userId && this.userId !== 'default') {
        setDoc(doc(db, 'user_settings', this.userId), { antiDelete: val, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
      }
    } catch {}
  }

  private async loadAntiDeleteSetting() {
    try {
      if (this.userId && this.userId !== 'default') {
        const snap = await getDoc(doc(db, 'user_settings', this.userId));
        if (snap.exists) {
          const d = snap.data();
          if (typeof d?.antiDelete === 'boolean') {
            this.antiDeleteEnabled = d.antiDelete;
          }
        }
      }
    } catch {}
  }

  private saveSessionLicense() {
    try {
      if (!fs.existsSync(this.authDir)) {
        fs.mkdirSync(this.authDir, { recursive: true });
      }
      const licFile = path.join(this.authDir, 'session_license.json');
      fs.writeFileSync(
        licFile,
        JSON.stringify({
          expiresAt: this.sessionLicenseExpiresAt,
          isUnlimited: this.isSessionUnlimited,
          licenseKey: this.sessionLicenseKey,
          licensePlan: this.sessionLicensePlan,
          updatedAt: new Date().toISOString(),
        }),
        'utf-8'
      );
    } catch (e) {
      console.warn('Failed to save session license to disk:', e);
    }
  }

  private loadSessionLicense() {
    try {
      const licFile = path.join(this.authDir, 'session_license.json');
      if (fs.existsSync(licFile)) {
        const raw = fs.readFileSync(licFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.expiresAt) {
          this.sessionLicenseExpiresAt = parsed.expiresAt;
        }
        if (parsed.licenseKey) {
          this.sessionLicenseKey = parsed.licenseKey;
        }
        if (parsed.licensePlan) {
          this.sessionLicensePlan = parsed.licensePlan;
        }
        // If user is owner or explicitly granted unlimited, they are unlimited
        if (this.isOwnerEmail() || parsed.isUnlimited === true) {
          this.isSessionUnlimited = true;
          this.sessionLicenseExpiresAt = null;
        } else if (parsed.expiresAt) {
          this.isSessionUnlimited = false;
          this.sessionLicenseExpiresAt = parsed.expiresAt;
        } else if (typeof parsed.isUnlimited === 'boolean') {
          this.isSessionUnlimited = parsed.isUnlimited;
        }
        console.log('[Baileys Startup] Restored active session license:', {
          expiresAt: this.sessionLicenseExpiresAt,
          isUnlimited: this.isSessionUnlimited,
          licenseKey: this.sessionLicenseKey,
          licensePlan: this.sessionLicensePlan,
        });
      }
    } catch (e) {
      console.warn('Failed to load session license from disk:', e);
    }
  }

  public async syncLicenseFromFirestore(): Promise<boolean> {
    if (isFirestoreQuotaExhausted()) {
      return Boolean(this.sessionLicenseExpiresAt || this.isSessionUnlimited || this.isOwnerEmail());
    }
    const now = Date.now();
    const hasValidLocalLicense =
      this.isOwnerEmail() ||
      this.isSessionUnlimited ||
      Boolean(this.sessionLicenseExpiresAt && new Date(this.sessionLicenseExpiresAt).getTime() > now);

    // 🛡️ Zero-Quota Shield: If license is confirmed valid and unexpired locally, avoid repetitive remote reads
    if (hasValidLocalLicense && now - this.lastLicenseFirestoreCheckTime < 900_000) {
      return true;
    }
    this.lastLicenseFirestoreCheckTime = now;

    try {
      if (this.userId && this.userId !== 'default') {
        let expAt: string | null = null;
        let d: any = null;

        try {
          const snap = await getDoc(doc(db, 'users', this.userId));
          if (snap.exists) {
            d = snap.data();
            if (typeof d?.email === 'string' && d.email.trim()) {
              this.userEmail = d.email.trim();
            }
            if (typeof d?.licenseExpiresAt === 'string') {
              expAt = d.licenseExpiresAt;
            }
            if (typeof d?.licenseKey === 'string' && d.licenseKey.trim()) {
              this.sessionLicenseKey = d.licenseKey.trim();
            } else if (typeof d?.activeKey === 'string' && d.activeKey.trim()) {
              this.sessionLicenseKey = d.activeKey.trim();
            }
            if (typeof d?.licensePlan === 'string' && d.licensePlan.trim()) {
              this.sessionLicensePlan = d.licensePlan.trim();
            } else if (typeof d?.plan === 'string' && d.plan.trim()) {
              this.sessionLicensePlan = d.plan.trim();
            }
          }
        } catch (dbErr) {
          console.debug('User document read note:', dbErr);
        }

        // If still missing key, check user_licenses collection
        if (!this.sessionLicenseKey) {
          try {
            const ulSnap = await getDoc(doc(db, 'user_licenses', this.userId));
            if (ulSnap.exists) {
              const uld = ulSnap.data();
              if (uld?.activeKey) this.sessionLicenseKey = uld.activeKey;
              if (uld?.plan && !this.sessionLicensePlan) this.sessionLicensePlan = uld.plan;
              if (uld?.expiresAt && !expAt) expAt = uld.expiresAt;
            }
          } catch (ulErr) {
            reportFirestoreError(ulErr);
          }
        }

        // Check if there is an active trial in .trial_store.json
        const trialStorePath = path.resolve(process.cwd(), '.trial_store.json');
        if (fs.existsSync(trialStorePath)) {
          try {
            const tStore = JSON.parse(fs.readFileSync(trialStorePath, 'utf-8'));
            const emailKey = this.userEmail ? this.userEmail.toLowerCase().replace(/[^a-z0-9]/g, '_') : '';
            const tRec = (emailKey && tStore[emailKey]) || (this.userId && tStore[this.userId]);
            if (tRec?.expiresAt) {
              const tExpMs = new Date(tRec.expiresAt).getTime();
              const currExpMs = expAt ? new Date(expAt).getTime() : 0;
              if (tExpMs > Date.now() && tExpMs > currExpMs) {
                expAt = tRec.expiresAt;
                if (!this.sessionLicensePlan) this.sessionLicensePlan = '⚡ 30-Minute Free Test (Active)';
              }
            }
          } catch {}
        }

        // Check if there is an active redeemed license in .licenses_store.json
        try {
          const diskLic = findActiveLicenseByUser(this.userId, this.userEmail);
          if (diskLic?.expiresAt) {
            const dExpMs = new Date(diskLic.expiresAt).getTime();
            const currExpMs = expAt ? new Date(expAt).getTime() : 0;
            if (dExpMs > Date.now() && dExpMs > currExpMs) {
              expAt = diskLic.expiresAt;
              if (!this.sessionLicensePlan && diskLic.planName) this.sessionLicensePlan = diskLic.planName;
              if (!this.sessionLicenseKey && diskLic.key) this.sessionLicenseKey = diskLic.key;
            }
          }
        } catch {}

        // Preserve current active session license if incoming expAt is null or older
        if (this.sessionLicenseExpiresAt) {
          const sExpMs = new Date(this.sessionLicenseExpiresAt).getTime();
          const newExpMs = expAt ? new Date(expAt).getTime() : 0;
          if (sExpMs > Date.now() && sExpMs > newExpMs) {
            expAt = this.sessionLicenseExpiresAt;
          }
        }

        const isUnlim = this.isOwnerEmail() || Boolean(d?.isUnlimited) || d?.licenseStatus === 'unlimited' || Boolean(d?.licensePlan?.includes('Unlimited')) || this.isSessionUnlimited;
        this.setSessionLicense(isUnlim ? null : expAt, isUnlim);
        console.log(`[License Sync (${this.userId})] Synced: expiresAt=${this.sessionLicenseExpiresAt}, key=${this.sessionLicenseKey}, plan=${this.sessionLicensePlan}`);
        return true;
      }
    } catch (err: any) {
      reportFirestoreError(err);
      console.debug(`Firestore license sync note for ${this.userId}:`, err?.message || err);
      if (this.sessionLicenseExpiresAt || this.isSessionUnlimited || this.isOwnerEmail()) {
        return true;
      }
    }
    return Boolean(this.sessionLicenseExpiresAt || this.isSessionUnlimited || this.isOwnerEmail());
  }

  public isOwnerEmail(): boolean {
    const email = (this.userEmail || '').trim().toLowerCase();
    return isOwnerEmail(email);
  }

  public getLicenseDetails(): { expiresAt: string | null; isUnlimited: boolean; licenseKey?: string | null; licensePlan?: string | null } {
    return {
      expiresAt: this.sessionLicenseExpiresAt,
      isUnlimited: this.isSessionUnlimited,
      licenseKey: this.sessionLicenseKey,
      licensePlan: this.sessionLicensePlan,
    };
  }

  public setSessionLicense(expiresAt: string | null, isUnlimited: boolean) {
    const unlim = this.isOwnerEmail() || Boolean(isUnlimited);
    this.isSessionUnlimited = unlim;
    this.sessionLicenseExpiresAt = unlim ? null : expiresAt;
    this.saveSessionLicense();
    // If user was previously expired and now has valid license, wake up connection immediately
    if (!this.isLicenseExpired() && !this.sock && !this.isConnecting) {
      const credsFile = path.join(this.authDir, 'creds.json');
      if (fs.existsSync(credsFile)) {
        console.log(`[License Sync (${this.userId})] Valid license detected! Resuming WhatsApp connection 24/7...`);
        this.initSocket().catch((err) => console.warn('Wakeup connection note:', err));
      }
    }
  }

  public isLicenseExpired(): boolean {
    if (this.isOwnerEmail() || this.isSessionUnlimited) return false;
    // Strict countdown down to the exact millisecond and minute!
    if (this.sessionLicenseExpiresAt) {
      const expMs = new Date(this.sessionLicenseExpiresAt).getTime();
      if (!isNaN(expMs)) {
        return Date.now() >= expMs;
      }
    }
    // Unlicensed non-owner/non-unlimited accounts cannot run bot
    return true;
  }

  // Gracefully pause socket without wiping credentials (preserves pairing for life)
  public async pauseSocket(reason = 'License expired or paused'): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isIntentionalClosure = true;
    try {
      if (this.sock) {
        try {
          (this.sock as any)._isIntentionalClose = true;
          this.sock.end(undefined);
        } catch {}
        this.sock = null;
      }
    } catch {}

    this.isConnecting = false;
    this.connectedAt = null;
    const isExpired = this.isLicenseExpired();
    this.currentStatus.isConnected = false;
    this.currentStatus.state = isExpired ? 'expired' : 'disconnected';
    this.currentStatus.pairingStage = isExpired ? 'expired' : (this.currentStatus.isPaired ? 'connected' : 'idle');
    this.currentStatus.pairingCode = undefined;
    await this.syncConnectionStatusToFirestore();
    console.log(`[Session ${this.userId}] WhatsApp socket paused (${reason}). Companion pairing credentials strictly preserved on disk & Firebase.`);
  }

  public dispose(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.pairingCodeTimer) clearTimeout(this.pairingCodeTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.firebaseSyncTimer) clearTimeout(this.firebaseSyncTimer);
    this.heartbeatInterval = null;
    this.pairingCodeTimer = null;
    this.reconnectTimer = null;
    this.firebaseSyncTimer = null;
    if (this.activeSpamSession) this.activeSpamSession.abort = true;
    for (const pending of this.pendingGreetings.values()) clearTimeout(pending.timer);
    this.pendingGreetings.clear();
    for (const key of Array.from(this.mediaCache.keys())) this.forgetMediaBuffer(key);
    this.messageCache.clear();
    this.statusCache.clear();
    this.viewOnceCache.clear();
    this.lastViewOnceByChat.clear();
    this.groupMetaCache.clear();
    this.groupSubjectCache.clear();
    this.groupPictureCache.clear();
    this.groupInviteCodes.clear();
    this.reverseLidMap.clear();
    this.contactNames.clear();
    this.userInteractions.clear();
    this.userMessageHistory.clear();
    this.userSpamPurgeState.clear();
    this.greetingDedupCache.clear();
    commandHandler.releaseAccountSecuritySettings(this.userId);
  }

  private async syncConnectionStatusToFirestore(): Promise<void> {
    if (!this.userId || this.userId === 'default') return;
    if (isFirestoreQuotaExhausted()) return;
    const isConn = Boolean(this.sock && this.currentStatus.isConnected);
    const state = this.currentStatus.state;
    const linkedPhone = this.currentStatus.user?.phone || this.currentStatus.targetPhone || null;
    const phoneStr = linkedPhone || '';

    // Zero-Quota Deduplication: If status, connection state, and phone have not changed, do NOT write to Firestore!
    if (
      this.lastPersistedIsConnected === isConn &&
      this.lastPersistedState === state &&
      this.lastPersistedPhone === phoneStr
    ) {
      return;
    }

    try {
      await setDoc(
        doc(db, 'users', this.userId),
        {
          whatsappConnected: isConn,
          botConnected: isConn,
          connectionState: state,
          ...(linkedPhone ? { linkedPhone } : {}),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      this.lastPersistedIsConnected = isConn;
      this.lastPersistedState = state;
      this.lastPersistedPhone = phoneStr;
    } catch (err) {
      reportFirestoreError(err);
      console.warn(`[WhatsApp Status] Could not persist connection state for ${this.userId}:`, err);
    }
  }

  // 24/7 Active Heartbeat & Self-Healing Connection Watchdog
  private start247Heartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    // High-precision audit every 5 seconds: strictly enforce expiration down to the exact minute
    this.heartbeatInterval = setInterval(async () => {
      // 1. Strict automatic pause the instant license expires
      if (this.isLicenseExpired()) {
        if (this.sock || this.currentStatus.isConnected) {
          console.log(`[License Watchdog] License for user ${this.userId} has expired down to the minute! Pausing bot (credentials preserved)...`);
          await this.pauseSocket('License Expired');
          this.addNotification({
            type: 'system',
            title: '⚠️ License Expired — Bot Paused',
            body: 'Your active license period has ended. The bot has been paused. Enter a new key on the website to resume 24/7 connection instantly.',
          });
          try {
            if (this.userId && this.userId !== 'default' && !isFirestoreQuotaExhausted()) {
              await setDoc(doc(db, 'users', this.userId), {
                whatsappConnected: false,
                botConnected: false,
                licenseStatus: 'expired',
                updatedAt: new Date().toISOString(),
              }, { merge: true });
            }
          } catch (err) {
            reportFirestoreError(err);
          }
        }
        return;
      }

      if (this.isIntentionalClosure || this.reconnectTimedOut) return;

      const credsFile = path.join(this.authDir, 'creds.json');
      const hasCreds = fs.existsSync(credsFile);

      // Passive socket check: if socket is live, verify connection is healthy
      if (this.sock && (this.currentStatus.isConnected || (this.sock as any)?.ws?.readyState === 1 || (this.sock as any)?.user?.id)) {
        // Socket is open and functioning normally - NEVER reconnect connected users!
        this.currentStatus.isConnected = true;
        this.currentStatus.state = 'connected';
      } else if (hasCreds && !this.isConnecting && !this.sock && this.currentStatus.state !== 'awaiting_pairing') {
        // Disconnected but has valid paired credentials and unexpired license: attempt single reconnect pass (cooldown 3 mins)
        const now = Date.now();
        if (now - this.lastAutoReconnectTime > 180000) {
          this.lastAutoReconnectTime = now;
          this.reconnectSocketSafely();
        }
      }
    }, 5000);
  }

  private reconnectSocketSafely() {
    if (
      this.isIntentionalClosure ||
      this.reconnectTimedOut ||
      this.isLicenseExpired() ||
      this.isConnecting ||
      this.initPromise ||
      this.reconnectTimer ||
      this.currentStatus.isConnected ||
      this.sock
    ) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isIntentionalClosure || this.isLicenseExpired() || this.currentStatus.isConnected || this.sock) return;
      console.log(`[24/7 Watchdog] Reconnecting disconnected bot once for ${this.userId}...`);
      this.initSocket().catch((err) => {
        console.warn(`[24/7 Watchdog] Auto-reconnect note for ${this.userId}:`, err?.message);
      });
    }, 1500);
  }

  // Anti-Delete Recovery Handler: Recovers deleted text and media and delivers directly to personal WhatsApp DM
  private async handleMessageRevoke(revokedKey: proto.IMessageKey, revokerNum?: string) {
    if (!this.sock || !revokedKey?.id) return;
    if (!this.antiDeleteEnabled) return;

    // 1. STRICT FILTER: Never process WhatsApp Status updates / broadcasts as deleted messages
    const revokedRemote = revokedKey.remoteJid || '';
    if (revokedRemote === 'status@broadcast' || revokedRemote.includes('status')) {
      return;
    }

    // 2. STRICT FILTER: Only send *others* deleted messages (never send messages deleted by self / bot owner)
    if (revokedKey.fromMe) {
      return;
    }

    const msgId = revokedKey.id;
    let cached = this.messageCache.get(msgId);
    if (!cached) {
      for (const [k, v] of this.messageCache.entries()) {
        if (k.endsWith(msgId) || msgId.endsWith(k)) {
          cached = v;
          break;
        }
      }
    }
    if (!cached) {
      console.log(`[Anti-Delete] Revoked message ${msgId} not found in local cache.`);
      return;
    }

    // Double-check cached properties: ignore status stories and self-messages
    if (
      cached.isStatus ||
      cached.fromMe ||
      cached.group === 'status@broadcast' ||
      cached.key?.remoteJid === 'status@broadcast' ||
      cached.key?.fromMe
    ) {
      return;
    }

    // Identify target DM JID: the connected WhatsApp account (Message yourself)
    const myRawJid = this.sock.user?.id || (this.sock as any).authState?.creds?.me?.id || this.currentStatus.user?.id || '';
    const myNormalizedJid = myRawJid ? jidNormalizedUser(myRawJid) : '';
    const myPhone = myNormalizedJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    const ownerPhone = (this.currentStatus.user?.phone || this.currentStatus.targetPhone || '').replace(/\D/g, '');

    // Skip if original message was sent by self/bot owner (only recover other people's deleted messages)
    if (cached.sender && (cached.sender === myPhone || (ownerPhone && cached.sender === ownerPhone))) {
      return;
    }

    if (this.recoveringMessageIds.has(msgId) || cached._alreadyRecovered) return;
    this.recoveringMessageIds.add(msgId);
    cached._alreadyRecovered = true;
    setTimeout(() => {
      this.recoveringMessageIds.delete(msgId);
    }, 60000);

    const targetOwnerJid = myNormalizedJid || (ownerPhone ? `${ownerPhone}@s.whatsapp.net` : '');

    if (!targetOwnerJid) {
      console.warn('[Anti-Delete] Could not determine owner personal DM JID');
      return;
    }

    const chatTitle = cached.isGroup
      ? (cached.groupName || this.groupSubjectCache.get(cached.group || '') || 'Group Chat')
      : 'Private 1-on-1 Chat';
    const sentTimeStr = new Date(cached.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const deleteTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let alertText = `🚨 *[SOLVATECH ANTI-DELETE RECOVERY]* 🚨\n`;
    alertText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    alertText += `👤 *Sender:* ${cached.senderName ? `${cached.senderName} ` : ''}(+${cached.sender})\n`;
    if (revokerNum && revokerNum !== cached.sender) {
      alertText += `🗑️ *Deleted By:* +${revokerNum}\n`;
    }
    alertText += `📍 *Chat:* ${chatTitle}\n`;
    alertText += `⏰ *Sent Time:* ${sentTimeStr}\n`;
    alertText += `⏱️ *Deleted Time:* ${deleteTimeStr}\n`;
    if (cached.mediaType) {
      alertText += `📦 *Media Type:* ${cached.mediaType.toUpperCase()}\n`;
    }
    if (cached.text) {
      alertText += `💬 *Deleted Message:*\n"${cached.text}"\n`;
    }
    alertText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    alertText += `> 🛡️ _Recovered to Personal DM by SOLVATECH_`;

    this.addNotification({
      type: 'system',
      title: '🛡️ Deleted Message Recovered to DM!',
      body: `From +${cached.sender} in ${chatTitle}: "${cached.text || cached.mediaType || 'Media'}"`,
      sender: `+${cached.sender}`,
    });

    // 1. Resolve media buffer with robust multi-tier fallback:
    // Memory RAM -> Disk Cache -> Active Download Promise -> On-Demand Fetch
    let recoveredMediaBuffer: Buffer | undefined = cached.mediaBuffer;

    // Check disk storage if evicted from RAM
    if ((!recoveredMediaBuffer || recoveredMediaBuffer.length === 0) && cached.mediaFilePath && fs.existsSync(cached.mediaFilePath)) {
      try {
        recoveredMediaBuffer = fs.readFileSync(cached.mediaFilePath);
      } catch (err) {
        console.warn(`[Anti-Delete] Error reading media file from disk (${cached.mediaFilePath}):`, err);
      }
    }

    // Check in-flight background download promise (crucial for rapid deletes within seconds of sending)
    if ((!recoveredMediaBuffer || recoveredMediaBuffer.length === 0) && cached.mediaPromise) {
      try {
        const promisedBuf = await Promise.race([
          cached.mediaPromise,
          new Promise<null>((res) => setTimeout(() => res(null), 12000)),
        ]);
        if (promisedBuf && promisedBuf.length > 0) {
          recoveredMediaBuffer = promisedBuf;
        }
      } catch (err) {
        console.warn(`[Anti-Delete] Error waiting for media download promise:`, err);
      }
    }

    // Check on-demand download if media target exists and still no buffer
    if ((!recoveredMediaBuffer || recoveredMediaBuffer.length === 0) && cached.mediaTarget && cached.mediaType) {
      try {
        console.log(`[Anti-Delete] Fetching revoked media on-demand for msg ${msgId}...`);
        const rawBuf = await downloadMediaBufferWithRetry(cached.mediaTarget, cached.mediaType, 2);
        if (rawBuf && rawBuf.length > 0) {
          if (cached.mediaType === 'video') {
            const sanitized = await sanitizeVideoForWhatsApp(rawBuf);
            recoveredMediaBuffer = sanitized.buffer;
          } else if (cached.mediaType === 'image') {
            const sanitized = await sanitizeImageForWhatsApp(rawBuf);
            recoveredMediaBuffer = sanitized.buffer;
          } else {
            recoveredMediaBuffer = rawBuf;
          }
          if (cached.mediaFilePath) {
            try {
              fs.writeFileSync(cached.mediaFilePath, recoveredMediaBuffer);
            } catch {}
          }
        }
      } catch (fetchErr) {
        console.warn(`[Anti-Delete] On-demand download failed for msg ${msgId}:`, fetchErr);
      }
    }

    // Ensure caption does not exceed WhatsApp's 1024 character limit for media
    let mediaCaption = alertText;
    let followUpText: string | null = null;
    if (mediaCaption.length > 950) {
      mediaCaption = alertText.slice(0, 900) + '\n...\n_(Full deleted message continued below)_';
      followUpText = `💬 *Full Deleted Message Content:*\n${cached.text}`;
    }

    // 2. Deliver recovered message & media to owner DM
    try {
      if (recoveredMediaBuffer && recoveredMediaBuffer.length > 0 && cached.mediaType) {
        if (cached.mediaType === 'image') {
          let imageToSend = recoveredMediaBuffer;
          try {
            const sanitized = await sanitizeImageForWhatsApp(recoveredMediaBuffer);
            imageToSend = sanitized.buffer;
          } catch {}

          try {
            await this.sock.sendMessage(targetOwnerJid, {
              image: imageToSend,
              caption: mediaCaption,
              mimetype: 'image/jpeg',
            });
          } catch (imgSendErr) {
            console.warn('[Anti-Delete] Standard image send failed, delivering as document:', imgSendErr);
            await this.sock.sendMessage(targetOwnerJid, {
              document: imageToSend,
              mimetype: 'image/jpeg',
              fileName: `recovered_image_${Date.now()}.jpg`,
              caption: mediaCaption,
            });
          }
        } else if (cached.mediaType === 'video') {
          // Double-check video validity with FFmpeg (+faststart, H.264 Baseline, AAC)
          let videoToSend = recoveredMediaBuffer;
          try {
            const sanitized = await sanitizeVideoForWhatsApp(recoveredMediaBuffer);
            videoToSend = sanitized.buffer;
          } catch {}

          try {
            await this.sock.sendMessage(targetOwnerJid, {
              video: videoToSend,
              mimetype: 'video/mp4',
              caption: mediaCaption,
              gifPlayback: Boolean(cached.isGif),
              ptv: Boolean(cached.isPtv),
            });
          } catch (vidSendErr) {
            console.warn('[Anti-Delete] Standard video send failed, delivering as document:', vidSendErr);
            await this.sock.sendMessage(targetOwnerJid, {
              document: videoToSend,
              mimetype: 'video/mp4',
              fileName: `recovered_video_${Date.now()}.mp4`,
              caption: mediaCaption,
            });
          }
        } else if (cached.mediaType === 'audio') {
          await this.sock.sendMessage(targetOwnerJid, { text: alertText });
          await this.sock.sendMessage(targetOwnerJid, {
            audio: recoveredMediaBuffer,
            mimetype: cached.mimetype || 'audio/ogg; codecs=opus',
            ptt: true,
          });
        } else if (cached.mediaType === 'sticker') {
          await this.sock.sendMessage(targetOwnerJid, { text: alertText });
          await this.sock.sendMessage(targetOwnerJid, {
            sticker: recoveredMediaBuffer,
          });
        } else if (cached.mediaType === 'document') {
          await this.sock.sendMessage(targetOwnerJid, {
            document: recoveredMediaBuffer,
            mimetype: cached.mimetype || 'application/octet-stream',
            fileName: cached.fileName || 'recovered_file',
            caption: mediaCaption,
          });
        } else {
          await this.sock.sendMessage(targetOwnerJid, { text: alertText });
        }

        if (followUpText) {
          await this.sock.sendMessage(targetOwnerJid, { text: followUpText }).catch(() => {});
        }
      } else {
        await this.sock.sendMessage(targetOwnerJid, { text: alertText });
      }
      console.log(`[Anti-Delete] Successfully forwarded recovered message from +${cached.sender} to owner DM (${targetOwnerJid})`);
    } catch (err) {
      console.error('[Anti-Delete] Error sending recovered message to personal DM:', err);
    }
  }

  public setRestoredPhone(phone: string) {
    if (!phone) return;
    const cleanP = phone.replace(/\D/g, '');
    this.currentStatus.targetPhone = cleanP;
    this.currentStatus.isPaired = true;
    this.currentStatus.user = {
      id: `${cleanP}@s.whatsapp.net`,
      name: 'SOLVATECH Linked Phone',
      phone: phone.startsWith('+') ? phone : `+${cleanP}`,
    };
    this.currentStatus.pairingStage = 'connected';
    this.currentStatus.state = 'connecting';
  }

  public isSocketActive(): boolean {
    return Boolean(this.sock || this.isConnecting);
  }

  public hasRegisteredCredentials(): boolean {
    const credsFile = path.join(this.authDir, 'creds.json');
    if (!fs.existsSync(credsFile)) return false;
    try {
      const raw = fs.readFileSync(credsFile, 'utf-8');
      const creds = JSON.parse(raw);
      return Boolean(creds?.registered === true && (creds?.me?.id || (creds as any)?.account?.details));
    } catch {
      return false;
    }
  }

  public getStatus(): WhatsAppStatus {
    const credsFile = path.join(this.authDir, 'creds.json');
    let hasLocalCreds = false;
    let registeredPhone = '';
    let registeredUserJid = '';
    let registeredName = '';

    if (fs.existsSync(credsFile)) {
      try {
        const raw = fs.readFileSync(credsFile, 'utf-8');
        const creds = JSON.parse(raw);
        if (creds.registered && (creds.me?.id || (creds as any).account?.details)) {
          hasLocalCreds = true;
          registeredUserJid = creds.me?.id || '';
          registeredPhone = registeredUserJid
            ? (registeredUserJid.split(':')[0] || registeredUserJid.split('@')[0])
            : this.currentStatus.targetPhone?.replace(/\D/g, '') || '';
          registeredName = creds.me?.name || 'SOLVATECH Linked Phone';
        }
      } catch {}
    }

    // A phone is genuinely paired ONLY if registered companion credentials exist on disk or live connection confirms it
    const isPaired = hasLocalCreds || Boolean(this.currentStatus.isConnected && this.currentStatus.user?.phone);
    this.currentStatus.isPaired = isPaired;
    if (registeredPhone) {
      this.currentStatus.user = {
        id: registeredUserJid || `${registeredPhone}@s.whatsapp.net`,
        name: registeredName,
        phone: `+${registeredPhone}`,
      };
    } else if (!isPaired && !this.currentStatus.isConnected) {
      this.currentStatus.user = undefined;
    }

    // Re-check trial store if session license is currently expired or uninitialized
    if (this.isLicenseExpired()) {
      const trialStorePath = path.resolve(process.cwd(), '.trial_store.json');
      if (fs.existsSync(trialStorePath)) {
        try {
          const tStore = JSON.parse(fs.readFileSync(trialStorePath, 'utf-8'));
          const emailKey = this.userEmail ? this.userEmail.toLowerCase().replace(/[^a-z0-9]/g, '_') : '';
          const tRec = (emailKey && tStore[emailKey]) || (this.userId && tStore[this.userId]);
          if (tRec?.expiresAt && new Date(tRec.expiresAt).getTime() > Date.now()) {
            this.setSessionLicense(tRec.expiresAt, false);
            if (!this.sessionLicensePlan) this.sessionLicensePlan = '⚡ 30-Minute Free Test (Active)';
          }
        } catch {}
      }
    }

    const isExpired = this.isLicenseExpired();
    this.currentStatus.isExpired = isExpired;
    this.currentStatus.licenseExpiresAt = this.sessionLicenseExpiresAt;

    if (isExpired) {
      this.currentStatus.isConnected = false;
      this.currentStatus.state = 'expired';
      this.currentStatus.pairingStage = 'expired';
      this.currentStatus.pairingCode = undefined;
      // If socket is running while expired, pause it immediately
      if (this.sock) {
        this.pauseSocket('License Expired').catch(() => {});
      }
      return this.currentStatus;
    }

    // User is NOT expired: Check genuine live Baileys socket state
    const isLiveConnected = Boolean(
      this.sock &&
      (this.currentStatus.isConnected ||
       (this.sock as any)?.user?.id ||
       (this.sock as any)?.ws?.readyState === 1)
    );
    if (isLiveConnected) {
      this.reconnectingStartedAt = null;
      this.currentStatus.isConnected = true;
      this.currentStatus.state = 'connected';
      this.currentStatus.pairingStage = 'connected';
      this.currentStatus.isPaired = true;
      this.currentStatus.pairingCode = undefined;
      this.currentStatus.qrCodeUrl = undefined;
      this.currentStatus.lastError = undefined;
      this.currentStatus.reconnectRemainingSeconds = undefined;
      if (!this.connectedAt) {
        this.connectedAt = Date.now();
      }
      this.currentStatus.connectedAt = this.connectedAt;
    } else if (hasLocalCreds) {
      this.currentStatus.isPaired = true;
      this.currentStatus.pairingStage = 'connected';
      this.currentStatus.pairingCode = undefined;
      this.currentStatus.qrCodeUrl = undefined;
      this.currentStatus.reconnectRemainingSeconds = undefined;

      if (this.isIntentionalClosure) {
        this.currentStatus.isConnected = false;
        this.currentStatus.state = 'disconnected';
      } else if (this.isConnecting) {
        this.currentStatus.isConnected = false;
        this.currentStatus.state = 'connecting';
      } else {
        // Paired credentials exist: report stable paired state without mutating or killing sockets
        this.currentStatus.isConnected = false;
        this.currentStatus.state = 'disconnected';
      }
    } else if (!this.isConnecting && this.currentStatus.state !== 'awaiting_pairing') {
      this.reconnectingStartedAt = null;
      this.currentStatus.isConnected = false;
      this.currentStatus.state = 'disconnected';
      this.currentStatus.reconnectRemainingSeconds = undefined;
      if (!isPaired) {
        this.currentStatus.pairingStage = 'idle';
        this.currentStatus.user = undefined;
        this.connectedAt = null;
        this.currentStatus.connectedAt = undefined;
      } else {
        this.currentStatus.pairingStage = 'connected';
      }
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
      setBoundedCache(this.contactNames, cleanPeer, peerName, 2000);
    }
    if (!this.userInteractions.has(cleanUser)) {
      setBoundedCache(this.userInteractions, cleanUser, new Map(), 100);
    }
    const map = this.userInteractions.get(cleanUser)!;
    const current = map.get(cleanPeer) || { count: 0, name: this.contactNames.get(cleanPeer) };
    setBoundedCache(
      map,
      cleanPeer,
      { count: current.count + 1, name: peerName || current.name || this.contactNames.get(cleanPeer) },
      500
    );
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
    setBoundedCache(this.groupInviteCodes, groupJid, code, 1000);
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

  // High-Speed In-Memory Group Metadata Cache (eliminates repeated slow network roundtrips)
  private groupMetaCache = new Map<string, { meta: any; timestamp: number }>();

  public async getCachedGroupMetadata(sock: any, gid: string, force = false): Promise<any> {
    const now = Date.now();
    const cached = this.groupMetaCache.get(gid);
    if (!force && cached && now - cached.timestamp < 60000) {
      return cached.meta;
    }
    try {
      const meta = await sock.groupMetadata(gid);
      if (meta) {
        setBoundedCache(this.groupMetaCache, gid, { meta, timestamp: now }, 250);
        if (Array.isArray(meta.participants)) {
          for (const p of meta.participants) {
            if (p.id && p.lid) {
              const cleanP = p.id.split('@')[0].split(':')[0].replace(/\D/g, '');
              const cleanL = p.lid.split('@')[0].split(':')[0].replace(/\D/g, '');
              if (cleanP && cleanL) {
                setBoundedCache(this.reverseLidMap, cleanL, cleanP, 2000);
              }
            }
          }
        }
      }
      return meta;
    } catch (err) {
      if (cached) return cached.meta;
      throw err;
    }
  }

  public invalidateGroupMetaCache(gid: string) {
    this.groupMetaCache.delete(gid);
  }

  private ensureAuthDir() {
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
  }

  public async resolveUserEmail(): Promise<string> {
    if (this.userEmail && this.userEmail.includes('@')) {
      return this.userEmail.toLowerCase().trim();
    }
    if (this.userId && this.userId !== 'default' && !isFirestoreQuotaExhausted()) {
      try {
        const uSnap = await getDoc(doc(db, 'users', this.userId));
        if (uSnap.exists) {
          const uData = uSnap.data();
          if (typeof uData?.email === 'string' && uData.email.includes('@')) {
            this.userEmail = uData.email.toLowerCase().trim();
            return this.userEmail;
          }
        }
      } catch {}
    }
    return (this.userEmail || '').toLowerCase().trim();
  }

  private restorePromise: Promise<boolean> | null = null;

  public async ensureRestored(): Promise<boolean> {
    if (this.hasRegisteredCredentials()) {
      return true;
    }
    if (!this.restorePromise) {
      this.restorePromise = this.restoreAuthFromFirebaseIfMissing();
    }
    const res = await this.restorePromise;
    this.restorePromise = null;
    return res;
  }

  // Restore session credentials from Firebase Firestore 'column' collection
  private async restoreAuthFromFirebaseIfMissing(): Promise<boolean> {
    try {
      this.ensureAuthDir();
      const credsPath = path.join(this.authDir, 'creds.json');
      if (this.hasRegisteredCredentials()) {
        try {
          const raw = fs.readFileSync(credsPath, 'utf-8');
          const creds = JSON.parse(raw);
          if (creds.registered && (creds.me?.id || (creds as any).account?.details)) {
            const registeredUserJid = creds.me?.id || '';
            const registeredPhone = registeredUserJid
              ? (registeredUserJid.split(':')[0] || registeredUserJid.split('@')[0])
              : this.currentStatus.targetPhone?.replace(/\D/g, '') || '';
            this.currentStatus.isPaired = true;
            this.currentStatus.user = {
              id: registeredUserJid || `${registeredPhone}@s.whatsapp.net`,
              name: creds.me?.name || 'SOLVATECH Linked Phone',
              phone: `+${registeredPhone}`,
            };
            this.currentStatus.pairingStage = 'connected';
            await this.syncLicenseFromFirestore();
          }
        } catch {}
        return true;
      }

      let restoredAny = false;
      const sessionDocId = `session_${this.sanitizedUserId}`;
      const cleanEmail = await this.resolveUserEmail();

      if (!isFirestoreQuotaExhausted()) {
        // Priority 1: Check Firebase Firestore collection 'column' (User email, phone, and 3 keys)
        try {
          let colSnap: any = null;
          // Step 1: Check document keyed by user email
          if (cleanEmail) {
            colSnap = await getDoc(doc(db, 'column', cleanEmail));
          }
          // Step 2: Check document keyed by sessionDocId
          if (!colSnap || !colSnap.exists) {
            colSnap = await getDoc(doc(db, 'column', sessionDocId));
          }
          // Step 3: Default fallback
          if ((!colSnap || !colSnap.exists) && this.sanitizedUserId === 'default') {
            colSnap = await getDoc(doc(db, 'column', 'default'));
          }

          if (colSnap && colSnap.exists) {
            const data = colSnap.data();

            // If user unlinked to pair a new number, phoneNumber and creds were cleared (only email remains)
            if (data?.unlinked === true || (!data?.phoneNumber && !data?.credsData)) {
              console.log(`[WhatsApp Auth (${this.userId})] 'column' shows user unlinked/cleared for new pairing.`);
              return false;
            }

            // Restore credsData (master credential key)
            if (data?.credsData && typeof data.credsData === 'string' && !fs.existsSync(credsPath)) {
              fs.writeFileSync(credsPath, data.credsData, 'utf-8');
              console.log(`[WhatsApp Auth (${this.userId})] Restored credentials from Firebase 'column' (${cleanEmail || sessionDocId})!`);
              restoredAny = true;
            }

            // Restore companion session persistence keys (rawSessionData)
            let sessionFiles: Record<string, string> | null = null;
            if (data?.rawSessionData && typeof data.rawSessionData === 'string') {
              try {
                sessionFiles = JSON.parse(data.rawSessionData);
              } catch {}
            } else if (data?.files && typeof data.files === 'object') {
              sessionFiles = data.files;
            }

            if (sessionFiles && Object.keys(sessionFiles).length > 0) {
              for (const [filename, content] of Object.entries(sessionFiles)) {
                const filePath = path.join(this.authDir, filename);
                if (!fs.existsSync(filePath) && isSafeAuthFileName(filename)) {
                  fs.writeFileSync(filePath, content, 'utf-8');
                  restoredAny = true;
                }
              }
            }

            if (data?.phoneNumber) {
              this.currentStatus.targetPhone = data.phoneNumber;
            }

            if (typeof data?.sha256 === 'string') {
              this.lastPersistedBundleHash = data.sha256;
            }
          }
        } catch (err: any) {
          reportFirestoreError(err);
          console.warn(`[WhatsApp Auth (${this.userId})] Firebase 'column' restore note:`, err?.message || err);
        }

        // Priority 2: Fallback check on legacy whatsapp_sessions and automatically migrate to 'column'
        if (!restoredAny) {
          try {
            let fullSnap: any = await getDoc(doc(db, 'whatsapp_sessions', sessionDocId));
            if (!fullSnap.exists && this.sanitizedUserId === 'default') {
              fullSnap = await getDoc(doc(db, 'whatsapp_sessions', 'current_session'));
            }

            if (fullSnap && fullSnap.exists) {
              const data = fullSnap.data();
              if (data?.credsData && typeof data.credsData === 'string' && !fs.existsSync(credsPath)) {
                fs.writeFileSync(credsPath, data.credsData, 'utf-8');
                restoredAny = true;
              }

              let sessionFiles: Record<string, string> | null = null;
              if (data?.rawSessionData && typeof data.rawSessionData === 'string') {
                try { sessionFiles = JSON.parse(data.rawSessionData); } catch {}
              }
              if (sessionFiles) {
                for (const [filename, content] of Object.entries(sessionFiles)) {
                  const filePath = path.join(this.authDir, filename);
                  if (!fs.existsSync(filePath) && isSafeAuthFileName(filename)) {
                    fs.writeFileSync(filePath, content, 'utf-8');
                    restoredAny = true;
                  }
                }
              }
              // Immediately write to 'column' so legacy is fully migrated
              if (restoredAny) {
                this.scheduleFirebaseCredsSync(true);
              }
            }
          } catch (err: any) {
            reportFirestoreError(err);
          }
        }
      }

      if (restoredAny && fs.existsSync(credsPath)) {
        try {
          const raw = fs.readFileSync(credsPath, 'utf-8');
          const creds = JSON.parse(raw);
          if (creds.registered && (creds.me?.id || (creds as any).account?.details)) {
            const registeredUserJid = creds.me?.id || '';
            const registeredPhone = registeredUserJid
              ? (registeredUserJid.split(':')[0] || registeredUserJid.split('@')[0])
              : this.currentStatus.targetPhone?.replace(/\D/g, '') || '';
            this.currentStatus.isPaired = true;
            this.currentStatus.user = {
              id: registeredUserJid || `${registeredPhone}@s.whatsapp.net`,
              name: creds.me?.name || 'SOLVATECH Linked Phone',
              phone: `+${registeredPhone}`,
            };
            this.currentStatus.pairingStage = 'connected';
            console.log(`[WhatsApp Auth (${this.userId})] Registered linked companion from 'column': +${registeredPhone}`);
          }
        } catch {}

        this.scheduleFirebaseCredsSync();
        const licenseVerified = await this.syncLicenseFromFirestore();
        if (licenseVerified && !this.isLicenseExpired() && !this.sock && !this.isConnecting) {
          console.log(`[WhatsApp Auth (${this.userId})] Valid license detected! Resuming WhatsApp connection in background...`);
          this.initSocket().catch((err) => console.warn('Auto-reconnect note after restore:', err));
        }
        return true;
      }
      return false;
    } catch (e) {
      console.warn(`[WhatsApp Auth (${this.userId})] Firebase creds check note:`, e);
      return false;
    }
  }

  // Persist session credentials to Firebase Firestore collection 'column'
  // Stores user with their email, phone number, and 3 keys (creds, persistence keys, version key)
  private scheduleFirebaseCredsSync(immediate = false) {
    if (isFirestoreQuotaExhausted()) return;
    if (this.firebaseSyncTimer) clearTimeout(this.firebaseSyncTimer);
    const delay = immediate ? 500 : 8000;
    this.firebaseSyncTimer = setTimeout(() => {
      this.firebaseSyncTimer = null;
      if (isFirestoreQuotaExhausted()) return;
      if (this.firebaseSyncPromise) {
        this.firebaseSyncPending = true;
        return;
      }

      const syncPromise = this.syncCredsToFirebase();
      this.firebaseSyncPromise = syncPromise;
      syncPromise.finally(() => {
        if (this.firebaseSyncPromise === syncPromise) {
          this.firebaseSyncPromise = null;
        }
        if (this.firebaseSyncPending && !isFirestoreQuotaExhausted()) {
          this.firebaseSyncPending = false;
          this.scheduleFirebaseCredsSync(false);
        } else {
          this.firebaseSyncPending = false;
        }
      }).catch(() => {});
    }, delay);
  }

  private async syncCredsToFirebase() {
    if (isFirestoreQuotaExhausted()) return;
    try {
      if (!fs.existsSync(this.authDir)) return;
      const credsPath = path.join(this.authDir, 'creds.json');
      if (!fs.existsSync(credsPath)) return;

      const sessionDocId = `session_${this.sanitizedUserId}`;
      const localFiles = new Map<string, string>();
      for (const filename of fs.readdirSync(this.authDir)) {
        if (!isSafeAuthFileName(filename) || !isEssentialCloudAuthFile(filename)) {
          continue;
        }
        localFiles.set(filename, fs.readFileSync(path.join(this.authDir, filename), 'utf-8'));
      }

      const credsContent = localFiles.get('creds.json') || '';
      if (!credsContent) return;

      // Extract essential companion session keys (app-state-sync)
      const essentialFiles: Record<string, string> = {};
      for (const [filename, content] of localFiles) {
        if (filename === 'creds.json') continue;
        essentialFiles[filename] = content;
      }

      const rawSessionData = JSON.stringify(essentialFiles);
      const currentBundleHash = hashSessionContent(`${credsContent}__${rawSessionData}`);

      // Deduplication: If the bundle has not changed, 0 writes to Firestore!
      if (this.lastPersistedBundleHash === currentBundleHash) {
        return;
      }

      // Resolve user email and phone number
      const cleanEmail = await this.resolveUserEmail();
      let cleanPhone = this.currentStatus.user?.phone || this.currentStatus.targetPhone || '';
      if (!cleanPhone && credsContent) {
        try {
          const c = JSON.parse(credsContent);
          const meId = c?.me?.id || '';
          if (meId) {
            const digits = (meId.split(':')[0] || meId.split('@')[0]).replace(/\D/g, '');
            if (digits) cleanPhone = `+${digits}`;
          }
        } catch {}
      }

      // The 5 things stored per user in collection 'column':
      // 1. email: user's email
      // 2. phoneNumber: phone number used to pair last
      // 3. credsData: master credentials (noiseKey, signedIdentityKey, pairKey, registration, etc.)
      // 4. rawSessionData: companion persistence keys (app-state-sync keys)
      // 5. authFormatVersion: version key (3)
      const columnPayload = {
        email: cleanEmail || (this.userId !== 'default' ? this.userId : ''),
        phoneNumber: cleanPhone || null,
        credsData: credsContent,
        rawSessionData,
        authFormatVersion: 3,
        userId: this.userId,
        sha256: currentBundleHash,
        unlinked: false,
        updatedAt: new Date().toISOString(),
      };

      // Push to Firestore folder 'column'
      // Document 1: Named by user's email so looking up by email succeeds instantly
      if (cleanEmail) {
        await setDoc(doc(db, 'column', cleanEmail), columnPayload, { merge: true });
      }
      // Document 2: Named by session ID so looking up by sessionDocId succeeds instantly
      await setDoc(doc(db, 'column', sessionDocId), columnPayload, { merge: true });
      if (this.sanitizedUserId === 'default') {
        await setDoc(doc(db, 'column', 'default'), columnPayload, { merge: true });
      }

      this.lastPersistedBundleHash = currentBundleHash;
      console.log(`[WhatsApp Auth (${this.userId})] Successfully backed up master credentials to Firebase 'column' (email: ${cleanEmail || 'none'}, phone: ${cleanPhone || 'none'}).`);

      // Also persist connected status to users collection
      if (this.userId && this.userId !== 'default') {
        await setDoc(
          doc(db, 'users', this.userId),
          {
            linkedPhone: cleanPhone || null,
            whatsappConnected: Boolean(this.sock && this.currentStatus.isConnected),
            botConnected: this.currentStatus.isConnected,
            connectionState: this.currentStatus.state,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        ).catch(() => {});
      }
    } catch (e: any) {
      reportFirestoreError(e);
      console.warn('[WhatsApp Auth] Firebase sync creds note:', e?.message || e);
    }
  }

  public async flushFirebaseCredsSync(): Promise<void> {
    if (this.firebaseSyncTimer) {
      clearTimeout(this.firebaseSyncTimer);
      this.firebaseSyncTimer = null;
    }
    this.firebaseSyncPending = false;
    await this.credentialsSavePromise.catch(() => {});
    if (this.firebaseSyncPromise) {
      await this.firebaseSyncPromise.catch(() => {});
    }
    await this.syncCredsToFirebase();
  }

  // Clear credentials on unpair: Clear ONLY the 4 things (phone number + 3 keys), leaving user's email in 'column'
  private async clearCredsFromFirebase() {
    try {
      const cleanEmail = await this.resolveUserEmail();
      const sessionDocId = `session_${this.sanitizedUserId}`;

      // Clear only the 4 things: phoneNumber, credsData, rawSessionData, authFormatVersion
      // Leave the email in 'column' so when site or user enters, their email record is preserved!
      const clearPayload = {
        email: cleanEmail || this.userId,
        phoneNumber: null,
        credsData: null,
        rawSessionData: null,
        authFormatVersion: null,
        unlinked: true,
        unlinkedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (cleanEmail) {
        await setDoc(doc(db, 'column', cleanEmail), clearPayload, { merge: true });
      }
      await setDoc(doc(db, 'column', sessionDocId), clearPayload, { merge: true });
      if (this.sanitizedUserId === 'default') {
        await setDoc(doc(db, 'column', 'default'), clearPayload, { merge: true });
      }

      // Also remove legacy corrupt documents from whatsapp_sessions
      try {
        await deleteDoc(doc(db, 'whatsapp_sessions', sessionDocId));
        if (this.sanitizedUserId === 'default') {
          await deleteDoc(doc(db, 'whatsapp_sessions', 'current_session'));
          await deleteDoc(doc(db, 'whatsapp_sessions', 'current_creds'));
        }
      } catch {}

      if (this.userId && this.userId !== 'default') {
        await setDoc(
          doc(db, 'users', this.userId),
          {
            linkedPhone: null,
            whatsappConnected: false,
            botConnected: false,
            connectionState: 'disconnected',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
      console.log(`[WhatsApp Auth (${this.userId})] Cleared phone and session keys from 'column', preserving email (${cleanEmail || this.userId}).`);
    } catch (e: any) {
      console.warn(`[WhatsApp Auth (${this.userId})] Error updating 'column' on clear:`, e?.message || e);
    }
  }

  public startReconnectWindow(): void {
    if (this.reconnectingStartedAt !== null && !this.reconnectTimedOut && !this.isIntentionalClosure) {
      return;
    }
    this.reconnectTimedOut = false;
    this.reconnectingStartedAt = Date.now();
    this.isIntentionalClosure = false;
    this.currentStatus.state = 'connecting';
    this.currentStatus.pairingStage = 'connected';
    this.currentStatus.isPaired = true;
    this.currentStatus.reconnectRemainingSeconds = 60;

    if (this.reconnectTimeoutTimer) {
      clearTimeout(this.reconnectTimeoutTimer);
    }
    this.reconnectTimeoutTimer = setTimeout(() => {
      this.handleReconnectTimeoutExpired();
    }, 60 * 1000);
  }

  public handleReconnectTimeoutExpired(): void {
    this.reconnectTimeoutTimer = null;
    this.reconnectingStartedAt = null;
    if (this.currentStatus.isConnected || (this.sock as any)?.ws?.readyState === 1 || (this.sock as any)?.user?.id) {
      this.currentStatus.isConnected = true;
      this.currentStatus.state = 'connected';
      this.currentStatus.pairingStage = 'connected';
      this.currentStatus.reconnectRemainingSeconds = undefined;
      return;
    }
    this.isConnecting = false;
    this.reconnectTimedOut = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.currentStatus.isConnected = false;
    this.currentStatus.state = 'disconnected';
    this.currentStatus.pairingStage = 'connected';
    this.currentStatus.isPaired = true;
    this.currentStatus.reconnectRemainingSeconds = undefined;
    console.log(`[Baileys Reconnect ${this.userId}] Reconnect window finished. Retaining permanent credentials.`);
  }

  public setUnlinkedIdle(): void {
    if (this.reconnectTimeoutTimer) {
      clearTimeout(this.reconnectTimeoutTimer);
      this.reconnectTimeoutTimer = null;
    }
    if (this.sock) {
      try {
        (this.sock as any)._isIntentionalClose = true;
        this.sock.end(undefined);
      } catch {}
      this.sock = null;
    }
    this.isConnecting = false;
    this.reconnectingStartedAt = null;
    this.reconnectTimedOut = false;
    this.connectedAt = null;
    this.currentStatus.state = 'disconnected';
    this.currentStatus.pairingStage = 'idle';
    this.currentStatus.isConnected = false;
    this.currentStatus.isPaired = false;
    this.currentStatus.user = undefined;
    this.currentStatus.targetPhone = undefined;
    this.currentStatus.pairingCode = undefined;
    this.currentStatus.qrCodeUrl = undefined;
    this.currentStatus.reconnectRemainingSeconds = undefined;
  }

  public resetReconnectTimeout(): void {
    this.reconnectTimedOut = false;
    this.reconnectingStartedAt = null;
    this.startReconnectWindow();
  }

  public async initSocket(isFreshPairing = false): Promise<WASocket> {
    if (this.isLicenseExpired()) {
      throw new Error('Cannot connect WhatsApp: this account has no active license.');
    }
    await commandHandler.loadAccountSecuritySettings(this.userId);
    if (this.sock && this.currentStatus.isConnected) {
      return this.sock;
    }
    const isLive = Boolean(this.sock && ((this.sock as any).ws?.readyState === 1 || (this.sock as any).user?.id));
    if (isLive && this.sock) {
      this.currentStatus.isConnected = true;
      this.currentStatus.state = 'connected';
      this.currentStatus.pairingStage = 'connected';
      this.currentStatus.isPaired = true;
      return this.sock;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    // A license pause is intentional, but a later valid renewal must be allowed to reconnect.
    this.isIntentionalClosure = false;
    this.reconnectTimedOut = false;
    this.initPromise = (async () => {
      try {
        if (this.sock && isFreshPairing) {
          try {
            (this.sock as any)._isIntentionalClose = true;
            this.sock.end(undefined);
          } catch {}
          this.sock = null;
        } else if (this.sock) {
          const wsState = (this.sock as any).ws?.readyState;
          if (wsState === 1) {
            this.currentStatus.isConnected = true;
            this.currentStatus.state = 'connected';
            this.currentStatus.isPaired = true;
            return this.sock;
          }
          if (wsState >= 2) {
            this.sock = null;
          }
        }

        this.ensureAuthDir();
        if (!isFreshPairing) {
          await this.restoreAuthFromFirebaseIfMissing();
        }

        if (
          this.currentStatus.pairingStage !== 'code_generated' &&
          this.currentStatus.pairingStage !== 'pairing_handshake'
        ) {
          this.currentStatus.state = 'connecting';
        }
        this.isConnecting = true;

        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        // Baileys may update signal keys without emitting creds.update.
        // Volatile keys (sender-key, pre-key, session) stay local on disk/memory.
        // We only trigger Firebase backup if critical app-state keys changed.
        const saveSignalKeys = (state.keys as any).set.bind(state.keys);
        (state.keys as any).set = async (data: any) => {
          await saveSignalKeys(data);
          if (data && typeof data === 'object') {
            const hasEssentialKeys = Object.keys(data).some(
              (k) => k.includes('app-state') || k === 'app-state-sync-key' || k === 'app-state-sync-version'
            );
            if (hasEssentialKeys) {
              this.scheduleFirebaseCredsSync();
            }
          }
        };

        let version: [number, number, number] = [2, 3000, 1043857760];
        try {
          const v = await fetchLatestBaileysVersion();
          if (v?.version) version = v.version;
        } catch {
          // Fallback
        }

        const pinoLogger = pino({ level: 'silent' });
        const sock = makeWASocket({
          version,
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
          },
          logger: pinoLogger,
          printQRInTerminal: false,
          browser: Browsers.ubuntu('Chrome'),
          connectTimeoutMs: 60000,
          defaultQueryTimeoutMs: 60000,
          keepAliveIntervalMs: 25000,
          retryRequestDelayMs: 500,
          maxMsgRetryCount: 5,
          generateHighQualityLinkPreview: true,
          getUrlInfo: (text: string) => getUrlInfo(text),
          syncFullHistory: false,
          markOnlineOnConnect: true,
          getMessage: async (key: any) => {
            if (key.id && this.messageCache.has(key.id)) {
              const cached = this.messageCache.get(key.id);
              if (cached?.rawMessage) return cached.rawMessage;
              if (cached?.text) return { conversation: cached.text };
            }
            return undefined;
          },
        } as any);

        this.sock = sock;

        // 🛡️ Intercept low-level WebSocket network resets or Baileys internal event emitter errors
        try {
          if (sock.ws && typeof (sock.ws as any).on === 'function') {
            (sock.ws as any).on('error', (wsErr: any) => {
              console.warn(`[Baileys WS Guard (${this.userId})] Low-level socket network event intercepted:`, wsErr?.message || wsErr);
            });
          }
          if (typeof (sock.ev as any).on === 'function') {
            (sock.ev as any).on('error', (evErr: any) => {
              console.warn(`[Baileys Event Guard (${this.userId})] Event emitter notice:`, evErr?.message || evErr);
            });
          }
        } catch {}

        this.start247Heartbeat();

        sock.ev.on('creds.update', (creds) => {
          this.credentialsSavePromise = this.credentialsSavePromise
            .then(() => saveCreds())
            .then(() => this.scheduleFirebaseCredsSync(Boolean(creds?.registered)))
            .catch((err) => console.warn('[WhatsApp Auth] Local credential save failed:', err));
          // Registration confirms the companion is paired; only connection.update("open")
          // confirms that the bot socket is currently online.
          if (
            creds.registered === true &&
            Boolean((creds as any).me?.id || (creds as any).account?.details)
          ) {
            const meId = (creds as any).me?.id;
            const phone = meId
              ? (meId.split(':')[0] || meId.split('@')[0])
              : this.currentStatus.targetPhone?.replace(/\D/g, '') || '';
            this.currentStatus.isPaired = true;
            if (!this.currentStatus.isConnected) {
              this.currentStatus.state = 'pairing_handshake';
              this.currentStatus.pairingStage = 'pairing_handshake';
            }
            this.currentStatus.pairingCode = undefined;
            this.currentStatus.qrCodeUrl = undefined;
            this.currentStatus.latestHandshakeTime = new Date().toLocaleTimeString();
            if (phone && !this.currentStatus.user) {
              this.currentStatus.user = {
                id: meId || `${phone}@s.whatsapp.net`,
                name: (creds as any).me?.name || 'SOLVATECH Linked Phone',
                phone: `+${phone}`,
              };
            }
            this.addNotification({
              type: 'connection',
              title: 'WhatsApp Pairing Confirmed',
              body: `WhatsApp accepted the companion link for +${phone || 'phone'}. The bot is connecting.`,
            });
            // Immediate sync to Firebase Firestore so credentials survive instantaneous redeployment
            this.flushFirebaseCredsSync().catch(() => {});
            if (this.userId && this.userId !== 'default' && phone && !isFirestoreQuotaExhausted()) {
              setDoc(
                doc(db, 'users', this.userId),
                {
                  linkedPhone: `+${phone}`,
                  isPaired: true,
                  connectionState: 'connected',
                  updatedAt: new Date().toISOString(),
                },
                { merge: true }
              ).catch((err) => reportFirestoreError(err));
            }
          }
        });

        sock.ev.on('connection.update', async (update) => {
          try {
            const { connection, lastDisconnect, qr } = update;

            // Detect companion link confirmation on explicit new login event
            if (update.isNewLogin) {
              this.currentStatus.isPaired = true;
              this.currentStatus.pairingStage = 'connected';
              this.currentStatus.state = 'connecting';
              this.currentStatus.pairingCode = undefined;
              this.currentStatus.latestHandshakeTime = new Date().toLocaleTimeString();
              this.addNotification({
                type: 'pairing',
                title: 'WhatsApp Handshake Confirmed',
                body: 'Handshake received from WhatsApp phone! Companion link accepted.',
              });
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
              if ((sock as any)._isIntentionalClose || this.isIntentionalClosure) {
                this.isIntentionalClosure = false;
                console.log('[Baileys Connection] Closed intentionally for fresh connection setup, pause, or logout.');
                return;
              }

              const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
              const reason = (lastDisconnect?.error as any)?.data?.reason;
              const isAwaitingPairing =
                this.currentStatus.pairingStage === 'code_generated' ||
                this.currentStatus.pairingStage === 'pairing_handshake' ||
                this.currentStatus.state === 'awaiting_pairing';
              const hasRegisteredCreds = this.hasRegisteredCredentials();

              this.isConnecting = false;
              this.sock = null;

              // If WhatsApp explicitly reports loggedOut / 401: device was unlinked in WhatsApp on user's phone!
              const isLoggedOut = !isAwaitingPairing && (
                statusCode === DisconnectReason.loggedOut ||
                statusCode === 401 ||
                reason === '401' ||
                reason === 'loggedOut'
              );
              this.connectedAt = null;
              this.currentStatus.isConnected = false;

              if (isLoggedOut) {
                // Prevent premature logout on daily token cycling / transient 401 challenge:
                if (hasRegisteredCreds && this.consecutive401Count < 2 && (statusCode === 401 || reason === '401')) {
                  this.consecutive401Count++;
                  console.warn(`[Baileys Connection] Received 401 challenge (attempt ${this.consecutive401Count}/2). WhatsApp may be cycling companion tokens. Retrying handshake before declaring logged out...`);
                  this.currentStatus.state = 'connecting';
                  if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                  this.reconnectTimer = setTimeout(() => {
                    this.initSocket().catch((err) => {
                      console.warn('[Baileys Connection] 401 recovery retry note:', err);
                    });
                  }, 3000);
                  return;
                }

                if (this.reconnectTimeoutTimer) {
                  clearTimeout(this.reconnectTimeoutTimer);
                  this.reconnectTimeoutTimer = null;
                }
                this.reconnectingStartedAt = null;
                this.reconnectTimedOut = false;
                this.currentStatus.state = 'disconnected';
                this.currentStatus.pairingStage = 'idle';
                this.currentStatus.isPaired = false;
                this.currentStatus.user = undefined;
                this.currentStatus.targetPhone = undefined;
                this.currentStatus.pairingCode = undefined;
                this.currentStatus.qrCodeUrl = undefined;
                this.currentStatus.reconnectRemainingSeconds = undefined;
                this.currentStatus.lastError = 'WhatsApp reported device unlinked from your phone. Ready for fresh pairing.';
                this.addNotification({
                  type: 'connection',
                  title: 'WhatsApp Disconnected',
                  body: 'The device was unlinked or logged out from your phone. Ready for fresh pairing.',
                });
                await this.logout(true);
              } else {
                if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
                  console.log('[Baileys Connection] Connection closed (code: 515 restartRequired). Device pairing accepted by phone, restarting connection immediately...');
                  this.currentStatus.pairingStage = 'connected';
                  this.currentStatus.state = 'connecting';
                  this.currentStatus.pairingCode = undefined;
                  this.currentStatus.latestHandshakeTime = new Date().toLocaleTimeString();
                  this.addNotification({
                    type: 'pairing',
                    title: 'WhatsApp Handshake Confirmed',
                    body: 'WhatsApp accepted the companion link. Reconnecting to finish setup...',
                  });
                  if (!this.isLicenseExpired()) {
                    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = setTimeout(async () => {
                      await this.credentialsSavePromise.catch(() => {});
                      await new Promise((r) => setTimeout(r, 400));
                      this.initSocket().catch((err) => {
                        console.warn('Auto-restart note:', err);
                      });
                    }, 500);
                  }
                } else if (hasRegisteredCreds) {
                  // Keep the saved pairing for already registered devices, auto-reconnect in background
                  if (!this.isLicenseExpired()) {
                    this.currentStatus.state = 'connecting';
                    this.currentStatus.pairingStage = 'connected';
                  } else {
                    this.currentStatus.state = 'expired';
                  }
                  await this.syncConnectionStatusToFirestore();

                  console.log(`[Baileys Connection] Connection closed (code: ${statusCode || 'unknown'}). Keeping registered session intact, auto-reconnecting in background...`);
                  if (!this.isLicenseExpired()) {
                    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = setTimeout(() => {
                      this.initSocket().catch((err) => {
                        console.warn('Auto-reconnect note:', err);
                      });
                    }, 2000);
                  }
                } else {
                  // Connection closed while awaiting pairing code entry or idle.
                  // Do NOT trigger reconnect timer or switch to 'connecting', which destroys the active pairing socket!
                  if (!isAwaitingPairing) {
                    this.currentStatus.state = this.isLicenseExpired() ? 'expired' : 'disconnected';
                    this.currentStatus.pairingStage = 'idle';
                  }
                  await this.syncConnectionStatusToFirestore();
                  console.log(`[Baileys Connection] Connection closed (code: ${statusCode || 'unknown'}) while awaiting pairing. Holding pairing socket intact.`);
                }
              }
            } else if (connection === 'open') {
              if (this.reconnectTimeoutTimer) {
                clearTimeout(this.reconnectTimeoutTimer);
                this.reconnectTimeoutTimer = null;
              }
              this.reconnectingStartedAt = null;
              this.reconnectTimedOut = false;
              this.currentStatus.reconnectRemainingSeconds = undefined;
              this.connectedAt = Date.now();
              this.currentStatus.state = 'connected';
              this.currentStatus.isConnected = true;
              this.consecutive401Count = 0;
            this.currentStatus.connectedAt = this.connectedAt;
            this.currentStatus.pairingStage = 'connected';
            this.currentStatus.pairingCode = undefined;
            this.currentStatus.qrCodeUrl = undefined;
            this.currentStatus.lastError = undefined;
            this.isConnecting = false;
            // Prune old ephemeral session keys in background after connection
            setTimeout(() => {
              this.pruneStaleSessionFiles();
            }, 5000);

            const userJid = sock.user?.id || '';
            const phone = userJid.split(':')[0] || userJid.split('@')[0];
            this.currentStatus.user = {
              id: userJid,
              name: sock.user?.name || 'SOLVATECH Linked Phone',
              phone: `+${phone}`,
            };
            this.currentStatus.isPaired = true;
            this.syncConnectionStatusToFirestore().catch(() => {});

            this.addNotification({
              type: 'connection',
              title: 'WhatsApp Connected!',
              body: `SOLVATECH successfully paired with +${phone}. All 35+ commands active in WhatsApp.`,
              sender: phone,
            });

            // Send confirmation notification to user's WhatsApp DM ONLY upon fresh companion pairing
            // STRICT USER REQUIREMENT: "note when site reconnect in background don't flood dm with successfully connected to bot oo in dm it frustrating"
            const sentMarker = path.join(this.authDir, `welcome_dm_sent_${phone}.json`);
            if (this.isFreshNewPairing && !fs.existsSync(sentMarker)) {
              this.isFreshNewPairing = false;
              try {
                fs.writeFileSync(sentMarker, JSON.stringify({ sentAt: new Date().toISOString() }), 'utf-8');
              } catch {}
              const ownerDm = `${phone}@s.whatsapp.net`;
              setTimeout(async () => {
                try {
                  const welcomeCaption = `⚡ *SOLVATECH BOT CONNECTED SUCCESSFULLY* ⚡\n\n🎉 Welcome! Your WhatsApp account (+${phone}) is now officially linked with the SOLVATECH automation engine.\n\n🛡️ *Active Features:*\n• Anti-Delete Message Recovery (deleted messages flood here)\n• View-Once Media Decryption (*.open* / *.vv*)\n• Group Security, Anti-Link & Anti-Bot matrix\n• High-Speed Media & Sticker Converters\n• Over 35+ Automation Commands\n\n💬 *Commands Directory:* Type *.menu* to view all commands.\n🌐 *Web Console:* ${process.env.APP_URL || 'SOLVATECH Web Portal'}\n\n> 👑 _Developer: Solomon Oladimeji (+234 904 997 9183)_`;
                  const brandBuf = await getSolvaBrandBuffer();
                  if (brandBuf) {
                    await sock.sendMessage(ownerDm, {
                      image: brandBuf,
                      caption: welcomeCaption,
                      mimetype: 'image/jpeg',
                    });
                  } else {
                    await sock.sendMessage(ownerDm, {
                      text: welcomeCaption,
                    });
                  }
                  console.log(`[WhatsApp Notification] Fresh pairing confirmation sent with brand image to ${ownerDm} (once only)`);
                } catch (dmErr) {
                  console.warn('[WhatsApp Notification] Note sending welcome DM:', dmErr);
                }
              }, 1500);
            } else {
              this.isFreshNewPairing = false;
            }

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
        } catch (connErr) {
          console.error(`[Baileys Connection Update Error Safeguard (${this.userId})]:`, connErr);
        }
      });

    // Inbound Messages & SOLVATECH Command Handler
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify' || m.type === 'append') {
        // STRICT EXPIRATION ENFORCEMENT DOWN TO THE EXACT MINUTE:
        // When license or trial ends, the bot ceases all automation and pauses immediately
        if (this.isLicenseExpired()) {
          console.log(`[License Watchdog] User ${this.userId} license is expired down to the minute. Halting all WhatsApp automation.`);
          await this.pauseSocket('License Expired');
          return;
        }

        // ZERO-QUEUE CONCURRENT DISPATCH:
        // Each message is handled in its own async execution task so multiple users' commands
        // execute simultaneously in parallel without any lining up or waiting.
        for (const msg of m.messages) {
          if (!msg.message) {
            // 🛡️ Auto-recover from Signal decryption failures (CIPHERTEXT stubs / Bad MAC)
            if (msg.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) {
              const remoteJid = msg.key?.remoteJid || '';
              const participant = msg.key?.participant || remoteJid;
              void this.handleDecryptionFailure(remoteJid, participant, msg.key?.id);
            }
            continue;
          }
          void (async () => {
            const remoteJid = msg.key.remoteJid || '';
            const senderJid = msg.key.participant || remoteJid;
            const senderNum = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
            const isGroup = remoteJid.endsWith('@g.us');
            const isStatus = remoteJid === 'status@broadcast' || msg.key?.remoteJid === 'status@broadcast';
            const isFromMe = !!msg.key.fromMe;

            const rawMsg = msg.message;
            const unwrappedMsg = unwrapMessage(rawMsg);

            // 1. Detect and process WhatsApp "Delete for Everyone" / Revoke events
            if (unwrappedMsg?.protocolMessage) {
              const protoMsg = unwrappedMsg.protocolMessage;
              if (protoMsg.type === 0 || protoMsg.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                if (protoMsg.key) {
                  const targetRemote = protoMsg.key.remoteJid || '';
                  if (targetRemote === 'status@broadcast' || targetRemote.includes('status') || protoMsg.key.fromMe) {
                    return;
                  }
                  const revokerNum = (msg.key.participant || msg.key.remoteJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
                  await this.handleMessageRevoke(protoMsg.key, revokerNum);
                  return;
                }
              }
            }

          const text =
            unwrappedMsg?.conversation ||
            unwrappedMsg?.extendedTextMessage?.text ||
            unwrappedMsg?.imageMessage?.caption ||
            unwrappedMsg?.videoMessage?.caption ||
            unwrappedMsg?.documentMessage?.caption ||
            '';

          // Cache message for Anti-Delete recovery and .del commands
          if (msg.key.id) {
            const media = extractMediaFromMessage(rawMsg);
            const msgId = msg.key.id;
            const ext = media?.type === 'video' ? 'mp4' : media?.type === 'image' ? 'jpg' : media?.type === 'audio' ? 'ogg' : media?.type === 'sticker' ? 'webp' : 'bin';
            const mediaDiskPath = media ? path.join(this.mediaCacheDir, `${msgId}.${ext}`) : undefined;

            const cachedEntry: any = {
              key: msg.key,
              sender: senderNum,
              senderJid,
              senderName: msg.pushName || undefined,
              text,
              rawMessage: rawMsg,
              timestamp: Date.now(),
              isGroup,
              isStatus,
              fromMe: isFromMe,
              group: isGroup ? remoteJid : (isStatus ? 'status@broadcast' : undefined),
              groupName: isGroup ? this.groupSubjectCache.get(remoteJid) : undefined,
              mediaType: media?.type,
              mediaTarget: media?.target,
              mediaFilePath: mediaDiskPath,
              mimetype: media?.target?.mimetype,
              fileName: media?.target?.fileName,
              isGif: media?.isGif,
              isPtv: media?.isPtv,
            };

            // Download raw media buffer asynchronously for instant DM recovery if deleted (skip status broadcasts)
            if (!isStatus && media && (media.type === 'image' || media.type === 'video' || media.type === 'audio' || media.type === 'sticker' || media.type === 'document')) {
              const downloadPromise = downloadMediaBufferWithRetry(media.target, media.type, 2)
                .then(async (buf) => {
                  if (mediaDiskPath) {
                    try {
                      await fs.promises.writeFile(mediaDiskPath, buf);
                    } catch (diskErr) {
                      console.warn('[Anti-Delete] Failed writing media to disk cache:', diskErr);
                    }
                  }

                  if (this.messageCache.get(msgId) === cachedEntry) {
                    cachedEntry.mediaBuffer = buf;
                    this.rememberMediaBuffer(`message:${msgId}`, buf, () => {
                      cachedEntry.mediaBuffer = undefined;
                    });
                  }
                  return buf;
                })
                .catch((err) => {
                  console.warn(`[Anti-Delete] Background media download note for ${msgId}:`, err?.message);
                  return null;
                });

              cachedEntry.mediaPromise = downloadPromise;
            }

            this.deleteCachedMessage(msgId);
            this.messageCache.set(msgId, cachedEntry);
            if (this.messageCache.size > 2500) {
              const firstKey = this.messageCache.keys().next().value;
              if (firstKey) this.deleteCachedMessage(firstKey);
            }
          }

          // Cache status broadcasts for .send command
          if (remoteJid === 'status@broadcast' || msg.key?.remoteJid === 'status@broadcast') {
            const sMedia = extractMediaFromMessage(rawMsg);
            const sText = unwrappedMsg?.conversation || unwrappedMsg?.extendedTextMessage?.text || unwrappedMsg?.imageMessage?.caption || unwrappedMsg?.videoMessage?.caption || '';
            if (msg.key.id) {
              if (sMedia && (sMedia.type === 'image' || sMedia.type === 'video' || sMedia.type === 'audio')) {
                downloadMediaBuffer(sMedia.target, sMedia.type).then(buf => {
                  const statusEntry = {
                    id: msg.key.id!,
                    senderJid: msg.key.participant || senderJid,
                    senderNum,
                    type: sMedia.type as 'image' | 'video' | 'audio',
                    buffer: undefined as Buffer | undefined,
                    caption: sText,
                    timestamp: Date.now(),
                  };
                  this.statusCache.set(msg.key.id!, statusEntry);
                  const cached = this.rememberMediaBuffer(`status:${msg.key.id}`, buf, () => {
                    const cachedStatus = this.statusCache.get(msg.key.id!);
                    if (cachedStatus) cachedStatus.buffer = undefined;
                  });
                  if (cached) statusEntry.buffer = buf;
                  if (this.statusCache.size > 100) {
                    const first = this.statusCache.keys().next().value;
                    if (first) this.deleteCachedStatus(first);
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
                  if (first) this.deleteCachedStatus(first);
                }
              }
            }
          }

          // Anti-View-Once interceptor & real-time buffer caching
          const isViewOnceMsg = !!(
            rawMsg?.viewOnceMessage ||
            rawMsg?.viewOnceMessageV2 ||
            rawMsg?.viewOnceMessageV2Extension ||
            rawMsg?.ephemeralMessage?.message?.viewOnceMessage ||
            rawMsg?.ephemeralMessage?.message?.viewOnceMessageV2 ||
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
                      setBoundedCache(this.groupSubjectCache, remoteJid, meta.subject, 1000);
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
                    const cached = this.rememberMediaBuffer(`view-once:${msg.key.id}`, buf, () => {
                      cachedVO.buffer = Buffer.alloc(0);
                    });
                    if (!cached) return;
                    this.viewOnceCache.set(msg.key.id!, cachedVO);
                    this.lastViewOnceByChat.set(remoteJid, cachedVO);
                    if (this.viewOnceCache.size > 200) {
                      const firstKey = this.viewOnceCache.keys().next().value;
                      if (firstKey) {
                        const evicted = this.viewOnceCache.get(firstKey);
                        this.viewOnceCache.delete(firstKey);
                        this.forgetMediaBuffer(`view-once:${firstKey}`);
                        if (evicted && this.lastViewOnceByChat.get(evicted.remoteJid) === evicted) {
                          this.lastViewOnceByChat.delete(evicted.remoteJid);
                        }
                      }
                    }
                    if (this.lastViewOnceByChat.size > 100) {
                      const oldestChat = this.lastViewOnceByChat.keys().next().value;
                      if (oldestChat) this.lastViewOnceByChat.delete(oldestChat);
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
          const botUserLid = (sock as any).user?.lid || (sock as any).authState?.creds?.me?.lid || '';
          const botPhone = (botUserJid.split(':')[0] || botUserJid.split('@')[0]).replace(/\D/g, '');
          const botLidNum = (botUserLid.split(':')[0] || botUserLid.split('@')[0]).replace(/\D/g, '');
          const linkedPhoneClean = (this.currentStatus.user?.phone || '').replace(/\D/g, '');
          const participantRaw = msg.key.participant || senderJid || '';
          const participantNum = participantRaw.split('@')[0].split(':')[0].replace(/\D/g, '');
          const mappedSenderPhone = this.getLidReverseMapping(senderNum) || (participantNum ? this.getLidReverseMapping(participantNum) : '');

          // STRICT PER-USER SESSION ISOLATION:
          // A bot instance must ONLY obey ITS OWN account owner!
          // Only Solomon's own session recognizes 2349049979183. Other users' bots ONLY obey that specific user!
          const isSessionAdminAccount = Boolean(
            this.isOwnerEmail() ||
            (linkedPhoneClean && linkedPhoneClean === '2349049979183') ||
            (botPhone && botPhone === '2349049979183')
          );

          const isOwner =
            isFromMe ||
            (botPhone && (senderNum === botPhone || participantNum === botPhone)) ||
            (linkedPhoneClean && (senderNum === linkedPhoneClean || participantNum === linkedPhoneClean)) ||
            (botLidNum && (senderNum === botLidNum || participantNum === botLidNum)) ||
            Boolean(mappedSenderPhone && botPhone && mappedSenderPhone === botPhone) ||
            Boolean(mappedSenderPhone && linkedPhoneClean && mappedSenderPhone === linkedPhoneClean) ||
            (isSessionAdminAccount && (
              senderNum === '2349049979183' ||
              participantNum === '2349049979183' ||
              mappedSenderPhone === '2349049979183'
            ));

          // Check if sender is a group administrator
          let isSenderAdmin = false;
          if (isGroup) {
            try {
              const groupMeta = await this.getCachedGroupMetadata(sock, remoteJid);
              if (groupMeta?.participants) {
                const senderLidPhone = this.getLidReverseMapping(senderNum);
                const senderIds = new Set([senderNum, participantNum, senderLidPhone, mappedSenderPhone].filter(Boolean));
                const participantJid = msg.key.participant || senderJid;
                const p = groupMeta.participants.find(
                  (x: any) => {
                    if (x.id === participantJid || x.lid === participantJid || x.id === senderJid || x.lid === senderJid) {
                      return true;
                    }
                    const participantIds = [x.id, x.phoneNumber, x.lid]
                      .filter((value: any) => typeof value === 'string')
                      .map((value: string) => value.split('@')[0].split(':')[0].replace(/\D/g, ''));
                    return participantIds.some((id: string) => senderIds.has(id));
                  }
                );
                isSenderAdmin = p?.admin === 'admin' || p?.admin === 'superadmin';

                // Reverse map participant LID if it matches bot phone
                if (p && (p.phoneNumber === botPhone || p.id?.replace(/\D/g, '') === botPhone || p.id?.replace(/\D/g, '') === linkedPhoneClean)) {
                  if (p.lid) {
                    const cleanL = p.lid.split('@')[0].split(':')[0].replace(/\D/g, '');
                    const cleanP = (p.phoneNumber || p.id).split('@')[0].split(':')[0].replace(/\D/g, '');
                    if (cleanL && cleanP) setBoundedCache(this.reverseLidMap, cleanL, cleanP, 2000);
                  }
                }
              }
            } catch {}
          }
          // STRICT RULE: Group admin commands require the user to be BOTH a group admin AND the bot owner!
          const isAuthorizedAdmin = isOwner && isSenderAdmin;

          const isGroupInfoTrigger = /^\.(groupinfo|gcinfo|group)(\s|$)/i.test(text.trim());

          // Group Security Enforcement (Anti-Bot, Anti-Link, Anti-Status, Anti-Spam)
          // STRICT RULE: Only applies to regular members!
          // EXCEPTION: .groupinfo can be used by ANY group member once the bot is in the group!
          if (isGroupInfoTrigger) {
            // Whitelisted: proceed straight to command execution!
          } else if (isGroup && !isOwner && !isSenderAdmin) {
            const isBotAdmin = await this.isBotAdminInGroupById(remoteJid);
            if (!isBotAdmin) {
              // Bot account is not an admin in this group: DO NOT SEND ANY WARNING MESSAGES!
            } else {
              const sec = commandHandler.getSecuritySettings(remoteJid, this.userId);

            // 1. Anti-Bot: Broad, Smart Detection Engine
            // A) Commands starting with bot prefixes: . ! / # $ ? \ % +
            const trimmedText = text.trim();
            const isBotPrefixCommand =
              /^[.!/#$?%\\+][a-zA-Z0-9_]{1,30}(\s|$)/.test(trimmedText) ||
              /(^|\s)[.!/#$?%\\+][a-zA-Z0-9_]{1,30}(\s|$)/.test(trimmedText);

            // B) Quoted bot message: distinguishes between users driving a bot vs. casual human chat
            let isDrivingBot = false;
            if (quotedText) {
              const isQuotedFromAnyBot =
                quotedText.toLowerCase().includes('solvatech') ||
                quotedText.includes('🤖') ||
                quotedText.includes('⚡') ||
                /^[.!/#$?%\\+][a-zA-Z0-9_]/.test(quotedText.trim()) ||
                /latency|uptime|ping|speed|powered by|developer/i.test(quotedText) ||
                (quotedParticipant &&
                  (quotedParticipant.replace(/\D/g, '') === botPhone ||
                    quotedParticipant.replace(/\D/g, '') === linkedPhoneClean));

              if (isQuotedFromAnyBot) {
                // Check if reply is casual human speech/complaints/chitchat (PROTECTED - NOT A BOT)
                const isHumanCasual =
                  /^(stop|rest|leave|who|why|bro|guy|wassup|sup|abeg|pls|please|nah|dumb|kick|mute|admin|chill|wetin|dey|wait|no|yes)\b/i.test(trimmedText) ||
                  /\b(stop using bot|stop it|who invited|abeg rest|leave am|guy rest|admin kick|stop spam)\b/i.test(trimmedText);

                if (!isHumanCasual) {
                  // Check if user is replying to drive/operate the bot (numbers, single characters, prompts, wallet, command inputs)
                  const isCommandInput =
                    /^[0-9]{1,3}$/.test(trimmedText) || // "1", "2", "3" to select menu item
                    /^[a-zA-Z0-9_]{1,3}$/.test(trimmedText) || // short selection code
                    /^(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|T[A-Za-z1-9]{33})$/.test(trimmedText) || // crypto wallet
                    /^[.!/#$?%\\+]/.test(trimmedText); // another command inside reply

                  if (isCommandInput) {
                    isDrivingBot = true;
                  }
                }
              }
            }

            // C) Foreign Rogue Bot Payload / Piggybacking & Command Response Snooper:
            // Checks if a foreign bot is answering an admin command (.ping, .menu, etc.) or sending automated bot messages
            const recentAdminCmd = this.recentAdminGroupCommands.get(remoteJid);
            const isRecentCmdWindow = recentAdminCmd && (Date.now() - recentAdminCmd.issuedAt < 25000);
            const quotedStanzaId = (rawMsg as any)?.extendedTextMessage?.contextInfo?.stanzaId || '';
            const isQuotingAdminCmd = Boolean(
              (quotedStanzaId && recentAdminCmd && quotedStanzaId === recentAdminCmd.messageKeyId) ||
              (quotedText && /^[.!/#$?%\\+](ping|menu|help|speed|status|alive|info|runtime)\b/i.test(quotedText.trim()))
            );

            // Broad bot response indicators: latency/pong/speed/menu/commands/developer signatures
            const botResponseIndicator =
              /(\b(pong!?|latency:?|speed:?|response time:?|uptime:?|prefix:?|developed by|bot by|created by|powered by|command list|help menu|all commands|bot commands)\b|[\d.]+\s*(ms|seconds|sec)\s*(latency|speed|ping|response)|🤖|⚡\s*\*|\bwa\.me\/\d{8,15}\b)/i.test(trimmedText) ||
              !!(rawMsg?.templateButtonReplyMessage || rawMsg?.buttonsResponseMessage || rawMsg?.listResponseMessage) ||
              /(\*response time:\*|\*latency:\*|\*speed:\*|\*uptime:\*|\*prefix:\*|\*owner:\*)/i.test(trimmedText);

            let isForeignBotResponse = false;
            if (isQuotingAdminCmd || (isRecentCmdWindow && botResponseIndicator)) {
              // Ensure casual human conversation is protected
              const isHumanCasual = /^(stop|rest|leave|who|why|bro|guy|wassup|sup|abeg|pls|please|nah|dumb|kick|mute|admin|chill|wetin|dey|wait|no|yes|ok|okay|wow|nice|true|false)\b/i.test(trimmedText);
              if (!isHumanCasual) {
                isForeignBotResponse = true;
              }
            } else if (botResponseIndicator && (trimmedText.includes('\n') || trimmedText.length > 30)) {
              isForeignBotResponse = true;
            }

            const isBotDetected = isBotPrefixCommand || isDrivingBot || isForeignBotResponse;

            if (sec.antibot && isBotDetected) {
              try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
              const warn = await commandHandler.addWarning(remoteJid, senderJid, this.userId);
              if (warn.count >= warn.max) {
                try { await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove'); } catch {}
                await sock.sendMessage(remoteJid, {
                  text: `🚨 *[GROUP SECURITY ENFORCEMENT - ROGUE BOT EXPELLED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User/Bot:* @${senderNum}\n⛔ *Offense:* Rogue bot commands or foreign bot reply detected while Anti-Bot is active\n⚠️ *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*\n🔨 *Punishment:* *Auto-removed from group*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Anti-Bot Shield_`,
                  mentions: [senderJid],
                });
              } else {
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[ANTI-BOT WARNING]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User/Bot:* @${senderNum}\nAutomated bot commands and foreign bot replies are strictly prohibited while Anti-Bot is enabled in this group. Your message has been removed.\n📊 *Warning:* *${warn.count}/${warn.max}* (Auto-kick at ${warn.max})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  mentions: [senderJid],
                });
              }
              return;
            }

            // 2. Anti-Link: Member posting external links (solvatech.up.railway.app is whitelisted so it is never deleted)
            const textWithoutOfficialDomain = text.replace(/solvatech\.up\.railway\.app/gi, '');
            const hasLink = /(https?:\/\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+|t\.me\/[^\s]+)/i.test(textWithoutOfficialDomain);
            if (sec.antilink && hasLink) {
              try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
              const warn = await commandHandler.addWarning(remoteJid, senderJid, this.userId);
              if (warn.count >= warn.max) {
                try { await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove'); } catch {}
                await sock.sendMessage(remoteJid, {
                  text: `🚨 *[GROUP SECURITY ENFORCEMENT]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⛔ *Offense:* Posting unauthorized external links\n⚠️ *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*\n🔨 *Punishment:* *Auto-removed from group*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  mentions: [senderJid],
                });
              } else {
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[BE WARNED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\nLinks are strictly not allowed in this group. Your message has been removed.\n📊 *Warning:* *${warn.count}/${warn.max}* (Auto-kick at ${warn.max})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
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
              const warn = await commandHandler.addWarning(remoteJid, senderJid, this.userId);
              if (warn.count >= warn.max) {
                try { await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove'); } catch {}
                await sock.sendMessage(remoteJid, {
                  text: `🚨 *[GROUP SECURITY ENFORCEMENT]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⛔ *Offense:* Mentioning this group in personal WhatsApp status\n⚠️ *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*\n🔨 *Punishment:* *Auto-removed from group*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                  mentions: [senderJid],
                });
              } else {
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[BE WARNED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\nMentioning this group in your personal status is not allowed. Your message has been removed.\n📊 *Warning:* *${warn.count}/${warn.max}* (Auto-kick at ${warn.max})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
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
                for (const [key, state] of this.userSpamPurgeState) {
                  if (now - state.detectedAt >= 30000) this.userSpamPurgeState.delete(key);
                }
                setBoundedCache(this.userSpamPurgeState, spamUserKey, { detectedAt: now, isPurging: true }, 1000);

                // Delete current message and previous original messages in batch
                for (const k of keysToPurge) {
                  try { await sock.sendMessage(remoteJid, { delete: k }); } catch {}
                }

                // Reset user history
                setBoundedCache(this.userMessageHistory, spamUserKey, [], 1000);

                // Unified warning increment
                const warn = await commandHandler.addWarning(remoteJid, senderJid, this.userId);
                if (warn.count >= warn.max) {
                  try { await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove'); } catch {}
                  this.userSpamPurgeState.delete(spamUserKey);
                  await sock.sendMessage(remoteJid, {
                    text: `🚨 *[GROUP SECURITY ENFORCEMENT]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\n⛔ *Offense:* ${spamReason}\n⚠️ *Warnings:* *${warn.count}/${warn.max} (LIMIT EXCEEDED)*\n🔨 *Punishment:* *Auto-removed from group*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                    mentions: [senderJid],
                  });
                } else {
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[BE WARNED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *User:* @${senderNum}\nStop spamming messages in this group. Your spam messages have been cleared.\n📊 *Warning:* *${warn.count}/${warn.max}* (Auto-kick at ${warn.max})\n⚠️ *CRITICAL NOTICE:* If you keep sending messages while deletion is underway, you will be *INSTANTLY KICKED*!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                    mentions: [senderJid],
                  });
                }
                return;
              }

              // Normal legitimate message: save to history
              recentHistory.push({ key: msg.key, text: cleanText, type: msgKind, timestamp: now });
              setBoundedCache(this.userMessageHistory, spamUserKey, recentHistory.slice(-12), 1000);
            }
          }
        }

          // Command handling: Prefix '.'
          const cleanCmdText = text.trim();
          if (cleanCmdText.startsWith('.')) {
            // STRICT LICENSE DURATION & EXPIRATION CHECK:
            // Once license or free trial elapses, all commands are strictly blocked
            if (this.isLicenseExpired()) {
              console.log(`[License Enforcement] User ${this.userId} license has expired! Blocking command execution.`);
              if (isOwner) {
                try {
                  await sock.sendMessage(remoteJid, {
                    text: `⛔ *[SOLVATECH LICENSE EXPIRED]* ⛔\n\nYour active bot license duration has finished.\nAll commands and automation have been paused.\n\n👉 Please visit the website to renew your license key or contact Solomon Oladimeji (+234 904 997 9183).`,
                  }, { quoted: msg });
                } catch {}
              }
              return;
            }

            const parts = cleanCmdText.slice(1).trim().split(/\s+/);
            const command = parts[0]?.toLowerCase();
            const args = parts.slice(1);

            const isGroupInfoCmd = command === 'groupinfo' || command === 'gcinfo' || command === 'group' || command === 'link';
            // STRICT OWNER ISOLATION: The bot strictly listens ONLY to the person who linked it!
            // If someone else types .menu, .ping, etc. in a group or DM, NEVER answer them and NEVER react!
            if (!isOwner) {
              return;
            }

            const isGroupCmd = GROUP_ONLY_COMMANDS.has(command);

            // 1v1 private chats: strictly bot owner only. Group commands never execute in 1v1 chat.
            if (!isGroup && isGroupCmd) {
              return;
            }

            // Group chats:
            // Admin moderation commands (.kick, .warn, .lock, etc.) require the bot owner to ALSO be a group admin in WhatsApp!
            if (isGroup && ADMIN_ONLY_GROUP_COMMANDS.has(command)) {
              if (!isSenderAdmin) {
                return; // Owner is not an admin in this group: silent ignore
              }

              // In groups: Moderation and admin group commands require the bot to be an admin in that group
              const isBotAdmin = await this.isBotAdminInGroupById(remoteJid);
              if (!isBotAdmin) {
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[BOT NOT ADMIN]*\nThe bot must be promoted to Group Administrator to execute group management commands.`,
                }, { quoted: msg }).catch(() => {});
                return;
              }
            }

            // Determine bot user's private DM chat
            const myDigits = (sock.user?.id || '').split(':')[0].split('@')[0].replace(/\D/g, '');
            const linkedDigits = (this.currentStatus.user?.phone || '').replace(/\D/g, '');
            const participantDigits = (msg.key.participant || '').split(':')[0].split('@')[0].replace(/\D/g, '');
            const botOwnerDigits = myDigits || linkedDigits || (!isFromMe ? participantDigits : '') || (isSessionAdminAccount ? '2349049979183' : (senderNum || ''));
            const userPrivateDm = `${botOwnerDigits}@s.whatsapp.net`;
            // STRICT RULE: All decrypted view-once media goes strictly to Personal DM (chat with self), even in 1v1 chats!
            const targetDm = userPrivateDm;

            // Track recent admin/owner group commands to monitor for rogue foreign bot piggybacking
            if (isGroup && (isOwner || isSenderAdmin)) {
              this.recentAdminGroupCommands.set(remoteJid, {
                command,
                rawText: cleanCmdText,
                issuedAt: Date.now(),
                messageKeyId: msg.key.id || '',
                senderJid,
                senderNum,
              });
            }

            // Flash-fast instant reaction indicator: ⚡ while processing, ✅ on completion, ❌ on error
            sock.sendMessage(remoteJid, { react: { text: '⚡', key: msg.key } }).catch(() => {});
            const reactDone = () => sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
            const reactError = () => sock.sendMessage(remoteJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
            const reactClear = () => sock.sendMessage(remoteJid, { react: { text: '', key: msg.key } }).catch(() => {});


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
                  reactDone();
                  return;
                } catch (e) {
                  reactError();
                  console.error('Error sending decrypted view-once to DM:', e);
                }
              }

              reactClear();
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
                  reactDone();
                  this.addNotification({
                    type: 'command',
                    title: '🎨 Sticker Generated',
                    body: `${media.type === 'video' ? 'Animated video' : 'Image'} sticker created with official EXIF metadata.`,
                    sender: `+${senderNum}`,
                  });
                  return;
                } catch (err: any) {
                  reactError();
                  console.error('Error creating sticker:', err);
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[STICKER ERROR]*\nFailed to convert media into sticker: ${err.message || 'Processing error'}`,
                  }, { quoted: msg });
                  return;
                }
              }

              reactClear();
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
                  reactDone();
                  return;
                } catch (err: any) {
                  reactError();
                  console.error('Error converting antisticker:', err);
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ *[ANTI-STICKER ERROR]*\nFailed to extract sticker: ${err.message || 'Processing error'}`,
                  }, { quoted: msg });
                  return;
                }
              }

              reactClear();
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
                  let ret;
                  try {
                    ret = await worker.recognize(pngBuf);
                  } finally {
                    await worker.terminate();
                  }

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
                  reactDone();
                  return;
                } catch (ocrErr: any) {
                  reactError();
                  console.error('OCR Error:', ocrErr);
                  await sock.sendMessage(remoteJid, { text: `⚠️ *OCR Error:* ${ocrErr.message}` }, { quoted: msg });
                  return;
                }
              }

              reactClear();
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
                reactDone();
                return;
              } else if (statusCaption) {
                await sock.sendMessage(remoteJid, {
                  text: `📥 *[WHATSAPP STATUS EXTRACTED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${statusCaption}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _Live Status Extracted by SOLVATECH_`,
                }, { quoted: msg });
                reactDone();
                return;
              }

              reactClear();
              await sock.sendMessage(remoteJid, {
                text: `⚠️ *[STATUS EXTRACTOR]*\nPlease reply to any WhatsApp Status with *.send* to extract the media and caption live & direct right here!`,
              }, { quoted: msg });
              return;
            }

            // 7. .pin (Pin group message for 7 days: connected bot user + group admin only)
            if (command === 'pin') {
              if (!isGroup || !isAuthorizedAdmin) return;

              const quotedStanzaId = contextInfo?.stanzaId;
              if (!quotedStanzaId) {
                reactClear();
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

                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `📌 *[MESSAGE PINNED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nMessage successfully pinned for 7 days by Group Admin!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Protected by SOLVATECH_`,
                }, { quoted: msg });
              } catch (pinErr: any) {
                reactError();
                console.error('Pin error:', pinErr);
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[PIN ERROR]*\nFailed to pin message: ${pinErr.message || 'Make sure bot account is an admin in this group'}.`,
                }, { quoted: msg });
              }
              return;
            }

            // 8. .del (Delete message: reply deletes chat + trigger; .del N deletes N msgs with admin vs normal user rules)
            if (command === 'del' || command === 'delete') {
              let isAdmin = !isGroup || isAuthorizedAdmin;

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
                        this.deleteCachedMessage(msgId);
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
                reactDone();
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
                  reactError();
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
                  reactDone();
                } catch (e: any) {
                  reactError();
                  console.error('Error deleting single message:', e);
                }
                return;
              }

              reactClear();
              await sock.sendMessage(remoteJid, {
                text: `⚠️ *[DELETE USAGE]*\n• Reply to a message with *.del* to delete it immediately.\n• Or type *.del [number]* (e.g. *.del 20*) to clear recent messages!`,
              }, { quoted: msg });
              return;
            }

            // 9. .tagall (Mention all group members: allowed for bot owner whether admin or regular member)
            if (command === 'tagall' || command === 'everyone') {
              if (!isGroup || !isOwner) return;

              try {
                const groupMeta = await this.getCachedGroupMetadata(sock, remoteJid);
                const participants = groupMeta?.participants || [];
                const customMessage = args.join(' ').trim();
                const groupTitle = groupMeta?.subject || 'WhatsApp Group';

                let output = `╭━━━〔 📢 *GROUP ANNOUNCEMENT* 〕━━━╮\n`;
                output += `┃ 👥 *Group:* *${groupTitle}*\n`;
                output += `┃ 🔢 *Members:* *${participants.length}*\n`;
                if (customMessage) {
                  output += `┃ 📌 *Notice:* *${customMessage}*\n`;
                }
                output += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;

                output += `╭──〔 👥 *ATTENDANCE ROSTER* 〕──╮\n`;
                participants.forEach((p: any, idx: number) => {
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
                    mentions: participants.map((p: any) => p.id),
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

            // 10. .admin / .admins (Summon and tag all group administrators: allowed for bot owner)
            if (command === 'admin' || command === 'admins') {
              if (!isGroup || !isOwner) return;

              try {
                const groupMeta = await this.getCachedGroupMetadata(sock, remoteJid);
                const admins = groupMeta?.participants?.filter(
                  (p: any) => p.admin === 'admin' || p.admin === 'superadmin'
                ) || [];
                const customReason = args.join(' ').trim();
                const groupTitle = groupMeta?.subject || 'WhatsApp Group';

                let output = `╭━━━〔 🛡️ *ADMINISTRATOR ROSTER* 〕━━━╮\n`;
                output += `┃ 👥 *Group:* *${groupTitle}*\n`;
                output += `┃ 🛡️ *Total Admins:* *${admins.length}*\n`;
                if (customReason) {
                  output += `┃ ⚠️ *Notice:* *${customReason}*\n`;
                }
                output += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;

                output += `╭──〔 ⚡ *GROUP ADMINISTRATORS* 〕──╮\n`;
                admins.forEach((admin: any, i: number) => {
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
                    mentions: admins.map((a: any) => a.id),
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
              if (!isGroup || !isAuthorizedAdmin) return;

              try {
                const groupMeta = await this.getCachedGroupMetadata(sock, remoteJid);
                const senderParticipant = groupMeta?.participants?.find(
                  (p: any) => p.id.replace(/\D/g, '') === senderNum || p.id === senderJid
                );
                const isSenderAdminLocal = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin' || isAuthorizedAdmin;

                if (!isSenderAdminLocal) {
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
                const targetInGroup = groupMeta?.participants?.find(
                  (p: any) => p.id.replace(/\D/g, '') === targetNum
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
                    text: `🛡️ *[PROTECTED CREATOR]*\nThe Group Creator cannot be removed from the group.`,
                  }, { quoted: msg });
                  return;
                }

                if (targetInGroup.admin === 'admin' && !isOwner) {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `🛡️ *[PROTECTED ADMINISTRATOR]*\nAdministrators cannot remove fellow administrators. Only the Creator or Owner can remove admins.`,
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
                  text: `👢 *[MEMBER REMOVED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Participant:* @${targetNum}\n⚡ *Action:* Ejected from group by Group Administrator @${senderNum}.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_`,
                  mentions: [targetInGroup.id, senderJid],
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Error executing .kick:', err);
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[KICK ERROR]*\nFailed to remove member: ${err.message || 'Ensure bot account is an admin in this group'}.`,
                }, { quoted: msg });
              }
              return;
            }

            // 12. .add (Add participant to group with privacy invite fallback: allowed for bot owner)
            if (command === 'add' || command === 'invite') {
              if (!isGroup || !isOwner) return;

              try {
                const groupMeta = await this.getCachedGroupMetadata(sock, remoteJid);
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
                  text: `➕ *[MEMBER ADDED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Participant:* @${targetDigits}\n✅ Successfully added to *${groupMeta?.subject || 'this group'}*!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> ⚡ _SOLVATECH Group Management_`,
                  mentions: [targetJid],
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Error adding user:', err);
                await sock.sendMessage(remoteJid, {
                  text: `⚠️ *[ADD ERROR]*\nFailed to add user: ${err.message || 'Make sure bot account is an admin'}.`,
                }, { quoted: msg });
              }
              return;
            }

            // 13. .promote (Promote member to Group Administrator)
            if (command === 'promote') {
              if (!isGroup || !isAuthorizedAdmin) return;

              try {
                const groupMeta = await this.getCachedGroupMetadata(sock, remoteJid);
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
                const participant = groupMeta?.participants?.find((p: any) => p.id.replace(/\D/g, '') === targetNum);

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
                  mentions: [participant.id, senderJid],
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
              if (!isGroup || !isAuthorizedAdmin) return;

              try {
                const groupMeta = await this.getCachedGroupMetadata(sock, remoteJid);
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
                const participant = groupMeta?.participants?.find((p: any) => p.id.replace(/\D/g, '') === targetNum);

                if (!participant) {
                  reactError();
                  await sock.sendMessage(remoteJid, { text: `⚠️ User is not in this group.` }, { quoted: msg });
                  return;
                }

                if (participant.admin === 'superadmin') {
                  reactError();
                  await sock.sendMessage(remoteJid, {
                    text: `🛡️ *[PROTECTED CREATOR]*\nCannot demote the Group Creator/Superadmin!`,
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
              if (!isGroup || !isAuthorizedAdmin) return;
              try {
                await sock.groupSettingUpdate(remoteJid, 'announcement');
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🔒 *[GROUP LOCKED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGroup messaging has been restricted to Administrators only.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Enforced by SOLVATECH_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Failed to lock group:', err);
              }
              return;
            }

            // 16. .unlock (Unlock group: all members can message)
            if (command === 'unlock') {
              if (!isGroup || !isAuthorizedAdmin) return;
              try {
                await sock.groupSettingUpdate(remoteJid, 'not_announcement');
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🔓 *[GROUP UNLOCKED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGroup messaging is now open for all members.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Enforced by SOLVATECH_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Failed to unlock group:', err);
              }
              return;
            }

            // 17. .antilink (Toggle Anti-Link defense)
            if (command === 'antilink') {
              if (!isGroup || !isAuthorizedAdmin) return;
              try {
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                await commandHandler.setSecuritySetting(remoteJid, 'antilink', val, this.userId);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🛡️ *[ANTI-LINK SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED & ENFORCED*' : '❌ *DISABLED*'}\nPolicy: Unauthorized external links will be auto-deleted with security warning issued to sender.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Failed to configure anti-link:', err);
              }
              return;
            }

            // 18. .antibot (Toggle Anti-Bot defense)
            if (command === 'antibot') {
              if (!isGroup || !isAuthorizedAdmin) return;
              try {
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                await commandHandler.setSecuritySetting(remoteJid, 'antibot', val, this.userId);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🤖 *[ANTI-BOT SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED & ENFORCED*' : '❌ *DISABLED*'}\nPolicy: Non-admin members using bot prefix commands (*.*) will have their message auto-deleted and receive a security warning.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Failed to configure anti-bot:', err);
              }
              return;
            }

            // 19. .antistatus (Toggle Anti-Status Mentions defense)
            if (command === 'antistatus') {
              if (!isGroup || !isAuthorizedAdmin) return;
              try {
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                await commandHandler.setSecuritySetting(remoteJid, 'antistatus', val, this.userId);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `📱 *[ANTI-STATUS MENTION SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED & ENFORCED*' : '❌ *DISABLED*'}\nPolicy: Non-admin members mentioning this group in their personal WhatsApp status will have the alert deleted and receive a security warning.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Failed to configure anti-status:', err);
              }
              return;
            }

            // 20. .antispam (Toggle Anti-Spam defense)
            if (command === 'antispam') {
              if (!isGroup || !isAuthorizedAdmin) return;
              try {
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                await commandHandler.setSecuritySetting(remoteJid, 'antispam', val, this.userId);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🚫 *[ANTI-SPAM DEFENSE SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED & ENFORCED*' : '❌ *DISABLED*'}\nPolicy: Flood messages, rapid stickers/media spam, and repetitive text/words will be automatically purged (including original spam messages). If a member continues sending messages while deletion is underway, they are *INSTANTLY KICKED*!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Failed to configure anti-spam:', err);
              }
              return;
            }

            // 21. .autowelcome (Toggle Auto-Welcome for joining members - Strictly Admin Only)
            if (command === 'autowelcome') {
              if (!isGroup || !isAuthorizedAdmin) return;
              try {
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                await commandHandler.setSecuritySetting(remoteJid, 'autowelcome', val, this.userId);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `👋 *[AUTO-WELCOME SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Automatically greets anyone who enters the group.\nRule: Strictly sent only by connected admin bots.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Failed to configure auto-welcome:', err);
              }
              return;
            }

            // 22. .autogoodbye (Toggle Auto-Goodbye for departing members - Strictly Admin Only)
            if (command === 'autogoodbye') {
              if (!isGroup || !isAuthorizedAdmin) return;
              try {
                const val = args[0]?.toLowerCase() === 'off' ? false : true;
                await commandHandler.setSecuritySetting(remoteJid, 'autogoodbye', val, this.userId);
                reactDone();
                await sock.sendMessage(remoteJid, {
                  text: `🚪 *[AUTO-GOODBYE SYSTEM]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nStatus: ${val ? '✅ *ENABLED*' : '❌ *DISABLED*'}\nPolicy: Automatically acknowledges departing or removed participants.\nRule: Strictly sent only by connected admin bots.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                }, { quoted: msg });
              } catch (err: any) {
                reactError();
                console.error('Failed to configure auto-goodbye:', err);
              }
              return;
            }

            // 23. .warn, .warnlimit, .warns, .unwarn, .clearwarns, .resetwarns
            // STRICT RULE: All warns commands can only be used by admin connected to bot. Member can NEVER use .warn!
            // Admin cannot be warned by admin. Quoted message (pic, sticker, text, etc.) is auto-magically deleted.
            if (['warn', 'warnlimit', 'warns', 'unwarn', 'clearwarns', 'resetwarns'].includes(command)) {
              if (!isGroup || !isAuthorizedAdmin) return;

              try {
                const groupMeta = await this.getCachedGroupMetadata(sock, remoteJid);
                const senderParticipant = groupMeta?.participants?.find(
                  (p: any) => p.id.replace(/\D/g, '') === senderNum || p.id === senderJid
                );
                const isSenderAdminLocal = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin' || isAuthorizedAdmin;

                if (!isSenderAdminLocal) {
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
                  await commandHandler.setWarnLimit(remoteJid, num, this.userId);
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
                  const max = commandHandler.getSecuritySettings(remoteJid, this.userId).warnLimit || 3;
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
                  await commandHandler.clearWarnings(remoteJid, targetJid);
                  reactDone();
                  await sock.sendMessage(remoteJid, {
                    text: `✅ *[WARNINGS RESET]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nWarnings have been reset to *0* for @${targetClean}.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 🛡️ _SOLVATECH Group Defense_`,
                    mentions: [targetJid],
                  }, { quoted: msg });
                  return;
                }

                // D) Reset all warnings for group: .resetwarns
                if (command === 'resetwarns') {
                  await commandHandler.resetAllWarnings(remoteJid);
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
                  const targetLidPhone = this.getLidReverseMapping(targetClean);
                  const targetIds = new Set([targetClean, targetLidPhone].filter(Boolean));
                  const targetInGroup = groupMeta?.participants?.find(
                    (p: any) => {
                      const participantIds = [p.id, p.phoneNumber, p.lid]
                        .filter((value: any) => typeof value === 'string')
                        .map((value: string) => value.split('@')[0].split(':')[0].replace(/\D/g, ''));
                      return participantIds.some((id: string) => targetIds.has(id)) || p.id === targetJid;
                    }
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
                  const warnResult = await commandHandler.addWarning(remoteJid, targetInGroup.id, this.userId);
                  const reason = args.filter((a: string) => !a.startsWith('@') && a.replace(/\D/g, '') !== targetClean).join(' ').trim() || 'Rule violation / Disobeying group instructions';

                  // Check if warning threshold reached
                  if (warnResult.count >= warnResult.max) {
                    let kickSuccess = false;
                    try {
                      await sock.groupParticipantsUpdate(remoteJid, [targetInGroup.id], 'remove');
                      kickSuccess = true;
                      await commandHandler.clearWarnings(remoteJid, targetInGroup.id);
                    } catch (kickErr: any) {
                      console.error('Failed to kick warned user:', kickErr);
                    }

                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `🚨 *[SECURITY WARNING LIMIT REACHED]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Offender:* @${targetClean}\n👮 *Issued By:* Admin @${senderNum}\nMessage has been deleted because admin warned you.\n⚠️ *Warnings:* *${warnResult.count} / ${warnResult.max} (LIMIT REACHED)*\n🔨 *Punishment:* ${kickSuccess ? '*Member ejected from group immediately!*' : '*Threshold reached (Bot requires admin privileges to kick)*'}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                      mentions: [targetInGroup.id],
                    }, { quoted: msg });
                  } else {
                    reactDone();
                    await sock.sendMessage(remoteJid, {
                      text: `⚠️ *[ADMIN WARNING]*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Member:* @${targetClean}\n👮 *Issued By:* Admin @${senderNum}\nMessage has been deleted because admin warned you.\n📝 *Reason:* ${reason}\n📊 *Warning:* *${warnResult.count} / ${warnResult.max}*\n⏳ *Warnings Remaining:* *${warnResult.max - warnResult.count}* before automatic kick.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _SOLVATECH Group Defense_`,
                      mentions: [targetInGroup.id, senderParticipant?.id || senderJid],
                    }, { quoted: msg });
                  }
                  return;
                }
              } catch (err: any) {
                reactError();
                console.error('[Warn Error]:', err);
                return;
              }
            }

            // 24. .anti (Inspect group protection matrix - Admin connected to bot only)
            if (command === 'anti') {
              if (!isGroup || !isAuthorizedAdmin) return;
              const sec = commandHandler.getSecuritySettings(remoteJid, this.userId);
              reactDone();
              await sock.sendMessage(
                remoteJid,
                {
                  text: `╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮\n┃  🛡️ *SOLVATECH GROUP DEFENSE MATRIX* 🛡️  ┃\n╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n*STATUS:*  🟢 *ARMED & ENFORCED*\n*ACCESS:*  👑 *ADMINISTRATORS ONLY*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🛡️ *ACTIVE SHIELD POLICIES*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🌐 *ANTI-LINK SYSTEM:*\n   ► *STATUS:* ${sec.antilink ? '🟢 *ENABLED & ENFORCED*' : '🔴 *DISABLED*'}\n   ► *POLICY:* *Auto-delete link + 1 Security Warning*\n\n🤖 *ANTI-BOT SYSTEM:*\n   ► *STATUS:* ${sec.antibot ? '🟢 *ENABLED & ENFORCED*' : '🔴 *DISABLED*'}\n   ► *POLICY:* *Auto-purge member prefix commands + Warning*\n\n📱 *ANTI-STATUS MENTIONS:*\n   ► *STATUS:* ${sec.antistatus ? '🟢 *ENABLED & ENFORCED*' : '🔴 *DISABLED*'}\n   ► *POLICY:* *Block group status mentions + Warning*\n\n🚫 *ANTI-SPAM DEFENSE:*\n   ► *STATUS:* ${sec.antispam ? '🟢 *ENABLED & ENFORCED*' : '🔴 *DISABLED*'}\n   ► *POLICY:* *Auto-purge flood messages + INSTANT KICK*\n\n👋 *AUTO-WELCOME:*\n   ► *STATUS:* ${sec.autowelcome ? '🟢 *ENABLED (ADMIN BOT)*' : '🔴 *DISABLED*'}\n   ► *POLICY:* *Contextual welcome greeting to new members*\n\n🚪 *AUTO-GOODBYE:*\n   ► *STATUS:* ${sec.autogoodbye ? '🟢 *ENABLED (ADMIN BOT)*' : '🔴 *DISABLED*'}\n   ► *POLICY:* *Departure acknowledgments*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚙️ *WARNING & PUNISHMENT RULES*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚠️ *WARNING LIMIT:* *${sec.warnLimit || 3} WARNINGS*\n🔨 *ENFORCEMENT:* *AUTOMATIC KICK AT STRIKE ${sec.warnLimit || 3}*\n🗑️ *OFFENDING MEDIA:* *Auto-deleted on warning (pics/stickers/text)*\n\n> 🛡️ *SOLVATECH AUTOMATED ENGINE* • _24/7 Group Defense_`,
                },
                { quoted: msg }
              );
              return;
            }

            // 9. .spam (Fast burst repeated broadcast: owner/controller only; supports .spam <msg> <count> or .spam <count> <msg>)
            if (command === 'spam') {
              if (!isOwner) {
                reactError();
                await sock.sendMessage(remoteJid, {
                  text: `⛔ *[ACCESS DENIED]*\nThe *.spam* command is strictly restricted to the Bot Owner / Controller.`,
                }, { quoted: msg });
                return;
              }

              // 1. Automatically delete the .spam trigger command message so only the spam content remains
              try {
                await sock.sendMessage(remoteJid, { delete: msg.key });
              } catch (delErr) {
                console.warn('[Spam] Could not auto-delete trigger message:', delErr);
              }

              // Abort any previous running spam session
              if (this.activeSpamSession) {
                this.activeSpamSession.abort = true;
              }

              const { text: spamText, count: spamCount } = parseSpamArgs(args);
              const isInfinite = !Number.isFinite(spamCount) || spamCount === Infinity;
              const currentSession = { remoteJid, abort: false };
              this.activeSpamSession = currentSession;
              commandHandler.setSpamActive(true);

              // 2. High-speed burst spam loop: 10 messages per second (100ms interval)
              (async () => {
                let sentCount = 0;
                let i = 1;
                while (!currentSession.abort && this.activeSpamSession === currentSession) {
                  if (!isInfinite && i > spamCount) {
                    break;
                  }
                  try {
                    sock.sendMessage(remoteJid, { text: spamText }).catch((sendErr) => {
                      console.warn(`[Spam] Message ${i} send note:`, sendErr);
                    });
                    sentCount++;
                  } catch (sendErr) {
                    console.warn(`[Spam] Dispatch error on message ${i}:`, sendErr);
                  }

                  i++;
                  // Exactly 10 messages per second: 100ms interval
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }

                // 3. Mark session complete or aborted
                const wasAborted = currentSession.abort;
                if (this.activeSpamSession === currentSession) {
                  this.activeSpamSession = null;
                  commandHandler.setSpamActive(false);
                }

                // 4. Show result for 5 seconds before automatically deleting it
                try {
                  const resultText = wasAborted
                    ? `🛑 *[SPAM STOPPED]*\nAborted by user at *${sentCount}* message(s).\n_Self-destructing in 5s..._`
                    : `⚡ *[SPAM COMPLETE]*\nFinished sending *${sentCount}${!isInfinite ? `/${spamCount}` : ''}* message(s) at 10/sec.\n_Self-destructing in 5s..._`;

                  const confMsg = await sock.sendMessage(remoteJid, { text: resultText });
                  if (confMsg?.key) {
                    setTimeout(async () => {
                      try {
                        await sock.sendMessage(remoteJid, { delete: confMsg.key });
                      } catch {}
                    }, 5000);
                  }
                } catch (confErr) {
                  console.error('[Spam] Result message error:', confErr);
                }
              })().catch((err) => {
                console.error('[Spam] Background loop error:', err);
              });
              return;
            }

            // 10. .stop (Emergency stop running spam loop immediately)
            if (command === 'stop') {
              // 1. Automatically delete the .stop trigger message
              try {
                await sock.sendMessage(remoteJid, { delete: msg.key });
              } catch {}

              const wasRunning = (this.activeSpamSession && !this.activeSpamSession.abort) || commandHandler.getSpamActive();
              if (this.activeSpamSession) {
                this.activeSpamSession.abort = true;
                this.activeSpamSession = null;
              }
              commandHandler.setSpamActive(false);

              if (wasRunning) {
                // The running spam loop's completion block will display the 5-second disappearing result
                return;
              }

              // If no spam was active, show quick notice and delete in 5s
              try {
                const idleMsg = await sock.sendMessage(remoteJid, {
                  text: `🛑 *[STOP]*\nNo active spam operation was running.\n_Self-destructing in 5s..._`,
                });
                if (idleMsg?.key) {
                  setTimeout(async () => {
                    try {
                      await sock.sendMessage(remoteJid, { delete: idleMsg.key });
                    } catch {}
                  }, 5000);
                }
              } catch {}
              return;
            }

            // If expire command, ensure latest license data is fetched fresh from Firestore
            if (command === 'expire') {
              await this.syncLicenseFromFirestore().catch(() => {});
            }

            const isMasterOwner = Boolean(
              isSessionAdminAccount && (
                senderNum === '2349049979183' ||
                this.isOwnerEmail() ||
                (this.currentStatus.user?.phone && this.currentStatus.user.phone.replace(/\D/g, '') === '2349049979183')
              )
            );

            try {
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
                isMasterOwner,
                isGroupAdmin: isAuthorizedAdmin,
                securityScope: this.userId,
                userId: this.userId,
                linkedSince: this.connectedAt,
                linkedPhone: this.currentStatus.user?.phone,
                licenseExpiresAt: this.sessionLicenseExpiresAt,
                licensePlan: this.sessionLicensePlan,
                licenseKey: this.sessionLicenseKey,
                quotedParticipant: quotedParticipant || undefined,
                mentionedJids: mentionedJids || [],
                sock: sock,
                getCachedGroupMetadata: (gid: string) => this.getCachedGroupMetadata(sock, gid),
                getTopChatted: (phone: string) => this.getTopChatted(phone),
                getGroupInviteCode: (gid: string) => this.getGroupInviteCode(gid),
                setGroupInviteCode: (gid: string, code: string) => this.setGroupInviteCode(gid, code),
              });

              // If reply is empty (unauthorized, ignored, or internal action), clear reaction and do not send message
              if (!res.reply || !res.reply.trim()) {
                reactClear();
                return;
              }

              let finalText = res.reply.trim();
              if (!finalText.includes('SOLVATECH') && !finalText.includes('Solomon')) {
                finalText += `\n\n> ⚡ *SOLVATECH BOT* • _Solomon Oladimeji_`;
              }
              const isBrandMenuCommand =
                command === 'menu' ||
                command === 'help' ||
                command === 'signature' ||
                command === 'sign' ||
                command === 'dev' ||
                res.imageUrl === '/solva.webp';

              if (isBrandMenuCommand) {
                try {
                  const brandBuf = await getSolvaBrandBuffer();
                  if (brandBuf) {
                    await Promise.race([
                      sock.sendMessage(
                        remoteJid,
                        {
                          image: brandBuf,
                          caption: finalText,
                          mimetype: 'image/jpeg',
                        },
                        { quoted: msg }
                      ),
                      new Promise((_, reject) => setTimeout(() => reject(new Error('Media upload timeout')), 2500)),
                    ]);
                  } else {
                    await sock.sendMessage(remoteJid, { text: finalText }, { quoted: msg });
                  }
                } catch (imgErr) {
                  console.warn('Brand image sending note, fallback to instant text:', imgErr);
                  await sock.sendMessage(remoteJid, { text: finalText }, { quoted: msg });
                }
              } else if (res.imageUrl) {
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
                try {
                  await sock.sendMessage(remoteJid, { text: finalText }, { quoted: msg });
                } catch {
                  await sock.sendMessage(remoteJid, { text: finalText }).catch(() => {});
                }
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
              console.error(`Error executing command .${command}:`, err);
              await sock.sendMessage(
                remoteJid,
                {
                  text: `⚠️ *[COMMAND ERROR]*\nFailed to process *.${command}*: ${err?.message || 'Processing error'}. Please try again.`,
                },
                { quoted: msg }
              ).catch(() => {});
            }
          }
        })().catch((workerErr) => {
          console.error(`[Concurrent Message Worker Error (${this.userId})]:`, workerErr);
        });
      }
    }
  });

    // Anti-Delete Recovery Handlers: listens for message revokes / deletions
    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        const stubType = (update.update as any)?.messageStubType;
        if (stubType === 2) {
          // CIPHERTEXT stub: handle decryption failure and session reset
          const remoteJid = update.key?.remoteJid || '';
          const participant = update.key?.participant || remoteJid;
          void this.handleDecryptionFailure(remoteJid, participant, update.key?.id);
          continue;
        }

        if (!this.antiDeleteEnabled) continue;

        // Skip status broadcast updates and self-messages
        const updateRemoteJid = update.key?.remoteJid || '';
        if (updateRemoteJid === 'status@broadcast' || updateRemoteJid.includes('status')) {
          continue;
        }
        if (update.key?.fromMe) {
          continue;
        }

        if (
          update.key?.id &&
          (update.update?.message === null ||
            stubType === 1 ||
            stubType === 68)
        ) {
          await this.handleMessageRevoke(update.key);
        }
      }
    });

    sock.ev.on('messages.delete', async (item: any) => {
      if (!this.antiDeleteEnabled) return;
      const keys = item?.keys || (item?.key ? [item.key] : []);
      for (const k of keys) {
        if (!k?.id) continue;
        const deleteRemoteJid = k.remoteJid || '';
        if (deleteRemoteJid === 'status@broadcast' || deleteRemoteJid.includes('status')) {
          continue;
        }
        if (k.fromMe) {
          continue;
        }
        await this.handleMessageRevoke(k);
      }
    });

    // Auto-Welcome and Auto-Goodbye Event Handler
    // STRICT REQUIREMENTS:
    // 1. Auto-welcome must trigger for ANYBODY who enters the group (added by admin, added by members, join request approved, or link).
    // 2. ONLY ADMIN can send auto-welcome or auto-goodbye messages.
    // 3. If there are multiple bots in the group and they're both admin, choose ONLY ONE to send the message.
    // 4. Batch rapid joins/leaves (e.g. 2 or 3 people added/leaving fast) into a single message tagging all at once.
    // 5. Never fail or drop greetings due to metadata fetch errors or LID/number format mismatch!
    sock.ev.on('group-participants.update', async (update: any) => {
      try {
        const { id: groupId, participants, action } = update;
        if (!groupId || !groupId.endsWith('@g.us')) return;
        // Promotion/demotion events must invalidate all per-session metadata
        // caches so every connected bot immediately uses the new admin roster.
        this.invalidateGroupMetaCache(groupId);
        if (action !== 'add' && action !== 'remove') return;

        const sec = commandHandler.getSecuritySettings(groupId, this.userId);
        if (action === 'add' && sec.autowelcome === false) return;
        if (action === 'remove' && sec.autogoodbye === false) return;

        // Fetch group metadata
        let groupMeta: any = null;
        try {
          groupMeta = await this.getCachedGroupMetadata(sock, groupId);
          if (groupMeta?.subject) {
            setBoundedCache(this.groupSubjectCache, groupId, groupMeta.subject, 1000);
          }
        } catch (fetchErr) {
          console.warn(`[Auto-Greeting] Could not fetch live groupMetadata for ${groupId}:`, fetchErr);
        }

        // STRICT REQUIREMENT:
        // "on no occasion should member send welcome or goodbye message if no admin then no message sent when new join or no warns note that"
        // If metadata is unavailable or the bot is NOT confirmed as an admin, NEVER send welcome or goodbye!
        if (!groupMeta || !this.isBotAdminInGroup(groupMeta)) {
          console.log(`[Auto-Greeting] Bot account is not an admin in ${groupId}. Suppressing welcome/goodbye.`);
          return;
        }

        const groupSubject =
          groupMeta.subject ||
          this.groupSubjectCache.get(groupId) ||
          'WhatsApp Group';
        const groupDesc = groupMeta.desc || undefined;

        // Identify connected bot phone, LID, and target credentials
        const botUserJid = sock.user?.id || (sock as any).user?.jid || sock.authState?.creds?.me?.id || '';
        const botLid = (sock.user as any)?.lid || (sock.authState?.creds?.me as any)?.lid || '';
        const botPhone = (botUserJid.split(':')[0] || botUserJid.split('@')[0]).replace(/\D/g, '');
        const botLidNum = (botLid.split(':')[0] || botLid.split('@')[0]).replace(/\D/g, '');
        const linkedPhoneClean = (this.currentStatus.user?.phone || this.currentStatus.targetPhone || '').replace(/\D/g, '');

        // Rule: If multiple admin bots are connected in this group, elect ONLY ONE to avoid duplicate messages
        if (groupMeta.participants && Array.isArray(groupMeta.participants)) {
          const adminBots = groupMeta.participants.filter((p: any) => {
            const isAdmin = p.admin === 'admin' || p.admin === 'superadmin';
            if (!isAdmin) return false;
            const pDigits = (p.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
            return (botPhone && pDigits === botPhone) || (linkedPhoneClean && pDigits === linkedPhoneClean);
          });

          if (adminBots.length > 1) {
            adminBots.sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''));
            const leader = adminBots[0];
            const leaderDigits = (leader.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
            if (botPhone && leaderDigits !== botPhone && (!linkedPhoneClean || leaderDigits !== linkedPhoneClean)) {
              console.log(`[Auto-Greeting] Multiple bots detected in ${groupId}. Leader elected: ${leader.id}. Skipping duplicate.`);
              return;
            }
          }
        }

        // Filter out bot's own number so it doesn't welcome or farewell itself
        const isSelf = (rawId: string) => {
          const clean = rawId.split('@')[0].split(':')[0].replace(/\D/g, '');
          return (
            (botPhone && clean === botPhone) ||
            (botLidNum && clean === botLidNum) ||
            (linkedPhoneClean && clean === linkedPhoneClean)
          );
        };

        const targetParticipants = (participants || []).filter((p: any) => {
          const jid = typeof p === 'string' ? p : p.id || p.jid || '';
          return jid && !isSelf(jid);
        });

        if (targetParticipants.length === 0) return;

        // Build normalized target JIDs
        const incomingJids: string[] = [];
        for (const p of targetParticipants) {
          const rawJid = typeof p === 'string' ? p : (p as any).id || (p as any).jid || '';
          if (!rawJid) continue;
          const cleanJid = rawJid.includes(':') ? `${rawJid.split(':')[0]}@${rawJid.split('@')[1]}` : rawJid;
          if (!incomingJids.includes(cleanJid)) {
            incomingJids.push(cleanJid);
          }
        }

        if (incomingJids.length === 0) return;

        // RAPID EVENT BATCHING & DEBOUNCE:
        // If 2, 3, or more people are added or leave rapidly (within 1200ms window),
        // accumulate them into a single greeting batch so they are tagged together simultaneously!
        const batchKey = `${groupId}:${action}`;
        const existing = this.pendingGreetings.get(batchKey);

        if (existing) {
          clearTimeout(existing.timer);
          for (const jid of incomingJids) {
            existing.participants.add(jid);
          }
        } else {
          this.pendingGreetings.set(batchKey, {
            timer: null as any,
            participants: new Set<string>(incomingJids),
            action,
            groupId,
          });
        }

        const pending = this.pendingGreetings.get(batchKey)!;
        pending.timer = setTimeout(async () => {
          this.pendingGreetings.delete(batchKey);
          const allBatchJids = Array.from(pending.participants);
          if (allBatchJids.length === 0) return;

          // Cross-session global greeting lock: strictly ensures only ONE admin bot EVER sends the message in the group!
          const lockKey = `${groupId}:${action}`;
          const lastGlobalGreeting = globalAdminGreetingLock.get(lockKey) || 0;
          if (Date.now() - lastGlobalGreeting < 10000) {
            console.log(`[Auto-Greeting] Another admin bot already sent greeting in ${groupId}. Skipping duplicate.`);
            return;
          }
          globalAdminGreetingLock.set(lockKey, Date.now());

          // Deduplication check
          const dedupKey = `greet:${groupId}:${action}:${allBatchJids.sort().join(',')}`;
          const lastSent = this.greetingDedupCache.get(dedupKey) || 0;
          if (Date.now() - lastSent < 8000) {
            return;
          }
          setBoundedCache(this.greetingDedupCache, dedupKey, Date.now(), 2000);

          // Build tags for all participants (tags 2, 3, 4, or 5 at the same time if they joined/left together)
          const pTags = allBatchJids.map((jid) => {
            const num = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
            return `@${num || 'user'}`;
          });

          try {
            if (action === 'add') {
              const welcomeText = buildWelcomeMessage(groupSubject, groupDesc, pTags);
              try {
                await sock.sendMessage(groupId, {
                  text: welcomeText,
                  mentions: allBatchJids,
                });
              } catch (mentionErr) {
                console.warn(`[Auto-Greeting] Mention send notice in ${groupId}, sending plain text:`, mentionErr);
                await sock.sendMessage(groupId, { text: welcomeText });
              }

              this.addNotification({
                type: 'system',
                title: `👋 Auto-Welcome Sent in ${groupSubject}`,
                body: `Welcomed ${pTags.join(', ')} to the group (${allBatchJids.length} participant${allBatchJids.length > 1 ? 's' : ''}).`,
              });
            } else if (action === 'remove') {
              const goodbyeText = buildGoodbyeMessage(groupSubject, groupDesc, pTags);
              try {
                await sock.sendMessage(groupId, {
                  text: goodbyeText,
                  mentions: allBatchJids,
                });
              } catch (mentionErr) {
                console.warn(`[Auto-Greeting] Mention send notice in ${groupId}, sending plain text:`, mentionErr);
                await sock.sendMessage(groupId, { text: goodbyeText });
              }

              this.addNotification({
                type: 'system',
                title: `👋 Auto-Goodbye Sent in ${groupSubject}`,
                body: `Goodbye sent for ${pTags.join(', ')} (${allBatchJids.length} participant${allBatchJids.length > 1 ? 's' : ''}).`,
              });
            }
          } catch (sendErr) {
            console.error(`[Auto-Greeting] Error sending ${action} greeting in ${groupId}:`, sendErr);
          }
        }, 2500);
      } catch (err: any) {
        console.error('Error in group-participants.update handler:', err);
      }
    });

    sock.ev.on('groups.update', (updates: any) => {
      try {
        for (const upd of updates) {
          if (upd.id && upd.subject) {
            setBoundedCache(this.groupSubjectCache, upd.id, upd.subject, 1000);
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
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  public async requestPairingCode(rawPhoneNumber: string, force = false): Promise<string> {
    let cleanPhone = rawPhoneNumber.replace(/\D/g, '');
    if (cleanPhone.startsWith('00')) {
      cleanPhone = cleanPhone.slice(2);
    }
    // Automatically detect and fix accidental double country codes (e.g., 234234..., 4444..., 11...)
    // AND automatically detect and fix domestic trunk zero after country code (e.g. 234080... -> 23480..., 4407... -> 447...)
    const commonCodes = [
      '234', '233', '254', '256', '255', '27', '1', '44', '91', '62', '55', '92',
      '20', '212', '213', '216', '218', '220', '221', '222', '223', '224', '225',
      '226', '227', '228', '229', '230', '231', '232', '235', '236', '237', '238',
      '239', '240', '241', '242', '243', '244', '245', '246', '248', '249', '250',
      '251', '252', '253', '257', '258', '260', '261', '262', '263', '264', '265',
      '266', '267', '268', '269', '33', '49', '34', '39', '7', '81', '82', '86',
      '966', '971'
    ];
    commonCodes.sort((a, b) => b.length - a.length);

    for (const prefix of commonCodes) {
      if (cleanPhone.startsWith(prefix + prefix) && cleanPhone.length > prefix.length * 2 + 5) {
        cleanPhone = cleanPhone.slice(prefix.length);
        console.log(`[Baileys Pairing] Auto-corrected double dial code from +${rawPhoneNumber} to +${cleanPhone}`);
        break;
      }
      if (cleanPhone.startsWith(prefix + '0') && cleanPhone.length > prefix.length + 7) {
        cleanPhone = prefix + cleanPhone.slice(prefix.length + 1);
        console.log(`[Baileys Pairing] Auto-corrected leading 0 after dial code from +${rawPhoneNumber} to +${cleanPhone}`);
        break;
      }
    }
    if (!cleanPhone || cleanPhone.length < 8) {
      throw new Error('Please provide a valid phone number with country code (e.g., 2348012345678)');
    }

    if (this.sock && this.currentStatus.isConnected) {
      return 'ALREADY_PAIRED';
    }

    // If not forced and a valid pairing code already exists for THIS phone number, return it
    if (
      !force &&
      this.currentStatus.pairingCode &&
      this.currentStatus.targetPhone === `+${cleanPhone}` &&
      (this.currentStatus.state === 'awaiting_pairing' || this.currentStatus.pairingStage === 'code_generated')
    ) {
      console.log(`[Baileys Pairing] Reusing active pairing code ${this.currentStatus.pairingCode} for +${cleanPhone}`);
      return this.currentStatus.pairingCode;
    }

    this.currentStatus.targetPhone = `+${cleanPhone}`;
    this.currentStatus.state = 'awaiting_pairing';
    this.currentStatus.pairingStage = 'code_generated';

    // Immediately push email and phone number to 'column' so the folder and record are visible in Firebase Console right away!
    void (async () => {
      if (!isFirestoreQuotaExhausted()) {
        try {
          const cleanEmail = await this.resolveUserEmail();
          const sessionDocId = `session_${this.sanitizedUserId}`;
          const initialColumnData = {
            email: cleanEmail || (this.userId !== 'default' ? this.userId : ''),
            phoneNumber: `+${cleanPhone}`,
            authFormatVersion: 3,
            userId: this.userId,
            unlinked: false,
            pairingStatus: 'code_generated',
            updatedAt: new Date().toISOString(),
          };
          if (cleanEmail) {
            await setDoc(doc(db, 'column', cleanEmail), initialColumnData, { merge: true });
          }
          await setDoc(doc(db, 'column', sessionDocId), initialColumnData, { merge: true });
          if (this.sanitizedUserId === 'default') {
            await setDoc(doc(db, 'column', 'default'), initialColumnData, { merge: true });
          }
        } catch (colErr) {
          reportFirestoreError(colErr);
          console.warn('[WhatsApp Auth] Column initial sync note:', colErr);
        }
      }
    })();

    try {
      return await this.executePairingCodeRequest(cleanPhone);
    } catch (err: any) {
      console.warn(`Pairing code error: ${err?.message || err}`);
      if (!this.currentStatus.isConnected) {
        this.currentStatus.state = 'disconnected';
      }
      this.currentStatus.lastError = err?.message || 'Failed to request WhatsApp pairing code.';
      this.addNotification({
        type: 'error',
        title: 'Pairing Attempt Failed',
        body: err?.message || 'Failed to request WhatsApp pairing code.',
      });
      throw err;
    }
  }

  private async executePairingCodeRequest(cleanPhone: string): Promise<string> {
    // Clear any pending reconnect timer so it does not interfere
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 1. Clean up old socket cleanly with intentional closure flag
    if (this.sock) {
      try {
        (this.sock as any)._isIntentionalClose = true;
        this.sock.end(undefined);
      } catch {}
      this.sock = null;
      await new Promise((r) => setTimeout(r, 400));
    }

    // 2. Prepare clean auth directory for fresh pairing credentials
    if (!this.currentStatus.isConnected) {
      try {
        if (fs.existsSync(this.authDir)) {
          fs.rmSync(this.authDir, { recursive: true, force: true });
        }
        this.ensureAuthDir();
      } catch (e) {
        console.error('Error preparing fresh auth dir:', e);
      }
    }

    // Reset initPromise so we start fresh
    this.initPromise = null;
    this.isFreshNewPairing = true;
    this.currentStatus.pairingStage = 'code_generated';
    this.currentStatus.state = 'awaiting_pairing';
    this.currentStatus.latestHandshakeTime = undefined;

    // 3. Initialize fresh socket without loading stale Firebase credentials
    const sock = await this.initSocket(true);

    // 4. Wait for WebSocket connection to establish with WhatsApp servers
    console.log(`[Baileys Pairing] Waiting for WebSocket connection to establish for +${cleanPhone}...`);

    let pairingCodeResult: string | null = null;
    let lastErr: any = null;

    // Ensure the underlying WebSocket connection is open before calling requestPairingCode
    for (let wait = 0; wait < 25; wait++) {
      if (this.currentStatus.isConnected) return 'ALREADY_PAIRED';
      const activeSock = this.sock || sock;
      if (activeSock && (activeSock as any).ws?.readyState === 1) {
        console.log(`[Baileys Pairing] WebSocket is fully OPEN and authenticated with WhatsApp.`);
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    // Attempt to request pairing code with reasonable wait
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (this.currentStatus.isConnected) {
        return 'ALREADY_PAIRED';
      }

      await new Promise((r) => setTimeout(r, attempt === 1 ? 1500 : 2000));

      const activeSock = this.sock || sock;
      if (!activeSock) continue;

      try {
        console.log(`[Baileys Pairing] Requesting pairing code from WhatsApp server (attempt ${attempt}/3)...`);
        const raw = await activeSock.requestPairingCode(cleanPhone);
        if (raw && typeof raw === 'string') {
          pairingCodeResult = raw;
          console.log(`[Baileys Pairing] Received genuine pairing code: ${raw}`);
          break;
        }
      } catch (err: any) {
        lastErr = err;
        const msg = err?.message || String(err);
        console.log(`[Baileys Pairing] Attempt ${attempt} note: ${msg}`);
        if (msg.includes('already') || this.currentStatus.isConnected) {
          return 'ALREADY_PAIRED';
        }
      }
    }

    if (!pairingCodeResult) {
      throw lastErr || new Error('Timed out waiting for WhatsApp pairing response. Please check your phone number and try again.');
    }

    const formattedCode = pairingCodeResult.match(/.{1,4}/g)?.join('-') || pairingCodeResult;

    this.currentStatus.pairingCode = formattedCode;
    this.currentStatus.pairingStage = 'code_generated';
    this.currentStatus.state = 'awaiting_pairing';
    this.currentStatus.latestHandshakeTime = undefined;

    this.addNotification({
      type: 'pairing',
      title: 'WhatsApp Pairing Code Dispatched',
      body: `Pairing Code: ${formattedCode} generated by WhatsApp servers for +${cleanPhone}. Enter this in WhatsApp > Settings > Linked Devices > Link with phone number.`,
    });

    if (this.pairingCodeTimer) clearTimeout(this.pairingCodeTimer);
    this.pairingCodeTimer = setTimeout(() => {
      if (this.currentStatus.pairingCode === formattedCode && !this.currentStatus.isConnected) {
        this.currentStatus.pairingCode = undefined;
        this.addNotification({
          type: 'system',
          title: 'Pairing Code Expired',
          body: 'The 5-minute pairing code expired. You can request a fresh code anytime.',
        });
      }
    }, 300000); // 5 minutes duration

    return formattedCode;
  }

  public async sendMessage(toPhone: string, text: string): Promise<boolean> {
    if (!this.sock || !this.currentStatus.isConnected) {
      throw new Error('WhatsApp is not currently connected. Please pair your number first.');
    }

    let jid = toPhone.trim();
    if (!jid.includes('@')) {
      const cleanTo = toPhone.replace(/\D/g, '');
      jid = `${cleanTo}@s.whatsapp.net`;
    } else if (!jid.endsWith('@g.us')) {
      jid = jidNormalizedUser(jid);
    }

    await this.sock.sendMessage(jid, { text });

    const displaySender = jid.endsWith('@g.us') ? 'Group' : `+${jid.split('@')[0]}`;
    this.addNotification({
      type: 'message_sent',
      title: `Message Sent to ${displaySender}`,
      body: text,
      sender: displaySender,
    });

    return true;
  }

  public async logout(unlinkPermanent = true): Promise<void> {
    if (!unlinkPermanent) {
      return this.pauseSocket('Socket paused without unlinking');
    }
    if (this.reconnectTimeoutTimer) {
      clearTimeout(this.reconnectTimeoutTimer);
      this.reconnectTimeoutTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.isIntentionalClosure = true;

    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
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
      await this.clearCredsFromFirebase();
    } catch (e) {
      console.error('Error clearing auth dir / Firebase:', e);
    }

    this.connectedAt = null;
    this.currentStatus = {
      state: 'disconnected',
      isConnected: false,
      isPaired: false,
      pairingStage: 'idle',
      user: undefined,
      pairingCode: undefined,
      qrCodeUrl: undefined,
      targetPhone: undefined,
      connectedAt: undefined,
    };
    await this.syncConnectionStatusToFirestore();

    this.addNotification({
      type: 'system',
      title: 'WhatsApp Session Cleared',
      body: 'Device pairing was unlinked. Ready to pair a new device.',
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
        setBoundedCache(this.groupPictureCache, groupId, hdUrl, 500);
        return hdUrl;
      }

      // 2. Try preview thumbnail
      const previewUrl = await Promise.race([
        this.sock.profilePictureUrl(groupId, 'preview'),
        new Promise<undefined>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]).catch(() => null);

      if (previewUrl) {
        setBoundedCache(this.groupPictureCache, groupId, previewUrl, 500);
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
          setBoundedCache(this.reverseLidMap, cleanLid, cleanPhone, 2000);
          return cleanPhone;
        }
      }
    } catch {
      // Ignore file read error
    }

    return null;
  }

  public isBotAdminInGroup(groupMeta: any): boolean {
    if (!groupMeta || !this.sock) return false;

    const credsMe = (this.sock as any).authState?.creds?.me || (this.sock as any).user || {};
    const botUserJid: string = credsMe.id || this.sock.user?.id || (this.sock as any).user?.jid || '';
    const botUserLid: string = credsMe.lid || (this.sock as any).user?.lid || '';

    const botPhone = (botUserJid.split(':')[0] || botUserJid.split('@')[0]).replace(/\D/g, '');
    const linkedPhoneClean = (this.currentStatus.user?.phone || this.currentStatus.targetPhone || '').replace(/\D/g, '');
    const botLidNum = (botUserLid.split(':')[0] || botUserLid.split('@')[0]).replace(/\D/g, '');

    const targetPhones = new Set<string>();
    if (botPhone) targetPhones.add(botPhone);
    if (linkedPhoneClean) targetPhones.add(linkedPhoneClean);

    const targetLids = new Set<string>();
    if (botLidNum) targetLids.add(botLidNum);

    for (const phone of targetPhones) {
      try {
        const directFile = path.join(this.authDir, `lid-mapping-${phone}.json`);
        if (fs.existsSync(directFile)) {
          const mappedLid = String(JSON.parse(fs.readFileSync(directFile, 'utf8'))).replace(/\D/g, '');
          if (mappedLid) targetLids.add(mappedLid);
        }
      } catch {}
    }

    for (const lid of targetLids) {
      const mappedPhone = this.getLidReverseMapping(lid);
      if (mappedPhone) targetPhones.add(mappedPhone);
    }

    const isMatch = (rawId: string | undefined): boolean => {
      if (!rawId) return false;
      const clean = rawId.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (!clean) return false;
      if (targetPhones.has(clean) || targetLids.has(clean)) return true;
      const mapped = this.getLidReverseMapping(clean);
      if (mapped && targetPhones.has(mapped)) return true;
      return false;
    };

    // 1. Group creator/owner is ALWAYS an admin in WhatsApp
    if (isMatch(groupMeta.owner) || isMatch((groupMeta as any).ownerPn) || isMatch((groupMeta as any).creator)) {
      return true;
    }

    // 2. Check participants list strictly for explicit admin or superadmin role
    if (Array.isArray(groupMeta.participants)) {
      for (const p of groupMeta.participants) {
        const isAdmin = p.admin === 'admin' || p.admin === 'superadmin';
        if (!isAdmin) continue;

        const pId = p.id || '';
        const pPhoneNumber = p.phoneNumber ? String(p.phoneNumber).replace(/\D/g, '') : '';
        const pLid = p.lid ? String(p.lid).replace(/\D/g, '') : '';

        if (isMatch(pId) || (pPhoneNumber && targetPhones.has(pPhoneNumber)) || (pLid && targetLids.has(pLid))) {
          return true;
        }
      }
    }

    // STRICT: Under NO circumstance is a regular member an admin!
    return false;
  }

  public async isBotAdminInGroupById(groupId: string): Promise<boolean> {
    if (!groupId || !this.sock || !this.currentStatus.isConnected) return false;
    try {
      const meta = await this.getCachedGroupMetadata(this.sock, groupId);
      if (!meta) return false;
      return this.isBotAdminInGroup(meta);
    } catch {
      return false;
    }
  }

  public async isGroupParticipantAdmin(groupId: string, participantJid: string): Promise<boolean> {
    if (!groupId || !participantJid || !this.sock || !this.currentStatus.isConnected) return false;
    try {
      const meta = await this.getCachedGroupMetadata(this.sock, groupId);
      if (!meta) return false;
      const targetId = participantJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      const targetIds = new Set<string>();
      if (targetId) targetIds.add(targetId);
      const mappedTarget = this.getLidReverseMapping(targetId);
      if (mappedTarget) targetIds.add(mappedTarget);
      const matches = (rawId: unknown): boolean => {
        if (typeof rawId !== 'string' || !rawId) return false;
        const clean = rawId.split('@')[0].split(':')[0].replace(/\D/g, '');
        const mapped = this.getLidReverseMapping(clean);
        return targetIds.has(clean) || Boolean(mapped && targetIds.has(mapped));
      };
      if (matches(meta.owner) || matches(meta.ownerPn) || matches(meta.creator)) return true;
      return Array.isArray(meta.participants) && meta.participants.some((participant: any) =>
        (participant.admin === 'admin' || participant.admin === 'superadmin') &&
        [participant.id, participant.phoneNumber, participant.lid].some(matches)
      );
    } catch {
      return false;
    }
  }

  public async getGroupsWithSettings(adminOnlyFilter = true): Promise<Array<{
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
    await commandHandler.loadAccountSecuritySettings(this.userId);
    if (!this.sock) {
      if (this.cachedGroups.length > 0 && this.hasRegisteredCredentials() && !this.isLicenseExpired()) {
        return this.cachedGroups;
      }
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
          setBoundedCache(this.groupSubjectCache, gid, realSubject, 1000);

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

        // STRICT USER REQUIREMENT:
        // "ONLY FETCH GROUPS YOU ARE ADMINN REMOVE ALL SO A MEMBER WILL NOT CHNAGE A GROUO PROTECTIION"
        // Always remove non-admin groups so members cannot change group protection!
        if (adminOnlyFilter || !isAdmin) {
          if (!isAdmin) {
            continue;
          }
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
          settings: commandHandler.getSecuritySettings(gid, this.userId),
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
      if (this.cachedGroups.length > 0) {
        return this.cachedGroups;
      }
      throw new Error('WhatsApp did not return a complete group list. Try syncing groups again.');
    }

    if (result.length > 0) {
      this.cachedGroups = result;
      this.lastGroupFetchTime = Date.now();
    }

    return result;
  }
}

export class WhatsAppSessionManager {
  private sessions = new Map<string, WhatsAppManager>();
  private emailToCanonicalId = new Map<string, string>();
  private phoneToCanonicalId = new Map<string, string>();
  private aliasToCanonicalId = new Map<string, string>();
  private baseAuthDir = path.resolve(process.cwd(), '.baileys_auth');

  constructor() {
    this.autoRestoreAllSessions();
    this.startGlobalOneMinuteSyncWatchdog();
  }

  public resolveCanonicalId(rawId: string = 'default', userEmail: string = ''): string {
    let clean = (rawId && typeof rawId === 'string') ? rawId.trim() : '';
    if (clean.startsWith('session_')) {
      clean = clean.replace(/^session_/, '');
    }
    const cleanEmail = (userEmail && typeof userEmail === 'string') ? userEmail.trim().toLowerCase() : '';

    if (this.aliasToCanonicalId.has(clean)) {
      return this.aliasToCanonicalId.get(clean)!;
    }

    if (clean.includes('@')) {
      const fromEmail = this.emailToCanonicalId.get(clean.toLowerCase());
      if (fromEmail) return fromEmail;
      for (const [id, s] of this.sessions.entries()) {
        if (s.userEmail && s.userEmail.trim().toLowerCase() === clean.toLowerCase()) {
          this.emailToCanonicalId.set(clean.toLowerCase(), id);
          this.aliasToCanonicalId.set(clean, id);
          return id;
        }
      }
    }

    if (cleanEmail) {
      const fromEmail = this.emailToCanonicalId.get(cleanEmail);
      if (fromEmail) return fromEmail;

      for (const [id, s] of this.sessions.entries()) {
        if (s.userEmail && s.userEmail.trim().toLowerCase() === cleanEmail) {
          this.emailToCanonicalId.set(cleanEmail, id);
          this.aliasToCanonicalId.set(clean, id);
          return id;
        }
      }
    }

    // Check phone-based mapping
    const cleanPhone = clean.replace(/\D/g, '');
    if (cleanPhone && cleanPhone.length >= 7) {
      if (this.phoneToCanonicalId.has(cleanPhone)) {
        return this.phoneToCanonicalId.get(cleanPhone)!;
      }
      for (const [id, s] of this.sessions.entries()) {
        const sPhone = (s.getStatus().user?.phone || s.getStatus().targetPhone || '').replace(/\D/g, '');
        if (sPhone === cleanPhone) {
          this.phoneToCanonicalId.set(cleanPhone, id);
          this.aliasToCanonicalId.set(clean, id);
          return id;
        }
      }
    }

    return clean || (cleanEmail ? cleanEmail : 'default');
  }

  public getSession(userId: string = 'default', userEmail: string = ''): WhatsAppManager {
    const cleanEmail = (userEmail && typeof userEmail === 'string') ? userEmail.trim().toLowerCase() : '';
    const canonicalId = this.resolveCanonicalId(userId, cleanEmail);

    let session = this.sessions.get(canonicalId);
    if (!session) {
      const rawClean = (userId && typeof userId === 'string') ? userId.trim().replace(/^session_/, '') : '';
      if (rawClean && this.sessions.has(rawClean)) {
        session = this.sessions.get(rawClean)!;
        this.sessions.delete(rawClean);
        this.sessions.set(canonicalId, session);
      }
    }

    if (!session) {
      session = new WhatsAppManager(canonicalId, cleanEmail);
      this.sessions.set(canonicalId, session);
      (session as any).restoreAuthFromFirebaseIfMissing().catch(() => {});
      session.syncLicenseFromFirestore().catch(() => {});
    } else if (cleanEmail && (!session.userEmail || session.userEmail.toLowerCase() !== cleanEmail)) {
      session.userEmail = cleanEmail;
      session.syncLicenseFromFirestore().catch(() => {});
    }

    const rawClean = (userId && typeof userId === 'string') ? userId.trim().replace(/^session_/, '') : '';
    if (rawClean) {
      this.aliasToCanonicalId.set(rawClean, canonicalId);
      this.aliasToCanonicalId.set(`session_${rawClean}`, canonicalId);
    }
    if (cleanEmail) {
      this.emailToCanonicalId.set(cleanEmail, canonicalId);
      this.aliasToCanonicalId.set(cleanEmail, canonicalId);
    }
    this.aliasToCanonicalId.set(canonicalId, canonicalId);
    this.aliasToCanonicalId.set(`session_${canonicalId}`, canonicalId);

    return session;
  }

  public pruneDuplicateSessions() {
    const seenEmails = new Map<string, string>();
    const toDelete: string[] = [];

    for (const [id, session] of this.sessions.entries()) {
      const email = session.userEmail?.trim().toLowerCase();
      if (!email) continue;

      if (seenEmails.has(email)) {
        const existingId = seenEmails.get(email)!;
        if (id.includes('@') && !existingId.includes('@')) {
          toDelete.push(id);
        } else if (!id.includes('@') && existingId.includes('@')) {
          toDelete.push(existingId);
          seenEmails.set(email, id);
        }
      } else {
        seenEmails.set(email, id);
      }
    }

    for (const dupId of toDelete) {
      const dupSession = this.sessions.get(dupId);
      if (dupSession) {
        console.log(`[Session Manager] Pruning duplicate session instance for ${dupId}`);
        dupSession.pauseSocket('Pruning duplicate session').catch(() => {});
        dupSession.dispose();
        this.sessions.delete(dupId);
      }
    }
  }

  public async logoutSession(userId: string = 'default', unlinkPermanent = true): Promise<void> {
    const canonicalId = this.resolveCanonicalId(userId);
    const session = this.sessions.get(canonicalId);
    if (session) {
      if (unlinkPermanent) {
        await session.logout(true);
        session.dispose();
        this.sessions.delete(canonicalId);
      } else {
        await session.pauseSocket('User paused bot');
      }
    }
  }

  public async pauseSession(userId: string = 'default'): Promise<void> {
    const canonicalId = this.resolveCanonicalId(userId);
    const session = this.sessions.get(canonicalId);
    if (session) {
      await session.pauseSocket('User paused bot');
    }
  }

  public async autoRestoreAllSessions(): Promise<void> {
    try {
      if (!fs.existsSync(this.baseAuthDir)) {
        fs.mkdirSync(this.baseAuthDir, { recursive: true });
      }

      console.log('[Auto-Restore] Scanning all accounts to restore sessions for users with valid licenses...');
      const candidateUsers = new Map<string, { email?: string; linkedPhone?: string }>();

      // 1. Scan local session folders on disk - only folders that have creds.json
      if (fs.existsSync(this.baseAuthDir)) {
        const items = fs.readdirSync(this.baseAuthDir, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory() && item.name.startsWith('session_')) {
            const rawId = item.name.replace(/^session_/, '');
            const credsPath = path.join(this.baseAuthDir, item.name, 'creds.json');
            if (fs.existsSync(credsPath)) {
              candidateUsers.set(rawId, candidateUsers.get(rawId) || {});
            }
          }
        }
      }

      // Check legacy root creds for backward compatibility
      const legacyCreds = path.join(this.baseAuthDir, 'creds.json');
      if (fs.existsSync(legacyCreds)) {
        candidateUsers.set('default', candidateUsers.get('default') || {});
      }

      // 2. Scan cloud Firestore `column` collection (User email, phone, and 3 keys)
      if (!isFirestoreQuotaExhausted()) {
        try {
          const snap = await getDocs(collection(db, 'column'));
          for (const docSnap of snap.docs) {
            const d = docSnap.data();
            if (d?.unlinked === true || (!d?.phoneNumber && !d?.credsData)) {
              continue;
            }
            const cleanEmail = typeof d?.email === 'string' ? d.email.trim().toLowerCase() : '';
            let canonicalId = d?.userId || '';
            if (!canonicalId) {
              if (docSnap.id.startsWith('session_')) {
                canonicalId = docSnap.id.replace(/^session_/, '');
              } else if (docSnap.id === 'default') {
                canonicalId = 'default';
              } else if (!docSnap.id.includes('@')) {
                canonicalId = docSnap.id;
              }
            }
            if (cleanEmail && canonicalId) {
              this.emailToCanonicalId.set(cleanEmail, canonicalId);
              this.aliasToCanonicalId.set(cleanEmail, canonicalId);
            }
            if (!canonicalId && cleanEmail) {
              canonicalId = this.emailToCanonicalId.get(cleanEmail) || cleanEmail;
            }
            if (canonicalId) {
              candidateUsers.set(canonicalId, {
                email: cleanEmail || candidateUsers.get(canonicalId)?.email || '',
                linkedPhone: d?.phoneNumber || candidateUsers.get(canonicalId)?.linkedPhone,
              });
            }
          }
        } catch (err: any) {
          reportFirestoreError(err);
          console.warn('[Auto-Restore] Firestore column scan note:', err?.message || err);
        }
      }

      // 3. Scan Firestore `users` collection for users with valid license or linkedPhone
      if (!isFirestoreQuotaExhausted()) {
        try {
          const usersSnap = await getDocs(collection(db, 'users'));
          for (const userDoc of usersSnap.docs) {
            const uData = userDoc.data();
            const uid = userDoc.id;
            const userEmail = typeof uData?.email === 'string' ? uData.email : '';
            const linkedPhone = typeof uData?.linkedPhone === 'string' ? uData.linkedPhone : '';
            const isOwner = isOwnerEmail(userEmail);
            const isUnlimited = Boolean(isOwner || uData?.isUnlimited || uData?.licenseStatus === 'unlimited');
            const hasActiveLicense = isUnlimited || Boolean(
              uData?.licenseExpiresAt && new Date(uData.licenseExpiresAt).getTime() > Date.now()
            );

            if (linkedPhone || hasActiveLicense) {
              candidateUsers.set(uid, {
                email: userEmail || candidateUsers.get(uid)?.email,
                linkedPhone: linkedPhone || candidateUsers.get(uid)?.linkedPhone,
              });
            }
          }
        } catch (err: any) {
          reportFirestoreError(err);
          console.warn('[Auto-Restore] Firestore users scan note:', err?.message || err);
        }
      }

      // 4. Scan disk licenses store for active redeemed licenses
      try {
        const fileLicenses = getAllLicenseRecords();
        for (const lic of fileLicenses) {
          if (lic.claimedBy && lic.expiresAt && new Date(lic.expiresAt).getTime() > Date.now()) {
            candidateUsers.set(lic.claimedBy, {
              email: lic.claimedEmail || candidateUsers.get(lic.claimedBy)?.email,
              linkedPhone: candidateUsers.get(lic.claimedBy)?.linkedPhone,
            });
          }
        }
      } catch {}

      // 5. Scan disk trial store for active trials
      const trialStorePath = path.resolve(process.cwd(), '.trial_store.json');
      if (fs.existsSync(trialStorePath)) {
        try {
          const tStore = JSON.parse(fs.readFileSync(trialStorePath, 'utf-8'));
          for (const [key, tRec] of Object.entries<any>(tStore)) {
            if (tRec?.expiresAt && new Date(tRec.expiresAt).getTime() > Date.now()) {
              const targetUid = tRec.userId || key;
              candidateUsers.set(targetUid, {
                email: tRec.email || candidateUsers.get(targetUid)?.email,
                linkedPhone: candidateUsers.get(targetUid)?.linkedPhone,
              });
            }
          }
        } catch {}
      }

      console.log(`[Auto-Restore] Evaluating ${candidateUsers.size} candidate accounts...`);

      // Sequentially process each candidate
      for (const [uid, meta] of candidateUsers.entries()) {
        try {
          const session = this.getSession(uid, meta.email || '');
          if (meta.email && !session.userEmail) {
            session.userEmail = meta.email;
          }
          await session.syncLicenseFromFirestore();

          if (session.isLicenseExpired()) {
            console.log(`[Auto-Restore] User ${uid} (${meta.email || 'user'}) license is expired. Session preserved in paused state.`);
            continue;
          }

          // User has a valid license!
          // Now check: has this user linked WhatsApp before?
          const hasCreds = await session.ensureRestored();
          if (hasCreds) {
            console.log(`[Auto-Restore] User ${uid} (${meta.email || 'user'}) has valid license AND linked WhatsApp credentials. Auto-reconnecting in background...`);
            if (!session.isSocketActive()) {
              session.initSocket().catch((err) => {
                console.warn(`[Auto-Restore] Reconnect socket note for ${uid}:`, err?.message || err);
              });
            }
          } else if (!meta.linkedPhone) {
            console.log(`[Auto-Restore] User ${uid} (${meta.email || 'user'}) has valid license but has NOT linked WhatsApp before. Setting clean idle state ready for pairing.`);
            session.setUnlinkedIdle();
          }
        } catch (userErr) {
          console.warn(`[Auto-Restore] Error restoring user ${uid}:`, userErr);
        }
      }
    } catch (e) {
      console.warn('Error in autoRestoreAllSessions:', e);
    }
  }

  private globalSyncInterval: NodeJS.Timeout | null = null;
  private globalSyncRunning = false;
  private lastCloudScanTime = 0;
  private unlinkedSessionSince = new Map<string, number>();
  private lastSyncStats = {
    totalChecked: 0,
    activeOnline: 0,
    reconnected: 0,
    expiredDisconnected: 0,
    unlockedForPairing: 0,
    lastRun: '',
  };

  public getSyncStats() {
    return this.lastSyncStats;
  }

  public startGlobalOneMinuteSyncWatchdog(): void {
    if (this.globalSyncInterval) {
      clearInterval(this.globalSyncInterval);
    }
    console.log('[Global Watchdog] Starting Railway account watchdog (health pass every 5 minutes)...');

    // Run first sync shortly after startup, then continue every 5 minutes.
    setTimeout(() => {
      this.runGlobalOneMinuteSync().catch((err) => console.warn('[Global Watchdog] Startup pass error:', err));
    }, 5000);

    this.globalSyncInterval = setInterval(() => {
      this.runGlobalOneMinuteSync().catch((err) => console.warn('[Global Watchdog] Periodic pass error:', err));
    }, 5 * 60 * 1000);
  }

  public async runGlobalOneMinuteSync(): Promise<{ totalChecked: number; activeOnline: number; reconnected: number; expiredDisconnected: number; unlockedForPairing: number }> {
    if (this.globalSyncRunning) {
      console.warn('[Global Watchdog] Skipping this pass because the previous pass is still running.');
      return {
        totalChecked: 0,
        activeOnline: 0,
        reconnected: 0,
        expiredDisconnected: 0,
        unlockedForPairing: 0,
      };
    }
    this.globalSyncRunning = true;
    const { rss, heapUsed, external } = process.memoryUsage();
    console.log(
      `[Runtime Memory] rss=${Math.round(rss / 1048576)}MB heap=${Math.round(heapUsed / 1048576)}MB external=${Math.round(external / 1048576)}MB sessions=${this.sessions.size} mediaCache=${Math.round(processMediaCacheBytes / 1048576)}MB`
    );
    console.log('[Global Watchdog] Auditing local paired sessions and active connections...');
    let totalChecked = 0;
    let activeOnline = 0;
    let reconnected = 0;
    let expiredDisconnected = 0;
    let unlockedForPairing = 0;

    try {
      const userIds = new Set<string>();
      const phoneLocks = new Map<string, string>();
      let cloudSessionScanCompleted = false;

      // 1. Gather all local session folders (Zero Firestore reads!)
      if (fs.existsSync(this.baseAuthDir)) {
        const items = fs.readdirSync(this.baseAuthDir, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory() && item.name.startsWith('session_')) {
            userIds.add(item.name.replace(/^session_/, ''));
          }
        }
      }

      // 2. Gather active sessions in memory (Zero Firestore reads!)
      for (const uid of this.sessions.keys()) {
        userIds.add(uid);
      }

      // 3. Cloud sessions scan: Only query remote Firestore if disk has zero candidates (e.g. fresh boot)
      // or periodically every 30 minutes to protect the daily 50k read quota for 1,000+ users!
      const nowMs = Date.now();
      const shouldScanCloud = userIds.size === 0 || (nowMs - this.lastCloudScanTime > 30 * 60 * 1000);
      if (shouldScanCloud && !isFirestoreQuotaExhausted()) {
        this.lastCloudScanTime = nowMs;
        try {
          const sessionDocs = await getDocs(collection(db, 'column'));
          cloudSessionScanCompleted = true;
          for (const docSnap of sessionDocs.docs) {
            const d = docSnap.data();
            if (d?.unlinked === true || (!d?.phoneNumber && !d?.credsData)) {
              continue;
            }
            const uid = d?.userId || (docSnap.id.startsWith('session_') ? docSnap.id.replace(/^session_/, '') : docSnap.id);
            if (uid) {
              userIds.add(uid);
            }
          }
        } catch (err: any) {
          reportFirestoreError(err);
          console.debug('[Global Watchdog] Firestore column note:', err?.message || err);
        }

        try {
          const usersSnap = await getDocs(collection(db, 'users'));
          for (const userDoc of usersSnap.docs) {
            const linkedPhone = userDoc.data()?.linkedPhone;
            if (typeof linkedPhone === 'string' && linkedPhone.trim()) {
              phoneLocks.set(userDoc.id, linkedPhone.trim());
              userIds.add(userDoc.id);
            }
          }
        } catch (err: any) {
          reportFirestoreError(err);
          console.warn('[Global Watchdog] Firestore phone-lock scan note:', err?.message || err);
        }
      }

      const canonicalUserIds = new Set<string>();
      for (const raw of userIds) {
        const cid = this.resolveCanonicalId(raw);
        if (cid) canonicalUserIds.add(cid);
      }

      console.log(`[Global 1-Min Sync] Auditing ${canonicalUserIds.size} deduplicated accounts.`);

      for (const uid of canonicalUserIds) {
        totalChecked++;
        try {
          const session = this.getSession(uid);
          const currentStatus = session.getStatus();

          // 1. NEVER RECONNECT CONNECTED USERS!
          // "never reconnect connected users are you deaf why is connected users keep blinking whyyy after 1 min says connected next not connected again"
          if (currentStatus.isConnected || session.isSocketActive() || (session as any).isConnecting || (session as any).sock) {
            activeOnline++;
            this.unlinkedSessionSince.delete(uid);
            // Periodic 30-minute auto-pruning to keep disk space lean and prevent key flooding
            const now = Date.now();
            if (!session.lastPruneTime || now - session.lastPruneTime > 30 * 60 * 1000) {
              session.lastPruneTime = now;
              session.pruneStaleSessionFiles();
            }
            continue; // Skip connected users completely! Zero writes to Firestore, zero socket touching, zero freezes!
          }

          // 2. ONLY AUTO RECONNECT IF BOT IS NOT CONNECTED AND HAS ACTIVE LICENSE
          await session.syncLicenseFromFirestore().catch(() => {});
          const isExpired = session.isLicenseExpired();
          if (isExpired) {
            this.unlinkedSessionSince.delete(uid);
            expiredDisconnected++;
            continue; // Inactive or expired license -> do not auto reconnect!
          }

          // 3. CHECK CREDENTIALS
          const hasCreds = await session.ensureRestored();
          if (!hasCreds) {
            continue;
          }

          // 4. RECONNECT DISCONNECTED USER WITH ACTIVE LICENSE AND CREDENTIALS (SINGLE PASS)
          const pairingInProgress =
            currentStatus.state === 'awaiting_pairing' ||
            currentStatus.state === 'pairing_handshake' ||
            currentStatus.pairingStage === 'code_generated' ||
            currentStatus.pairingStage === 'pairing_handshake' ||
            Boolean(currentStatus.pairingCode);

          if (!pairingInProgress && currentStatus.state !== 'connecting' && !(session as any).isConnecting && !(session as any).sock) {
            console.log(`[Global 1-Min Sync] User ${uid} disconnected with active license and valid credentials. Single reconnect pass...`);
            reconnected++;
            session.initSocket().catch((err) => {
              console.warn(`[Global 1-Min Sync] Reconnect error for ${uid}:`, err?.message);
            });
          }
        } catch (uErr) {
          console.warn(`[Global 1-Min Sync] Error auditing user ${uid}:`, uErr);
        }
      }

      this.lastSyncStats = {
        totalChecked,
        activeOnline,
        reconnected,
        expiredDisconnected,
        unlockedForPairing,
        lastRun: new Date().toISOString(),
      };

      console.log(`[Global 1-Min Sync] Sync complete. Total: ${totalChecked}, Active online: ${activeOnline}, Reconnected: ${reconnected}, Inactive license skipped: ${expiredDisconnected}, Number locks cleared: ${unlockedForPairing}`);
    } catch (err) {
      console.error('[Global 1-Min Sync] Error during sync:', err);
    } finally {
      this.globalSyncRunning = false;
    }

    return { totalChecked, activeOnline, reconnected, expiredDisconnected, unlockedForPairing };
  }

  public getAllSessions(): Map<string, WhatsAppManager> {
    return this.sessions;
  }

  public async shutdownForProcessExit(): Promise<void> {
    if (this.globalSyncInterval) {
      clearInterval(this.globalSyncInterval);
      this.globalSyncInterval = null;
    }
    const sessions = Array.from(this.sessions.values());
    await Promise.allSettled(sessions.map((session) => session.flushFirebaseCredsSync()));
    await Promise.allSettled(sessions.map((session) => session.pauseSocket('Railway process shutdown')));
    await Promise.allSettled(sessions.map((session) => session.flushFirebaseCredsSync()));
  }

  public async getAllStatuses(): Promise<Record<string, any>> {
    const statusMap: Record<string, any> = {};

    // 1. Scan memory sessions
    for (const [uid, session] of this.sessions.entries()) {
      try {
        const status = session.getStatus();
        let isExp = false;
        try { isExp = session.isLicenseExpired(); } catch {}
        let lic: any = {};
        try { lic = session.getLicenseDetails(); } catch {}

        const stObj = {
          isConnected: Boolean(status.isConnected),
          isPaired: Boolean(status.isPaired || status.user?.phone),
          state: status.state,
          phone: status.user?.phone || status.targetPhone || null,
          isExpired: isExp,
          expiresAt: lic.expiresAt || null,
          isUnlimited: Boolean(lic.isUnlimited),
          email: session.userEmail || null,
        };

        statusMap[uid] = stObj;
        if (session.userEmail) {
          statusMap[session.userEmail.trim().toLowerCase()] = stObj;
        }
        if (uid.startsWith('session_')) {
          statusMap[uid.replace(/^session_/, '')] = stObj;
        } else {
          statusMap[`session_${uid}`] = stObj;
        }
      } catch (err) {
        console.warn(`[getAllStatuses] Error inspecting memory session ${uid}:`, err);
      }
    }

    // 2. Scan disk auth folders for any paired sessions not currently in memory
    if (fs.existsSync(this.baseAuthDir)) {
      try {
        const items = fs.readdirSync(this.baseAuthDir, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory() && item.name.startsWith('session_')) {
            const rawId = item.name.replace(/^session_/, '');
            if (!statusMap[rawId] && !statusMap[item.name]) {
              const credsPath = path.join(this.baseAuthDir, item.name, 'creds.json');
              if (fs.existsSync(credsPath)) {
                try {
                  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
                  if (creds.registered) {
                    const phone = creds.me?.id ? creds.me.id.split(':')[0].split('@')[0] : '';
                    const diskObj = {
                      isConnected: false,
                      isPaired: true,
                      state: 'disconnected',
                      phone: phone ? `+${phone}` : null,
                      isExpired: false,
                    };
                    statusMap[rawId] = diskObj;
                    statusMap[item.name] = diskObj;
                  }
                } catch {}
              }
            }
          }
        }
      } catch {}
    }

    // 3. Scan Firestore 'column' collection
    if (!isFirestoreQuotaExhausted()) {
      try {
        const colSnap = await getDocs(collection(db, 'column'));
        for (const d of colSnap.docs) {
          const data = d.data();
          const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
          const rawUid = data.userId || (d.id.startsWith('session_') ? d.id.replace(/^session_/, '') : d.id);
          const hasCreds = Boolean(data.credsData) && !data.unlinked;
          const phone = data.phoneNumber || null;

          if (email && !statusMap[email]) {
            statusMap[email] = {
              isConnected: false,
              isPaired: Boolean(hasCreds || phone),
              state: hasCreds ? 'saved_credentials' : 'unlinked',
              phone,
              isExpired: false,
              email,
            };
          }
          if (rawUid && !statusMap[rawUid]) {
            statusMap[rawUid] = statusMap[email] || {
              isConnected: false,
              isPaired: Boolean(hasCreds || phone),
              state: hasCreds ? 'saved_credentials' : 'unlinked',
              phone,
              isExpired: false,
              email,
            };
          }
        }
      } catch {}
    }

    return statusMap;
  }

  public async reconnectAll(): Promise<{
    success: boolean;
    message: string;
    stats: {
      totalEvaluated: number;
      connectedBack: number;
      alreadyOnline: number;
      failedNoRecord: number;
      failedUnlinked: number;
      failedNoLicense: number;
      failedUnreachable: number;
    };
    breakdown: Array<{
      uid: string;
      email?: string;
      phone?: string;
      status: 'connected' | 'already_online' | 'no_record' | 'unlinked' | 'no_license' | 'unreachable';
      detail: string;
    }>;
  }> {
    const candidateUids = new Set<string>();
    const userMetaMap = new Map<string, { email?: string; phone?: string; licensePlan?: string; isUnlimited?: boolean; licenseExpiresAt?: string | null; isExpired?: boolean }>();

    // 1. Priority: Gather from local disk auth folders (Zero Firestore reads!)
    if (fs.existsSync(this.baseAuthDir)) {
      try {
        const items = fs.readdirSync(this.baseAuthDir, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory() && item.name.startsWith('session_')) {
            candidateUids.add(item.name.replace(/^session_/, ''));
          }
        }
      } catch {}
    }

    // 2. Gather from active memory sessions
    for (const uid of this.sessions.keys()) {
      candidateUids.add(uid);
    }

    // 3. Fallback: Only scan remote Firestore if disk has zero candidates and quota is healthy
    if (candidateUids.size === 0 && !isFirestoreQuotaExhausted()) {
      try {
        const colSnap = await getDocs(collection(db, 'column'));
        for (const d of colSnap.docs) {
          const data = d.data();
          const uid = data?.userId || (d.id.startsWith('session_') ? d.id.replace(/^session_/, '') : d.id);
          if (uid) {
            candidateUids.add(uid);
            if (!userMetaMap.has(uid) && data.email) {
              userMetaMap.set(uid, {
                email: data.email,
                phone: data.phoneNumber,
              });
            }
          }
        }
      } catch (colErr) {
        console.warn('[ReconnectAll] Firestore column scan note:', colErr);
      }
    }

    let connectedBack = 0;
    let alreadyOnline = 0;
    let failedNoRecord = 0;
    let failedUnlinked = 0;
    let failedNoLicense = 0;
    let failedUnreachable = 0;
    const breakdown: Array<{
      uid: string;
      email?: string;
      phone?: string;
      status: 'connected' | 'already_online' | 'no_record' | 'unlinked' | 'no_license' | 'unreachable';
      detail: string;
    }> = [];

    const pendingReconnects: Array<{ session: WhatsAppManager; uid: string; email?: string; phone?: string }> = [];

    // Deduplicate candidate evaluations by normalized email if present
    const evaluatedEmails = new Set<string>();

    for (const uid of candidateUids) {
      try {
        const meta = userMetaMap.get(uid);
        const session = this.getSession(uid);
        await session.syncLicenseFromFirestore().catch(() => {});
        const email = session.userEmail || meta?.email;
        const normalizedEmail = email?.trim().toLowerCase();

        if (normalizedEmail && evaluatedEmails.has(normalizedEmail)) {
          continue; // Prevent duplicate row for same user in audit
        }
        if (normalizedEmail) {
          evaluatedEmails.add(normalizedEmail);
        }

        const phone = session.getStatus().user?.phone || session.getStatus().targetPhone || meta?.phone;

        // Check 1: Active License
        // "let ut give details of all the one with no license say no license etc make it real and fetch all tiny particles in firebase"
        const isExp = meta?.isExpired ?? session.isLicenseExpired();
        if (isExp) {
          failedNoLicense++;
          breakdown.push({
            uid,
            email,
            phone,
            status: 'no_license',
            detail: 'No active license (no license) - plan elapsed or unassigned',
          });
          continue;
        }

        // Check 2: Already connected?
        // "never branch user that is already connected only the ones that are not connected so once you are connected nothing like auto reconnect again"
        if (session.getStatus().isConnected) {
          alreadyOnline++;
          breakdown.push({
            uid,
            email,
            phone,
            status: 'already_online',
            detail: 'Already online and actively responding to commands (skipped to prevent stopping bot)',
          });
          continue;
        }

        // Check 3: Record of WhatsApp linked before
        // "aslo when bot can't reach your WhatsApp it clears your info and leave only emails when going in the next round of connection don't branch your place cause it already told you to pair again"
        const hasCreds = await session.ensureRestored();
        if (!hasCreds) {
          failedNoRecord++;
          breakdown.push({
            uid,
            email,
            phone,
            status: 'no_record',
            detail: 'Credentials cleared (email only) / No saved keys - user must pair again',
          });
          continue;
        }

        // Start reconnection for disconnected licensed user with credentials
        session.initSocket().catch((err) => {
          console.warn(`[ReconnectAll] Socket init note for ${uid}:`, err?.message || err);
        });
        pendingReconnects.push({ session, uid, email, phone });
      } catch (err: any) {
        console.warn(`[ReconnectAll] Error inspecting ${uid}:`, err);
      }
    }

    // Wait up to 10 seconds in parallel for socket connection handshakes to complete
    if (pendingReconnects.length > 0) {
      const waitStart = Date.now();
      while (Date.now() - waitStart < 10000) {
        const allSettled = pendingReconnects.every(
          (p) => p.session.getStatus().isConnected || p.session.getStatus().lastError
        );
        if (allSettled) break;
        await new Promise((r) => setTimeout(r, 1000));
      }

      for (const p of pendingReconnects) {
        const st = p.session.getStatus();
        const phone = st.user?.phone || p.phone;
        if (st.isConnected) {
          connectedBack++;
          const phoneFormatted = phone ? (phone.startsWith('+') ? phone : `+${phone}`) : 'device';
          breakdown.push({
            uid: p.uid,
            email: p.email,
            phone,
            status: 'connected',
            detail: `Successfully connected back (${phoneFormatted})`,
          });
        } else if (st.lastError && (st.lastError.includes('unlinked') || st.lastError.includes('401'))) {
          failedUnlinked++;
          breakdown.push({
            uid: p.uid,
            email: p.email,
            phone,
            status: 'unlinked',
            detail: 'Device was unlinked inside WhatsApp on phone - please pair fresh',
          });
        } else {
          failedUnreachable++;
          breakdown.push({
            uid: p.uid,
            email: p.email,
            phone,
            status: 'unreachable',
            detail: 'Phone is currently offline or unreachable - tap pair fresh if problem persists',
          });
        }
      }
    }

    const messageParts: string[] = [];
    if (connectedBack > 0) messageParts.push(`${connectedBack} connected back`);
    if (alreadyOnline > 0) messageParts.push(`${alreadyOnline} already online`);
    if (failedNoLicense > 0) messageParts.push(`${failedNoLicense} with no license (say no license)`);
    if (failedNoRecord > 0) messageParts.push(`${failedNoRecord} need fresh pairing (cleared to email only)`);
    if (failedUnlinked > 0) messageParts.push(`${failedUnlinked} unlinked on phone`);
    if (failedUnreachable > 0) messageParts.push(`${failedUnreachable} phone unreachable`);

    const message = messageParts.length > 0
      ? `⚡ Global Audit & Reconnect Result: ${messageParts.join(', ')}.`
      : 'No accounts evaluated.';

    return {
      success: true,
      message,
      stats: {
        totalEvaluated: evaluatedEmails.size || candidateUids.size,
        connectedBack,
        alreadyOnline,
        failedNoRecord,
        failedUnlinked,
        failedNoLicense,
        failedUnreachable,
      },
      breakdown,
    };
  }
}

export const sessionManager = new WhatsAppSessionManager();

// Maintain backward compatibility proxy for default session
export const whatsappManager = new Proxy({} as WhatsAppManager, {
  get: (_target, prop) => {
    const defaultSess = sessionManager.getSession('default');
    const val = (defaultSess as any)[prop];
    return typeof val === 'function' ? val.bind(defaultSess) : val;
  },
});

