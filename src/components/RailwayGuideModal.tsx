import React, { useState } from 'react';
import { Server, Copy, Check, X, Shield, ExternalLink } from 'lucide-react';

interface RailwayGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RailwayGuideModal: React.FC<RailwayGuideModalProps> = ({ isOpen, onClose }) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const dockerfileCode = `# SOLVATECH BOT 24/7 Production Dockerfile
FROM node:22-alpine

WORKDIR /app

# Install FFmpeg for media & sticker conversion
RUN apk add --no-cache ffmpeg

# Install dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy source
COPY . .

# Build Vite client
RUN npm run build

# Expose port
ENV PORT=3000
EXPOSE 3000

# Start server with persistent multi-device Baileys
CMD ["npm", "run", "start"]`;

  const railwayEnvCode = `# Railway Environment Variables (SOLVATECH 24/7)
PORT=3000
NODE_ENV=production
NIXPACKS_NODE_VERSION=22
APP_URL=https://solvatech.up.railway.app
VITE_FIREBASE_API_KEY=AIzaSyDCVp_T6gO6HeTDeevls9MSb9quEzU5YiM
VITE_FIREBASE_AUTH_DOMAIN=solvatechbot.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=solvatechbot
VITE_FIREBASE_STORAGE_BUCKET=solvatechbot.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1094113371408
VITE_FIREBASE_APP_ID=1:1094113371408:web:fdf3cbdef31413a703b195
VITE_FIREBASE_DATABASE_URL=https://solvatechbot-default-rtdb.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_JSON=`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <img
              src="/solva.webp"
              alt="SOLVATECH"
              className="w-10 h-10 rounded-xl object-cover ring-1 ring-purple-500/40 shadow-md shrink-0"
            />
            <div>
              <h3 className="font-bold text-white text-base">24/7 Railway Deployment Architecture</h3>
              <p className="text-xs text-slate-400">Keep SOLVATECH online 24/7 without disconnects</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs text-slate-300">
          <div className="p-3.5 rounded-2xl bg-purple-950/20 border border-purple-800/40 text-purple-300 flex items-start gap-3">
            <Shield className="w-5 h-5 shrink-0 mt-0.5 text-purple-400" />
            <div>
              <span className="font-bold">Production Domain: https://solvatech.up.railway.app</span>
              <p className="text-purple-300/80 mt-0.5 text-[11px]">
                SOLVATECH is configured for 24/7 round-the-clock hosting with multi-device Baileys and persistent Firebase Cloud sync.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-white text-sm">3 Steps to Deploy to Railway</h4>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-400 text-xs">
              <li>Push this codebase or connect GitHub to <strong className="text-white">railway.app</strong>.</li>
              <li>Railway will automatically detect <strong className="text-white">package.json</strong> and execute <code className="text-emerald-400 font-mono">npm run build</code> and <code className="text-emerald-400 font-mono">npm run start</code>.</li>
              <li>Add a persistent Railway Volume mounted at <code className="text-emerald-400 font-mono">/.baileys_auth</code> so your WhatsApp paired credentials persist permanently between restarts!</li>
            </ol>
          </div>

          {/* Dockerfile snippet */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-400">
              <span className="font-semibold text-white">Dockerfile (Railway Container)</span>
              <button
                onClick={() => copyText(dockerfileCode, 'docker')}
                className="flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
              >
                {copiedSection === 'docker' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSection === 'docker' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto">
              {dockerfileCode}
            </pre>
          </div>

          {/* Environment Variables */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-400">
              <span className="font-semibold text-white">Railway Variables Config</span>
              <button
                onClick={() => copyText(railwayEnvCode, 'env')}
                className="flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
              >
                {copiedSection === 'env' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSection === 'env' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto">
              {railwayEnvCode}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
