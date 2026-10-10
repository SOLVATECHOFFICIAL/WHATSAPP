import React, { useState } from 'react';
import { Sparkles, Image as ImageIcon, Download, RefreshCw, X, Sliders } from 'lucide-react';

interface ImageGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ImageGeneratorModal: React.FC<ImageGeneratorModalProps> = ({ isOpen, onClose }) => {
  const [prompt, setPrompt] = useState('Futuristic cybersecurity cyber-shield robot protecting a glowing green WhatsApp server in a dark neon data center');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const aspectRatios = [
    { label: '1:1 Square', value: '1:1' },
    { label: '16:9 Landscape', value: '16:9' },
    { label: '9:16 Portrait / Story', value: '9:16' },
    { label: '4:3 Standard', value: '4:3' },
    { label: '3:4 Portrait', value: '3:4' },
    { label: '3:2 Photo', value: '3:2' },
    { label: '2:3 Vertical', value: '2:3' },
    { label: '21:9 Ultra-Wide', value: '21:9' },
  ];

  const imageSizes: Array<'1K' | '2K' | '4K'> = ['1K', '2K', '4K'];

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          aspectRatio,
          imageSize,
        }),
      });

      const data = await res.json();
      if (data.success && data.imageUrl) {
        setGeneratedImage(data.imageUrl);
      } else {
        setError(data.error || 'Failed to generate image');
      }
    } catch (err: any) {
      setError(err.message || 'Error communicating with Gemini image model');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950">
              <Sparkles className="w-5 h-5 font-bold" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">SOLVATECH AI Image Studio</h3>
              <p className="text-xs text-slate-400">
                Model: <code className="text-emerald-400">gemini-3-pro-image-preview</code>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5">
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Image Prompt
              </label>
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image in detail..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                required
              />
            </div>

            {/* Aspect Ratio Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                <span>Aspect Ratio</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {aspectRatios.map((ar) => (
                  <button
                    key={ar.value}
                    type="button"
                    onClick={() => setAspectRatio(ar.value)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border text-center transition-all ${
                      aspectRatio === ar.value
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {ar.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Image Resolution Affordance (1K, 2K, 4K) */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Image Resolution Size
              </label>
              <div className="grid grid-cols-3 gap-2">
                {imageSizes.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setImageSize(size)}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      imageSize === size
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg shadow-emerald-950/40'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {size} Studio Quality
                  </button>
                ))}
              </div>
            </div>

            {/* Generate Button */}
            <button
              type="submit"
              disabled={loading || !prompt.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 transition-all"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing Studio Image ({imageSize}, {aspectRatio})...</span>
                </>
              ) : (
                <>
                  <ImageIcon className="w-4 h-4" />
                  <span>Generate High-Quality Image</span>
                </>
              )}
            </button>
          </form>

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {/* Generated Image Preview */}
          {generatedImage && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-emerald-400">Generated Result</span>
                <span>{imageSize} • {aspectRatio}</span>
              </div>
              <div className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center max-h-80">
                <img
                  src={generatedImage}
                  alt="Generated Result"
                  className="max-h-80 w-auto object-contain"
                />
              </div>
              <a
                href={generatedImage}
                download="solvatech-ai-art.jpg"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-700 text-xs font-semibold transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Generated JPG</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
