import React, { useState } from 'react';
import { Terminal, Shield, Sparkles, Copy, Check, Play, Flame, Image as ImageIcon } from 'lucide-react';

interface CommandDirectoryProps {
  onRunCommand: (cmd: string) => void;
}

export const CommandDirectory: React.FC<CommandDirectoryProps> = ({ onRunCommand }) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'core' | 'media' | 'security' | 'controller'>('all');

  const categories = [
    {
      id: 'core',
      name: '⚡ Core Utility',
      icon: Terminal,
      color: 'text-amber-400',
      commands: [
        { cmd: '.ping', desc: 'Instant network latency and server response time' },
        { cmd: '.uptime', desc: 'Show how long your WhatsApp account has been linked' },
        { cmd: '.owner', desc: 'Official SOLVATECH BOT developer contact' },
        { cmd: '.expire', desc: 'Real-time license validity countdown & key status' },
        { cmd: '.ai <prompt>', desc: 'Ask Google Gemini AI assistant questions or code' },
        { cmd: '.menu', desc: 'Display full command directory' },
        { cmd: '.plans / .buy', desc: 'Official license duration plans & OPay payment details' },
        { cmd: '.signature', desc: 'Official verified developer signature & credentials' },
        { cmd: '.share', desc: 'Share SOLVATECH BOT features with friends/groups' },
        { cmd: '.link', desc: 'Retrieve official channel & community links' },
        { cmd: '.groupinfo', desc: 'Complete group metadata, creator, and admin roster' },
        { cmd: '.profile [@user]', desc: 'View WhatsApp bio, account details & group role' },
      ],
    },
    {
      id: 'media',
      name: '📸 Media & Message Recovery',
      icon: Sparkles,
      color: 'text-emerald-400',
      commands: [
        { cmd: '.sticker', desc: 'Convert photo to sticker or video to animated sticker' },
        { cmd: '.antisticker', desc: 'Convert static sticker to image or animated to video' },
        { cmd: '.read', desc: 'Extract verbatim text from image via High-Precision OCR' },
        { cmd: '.open / .vv', desc: 'Reveal view-once media privately to your personal DM' },
        { cmd: '.send', desc: 'Reply to any WhatsApp Status to extract and send into chat' },
      ],
    },
    {
      id: 'security',
      name: '🛡️ Group Security & Admin',
      icon: Shield,
      color: 'text-teal-400',
      commands: [
        { cmd: '.pin', desc: 'Pin replied message in group (7 days)' },
        { cmd: '.del [count]', desc: 'Delete last N messages (Admin: all; Member: own)' },
        { cmd: '.tagall [msg]', desc: 'Mention all group members' },
        { cmd: '.admin / .admins', desc: 'Mention all group administrators' },
        { cmd: '.kick @user', desc: 'Remove participant from group' },
        { cmd: '.add <phone>', desc: 'Add new member to group with country code' },
        { cmd: '.promote @user', desc: 'Promote member to group admin' },
        { cmd: '.demote @user', desc: 'Demote group admin to member' },
        { cmd: '.lock', desc: 'Restrict group messaging to admins only' },
        { cmd: '.unlock', desc: 'Allow all members to send messages' },
        { cmd: '.antilink on/off', desc: 'Auto-remove external links with shared warnings' },
        { cmd: '.antibot on/off', desc: 'Auto-remove rogue automated bot accounts & dot commands' },
        { cmd: '.antistatus on/off', desc: 'Auto-remove WhatsApp status group mentions' },
        { cmd: '.antispam on/off', desc: 'Auto-purge spam (text, stickers, media) & instant kick on continuous spam' },
        { cmd: '.autowelcome on/off', desc: 'Auto-welcome new members upon joining (Admin bot only, 1 bot election)' },
        { cmd: '.autogoodbye on/off', desc: 'Auto-goodbye departing members (Admin bot only)' },
        { cmd: '.anti', desc: 'Inspect group protections & warning threshold' },
        { cmd: '.warn @user', desc: 'Warn member (Auto-deletes offending pic/sticker/text, admin protected)' },
        { cmd: '.warn limit <num>', desc: 'Set unified warning threshold before automatic kick' },
        { cmd: '.warns', desc: 'Inspect participant warning count & group limit' },
        { cmd: '.clearwarns @user', desc: 'Reset warnings to 0 for a specific member' },
        { cmd: '.resetwarns', desc: 'Reset all group member warnings to zero' },
      ],
    },
    {
      id: 'controller',
      name: '👑 Controller Only',
      icon: Flame,
      color: 'text-rose-400',
      commands: [
        { cmd: '.spam [msg] [count]', desc: 'Fast burst spam e.g. .spam okay wassup 30 (Owner only)' },
        { cmd: '.stop', desc: 'Terminate active repeated operation immediately' },
      ],
    },
  ];

  const handleCopyMenu = () => {
    onRunCommand('.menu');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredCategories = activeTab === 'all'
    ? categories
    : categories.filter((c) => c.id === activeTab);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <img
            src="/solva.webp"
            alt="SOLVATECH"
            className="w-10 h-10 rounded-xl object-cover ring-1 ring-emerald-500/40 shadow-md shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-white text-base">SOLVATECH Command Directory</h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                35+ COMMANDS
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              100% Private (Owner-Only) • Anti-Delete Recovery • Firebase Cloud Sync
            </p>
          </div>
        </div>

        <button
          onClick={handleCopyMenu}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold transition-all"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
          <span>Run .menu</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
            activeTab === 'all'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold'
              : 'text-slate-400 hover:bg-slate-900 border border-transparent'
          }`}
        >
          All (35+)
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveTab(cat.id as any)}
            className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
              activeTab === cat.id
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold'
                : 'text-slate-400 hover:bg-slate-900 border border-transparent'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Command listing */}
      <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
        {filteredCategories.map((cat) => (
          <div key={cat.id} className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
              <cat.icon className={`w-3.5 h-3.5 ${cat.color}`} />
              <span>{cat.name}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {cat.commands.map((c) => {
                const cleanCmd = c.cmd.split(' ')[0];
                return (
                  <div
                    key={c.cmd}
                    className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 flex items-start justify-between gap-2 group transition-all"
                  >
                    <div className="min-w-0">
                      <code className="text-xs font-mono font-bold text-emerald-400 select-all">
                        {c.cmd}
                      </code>
                      <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{c.desc}</p>
                    </div>

                    <button
                      onClick={() => onRunCommand(cleanCmd)}
                      title={`Test ${cleanCmd}`}
                      className="p-1 rounded-lg bg-slate-800 text-slate-400 group-hover:text-emerald-400 group-hover:bg-slate-700 transition-colors shrink-0"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
