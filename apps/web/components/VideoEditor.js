'use client';

import React, { useState, useRef, useEffect } from 'react';

// Lightweight IG-style editor: add clips, single transition selector (None/Crossfade), and draggable text overlays.
export default function VideoEditor({ onChange }) {
  const [clips, setClips] = useState([]);
  const [textOverlays, setTextOverlays] = useState([]);
  const [transitionType, setTransitionType] = useState('crossfade');
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef();
  const fileInputRef = useRef();

  useEffect(() => {
    let total = 0;
    clips.forEach((c) => {
      total += (c.trimEnd || c.duration || 0);
    });
    setDuration(total);
  }, [clips]);

  function addFiles(files) {
    const arr = Array.from(files).map((f, i) => ({ file: f, id: Date.now() + i, title: f.name, trimStart: 0, trimEnd: 0, duration: 0 }));
    const next = clips.concat(arr);
    setClips(next);
    arr.forEach((item, idx) => loadDuration(item, clips.length + idx));
    propagate(next, textOverlays, transitionType);
  }

  function loadDuration(item, idx) {
    const url = URL.createObjectURL(item.file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = url;
    v.onloadedmetadata = () => {
      const dur = v.duration || 0;
      URL.revokeObjectURL(url);
      setClips((prev) => {
        const next = prev.slice();
        next[idx] = { ...next[idx], duration: dur, trimEnd: dur };
        return next;
      });
    };
  }

  function onDragStart(e, idx) {
    e.dataTransfer.setData('text/plain', String(idx));
  }
  function onDrop(e, idx) {
    e.preventDefault();
    const from = Number(e.dataTransfer.getData('text/plain'));
    if (Number.isNaN(from)) return;
    const next = clips.slice();
    const [item] = next.splice(from, 1);
    next.splice(idx, 0, item);
    setClips(next);
    propagate(next, textOverlays, transitionType);
  }
  function allowDrop(e) { e.preventDefault(); }

  function removeClip(idx) {
    const next = clips.slice();
    next.splice(idx, 1);
    setClips(next);
    propagate(next, textOverlays, transitionType);
  }

  function addTextOverlay() {
    const overlay = { id: Date.now(), text: 'New text', x: 40, y: 40, startTime: 0, endTime: Math.max(3, duration) };
    const next = textOverlays.concat(overlay);
    setTextOverlays(next);
    propagate(clips, next, transitionType);
  }

  function updateOverlay(id, data) {
    const next = textOverlays.map((o) => (o.id === id ? { ...o, ...data } : o));
    setTextOverlays(next);
    propagate(clips, next, transitionType);
  }

  function removeOverlay(id) {
    const next = textOverlays.filter((o) => o.id !== id);
    setTextOverlays(next);
    propagate(clips, next, transitionType);
  }

  function changeTransition(t) {
    setTransitionType(t);
    propagate(clips, textOverlays, t);
  }

  function propagate(c, o, t) {
    if (!onChange) return;
    const manifest = {
      created_at: new Date().toISOString(),
      clips: c.map((cItem, i) => ({ id: cItem.id, name: cItem.file.name, index: i, trimStart: cItem.trimStart || 0, trimEnd: cItem.trimEnd || cItem.duration || 0 })),
      textOverlays: o,
      transition: { type: t, duration: t === 'crossfade' ? 0.6 : 0 },
    };
    onChange({ clips: c.map((cItem) => cItem.file), manifest });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    else { v.play(); setPlaying(true); }
  }

  function onTimeUpdate(e) { setPlayhead(e.target.currentTime); }
  function seekTo(seconds) { const v = videoRef.current; if (!v) return; v.currentTime = seconds; setPlayhead(seconds); }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input ref={fileInputRef} type="file" multiple accept="video/*,image/*" onChange={(e) => addFiles(e.target.files)} />
        <button onClick={togglePlay} style={btn}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={addTextOverlay} style={btn}>Add Text</button>
        <label style={{ marginLeft: 8 }}>Transition:</label>
        <select value={transitionType} onChange={(e) => changeTransition(e.target.value)} style={select}>
          <option value="none">None</option>
          <option value="crossfade">Crossfade</option>
        </select>
      </div>

      <div style={{ position: 'relative', background: '#000', height: 520, borderRadius: 12, overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onTimeUpdate={onTimeUpdate} onEnded={() => setPlaying(false)} controls={false} />
        {textOverlays.map((o) => (
          <div key={o.id}
            style={{ position: 'absolute', left: `${o.x}px`, top: `${o.y}px`, color: '#fff', padding: 8, background: 'rgba(0,0,0,0.4)', borderRadius: 8, cursor: 'move' }}
            draggable
            onDragEnd={(e) => updateOverlay(o.id, { x: e.clientX - e.target.getBoundingClientRect().left, y: e.clientY - e.target.getBoundingClientRect().top })}
          >
            {o.text}
          </div>
        ))}
      </div>

      {/* Timeline area with big Add (+) button on the right */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', overflowX: 'auto' }}>
          {clips.map((c, idx) => (
            <div key={c.id} draggable onDragStart={(e) => onDragStart(e, idx)} onDragOver={allowDrop} onDrop={(e) => onDrop(e, idx)} style={{ minWidth: 120, background: '#111827', padding: 8, borderRadius: 8, color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>{Math.round((c.duration || 0) * 10) / 10}s</div>
              <button type="button" onClick={() => removeClip(idx)} style={{ marginTop: 8, ...smallBtn }}>Remove</button>
            </div>
          ))}

          <div style={{ minWidth: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <button onClick={() => fileInputRef.current && fileInputRef.current.click()} style={{ ...addBtn }}>+</button>
          </div>
        </div>

        {/* Simple playhead bar */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1, height: 8, background: '#e5e7eb', borderRadius: 6, position: 'relative', cursor: 'pointer' }} onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            seekTo(pct * Math.max(1, duration));
          }}>
            <div style={{ position: 'absolute', left: `${(playhead / Math.max(1, duration)) * 100}%`, top: -6, width: 12, height: 20, background: '#2e7dff', borderRadius: 6 }} />
          </div>
          <div style={{ width: 60, textAlign: 'right', fontSize: 13 }}>{Math.round(playhead * 10) / 10}s</div>
        </div>
      </div>

      <div style={{ color: '#6b7280', fontSize: 13 }}>Tip: Tap + to add clips. Drag to reorder. Add text overlays and drag them around. This is a lightweight editor — final rendering happens on the server.</div>
    </div>
  );
}

const btn = { border: 0, borderRadius: 8, background: '#2563eb', color: '#fff', padding: '8px 12px' };
const smallBtn = { border: 0, borderRadius: 6, background: '#374151', color: '#fff', padding: '6px 8px' };
const select = { background: '#fff', color: '#111827', border: '1px solid #d1d5db', padding: '8px', borderRadius: 8 };
const addBtn = { width: 48, height: 48, borderRadius: 12, background: '#10b981', color: '#fff', fontSize: 24, border: 0 };
