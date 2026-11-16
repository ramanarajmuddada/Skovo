import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Upload, FileText, Image as ImageIcon, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { ACCEPT_ATTR, prettySize, isImageName, validateFile } from './fileRules';

/**
 * Pick a file, look at it, then upload it.
 *
 * Selecting and uploading are deliberately two steps. The screens this replaces
 * fired the request straight from the file input's onChange, which meant a
 * mis-click uploaded the wrong document to a reviewer with no chance to check
 * the filename first — and taking it back needs a delete round-trip.
 *
 * Everything that can be rejected is rejected here, before a single byte goes
 * out. The server enforces the same rules (portal/routes/Upload/upload.py) and
 * remains the authority; this exists so a student on mobile data does not push
 * 9 MB up a slow link only to be told the extension was never allowed.
 *
 * To clear it after a save, give it a `key` that changes. React then remounts
 * it empty, which is cheaper and less error-prone than resetting five pieces
 * of state from an effect.
 */

export default function FilePicker({
  onUpload,                 // (file, { onProgress, signal }) => Promise<void>
  label = 'Upload document',
  hint,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const [file, setFile]         = useState(null);
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  const clear = useCallback(() => {
    setFile(null); setError(''); setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  // An upload still in flight when the screen closes would set state on an
  // unmounted component, and keep pushing bytes nobody is waiting for.
  useEffect(() => () => abortRef.current?.abort(), []);

  const choose = useCallback(picked => {
    if (!picked) return;
    const problem = validateFile(picked);
    if (problem) { setError(problem); setFile(null); return; }
    setError(''); setProgress(0); setFile(picked);
  }, []);

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    if (disabled || busy) return;
    choose(e.dataTransfer.files?.[0]);
  }, [choose, disabled, busy]);

  const send = async () => {
    if (!file || busy) return;           // guards the double-click
    const problem = validateFile(file);  // re-checked: the file may have changed on disk
    if (problem) { setError(problem); return; }

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true); setError(''); setProgress(0);
    try {
      await onUpload(file, { onProgress: setProgress, signal: controller.signal });
      clear();
    } catch (err) {
      // The file stays selected on failure — retrying should not mean hunting
      // for it in the file browser all over again.
      if (!err?.cancelled) setError(err?.message || 'Upload failed. Try again.');
      setProgress(0);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const Icon = file && isImageName(file.name) ? ImageIcon : FileText;

  return (
    <div className="space-y-2">
      {/* Visually hidden and driven by the button below, but it is still a form
          field: without a name and an accessible name it is reported as an
          unlabelled control, and `label` is what a screen reader announces when
          focus lands on it. */}
      <input
        ref={inputRef} type="file" name="file" accept={ACCEPT_ATTR} className="hidden"
        aria-label={label} tabIndex={-1}
        onChange={e => choose(e.target.files?.[0])}
      />

      {!file ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`w-full min-h-28 rounded-xl border-2 border-dashed p-4 sm:p-6 text-center transition-colors
            disabled:opacity-60 disabled:cursor-not-allowed
            ${dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
        >
          <Upload size={20} className="mx-auto text-slate-400 mb-2" />
          <p className="text-sm font-semibold text-slate-700">{label}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {hint || 'Tap to choose a file'}
          </p>
          {/* Stated before they pick, not after we reject it. */}
          <p className="text-[11px] text-slate-400 mt-2">
            PDF, JPG, PNG, GIF, WEBP or Word · up to 10 MB
          </p>
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 grid place-items-center shrink-0">
              <Icon size={16} className="text-slate-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
              <p className="text-xs text-slate-400">{prettySize(file.size)}</p>
            </div>
            {!busy && (
              <button type="button" onClick={clear} aria-label="Remove file"
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0">
                <X size={15} />
              </button>
            )}
          </div>

          {busy ? (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  {progress >= 99 ? 'Finishing up…' : 'Uploading…'}
                </span>
                <span className="tabular-nums font-semibold">{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-blue-500 transition-[width] duration-200"
                     style={{ width: `${progress}%` }} />
              </div>
              <button type="button" onClick={() => abortRef.current?.abort()}
                className="text-xs text-slate-400 hover:text-red-600 mt-2 transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button" onClick={send} disabled={disabled}
              className="mt-3 w-full min-h-11 flex items-center justify-center gap-2 px-4 py-2.5 text-white
                         font-semibold rounded-lg text-sm disabled:opacity-60 transition-all"
              style={{ backgroundColor: 'var(--accent, #2563eb)' }}
            >
              <CheckCircle2 size={15} /> Upload this file
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5">
          <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-800">{error}</p>
        </div>
      )}
    </div>
  );
}
