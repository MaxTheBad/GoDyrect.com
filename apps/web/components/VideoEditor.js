'use client';

import React, { useState, useRef, useEffect } from 'react';

export default function VideoEditor({ onChange }) {
  const [clips, setClips] = useState([]);
  const [selectedClipIndex, setSelectedClipIndex] = useState(null);
  const [textOverlays, setTextOverlays] = useState([]);
  const [transitionType, setTransitionType] = useState('crossfade');
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0); // seconds
  const [duration, setDuration] = useState(0);
  const videoRef = useRef();
  const fileInputRef = useRef();

  useEffect(() => {
    // compute approximate total duration: sum of clip durations if known
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
    // try to read metadata durations
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

  function removeClip(idx) {
    const next = clips.slice();
    next.splice(idx, 1);
    setClips(next);
    propagate(next, textOverlays, transitionType);
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

  function allowDrop(e) {
    e.preventDefault();
  }

  function splitClip(idx, timeIntoClip) {
    const clip = clips[idx];
    if (!clip) return;
    const rel = Math.max(0, Math.min(timeIntoClip, (clip.trimEnd || clip.duration || 0)));
    const first = { ...clip, id: Date.now(), file: clip.file, trimStart: clip.trimStart || 0, trimEnd: rel };
    const second = { ...clip, id: Date.now() + 1, file: clip.file, trimStart: rel, trimEnd: clip.trimEnd || clip.duration || 0 };
    const next = clips.slice();
    next.splice(idx, 1, first, second);
    setClips(next);
    propagate(next, textOverlays, transitionType);
  }

  function addTextOverlay() {
    const overlay = { id: Date.now(), text: 'New text', x: 50, y: 50, startTime: 0, endTime: Math.max(5, duration) };
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
    // Build manifest with expanded shape
    const manifest = {
      created_at: new Date().toISOString(),
      clips: c.map((cItem, i) => ({ id: cItem.id, name: cItem.file.name, index: i, trimStart: cItem.trimStart || 0, trimEnd: cItem.trimEnd || cItem.duration || 0 })),
      textOverlays: o,
      transition: { type: t, duration: 0.6 },
    };
    onChange({ clips: c.map((cItem) => cItem.file), manifest });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      v.play();
      setPlaying(true);
    }
  }

  function onTimeUpdate(e) {
    setPlayhead(e.target.currentTime);
  }

  function seekTo(seconds) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = seconds;
    setPlayhead(seconds);
  }

  // create a file input wrapper that allows adding files
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input ref={fileInputRef} type="file" multiple accept="video/*,image/*" onChange={(e) => addFiles(e.target.files)} />
        <button type="button" onClick={togglePlay} style={btn}>{playing ? 'Pause' : 'Play'}</button>
        <button type="button" onClick={addTextOverlay} style={btn}>Add Text</button>
        <label style={{ color: '#fff' }}>Transition:</label>
        <select value={transitionType} onChange={(e) => changeTransition(e.target.value)} style={select}>
          <option value="crossfade">Crossfade</option>
          <option value="cut">Cut</option>
          <option value="slide">Slide</option>
        </select>
      </div>

      <div style={{ position: 'relative', background: '#000', height: 320, borderRadius: 8, overflow: 'hidden' }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onTimeUpdate={onTimeUpdate} onEnded={() => setPlaying(false)} controls={false} />
        {textOverlays.map((o) => (
          <div key={o.id}
            style={{ position: 'absolute', left: `${o.x}px`, top: `${o.y}px`, color: '#fff', padding: 6, background: 'rgba(0,0,0,0.4)', borderRadius: 6, cursor: 'move' }}
            draggable
            onDragEnd={(e) => updateOverlay(o.id, { x: e.clientX - e.target.getBoundingClientRect().left, y: e.clientY - e.target.getBoundingClientRect().top })}
          >
            {o.text}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {/* timeline */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', overflowX: 'auto' }}>
          {clips.map((c, idx) => (
            <div key={c.id} draggable onDragStart={(e) => onDragStart(e, idx)} onDragOver={allowDrop} onDrop={(e) => onDrop(e, idx)} style={{ minWidth: 140, background: '#07102a', padding: 8, borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: '#9fb7ff' }}>{c.title}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button type="button" onClick={() => setSelectedClipIndex(idx)} style={smallBtn}>Select</button>
                <button type="button" onClick={() => splitClip(idx, (c.duration || 0) / 2)} style={smallBtn}>Split</button>
                <button type="button" onClick={() => removeClip(idx)} style={smallBtn}>Remove</button>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>{Math.round((c.duration || 0) * 10) / 10}s</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1, height: 24, background: '#08102a', borderRadius: 6, position: 'relative' }} onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            seekTo(pct * Math.max(1, duration));
          }}>
            <div style={{ position: 'absolute', left: `${(playhead / Math.max(1, duration)) * 100}%`, top: 0, bottom: 0, width: 2, background: '#2e7dff' }} />
          </div>
          <div style={{ color: '#9fb7ff', fontSize: 13 }}>{Math.round(playhead * 10) / 10}s</div>
        </div>
      </div>

      <div style={{ color: '#9fb7ff', fontSize: 13, opacity: 0.95 }}>Tip: This editor stores a project manifest alongside uploaded files. Final rendering is performed later by the server using the manifest.</div>
    </div>
  );
}

const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '8px 10px' };
const smallBtn = { border: 0, borderRadius: 6, background: '#21345a', color: '#fff', padding: '6px' };
const select = { background: '#07102a', color: '#fff', border: '1px solid #304178', padding: '8px', borderRadius: 8 };
const inputSmall = { background: '#07102a', color: '#fff', border: '1px solid #304178', padding: '6px', borderRadius: 6 };
const numInput = { width: 60, background: '#07102a', color: '#fff', border: '1px solid #304178', padding: '6px', borderRadius: 6 };
