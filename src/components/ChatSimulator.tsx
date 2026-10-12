import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, Shield, CheckCheck, RefreshCw, Trash2, Eye } from 'lucide-react';

interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  time: string;
  isDeleted?: boolean;
  imageUrl?: string;
}

interface ChatSimulatorProps {
  initialCommand?: string;
  onClearInitialCommand?: () => void;
}

export const ChatSimulator: React.FC<ChatSimulatorProps> = ({
  initialCommand,
  onClearInitialCommand,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'bot',
      text: `╭━━━〔 ⚡ *SOLVATECH BOT READY* 〕━━━╮\n\nType *.menu* to view all commands, or *.ping* to test latency!`,
      time: '12:00 PM',
      imageUrl: '/solva.webp',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isOwner, setIsOwner] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (initialCommand) {
      handleSendCommand(initialCommand);
      if (onClearInitialCommand) onClearInitialCommand();
    }
  }, [initialCommand]);

  const handleSendCommand = async (cmdText?: string) => {
    const textToSend = cmdText || inputText;
    if (!textToSend.trim() || loading) return;

    const userMsg: Message = {
      id: Math.random().toString(36).substring(2),
      sender: 'user',
      text: textToSend,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!cmdText) setInputText('');
    setLoading(true);

    try {
      const res = await fetch('/api/commands/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSend,
          isOwner,
        }),
      });

      const data = await res.json();
      if (data.success && data.result) {
        const isMenuOrBrand =
          textToSend.trim().toLowerCase().startsWith('.menu') ||
          textToSend.trim().toLowerCase().startsWith('.help') ||
          textToSend.trim().toLowerCase().startsWith('.signature') ||
          textToSend.trim().toLowerCase().startsWith('.owner') ||
          Boolean(data.result.imageUrl);

        const botMsg: Message = {
          id: Math.random().toString(36).substring(2),
          sender: 'bot',
          text: data.result.reply,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          imageUrl: data.result.imageUrl || (isMenuOrBrand ? '/solva.webp' : undefined),
        };
        setMessages((prev) => [...prev, botMsg]);
      }
    } catch (err: any) {
      const errMsg: Message = {
        id: Math.random().toString(36).substring(2),
        sender: 'bot',
        text: `⚠️ *Error executing command:* ${err.message}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateDelete = () => {
    // Add user message then simulate deletion
    const secretMsg: Message = {
      id: Math.random().toString(36).substring(2),
      sender: 'user',
      text: 'This is a private confidential message that gets deleted!',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isDeleted: true,
    };
    const recoveryMsg: Message = {
      id: Math.random().toString(36).substring(2),
      sender: 'bot',
      text: `🚨 *[SOLVATECH ANTI-DELETE RECOVERY]*\n\n👤 Sender: +2348000000000\n📍 Location: Group Chat\n💬 Deleted Message: "This is a private confidential message that gets deleted!"\n🔒 Forwarded privately to Owner DM.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, secretMsg, recoveryMsg]);
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-[520px] overflow-hidden">
      {/* WhatsApp Header */}
      <div className="p-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <img
              src="/solva.webp"
              alt="SOLVATECH"
              className="w-9 h-9 rounded-full object-cover ring-2 ring-emerald-500/50 shadow-md"
            />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-900 absolute -bottom-0.5 -right-0.5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white leading-tight flex items-center gap-1.5">
              <span>SOLVATECH Bot Simulator</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            </h4>
            <p className="text-[11px] text-slate-400">Live Baileys Execution & Response Testing</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {/* Owner mode switch */}
          <button
            onClick={() => setIsOwner(!isOwner)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all ${
              isOwner
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Toggle Owner Permission"
          >
            <Shield className="w-3 h-3" />
            <span>{isOwner ? '👑 Owner Mode' : 'Participant'}</span>
          </button>

          {/* Test anti-delete */}
          <button
            onClick={handleSimulateDelete}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-[11px]"
            title="Simulate Anti-Delete"
          >
            <Trash2 className="w-3 h-3 text-rose-400" />
            <span className="hidden sm:inline">Anti-Delete</span>
          </button>
        </div>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/60 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
        {messages.map((m) => {
          const isBot = m.sender === 'bot';
          return (
            <div
              key={m.id}
              className={`flex flex-col ${isBot ? 'items-start' : 'items-end'}`}
            >
              <div
                className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-4 py-2.5 text-xs shadow-md ${
                  isBot
                    ? 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-sm'
                    : m.isDeleted
                    ? 'bg-rose-950/40 border border-rose-800/40 text-rose-200 line-through rounded-tr-sm'
                    : 'bg-emerald-700 text-white rounded-tr-sm'
                }`}
              >
                {isBot && (
                  <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-slate-800/80">
                    <img
                      src="/solva.webp"
                      alt="SOLVATECH"
                      className="w-4 h-4 rounded-full object-cover ring-1 ring-emerald-500/40 shrink-0"
                    />
                    <span className="text-[10px] font-bold text-emerald-400 font-mono tracking-wide">
                      SOLVATECH BOT
                    </span>
                  </div>
                )}
                {m.imageUrl && (
                  <div className="mb-2.5 rounded-xl overflow-hidden border border-emerald-500/40 shadow-lg max-w-sm">
                    <img
                      src={m.imageUrl}
                      alt="SOLVATECH"
                      className="w-full h-36 object-cover"
                    />
                  </div>
                )}
                <div className="whitespace-pre-wrap font-sans leading-relaxed break-words">
                  {m.text}
                </div>
                <div
                  className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                    isBot ? 'text-slate-500' : 'text-emerald-200'
                  }`}
                >
                  <span>{m.time}</span>
                  {!isBot && <CheckCheck className="w-3 h-3 text-cyan-300" />}
                </div>
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex items-center gap-2 p-2 text-xs text-slate-400">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            <span>SOLVATECH is processing command...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Action Chips */}
      <div className="px-3 py-1.5 bg-slate-900/80 border-t border-slate-800/80 flex items-center gap-1.5 overflow-x-auto text-[11px] scrollbar-none">
        <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider shrink-0">Quick Test:</span>
        <button
          onClick={() => handleSendCommand('.open')}
          className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/40 shrink-0 font-mono transition-colors"
        >
          👁️ .open / .vv
        </button>
        <button
          onClick={() => handleSendCommand('.sticker')}
          className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-800/40 shrink-0 font-mono transition-colors"
        >
          🎨 .sticker
        </button>
        <button
          onClick={() => handleSendCommand('.antisticker')}
          className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-800/40 shrink-0 font-mono transition-colors"
        >
          🖼️ .antisticker
        </button>
        <button
          onClick={() => handleSendCommand('.read')}
          className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-800/40 shrink-0 font-mono transition-colors"
        >
          🔍 .read (OCR)
        </button>
        <button
          onClick={() => handleSendCommand('.ping')}
          className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 shrink-0 font-mono transition-colors"
        >
          ⚡ .ping
        </button>
        <button
          onClick={() => handleSendCommand('.uptime')}
          className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 shrink-0 font-mono transition-colors"
        >
          ⏱️ .uptime
        </button>
      </div>

      {/* Input bar */}
      <div className="p-3 bg-slate-900 border-t border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendCommand();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            placeholder="Type a command (e.g. .open, .sticker, .antisticker, .read, .menu)..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={loading || !inputText.trim()}
            className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition-all disabled:opacity-40"
          >
            <Send className="w-4 h-4 text-slate-950" />
          </button>
        </form>
      </div>
    </div>
  );
};
